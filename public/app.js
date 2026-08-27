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

// ── Source tab switching ─────────────────────────────────────────────────────
document.querySelectorAll(".source-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".source-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const src = btn.dataset.source;
    $(src === "file" ? "#sourceFile" : "#sourceUrl").classList.remove("hidden");
    $(src === "file" ? "#sourceUrl" : "#sourceFile").classList.add("hidden");
    if (src === "file") $("#urlInput").value = "";
  });
});

// ── URL fetch ────────────────────────────────────────────────────────────────
const urlInput = $("#urlInput");
const urlInfoBtn = $("#urlInfoBtn");
const urlFetchBtn = $("#urlFetchBtn");
const urlStatus = $("#urlStatus");
const urlStatusText = $("#urlStatusText");
const urlPreviewCard = $("#urlPreviewCard");

function setUrlStatus(msg, isError = false) {
  urlStatus.classList.remove("hidden");
  urlStatusText.textContent = msg;
  urlStatus.className = "url-status" + (isError ? " error" : " info");
}
function clearUrlStatus() { urlStatus.classList.add("hidden"); }

// Reset preview card
function resetPreview() {
  urlPreviewCard.classList.add("hidden");
  urlFetchBtn.disabled = true;
}

urlInput.addEventListener("input", () => {
  clearUrlStatus();
  resetPreview();
  urlInfoBtn.disabled = !urlInput.value.trim();
});
urlInfoBtn.disabled = true;

// Step 1: Cek Info
urlInfoBtn.onclick = async () => {
  const url = urlInput.value.trim();
  if (!url) return;
  urlInfoBtn.disabled = true;
  resetPreview();
  setUrlStatus("⏳ Mengambil info...");

  try {
    const resp = await fetch("/api/url-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Gagal mengambil info.");

    // Populate preview card
    const thumb = $("#urlThumb");
    if (data.thumbnail) {
      thumb.src = data.thumbnail;
      thumb.classList.remove("hidden");
    } else {
      thumb.classList.add("hidden");
    }
    $("#urlTitle").textContent = data.title;
    $("#urlUploader").textContent = data.uploader || "";
    $("#urlDuration").textContent = data.duration_string ? `⏱ ${data.duration_string}` : "";
    urlPreviewCard.classList.remove("hidden");
    urlFetchBtn.disabled = false;
    clearUrlStatus();
  } catch (err) {
    setUrlStatus("✗ " + (err.message || "Gagal mengambil info."), true);
  }
  urlInfoBtn.disabled = false;
};

// Step 2: Download & Pakai — SSE streaming with realtime progress
urlFetchBtn.disabled = true;
urlFetchBtn.onclick = () => {
  const url = urlInput.value.trim();
  if (!url) return;
  urlFetchBtn.disabled = true;
  urlInfoBtn.disabled = true;

  // Progress bar UI
  setUrlStatus("⏳ Menghubungi server...");
  showProgressBar(0);

  const evtSrc = new EventSource(`/api/fetch-url-stream?url=${encodeURIComponent(url)}`);

  evtSrc.addEventListener("progress", (e) => {
    const d = JSON.parse(e.data);
    setUrlStatus("⏳ " + d.message);
    if (d.percent !== undefined) showProgressBar(d.percent);
  });

  evtSrc.addEventListener("file", (e) => {
    evtSrc.close();
    hideProgressBar();
    const d = JSON.parse(e.data);
    // decode base64 → Blob → File
    const bytes = Uint8Array.from(atob(d.data), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: d.mimeType });
    const file = new File([blob], `${d.title}.mp3`, { type: d.mimeType });
    setUrlStatus(`✓ Berhasil — memuat ke editor...`);
    selectFile(file);
    $("#assetName").value = clampAssetName(d.title);
    refreshUploadButton();
    resetPreview();
    setTimeout(clearUrlStatus, 3000);
    urlFetchBtn.disabled = false;
    urlInfoBtn.disabled = false;
  });

  evtSrc.addEventListener("error", (e) => {
    evtSrc.close();
    hideProgressBar();
    let msg = "Gagal mendownload.";
    let cookiesExpired = false;
    try { const d = JSON.parse(e.data); msg = d.message; cookiesExpired = d.cookiesExpired; } catch {}
    setUrlStatus("✗ " + msg, true);
    if (cookiesExpired) showCookiesAlert();
    urlFetchBtn.disabled = false;
    urlInfoBtn.disabled = false;
  });

  // Fallback: native EventSource error (connection lost)
  evtSrc.onerror = () => {
    if (evtSrc.readyState === EventSource.CLOSED) return;
    evtSrc.close();
    hideProgressBar();
    setUrlStatus("✗ Koneksi terputus.", true);
    urlFetchBtn.disabled = false;
    urlInfoBtn.disabled = false;
  };
};

// ── Progress bar helpers ─────────────────────────────────────────────────────
function showProgressBar(percent) {
  let bar = $("#urlProgressBar");
  if (!bar) {
    const wrap = document.createElement("div");
    wrap.id = "urlProgressWrap";
    wrap.className = "url-progress-wrap";
    wrap.innerHTML = `<div id="urlProgressBar" class="url-progress-bar" style="width:0%"></div>`;
    urlStatus.insertAdjacentElement("afterend", wrap);
    bar = $("#urlProgressBar");
  }
  bar.style.width = Math.max(4, percent) + "%";
  if (percent >= 100) bar.classList.add("done");
  else bar.classList.remove("done");
}

function hideProgressBar() {
  const wrap = $("#urlProgressWrap");
  if (wrap) wrap.remove();
}

// ── Cookies expired alert ────────────────────────────────────────────────────
function showCookiesAlert() {
  const details = document.querySelector(".cookies-details");
  if (details) {
    details.open = true;
    details.scrollIntoView({ behavior: "smooth", block: "nearest" });
    details.style.border = "1px solid #ef444466";
    details.style.boxShadow = "0 0 0 3px #ef444418";
    setTimeout(() => {
      details.style.border = "";
      details.style.boxShadow = "";
    }, 4000);
  }
}

urlInput.addEventListener("keydown", e => {
  if (e.key === "Enter") urlInfoBtn.click();
});

// ── Cookies upload ────────────────────────────────────────────────────────────
const cookiesUploadBtn = $("#cookiesUploadBtn");
const cookiesFileInput = $("#cookiesFileInput");
const cookiesStatus = $("#cookiesStatus");
const cookiesStatusText = $("#cookiesStatusText");

function setCookiesStatus(msg, isError = false) {
  cookiesStatus.classList.remove("hidden");
  cookiesStatusText.textContent = msg;
  cookiesStatus.className = "url-status" + (isError ? " error" : " info");
}

// Show current cookies status on load
fetch("/api/cookies-status").then(r => r.json()).then(data => {
  if (data.exists && data.size > 1000) {
    const age = data.mtime ? Math.floor((Date.now() - new Date(data.mtime)) / 3600000) : "?";
    setCookiesStatus(`✓ cookies.txt aktif (${age} jam lalu, ${Math.round(data.size/1024)}KB)`);
  }
}).catch(() => {});

cookiesUploadBtn.onclick = async () => {
  const file = cookiesFileInput.files[0];
  if (!file) { setCookiesStatus("Pilih file cookies.txt dulu.", true); return; }
  cookiesUploadBtn.disabled = true;
  setCookiesStatus("⏳ Mengupload...");
  const fd = new FormData();
  fd.append("cookies", file);
  try {
    const r = await fetch("/api/upload-cookies", { method: "POST", body: fd });
    const data = await r.json();
    if (r.ok) setCookiesStatus("✓ " + data.message);
    else setCookiesStatus("✗ " + (data.error || "Gagal upload."), true);
  } catch { setCookiesStatus("✗ Gagal upload.", true); }
  cookiesUploadBtn.disabled = false;
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

// Show logout button only when auth cookie is present
if (document.cookie.includes("_auth")) {
  $("#logoutBtn").classList.remove("hidden");
}
$("#logoutBtn").onclick = async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
};

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
    $("#ytdlpText").textContent = cfg.ytdlpAvailable ? "Tersedia — URL source aktif" : "Tidak tersedia — install: pip install yt-dlp";
    $("#robloxService").classList.toggle("off", !cfg.robloxConfigured);
    $("#telegramService").classList.toggle("off", !cfg.telegramConfigured);
    $("#ytdlpService").classList.toggle("off", !cfg.ytdlpAvailable);
    $("#serverBadge").innerHTML = "<i></i> Online";
  } catch {
    $("#serverBadge").innerHTML = "<i></i> Offline";
  }
  refresh();
  setInterval(refresh, 7000);
})();
