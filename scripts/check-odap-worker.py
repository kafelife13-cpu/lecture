"""Worker retries only a disconnected Hancom process; failed files never upload."""
import ast,json,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
source=Path(__file__).resolve().parents[1]/'tools/odap/cloud/desktop-worker.py'
node=next(n for n in ast.parse(source.read_text(encoding='utf-8')).body if isinstance(n,ast.FunctionDef) and n.name=='render')
class Client:
 def __init__(self):self.uploads=[];self.finished=[]
 def upload(self,path,packet):self.uploads.append(path.name);return 'private/'+path.name
 def rpc(self,action,payload):self.finished.append((action,payload))
with tempfile.TemporaryDirectory() as td:
 root=Path(td);calls=[];client=Client();failure='pywintypes.com_error: (-2147023170, disconnected)'
 def run(command,**kwargs):
  calls.append(command)
  if len(calls)==1:return SimpleNamespace(returncode=1,stdout='',stderr=failure)
  dest=root/'data/cloud-jobs/test';names=['fresh.hwp','fresh.hwpx','fresh.pdf']
  for n in names:(dest/n).write_bytes(b'valid document')
  return SimpleNamespace(returncode=0,stdout=json.dumps({'files':names}),stderr='')
 ns={'ROOT':root,'CFG':{'data_dir':'data','template':'template.hml','legacy_bank':'bank'},'json':json,'sys':sys,'subprocess':SimpleNamespace(run=run)}
 exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),ns)
 job={'id':'test','packet_id':'packet','lease':'lease','packet':{'mode':'record_draft'}}
 ns['render'](client,job);assert len(calls)==2 and len(client.uploads)==3 and len(client.finished)==1
 calls.clear();client=Client();failure='RuntimeError: original image validation failed'
 try:ns['render'](client,job);raise AssertionError('must fail')
 except RuntimeError:pass
 assert len(calls)==1 and not client.uploads and not client.finished
print('PASS: fresh-process retry for disconnected Hancom only; no failed-file upload')
