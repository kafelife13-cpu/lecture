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

# A multi-line stem must stay on one page and with its following passage.
layout=E.fromstring(b'<HWPML><HEAD><MAPPINGTABLE><STYLELIST><STYLE Id="0" Name="stem" ParaShape="0" CharShape="0"/><STYLE Id="1" Name="choice" ParaShape="0" CharShape="0"/><STYLE Id="2" Name="body" ParaShape="0" CharShape="0"/></STYLELIST><PARASHAPELIST><PARASHAPE Id="0"><PARAMARGIN/></PARASHAPE></PARASHAPELIST><CHARSHAPELIST><CHARSHAPE Id="0"/></CHARSHAPELIST></MAPPINGTABLE></HEAD><BODY><SECTION><P ParaShape="0"><TEXT CharShape="0"><CHAR>Long stem</CHAR><ENDNOTE><PARALIST><P><TEXT><AUTONUM/></TEXT></P></PARALIST></ENDNOTE></TEXT></P></SECTION></BODY></HWPML>')
for style,name in zip(layout.findall('.//STYLE'),['발문(zb 1)','선택지','본문']):style.set('Name',name)
assert m.apply_styles(layout)==1
stem=layout.find('./BODY/SECTION/P');shape=next(x for x in layout.findall('.//PARASHAPE') if x.get('Id')==stem.get('ParaShape'))
assert shape.get('KeepLines')=='true' and shape.get('KeepWithNext')=='true'
print('PASS: multi-line question stem stays together')

# Styling may move the endnote control before the stem; content must stay exact.
from copy import deepcopy
fragment=E.fromstring(b'<HWPML><BODY><SECTION><P><TEXT><CHAR>Stem</CHAR><ENDNOTE><P><TEXT><CHAR>Answer 3</CHAR></TEXT></P></ENDNOTE><CHAR> rest</CHAR></TEXT></P><P><TEXT><CHAR>Choices</CHAR></TEXT></P></SECTION></BODY></HWPML>')
result=deepcopy(fragment);t=result.find('.//TEXT');note=t.find('ENDNOTE');t.remove(note);t.insert(0,note)
m.verify_original_text([fragment],result)
for change in ['body','note','order']:
 bad=deepcopy(result)
 if change=='body':bad.find('./BODY/SECTION/P/TEXT/CHAR').text='Wrong stem'
 elif change=='note':bad.find('.//ENDNOTE//CHAR').text='Answer 4'
 else:
  sec=bad.find('./BODY/SECTION');sec.insert(0,sec[-1])
 try:m.verify_original_text([fragment],bad)
 except RuntimeError:pass
 else:raise AssertionError('Lost source text accepted: '+change)
print('PASS: relocated endnote control accepted; changed body/answer/order rejected')
