// 매주 금요일 12:10(KST)에 GitHub Actions가 실행하는 스크립트.
// "어휘"가 제목에 들어간 인증 항목(cert_items) 중 최근 1주일 내 만든 것을 찾아서,
// 대상 학생(targets) 중 아직 제출(cert_submissions) 안 한 학생을 강사 웹 푸시로 알려줍니다.
const SB_URL = 'https://zniwzwanlvvmzkkcmikh.supabase.co';
const SB_KEY = 'sb_publishable_IbfVcXs5TmXfumrnK4Somg_7MzygCdh';

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

async function sendTeacherPush(text) {
  const res = await fetch(`${SB_URL}/rest/v1/push_queue`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ id: `teacher_cert_${Date.now()}`, title: '⏰ 어휘 테스트 미제출 알림', body: text, target_ids: ['teacher_alerts'] })
  });
  if (!res.ok) {
    throw new Error(`강사 알림 등록 실패: ${res.status} ${await res.text()}`);
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
  await sendTeacherPush(text);
  console.log('알림을 전송했습니다.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
