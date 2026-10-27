"""Synthetic-only tests for the read-only, bounded Drive indexing worker."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import unittest
from unittest import mock

MODULE = Path(__file__).resolve().parents[1] / 'tools' / 'weekly-feedback' / 'index-drive.py'
spec = importlib.util.spec_from_file_location('drive_index', MODULE)
index = importlib.util.module_from_spec(spec)
spec.loader.exec_module(index)


class DriveIndexTests(unittest.TestCase):
    def test_pdf_hwp_unsupported_and_missing_are_all_recorded(self):
        import fitz
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pdf = root / 'synthetic.pdf'
            with fitz.open() as doc:
                doc.new_page().insert_text((50, 50), 'Synthetic indexing test. No real student content.')
                doc.save(pdf)
            hwp = root / 'synthetic.hwp'
            hwp.write_bytes(b'not a real HWP document')
            legacy = root / 'synthetic.doc'
            legacy.write_bytes(b'not a supported document')
            missing = root / 'missing.pdf'
            listing = root / 'paths.txt'
            listing.write_text('\n'.join(map(str, [pdf, hwp, legacy, missing])), encoding='utf8')
            original = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in [pdf, hwp, legacy]}
            out = root / 'index'
            with contextlib.redirect_stdout(io.StringIO()):
                index.run(listing, out, workers=2)
            with contextlib.closing(sqlite3.connect(out / 'catalog.sqlite')) as db, db:
                statuses = dict(db.execute('select path,status from files'))
                self.assertEqual(statuses[str(pdf)], 'text_extracted')
                self.assertEqual(statuses[str(hwp)], 'unsupported_hwp')
                self.assertEqual(statuses[str(legacy)], 'unsupported_format')
                self.assertEqual(statuses[str(missing)], 'read_error')
                self.assertEqual(len(statuses), 4)
            progress = json.loads((out / 'progress.json').read_text(encoding='utf8'))
            self.assertTrue(progress['scan_complete'])
            self.assertFalse(progress['complete'])
            self.assertFalse(progress['review_complete'])
            self.assertEqual(original, {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in original})
            missing.write_bytes(pdf.read_bytes())
            with contextlib.redirect_stdout(io.StringIO()):
                index.run(listing, out, workers=2)
            with contextlib.closing(sqlite3.connect(out / 'catalog.sqlite')) as db, db:
                self.assertEqual(db.execute('select status from files where path=?', (str(missing),)).fetchone()[0], 'text_extracted')
                self.assertEqual(db.execute('select attempts from files where path=?', (str(pdf),)).fetchone()[0], 1)

    def test_whole_read_and_hash_use_timed_child(self):
        item = ('synthetic.pdf', 10, 1)
        with mock.patch.object(index.subprocess, 'run', side_effect=subprocess.TimeoutExpired('child', 45)) as run:
            result = index.inspect(item, Path('private-output'))
        self.assertEqual(result['status'], 'timeout')
        self.assertEqual(run.call_args.kwargs['timeout'], 45)
        self.assertIn('--inspect-one', run.call_args.args[0])
        self.assertNotIn('--one', run.call_args.args[0])

    def test_fast_results_are_saved_before_a_slow_first_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = []
            for i in range(12):
                p = root / f'{i:02}.pdf'
                p.write_bytes(b'x' * (i+1))
                paths.append(p)
            listing = root / 'paths.txt'
            listing.write_text('\n'.join(map(str, reversed(paths))), encoding='utf8')
            saved, started = [], []
            original_save = index.save_row
            def inspect(item, output, timeout, refresh_cache=False):
                started.append(item[0])
                time.sleep(0.15 if Path(item[0]).name == '00.pdf' else 0.001)
                return index.failure(item, 'timeout', 'Synthetic timeout')
            def save(db, row):
                saved.append(row['path'])
                original_save(db, row)
            output = io.StringIO()
            with mock.patch.object(index, 'inspect', inspect), mock.patch.object(index, 'save_row', save), contextlib.redirect_stdout(output):
                index.run(listing, root / 'index', workers=4)
            self.assertEqual(started[0], str(paths[0]))
            self.assertNotEqual(saved[0], str(paths[0]))
            self.assertEqual(saved[-1], str(paths[0]))
            self.assertTrue(any(json.loads(line)['processed_this_run'] == 10 for line in output.getvalue().splitlines()))

    def test_existing_catalog_schema_is_migrated_without_dropping_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            listing = root / 'paths.txt'
            listing.write_text('', encoding='utf8')
            with contextlib.closing(sqlite3.connect(root / 'catalog.sqlite')) as db, db:
                db.execute('create table files(path text primary key,size integer,mtime integer,sha256 text,status text,pages integer,characters integer,empty_pages integer,replacement_characters integer,text_path text)')
                db.execute("insert into files values('historical',1,1,'abc','unsupported_format',0,0,0,0,'')")
            with contextlib.redirect_stdout(io.StringIO()):
                index.run(listing, root, workers=1)
            with contextlib.closing(sqlite3.connect(root / 'catalog.sqlite')) as db, db:
                self.assertEqual(db.execute("select status from files where path='historical'").fetchone()[0], 'unsupported_format')
                self.assertIn('error', [row[1] for row in db.execute('pragma table_info(files)')])


if __name__ == '__main__':
    unittest.main()
