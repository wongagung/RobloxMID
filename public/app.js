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

function clampAssetName(name) {
  let n = (name || "").trim();
  if (n.length > 50) n = n.slice(0, 50).trim();
  if (n.length < 3) n = (n + " Track").slice(0, 50);
  return n;
}

function isAssetNameValid() {
  const len = assetName.value.trim().length;
  return len >= 3 && len <= 50;
}

function refreshUploadButton() {
  const valid = Boolean(selectedFile) && isAssetNameValid();
  uploadBtn.disabled = !valid;
  $("#assetNameHint").classList.toggle("hint-error", assetName.value.trim().length > 0 && !isAssetNameValid());
}

assetName.addEventListener("input", () => {
  $("#assetNameHint").textContent = isAssetNameValid() ? "3–50 karakter" : `${assetName.value.trim().length}/50 karakter — minimal 3`;
  refreshUploadButton();
});

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
  $("#assetName").value = clampAssetName(file.name.replace(/\.[^/.]+$/, ""));
  selected.classList.remove("hidden");
  dropzone.classList.add("has-file");
  refreshUploadButton();
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = URL.createObjectURL(file);
  audio.src = lastObjectUrl;
  $("#previewBox").classList.remove("hidden");
  document.dispatchEvent(new CustomEvent("musiclab:file-selected", { detail: { file } }));
}
let lastObjectUrl = null;

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
  audio.removeAttribute("src");
  document.dispatchEvent(new CustomEvent("musiclab:file-cleared"));
};

// Bridge used by audio-studio.js so the editor can hand back an edited
// audio file (e.g. after Apply Edit) without duplicating upload logic.
window.MusicLabTrack = {
  get() { return selectedFile; },
  set(file) {
    selectedFile = file;
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = URL.createObjectURL(file);
    audio.src = lastObjectUrl;
    const ext = (file.name.match(/\.([^.]+)$/) || ["", "?"])[1].toUpperCase();
    $("#fileName").textContent = file.name;
    $("#fileMeta").textContent = `${formatSize(file.size)} · ${ext}`;
    refreshUploadButton();
  }
};

function statusClass(status) {
  return ["completed","sent","uploaded","approved"].includes(status) ? "success" :
         ["failed","rejected"].includes(status) ? "danger" :
         ["skipped"].includes(status) ? "muted" : "pending";
}
function statusLabel(status) {
  return ({completed:"Completed",sent:"Sent",uploaded:"Uploaded",failed:"Failed",skipped:"Skipped",uploading:"Uploading",pending:"Pending",processing:"Processing",approved:"Approved",rejected:"Rejected",reviewing:"Reviewing"})[status] || status;
}

function renderHistory(items) {
  $("#heroCount").textContent = items.length;
  const lib = $("#library"), empty = $("#empty");
  if (!items.length) { empty.style.display="flex"; lib.innerHTML=""; return; }
  empty.style.display="none";
  lib.innerHTML = items.map(item => {
    const rid = item.roblox?.assetId;
    const sound = rid ? `rbxassetid://${rid}` : "";
    const moderation = item.roblox?.moderation;
    const modIcon = { approved: "✓", rejected: "✕", reviewing: "🛡" }[moderation] || "🛡";
    return `<article class="track-row">
      <div class="row-art">♫</div>
      <div class="row-main">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.originalName)} · ${formatSize(item.size)} · ${formatDateTime(item.createdAt)}</span>
      </div>
      <div class="chips">
        <span class="chip ${statusClass(item.roblox?.status)}">R ${statusLabel(item.roblox?.status)}</span>
        ${moderation ? `<span class="chip ${statusClass(moderation)}" title="Roblox content moderation">${modIcon} ${statusLabel(moderation)}</span>` : ""}
        <span class="chip ${statusClass(item.telegram?.status)}">T ${statusLabel(item.telegram?.status)}</span>
        ${item.conversion?.status && item.conversion.status !== "not_needed" ? `<span class="chip ${statusClass(item.conversion?.status)}">↻ ${statusLabel(item.conversion?.status)}</span>` : ""}
      </div>
      <div class="asset-id">${rid ? `<b>${rid}</b>${moderation === "reviewing" ? `<button onclick="recheckModeration('${item.id}')">Recheck</button>` : ""}<button onclick="copyText('${sound}')">Copy</button>` : `<span>${item.roblox?.error || "Waiting..."}</span>`}</div>
    </article>`;
  }).join("");
}
window.recheckModeration = async id => {
  try {
    const r = await api(`/api/roblox/moderation/${id}/refresh`, { method: "POST" });
    toast(`Status moderasi: ${statusLabel(r.moderation)}`);
    refresh();
  } catch (e) { toast(e.message, "error"); }
};
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
  fd.append("name", clampAssetName(assetName.value.trim() || selectedFile.name));

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
    refreshUploadButton();
  };
  xhr.onerror = () => { toast("Network error.", "error"); refreshUploadButton(); };
  xhr.send(fd);
};

$("#refreshBtn").onclick = refresh;
$("#themeBtn").onclick = () => {
  document.body.classList.toggle("light");
  localStorage.theme = document.body.classList.contains("light") ? "light" : "dark";
};
if (localStorage.theme === "light") document.body.classList.add("light");

(async function init(){
  const clockFmt = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  function updateClock(){
    const now = new Date();
    $("#clock").innerHTML = clockFmt.formatToParts(now)
      .map(p => p.type === "literal" ? `<span class="clock-colon">${p.value}</span>` : p.value)
      .join("");
  }
  updateClock();
  setInterval(updateClock, 1000);

  window.addEventListener("scroll", () => {
    document.querySelector(".topbar").classList.toggle("is-scrolled", window.scrollY > 8);
  }, { passive: true });

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
