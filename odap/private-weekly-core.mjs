// Shared by the Edge function and synthetic tests. Never use browser scores.
const fail = message => { throw new Error(message); };
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function validatePacket(packet, context, approval = false) {
  if (!packet || packet.schema !== 1 || !text(packet.title, 100) || !Array.isArray(packet.items) || packet.items.length !== 40) fail('객관식 20문항과 OX 20문항이 필요합니다.');
  const ids = new Set(), prompts = new Set(); let mcq = 0, ox = 0, schoolPrint = false, pastExam = false;
  for (const q of packet.items) {
    if (!q || !text(q.id, 80) || !/^[a-zA-Z0-9_-]+$/.test(q.id) || ids.has(q.id)) fail('문항 ID를 확인하세요.');
    ids.add(q.id);
    if (!text(q.text, 5000) || !text(q.explanation, 6000) || (q.passage !== undefined && (typeof q.passage !== 'string' || q.passage.length > 20000))) fail('문항·지문·해설 형식을 확인하세요.');
    if (q.images !== undefined && (!Array.isArray(q.images) || q.images.length > 4 || q.images.some(image => !image || typeof image.data !== 'string' || image.data.length > 1500000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.data) || (image.alt !== undefined && (typeof image.alt !== 'string' || image.alt.length > 200))))) fail('문항 이미지를 확인하세요.');
    const normalized = JSON.stringify([q.type,q.text,q.passage || '',q.choices || [],(q.images || []).map(i => i.data)]).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
    if (prompts.has(normalized)) fail('중복 발문이 있습니다.'); prompts.add(normalized);
    if (q.type === 'mcq') {
      mcq++;
      if (!Array.isArray(q.choices) || q.choices.length !== 5 || q.choices.some(v => !text(v, 3000)) || new Set(q.choices.map(v => v.trim())).size !== 5 || !['string','number'].includes(typeof q.answer) || !/^[1-5]$/.test(String(q.answer))) fail('객관식 선택지와 정답을 확인하세요.');
    } else if (q.type === 'ox') {
      ox++;
      if (!['O', 'X'].includes(q.answer)) fail('OX 정답을 확인하세요.');
    } else fail('지원하지 않는 문항 유형입니다.');
    if (approval) {
      if (q.reviewed !== true || !Array.isArray(q.evidence) || !q.evidence.length || q.evidence.length > 10) fail('모든 문항을 검수하고 출처를 연결하세요.');
      for (const e of q.evidence) {
        if (!e || e.approved !== true || !text(e.source_id, 200) || !text(e.page, 40) || !text(e.quote, 8000)) fail('승인 근거와 원문 페이지가 필요합니다.');
        if ((q.type === 'ox' || ['학교 프린트','학교 기출','내신 기출'].includes(e.kind)) && e.school !== context.school) fail('학교별 승인 근거가 필요합니다.');
        if (q.type === 'ox' && e.kind === '학교 프린트') schoolPrint = true;
        if (q.type === 'ox' && ['학교 기출', '내신 기출'].includes(e.kind) && e.year === Number(context.week_start.slice(0, 4)) - 1) pastExam = true;
      }
    }
  }
  if (mcq !== 20 || ox !== 20) fail('객관식 20문항과 OX 20문항이 필요합니다.');
  if (approval && (!schoolPrint || !pastExam)) fail('학교 프린트와 작년 기출 근거를 모두 확인하세요.');
  return packet;
}
export function studentPacket(packet) {
  return {schema: 1, title: packet.title, items: packet.items.map(q => ({id: q.id, type: q.type, text: q.text, passage: q.passage || '', images: (q.images || []).map(i => ({data:i.data,alt:i.alt || '문항 원문'})), ...(q.type === 'mcq' ? {choices: q.choices.slice()} : {})}))};
}
export function gradePacket(packet, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).length !== 40) fail('40문항의 답을 모두 입력하세요.');
  let correct = 0; const cleaned = {};
  const results = packet.items.map(q => {
    const value = answers[q.id];
    if (!Object.prototype.hasOwnProperty.call(answers, q.id) || (q.type === 'mcq' ? !['string','number'].includes(typeof value) || !/^[1-5]$/.test(String(value)) : !['O', 'X'].includes(value))) fail('문항별 답안 형식을 확인하세요.');
    cleaned[q.id] = String(value); const ok = String(value) === String(q.answer); if (ok) correct++;
    return {id: q.id, correct: ok, answer: String(q.answer), explanation: q.explanation};
  });
  return {answers: cleaned, correct, total: 40, score: correct * 2.5, results};
}
export async function contentHash(content) {
  const bytes = new TextEncoder().encode(JSON.stringify(content));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
}
