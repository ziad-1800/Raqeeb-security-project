/* Raqeeb recorded-camera monitoring. Every box and incident comes from inference. */
"use strict";
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const pad = n => String(n).padStart(2, "0");
const sourceTime = t => `${pad(Math.floor(t / 60))}:${pad(Math.floor(t % 60))}`;
const stored = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
let currentTheme = stored("raqeeb_theme", "dark"), currentLang = stored("raqeeb_lang", "en");
const T = (en, ar) => currentLang === "ar" ? ar : en;
const D = { cameras: [], analyses: new Map(), incidents: [], connected: false,
  view: "live", query: "", running: false, frames: new Map(), shown: new Set(),
  loading: new Set(), capabilities: [], error: "", unread: 0, muted: false,
  session: 0, focus: "", pendingAlerts: [], alertOpen: false, chatBusy: false,
  demo: stored("raqeeb_demo", "false") === "true" };
let base = (new URLSearchParams(location.search).get("ai") || stored("raqeeb.ai", "") ||
  (location.protocol === "file:" ? "http://localhost:8000" : "")).replace(/\/+$/, "");
const api = path => `${base}${path}`;
const NAV = [["webcam", "Live Webcam", "\u0643\u0627\u0645\u064a\u0631\u0627 \u0645\u0628\u0627\u0634\u0631\u0629", ""], ["live", "Live Monitoring", "البث المباشر", "▶"],
  ["overview", "Overview", "نظرة عامة", "◫"], ["alerts", "Security Alerts", "التنبيهات الأمنية", "⚠"],
  ["people", "People Tracking", "تتبع الأشخاص", "☰"], ["cams", "Cameras", "الكاميرات", "◎"],
  ["inc", "Incidents", "الحوادث", "⛨"], ["evid", "Evidence", "الأدلة", "▣"],
  ["cyber", "Cybersecurity Logs", "سجلات الأمن السيبراني", "⌗"],
  ["ana", "Analytics", "التحليلات", "▤"], ["health", "System Health", "صحة النظام", "♡"],
  ["set", "Settings", "الإعدادات", "⚙"]];
const badge = (text, color="var(--cy)") => `<span class="b" style="--c:${color}">${esc(text)}</span>`;
const SEVERITY_COLORS = {CRITICAL:"var(--rd)", HIGH:"var(--or)", MEDIUM:"var(--am)", LOW:"var(--bl)", INFO:"var(--cy)"};
const severityColor = level => SEVERITY_COLORS[String(level).toUpperCase()] || SEVERITY_COLORS.INFO;
function severityBadge(level="INFO") {
  level=String(level).toUpperCase(); if (!(level in SEVERITY_COLORS)) level="INFO";
  const labels={CRITICAL:T("CRITICAL","حرج"),HIGH:T("HIGH","عالٍ"),MEDIUM:T("MEDIUM","متوسط"),LOW:T("LOW","منخفض"),INFO:T("INFO","معلومات")};
  return `<span class="severity-badge" data-severity="${level}" style="--severity-color:${severityColor(level)}"><span aria-hidden="true">${["CRITICAL","HIGH"].includes(level) ? "⚠" : "●"}</span>${labels[level]}</span>`;
}
const active = e => !["Resolved", "False Positive"].includes(e.status);
const matches = o => !D.query || JSON.stringify(o).toLowerCase().includes(D.query.toLowerCase());
const cameraById = id => D.cameras.find(c => c.id === id);

async function request(path, options={}) {
  const response = await fetch(api(path), {cache:"no-store", ...options, signal: AbortSignal.timeout(15000)});
  if (!response.ok) { const error=await response.json().catch(()=>({})); throw new Error(error.error || `Server returned ${response.status}`); }
  return response.json();
}
function post(path, data) {
  return request(path, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)});
}
function toast(message, severity="INFO") {
  const node = document.createElement("div"); node.textContent = message;
  node.className="severity-toast"; node.dataset.severity=severity;
  node.style.setProperty("--severity-color", severityColor(severity)); node.setAttribute("role","status");
  $("#ts").append(node); setTimeout(() => node.remove(), 3500);
}
function applyTheme(theme) {
  currentTheme = theme; save("raqeeb_theme", theme);
  document.documentElement.dataset.theme = theme;
  $("#themeToggle").innerHTML = uiIcon("sun",13)+(theme === "dark" ? T("Light", "\u0627\u0644\u0641\u0627\u062a\u062d") : T("Dark", "\u0627\u0644\u062f\u0627\u0643\u0646"));
}
function toggleTheme() { applyTheme(currentTheme === "dark" ? "light" : "dark"); }
function applyLang(lang) {
  currentLang = lang; save("raqeeb_lang", lang);
  document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  $("#langToggle").textContent = T("\u0627\u0644\u0639\u0631\u0628\u064a\u0629", "English");
  $("#q").placeholder = T("Search cameras, people, or weapon alerts…", "ابحث عن كاميرا أو شخص أو تنبيه سلاح…");
  $("#chatLaunchBtn").textContent = T("AI Assistant", "المساعد الذكي");
  $("#chatTitle").textContent = T("AI Camera Assistant", "مساعد الكاميرات الذكي");
  $("#chatSub").textContent = T("Ask about people, incidents, and camera evidence", "اسأل عن الأشخاص والحوادث وأدلة الكاميرات");
  $("#chatWelcome").textContent = T("Ask about people, clothing, incidents, or evidence in the analyzed camera footage.", "اسأل عن الأشخاص أو الملابس أو الحوادث أو الأدلة في تسجيلات الكاميرات المحللة.");
  $("#chatSampleChip").textContent = T("Summarize the open incidents", "لخّص الحوادث المفتوحة");
  $("#chatInput").placeholder = T("Ask a question about the camera footage…", "اسأل عن تسجيلات الكاميرات…");
  $("#chatSubmitBtn").textContent = D.chatBusy ? T("Thinking…", "جارٍ التحليل…") : T("Ask", "إرسال");
  $("#sysAiLabel").textContent = T("AI detector:", "كاشف الذكاء الاصطناعي:");
  $("#sysSyncLabel").textContent = T("Last sync:", "آخر مزامنة:");
  applyTheme(currentTheme); render();
}
function toggleLang() { applyLang(currentLang === "ar" ? "en" : "ar"); }
function go(view) {
  document.querySelectorAll("video[data-camera]").forEach(v => {
    const state = D.frames.get(v.dataset.camera) || {};
    state.savedTime = v.currentTime; D.frames.set(v.dataset.camera, state);
  });
  D.view = view; D.query = ""; $("#q").value = ""; render(); scrollTo(0,0);
}
function sq(value) {
  D.query = value;
  if (D.view === "live") {
    document.querySelectorAll(".camera-card").forEach(el => el.hidden = !matches(cameraById(el.dataset.id)));
  } else render();
}
function pageHead(title, subtitle, actions="") { return uiHead(title, subtitle, actions); }
function empty(text) { return `<div class="card empty-state">${text}</div>`; }
function stat(label, value, detail="") { return `<div class="card"><span class="mu">${label}</span><b class="big">${value}</b><small class="mu">${detail}</small></div>`; }
function playbackButtons() {
  return `<button class="btn" id="monitorButton" onclick="toggleMonitoring()">${D.running ? T("Ⅱ Pause all", "Ⅱ إيقاف الكل") : T("▶ Start monitoring", "▶ بدء المراقبة")}</button><button class="btn o" onclick="restartMonitoring()">${T("↻ Restart footage", "↻ إعادة المقاطع")}</button><button class="btn o" id="soundButton" onclick="toggleSound()">${D.muted ? T("Sound off", "الصوت معطل") : T("Sound on", "الصوت مفعل")}</button>`;
}
function liveView() { return uiLiveView(); }
function cameraCard(c) { return uiCameraCard(c); }
function syncCameraCards() {
  if (D.view !== "live") return;
  const grid = $("#cameraGrid");
  grid.querySelectorAll(".camera-card").forEach(card => {
    if (!cameraById(card.dataset.id)) { card.querySelector("video")?.pause(); card.remove(); }
  });
  for (const c of D.cameras.filter(c=>c.source_type!=="webcam")) {
    let card = grid.querySelector(`[data-id="${c.id}"]`);
    if (!card) { grid.insertAdjacentHTML("beforeend", cameraCard(c)); card = grid.lastElementChild; }
    card.hidden = !matches(c) || (D.focus && D.focus !== c.id);
    const status = card.querySelector(".camera-status");
    status.textContent = c.status === "ready" ? T("AI READY", "جاهز") : c.status === "analyzing" ? `${T("ANALYZING", "تحليل")} ${c.progress}%` : c.status.toUpperCase();
    status.style.setProperty("--c", c.status === "error" ? "var(--rd)" : c.status === "ready" ? "var(--gr)" : "var(--am)");
    const wait = card.querySelector(".camera-wait");
    const analyzed = D.analyses.has(c.id);
    wait.hidden = analyzed;
    wait.innerHTML = c.status === "error" ? `<b>${T("Analysis unavailable", "التحليل غير متاح")}</b><small>${esc(c.error)}</small>` :
      `<span class="loading-ring"></span><b>${c.status === "analyzing" ? T("Analyzing footage", "تحليل المقطع") : T("Preparing camera", "تجهيز الكاميرا")}</b><small>${c.progress}% · ${T("Playback begins after AI analysis is ready", "يبدأ التشغيل بعد اكتمال التحليل")}</small>`;
    if (analyzed && !card.querySelector("video")) {
      const video = document.createElement("video");
      video.dataset.camera = c.id; video.muted = true; video.loop = true;
      video.playsInline = true; video.controls = true; video.preload = "auto";
      video.src = api(c.video_url);
      video.setAttribute("aria-label", `${c.id}: ${c.filename}`);
      video.addEventListener("loadedmetadata", () => {
        const state = D.frames.get(c.id);
        if (state?.savedTime) video.currentTime = state.savedTime;
        if (D.running) video.play().catch(() => toast(T("Press play on the camera to start", "اضغط التشغيل لبدء الكاميرا")));
      });
      if (video.requestVideoFrameCallback) {
        const paint = (_, metadata) => {
          if (!video.isConnected) return;
          paintVideo(video, metadata.mediaTime);
          video.requestVideoFrameCallback(paint);
        };
        video.requestVideoFrameCallback(paint);
      }
      video.addEventListener("error", () => {
        wait.hidden = false; wait.innerHTML = `<b>${T("Video playback unavailable", "تشغيل الفيديو غير متاح")}</b><small>${T("This video codec may need conversion to H.264 MP4.", "قد يتطلب ترميز الفيديو التحويل إلى H.264 MP4.")}</small>`;
      });
      card.querySelector(".camera-stage").prepend(video);
      card.querySelector(".camera-poster").hidden = true;
    }
  }
  $("#readyCount").textContent = D.cameras.filter(c => c.source_type!=="webcam" && D.analyses.has(c.id)).length;
  $("#connectionNote").innerHTML = !D.connected ? empty(T("Backend offline. Run <code>.venv\\Scripts\\python.exe server.py</code> and open <a href='http://localhost:8000'>localhost:8000</a>.", "الخادم غير متصل. شغّل server.py وافتح localhost:8000.")) :
    !D.cameras.length ? empty(T("No videos found. Add video files to examples/ or samples/ and restart the server.", "لا توجد مقاطع. أضف المقاطع إلى examples/ أو samples/ وأعد تشغيل الخادم.")) : "";
  paintActivity();
}
let audioContext;
function unlockSound() {
  try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); audioContext.resume(); } catch {}
}
function beep() {
  if (D.muted || !audioContext || audioContext.state !== "running") return;
  for (let i=0; i<3; i++) {
    const tone = audioContext.createOscillator(), gain = audioContext.createGain();
    tone.type = "sine"; tone.frequency.value = i % 2 ? 660 : 880;
    gain.gain.value = .12; tone.connect(gain); gain.connect(audioContext.destination);
    tone.start(audioContext.currentTime + i*.25); tone.stop(audioContext.currentTime + i*.25+.18);
  }
}
function toggleSound() { D.muted = !D.muted; unlockSound(); updatePlaybackChrome(); }
function toggleMonitoring() {
  unlockSound(); D.running = !D.running;
  document.querySelectorAll("video[data-camera]").forEach(v => D.running ? v.play().catch(() => {}) : v.pause());
  updatePlaybackChrome();
}
function restartMonitoring() {
  D.session++; D.shown.clear(); D.pendingAlerts = []; closeM(); D.running = true; unlockSound();
  D.frames.clear();
  document.querySelectorAll("video[data-camera]").forEach(v => { v.currentTime = 0; v.play().catch(() => {}); });
  updatePlaybackChrome(); toast(T("Footage restarted. Detection alerts are rearmed.", "أعيد تشغيل المقاطع وتفعيل التنبيهات."));
}
function updatePlaybackChrome() {
  const button = $("#monitorButton");
  if (button) button.innerHTML = uiIcon(D.running?"pause":"play",14)+(D.running ? T("Pause all", "\u0625\u064a\u0642\u0627\u0641 \u0627\u0644\u0643\u0644") : T("Start monitoring", "\u0628\u062f\u0621 \u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629"));
  if ($("#monitorState")) $("#monitorState").textContent = D.running ? T("Monitoring recorded sources", "مراقبة المصادر المسجلة") : T("Playback paused", "التشغيل متوقف");
  if ($("#soundButton")) $("#soundButton").innerHTML = uiIcon("sound",14)+(D.muted ? T("Sound off", "\u0627\u0644\u0635\u0648\u062a \u0645\u0639\u0637\u0644") : T("Sound on", "\u0627\u0644\u0635\u0648\u062a \u0645\u0641\u0639\u0644"));
}
function sampleAt(analysis, time) {
  const frames = analysis.frames; let lo=0, hi=frames.length-1, index=-1;
  while (lo <= hi) { const mid=(lo+hi)>>1; if (frames[mid].time <= time) { index=mid; lo=mid+1; } else hi=mid-1; }
  if (index < 0 || time - frames[index].time >= Math.max(.5, 2 / analysis.sample_fps)) return null;
  const frame=frames[index], next=frames[index+1];
  if (!next || next.time-frame.time>.3) return frame;
  const fraction=Math.max(0, Math.min(1,(time-frame.time)/(next.time-frame.time)));
  const following=new Map(next.dets.filter(d=>d.class==="person" && d.id).map(d=>[d.id,d]));
  return {...frame,dets:frame.dets.map(d=>{
    const later=d.class==="person" && following.get(d.id);
    return later ? {...d,box:d.box.map((value,i)=>value+(later.box[i]-value)*fraction)} : d;
  })};
}
function paintBoxes(overlay,detections,camera,threats) {
  const present=new Set();
  for (let index=0; index<detections.length; index++) {
    const d=detections[index], key=`${d.class}:${d.id || d.person_id || index}`;
    present.add(key);
    let node=[...overlay.children].find(n=>n.dataset.key===key);
    if (!node) { node=document.createElement("div"); node.dataset.key=key; node.append(document.createElement("span")); overlay.append(node); }
    const suspect=d.class==="person" && threats.some(w=>w.person_id===d.id);
    node.className=`detection-box ${d.weapon || suspect ? "weapon-box" : ""}`;
    const [x1,y1,x2,y2]=d.box;
    Object.assign(node.style,{left:`${x1/camera.width*100}%`,top:`${y1/camera.height*100}%`,width:`${(x2-x1)/camera.width*100}%`,height:`${(y2-y1)/camera.height*100}%`});
    const label=`${d.weapon ? d.class.toUpperCase() : d.class==="person" ? d.id ?? "Person" : d.class} ${Math.round(d.conf*100)}%`;
    if (node.firstChild.textContent!==label) node.firstChild.textContent=label;
  }
  [...overlay.children].forEach(node=>{if (!present.has(node.dataset.key)) node.remove();});
}
function paintVideo(video, mediaTime=video.currentTime) {
  const cid=video.dataset.camera, analysis=D.analyses.get(cid), camera=cameraById(cid);
  if (!D.connected || !analysis || !camera || video.readyState < 2) {
    video.closest(".camera-card")?.querySelector(".camera-overlay")?.replaceChildren();
    return;
  }
  const time=mediaTime, frame=sampleAt(analysis,time), state=D.frames.get(cid) || {};
  const card=video.closest(".camera-card"), threats=(frame?.dets || []).filter(d => d.weapon);
  card.classList.toggle("threat-active", threats.length > 0);
  card.querySelector(".camera-clock").textContent = `${sourceTime(time)} / ${sourceTime(camera.duration)}`;
  paintBoxes(card.querySelector(".camera-overlay"),frame?.dets || [],camera,threats);
  if (state.sample !== frame?.time) {
    card.querySelector(".camera-detections").textContent = threats.length ? threats.map(d => `${d.class.toUpperCase()} ${Math.round(d.conf*100)}%`).join(" · ") : `${frame?.dets.filter(d => d.class === "person").length || 0} ${T("people in view", "أشخاص في المشهد")}`;
    state.sample=frame?.time;
  }
  // Seeking to a threat also activates it. A sampled weapon must be on screen;
  // skipped or unwatched portions of a recording never produce timed fake alerts.
  if (!video.paused && threats.length) {
    for (const event of analysis.events) {
      if (time >= event.time && time <= event.end + 1/analysis.sample_fps &&
          threats.some(d => d.class === event.class && d.person_id === event.person_id) && !D.shown.has(event.id)) {
        D.shown.add(event.id); activateEvent(event);
      }
    }
  }
  state.observedAt=Date.now(); state.time=time; state.savedTime=time; state.dets=frame?.dets || [];
  D.frames.set(cid,state);
}
async function activateEvent(event) {
  const session=D.session;
  try {
    const incident=await post("/api/incidents", {camera:event.camera,event_id:event.id});
    D.incidents=[incident,...D.incidents.filter(e => e.id !== incident.id)];
    if (["False Positive","Resolved"].includes(incident.status)) return;
    if (session !== D.session) return;
    D.unread++; updateChrome(); paintActivity();
    toast(`${incident.type} · ${incident.camera}${incident.person_id ? ` · ${incident.person_id}` : ""}`,incident.severity);
    D.pendingAlerts.push(incident); beep(); showNextAlert();
  } catch (error) {
    D.shown.delete(event.id);
    toast(T("Could not save the weapon alert. Check the backend.", "تعذر حفظ التنبيه. تحقق من الخادم."));
  }
}
function showNextAlert() {
  if (D.alertOpen || !D.pendingAlerts.length) return;
  const event=D.pendingAlerts.shift(); D.alertOpen=true;
  const level=event.severity || "CRITICAL";
  document.body.style.setProperty("--severity-color",severityColor(level));
  document.body.classList.add("lockdown");
  openM(`<div class="weapon-alert"><div class="alert-kicker">${severityBadge(event.severity)}</div><h1>${esc(event.type)}</h1><p class="mu">${event.camera} · ${esc(event.filename)} · ${event.source_type==='webcam'?T("Session time", "وقت الجلسة"):T("Footage time", "وقت المقطع")} ${sourceTime(event.time)} · ${Math.round(event.conf*100)}% ${T("confidence", "ثقة")} · ${esc(event.person_id||'')}</p><img class="evidence-image" src="${api(event.snapshot_url)}" alt="${esc(event.type)} evidence"><div class="am"><button class="btn" onclick="acknowledge('${event.id}')">${T("Acknowledge alert", "تأكيد الاطلاع")}</button><button class="btn o" onclick="closeM();focusCamera('${event.camera}',${event.time})">${T("Inspect camera", "فحص الكاميرا")}</button></div></div>`,"critical-modal");
}
async function acknowledge(id) {
  await setSt(id,"Under Review"); closeM();
}
function openM(html, classes="") { $("#mb").className=`md ${classes}`; $("#mb").innerHTML=html; $("#m").classList.add("on"); }
function closeM() {
  if (typeof evidenceInterval !== "undefined" && evidenceInterval) { clearInterval(evidenceInterval); evidenceInterval = null; }
  $("#m").classList.remove("on"); document.body.classList.remove("lockdown");
  document.body.style.removeProperty("--severity-color");
  D.alertOpen=false;
  setTimeout(showNextAlert,300);
}
async function setSt(id,status) {
  try {
    const incident=await post("/api/incidents/status",{id,status});
    D.incidents=D.incidents.map(e => e.id===id ? incident : e);
    updateChrome(); paintActivity(); return true;
  } catch { toast(T("Could not save incident status", "تعذر حفظ حالة الحادث")); return false; }
}
function incidentRows() {
  const statuses=["New","Under Review","Investigating","Confirmed","False Positive","Resolved"];
  return D.incidents.filter(e => D.view === "inc" || active(e)).filter(matches).map(e => `<tr class="incident-row" style="--severity-color:${severityColor(e.severity)}"><td>${esc(e.detected_at.replace("T"," "))}</td><td>${e.camera}</td><td><strong>${esc(e.type)}</strong><div>${severityBadge(e.severity)}</div>${e.person_id ? `<div class="mu">${esc(e.person_id)}</div>` : ""}</td><td>${sourceTime(e.time)}</td><td>${Math.round(e.conf*100)}%</td><td><select aria-label="Incident status" onchange="setSt('${e.id}',this.value)">${statuses.map(s => `<option${s===e.status ? " selected" : ""}>${s}</option>`).join("")}</select></td><td><button class="btn o" onclick="openAlert('${e.id}')">${T("Evidence", "الأدلة")}</button></td></tr>`).join("");
}
function incidentsView() { return uiIncidentsView(); }
let evidenceInterval = null;
function updateEvidenceScrubber(offset, id) {
  offset = parseFloat(offset);
  const label = $("#evidenceTimeOffset");
  if (label) {
    label.textContent = offset === 0 ? T("At incident detection moment (0.0s)", "عند لحظة رصد الحادث (0.0 ث)") :
      offset < 0 ? `${Math.abs(offset).toFixed(1)}s ${T("BEFORE incident", "قبل الحادث")}` :
      `${offset.toFixed(1)}s ${T("AFTER incident", "بعد الحادث")}`;
  }
}
function toggleEvidencePlayback(id) {
  const btn = $("#evidencePlayBtn"), range = $("#evidenceRange");
  if (!range) return;
  if (evidenceInterval) {
    clearInterval(evidenceInterval); evidenceInterval = null;
    if (btn) btn.textContent = "▶";
  } else {
    if (parseFloat(range.value) >= 30) range.value = -30;
    if (btn) btn.textContent = "❚❚";
    evidenceInterval = setInterval(() => {
      let val = parseFloat(range.value) + 0.5;
      if (val > 30) { val = 30; clearInterval(evidenceInterval); evidenceInterval = null; if (btn) btn.textContent = "▶"; }
      range.value = val;
      updateEvidenceScrubber(val, id);
    }, 100);
  }
}
function fullscreenEvidence() {
  const img = document.querySelector(".evidence-image");
  img?.requestFullscreen?.().catch(() => {});
}
function openAlert(id) {
  const e=D.incidents.find(e => e.id===id); if (!e) return;
  const WF = [T("Detection", "الكشف"), T("Alert generated", "إنشاء التنبيه"), T("Operator review", "مراجعة المشغل"), T("Video verification", "التحقق بالفيديو"), T("Confirmed / False positive", "مؤكد / إنذار كاذب"), T("Response", "الاستجابة"), T("Resolved", "تم الحل")];
  const WI = {"New":1, "Under Review":2, "Investigating":3, "Confirmed":4, "False Positive":4, "Resolved":6};
  const step = WI[e.status] ?? 1;
  const stepper = `<div class="wf">${WF.map((w,i)=>`<div class="${i<step||(i===step&&step===6)?'d':i===step?'a':''}">${w}</div>`).join('')}</div>`;
  const scrubber = `<div class="evidence-scrubber"><div class="scrubber-track"><button class="btn o" id="evidencePlayBtn" type="button" onclick="toggleEvidencePlayback('${e.id}')">▶</button><input type="range" id="evidenceRange" min="-30" max="30" step="0.5" value="0" oninput="updateEvidenceScrubber(this.value,'${e.id}')"><button class="btn o" type="button" onclick="this.textContent=this.textContent==='🔊'?'🔇':'🔊'">🔊</button><button class="btn o" type="button" onclick="fullscreenEvidence()">⛶</button></div><div class="scrubber-labels"><span>-30s</span><span>-15s</span><b style="color:var(--rd)">● ${T("INCIDENT MOMENT", "لحظة الحادث")}</b><span>+15s</span><span>+30s</span></div><div id="evidenceTimeOffset" class="mu" style="font-size:11px;text-align:center">${T("At incident detection moment (0.0s)", "عند لحظة رصد الحادث (0.0 ث)")}</div></div>`;
  openM(`<button class="x" onclick="closeM()">×</button><h1>${esc(e.type)}</h1>${severityBadge(e.severity)}<p class="mu">${e.camera} · ${esc(e.filename)} · ${sourceTime(e.time)} · ${Math.round(e.conf*100)}%</p>${stepper}<img class="evidence-image" src="${api(e.snapshot_url)}" alt="Weapon detection evidence">${scrubber}<div class="am"><button class="btn" onclick="closeM();focusCamera('${e.camera}',${e.time})">${e.source_type === "webcam" ? T("Open webcam", "\u0641\u062a\u062d \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627") : T("Review footage", "مراجعة المقطع")}</button><a class="btn o" href="${api(e.snapshot_url)}" download="${e.id}.jpg">${T("Download snapshot", "تحميل الصورة")}</a></div>`);
}
function paintActivity() {
  const element=$("#recentActivity"); if (!element) return;
  element.innerHTML=D.incidents.some(active) ? `<div class="tw"><table><thead><tr><th>${T("Camera", "الكاميرا")}</th><th>${T("Detection", "الكشف")}</th><th>${T("Source time", "وقت المقطع")}</th><th>${T("Confidence", "الثقة")}</th><th>${T("Status", "الحالة")}</th><th></th></tr></thead><tbody>${D.incidents.filter(active).slice(0,8).map(e => `<tr class="incident-row" style="--severity-color:${severityColor(e.severity)}"><td>${e.camera}</td><td><strong>${esc(e.type)}</strong><div>${severityBadge(e.severity)}</div>${e.person_id ? `<div class="mu">${esc(e.person_id)}</div>` : ""}</td><td>${sourceTime(e.time)}</td><td>${Math.round(e.conf*100)}%</td><td>${esc(e.status)}</td><td><button class="btn o" onclick="openAlert('${e.id}')">${T("View evidence", "عرض الأدلة")}</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="mu">${T("No weapon detections observed. Alerts appear here when a gun or knife is detected in the playing footage.", "لا يوجد كشف أسلحة بعد. تظهر التنبيهات عند اكتشاف سلاح في المقطع الجاري.")}</p>`;
}
function focusCamera(cid,time) {
  if(cid === "WEB-01") { go("webcam"); return; }
  D.focus=cid; go("live");
  const card=$(`[data-id="${cid}"]`); if (!card) return;
  card.scrollIntoView({behavior:"smooth",block:"center"});
  const video=card.querySelector("video");
  if (video && time!=null) { const seek=()=>{video.currentTime=time;video.play().catch(()=>{});}; video.readyState ? seek() : video.addEventListener("loadedmetadata",seek,{once:true}); }
  toast(T("Camera focused. Click Show all cameras to return.", "تم التركيز على الكاميرا. اضغط عرض الكل للعودة."));
}
function showAllCameras() { D.focus=""; syncCameraCards(); }
function fullscreenCamera(cid) { const el=$(`#stage-${cid}`); el?.requestFullscreen?.().catch(()=>toast(T("Full screen unavailable", "ملء الشاشة غير متاح"))); }
function tracks() {
  return [...new Map([...D.analyses.entries()].flatMap(([cid,a]) => a.tracks.map(t => ({...t,camera:cid,track:String(t.id)}))).map(t => [t.class+":"+t.id,t])).values()];
}
function openPerson(id) {
  const person=tracks().find(t=>t.class==="person" && t.id===id); if (!person) return;
  openM(`<div><button class="x" onclick="closeM()" aria-label="Close">&times;</button><h1>${esc(person.id)}</h1><p class="mu">${T("Anonymous person track", "تتبع شخص مجهول")}</p></div><div class="person-profile"><img src="${api(person.snapshot_url)}" alt="${esc(person.id)} screenshot from camera footage"><div class="g"><div class="kv"><div><small>${T("Camera", "الكاميرا")}</small>${person.camera}</div><div><small>${T("Clothing color", "لون الملابس")}</small>${esc(person.color)}</div><div><small>${T("First seen", "أول ظهور")}</small>${sourceTime(person.first_seen)}</div><div><small>${T("Last seen", "آخر ظهور")}</small>${sourceTime(person.last_seen)}</div><div><small>${T("Screenshot time", "وقت اللقطة")}</small>${sourceTime(person.snapshot_time || person.first_seen)}</div></div><div class="am"><button class="btn" onclick="closeM();focusCamera('${person.camera}',${person.snapshot_time || person.first_seen})">${person.source_type === "webcam" ? T("Open webcam", "\u0641\u062a\u062d \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627") : T("View in footage", "عرض في المقطع")}</button><a class="btn o" href="${api(person.snapshot_url)}" download="${person.id}.jpg">${T("Download screenshot", "تنزيل اللقطة")}</a></div></div></div>`);
}
function peopleView() { return uiPeopleView(); }
function overviewView() { return uiDashboard(); }
function camerasView() { return uiCamerasView(); }
function evidenceView() { return uiEvidenceView(); }
function healthView() { return uiHealthView(); }
function analyticsView() { return uiDashboard(true); }
function settingsView() { return uiSettingsView(); }
function aiSetUrl(value) {
  try { if (value.trim()) { const url=new URL(value.trim()); if (!["http:","https:"].includes(url.protocol)) throw new Error(); } }
  catch { return toast(T("Enter an HTTP or HTTPS URL", "أدخل رابط HTTP أو HTTPS")); }
  base=value.trim().replace(/\/+$/,""); save("raqeeb.ai",base); D.analyses.clear(); D.cameras=[]; D.connected=false; render();
}
function render() {
  document.querySelectorAll("video[data-camera]").forEach(video => {
    const state=D.frames.get(video.dataset.camera) || {};
    state.savedTime=video.currentTime; D.frames.set(video.dataset.camera,state); video.pause();
  });
  $("#nl").innerHTML=uiNavigation();
  const views={webcam:uiWebcamView,live:liveView,overview:overviewView,alerts:incidentsView,inc:incidentsView,people:peopleView,cams:camerasView,evid:evidenceView,cyber:uiCyberView,health:healthView,ana:analyticsView,set:settingsView};
  $("#main").innerHTML=(views[D.view] || liveView)()+`<footer class="view-footer"><span>RAQEEB &nbsp; / &nbsp; ${T("SECURITY OPERATIONS", "عمليات الأمن")}</span><span>${T("Recorded sources · Local analysis", "مصادر مسجلة · تحليل محلي")}</span></footer>`;
  if (D.view==="live") { if (D.focus) $(".page-actions").insertAdjacentHTML("afterbegin",`<button class="btn o" onclick="D.focus='';render()">${T("Show all cameras", "عرض كل الكاميرات")}</button>`); syncCameraCards(); }
  if (D.view === "webcam") webcamMount();
  const mapHost=$("#main").querySelector('[data-role="site-map"]');
  if(window.SiteMap3D) { mapHost ? SiteMap3D.mount(mapHost) : SiteMap3D.unmount(); }
  paintActivity(); updateChrome();
}
function updateChrome() {
  const ready=D.cameras.filter(c=>["ready","live"].includes(c.status)).length;
  const processing=D.cameras.some(c=>["queued","analyzing","starting"].includes(c.status));
  $("#modeLabel").textContent=T("RECORDED CAMERAS", "كاميرات مسجلة");
  $("#aic").textContent=!D.connected ? T("AI: offline", "الذكاء الاصطناعي: غير متصل") : `${T("AI ready", "جاهز")}: ${ready}/${D.cameras.length}`;
  $("#aist").textContent=!D.connected ? "OFFLINE" : D.error ? "ERROR" : !processing && ready ? "READY" : "ANALYZING";
  $("#aist").style.color=D.error ? "var(--rd)" : "var(--cy)";
  $("#sysOnlineText").textContent=D.connected ? T("SYSTEM CONNECTED", "النظام متصل") : T("BACKEND OFFLINE", "الخادم غير متصل");
  $("#sysCamsText").textContent=`${T("Camera sources", "مصادر الكاميرات")}: ${D.cameras.length} · ${ready} ${T("ready", "جاهزة")}`;
  $("#sysDateLabel").textContent=new Date().toLocaleDateString(currentLang==="ar" ? "ar-SA" : "en-GB");
  $("#bc").textContent=D.unread;
  $("#bc").classList.toggle("has-unread",D.unread>0);
  const dm = $("#dm");
  if (dm) {
    dm.textContent = D.demo ? T("Demo: ON", "العرض: مفعل") : T("Demo: OFF", "العرض: معطل");
    dm.classList.toggle("on", D.demo);
  }
  uiUpdateChrome();
  window.SiteMap3D?.refresh();
}
async function loadAnalysis(c) {
  if (D.loading.has(c.id)) return;
  if (c.source_type === "webcam" && W.active && D.analyses.has(c.id)) return;
  if (c.source_type !== "webcam" && D.analyses.get(c.id)?.fingerprint === c.analysis_revision) return;
  D.loading.add(c.id);
  try { const a=await request(c.analysis_url); if (a.frames) { const old=D.analyses.get(c.id); a._mapSeenAt=old?.frames.at(-1)?.time===a.frames.at(-1)?.time ? old._mapSeenAt : Date.now(); D.analyses.set(c.id,a); D.frames.delete(c.id); } }
  catch { /* Catalog polling retries when the backend is available. */ }
  finally { D.loading.delete(c.id); }
}
async function poll() {
  try {
    const catalog=await request("/api/cameras");
    if (!Array.isArray(catalog.cameras)) throw new Error("Recorded camera backend required");
    const changed=JSON.stringify(D.cameras.map(c=>[c.id,c.status,c.analysis_revision])) !== JSON.stringify(catalog.cameras.map(c=>[c.id,c.status,c.analysis_revision]));
    D.connected=true; D.cameras=catalog.cameras; D.capabilities=catalog.capabilities;
    for (const id of D.analyses.keys()) if (!cameraById(id)) { D.analyses.delete(id); D.frames.delete(id); }
    D.error=catalog.model_error || ""; D.incidents=catalog.incidents;
    await Promise.all(D.cameras.filter(c=>c.status==="ready" || c.source_type==="webcam").map(loadAnalysis));
    if (D.view==="live") syncCameraCards();
    else if (changed && !D.query) render();
    updateChrome(); document.querySelectorAll(".sy").forEach(e=>e.textContent=new Date().toLocaleTimeString());
  } catch (error) {
    D.connected=false; D.error=error.message; updateChrome();
    if (D.view==="live") syncCameraCards();
  }
  setTimeout(poll,2000);
}
function bell() {
  $("#np").classList.toggle("on"); D.unread=0; updateChrome();
  $("#np").innerHTML=D.incidents.filter(active).slice(0,8).map(e=>`<div class="nt" style="--c:${severityColor(e.severity)};cursor:pointer" onclick="openAlert('${e.id}')">${severityBadge(e.severity)}<b>${esc(e.type)}</b><div class="mu">${e.camera} · ${sourceTime(e.time)} · ${esc(e.status)}</div></div>`).join("") || `<p class="mu">${T("No notifications", "لا توجد إشعارات")}</p>`;
}
function toggleChat() { const opened=$("#chat").classList.toggle("on"); $("#chatLaunchBtn").setAttribute("aria-expanded",opened); if(opened) $("#chatInput").focus(); }
function submitChat(event) { event.preventDefault(); chatSearch($("#chatInput").value); }
async function chatSearch(query) {
  query=query.trim(); if (!query || D.chatBusy) return;
  D.chatBusy=true;
  const submit=$("#chatSubmitBtn"), log=$("#chatLog");
  const message=document.createElement("div"); message.className="chat-msg user"; message.textContent=query; log.append(message);
  const answer=document.createElement("div"); answer.className="chat-msg"; answer.setAttribute("aria-live","polite");
  answer.textContent=T("Reviewing camera records and snapshots…", "جارٍ مراجعة سجلات الكاميرات واللقطات…"); log.append(answer);
  $("#chatInput").value=""; submit.disabled=true; submit.textContent=T("Thinking…", "جارٍ التحليل…");
  log.scrollTop=log.scrollHeight;
  try {
    const response=await fetch(api("/api/chat"), {method:"POST",cache:"no-store",
      headers:{"Content-Type":"application/json"},body:JSON.stringify({message:query}),signal:AbortSignal.timeout(60000)});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error || `Server returned ${response.status}`);
    if(typeof result.answer!=="string" || !result.answer) throw new Error(T("The assistant returned an empty response.", "أعاد المساعد إجابة فارغة."));
    answer.textContent=result.answer;
    for(const image of result.images || []) {
      const figure=document.createElement("figure"); figure.className="chat-image";
      const link=document.createElement("a"); link.href=api(image.url); link.target="_blank"; link.rel="noopener noreferrer";
      const photo=document.createElement("img"); photo.src=api(image.url); photo.loading="lazy";
      photo.alt=`${image.kind === "incident" ? T("Incident evidence", "دليل الحادث") : T("Person snapshot", "لقطة الشخص")} ${image.id}`;
      const caption=document.createElement("figcaption");
      caption.textContent=`${image.kind === "incident" ? T("Incident", "حادث") : T("Person", "شخص")} ${image.id} · ${image.camera}`;
      link.append(photo); figure.append(link,caption); log.append(figure);
    }
  } catch(error) {
    answer.textContent=`${T("Assistant error", "تعذر تشغيل المساعد")}: ${error.message}`;
  } finally {
    D.chatBusy=false; submit.disabled=false; submit.textContent=T("Ask", "إرسال");
    log.scrollTop=log.scrollHeight;
  }
}
document.addEventListener("keydown",event=>{
  const typing=event.target.matches("input,textarea,select,[contenteditable]");
  if(event.key==="/" && !typing) { event.preventDefault(); $("#q").focus(); }
  if(event.key==="Escape") { if($("#m").classList.contains("on")) closeM(); else if($("#chat").classList.contains("on")) toggleChat(); }
});
setInterval(()=>document.querySelectorAll("video[data-camera]").forEach(video => {
  if (!video.requestVideoFrameCallback) paintVideo(video);
}),40);
/* Demo simulation (from Raqeeb-Live-CAM): client-side cyber/predictive events only.
   It never creates fake weapon incidents in the backend, so real detections stay trustworthy. */
const DEMO_EVENTS = [
  {sev:"HIGH", ev:["Abnormal network traffic","حركة شبكة غير طبيعية"], tg:"CAM-22", x:"2.1 Gbps"},
  {sev:"MEDIUM", ev:["Repeated failed login attempts","محاولات دخول فاشلة متكررة"], tg:"NVR-01", x:"19 attempts"},
  {sev:"MEDIUM", ev:["CAM-24 may fail in ~8 minutes","الكاميرا CAM-24 قد تتعطل خلال 8 دقائق"], tg:"CAM-24", x:"Predictive"},
  {sev:"LOW", ev:["Unusual bandwidth usage","استخدام غير عادي للنطاق"], tg:"CAM-12", x:"+180%"}
];
let demoIndex = 0;
window.CYBER_EXTRA = [];
function toggleDemo() {
  D.demo = !D.demo; save("raqeeb_demo", String(D.demo));
  toast(D.demo ? T("Demo simulation on", "تم تفعيل المحاكاة") : T("Demo simulation off", "تم تعطيل المحاكاة"));
  updateChrome(); if (D.view === "set" || D.view === "cyber") render();
}
function demoTick() {
  if (!D.demo) return;
  const e = DEMO_EVENTS[demoIndex++ % DEMO_EVENTS.length];
  const t = new Date().toLocaleTimeString("en-GB", {hour12:false});
  window.CYBER_EXTRA.unshift({t, ev:T(...e.ev), tg:e.tg, src:`10.20.${demoIndex%9}.${20+demoIndex%200}`, x:e.x, sev:e.sev, st:T("Mitigating","قيد المعالجة")});
  if (window.CYBER_EXTRA.length > 20) window.CYBER_EXTRA.pop();
  toast(`${T(...e.ev)} — ${e.tg}`, e.sev);
  if (D.view === "cyber" && !D.query) render();
}
setInterval(demoTick, 8000);
applyLang(currentLang); poll();
