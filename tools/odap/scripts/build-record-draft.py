"""Render registered Kkakka text to native Hancom drafts; never mark source review complete."""
from pathlib import Path
from copy import deepcopy
from lxml import etree as E
import argparse,base64,hashlib,json,re,uuid,importlib.util
import io
from collections import Counter
from PIL import Image

def main():
 import win32com.client
 p=argparse.ArgumentParser();p.add_argument('job',type=Path);p.add_argument('--template',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 spec=importlib.util.spec_from_file_location('native',Path(__file__).with_name('build-review-hangul.py'));native=importlib.util.module_from_spec(spec);spec.loader.exec_module(native)
 packet=json.loads(a.job.read_text(encoding='utf-8'))['packet'];items=packet['items']
 if packet.get('mode')!='record_draft' or not packet.get('review_only') or not 1<=len(items)<=100:raise ValueError('Private record draft required')

 original=a.template.read_bytes();sha=hashlib.sha256(original).hexdigest();root=native.xmlroot(original)
 styles={s.get('Name'):s for s in root.findall('./HEAD/MAPPINGTABLE/STYLELIST/STYLE')}
 endnote=deepcopy(root.find('.//ENDNOTE'));first=deepcopy(root.find('./BODY/SECTION/P'))
 for t in list(first):
  if t.tag!='TEXT':first.remove(t);continue
  for el in list(t):
   if el.tag not in ('SECDEF','COLDEF'):t.remove(el)
  if not len(t):first.remove(t)
 for c in first.findall('.//MASTERPAGE//CHAR'):
  if c.text and '한백고' in c.text:c.text='서로국어  '
 body=root.find('BODY');body.clear();section=E.SubElement(body,'SECTION',Id='0');section.append(first)
 # Dedicated readable 9 pt text style; keep the template's real fonts and spacing.
 chars=root.find('./HEAD/MAPPINGTABLE/CHARSHAPELIST');stylelist=root.find('./HEAD/MAPPINGTABLE/STYLELIST')
 bodychar=deepcopy(next(x for x in chars if x.get('Id')==styles['본문'].get('CharShape')));cid=str(max(int(x.get('Id')) for x in chars)+1);bodychar.set('Id',cid);bodychar.set('Height','900');bodychar.set('TextColor','0')
 for bold in list(bodychar.findall('BOLD')):bodychar.remove(bold)
 chars.append(bodychar);chars.set('Count',str(len(chars)));body_style=deepcopy(styles['본문']);body_style.set('Id',str(max(int(x.get('Id')) for x in stylelist)+1));body_style.set('Name','오답 분석 본문');body_style.set('EngName','ClinicBody');body_style.set('CharShape',cid);stylelist.append(body_style);stylelist.set('Count',str(len(stylelist)));styles['오답 분석 본문']=body_style
 expected=[]
 def add(text,style='본문'):
  text=str(text or '');style='오답 분석 본문' if style=='본문' else style;section.append(native.paragraph(styles,style,text));expected.append(text)
 add(packet['title']);add(packet.get('student_name',''));add('교사 확인용 초안 · 학생 미공개');add(packet.get('summary',''))
 if packet.get('analysis'):
  add('오답 유형 분석')
  add('확인된 답안과 교사 기록을 기준으로 정리합니다. 답 번호만으로 학생의 오답 원인을 단정하지 않습니다.')
  concepts=Counter(c for d in packet['analysis'] for c in set(d.get('concepts') or []))
  types=Counter(t for d in packet['analysis'] for t in set(d.get('question_types') or []))
  if concepts:add('개념별 오답 문항 수: '+' · '.join(f'{c} {n}문항' for c,n in concepts.most_common()))
  if types:add('요구 사고 유형: '+' · '.join(f'{t} {n}문항' for t,n in types.most_common()))
  add('한 문항에 여러 개념·유형이 포함될 수 있습니다. 위 수치는 오답률이나 원인 확정 결과가 아닙니다.')
  for d in packet['analysis']:
   add(str(d.get('exam',''))+' · '+str(d.get('num',''))+'번')
   add('세부 개념: '+' / '.join(d.get('concepts') or ['분류 필요']))
   add('학생 답 '+str(d.get('student_answer',''))+' → 정답 '+str(d.get('correct','')))
   if d.get('question_types'):add('문항 유형: '+' / '.join(d['question_types']))
   if d.get('answer_key_conflict'):add('정답 대조: 기존 등록 '+str(d.get('registered_answer'))+' / 검증 원본 '+str(d.get('source_answer'))+' · 교사 정정 및 기존 성적 유지')
   add(d.get('cause','원인 확인 필요'))
   if d.get('review_focus'):add('확인할 지점: '+d['review_focus'])
   for ref in d.get('print_references') or []:add('복습 근거: '+str(ref.get('source_title',''))+' · '+str(ref.get('page',''))+'쪽 — '+str(ref.get('quote','')))
  add('누적 오답 문제 모음')
  section[-1].set('PageBreak','true')
 def add_image(image):
  data=image.get('data','')
  match=re.fullmatch(r'data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)',data)
  if not match:raise ValueError('원문 그림 형식을 확인하세요.')
  raw=base64.b64decode(match[2],validate=True)
  if len(raw)>10_000_000:raise ValueError('원문 그림이 너무 큽니다.')
  with Image.open(io.BytesIO(raw)) as im:w,h=im.size
  width=22000;height=round(width*h/w)
  if height>68000:raise ValueError('원문 그림을 문단 경계에서 나눠 등록하세요. 지면보다 큰 그림을 잘라내지 않습니다.')
  listing=root.find('./HEAD/MAPPINGTABLE/BINDATALIST')
  if listing is None:listing=E.SubElement(root.find('./HEAD/MAPPINGTABLE'),'BINDATALIST',Count='0')
  tail=root.find('TAIL')
  if tail is None:tail=E.SubElement(root,'TAIL')
  storage=tail.find('BINDATASTORAGE')
  if storage is None:storage=E.SubElement(tail,'BINDATASTORAGE')
  ident=str(max([int(x.get('BinData')) for x in listing]+[0])+1)
  E.SubElement(listing,'BINITEM',BinData=ident,Format='PNG' if match[1]=='png' else 'JPG',Type='Embedding');listing.set('Count',str(len(listing)))
  E.SubElement(storage,'BINDATA',Compress='false',Encoding='Base64',Id=ident,Size=str(len(raw))).text=base64.b64encode(raw).decode()
  para=native.paragraph(styles,'본문','');pic=E.SubElement(para.find('TEXT'),'PICTURE',Reverse='false')
  obj=E.SubElement(pic,'SHAPEOBJECT',InstId=str(uuid.uuid4().int%2000000000),Lock='false',NumberingType='Figure',TextWrap='TopAndBottom',ZOrder='0')
  E.SubElement(obj,'SIZE',Height=str(height),HeightRelTo='Absolute',Protect='false',Width=str(width),WidthRelTo='Absolute')
  E.SubElement(obj,'POSITION',AffectLSpacing='false',AllowOverlap='false',FlowWithText='true',HoldAnchorAndSO='false',HorzAlign='Left',HorzOffset='0',HorzRelTo='Column',TreatAsChar='true',VertAlign='Top',VertOffset='0',VertRelTo='Para')
  E.SubElement(obj,'OUTSIDEMARGIN',Bottom='0',Left='0',Right='0',Top='0');E.SubElement(obj,'SHAPECOMMENT').text=image.get('alt','원문 지면')
  comp=E.SubElement(pic,'SHAPECOMPONENT',CurHeight=str(height),CurWidth=str(width),GroupLevel='0',HorzFlip='false',InstID=str(uuid.uuid4().int%2000000000),OriHeight=str(height),OriWidth=str(width),VertFlip='false',XPos='0',YPos='0')
  E.SubElement(comp,'ROTATIONINFO',Angle='0',CenterX=str(width//2),CenterY=str(height//2),Rotate='1')
  rendering=E.SubElement(comp,'RENDERINGINFO')
  for name in ('TRANSMATRIX','SCAMATRIX','ROTMATRIX'):E.SubElement(rendering,name,E1='1',E2='0',E3='0',E4='0',E5='1',E6='0')
  E.SubElement(pic,'IMAGERECT',X0='0',X1=str(width),X2=str(width),X3='0',Y0='0',Y1='0',Y2=str(height),Y3=str(height))
  E.SubElement(pic,'IMAGECLIP',Bottom=str(height),Left='0',Right=str(width),Top='0');E.SubElement(pic,'INSIDEMARGIN',Bottom='0',Left='0',Right='0',Top='0');E.SubElement(pic,'IMAGEDIM',Height=str(height),Width=str(width));E.SubElement(pic,'IMAGE',Alpha='0',BinItem=ident,Bright='0',Contrast='0',Effect='RealPic');E.SubElement(pic,'EFFECTS');section.append(para)
 for i,q in enumerate(items):
  passage=str(q.get('passage') or '')
  is_example=bool(re.match(r'^\s*<보기',passage))
  if passage and not is_example:add(passage)
  add(q.get('source_title',''),'문항정보')
  for issue in q.get('source_issues',[]):add('원문 확인: '+issue)
  if q.get('attempts'):add('오답 이력: '+' / '.join(str(x.get('date',''))[:10]+' 선택 '+str(x.get('answer','')) for x in q['attempts']))
  lines=str(q.get('text','')).splitlines();stem=lines[0] if lines else '발문 확인 필요'
  question_end=re.search(r'[?？]',stem)
  if question_end and len(stem)>question_end.end()+2:
   remaining=stem[question_end.end():];stem=stem[:question_end.end()];lines=[stem,remaining]+lines[1:]
  para=native.paragraph(styles,'발문(zb 1)',stem);note=deepcopy(endnote)
  for auto in note.findall('.//AUTONUM'):auto.set('Number',str(i+1))
  chars=note.findall('.//CHAR')
  for ch in chars:ch.text=''
  answer='[정답] '+str(q.get('answer') or '확인 필요').replace('all:','모두 선택: ')+' [해설] '+str(q.get('explanation') or '해설 확인 필요')
  chars[0].text=answer;para.find('TEXT').insert(0,note);section.append(para);expected.extend([stem,answer])
  if passage and is_example:add(passage)
  for line in lines[1:]:add(line,'선택지' if re.match(r'^[①②③④⑤]',line.strip()) else '본문')
  for picture in q.get('images') or []:add_image(picture)
  for j,choice in enumerate(q.get('choices') or []):add(('①②③④⑤'[j]+' '+str(choice)) if j<5 and not re.match(r'^\s*[①②③④⑤]',str(choice)) else str(choice),'선택지')
 native.prune_assets(root);count=native.apply_styles(root)
 if count!=len(items):raise RuntimeError('미주 개수 불일치')
 a.output.mkdir(parents=True,exist_ok=True);prefix=a.output/('오답모음-초안-'+uuid.uuid4().hex[:10]);h=win32com.client.DispatchEx('HWPFrame.HwpObject')
 try:
  h.XHwpWindows.Item(0).Visible=False;h.SetMessageBoxMode(0x00020000)
  if not h.SetTextFile(native.xmlstring(root),'HWPML2X',''):raise RuntimeError('기준 양식 불러오기 실패')
  prefix.with_suffix('.hwp').write_bytes(base64.b64decode(h.GetTextFile('HWP','')))
  for ext,fmt in [('hwpx','HWPX'),('pdf','PDF')]:
   action='FileSaveAsPdf' if fmt=='PDF' else 'FileSaveAs';params=h.HParameterSet.HFileOpenSave;h.HAction.GetDefault(action,params.HSet);params.filename=str(prefix.with_suffix('.'+ext).resolve());params.Format=fmt
   if not h.HAction.Execute(action,params.HSet):raise RuntimeError(fmt+' 출력 실패')
  result=native.xmlroot(h.GetTextFile('HWPML2X',''));text=re.sub(r'\s+','',''.join(result.xpath('./BODY//CHAR/text()')))
  if native.image_signatures(root)!=native.image_signatures(result):raise RuntimeError('원문 그림 내용 또는 순서가 변경되어 전달하지 않았습니다.')
  if len(result.findall('.//ENDNOTE'))!=len(items):raise RuntimeError('미주 연결 검사 실패')
  if any(re.sub(r'\s+','',x) not in text for x in expected if x.strip()):raise RuntimeError('등록 본문 일부가 누락되어 전달하지 않았습니다.')
  files=[prefix.with_suffix('.'+ext).name for ext in ('hwp','hwpx','pdf')]
  if any((a.output/f).stat().st_size<500 for f in files):raise RuntimeError('제작 파일 크기 오류')
  print(json.dumps({'files':files,'questions':len(items),'endnotes':len(items),'source':'김까까 등록 본문','source_review_complete':False,'visual_review_required':True},ensure_ascii=False))
 finally:
  try:h.Clear(1);h.Quit()
  except Exception:pass
  assert hashlib.sha256(a.template.read_bytes()).hexdigest()==sha
if __name__=='__main__':main()
