(function () {
  'use strict';
  // One browser entry receives Android/PWA Back; menu history stays in this session.
  var trail = [], restoring = false, startingPage = false, exitTimer;
  function arm() {
    clearTimeout(exitTimer);
    if (!history.state || history.state.kukeoBack !== 'guard') history.pushState({kukeoBack: 'guard'}, '', location.href);
  }
  if (!history.state || history.state.kukeoBack !== 'guard') {
    history.replaceState({kukeoBack: 'base'}, '', location.href);
    arm();
  }
  function page() { return document.querySelector('.page.active'); }
  function panel() { var p = page(); return p && p.querySelector('.panel.active'); }
  function visible(id) {
    var el = document.getElementById(id);
    return el && el.getClientRects().length > 0;
  }
  ['sNav', 'tNav'].forEach(function (name) {
    var original = window[name];
    window[name] = function (next, scope) {
      var p = page(), old = panel();
      var oldScope = typeof studentExamScope === 'undefined' ? undefined : studentExamScope;
      var result = original.apply(this, arguments), current = panel();
      if (!startingPage && !restoring && p && old && current && (old !== current || (next === 'exam' && (scope || null) !== oldScope))) {
        trail.push({page: p.id, nav: name, panel: old.id.slice(6), scope: oldScope});
        if (trail.length > 100) trail.shift();
      }
      startingPage = false; arm();
      return result;
    };
  });
  var originalShowPage = window.showPage;
  window.showPage = function () {
    trail = []; startingPage = true; arm();
    return originalShowPage.apply(this, arguments);
  };
  function backInside() {
    var modals = Array.from(document.querySelectorAll('.modal-bg.show')).filter(function (el) { return el.getClientRects().length; });
    modals.sort(function (a, b) { return (parseInt(getComputedStyle(a).zIndex) || 0) - (parseInt(getComputedStyle(b).zIndex) || 0); });
    if (modals.length) {
      // Use the existing close action so video progress and camera cleanup still run.
      var close = modals[modals.length - 1].querySelector('.modal-close');
      if (close && !close.disabled) close.click();
      return true;
    }
    var menu = document.getElementById('student-menu');
    if (menu && menu.open) { menu.open = false; return true; }
    if (visible('s-exam-loading')) return true;
    if (visible('s-exam-check') || visible('s-exam-result')) {
      if (!visible('s-exam-check') || confirm('답안 입력 화면을 나갈까요? 제출하지 않은 답안은 저장되지 않을 수 있어요.')) sExamBack();
      return true;
    }
    if (visible('vocab-study-view') || visible('vocab-quiz-view') || visible('vocab-result-view')) {
      if (!visible('vocab-quiz-view') || confirm('어휘 풀이를 나갈까요? 제출하지 않은 답안은 저장되지 않아요.')) vocabBackToEntry();
      return true;
    }
    var examViews = [['t-exam-create', 'closeTExamCreate'], ['t-exam-edit', 'closeTExamEdit'], ['t-exam-results', 'closeTExamResults']];
    for (var i = 0; i < examViews.length; i++) {
      if (visible(examViews[i][0])) {
        if (i === 2 || confirm('시험 편집을 나갈까요? 저장하지 않은 변경 내용은 사라져요.')) window[examViews[i][1]]();
        return true;
      }
    }
    var p = page(), previous;
    while ((previous = trail.pop())) {
      if (p && previous.page === p.id) {
        restoring = true;
        try { window[previous.nav](previous.panel, previous.scope); } finally { restoring = false; }
        return true;
      }
    }
    var current = panel();
    if (p && current && p.id === 'page-student' && !padMode && current.id !== 'panel-home') {
      restoring = true;
      try { sNav('home'); } finally { restoring = false; }
      return true;
    }
    if (p && current && p.id === 'page-teacher' && current.id !== 'panel-dashboard') {
      restoring = true;
      try { tNav('dashboard'); } finally { restoring = false; }
      return true;
    }
    return false;
  }
  window.addEventListener('popstate', function (event) {
    if (!event.state || event.state.kukeoBack !== 'base') return;
    if (backInside()) { arm(); return; }
    // At the root, leave the base entry for two seconds: a second native Back
    // can leave even when an installed PWA has no earlier browser entry.
    notify('뒤로가기를 한 번 더 누르면 국어왕을 나가요.', 'info');
    exitTimer = setTimeout(arm, 2000);
  });
})();
