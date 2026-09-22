"""Regression for noncontiguous Hancom image IDs and hidden source markers."""
from pathlib import Path
import base64,importlib.util,io,tempfile
from lxml import etree as E
from PIL import Image

path=Path(__file__).resolve().parents[1]/'tools/odap/scripts/build-review-hangul.py'
s=importlib.util.spec_from_file_location('native',path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
r=E.fromstring(b'<HWPML><HEAD SecCnt="1"><MAPPINGTABLE><BINDATALIST Count="3"/></MAPPINGTABLE></HEAD><BODY><SECTION><P><TEXT><CHAR>zb</CHAR><ENDNOTE/><CHAR>Original question</CHAR><IMAGE BinItem="9"/><IMAGE BinItem="2"/></TEXT></P></SECTION></BODY><TAIL><BINDATASTORAGE/></TAIL></HWPML>')
for ident,color in [('2','red'),('5','green'),('9','blue')]:
 b=io.BytesIO();Image.new('RGB',(3,2),color).save(b,format='PNG')
 E.SubElement(r.find('.//BINDATALIST'),'BINITEM',BinData=ident,Format='PNG',Type='Embedding')
 E.SubElement(r.find('.//BINDATASTORAGE'),'BINDATA',Id=ident).text=base64.b64encode(b.getvalue()).decode()
before=m.image_signatures(r);m.prune_assets(r)
assert [x.get('BinData') for x in r.findall('.//BINITEM')]==['1','2']
assert [x.get('BinItem') for x in r.findall('.//IMAGE')]==['2','1']
assert m.image_signatures(r)==before
with tempfile.TemporaryDirectory() as td:
 f=Path(td)/'source.hml';f.write_text(m.xmlstring(r),encoding='utf-8');source=f.read_bytes()
 frag=m.fragment(f,{'section':0,'start':0,'end':1,'question_paragraph':0})
 assert frag.xpath('./BODY//CHAR/text()')==['Original question']
 assert len(frag.findall('.//ENDNOTE'))==1 and m.image_signatures(frag)==before
 assert f.read_bytes()==source
print('PASS: image content/order, contiguous asset IDs, source marker cleanup, original immutability')
