// 동형모의고사 인증: 월·화 판정, 항목 ID, 인증 기준(대기·승인=인증, 반려=미인증) 확인
const assert=require('node:assert');
const d=require('../dongheong-cert.js');
assert.equal(d.isCertDay('2026-11-23'),true);  // 월
assert.equal(d.isCertDay('2026-11-24'),true);  // 화
assert.equal(d.isCertDay('2026-11-25'),false); // 수
assert.equal(d.isCertDay('2026-11-22'),false); // 일
assert.deepEqual(d.weekDays('2026-11-27'),['2026-11-23','2026-11-24']);
assert.equal(d.mondayOf('2026-11-29'),'2026-11-23');
assert.equal(d.kstDate('2026-11-23T15:30:00Z'),'2026-11-24'); // 서울 00:30
assert.equal(d.itemId('2026-11-23','sc_hanbaek'),'ci_dh_2026-11-23_sc_hanbaek');
const p=JSON.stringify(['https://x/a.jpg#3회']);
assert.equal(d.roundOf(p),3);
assert.equal(d.certified({status:'pending',photo_url:p}),true);
assert.equal(d.certified({status:'approved',photo_url:p}),true);
assert.equal(d.certified({status:'rejected',photo_url:p}),false);
assert.equal(d.certified({status:'pending',photo_url:'[]'}),false);
assert.equal(d.certified(null),false);
console.log('동형 인증 확인 통과');
