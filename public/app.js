(()=>{const s={audio:new Audio(),ctx:null,src:null,gain:null,analyser:null,url:null,duration:0};const $=id=>document.getElementById(id), panel=$('audioEditorPanel'),canvas=$('audioSpectrum'),g=canvas?.getContext('2d');if(!panel||!canvas)return;const state=(t,c='idle')=>{const e=$('audioEditorState');e.textContent=t;e.className='audio-editor-state '+c};const fmt=t=>{if(!isFinite(t))return'00:00';let m=Math.floor(t/60),ss=Math.floor(t%60).toString().padStart(2,'0');return String(m).padStart(2,'0')+':'+ss};function graph(){if(!s.analyser||!g)return;let d=new Uint8Array(s.analyser.frequencyBinCount);const loop=()=>{requestAnimationFrame(loop);s.analyser.getByteFrequencyData(d);g.clearRect(0,0,canvas.width,canvas.height);let grd=g.createLinearGradient(0,0,canvas.width,0);grd.addColorStop(0,'#6b5cff');grd.addColorStop(1,'#26c6ff');g.fillStyle=grd;let step=Math.max(1,Math.floor(d.length/120)),bw=canvas.width/120;for(let i=0,x=0;i<d.length;i+=step,x++){let h=Math.max(2,d[i]/255*(canvas.height-20));g.fillRect(x*bw,canvas.height-h,Math.max(1,bw-2),h)}};loop()}function ctx(){if(s.ctx)return;s.ctx=new(window.AudioContext||window.webkitAudioContext)();s.src=s.ctx.createMediaElementSource(s.audio);s.gain=s.ctx.createGain();s.analyser=s.ctx.createAnalyser();s.analyser.fftSize=2048;s.src.connect(s.gain);s.gain.connect(s.analyser);s.analyser.connect(s.ctx.destination);graph()}function ready(){panel.classList.remove('is-hidden');state('READY','ready')}function loadFile(f){if(!f)return;s.file=f;if(s.url)URL.revokeObjectURL(s.url);s.url=URL.createObjectURL(f);s.audio.src=s.url;s.audio.load();$('audioEditorSource').textContent=f.name;ready();try{ctx()}catch{}}$('audioEditorFile')?.addEventListener('change',e=>loadFile(e.target.files?.[0]));$('audioEditorLoadBtn')?.addEventListener('click',()=>{let f=$('audioEditorFile').files?.[0],u=$('audioEditorUrl').value.trim();if(f)loadFile(f);else if(u){panel.classList.remove('is-hidden');$('audioEditorSource').textContent=u;state('URL','ready');$('audioEditorMessage').textContent='URL loaded; use the existing server URL importer to resolve it.'}else $('audioEditorMessage').textContent='Choose a file or enter a URL.'});['audioGain','audioSpeed','audioFadeIn','audioFadeOut'].forEach(id=>$(id)?.addEventListener('input',()=>{let gd=+$('audioGain').value; $('audioGainValue').value=gd.toFixed(1)+' dB';$('audioSpeedValue').value=(+$('audioSpeed').value).toFixed(2)+'x';$('audioFadeInValue').value=(+$('audioFadeIn').value).toFixed(1)+'s';$('audioFadeOutValue').value=(+$('audioFadeOut').value).toFixed(1)+'s';if(s.gain)s.gain.gain.value=Math.pow(10,gd/20);s.audio.playbackRate=+$('audioSpeed').value}));$('audioPreviewBtn')?.addEventListener('click',async()=>{if(!s.audio.src){$('audioEditorMessage').textContent='Load audio first.';return}ctx();if(s.ctx.state==='suspended')await s.ctx.resume();s.audio.play();state('PLAYING','playing')});$('audioStopBtn')?.addEventListener('click',()=>{s.audio.pause();s.audio.currentTime=0;state('READY','ready')});$('audioResetBtn')?.addEventListener('click',()=>{['audioGain','audioFadeIn','audioFadeOut'].forEach(id=>$(id).value=0);$('audioSpeed').value=1;$('audioGain').dispatchEvent(new Event('input'));$('audioEditorMessage').textContent='Reset.'});s.audio.addEventListener('loadedmetadata',()=>{s.duration=s.audio.duration;$('audioDuration').textContent=fmt(s.duration)});s.audio.addEventListener('timeupdate',()=>{$('audioCurrentTime').textContent=fmt(s.audio.currentTime);if(s.duration)$('audioSeek').value=Math.round(s.audio.currentTime/s.duration*1000)});$('audioSeek')?.addEventListener('input',()=>{if(s.duration)s.audio.currentTime=+$('audioSeek').value/1000*s.duration});$('audioApplyBtn')?.addEventListener('click',async()=>{if(!s.file){$('audioEditorMessage').textContent='Load a local file first.';return}state('PROCESSING','processing');let fd=new FormData();fd.append('file',s.file);fd.append('gain',$('audioGain').value);fd.append('speed',$('audioSpeed').value);fd.append('fadeIn',$('audioFadeIn').value);fd.append('fadeOut',$('audioFadeOut').value);try{let r=await fetch('/api/audio/edit',{method:'POST',body:fd});if(!r.ok)throw Error('HTTP '+r.status);let d=await r.json();$('audioEditorMessage').textContent=d.message||'Edit processed.';state('READY','ready')}catch(e){$('audioEditorMessage').textContent='Edit failed: '+e.message;state('ERROR','error')}});})();
const $ = s => document.querySelector(s);
const fileInput = $("#fileInput");
const dropzone = $("#dropzone");
const selected = $("#selected");
const uploadBtn = $("#uploadBtn");
const assetName = $("#assetName");
const audio = $("#audio");
let selectedFile = null;

async function api(url, options) {
  const r = await fetch(url, options);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}

function toast(msg, type="") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => el.className = "toast", 3200);
}

function formatSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B","KB","MB","GB"];
  let i=0, n=bytes;
  while(n >= 1024 && i < units.length-1){n/=1024;i++;}
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function selectFile(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) return toast("File terlalu besar. Maksimal 20 MB.", "error");
  selectedFile = file;
  $("#fileName").textContent = file.name;
  const ext = (file.name.match(/\.([^.]+)$/) || ["", "?"])[1].toUpperCase();
  $("#fileMeta").textContent = `${formatSize(file.size)} · ${ext}`;
  $("#assetName").value = file.name.replace(/\.[^/.]+$/, "");
  selected.classList.remove("hidden");
  dropzone.classList.add("has-file");
  uploadBtn.disabled = false;
  audio.src = URL.createObjectURL(file);
  $("#previewBox").classList.remove("hidden");
}

fileInput.addEventListener("change", e => selectFile(e.target.files[0]));
["dragenter","dragover"].forEach(ev => dropzone.addEventListener(ev, e => {
  e.preventDefault(); dropzone.classList.add("drag");
}));
["dragleave","drop"].forEach(ev => dropzone.addEventListener(ev, e => {
  e.preventDefault(); dropzone.classList.remove("drag");
}));
dropzone.addEventListener("drop", e => selectFile(e.dataTransfer.files[0]));

$("#removeBtn").onclick = () => {
  selectedFile = null;
  fileInput.value = "";
  selected.classList.add("hidden");
  $("#previewBox").classList.add("hidden");
  dropzone.classList.remove("has-file");
  uploadBtn.disabled = true;
};

function statusClass(status) {
  return ["completed","sent","uploaded"].includes(status) ? "success" :
         ["failed"].includes(status) ? "danger" :
         ["skipped"].includes(status) ? "muted" : "pending";
}
function statusLabel(status) {
  return ({completed:"Completed",sent:"Sent",uploaded:"Uploaded",failed:"Failed",skipped:"Skipped",uploading:"Uploading",pending:"Pending",processing:"Processing"})[status] || status;
}

function renderHistory(items) {
  $("#heroCount").textContent = items.length;
  const lib = $("#library"), empty = $("#empty");
  if (!items.length) { empty.style.display="flex"; lib.innerHTML=""; return; }
  empty.style.display="none";
  lib.innerHTML = items.map(item => {
    const rid = item.roblox?.assetId;
    const sound = rid ? `rbxassetid://${rid}` : "";
    return `<article class="track-row">
      <div class="row-art">♫</div>
      <div class="row-main">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.originalName)} · ${formatSize(item.size)} · ${formatDateTime(item.createdAt)}</span>
      </div>
      <div class="chips">
        <span class="chip ${statusClass(item.roblox?.status)}">R ${statusLabel(item.roblox?.status)}</span>
        <span class="chip ${statusClass(item.telegram?.status)}">T ${statusLabel(item.telegram?.status)}</span>
        ${item.conversion?.status && item.conversion.status !== "not_needed" ? `<span class="chip ${statusClass(item.conversion?.status)}">↻ ${statusLabel(item.conversion?.status)}</span>` : ""}
      </div>
      <div class="asset-id">${rid ? `<b>${rid}</b><button onclick="copyText('${sound}')">Copy</button>` : `<span>${item.roblox?.error || "Waiting..."}</span>`}</div>
    </article>`;
  }).join("");
}
function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch { return value; }
}

function escapeHtml(s="") {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
window.copyText = async text => { await navigator.clipboard.writeText(text); toast("SoundId copied ✓"); };

async function refresh() {
  try {
    const items = await api("/api/history");
    renderHistory(items);
  } catch(e) { toast(e.message, "error"); }
}

uploadBtn.onclick = () => {
  if (!selectedFile) return;
  const fd = new FormData();
  fd.append("audio", selectedFile);
  fd.append("name", assetName.value.trim() || selectedFile.name);

  uploadBtn.disabled = true;
  $("#progressWrap").classList.remove("hidden");

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/upload");
  xhr.upload.onprogress = e => {
    if (e.lengthComputable) {
      const pct = Math.round(e.loaded/e.total*100);
      $("#progressBar").style.width = pct+"%";
      $("#progressPct").textContent = pct+"%";
      $("#progressText").textContent = "Uploading...";
    }
  };
  xhr.onload = async () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      $("#progressText").textContent = "Processing Telegram + Roblox...";
      $("#progressBar").style.width = "100%";
      const result = JSON.parse(xhr.responseText);
      toast("Upload diterima. Processing berjalan.", "success");
      setTimeout(refresh, 700);
      setTimeout(refresh, 4000);
      setTimeout(refresh, 10000);
      setTimeout(refresh, 20000);
    } else {
      let msg="Upload gagal"; try { msg=JSON.parse(xhr.responseText).error } catch {}
      toast(msg, "error");
    }
    uploadBtn.disabled = false;
  };
  xhr.onerror = () => { toast("Network error.", "error"); uploadBtn.disabled=false; };
  xhr.send(fd);
};

$("#refreshBtn").onclick = refresh;
$("#themeBtn").onclick = () => {
  document.body.classList.toggle("light");
  localStorage.theme = document.body.classList.contains("light") ? "light" : "dark";
};
if (localStorage.theme === "light") document.body.classList.add("light");

(async function init(){
  function updateClock(){
    const now = new Date();
    $("#clock").textContent = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
  }
  updateClock();
  setInterval(updateClock, 1000);

  try {
    const cfg = await api("/api/config");
    $("#limitLabel").textContent = `Max ${cfg.maxFileSizeMb} MB`;
    $("#robloxText").textContent = cfg.robloxConfigured ? "API key configured" : "Not configured";
    $("#telegramText").textContent = cfg.telegramConfigured ? "Bot configured" : "Not configured";
    $("#robloxService").classList.toggle("off", !cfg.robloxConfigured);
    $("#telegramService").classList.toggle("off", !cfg.telegramConfigured);
    $("#serverBadge").innerHTML = "<i></i> Online";
  } catch {
    $("#serverBadge").innerHTML = "<i></i> Offline";
  }
  refresh();
  setInterval(refresh, 7000);
})();