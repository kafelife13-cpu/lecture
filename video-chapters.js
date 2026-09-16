/* ponytail: These two reviewed lessons need only a video-ID catalogue.
   Add a teacher chapter editor when teachers need to maintain more lessons. */
(function(root){
  'use strict';
  // Seconds refer to the uploaded videos; cue just before each explanation.
  const catalogue={
    Mml3RyA1TwU:[
      ['1번',0],['2번',252],['3번',346],['4번',484],['5번',687],
      ['6번',935],['7번',1000],['8번',1267],['9번',1752],['10번',1844],
      ['11번',2001],['12번',2245],['13번',2343],['14번',2652],['15번',2725],
      ['16번',2815],['17번',2939],['18번',3327],['19번',3596],['20번',3983],
      ['21번',4255],['22번',4409],['23번',4647],['24번',4768],['25번',5178],
      ['26번',5215],['27번',5302],['28번',5347],['29번',5451],['30번',5474]
    ],
    sJsIw7F6r_w:[
      ['작품 설명',0],['1번',960],['2번',1000],['3번',1150],['4번',1640],
      ['5번',1995],['6번',2270],['7번',2495],['8번',2730]
    ],
    '8TwCCPBPyrA':[
      ['9번',0],['10·11번 지문',110],['10번',275],['11번',335],['12번',485],
      ['13번',590],['14번',925],['15번',1115],['16번',1205],['17번',1510],
      ['18번',1825],['19번',1880],['20번',1900],['21번',2005],['22번',2255],
      ['23번',2405],['24번',2500],['25번',2600],['26번',2765]
    ]
  };
  function get(videoId){
    const rows=Object.prototype.hasOwnProperty.call(catalogue,videoId)?catalogue[videoId]:[];
    return rows.map(function(row){return {label:row[0],seconds:row[1]};});
  }
  function render(container,videoId,onSeek){
    container.replaceChildren();
    const chapters=get(videoId);
    container.hidden=!chapters.length;
    if(!chapters.length)return;
    const title=document.createElement('strong');
    title.textContent='문제 번호로 찾아보기';
    const help=document.createElement('p');
    help.textContent='번호를 누르면 해당 풀이 직전으로 이동해요. 지문 설명은 따로 볼 수 있어요.';
    help.style.cssText='font-size:12px;color:var(--text2);margin:6px 0 10px;line-height:1.5';
    const list=document.createElement('div');
    list.style.cssText='display:flex;flex-wrap:wrap;gap:8px';
    const status=document.createElement('p');
    status.setAttribute('role','status');
    status.style.cssText='font-size:12px;color:var(--text2);margin:8px 0 0';
    chapters.forEach(function(chapter){
      const button=document.createElement('button');
      const time=Math.floor(chapter.seconds/60)+':'+String(chapter.seconds%60).padStart(2,'0');
      button.type='button';
      button.className='btn';
      button.style.cssText='min-height:44px;min-width:64px';
      button.textContent=chapter.label+' · '+time;
      button.setAttribute('aria-label',chapter.label+' 풀이 '+time+'부터 보기');
      button.addEventListener('click',function(){
        if(onSeek(chapter.seconds)===false)return;
        status.textContent=chapter.label+' 풀이로 이동했어요 ('+time+').';
      });
      list.appendChild(button);
    });
    container.append(title,help,list,status);
  }
  function restore(record,videoId){
    if(!record||record.youtubeId!==videoId||!Array.isArray(record.seconds))return new Set();
    return new Set(record.seconds.filter(function(s){return Number.isInteger(s)&&s>=0&&s<86400;}));
  }
  function observe(set,previous,current,duration){
    if(!Number.isFinite(previous)||previous<0||!Number.isFinite(current)||current<=previous||current-previous>3)return;
    // Only elapsed, continuously played seconds count; landing on a cue does not.
    for(let second=Math.floor(previous);second<Math.min(Math.floor(current),Math.floor(duration));second++)set.add(second);
  }
  function stats(videoId,record,duration){
    const watched=restore(record,videoId),chapters=get(videoId);
    return chapters.map(function(chapter,i){
      const end=i+1<chapters.length?chapters[i+1].seconds:Math.floor(duration);
      let count=0;watched.forEach(function(s){if(s>=chapter.seconds&&s<end)count++;});
      const percent=end>chapter.seconds?Math.min(100,Math.floor(count/(end-chapter.seconds)*100)):0;
      return {label:chapter.label,percent:percent,status:percent>=95?'완료':count?'일부 시청':'기록 없음'};
    });
  }
  function summary(videoId,record,duration){
    const rows=stats(videoId,record,duration).filter(function(row){return /^\d+번$/.test(row.label);});
    if(!rows.length)return '';
    return ['완료','일부 시청','기록 없음'].map(function(status){
      const selected=rows.filter(function(row){return row.status===status;});
      return status+': '+(selected.length?selected.map(function(row){return row.label+(status==='일부 시청'?' ('+row.percent+'%)':'');}).join(', '):'없음');
    }).join(' / ');
  }
  function duration(videoId){return videoId==='Mml3RyA1TwU'?5635:videoId==='sJsIw7F6r_w'?2928:videoId==='8TwCCPBPyrA'?2839:0;}
  root.KkakkaVideoChapters={get:get,render:render,restore:restore,observe:observe,stats:stats,summary:summary,duration:duration};
})(typeof window==='undefined'?globalThis:window);
