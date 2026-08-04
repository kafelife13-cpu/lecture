// 매주 금요일 12:10(KST)에 GitHub Actions가 실행하는 스크립트.
// "어휘"가 제목에 들어간 인증 항목(cert_items) 중 최근 1주일 내 만든 것을 찾아서,
// 대상 학생(targets) 중 아직 제출(cert_submissions) 안 한 학생을 텔레그램으로 알려줍니다.
//
// index.html에 이미 공개로 노출되어 있는 값과 동일한 값을 그대로 사용합니다
// (anon/publishable key와 텔레그램 봇 토큰은 클라이언트 코드에도 이미 그대로 들어있어,
//  여기서 추가로 감춘다고 보안이 더 좋아지지 않습니다).
const SB_URL = 'https://zniwzwanlvvmzkkcmikh.supabase.co';
const SB_KEY = 'sb_publishable_IbfVcXs5TmXfumrnK4Somg_7MzygCdh';
const TG_BOT_TOKEN = '8934694780:AAH4Bdx-Zo013w7O4lWo1xs2X5COTE5TTUE';
const TG_CHAT_ID = '8735127250';

// 알림 대상으로 찾을 인증 항목 제목 키워드 (필요하면 여기만 바꾸면 됩니다)
const TITLE_KEYWORD = '어휘';

async function sbQuery(table, params) {
  const url = new URL(`${SB_URL}/rest/v1/${table}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  });
  if (!res.ok) {
    throw new Error(`Supabase 조회 실패 (${table}): ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text })
  });
  if (!res.ok) {
    throw new Error(`텔레그램 전송 실패: ${res.status} ${await res.text()}`);
  }
}

function parseTargets(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function main() {
  const since = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();

  const [items, users, schools] = await Promise.all([
    sbQuery('cert_items', {
      select: '*',
      title: `ilike.*${TITLE_KEYWORD}*`,
      created_at: `gte.${since}`,
      order: 'created_at.desc'
    }),
    sbQuery('users', { select: 'id,name' }),
    sbQuery('qa_schools', { select: 'id,name' })
  ]);

  if (!items.length) {
    console.log(`'${TITLE_KEYWORD}'가 제목에 들어간 최근 1주일 내 인증 항목이 없어서 알림을 보내지 않았습니다.`);
    return;
  }

  const userMap = Object.fromEntries(users.map(u => [u.id, u.name]));
  const schoolMap = Object.fromEntries(schools.map(s => [s.id, s.name]));

  const itemIds = items.map(i => i.id).join(',');
  const subs = await sbQuery('cert_submissions', {
    select: 'item_id,student_id',
    item_id: `in.(${itemIds})`
  });

  const submittedByItem = {};
  for (const s of subs) {
    if (!submittedByItem[s.item_id]) submittedByItem[s.item_id] = new Set();
    submittedByItem[s.item_id].add(s.student_id);
  }

  const blocks = [];
  for (const item of items) {
    const targets = parseTargets(item.targets);
    const submitted = submittedByItem[item.id] || new Set();
    const missing = targets.filter(id => !submitted.has(id));
    if (!missing.length) continue;
    const names = missing.map(id => userMap[id] || id);
    const schoolName = schoolMap[item.school_id] || '';
    blocks.push(`📌 [${schoolName}] ${item.title} — 미제출 ${missing.length}명\n${names.join(', ')}`);
  }

  if (!blocks.length) {
    console.log('대상 학생 전원 제출 완료 — 알림을 보내지 않았습니다.');
    return;
  }

  const text = `⏰ 금요일 12시 기준 어휘 테스트 미제출자\n\n${blocks.join('\n\n')}`;
  await sendTelegram(text);
  console.log('알림을 전송했습니다.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
