"""Assemble reviewed ORIGINAL question spans in the Seoro template using Hancom.
All paths are local. No upload, macros, remote URLs or shell text from a job.
Use one Hancom worker at a time. Requires Windows, Hancom, pywin32 and lxml.
"""
from pathlib import Path
from copy import deepcopy
from lxml import etree as E
import argparse,base64,hashlib,json,re,uuid
import io,zlib
from PIL import Image

def xmlroot(value):
    if isinstance(value,str):value=value.encode('utf-8')
    return E.fromstring(value.replace(b'encoding="UTF-16"',b'encoding="UTF-8"'))

def xmlstring(root):return '<?xml version="1.0" encoding="UTF-16" standalone="no"?>'+E.tostring(root,encoding='unicode')

def paragraph(styles,name,value):
    s=styles[name];p=E.Element('P',Style=s.get('Id'),ParaShape=s.get('ParaShape'))
    t=E.SubElement(p,'TEXT',CharShape=s.get('CharShape'));E.SubElement(t,'CHAR').text=value
    return p

def prune_assets(root):
    used={e.get('BinItem') for e in root.findall('.//IMAGE')}
    listing=root.find('./HEAD/MAPPINGTABLE/BINDATALIST');storage=root.find('./TAIL/BINDATASTORAGE')
    if listing is None:return
    retained=[el for el in listing if el.get('BinData') in used]
    mapping={el.get('BinData'):str(i+1) for i,el in enumerate(retained)}
    if used-set(mapping):raise ValueError('Missing original image asset')
    for el in list(listing):
        old=el.get('BinData')
        if old not in mapping:listing.remove(el)
        else:el.set('BinData',mapping[old])
    listing.set('Count',str(len(listing)))
    if storage is not None:
        for el in list(storage):
            old=el.get('Id')
            if old not in mapping:storage.remove(el)
            else:el.set('Id',mapping[old])
        if 'Count' in storage.attrib:storage.set('Count',str(len(storage)))
    for el in root.findall('.//IMAGE'):el.set('BinItem',mapping[el.get('BinItem')])


def image_signatures(root):
    assets={}
    for data in root.findall('./TAIL/BINDATASTORAGE/BINDATA'):
        blob=base64.b64decode(data.text or '')
        try:
            with Image.open(io.BytesIO(blob)) as im:
                im=im.convert('RGBA');signature=(im.size,hashlib.sha256(im.tobytes()).hexdigest())
        except Exception:
            try:
                raw=zlib.decompress(blob,-15)
                with Image.open(io.BytesIO(raw)) as im:
                    im=im.convert('RGBA');signature=(im.size,hashlib.sha256(im.tobytes()).hexdigest())
            except Exception:signature=('binary',hashlib.sha256(blob).hexdigest())
        assets[data.get('Id')]=signature
    return [assets[im.get('BinItem')] for im in root.findall('./BODY//IMAGE')]


def fragment(path,ref):
    r=xmlroot(path.read_bytes());sections=r.findall('./BODY/SECTION')
    si=int(ref['section']);start=int(ref['start']);end=int(ref['end']);qi=int(ref['question_paragraph'])
    if si<0 or si>=len(sections):raise ValueError('Unknown source section')
    ps=sections[si].findall('P')
    if not 0<=start<=qi<end<=len(ps):raise ValueError('Invalid source span')
    chosen=[deepcopy(p) for p in ps[start:end]]
    if sum(len(p.findall('.//ENDNOTE')) for p in chosen)!=1:raise ValueError('Each selected span must contain one original endnote')
    # Legacy source markers are not question text. Remove only standalone markers
    # in the numbered stem, before computing the preservation checks.
    for p in chosen:
        if p.find('.//ENDNOTE') is not None:
            for c in p.findall('./TEXT/CHAR'):
                if (c.text or '').strip()=='zb':c.getparent().remove(c)
    body=r.find('BODY');body.clear();sec=E.SubElement(body,'SECTION',Id='0')
    for p in chosen:
        for tag in ['SECDEF','COLDEF','HEADER','FOOTER']:
            for ctrl in p.findall('.//'+tag):ctrl.getparent().remove(ctrl)
        p.set('PageBreak','false');p.set('ColumnBreak','false');sec.append(p)
    r.find('HEAD').set('SecCnt','1');prune_assets(r)
    return r

def apply_styles(root):
    styles={s.get('Name'):s for s in root.findall('./HEAD/MAPPINGTABLE/STYLELIST/STYLE')}
    required=['발문(zb 1)','선택지','본문']
    if any(n not in styles for n in required):raise ValueError('Seoro template styles missing')
    para=root.find('./HEAD/MAPPINGTABLE/PARASHAPELIST');char=root.find('./HEAD/MAPPINGTABLE/CHARSHAPELIST');cache={}
    def spaced(p,before,after,line):
        old=p.get('ParaShape');key=(old,before,after,line)
        if key not in cache:
            shape=deepcopy(next(x for x in para if x.get('Id')==old));nid=str(max(int(x.get('Id')) for x in para)+1);shape.set('Id',nid)
            margin=shape.find('PARAMARGIN');margin.set('Prev',str(before));margin.set('Next',str(after));margin.set('LineSpacing',str(line));para.append(shape);cache[key]=nid
        p.set('ParaShape',cache[key])
    # The paragraph style supplies the visible question number. Keep the native
    # endnote link, but hide its duplicate in-text marker; note text keeps its own shapes.
    marker_shape=deepcopy(next(x for x in char if x.get('Id')==styles['발문(zb 1)'].get('CharShape')))
    marker_id=str(max(int(x.get('Id')) for x in char)+1);marker_shape.set('Id',marker_id);marker_shape.set('Height','100');marker_shape.set('TextColor','16777215');char.append(marker_shape)
    number=0;previous_choice=False
    for p in root.findall('./BODY/SECTION/P'):
        plain=''.join(p.xpath('./TEXT/CHAR/text()')).strip()
        if p.find('.//ENDNOTE') is not None:
            number+=1;style=styles['발문(zb 1)'];p.set('Style',style.get('Id'));p.set('ParaShape',style.get('ParaShape'));spaced(p,1800,1500,160)
            stem_shape=next(x for x in para if x.get('Id')==p.get('ParaShape'));stem_shape.set('KeepWithNext','true');stem_shape.set('KeepLines','true')
            for t in p.findall('./TEXT'):
                if t.find('CHAR') is not None:t.set('CharShape',style.get('CharShape'))
            for auto in p.findall('.//ENDNOTE//AUTONUM'):auto.set('Number',str(number))
            for note in list(p.findall('./TEXT/ENDNOTE')):
                note.getparent().remove(note);holder=E.Element('TEXT',CharShape=marker_id);holder.append(note);p.insert(0,holder)
        elif re.match(r'^[①②③④⑤]',plain):
            style=styles['선택지'];p.set('Style',style.get('Id'));p.set('ParaShape',style.get('ParaShape'));spaced(p,0 if previous_choice else 700,200,165)
        elif plain.startswith('※'):
            spaced(p,1200,1400,160)
            for t in p.findall('./TEXT'):
                old=t.get('CharShape');shape=deepcopy(next(x for x in char if x.get('Id')==old));nid=str(max(int(x.get('Id')) for x in char)+1);shape.set('Id',nid);shape.set('Height','1000');char.append(shape);t.set('CharShape',nid)
        if plain:previous_choice=bool(re.match(r'^[①②③④⑤]',plain))
    para.set('Count',str(len(para)));char.set('Count',str(len(char)))
    return number

def verify_original_text(fragments, roundtrip):
    """Check body order and each linked endnote separately after native layout."""
    def text(node):return re.sub(r'\s+','',''.join(''.join(c.itertext()) for c in node.findall('.//CHAR')))
    body=deepcopy(roundtrip.find('BODY'))
    for note in list(body.findall('.//ENDNOTE')):note.getparent().remove(note)
    finaltext=text(body);position=0
    expected_notes=[n for fragment in fragments for n in fragment.findall('./BODY//ENDNOTE')]
    actual_notes=roundtrip.findall('./BODY//ENDNOTE')
    if len(expected_notes)!=len(actual_notes):raise RuntimeError('Original endnote count changed')
    for index,(expected,actual) in enumerate(zip(expected_notes,actual_notes)):
        if text(expected)!=text(actual):raise RuntimeError('Original endnote text changed: question '+str(index+1))
    for index,fragment in enumerate(fragments):
        for paragraph in fragment.findall('./BODY/SECTION/P'):
            original=deepcopy(paragraph)
            for note in list(original.findall('.//ENDNOTE')):note.getparent().remove(note)
            expected=text(original)
            if not expected:continue
            found=finaltext.find(expected,position)
            if found<0:raise RuntimeError('Original paragraph missing or reordered: question '+str(index+1)+'; '+expected[:120])
            position=found+len(expected)


def trim_empty_tail(root):
    """Remove only empty trailing body paragraphs, never notes or other controls."""
    for section in root.findall('./BODY/SECTION'):
        while len(section)>1 and all(e.tag in ('P','TEXT','CHAR') for e in section[-1].iter()) and not ''.join(section[-1].itertext()).strip():
            section.remove(section[-1])


def add_source_label(root,item):
    """Keep the source content intact and label why this existing question was chosen."""
    if not item.get('origin_exam'):return
    table=root.find('./HEAD/MAPPINGTABLE');styles={s.get('Name'):s for s in table.findall('./STYLELIST/STYLE')}
    base=styles['본문'];chars=table.find('CHARSHAPELIST');listing=table.find('STYLELIST')
    shape=deepcopy(next(x for x in chars if x.get('Id')==base.get('CharShape')));cid=str(max(int(x.get('Id')) for x in chars)+1)
    shape.set('Id',cid);shape.set('Height','850');shape.set('TextColor','0')
    for bold in list(shape.findall('BOLD')):shape.remove(bold)
    chars.append(shape);chars.set('Count',str(len(chars)))
    style=deepcopy(base);style.set('Id',str(max(int(x.get('Id')) for x in listing)+1));style.set('Name','복습 연결 안내');style.set('EngName','ReviewSource');style.set('CharShape',cid);listing.append(style);listing.set('Count',str(len(listing)));styles['복습 연결 안내']=style
    label=str(item['origin_exam'])+' · '+str(item.get('origin_num',''))+'번 오답 연계 / 원문: '+str(item.get('source_title',''))+' '+str(item.get('original_number',''))+'번'
    root.find('./BODY/SECTION').insert(0,paragraph(styles,'복습 연결 안내',label))

def main():
    import win32com.client
    p=argparse.ArgumentParser();p.add_argument('job',type=Path);p.add_argument('--bank',type=Path,required=True);p.add_argument('--template',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    job=json.loads(a.job.read_text(encoding='utf-8'));packet=job['packet'];items=packet['items']
    if not items or len(items)>100:raise ValueError('Choose 1–100 reviewed original questions')
    inventory={r['sha256']:r for r in json.loads((a.bank/'inventory.json').read_text(encoding='utf-8'))};fragments=[];checks=[]
    for item in items:
        if not item.get('reviewed') or not item.get('answer') or not item.get('explanation'):raise ValueError('Unreviewed answer or explanation')
        ref=item.get('source_ref') or {};sha=ref.get('sha256','')
        if sha not in inventory:raise ValueError('Original source is not registered locally')
        source=inventory[sha];path=(a.bank/source['group']/source['file']).resolve()
        if not path.is_relative_to(a.bank.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:raise ValueError('Original source hash changed')
        frag=fragment(a.bank/'hml'/(sha+'.hml'),ref);add_source_label(frag,item);fragments.append(frag);checks.append((path,sha))
    template_hash=hashlib.sha256(a.template.read_bytes()).hexdigest()
    a.output.mkdir(parents=True,exist_ok=True);jobid=uuid.uuid4().hex[:12];prefix=a.output/('오답정리-'+jobid)
    h=win32com.client.DispatchEx('HWPFrame.HwpObject')
    try:
        h.XHwpWindows.Item(0).Visible=False
        h.SetMessageBoxMode(0x00020000)
        if a.template.suffix.lower()=='.hml':
            loaded=h.SetTextFile(xmlstring(xmlroot(a.template.read_bytes())),'HWPML2X','')
        else:
            loaded=h.SetTextFile(base64.b64encode(a.template.read_bytes()).decode(),'HWP','')
        if not loaded:raise RuntimeError('Cannot load template')
        root=xmlroot(h.GetTextFile('HWPML2X',''));styles={s.get('Name'):s for s in root.findall('./HEAD/MAPPINGTABLE/STYLELIST/STYLE')}
        first=root.find('./BODY/SECTION/P');first=deepcopy(first)
        for t in list(first):
            if t.tag!='TEXT':first.remove(t);continue
            for element in list(t):
                if element.tag not in ('SECDEF','COLDEF'):t.remove(element)
            if not len(t):first.remove(t)
        for c in first.findall('.//MASTERPAGE//CHAR'):
            if c.text and '한백고' in c.text:c.text='서로국어  '
        body=root.find('BODY');body.clear();sec=E.SubElement(body,'SECTION',Id='0');sec.append(first)
        sec.append(paragraph(styles,'본문',str(packet['title'])))
        sec.append(paragraph(styles,'본문',str(packet.get('student_name',''))))
        for line in str(packet.get('summary','')).splitlines():sec.append(paragraph(styles,'본문',line))
        prune_assets(root)
        h.Clear(1)
        if not h.SetTextFile(xmlstring(root),'HWPML2X',''):raise RuntimeError('Cannot initialize template')
        if len(xmlroot(h.GetTextFile('HWPML2X','')).findall('.//ENDNOTE')):raise RuntimeError('Template example content was not removed')
        for frag in fragments:
            h.MovePos(3,0,0) # document end; native import resolves all style/image references
            h.HAction.Run('BreakPara')
            if not h.SetTextFile(xmlstring(frag),'HWPML2X','insertfile'):raise RuntimeError('Cannot insert original question')
        final=xmlroot(h.GetTextFile('HWPML2X',''));prefix.with_suffix('.intermediate.hml').write_text(xmlstring(final),encoding='utf-8');count=apply_styles(final)
        if count!=len(items):raise RuntimeError(f'Endnote count mismatch after merge: {count}/{len(items)}, total {len(final.findall(".//ENDNOTE"))}')
        trim_empty_tail(final)
        h.Clear(1)
        if not h.SetTextFile(xmlstring(final),'HWPML2X',''):raise RuntimeError('Cannot apply final styles')
        # Native HWP bytes avoid file-open permission prompts; originals never opened by path.
        native=h.GetTextFile('HWP','');prefix.with_suffix('.hwp').write_bytes(base64.b64decode(native))
        for ext,fmt in [('hwpx','HWPX'),('pdf','PDF')]:
            action='FileSaveAsPdf' if fmt=='PDF' else 'FileSaveAs'
            params=h.HParameterSet.HFileOpenSave;h.HAction.GetDefault(action,params.HSet)
            params.filename=str(prefix.with_suffix('.'+ext).resolve());params.Format=fmt
            if not h.HAction.Execute(action,params.HSet):raise RuntimeError('Native '+fmt+' export failed')
        roundtrip=xmlroot(h.GetTextFile('HWPML2X',''));actual=len(roundtrip.findall('.//ENDNOTE'))
        prefix.with_suffix('.roundtrip.hml').write_text(xmlstring(roundtrip),encoding='utf-8')
        if actual!=len(items):raise RuntimeError('Endnotes lost during final save')
        verify_original_text(fragments,roundtrip)
        expected_signatures=[signature for f in fragments for signature in image_signatures(f)]
        actual_signatures=image_signatures(roundtrip)
        if actual_signatures!=expected_signatures:raise RuntimeError('Original image content/order changed during native merge')
        expected_images=sum(len(f.findall('./BODY//IMAGE')) for f in fragments)
        expected_tables=sum(len(f.findall('./BODY//TABLE')) for f in fragments)
        if len(roundtrip.findall('./BODY//IMAGE'))<expected_images or len(roundtrip.findall('./BODY//TABLE'))<expected_tables:raise RuntimeError('Original picture/table lost')
        report={'title':packet['title'],'questions':len(items),'endnotes':actual,'source_images':expected_images,'source_tables':expected_tables,'original_text_preserved':True,'original_hashes_preserved':True,'visual_review_required':True,'files':[prefix.with_suffix('.'+x).name for x in ['hwp','hwpx','pdf']]}
        prefix.with_suffix('.verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False))
    finally:
        try:h.Clear(1);h.Quit()
        except Exception:pass
        assert hashlib.sha256(a.template.read_bytes()).hexdigest()==template_hash
        for path,sha in checks:assert hashlib.sha256(path.read_bytes()).hexdigest()==sha
if __name__=='__main__':main()
