// 5분마다 GitHub Actions가 실행: push_queue 테이블에서 아직 안 보낸(sent_at이 빈) 요청을
// 찾아 web-push로 학생들 브라우저에 실제 알림을 보냅니다.
//
// Supabase 주소/anon 키는 index.html에도 이미 공개로 들어있는 값이라 그대로 씁니다.
// 다만 VAPID_PRIVATE_KEY는 유출되면 다른 사람이 우리 구독자들에게 임의로 알림을 보낼 수
// 있어서, 코드에 넣지 않고 GitHub 저장소 Secrets에서 환경변수로 주입받습니다.
import webpush from 'web-push';

const SB_URL = 'https://zniwzwanlvvmzkkcmikh.supabase.co';
const SB_KEY = 'sb_publishable_IbfVcXs5TmXfumrnK4Somg_7MzygCdh';
const VAPID_PUBLIC_KEY = 'BHZrIyaqw7HLsBN17c_VMQUI4T84fkL0gWaJEduzvtgvLuFuSSDbJlE7M5I5PyI7bZPChBBrMqSvXk0PLCJvKqI';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

async function sbQuery(table, params) {
  const url = new URL(`${SB_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!res.ok) throw new Error(`Supabase 조회 실패 (${table}): ${res.status} ${await res.text()}`);
  return res.json();
}
async function sbPatch(table, filter, body) {
  const url = new URL(`${SB_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(filter)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Supabase 갱신 실패 (${table}): ${res.status} ${await res.text()}`);
}
async function sbDelete(table, filter) {
  const url = new URL(`${SB_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(filter)) url.searchParams.set(k, v);
  const res = await fetch(url, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!res.ok) console.error(`Supabase 삭제 실패 (${table}): ${res.status}`);
}

async function main() {
  if (!VAPID_PRIVATE_KEY) {
    console.error('VAPID_PRIVATE_KEY 시크릿이 설정되어 있지 않습니다. (저장소 Settings → Secrets and variables → Actions)');
    process.exit(1);
  }
  webpush.setVapidDetails('mailto:kafelife13@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const pending = await sbQuery('push_queue', { select: '*', sent_at: 'is.null', order: 'created_at.asc' });
  if (!pending.length) {
    console.log('보낼 알림이 없습니다.');
    return;
  }

  for (const job of pending) {
    let subs;
    if (job.target_ids && job.target_ids.length) {
      const idsList = job.target_ids.map(id => `"${id}"`).join(',');
      subs = await sbQuery('push_subscriptions', { select: '*', student_id: `in.(${idsList})` });
    } else {
      subs = await sbQuery('push_subscriptions', { select: '*' });
    }

    let ok = 0, fail = 0;
    for (const sub of subs) {
      const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      try {
        await webpush.sendNotification(pushSub, JSON.stringify({ title: job.title, body: job.body }));
        ok++;
      } catch (e) {
        fail++;
        if (e.statusCode === 410 || e.statusCode === 404) {
          // 구독이 만료됐거나 브라우저에서 지워진 경우 — DB에서도 정리
          await sbDelete('push_subscriptions', { id: `eq.${sub.id}` });
        } else {
          console.error(`전송 실패 (${sub.id}):`, e.message);
        }
      }
    }
    await sbPatch('push_queue', { id: `eq.${job.id}` }, { sent_at: new Date().toISOString() });
    console.log(`[${job.title}] 전송 완료 — 성공 ${ok}건, 실패 ${fail}건 (대상 ${subs.length}명)`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
