(function(root){
 'use strict';
 const DAY=86400000;
 const dayKey=(now=Date.now())=>new Date(now+9*3600000).toISOString().slice(0,10);
 function levelFor(q){if(q.level)return q.level;if(/수능|모의평가|모평|이감|상상|더프|한수|본바탕/.test(q.src||''))return 4;return ({'하':1,'개념':1,'중':2,'적용':2,'상':3,'비교':3})[q.difficulty]||2;}
 function nextLevel(history){const h=history.filter(d=>d.completed_at).slice().sort((a,b)=>a.day.localeCompare(b.day));if(!h.length)return 1;const last=h.at(-1),level=last.level,same=[];for(let i=h.length-1;i>=0&&h[i].level===level;i--)same.unshift(h[i]);const prev=same.at(-2);if(prev&&Date.parse(last.day)-Date.parse(prev.day)===DAY&&last.correct/last.total<.5&&prev.correct/prev.total<.5)return Math.max(1,level-1);const recent=same.slice(-3),total=recent.reduce((n,d)=>n+d.total,0),correct=recent.reduce((n,d)=>n+d.correct,0);return level<4&&same.length>=[0,5,7,10][level]&&total>=30&&correct/total>=.8?level+1:level;}
 function streak(history,today=dayKey()){const done=new Set(history.filter(d=>d.completed_at).map(d=>d.day));let at=Date.parse(today),n=0;if(!done.has(today))at-=DAY;while(done.has(new Date(at).toISOString().slice(0,10))){n++;at-=DAY;}return n;}
 function summary(history,today=dayKey()){const current=history.find(d=>d.day===today),past=history.filter(d=>d.day<today),seven=Date.parse(today)-6*DAY;return {level:current?.level||nextLevel(past),next:nextLevel(history),streak:streak(history,today),completed:!!current?.completed_at,week:history.filter(d=>d.completed_at&&Date.parse(d.day)>=seven).length};}
 const api={dayKey,levelFor,nextLevel,streak,summary};if(typeof module!=='undefined')module.exports=api;root.GrammarDaily=api;
})(typeof window==='undefined'?globalThis:window);
