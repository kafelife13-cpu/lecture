"""Private Windows rendering worker. Credentials are prompted, never saved."""
import argparse, getpass, json, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CFG = json.loads((ROOT / 'config.json').read_text(encoding='utf-8'))

class Client:
    def __init__(self, user, password):
        self.credentials = dict(id=user, pw=password, role='teacher')

    def request(self, path, body):
        req = urllib.request.Request(CFG['supabase_url'] + path,
            json.dumps(body, ensure_ascii=False).encode(),
            {'apikey': CFG['supabase_public_key'], 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=90) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            try:
                error = json.load(exc)
                raise RuntimeError(error.get('message') or error.get('error') or '서버 작업 실패') from None
            except (ValueError, TypeError):
                raise RuntimeError('서버 작업 실패: ' + str(exc.code)) from None

    def rpc(self, action, payload=None):
        c = self.credentials
        return self.request('/rest/v1/rpc/odap_rpc', dict(p_id=c['id'], p_password=c['pw'],
            p_role=c['role'], p_action=action, p_payload=payload or {}))

    def upload(self, path, packet_id=None):
        path = Path(path)
        signed = self.request('/functions/v1/odap-assets', dict(credentials=self.credentials,
            action='prepare_upload', filename=path.name, bytes=path.stat().st_size,
            kind='packet' if packet_id else 'source', packet_id=packet_id))
        req = urllib.request.Request(signed['url'], path.read_bytes(),
            {'Content-Type': 'application/octet-stream'}, method='PUT')
        with urllib.request.urlopen(req, timeout=180) as response:
            response.read()
        return signed['path']

def render(client, job):
    dest = (ROOT / CFG['data_dir']).resolve() / 'cloud-jobs' / job['id']
    dest.mkdir(parents=True, exist_ok=True)
    source = dest / 'job.json'
    source.write_text(json.dumps({'packet': job['packet']}, ensure_ascii=False), encoding='utf-8')
    command = [sys.executable, str(ROOT / 'scripts' / ('build-record-draft.py' if job['packet'].get('mode')=='record_draft' else 'build-review-hangul.py')),str(source),'--template',str((ROOT / CFG['template']).resolve()),'--output',str(dest)]
    if job['packet'].get('mode')!='record_draft':command.extend(['--bank',str((ROOT / CFG['legacy_bank']).resolve())])
    logs = []
    for attempt in range(2):
        result = subprocess.run(command,
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300)
        logs.append('Attempt ' + str(attempt + 1) + '\n' + result.stdout + '\n' + result.stderr)
        (dest / 'build.log').write_text('\n'.join(logs), encoding='utf-8')
        if not result.returncode:
            break
        # Restart only a disconnected Hancom automation process; never retry failed
        # source/layout validation, and never publish files from the failed attempt.
        disconnected = 'pywintypes.com_error' in result.stderr and any(
            code in result.stderr for code in ('-2147023170', '-2147023174', '-2147417848'))
        if attempt == 0 and disconnected:
            continue
        raise RuntimeError('한글 제작 실패: 제작 PC의 원문·기준 양식·한글 실행 상태를 확인하세요.')
    report = json.loads(result.stdout.strip().splitlines()[-1])
    files = []
    for name in report['files']:
        path = (dest / name).resolve()
        if path.parent != dest.resolve() or path.suffix.lower() not in ('.hwp', '.hwpx', '.pdf'):
            raise RuntimeError('제작 결과 파일 경로 오류')
        files.append(dict(name=path.name, kind=path.suffix[1:], path=client.upload(path, job['packet_id'])))
    client.rpc('worker_finish', dict(id=job['id'], lease=job['lease'], files=files))

def main():
    parser = argparse.ArgumentParser(description='온라인 한글 제작 연결')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    client = Client(input('기존 김까까 교사 아이디: ').strip(), getpass.getpass('비밀번호 (저장하지 않음): '))
    client.rpc('profile')
    print('제작 연결 중입니다. 종료하려면 Ctrl+C를 누르세요.')
    while True:
        job = client.rpc('worker_claim')
        if job:
            try:
                render(client, job)
                print('한글·PDF 제작 완료. 교사 확인 대기 중입니다.')
            except Exception as exc:
                client.rpc('worker_finish', dict(id=job['id'], lease=job['lease'], error=str(exc)[:300]))
                print('제작하지 못했습니다. 온라인 자료의 상태를 확인하세요.')
        if args.once:
            break
        time.sleep(15)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\n제작 연결을 종료했습니다.')
