// 영상 권한을 연 지 3일이 지났지만 100% 시청하지 않은 학생에게
// 학생·학부모 문자를 한 번만 보낸다. GitHub Actions가 매시간 실행한다.
const SB_URL = 'https://zniwzwanlvvmzkkcmikh.supabase.co';
const SB_KEY = 'sb_publishable_IbfVcXs5TmXfumrnK4Somg_7MzygCdh';
const SEND_PIN = process.env.SOLAPI_SEND_PIN;
const START_AT = new Date('2026-08-31T00:00:00+09:00');
const DAY = 24 * 60 * 60 * 1000;

async function sbQuery(table, params) {
  const url = new URL(`${SB_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  if (!response.ok) throw new Error(`${table} 조회 실패: ${response.status} ${await response.text()}`);
  return response.json();
}

async function sbInsert(table, body) {
  const response = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${table} 저장 실패: ${response.status} ${await response.text()}`);
}

async function sbUpsert(table, body, conflict) {
  const url = new URL(`${SB_URL}/rest/v1/${table}`);
  url.searchParams.set('on_conflict', conflict);
  const response = await fetch(url, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${table} 갱신 실패: ${response.status} ${await response.text()}`);
}

function phone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^01\d{8,9}$/.test(digits) ? digits : '';
}

function uniqueRecipients(user) {
  return [...new Set([phone(user.student_phone), phone(user.parent_phone)].filter(Boolean))];
}

function accessIsDue(access, now) {
  const grantedAt = new Date(access.granted_at);
  const expiryAt = access.expires_at ? new Date(access.expires_at) : new Date(grantedAt.getTime() + 8 * DAY);
  return now.getTime() - grantedAt.getTime() >= 3 * DAY && expiryAt > now;
}

async function sendSolapi(messages) {
  const response = await fetch(`${SB_URL}/functions/v1/send-solapi`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sendPin: SEND_PIN, messages })
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || `솔라피 발송 실패 (${response.status})`);
  return result;
}

async function main() {
  if (!SEND_PIN) throw new Error('GitHub Actions의 SOLAPI_SEND_PIN 시크릿이 필요합니다.');
  const now = new Date();
  const [accesses, reminders, users, videos, progress] = await Promise.all([
    sbQuery('video_access', { select: '*', granted_at: `gte.${START_AT.toISOString()}` }),
    sbQuery('video_watch_reminders', { select: 'access_id,status' }),
    sbQuery('users', { select: 'id,name,status,student_phone,parent_phone', role: 'eq.student', status: 'eq.active' }),
    sbQuery('videos', { select: 'id,title' }),
    sbQuery('progress', { select: 'student_id,video_id,percent' })
  ]);
  const done = new Set(reminders.filter(row => row.status === 'sent' || row.status === 'skipped').map(row => row.access_id));
  const userMap = new Map(users.map(row => [row.id, row]));
  const videoMap = new Map(videos.map(row => [row.id, row]));
  const pctMap = new Map(progress.map(row => [`${row.student_id}|${row.video_id}`, Number(row.percent) || 0]));
  let sent = 0, skipped = 0;

  for (const access of accesses) {
    if (!accessIsDue(access, now) || done.has(access.id) || pctMap.get(`${access.student_id}|${access.video_id}`) >= 100) continue;
    const user = userMap.get(access.student_id);
    const video = videoMap.get(access.video_id);
    if (!user || !video) continue;
    const recipients = uniqueRecipients(user);
    const reminderId = `vwr_${access.id}`;
    const dueAt = new Date(new Date(access.granted_at).getTime() + 3 * DAY).toISOString();
    if (!recipients.length) {
      await sbUpsert('video_watch_reminders', { id: reminderId, access_id: access.id, student_id: user.id, video_id: video.id, due_at: dueAt, status: 'skipped', error_message: '저장된 학생·학부모 연락처 없음' }, 'access_id');
      skipped++;
      continue;
    }
    const text = `[국어왕 김까까] ${user.name} 학생의 "${video.title}" 영상 시청 권한이 열린 지 3일이 지났지만 아직 시청이 완료되지 않았습니다. 권한은 부여 후 8일간 유지되니 기간 안에 시청을 완료해 주세요.`;
    try {
      const result = await sendSolapi(recipients.map(to => ({ to, text })));
      const reference = result?.result?.groupId || result?.result?.groupInfo?.groupId || null;
      await sbUpsert('video_watch_reminders', { id: reminderId, access_id: access.id, student_id: user.id, video_id: video.id, due_at: dueAt, status: 'sent', recipient_count: recipients.length, provider_reference: reference, error_message: null, sent_at: new Date().toISOString() }, 'access_id');
      await sbInsert('message_send_logs', recipients.map(to => ({ exam_name: `영상 미시청 안내 · ${video.title}`, student_id: user.id, student_name: user.name, recipient_last4: to.slice(-4), provider: 'solapi', status: 'requested', provider_reference: reference })));
      sent += recipients.length;
    } catch (error) {
      await sbUpsert('video_watch_reminders', { id: reminderId, access_id: access.id, student_id: user.id, video_id: video.id, due_at: dueAt, status: 'failed', error_message: String(error.message || error).slice(0, 500) }, 'access_id');
      console.error(`${user.name} 발송 실패:`, error.message || error);
    }
  }
  console.log(`영상 미시청 문자 처리 완료 — 발송 ${sent}건, 연락처 없음 ${skipped}명`);
}

if (process.env.VIDEO_REMINDER_SELF_TEST === '1') {
  const now = new Date('2026-09-04T00:00:00+09:00');
  if (!accessIsDue({ granted_at: '2026-09-01T00:00:00+09:00' }, now)) throw new Error('3일 경계 검사 실패');
  if (accessIsDue({ granted_at: '2026-09-02T00:00:01+09:00' }, now)) throw new Error('3일 이전 검사 실패');
  if (uniqueRecipients({ student_phone: '010-1234-5678', parent_phone: '01012345678' }).length !== 1) throw new Error('중복 번호 제거 검사 실패');
  console.log('영상 미시청 알림 self-test 통과');
} else {
  main().catch(error => { console.error(error); process.exit(1); });
}

