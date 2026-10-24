/* Browser capture is explicit, video-only, and released on Stop or page exit. */
const W = {stream:null,video:document.createElement('video'),canvas:document.createElement('canvas'),
  active:false,starting:false,session:'',run:0,controller:null,last:null,capturedAt:0,
  devices:[],devicesLoaded:false,error:''};
W.video.muted=true; W.video.playsInline=true; W.video.autoplay=true;
W.video.setAttribute('aria-label','Live webcam preview');

function uiWebcamView() {
  return uiHead(T('Live Webcam','كاميرا مباشرة'),T('Live capture with person tracking and confirmed knife alerts by default.','التقاط مباشر مع تتبع الأشخاص وتنبيهات السكاكين المؤكدة افتراضياً.'),
    `<button class="btn" id="webcamStart" onclick="startWebcam()">${uiIcon('play',14)}${T('Start webcam','تشغيل الكاميرا')}</button><button class="btn o" id="webcamStop" onclick="stopWebcam()">${uiIcon('pause',14)}${T('Stop webcam','إيقاف الكاميرا')}</button>`)+
    `<div class="webcam-controls card"><label>${T('Camera','الكاميرا')}<select id="webcamDevice" aria-label="${T('Choose a webcam','اختر كاميرا')}"><option value="">${T('Default webcam','الكاميرا الافتراضية')}</option></select></label><span class="mu">${T('Camera access starts only when you press Start. Microphone is off.','يبدأ الوصول للكاميرا عند الضغط على تشغيل. الميكروفون معطل.')}</span></div>
    <div id="webcamError" class="webcam-error" role="alert" hidden></div>
    <div class="g st">${uiMetric(T('People in view','الأشخاص في المشهد'),'0',T('Latest analyzed frame','آخر إطار محلل'),'people').replace('class="stat-value"','class="stat-value" id="webcamPeople"')}${uiMetric(T('Analyzed frames','إطارات محللة'),'0',T('Current live session','الجلسة المباشرة الحالية'),'health').replace('class="stat-value"','class="stat-value" id="webcamSamples"')}${uiMetric(T('Inference rate','معدل التحليل'),'—',T('Actual processed frames / second','الإطارات المحللة فعلياً في الثانية'),'ana').replace('class="stat-value"','class="stat-value" id="webcamRate"')}${uiMetric(T('Frame age','عمر الإطار'),'—',T('Time since capture','الوقت منذ الالتقاط'),'clock').replace('class="stat-value"','class="stat-value" id="webcamAge"')}</div>
    <div class="webcam-grid"><article class="card camera-card"><div class="section-head"><div class="camera-id">${uiIcon('shield',18)}<div><b>${T('AI detection view','عرض الكشف')}</b><small>WEB-01 · ${T('Boxes match this analyzed frame','المربعات تطابق هذا الإطار المحلل')}</small></div></div><span id="webcamState" class="b" style="--c:var(--mu)">${T('STOPPED','متوقف')}</span></div><div class="camera-stage webcam-stage" id="webcamResultStage"><img id="webcamResult" alt="${T('Latest analyzed webcam frame','آخر إطار محلل من الكاميرا')}" hidden><div id="webcamOverlay" class="camera-overlay"></div><div id="webcamWait" class="camera-wait"><b>${T('Your live camera workspace','مساحة الكاميرا المباشرة')}</b><small>${T('Choose your webcam and press Start to begin recognition.','اختر الكاميرا واضغط تشغيل لبدء الكشف.')}</small></div><span class="camera-source" id="webcamSource">${T('LIVE WEBCAM','كاميرا مباشرة')}</span></div><div class="camera-footer"><span class="mu" id="webcamTimestamp">${T('No frame analyzed yet','لم يُحلل إطار بعد')}</span><a id="webcamDownload" class="btn quiet" download="webcam-snapshot.jpg" hidden>${uiIcon('download',13)}${T('Snapshot','لقطة')}</a></div></article>
    <aside class="g"><article class="card camera-card"><div class="section-head"><h2>${T('Live preview','معاينة مباشرة')}</h2><span class="mu" style="font-size:10px">${T('Unprocessed video','فيديو غير محلل')}</span></div><div id="webcamPreview" class="webcam-preview"></div><p class="webcam-note mu">${T('The preview stays smooth while AI checks individual frames. Detection boxes are shown on the matching frame at left.','تبقى المعاينة سلسة أثناء تحليل الإطارات. تظهر المربعات على الإطار المطابق.')}</p></article><article class="card webcam-help"><h2>${T('Connected to your workspace','متصل بمساحة العمل')}</h2><p class="mu">${T('People receive independent track IDs and snapshots. Confirmed weapon alerts create colored notifications and saved evidence. Live alerts are knives only by default.','يحصل الأشخاص على معرفات ولقطات. تُنشئ تنبيهات الأسلحة المؤكدة إشعارات ملونة وأدلة محفوظة. تنبيهات البث المباشر للسكاكين فقط افتراضياً.')}</p><div class="am"><button class="btn o" onclick="go('people')">${uiIcon('people',14)}${T('Tracked people','الأشخاص المتتبعون')}</button><button class="btn o" onclick="go('alerts')">${uiIcon('alerts',14)}${T('Alerts','التنبيهات')}</button></div><small class="mu">${T('Snapshots are saved. Continuous webcam video is not recorded.','تُحفظ اللقطات ولا يُسجل فيديو الكاميرا بشكل مستمر.')}</small></article></aside></div>${siteMapCard()}`;
}
async function webcamDevices() {
  W.devicesLoaded=true;
  try { W.devices=(await navigator.mediaDevices?.enumerateDevices()||[]).filter(d=>d.kind==='videoinput'); }
  catch { W.devices=[]; }
  webcamDeviceOptions();
}
function webcamDeviceOptions() {
  const select=$('#webcamDevice');if(!select)return;
  const selected=select.value;
  select.innerHTML=`<option value="">${T('Default webcam','الكاميرا الافتراضية')}</option>`+W.devices.map((d,i)=>`<option value="${esc(d.deviceId)}">${esc(d.label||`${T('Camera','كاميرا')} ${i+1}`)}</option>`).join('');
  select.value=selected;select.disabled=W.active||W.starting;
}
function webcamMount() {
  if(D.view!=='webcam')return;
  $('#webcamPreview')?.append(W.video);
  if(!W.devicesLoaded)webcamDevices();else webcamDeviceOptions();
  webcamPaint();
}
function webcamPaint() {
  if(D.view!=='webcam')return;
  const start=$('#webcamStart'),stop=$('#webcamStop');
  if(!start||!stop)return;
  start.disabled=W.active||W.starting;stop.disabled=!W.active&&!W.starting;
  $('#webcamDevice').disabled=W.active||W.starting;
  $('#webcamError').hidden=!W.error;$('#webcamError').textContent=W.error;
  $('#webcamState').textContent=W.starting?T('STARTING','بدء التشغيل'):W.active?T('LIVE','مباشر'):T('STOPPED','متوقف');
  $('#webcamState').style.setProperty('--c',W.active?'var(--gr)':'var(--mu)');
  $('#webcamSource').textContent=W.active?T('LIVE WEBCAM','كاميرا مباشرة'):T('LAST ANALYZED FRAME','آخر إطار محلل');
  $('#webcamPreview').classList.toggle('preview-idle',!W.stream);
  const frame=W.last;
  $('#webcamPeople').textContent=frame?frame.dets.filter(d=>d.class==='person').length:0;
  $('#webcamSamples').textContent=frame?.samples||0;
  $('#webcamRate').textContent=frame?`${frame.inference_fps} fps`:'—';
  $('#webcamAge').textContent=frame?`${((performance.now()-W.capturedAt)/1000).toFixed(1)}s`:'—';
  if(!frame) return;
  const captureTime=new Date(frame.captured_at).toLocaleString(currentLang==='ar'?'ar-SA':'en-GB',{timeZone:'Asia/Riyadh',hour12:false});
  $('#webcamTimestamp').textContent=`${captureTime} · ${frame.width} × ${frame.height} · ${frame.inference_ms} ms`;
  const img=$('#webcamResult');
  if(img.dataset.frame!==String(frame.samples)) {
    img.dataset.frame=String(frame.samples);
    img.onload=()=>{if(!img.isConnected)return;img.hidden=false;$('#webcamWait').hidden=true;
      paintBoxes($('#webcamOverlay'),frame.dets,{width:frame.width,height:frame.height},frame.dets.filter(d=>d.weapon));};
    img.src=frame.frame;
    $('#webcamResultStage').style.aspectRatio=`${frame.width}/${frame.height}`;
  }
  const download=$('#webcamDownload');download.hidden=false;download.href=frame.frame;
}
async function startWebcam() {
  if(W.active||W.starting)return;
  if(!navigator.mediaDevices?.getUserMedia) {
    W.error=T('Camera access requires localhost or HTTPS and a supported browser.','يتطلب الوصول للكاميرا localhost أو HTTPS ومتصفحاً مدعوماً.');webcamPaint();return;
  }
  if(!D.connected){W.error=T('Connect to the backend before starting the webcam.','اتصل بالخادم قبل تشغيل الكاميرا.');webcamPaint();return;}
  unlockSound();const run=++W.run;W.starting=true;W.error='';W.last=null;webcamPaint();
  try {
    const device=$('#webcamDevice')?.value;
    const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:1280},height:{ideal:720},...(device?{deviceId:{exact:device}}:{})}});
    if(run!==W.run){stream.getTracks().forEach(t=>t.stop());return;}
    W.stream=stream;W.video.srcObject=stream;await W.video.play();
    const result=await post('/api/webcam/start',{});
    if(run!==W.run){post('/api/webcam/stop',{session:result.session}).catch(()=>{});return;}
    W.session=result.session;W.active=true;W.starting=false;
    stream.getVideoTracks()[0].addEventListener('ended',()=>{if(W.active)stopWebcam(T('The webcam was disconnected or camera access ended.','انقطع اتصال الكاميرا أو انتهى الوصول إليها.'));});
    webcamDevices();webcamMount();webcamLoop(run);
  } catch(error) {
    if(run!==W.run)return;
    const messages={NotAllowedError:T('Camera access was denied. Allow camera access in your browser and try again.','رُفض الوصول للكاميرا. اسمح بالوصول من المتصفح وحاول مجدداً.'),NotFoundError:T('No webcam was found. Connect a camera and try again.','لم يُعثر على كاميرا. صل كاميرا وحاول مجدداً.'),NotReadableError:T('The camera is unavailable or in use by another application.','الكاميرا غير متاحة أو تستخدمها تطبيقات أخرى.')};
    stopWebcam(messages[error.name]||error.message||T('Could not start the webcam.','تعذر تشغيل الكاميرا.'));
  }
}
async function webcamLoop(run) {
  if(!W.active||run!==W.run)return;
  try {
    if(W.video.readyState<2){setTimeout(()=>webcamLoop(run),100);return;}
    const scale=Math.min(1,960/W.video.videoWidth);
    W.canvas.width=Math.round(W.video.videoWidth*scale);W.canvas.height=Math.round(W.video.videoHeight*scale);
    W.canvas.getContext('2d').drawImage(W.video,0,0,W.canvas.width,W.canvas.height);
    const capturedAt=performance.now();
    const blob=await new Promise(resolve=>W.canvas.toBlob(resolve,'image/jpeg',.88));
    if(!blob||run!==W.run||!W.active)return;
    W.controller=new AbortController();const timer=setTimeout(()=>W.controller?.abort(),60000);
    let response;
    try {response=await fetch(api('/api/webcam/frame'),{method:'POST',headers:{'Content-Type':'image/jpeg','X-Webcam-Session':W.session},body:blob,signal:W.controller.signal});}
    finally{clearTimeout(timer);}
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Webcam inference failed');
    if(run!==W.run||!W.active)return;
    W.last=result;W.capturedAt=capturedAt;
    const old=D.analyses.get('WEB-01')||{frames:[],events:[]};
    D.analyses.set('WEB-01',{camera:'WEB-01',source_type:'webcam',fingerprint:old.fingerprint,
      tracks:result.tracks,sample_fps:result.inference_fps,frames:[...old.frames,{time:result.time,dets:result.dets}].slice(-120),events:[...old.events,...result.events].slice(-500)});
    webcamPaint();updateChrome();
    for(const event of result.events)if(!D.shown.has(event.id)){D.shown.add(event.id);activateEvent(event);}
    // Capture the next current frame only after inference returns: no growing queue.
    setTimeout(()=>webcamLoop(run),40);
  } catch(error) {if(run===W.run&&W.active)stopWebcam(error.name==='AbortError'?T('Webcam analysis timed out. Try starting again.','انتهت مهلة التحليل. حاول التشغيل مجدداً.'):error.message);}
}
function stopWebcam(error='') {
  const session=W.session;++W.run;W.active=false;W.starting=false;W.session='';W.error=error;
  W.controller?.abort();W.controller=null;
  W.stream?.getTracks().forEach(t=>t.stop());W.stream=null;W.video.srcObject=null;
  if(session)post('/api/webcam/stop',{session}).catch(()=>{});
  webcamPaint();if(error)toast(error,'HIGH');
}
window.addEventListener('pagehide',()=>{
  W.stream?.getTracks().forEach(t=>t.stop());
  if(W.session)navigator.sendBeacon(api('/api/webcam/stop'),new Blob([JSON.stringify({session:W.session})],{type:'application/json'}));
});
setInterval(()=>{if(typeof D!=='undefined'&&D.view==='webcam'&&W.last)webcamPaint();},500);
