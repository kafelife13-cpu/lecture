const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const functions = [
  'isObjectiveAnswer', 'examAnswerMatches', 'repIsWrong', 'sHomeworkAllowsWrongOnly',
  'sHomeworkNumbersOnly', 'sHomeworkWrongOnly', 'examQuestionNumber',
  'parseHomeworkWrongNumbers', 'renderSExamListCards', 'sHomeworkApplyWrongNumbers',
  'sExamSubmitScore'
];
const elements = {
  's-homework-wrong-numbers': {value: '46, 48'},
  's-exam-check-err': {}
};
let saved;
const context = vm.createContext({
  document: {getElementById: id => elements[id]},
  renderSExamAnswerGrid() {}, renderWrongDetails() {}, sendStudentActivity() {},
  showSExamView() {}, renderSExamResultView() {}, clinicExplanationNotice: () => '',
  odapSaveResponse: async payload => { saved = payload; return {}; },
  session: {id: 'test'}, sExamCheckMode: 'wrongonly', sWrongChecked: {},
  sExamAnswers: {}, sExamPhotos: {}, sExamThoughts: {}, sExamPriorResponse: null
});
for (const name of functions) {
  const start = source.search(new RegExp('^(?:async )?function ' + name + '\\(', 'm'));
  assert.ok(start >= 0, name);
  const lines = source.slice(start).split(/\r?\n/);
  const end = lines[0].endsWith('}') ? 0 : lines.findIndex(line => line === '}');
  assert.ok(end >= 0, name);
  vm.runInContext(lines.slice(0, end + 1).join('\n'), context);
}

async function check() {
  const exam = {
    id: 'homework', name: '기말대비 3주차 과제', category: 'homework',
    clinic_school: '한백고', clinic_week: '기말대비 3주차', total_q: 3,
    questions: [{num: 46, answer: '3', points: 2}, {num: 47, answer: '4', points: 3},
      {num: 48, answer: 'all:1,4', points: 2}]
  };
  for (const school of ['한백고', '치동고']) {
    for (const week of [1, 2, 3]) {
      assert.equal(context.sHomeworkNumbersOnly({...exam, clinic_school: school, clinic_week: '기말대비 '+week+'주차'}), true);
    }
  }
  assert.equal(context.sHomeworkNumbersOnly({...exam, category: 'school'}), false);
  assert.equal(context.sHomeworkNumbersOnly({...exam, clinic_week: '기말대비 4주차'}), false);
  assert.doesNotMatch(context.renderSExamListCards([exam], {}, ''), /전체 답안 입력/);
  assert.match(context.renderSExamListCards([exam], {}, ''), /오답 번호만 입력/);
  context.sExamData = exam;
  await context.sExamSubmitScore();
  assert.deepEqual({...saved.answers}, {0: '', 2: ''});
  assert.equal(saved.score, 43);
  assert.equal(context.repIsWrong(saved, 0, exam), true);
  assert.equal(context.repIsWrong(saved, 1, exam), false);
  elements['s-homework-wrong-numbers'].value = '1';
  saved = undefined;
  await context.sExamSubmitScore();
  assert.equal(saved, undefined);
  assert.match(elements['s-exam-check-err'].textContent, /46~48/);
  elements['s-homework-wrong-numbers'].value = '';
  await context.sExamSubmitScore();
  assert.equal(saved.score, 100);
  context.sExamData = {...exam, clinic_week: '기말대비 4주차'};
  elements['s-homework-wrong-numbers'].value = '46';
  saved = undefined;
  await context.sExamSubmitScore();
  assert.equal(saved, undefined);
  assert.match(elements['s-exam-check-err'].textContent, /선택한 답/);
}

check().catch(error => { console.error(error); process.exitCode = 1; });
