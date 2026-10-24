/* Presentation components only. Detection, tracking, playback, and persistence stay in app.js. */
const UI_ICONS = {
  webcam:'M3 5h18v14H3z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M7 2h10',
  live:'M3 5h18v13H3z M8 22h8 M12 18v4 M10 9l5 3-5 3z',
  overview:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  alerts:'M12 3 2 21h20L12 3z M12 9v5 M12 17h.01',
  people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.9',
  cams:'M3 7h12v11H3z M15 10l6-3v11l-6-3 M7 4h4',
  inc:'M8 4H4v17h16V4h-4 M8 2h8v5H8z M8 11h8 M8 15h5',
  evid:'M4 3h12l4 4v14H4z M14 3v5h6 M8 12h8 M8 16h5',
  ana:'M3 3v18h18 M7 16v-5 M12 16V7 M17 16V4',
  cyber:'M4 4h16v16H4z M9 4v16 M15 4v16 M4 9h16 M4 15h16',
  health:'M3 12h4l3-8 4 16 3-8h4',
  set:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  play:'M7 4l14 8-14 8z', pause:'M7 4v16 M17 4v16', restart:'M3 10a9 9 0 1 1 1 8 M3 3v7h7',
  sound:'M11 5 6 9H2v6h4l5 4z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14',
  expand:'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',
  download:'M12 3v12 M7 10l5 5 5-5 M3 17v4h18v-4',
  arrow:'M5 12h14 M14 7l5 5-5 5', clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  check:'M5 12l4 4L19 6', chevron:'M9 5l7 7-7 7', shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6z M8 12l3 3 5-6',
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M9 21h6',
  sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1',
  menu:'M4 6h16 M4 12h16 M4 18h16'
};
function uiIcon(name,size=17) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${UI_ICONS[name] || UI_ICONS.overview}"/></svg>`;
}
function uiMetric(label,value,detail,icon='overview',color='var(--cy)') {
  return `<article class="card stat-card ${icon==='alerts'?'alert-stat':''}" style="--metric-color:${color}"><span class="stat-label">${label}</span><span class="stat-icon">${uiIcon(icon)}</span><b class="stat-value">${esc(value)}</b><small class="stat-detail">${detail}</small><i class="metric-line" aria-hidden="true"></i></article>`;
}
function uiHead(title,subtitle,actions='') {
  return `<section class="page-head"><div><div class="eyebrow"><span class="status-dot"></span>${T('SECURITY OPERATIONS','عمليات الأمن')}</div><h1>${title}</h1><p class="mu">${subtitle}</p></div><div class="page-actions">${actions}</div></section>`;
}
function uiSection(title,detail='',icon='overview') {
  return `<div class="section-head"><h2 class="section-title">${uiIcon(icon,15)}${title}</h2><span class="mu">${detail}</span></div>`;
}
function uiNavigation() {
  const group=(label,ids)=>`<span class="nav-label">${label}</span>${ids.map(id=>{
    const [,en,ar]=NAV.find(n=>n[0]===id);
    return `<button type="button" class="nav-item ${D.view===id?'on':''}" onclick="go('${id}')" ${D.view===id?'aria-current="page"':''} title="${T(en,ar)}">${uiIcon(id)}<span>${T(en,ar)}</span>${id==='alerts'?'<small class="nav-count" id="navAlertCount">0</small>':''}</button>`;
  }).join('')}`;
  return group(T('WORKSPACE','مساحة العمل'),['overview','live','webcam','alerts'])+
    group(T('INTELLIGENCE','المعلومات'),['people','inc','evid','cyber','ana'])+
    `<span class="nav-label">${T('CAMERA SOURCES','مصادر الكاميرات')}</span><div id="navSources"></div>`+
    `<div class="nav-bottom">${group(T('SYSTEM','النظام'),['cams','health','set'])}</div>`;
}
function uiUpdateChrome() {
  const sources=$('#navSources');
  if(sources) sources.innerHTML=D.cameras.map(c=>`<button class="source-nav" onclick="focusCamera('${c.id}')" title="${esc(c.filename)}"><i class="status-dot" style="background:${['ready','live'].includes(c.status)?'var(--gr)':'var(--am)'}"></i>${c.id}<small>${['ready','live'].includes(c.status)?T('READY','جاهز'):c.progress+'%'}</small></button>`).join('');
  if($('#navAlertCount')) $('#navAlertCount').textContent=D.incidents.filter(active).length;
  if($('#breadcrumb')) $('#breadcrumb').textContent=T(...(NAV.find(n=>n[0]===D.view)||NAV[0]).slice(1,3));
  document.body.classList.toggle('status-offline',!D.connected);
  const values={cameras:D.cameras.filter(c=>['ready','live'].includes(c.status)).length,people:tracks().filter(t=>t.class==='person').length,alerts:D.incidents.filter(active).length,samples:D.cameras.reduce((n,c)=>n+c.samples,0).toLocaleString()};
  document.querySelectorAll('[data-live-kpi]').forEach(el=>el.textContent=values[el.dataset.liveKpi]);
}
function uiPlaybackButtons() {
  return `<button class="btn" id="monitorButton" onclick="toggleMonitoring()">${uiIcon(D.running?'pause':'play',14)}${D.running?T('Pause all','إيقاف الكل'):T('Start monitoring','بدء المراقبة')}</button><button class="btn o" onclick="restartMonitoring()" title="${T('Replay all sources and rearm alerts','إعادة المقاطع وتفعيل التنبيهات')}">${uiIcon('restart',14)}${T('Restart footage','إعادة المقاطع')}</button><button class="btn o" id="soundButton" onclick="toggleSound()">${uiIcon('sound',14)}${D.muted?T('Sound off','الصوت معطل'):T('Sound on','الصوت مفعل')}</button>`;
}
function uiLiveView() {
  const kpi=(label,key,detail,icon,color)=>uiMetric(label,'0',detail,icon,color).replace('class="stat-value"',`class="stat-value" data-live-kpi="${key}"`);
  return uiHead(T('Live Monitoring','البث المباشر'),T('Your camera workspace. Every detection, in context.','مساحة مراقبة الكاميرات والكشف.'),uiPlaybackButtons())+
    `<div class="g st">${kpi(T('Cameras ready','كاميرات جاهزة'),'cameras',T('Recorded camera sources','مصادر كاميرات مسجلة'),'cams')}${kpi(T('Tracked people','الأشخاص المتتبعون'),'people',T('Unique tracks across footage','تتبع فريد عبر المقاطع'),'people')}${kpi(T('Open incidents','حوادث مفتوحة'),'alerts',T('Requires operator review','تحتاج مراجعة المشغل'),'alerts','var(--rd)')}${kpi(T('Analyzed frames','إطارات محللة'),'samples',T('Timestamp-synced detections','كشف متزامن مع الوقت'),'health','var(--gr)')}</div>
    <div class="monitor-summary"><span><i class="status-dot"></i><b id="readyCount">0</b> ${T('sources ready','مصادر جاهزة')}</span><span>${T('Person tracking','تتبع الأشخاص')}</span><span>${T('Gun & knife detection','كشف المسدسات والسكاكين')}</span><span id="monitorState">${D.running?T('Monitoring recorded sources','مراقبة المصادر المسجلة'):T('Ready when you are','جاهز لبدء المراقبة')}</span></div>
    <div id="cameraGrid" class="camera-grid"></div><div id="connectionNote"></div>${siteMapCard()}
    <section class="card activity-card">${uiSection(T('Detection activity','نشاط الكشف'),T('Observed during playback','مرصود أثناء التشغيل'),'alerts')}<div id="recentActivity"></div><div class="table-foot"><span>${T('Source timestamps · Persistent incident history','وقت المصدر · سجل حوادث محفوظ')}</span><a href="#inc" onclick="go('inc');return false">${T('View all incidents','عرض كل الحوادث')} →</a></div></section>`;
}
function uiCameraCard(c) {
  return `<article class="card camera-card" data-id="${c.id}"><div class="section-head"><div class="camera-id">${uiIcon('cams',19)}<div><b>${c.id}</b><small>${esc(c.name)}</small></div></div><span class="camera-status b"></span></div><div class="camera-stage" id="stage-${c.id}" style="aspect-ratio:${c.width||16}/${c.height||9}"><img class="camera-poster" src="${api(c.thumbnail_url)}" alt="${esc(c.filename)}"><div class="camera-overlay"></div><div class="camera-wait"></div><span class="camera-source">${T('RECORDED SOURCE','مصدر مسجل')}</span><span class="camera-clock">00:00 / ${sourceTime(c.duration)}</span></div><div class="camera-footer"><span class="mu">${esc(c.filename)} · ${c.width} × ${c.height}</span><span class="camera-detections">${T('Waiting for AI','بانتظار التحليل')}</span></div><div class="camera-actions"><button class="btn o" onclick="focusCamera('${c.id}')">${uiIcon('overview',13)}${T('Inspect camera','فحص الكاميرا')}</button><button class="btn quiet" onclick="fullscreenCamera('${c.id}')">${uiIcon('expand',13)}${T('Full screen','ملء الشاشة')}</button><a class="btn quiet" href="${api(`/api/cameras/${c.id}/detections.csv`)}">${uiIcon('download',13)}${T('Export','تصدير')}</a></div></article>`;
}
function uiLegend(items) {
  return `<div class="chart-legend">${items.map(i=>`<span class="legend-key" style="--legend-color:${i.color}"><i></i>${esc(i.label)}${i.value!=null?`<b>${i.value}</b>`:''}</span>`).join('')}</div>`;
}
function uiDonut(title,items,total,unit,detail) {
  let offset=0;const sum=items.reduce((n,i)=>n+i.value,0);
  const rings=items.filter(i=>i.value>0).map(i=>{const length=i.value/Math.max(sum,1)*100;const circle=`<circle cx="70" cy="70" r="57" fill="none" stroke="${i.color}" stroke-width="10" pathLength="100" stroke-dasharray="${Math.max(0,length-.8)} ${100-Math.max(0,length-.8)}" stroke-dashoffset="${-offset}"/>`;offset+=length;return circle;}).join('');
  return `<article class="card chart-card"><div class="chart-head"><h2>${title}</h2><small>${detail}</small></div><div class="donut-wrap"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(title)}: ${total} ${esc(unit)}"><circle cx="70" cy="70" r="57" fill="none" stroke="var(--bd)" stroke-width="10"/>${rings}</svg><div class="donut-value"><b>${total}</b><small>${unit}</small></div></div>${uiLegend(items)}</article>`;
}
function uiCameraBars() {
  const events=D.incidents.filter(e=>e.status!=='False Positive');
  const values=D.cameras.map(c=>events.filter(e=>e.camera===c.id).length),max=Math.max(1,...values);
  const bars=D.cameras.map((c,i)=>{const x=50+i*(200/Math.max(D.cameras.length,1));const height=values[i]/max*113;return `<rect x="${x}" y="${140-height}" width="42" height="${height}" rx="2" fill="${i%2?'var(--bl)':'var(--cy)'}"/><text x="${x+21}" y="${132-height}" text-anchor="middle">${values[i]}</text><text x="${x+21}" y="162" text-anchor="middle">${c.id}</text>`;}).join('');
  return `<article class="card chart-card"><div class="chart-head"><h2>${T('Alerts by camera','تنبيهات حسب الكاميرا')}</h2><small>${T('Observed','مرصود')}</small></div><div class="chart-body"><svg class="chart-svg" viewBox="0 0 300 180" role="img" aria-label="${T('Observed alert counts per camera','عدد التنبيهات المرصودة لكل كاميرا')}">${[0,1,2].map(i=>`<line class="gridline" x1="24" x2="285" y1="${140-i*56}" y2="${140-i*56}"/>`).join('')}${bars}</svg></div>${uiLegend([{label:T('Saved incidents','حوادث محفوظة'),value:events.length,color:'var(--cy)'}])}</article>`;
}
function uiPeopleChart(wide=false) {
  const analyses=[...D.analyses.values()],maxTime=Math.max(1,...D.cameras.map(c=>c.duration));
  const maxCount=Math.max(1,...analyses.flatMap(a=>a.frames.map(f=>f.dets.filter(d=>d.class==='person').length)));
  const colors=['var(--cy)','#9d7dff','#55cc97','#f4bf60'];
  const W=680,H=215,left=32,right=660,top=15,bottom=175;
  const lines=analyses.map((a,i)=>{const step=Math.max(1,Math.floor(a.frames.length/65));const frames=a.frames.filter((f,j)=>j%step===0||j===a.frames.length-1);const points=frames.map(f=>`${left+f.time/maxTime*(right-left)},${bottom-f.dets.filter(d=>d.class==='person').length/maxCount*(bottom-top)}`);if(!points.length)return '';return `<path d="M${left},${bottom} L${points.join(' L')} L${left+frames.at(-1).time/maxTime*(right-left)},${bottom} Z" fill="${colors[i%colors.length]}" opacity=".07"/><polyline points="${points.join(' ')}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="2" stroke-linejoin="round"/>`;}).join('');
  const grid=[0,1,2,3].map(i=>{const y=bottom-(bottom-top)*i/3;return `<line class="gridline" x1="${left}" x2="${right}" y1="${y}" y2="${y}"/><text x="22" y="${y+3}" text-anchor="end">${Math.round(maxCount*i/3)}</text>`;}).join('');
  const ticks=[0,1,2,3,4,5].map(i=>`<text x="${left+(right-left)*i/5}" y="199" text-anchor="${i===0?'start':i===5?'end':'middle'}">${sourceTime(maxTime*i/5)}</text>`).join('');
  return `<article class="card chart-card ${wide?'wide-chart':''}"><div class="chart-head"><h2>${T('People in view over time','الأشخاص في المشهد عبر الوقت')}</h2><small>${T('Source time','وقت المصدر')}</small></div><div class="chart-body"><svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${T('Person detections per sampled source frame','كشف الأشخاص في إطارات المصدر')}">${grid}${lines}${ticks}</svg></div>${uiLegend(analyses.map((a,i)=>({label:a.camera,color:colors[i%colors.length]})))}</article>`;
}
function uiDashboard(analytics=false) {
  const people=tracks().filter(t=>t.class==='person'),events=D.incidents.filter(e=>e.status!=='False Positive');
  const colors=['var(--cy)','var(--bl)','#9d7dff','#55cc97'];
  const byCamera=D.cameras.map((c,i)=>({label:c.id,value:people.filter(t=>t.camera===c.id).length,color:colors[i%colors.length]}));
  const ready=D.cameras.filter(c=>['ready','live'].includes(c.status)).length;
  const severity=['CRITICAL','HIGH','MEDIUM','LOW'].map(level=>({label:level,value:events.filter(e=>active(e)&&e.severity===level).length,color:severityColor(level)}));
  return uiHead(analytics?T('Security Analytics','التحليلات الأمنية'):T('Security Overview','نظرة عامة على الأمن'),T('A clear view of your cameras, people, and security activity.','نظرة على الكاميرات والأشخاص والنشاط الأمني.'),`<span class="chip">${uiIcon('clock',14)}${T('Analyzed footage','المقاطع المحللة')}</span><button class="btn o" onclick="go('live')">${uiIcon('live',14)}${T('Open monitoring','فتح المراقبة')}</button>`)+
    `<div class="dashboard-metrics">${uiDonut(T('People by camera','الأشخاص حسب الكاميرا'),byCamera,people.length,T('unique tracks','تتبع فريد'),T('All sources','كل المصادر'))}${uiDonut(T('Camera availability','جاهزية الكاميرات'),[{label:T('Ready','جاهز'),value:ready,color:'var(--cy)'},{label:T('Processing / offline','معالجة / غير متصل'),value:D.cameras.length-ready,color:'var(--bd)'}],ready,T('cameras ready','كاميرات جاهزة'),`${ready} / ${D.cameras.length}`)}${uiDonut(T('Open incident severity','خطورة الحوادث المفتوحة'),severity,events.filter(active).length,T('open incidents','حوادث مفتوحة'),T('Needs review','تحتاج مراجعة'))}${uiCameraBars()}</div>
    ${analytics?'':siteMapCard()}<div class="dashboard-split">${uiPeopleChart()}<section class="card activity-card">${uiSection(T('Recent security activity','أحدث النشاط الأمني'),T('Persistent history','سجل محفوظ'),'inc')}<div id="recentActivity"></div><div class="table-foot"><span>${events.length} ${T('observed incidents','حوادث مرصودة')}</span><a href="#inc" onclick="go('inc');return false">${T('View incidents','عرض الحوادث')} →</a></div></section></div>
    <article class="card wide-chart">${uiSection(T('Camera source coverage','تغطية مصادر الكاميرات'),T('Analyzed duration · Seconds','مدة التحليل · ثوان'),'cams')}<div class="source-timeline">${D.cameras.map((c,i)=>`<div class="source-timeline-row"><div class="source-meta"><b>${c.id}</b><span>${c.samples} ${T('frames','إطار')}</span></div><div class="timeline-track"><i style="width:${Math.min(100,c.progress)}%;background:${colors[i%colors.length]}"></i></div><span class="mu">${sourceTime(c.duration)}</span></div>`).join('')}</div><p class="mu" style="font-size:10px;margin-top:22px">${T('Measurements come from the loaded recordings. Source durations and alert counts reflect actual analysis.','القياسات من التسجيلات المحملة ونتائج التحليل الفعلية.')}</p></article>`;
}
function uiPeopleView() {
  const all=tracks().filter(t=>t.class==='person'),people=all.filter(matches);
  const pageSize=12,page=Math.max(0,Math.min(D.peoplePage||0,Math.ceil(people.length/pageSize)-1));
  const start=page*pageSize,visible=people.slice(start,start+pageSize);
  return uiHead(T('People Tracking','تتبع الأشخاص'),T('One person, one track. Review real snapshots and source footage.','تتبع الأشخاص ومراجعة اللقطات والمقاطع الفعلية.'),`<button class="btn o" onclick="toggleChat()">${uiIcon('people',15)}${T('Person search','بحث عن شخص')}</button>`)+
    `<div class="g st">${uiMetric(T('Tracked people','الأشخاص المتتبعون'),all.length,T('Unique anonymous IDs','معرفات مجهولة فريدة'),'people')}${uiMetric(T('Camera sources','مصادر الكاميرات'),D.cameras.length,T('Across analyzed recordings','عبر التسجيلات المحللة'),'cams')}${uiMetric(T('Matching results','نتائج مطابقة'),people.length,T('Current search','البحث الحالي'),'overview')}${uiMetric(T('Person snapshots','لقطات الأشخاص'),all.filter(t=>t.snapshot_url).length,T('Captured from actual footage','ملتقط من المقاطع الفعلية'),'evid')}</div>`+
    (people.length?`<section class="card tw"><div class="toolbar"><h2>${T('Tracked person directory','دليل الأشخاص المتتبعين')}</h2><span class="mu">${people.length} ${T('people','شخص')} · ${T('Click a snapshot to inspect','اضغط اللقطة للفحص')}</span></div><table class="people-table"><thead><tr><th>${T('Snapshot','لقطة')}</th><th>${T('Person ID','معرف الشخص')}</th><th>${T('Source','المصدر')}</th><th>${T('Clothing','الملابس')}</th><th>${T('First seen','أول ظهور')}</th><th>${T('Last seen','آخر ظهور')}</th><th>${T('Confidence','الثقة')}</th><th></th></tr></thead><tbody>${visible.map(t=>`<tr><td><button class="person-thumbnail" onclick="openPerson('${t.id}')" aria-label="${T('Inspect person','فحص شخص')} ${t.id}"><img src="${api(t.snapshot_url)}" loading="lazy" alt="${esc(t.id)}"></button></td><td><button class="person-id-button" onclick="openPerson('${t.id}')">${t.track}</button><div class="mu" style="font-size:9px;margin-top:4px">${T('Anonymous track','تتبع مجهول')}</div></td><td>${badge(t.camera,'var(--cy)')}</td><td>${esc(t.color||'—')}</td><td>${sourceTime(t.first_seen)}</td><td>${sourceTime(t.last_seen)}</td><td>${Math.round(t.conf*100)}%</td><td><button class="btn o" onclick="focusCamera('${t.camera}',${t.first_seen})">${uiIcon('play',12)}${T('View footage','عرض المقطع')}</button></td></tr>`).join('')}</tbody></table><div class="table-foot"><span>${T('Showing','عرض')} ${start+1}–${start+visible.length} ${T('of','من')} ${people.length}</span><span class="am"><button class="btn o" ${page===0?'disabled':''} onclick="uiPeoplePage(${page-1})" aria-label="${T('Previous page','الصفحة السابقة')}">‹</button><span>${page+1} / ${Math.ceil(people.length/pageSize)}</span><button class="btn o" ${start+pageSize>=people.length?'disabled':''} onclick="uiPeoplePage(${page+1})" aria-label="${T('Next page','الصفحة التالية')}">›</button></span></div></section>`:empty(T('No matching person tracks available yet.','لا توجد نتائج مطابقة بعد.')));
}
function uiPeoplePage(page) { D.peoplePage=page; render(); }
function uiIncidentsView() {
  const history=D.view==='inc',visible=D.incidents.filter(e=>history||active(e));
  return uiHead(history?T('Incident History','سجل الحوادث'):T('Security Alerts','التنبيهات الأمنية'),history?T('A complete review trail for every observed incident.','سجل مراجعة لكل حادث مرصود.'):T('Prioritize, inspect, and review security events.','ترتيب وفحص ومراجعة الأحداث الأمنية.'),`<button class="btn o" onclick="go('${history?'alerts':'inc'}')">${uiIcon(history?'alerts':'inc',14)}${history?T('Open alerts','التنبيهات المفتوحة'):T('Incident history','سجل الحوادث')}</button>`)+
    `<div class="g st">${uiMetric(T('Open incidents','حوادث مفتوحة'),D.incidents.filter(active).length,T('Awaiting review or action','بانتظار المراجعة'),'alerts','var(--rd)')}${uiMetric(T('Critical','حرج'),D.incidents.filter(e=>active(e)&&e.severity==='CRITICAL').length,T('Highest priority','الأولوية القصوى'),'shield','var(--rd)')}${uiMetric(T('Under review','قيد المراجعة'),D.incidents.filter(e=>e.status==='Under Review').length,T('Acknowledged by operator','تم الاطلاع عليها'),'inc','var(--am)')}${uiMetric(T('Resolved','محلول'),D.incidents.filter(e=>e.status==='Resolved').length,T('Completed reviews','مراجعات مكتملة'),'check','var(--gr)')}</div>`+
    (visible.length?`<section class="card tw"><div class="toolbar"><h2>${history?T('All recorded incidents','كل الحوادث المسجلة'):T('Active alert queue','قائمة التنبيهات النشطة')}</h2><span class="mu">${visible.filter(matches).length} ${T('results','نتائج')}</span></div><table><thead><tr><th>${T('Observed at','وقت الرصد')}</th><th>${T('Source','المصدر')}</th><th>${T('Detection / severity','الكشف / الخطورة')}</th><th>${T('Source time','وقت المصدر')}</th><th>${T('Confidence','الثقة')}</th><th>${T('Review status','حالة المراجعة')}</th><th></th></tr></thead><tbody>${incidentRows()}</tbody></table><div class="table-foot"><span>${T('Review changes are saved automatically','تُحفظ تغييرات المراجعة تلقائياً')}</span><span>${history?T('Includes archived false positives','يشمل الإنذارات الكاذبة المؤرشفة'):T('Archived alerts are excluded','تُستثنى التنبيهات المؤرشفة')}</span></div></section>`:empty(T('No active alerts. Observed detections will appear here.','لا توجد تنبيهات نشطة.')));
}
function uiCamerasView() {
  return uiHead(T('Camera Sources','مصادر الكاميرات'),T('Your connected recordings and their analysis status.','التسجيلات المتصلة وحالة تحليلها.'),`<button class="btn o" onclick="go('live')">${uiIcon('live',14)}${T('Live monitoring','البث المباشر')}</button>`)+`<div class="g cams">${D.cameras.filter(matches).map(c=>`<article class="card catalog-card"><img class="catalog-thumbnail" src="${api(c.thumbnail_url)}" alt="${esc(c.name)}"><div class="catalog-body"><div class="section-head" style="margin:0"><h2>${c.id}</h2>${badge(c.status,['ready','live'].includes(c.status)?'var(--gr)':'var(--am)')}</div><p class="mu">${esc(c.filename)}</p><div class="kv"><div><small>${T('Resolution','الدقة')}</small>${c.width} × ${c.height}</div><div><small>${T('Duration','المدة')}</small>${sourceTime(c.duration)}</div></div><button class="btn o" onclick="focusCamera('${c.id}')">${uiIcon('play',14)}${T('Inspect camera','فحص الكاميرا')}</button></div></article>`).join('')||empty(T('No cameras discovered yet.','لا توجد كاميرات بعد.'))}</div>`;
}
function uiEvidenceView() {
  const evidence=D.incidents.filter(e=>e.status!=='False Positive').filter(matches);
  return uiHead(T('Evidence Library','مكتبة الأدلة'),T('Original source frames. A clear record of every detection.','إطارات المصدر الأصلية لكل كشف.'),`<span class="chip">${uiIcon('evid',14)}${evidence.length} ${T('snapshots','لقطات')}</span>`)+`<div class="g cams">${evidence.map(e=>`<article class="card catalog-card"><img class="catalog-thumbnail" src="${api(e.snapshot_url)}" alt="${esc(e.type)}"><div class="catalog-body"><div class="section-head" style="margin:0"><h2>${esc(e.type)}</h2>${severityBadge(e.severity)}</div><p class="mu">${e.camera} · ${sourceTime(e.time)} · ${Math.round(e.conf*100)}% ${T('confidence','ثقة')}</p><p class="mu">${esc(e.person_id||'—')} · ${esc(e.status)}</p><button class="btn o" onclick="openAlert('${e.id}')">${uiIcon('evid',14)}${T('Review evidence','مراجعة الأدلة')}</button></div></article>`).join('')||empty(T('Evidence appears when an observed detection creates an alert.','تظهر الأدلة عند رصد تنبيه.'))}</div>`;
}
function uiCyberView() {
  const events = [...(window.CYBER_EXTRA || []), ...[
    {t:'18:40:12', ev:T('Possible DDoS attack','هجوم حجب خدمة محتمل'), tg:'CAM-17', src:'192.168.10.45', x:'4.8 Gbps', sev:'HIGH', st:T('Mitigating','قيد المعالجة')},
    {t:'18:36:50', ev:T('Repeated failed logins','محاولات تسجيل دخول فاشلة متكررة'), tg:'CAM-09', src:'10.20.4.117', x:T('27 attempts / 2 min','27 محاولة / دقيقتين'), sev:'MEDIUM', st:T('Blocked','محظور')},
    {t:'18:33:21', ev:T('Firmware integrity warning','تحذير سلامة البرنامج الثابت'), tg:'CAM-24', src:'—', x:T('Hash mismatch','عدم تطابق البصمة'), sev:'HIGH', st:T('Investigating','قيد التحقيق')},
    {t:'18:29:05', ev:T('Suspicious API requests','طلبات برمجة تطبيقات مشبوهة'), tg:'VMS-API', src:'172.16.8.203', x:T('1.2k req/min','1.2 ألف طلب / دقيقة'), sev:'MEDIUM', st:T('Rate limited','تم تحديد المعدل')},
    {t:'18:24:40', ev:T('Camera link down','انقطاع اتصال الكاميرا'), tg:'CAM-38', src:'—', x:T('Link down','الرابط غير متصل'), sev:'HIGH', st:T('Open','مفتوح')},
    {t:'18:18:12', ev:T('Unusual bandwidth spike','ارتفاع غير عادي في النطاق الترددي'), tg:'CAM-12', src:'—', x:'+310% vs baseline', sev:'LOW', st:T('Monitoring','قيد المراقبة')},
    {t:'18:11:33', ev:T('Authentication failure','فشل المصادقة'), tg:'NVR-02', src:'192.168.10.88', x:T('3 attempts','3 محاولات'), sev:'LOW', st:T('Closed','مغلق')}
  ]];
  const filtered = events.filter(matches);
  return uiHead(T('Cybersecurity Logs','سجلات الأمن السيبراني'),
    T('Simulated infrastructure & camera network security events.','أحداث أمنية على البنية التحتية لشبكات الكاميرات.'),
    `<span class="chip" style="color:var(--cy)"><i class="status-dot"></i>${T('Intrusion Defense Active','نظام حماية الشبكة نشط')}</span>`)+
    `<div class="g st">${uiMetric(T('Total events','إجمالي الأحداث'),events.length,T('Observed network alerts','تنبيهات الشبكة المرصودة'),'cyber')}${uiMetric(T('High severity','خطورة عالية'),events.filter(e=>['HIGH','CRITICAL'].includes(e.sev)).length,T('Requires immediate action','تحتاج تدخلاً فورياً'),'shield','var(--or)')}${uiMetric(T('Blocked / mitigated','تم حظره أو معالجته'),events.filter(e=>['Blocked','Mitigating'].includes(e.st)||e.st.includes('محظور')).length,T('Automatic defense applied','تم تطبيق الحماية التلقائية'),'check','var(--gr)')}${uiMetric(T('Network health','صحة الشبكة'),'99.1%',T('Infrastructure uptime','جاهزية البنية التحتية'),'health')}</div>`+
    `<section class="card tw"><div class="toolbar"><h2>${T('Network incident log','سجل أحداث الشبكة')}</h2><span class="mu">${filtered.length} ${T('events','أحداث')}</span></div><table><thead><tr><th>${T('Time','الوقت')}</th><th>${T('Security event','الحدث الأمني')}</th><th>${T('Target','الهدف')}</th><th>${T('Source IP','عنوان IP المصدر')}</th><th>${T('Traffic / details','حركة المرور / التفاصيل')}</th><th>${T('Severity','الخطورة')}</th><th>${T('Status','الحالة')}</th></tr></thead><tbody>${filtered.map(l=>`<tr class="incident-row" style="--severity-color:${severityColor(l.sev)}"><td>${esc(l.t)}</td><td><strong>${esc(l.ev)}</strong></td><td>${badge(l.tg,'var(--cy)')}</td><td><code>${esc(l.src)}</code></td><td>${esc(l.x)}</td><td>${severityBadge(l.sev)}</td><td>${badge(l.st,['Closed','Blocked'].includes(l.st)||l.st.includes('محظور')||l.st.includes('مغلق')?'var(--gr)':'var(--am)')}</td></tr>`).join('')}</tbody></table><div class="table-foot"><span>${T('Infrastructure monitoring · Continuous integrity checks','مراقبة البنية التحتية · فحوصات نزاهة مستمرة')}</span><span>${T('Real-time defense active','الحماية الفورية نشطة')}</span></div></section>`;
}
function uiSparkline(data, color, label, unit) {
  const min = Math.min(...data), max = Math.max(...data), range = Math.max(1, max - min);
  const w = 180, h = 40;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 8) - 4}`).join(' ');
  const latest = data[data.length - 1];
  return `<article class="card stat-card"><span class="stat-label">${label}</span><b class="stat-value">${latest} <small style="font-size:12px;font-weight:normal">${unit}</small></b><div style="margin-top:6px"><svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/><circle cx="${w}" cy="${h - ((latest - min) / range) * (h - 8) - 4}" r="3" fill="${color}"/></svg></div></article>`;
}
function uiHealthView() {
  const latency = [20, 24, 28, 35, 42, 38, 55, 62, 70, 85, 98, 120, 140];
  const packetLoss = [0.2, 0.2, 0.4, 0.5, 0.8, 1.2, 1.5, 2.1, 2.8, 3.5, 4.2, 5.1, 6.0];
  const cpuTemp = [52, 53, 55, 58, 62, 65, 68, 71, 74, 76, 78, 80, 81];
  const camHealth = [96, 95, 94, 91, 88, 85, 82, 79, 75, 72, 68, 65, 64];
  const subsystems = [
    [T('Cameras', 'الكاميرات'), 98.7],
    [T('Network infrastructure', 'بنية الشبكة'), 99.1],
    [T('Video storage (NVR)', 'تخزين الفيديو'), 94.2],
    [T('AI analytics engines', 'محركات تحليل الذكاء الاصطناعي'), 97.5],
    [T('Video management service', 'خدمة إدارة الفيديو'), 99.6]
  ];
  return uiHead(T('System Health & Predictive Maintenance','صحة النظام والصيانة التنبؤية'),
    T('Processing status, hardware vitals, and source readiness.','حالة المعالجة والمؤشرات الحيوية للأجهزة وجاهزية المصادر.'),
    `<span class="chip" style="color:${D.connected?'var(--gr)':'var(--am)'}"><i class="status-dot"></i>${D.connected?T('Backend connected','الخادم متصل'):T('Backend offline','الخادم غير متصل')}</span>`)+
    `<div class="card cam24-card"><div class="section-head"><div class="am"><b>${T('CAM-24 may fail in about 10 minutes','الكاميرا CAM-24 قد تتعطل خلال 10 دقائق')}</b>${badge(T('PREDICTED FAILURE','فشل متوقع'),'var(--am)')}</div></div><div class="kv" style="margin-top:10px"><div><small>${T('Camera','الكاميرا')}</small>CAM-24</div><div><small>${T('Location','الموقع')}</small>${T('Hall C','الصالة ج')}</div><div><small>${T('Current health','الصحة الحالية')}</small>64%</div><div><small>${T('Estimated time','الوقت المقدر')}</small>~10 min</div><div><small>${T('Reason','السبب')}</small>${T('Rising packet loss + abnormal temperature','ارتفاع فقد الحزم + حرارة غير طبيعية')}</div></div></div>`+
    `<div class="g st">${uiSparkline(latency,'var(--cy)',T('Network latency','زمن استجابة الشبكة'),'ms')}${uiSparkline(packetLoss,'var(--am)',T('Packet loss','فقد الحزم'),'%')}${uiSparkline(cpuTemp,'var(--or)',T('CPU temperature','حرارة المعالج'),'°C')}${uiSparkline(camHealth,'var(--rd)',T('Camera health','صحة الكاميرا'),'%')}</div>`+
    `<section class="card"><div class="toolbar"><h2>${T('Subsystem Health & Availability', 'صحة وجاهزية الأنظمة الفرعية')}</h2><span class="mu">${T('Continuous self-checks', 'فحص ذاتي مستمر')}</span></div><div class="g" style="gap:10px">${subsystems.map(([name, pct]) => `<div class="hb"><span>${name}</span><div class="health-meter" style="flex:1;height:8px"><span style="width:${pct}%;background:var(--gr)"></span></div><b>${pct}%</b></div>`).join('')}</div></section>`+
    `<div class="g st" style="margin-top:8px">${uiMetric(T('Ready sources','مصادر جاهزة'),D.cameras.filter(c=>['ready','live'].includes(c.status)).length,T('Available for monitoring','متاحة للمراقبة'),'cams')}${uiMetric(T('Processing','قيد المعالجة'),D.cameras.filter(c=>['queued','analyzing'].includes(c.status)).length,T('Queued or analyzing','بانتظار التحليل'),'health')}${uiMetric(T('Source errors','أخطاء المصادر'),D.cameras.filter(c=>c.status==='error').length,T('Requires attention','تحتاج فحصاً'),'alerts','var(--rd)')}${uiMetric(T('Detection classes','فئات الكشف'),D.capabilities.length,D.capabilities.map(esc).join(' · '),'shield')}</div>`+
    `<section class="card tw"><div class="toolbar"><h2>${T('AI Video Analysis Pipeline','مسار تحليل الفيديو بالذكاء الاصطناعي')}</h2><span class="mu">${T('Live backend status','حالة الخادم الحالية')}</span></div><table><thead><tr><th>${T('Camera','الكاميرا')}</th><th>${T('File','الملف')}</th><th>${T('Status','الحالة')}</th><th>${T('Progress','التقدم')}</th><th>${T('Frames','الإطارات')}</th><th>${T('Details','التفاصيل')}</th></tr></thead><tbody>${D.cameras.map(c=>`<tr><td>${c.id}</td><td>${esc(c.filename)}</td><td>${badge(c.status,['ready','live'].includes(c.status)?'var(--gr)':'var(--am)')}</td><td><div class="am"><div class="health-meter"><span style="width:${c.progress}%"></span></div>${c.progress}%</div></td><td>${c.samples}</td><td class="mu">${esc(c.error||T('No issues','لا توجد أخطاء'))}</td></tr>`).join('')}</tbody></table></section>`;
}
function siteMapCard() {
  return `<article class="card site-map-card">${uiSection(T('Expo 2030 Riyadh · Site Map','إكسبو 2030 الرياض · خريطة الموقع'),T('People & incident locations','مواقع الأشخاص والحوادث'),'cams')}<div class="site-map-shell" data-role="site-map"><canvas tabindex="0" aria-label="${T('Interactive 3D site map with detected people and open incidents','خريطة ثلاثية الأبعاد للأشخاص والحوادث')}"></canvas><div class="site-map-hud"></div></div><div class="site-map-note"><span>${T('Camera-relative estimates · Not calibrated floor positions.','تقديرات نسبة للكاميرا · مواقع غير معايرة.')}</span><span>${T('Drag to orbit · Scroll to zoom · Click a dot for details','اسحب للدوران · مرر للتكبير · اضغط النقطة للتفاصيل')}</span></div></article>`;
}
function uiSettingsView() {
  return uiHead(T('Workspace Settings','إعدادات مساحة العمل'),T('Configure your monitoring workspace and appearance.','إعداد مساحة المراقبة والمظهر.'))+`<div class="settings-grid"><section class="card settings-panel">${uiSection(T('Connection','الاتصال'),'','health')}<label class="settings-label">${T('Backend URL','رابط الخادم')}<input class="settings-input" value="${esc(base)}" placeholder="${esc(location.origin)}" onchange="aiSetUrl(this.value)"></label><p class="mu">${T('Leave blank to use this website’s backend. Connection changes apply when you leave the field.','اتركه فارغاً لاستخدام خادم الموقع. تطبق التغييرات عند مغادرة الحقل.')}</p><div class="settings-row"><div>${T('Camera sources','مصادر الكاميرات')}<small>${T('Recorded sources available in this workspace','مصادر مسجلة متاحة في مساحة العمل')}</small></div>${D.cameras.length}</div><div class="settings-row"><div>${T('Detection capabilities','قدرات الكشف')}<small>${T('Model classes available for weapon alerts','فئات النموذج المتاحة لتنبيهات الأسلحة')}</small></div>${badge(D.capabilities.join(' + '),'var(--cy)')}</div></section><section class="card settings-panel">${uiSection(T('Appearance & Simulation','المظهر والمحاكاة'),'','set')}<div class="settings-row"><div>${T('Color theme','المظهر')}<small>${T('Dark and light workspaces','مساحة عمل داكنة أو فاتحة')}</small></div><button class="btn o" onclick="toggleTheme();render()">${currentTheme==='dark'?T('Switch to light','التبديل للفاتح'):T('Switch to dark','التبديل للداكن')}</button></div><div class="settings-row"><div>${T('Language','اللغة')}<small>${T('English and Arabic with RTL support','العربية والإنجليزية')}</small></div><button class="btn o" onclick="toggleLang()">${T('العربية','English')}</button></div><div class="settings-row"><div>${T('Demo simulation ticker','محاكاة العرض التجريبي')}<small>${T('Periodically simulate security events for presentations','محاكاة أحداث أمنية دورية للعروض التقديمية')}</small></div><button class="btn o" onclick="toggleDemo()">${D.demo?T('Disable simulation','تعطيل المحاكاة'):T('Enable simulation','تفعيل المحاكاة')}</button></div><p class="mu">${T('Person IDs are anonymous tracking references. Clothing colors are approximate, and detections require operator review.','معرفات الأشخاص مراجع تتبع مجهولة وألوان الملابس تقريبية. يتطلب الكشف مراجعة المشغل.')}</p></section></div>`;
}
