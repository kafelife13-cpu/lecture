const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const helper=source.slice(source.indexOf('function qaWeekNumber('),source.indexOf('function renderTQaWeekList('));
const {group,number}=new Function(helper+'return {group:qaGroupedWeeksHtml,number:qaWeekNumber};')();
assert.equal(number({name:'내신 2주차 과제 (1) 25문항'}),2);
const html=group([{name:'내신대비 1주차',created_at:'2026-08-31'},{name:'내신 2주차 (1)'},{name:'8월 3주차'},{name:'중세 문법',created_at:'2026-08-23'}],w=>w.name);
assert.ok(html.indexOf('2주</h3>')<html.indexOf('1주</h3>'));
assert.ok(html.includes('지난달 보기 · 8월 (2)'));
assert.ok(!html.includes('<details open'));
assert.ok(html.indexOf('8월 3주차')>html.indexOf('<details'));
console.log('QnA grouping checks passed');
const mixed=group([
  {name:'내신 6주차 과제'},
  {name:'기말대비 1주차 기본·심화'},
  {name:'기말대비 2주차 문법요소 추가'},
  {name:'기말대비 3주차 현대시'},
  {name:'기말대비 3주차 사동·피동'},
  {name:'기말대비 3주차 클리닉'}
],w=>'<article>'+w.name+'</article>');
const visible=mixed.split('<details')[0];
for(const title of ['1주차 기본·심화','2주차 문법요소 추가','3주차 현대시','3주차 사동·피동','3주차 클리닉'])assert.ok(visible.includes(title));
assert.ok(!visible.includes('내신 6주차'));
assert.ok(visible.indexOf('기말대비 3주차</h3>')<visible.indexOf('기말대비 2주차</h3>'));
assert.ok(visible.indexOf('기말대비 2주차</h3>')<visible.indexOf('기말대비 1주차</h3>'));
assert.ok(mixed.includes('중간대비·이전 자료 보기'));
assert.equal(group([],w=>w.name),'');
assert.ok(!group([{name:'기말대비 1주차'}],w=>w.name).includes('<details'));
console.log('Final-cycle QnA visibility checks passed');
