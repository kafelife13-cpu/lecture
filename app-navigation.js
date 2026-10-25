(function () {
  'use strict';
  // Native history is the source of truth. Never re-arm from popstate or a timer.
  var restoring=false, startingPage=false, internalBack=false, cancelForward=false;
  var epoch=Date.now()+':'+Math.random(), current;
  function page(){return document.querySelector('.page.active');}
  function panel(){return page()?.querySelector('.panel.active');}
  function visible(id){return !!document.getElementById(id)?.getClientRects().length;}
  function route(kind){var p=page(),v=panel();return {kukeoBack:kind,epoch:epoch,page:p?.id,nav:p?.id==='page-teacher'?'tNav':'sNav',panel:v?.id.slice(6),scope:typeof studentExamScope==='undefined'?null:studentExamScope};}
  function write(state,push){current=state;history[push?'pushState':'replaceState'](state,'',location.href);}
  function root(){return (page()?.id==='page-student'&&!window.padMode&&panel()?.id==='panel-home')||(page()?.id==='page-teacher'&&panel()?.id==='panel-dashboard');}
  function activated(){return navigator.userActivation?.isActive===true;}
  write(route('base'),false);
  ['sNav','tNav'].forEach(function(name){
    var original=window[name];
    window[name]=function(next,scope){
      var before=route('nav'),result=original.apply(this,arguments),after=route('nav');
      if(restoring)return result;
      if(startingPage){startingPage=false;write(route('base'),false);return result;}
      if(before.panel!==after.panel||before.page!==after.page||(next==='exam'&&before.scope!==after.scope)){
        // Replacing an open menu's entry avoids a phantom menu on Back.
        write(after,activated()&&current?.kukeoBack!=='modal');
      }
      return result;
    };
  });
  var show=window.showPage;
  window.showPage=function(){var result=show.apply(this,arguments);epoch=Date.now()+':'+Math.random();startingPage=true;write(route('base'),false);return result;};
  function overlays(){
    var all=Array.from(document.querySelectorAll('.modal-bg.show,dialog[open]')).filter(el=>el.getClientRects().length);
    all.sort((a,b)=>(parseInt(getComputedStyle(a).zIndex)||0)-(parseInt(getComputedStyle(b).zIndex)||0));
    if(all.length)return 'modal:'+all[all.length-1].id;
    if(document.getElementById('student-menu')?.open)return 'menu';
    if(visible('s-exam-loading')||visible('s-exam-check')||visible('s-exam-result'))return 'exam';
    if(visible('vocab-study-view')||visible('vocab-quiz-view')||visible('vocab-result-view'))return 'vocab';
    for(var id of ['t-exam-create','t-exam-edit','t-exam-results'])if(visible(id))return id;
    if(visible('gox-extra')&&document.getElementById('gox-extra').textContent.trim())return 'grammar-history';
    if(visible('s-grammar-ox-body')&&document.querySelector('#s-grammar-ox-body [data-gox="leave"]'))return 'grammar-run';
    return null;
  }
  function closeInside(key){
    if(key.startsWith('modal:')){var el=document.getElementById(key.slice(6)),button=el?.querySelector('.modal-close,[data-homework-close]');if(button&&!button.disabled)button.click();else if(el?.tagName==='DIALOG'){if(el.dispatchEvent(new Event('cancel',{cancelable:true})))el.close();}else return false;return overlays()!==key;}
    if(key==='menu'){document.getElementById('student-menu').open=false;return true;}
    if(key==='exam'){if(visible('s-exam-loading'))return false;if(visible('s-exam-check')&&!confirm('답안 입력 화면을 나갈까요? 제출하지 않은 답안은 저장되지 않을 수 있어요.'))return false;sExamBack();return true;}
    if(key==='vocab'){if(visible('vocab-quiz-view')&&!confirm('어휘 풀이를 나갈까요? 제출하지 않은 답안은 저장되지 않아요.'))return false;vocabBackToEntry();return true;}
    var editor={'t-exam-create':'closeTExamCreate','t-exam-edit':'closeTExamEdit','t-exam-results':'closeTExamResults'};
    if(editor[key]){if(key!=='t-exam-results'&&!confirm('시험 편집을 나갈까요? 저장하지 않은 변경 내용은 사라져요.'))return false;window[editor[key]]();return true;}
    if(key==='grammar-history'){if(window.closeGrammarHistory)window.closeGrammarHistory();else document.getElementById('gox-extra').innerHTML='';return true;}
    if(key==='grammar-run'){document.querySelector('#s-grammar-ox-body [data-gox="leave"]')?.click();return overlays()!=='grammar-run';}
    return true;
  }
  function syncOverlay(){
    if(restoring||internalBack||cancelForward)return;
    var key=overlays();
    if(current?.kukeoBack==='modal'&&key!==current.overlay){
      if(key&&key!==current.parent?.overlay){write(Object.assign({},current,{overlay:key}),false);return;}
      internalBack=true;history.back();return;
    }
    if(key&&current?.overlay!==key&&activated())write(Object.assign(route('modal'),{overlay:key,parent:current}),true);
  }
  function interaction(event){
    if(!event.isTrusted||restoring)return;
    if(current?.kukeoBack==='base'&&root())write(route('guard'),true);
    queueMicrotask(syncOverlay);
  }
  ['pointerdown','keydown','click'].forEach(type=>document.addEventListener(type,interaction,true));
  // Covers dialogs and async answer forms opened by the current user activation.
  new MutationObserver(syncOverlay).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','open','hidden']});
  window.addEventListener('popstate',function(event){
    var previous=current,state=event.state;
    if(cancelForward){cancelForward=false;current=state;return;}
    restoring=true;
    try{
      if(!internalBack&&previous?.kukeoBack==='modal'&&overlays()===previous.overlay&&!closeInside(previous.overlay)){cancelForward=true;history.forward();return;}
      internalBack=false;current=state;
      if(!state||state.epoch!==epoch){write(route('base'),false);return;}
      var target=state.kukeoBack==='modal'?state.parent:state;
      if(target?.page===page()?.id&&target.panel&&(panel()?.id!=='panel-'+target.panel||(target.panel==='exam'&&target.scope!==(typeof studentExamScope==='undefined'?null:studentExamScope))))window[target.nav](target.panel,target.scope);
      if(previous?.kukeoBack==='guard'&&state.kukeoBack==='base')notify('뒤로가기를 한 번 더 누르면 국어왕을 나가요.','info');
    }finally{restoring=false;}
  });
})();
