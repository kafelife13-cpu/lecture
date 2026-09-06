const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../app-navigation.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
assert.equal((html.match(/<script src="app-navigation.js\?v=1"><\/script>/g) || []).length, 1);
let activePage = 'page-student', activePanel = 'home', modals = [], shown = new Set(), accepted = false;
const panels = new Map(), timers = new Map(), calls = [];
let timerId = 0, listener, entries = [{}], index = 0, exited = false;
function currentPanel() {
  const key = activePage + activePanel;
  if (!panels.has(key)) panels.set(key, {id: 'panel-' + activePanel});
  return panels.get(key);
}
const menu = {open: false};
const c = {
  location: {href: 'https://example.test/lecture/'}, padMode: false, studentExamScope: null,
  history: {
    get state() { return entries[index]; },
    replaceState(s) { entries[index] = s; },
    pushState(s) { entries = entries.slice(0, index + 1); entries.push(s); index++; }
  },
  document: {
    querySelector() { return {id: activePage, querySelector: currentPanel}; },
    querySelectorAll() { return modals; },
    getElementById(id) { return id === 'student-menu' ? menu : {getClientRects: () => shown.has(id) ? [1] : []}; }
  },
  getComputedStyle: el => ({zIndex: el.z}),
  setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
  addEventListener(type, fn) { if (type === 'popstate') listener = fn; },
  confirm: () => accepted, notify: msg => calls.push(msg),
  sNav(next, scope) { activePanel = next; if (next === 'exam') c.studentExamScope = scope || null; },
  tNav(next) { activePanel = next; }, showPage(id) { activePage = id; },
  sExamBack() { calls.push('exam cleanup'); shown.clear(); },
  vocabBackToEntry() { calls.push('vocab cleanup'); shown.clear(); },
  closeTExamCreate() { shown.clear(); }, closeTExamEdit() { shown.clear(); }, closeTExamResults() { shown.clear(); }
};
c.window = c; vm.createContext(c); vm.runInContext(code, c);
function back() { if (index === 0) { exited = true; return; } index--; listener({state: entries[index]}); }
c.sNav('weekly'); c.sNav('vocab'); c.sNav('vocab');
back(); assert.equal(activePanel, 'weekly'); assert.equal(exited, false);
back(); assert.equal(activePanel, 'home');
c.sNav('exam', 'homework'); c.sNav('exam', 'clinic');
back(); assert.equal(c.studentExamScope, 'homework');
shown.add('s-exam-check'); back(); assert.equal(shown.has('s-exam-check'), true, 'cancel preserves answers');
accepted = true; back(); assert.ok(calls.includes('exam cleanup'));
const modal = {z: 100, getClientRects: () => [1], querySelector: () => ({click() { calls.push('video cleanup'); modals = []; }})};
modals = [modal]; back(); assert.equal(calls.at(-1), 'video cleanup'); assert.equal(activePanel, 'exam');
menu.open = true; back(); assert.equal(menu.open, false); assert.equal(activePanel, 'exam');
back(); assert.equal(activePanel, 'home');
back(); assert.equal(exited, false); assert.equal(index, 0);
for (const fn of [...timers.values()]) fn();
assert.equal(index, 1, 'root exit window expires');
back(); c.sNav('weekly'); assert.equal(index, 1, 'navigation cancels pending exit');
back(); assert.equal(activePanel, 'home'); back(); back(); assert.equal(exited, true, 'second native back can exit without an earlier document');
exited = false;
c.showPage('page-login'); c.showPage('page-teacher'); c.tNav('dashboard'); c.tNav('students');
back(); assert.equal(activePanel, 'dashboard'); back(); assert.equal(activePage, 'page-teacher', 'old session history cannot restore student screen');
console.log('PASS: menu history, exam scopes, draft cancellation, modal cleanup, root exit, session reset, inline script syntax');
