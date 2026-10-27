"""Read-only local Drive inventory and resumable content index; outputs stay private."""
import argparse, concurrent.futures, hashlib, json, os, re, sqlite3, struct, subprocess, sys, time, zipfile, zlib
from pathlib import Path
from xml.etree import ElementTree as ET

def extract(path):
    p=Path(path); ext=p.suffix.lower(); result={'status':'text_extracted','pages':0,'empty_pages':0,'text':''}
    if ext=='.pdf':
        import fitz
        with fitz.open(p) as doc:
            if doc.needs_pass: return {'status':'encrypted','pages':len(doc),'text':''}
            result['pages']=len(doc); chunks=[]
            for i,page in enumerate(doc):
                text=page.get_text(sort=True)
                if len(text.strip())<20: result['empty_pages']+=1
                chunks.append(f'\n[PAGE {i+1}]\n{text}')
            result['text']=''.join(chunks)
            if result['empty_pages']: result['status']='ocr_required' if result['empty_pages']==result['pages'] else 'partial_text'
    elif ext in ('.hwpx','.docx','.pptx','.xlsx'):
        with zipfile.ZipFile(p) as z:
            pattern={'.hwpx':r'Contents/section\d+\.xml$', '.docx':r'word/document.xml$', '.pptx':r'ppt/slides/slide\d+\.xml$', '.xlsx':r'xl/(sharedStrings|worksheets/sheet\d+)\.xml$'}[ext]
            chunks=[]
            for name in sorted(n for n in z.namelist() if re.match(pattern,n)):
                info=z.getinfo(name)
                if info.file_size>100*1024*1024: raise ValueError('Oversized XML')
                tree=ET.fromstring(z.read(name)); texts=[e.text for e in tree.iter() if e.tag.split('}')[-1] in ('t','v') and e.text]
                chunks.append(f'\n[PART {name}]\n'+'\n'.join(texts))
            result['text']=''.join(chunks); result['status']='text_extracted' if chunks else 'unsupported_structure'
    elif ext=='.hwp':
        import olefile
        if not olefile.isOleFile(str(p)): return {'status':'unsupported_hwp','text':''}
        with olefile.OleFileIO(str(p)) as ole:
            head=ole.openstream('FileHeader').read(); flags=struct.unpack_from('<I',head,36)[0]
            if flags&2: return {'status':'encrypted','text':''}
            chunks=[]
            for name in sorted(n for n in ole.listdir() if len(n)==2 and n[0]=='BodyText' and n[1].startswith('Section')):
                raw=ole.openstream(name).read(); raw=zlib.decompress(raw,-15) if flags&1 else raw; pos=0; texts=[]
                while pos+4<=len(raw):
                    header=struct.unpack_from('<I',raw,pos)[0];pos+=4;tag=header&1023;size=header>>20
                    if size==4095: size=struct.unpack_from('<I',raw,pos)[0];pos+=4
                    block=raw[pos:pos+size];pos+=size
                    if tag==67: texts.append(re.sub(r'[\x00-\x08\x0b-\x1f]',' ',block.decode('utf-16le',errors='replace')))
                chunks.append(f'\n[PART {name[1]}]\n'+'\n'.join(texts))
            result['text']=''.join(chunks);result['status']='text_extracted' if chunks else 'unsupported_structure'
    else: return {'status':'unsupported_format','text':''}
    result['characters']=len(result['text']);result['replacement_characters']=result['text'].count('\ufffd')
    result['old_hangul_present']=bool(re.search('[\u1100-\u11ff\ua960-\ua97f\ud7b0-\ud7ff]',result['text']))
    result['review_status']='not_reviewed'
    return result

STABLE_STATUSES={'text_extracted','partial_text','ocr_required','encrypted','unsupported_format','unsupported_hwp','unsupported_structure'}
SUPPORTED_EXTENSIONS={'.pdf','.hwpx','.hwp','.docx','.pptx','.xlsx'}

def failure(item,status,error):
    path,size,mtime=item
    return {'path':path,'size':size,'mtime':mtime,'sha256':'','status':status,'pages':0,'characters':0,'empty_pages':0,'replacement_characters':0,'text_path':'','error':str(error)[-1000:]}

def inspect_one(item, output, refresh_cache=False):
    """Runs only in a killable child: hashing, cloud reads and extraction share one timeout."""
    path,size,mtime=item; row=failure(item,'read_error','')
    if Path(path).suffix.lower() not in SUPPORTED_EXTENSIONS:
        return failure(item,'unsupported_format','No supported extractor for this format; body not read.')
    try:
        before=os.stat(path)
        if before.st_size!=size or before.st_mtime_ns!=mtime:
            return failure(item,'changed_during_read','Metadata changed before the file could be read.')
        digest=hashlib.sha256()
        with open(path,'rb') as f:
            for block in iter(lambda:f.read(1024*1024),b''): digest.update(block)
        sha=digest.hexdigest(); out=Path(output)/'text-v2'/f'{sha}.json'
        data=None
        if out.exists() and not refresh_cache:
            try:
                with out.open(encoding='utf8') as f: cached=json.load(f)
                if cached.get('status') in STABLE_STATUSES: data=cached
            except (OSError,ValueError): pass
        if data is None:
            try: data=extract(path)
            except OSError as e: return failure(item,'read_error',e)
            except Exception as e: data={'status':'extract_error','error':str(e),'text':'','review_status':'not_reviewed'}
            after=os.stat(path)
            if after.st_size!=size or after.st_mtime_ns!=mtime:
                return failure(item,'changed_during_read','Source changed during hashing or extraction; content was not indexed.')
            # A versioned derived cache preserves the older index. Atomic publication
            # prevents concurrent duplicate sources from reading half-written JSON.
            out.parent.mkdir(parents=True,exist_ok=True)
            temp=out.with_name(out.name+f'.{os.getpid()}.tmp')
            with temp.open('w',encoding='utf8') as f: json.dump(data,f,ensure_ascii=False)
            os.replace(temp,out)
        after=os.stat(path)
        if after.st_size!=size or after.st_mtime_ns!=mtime:
            return failure(item,'changed_during_read','Source changed before indexing completed.')
        row.update(sha256=sha,status=data['status'],pages=data.get('pages',0),characters=data.get('characters',0),empty_pages=data.get('empty_pages',0),replacement_characters=data.get('replacement_characters',0),text_path=str(out),error=data.get('error',''))
        return row
    except OSError as e: return failure(item,'read_error',e)
    except Exception as e: return failure(item,'extract_error',e)

def inspect(item,output,timeout=45,refresh_cache=False):
    path,size,mtime=item
    try:
        result=subprocess.run([sys.executable,'-X','utf8',str(Path(__file__).resolve()),'--inspect-one',path,'--expected-size',str(size),'--expected-mtime',str(mtime),'--output',str(output)]+(['--refresh-cache'] if refresh_cache else []),capture_output=True,timeout=timeout)
        if result.returncode:
            return failure(item,'extract_error',result.stderr.decode('utf8',errors='replace')[-1000:] or f'Child exited {result.returncode}')
        row=json.loads(result.stdout)
        if not isinstance(row,dict) or row.get('path')!=path or row.get('status') not in STABLE_STATUSES|{'read_error','extract_error','changed_during_read'}:
            raise ValueError('Invalid child extraction result')
        return row
    except subprocess.TimeoutExpired:
        return failure(item,'timeout',f'Hash and extraction did not finish within {timeout} seconds; child terminated.')
    except OSError as e: return failure(item,'read_error',e)
    except Exception as e: return failure(item,'extract_error',e)

def save_row(db,row):
    columns=['path','size','mtime','sha256','status','pages','characters','empty_pages','replacement_characters','text_path','error']
    db.execute('insert into files('+','.join(columns)+',attempts,updated_at) values('+','.join('?' for _ in columns)+',1,?) on conflict(path) do update set '+','.join(c+'=excluded.'+c for c in columns if c!='path')+',attempts=files.attempts+1,updated_at=excluded.updated_at', [row[c] for c in columns]+[time.strftime('%Y-%m-%dT%H:%M:%S')])

def run(paths_file,output,workers,timeout=45,retry_all=False):
    if workers<1 or workers>16 or timeout<=0: raise ValueError('Use 1-16 workers and a positive timeout')
    output=Path(output).resolve();output.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(output/'catalog.sqlite');db.execute('pragma journal_mode=wal')
    db.execute('create table if not exists files(path text primary key,size integer,mtime integer,sha256 text,status text,pages integer,characters integer,empty_pages integer,replacement_characters integer,text_path text)')
    existing={r[1] for r in db.execute('pragma table_info(files)')}
    for name,definition in [('error',"text not null default ''"),('attempts','integer not null default 0'),('updated_at',"text not null default ''")]:
        if name not in existing: db.execute(f'alter table files add column {name} {definition}')
    paths=list(dict.fromkeys(p for p in Path(paths_file).read_text(encoding='utf-8-sig').splitlines() if p.strip()));pending=[];failures=0
    db.execute('create temp table current_inventory(path text primary key)')
    db.executemany('insert into current_inventory values(?)',((p,) for p in paths))
    for path in paths:
        try: st=os.stat(path)
        except OSError as e:
            failures+=1;save_row(db,failure((path,-1,-1),'read_error',e));continue
        old=db.execute('select size,mtime,status from files where path=?',(path,)).fetchone()
        if not retry_all and old and old[0]==st.st_size and old[1]==st.st_mtime_ns and old[2] in STABLE_STATUSES:continue
        pending.append((path,st.st_size,st.st_mtime_ns))
        # Every discovered file remains visible even if this run is interrupted.
        if old: db.execute("update files set status='pending',error='' where path=?",(path,))
        else: db.execute("insert into files(path,size,mtime,status) values(?,?,?,'pending')",(path,st.st_size,st.st_mtime_ns))
    pending.sort(key=lambda item:(item[1],item[0]));db.commit()
    def progress(done):
        counts=dict(db.execute('select status,count(*) from files join current_inventory using(path) group by status'))
        all_attempted=done==len(pending)
        fully_extracted=all_attempted and counts.get('text_extracted',0)==len(paths)
        state={'inventory':len(paths),'pending_at_start':len(pending),'processed_this_run':done,'stat_errors':failures,'indexed':sum(counts.values()),'statuses':counts,'scan_complete':all_attempted,'complete':fully_extracted,'content_extraction_complete':fully_extracted,'review_complete':False,'timeout_seconds':timeout,'updated_at':time.strftime('%Y-%m-%dT%H:%M:%S')}
        temp=output/'progress.json.tmp';temp.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf8');os.replace(temp,output/'progress.json')
        print(json.dumps(state,ensure_ascii=False),flush=True)
    progress(0)
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            futures={pool.submit(inspect,item,output,timeout,retry_all):item for item in pending}
            for i,future in enumerate(concurrent.futures.as_completed(futures),1):
                try:row=future.result()
                except Exception as e:row=failure(futures[future],'extract_error',e)
                save_row(db,row)
                if i%10==0:db.commit();progress(i)
        db.commit();progress(len(pending))
    finally:db.commit();db.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--one');parser.add_argument('--inspect-one');parser.add_argument('--expected-size',type=int);parser.add_argument('--expected-mtime',type=int);parser.add_argument('--paths');parser.add_argument('--output');parser.add_argument('--workers',type=int,default=4);parser.add_argument('--timeout',type=float,default=45);parser.add_argument('--retry-all',action='store_true');parser.add_argument('--refresh-cache',action='store_true');args=parser.parse_args()
    if args.inspect_one:
        if args.expected_size is None or args.expected_mtime is None or not args.output:parser.error('--inspect-one requires expected metadata and --output')
        print(json.dumps(inspect_one((args.inspect_one,args.expected_size,args.expected_mtime),args.output,args.refresh_cache),ensure_ascii=False))
    elif args.one:
        try:print(json.dumps(extract(args.one),ensure_ascii=False))
        except Exception as e: print(json.dumps({'status':'extract_error','error':str(e),'text':''},ensure_ascii=False))
    else:
        if not args.paths or not args.output:parser.error('--paths and --output are required')
        run(args.paths,args.output,args.workers,args.timeout,args.retry_all)
