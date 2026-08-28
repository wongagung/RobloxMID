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

// ── Playlist state ───────────────────────────────────────────────────────────
let _playlistItems = [];
let _selectedIds = new Set();

const playlistCard = $("#playlistCard");
const playlistItems = $("#playlistItems");
const playlistTitle = $("#playlistTitle");
const playlistMeta = $("#playlistMeta");
const playlistDownloadBtn = $("#playlistDownloadBtn");
const playlistSelectAll = $("#playlistSelectAll");
const playlistProgress = $("#playlistProgress");
const playlistProgBar = $("#playlistProgBar");
const playlistProgText = $("#playlistProgText");

function resetPlaylist() {
  _playlistItems = [];
  _selectedIds.clear();
  if (playlistCard) playlistCard.classList.add("hidden");
  if (playlistItems) playlistItems.innerHTML = "";
  if (playlistProgress) playlistProgress.classList.add("hidden");
}

function renderPlaylistItems(items) {
  playlistItems.innerHTML = items.map((item, i) => `
    <label class="playlist-item" data-idx="${i}">
      <input type="checkbox" class="pl-check" data-id="${item.id}" checked>
      <img class="pl-thumb" src="${item.thumbnail || ""}" alt="" onerror="this.style.display='none'">
      <div class="pl-meta">
        <div class="pl-title">${item.title}</div>
        <div class="pl-sub">${item.uploader || ""}${item.duration_string ? " · ⏱ " + item.duration_string : ""}</div>
      </div>
    </label>
  `).join("");

  // Wire checkboxes
  playlistItems.querySelectorAll(".pl-check").forEach(chk => {
    _selectedIds.add(chk.dataset.id);
    chk.addEventListener("change", () => {
      if (chk.checked) _selectedIds.add(chk.dataset.id);
      else _selectedIds.delete(chk.dataset.id);
      updatePlaylistDownloadBtn();
    });
  });
  updatePlaylistDownloadBtn();
}

function updatePlaylistDownloadBtn() {
  if (!playlistDownloadBtn) return;
  const n = _selectedIds.size;
  playlistDownloadBtn.disabled = n === 0;
  playlistDownloadBtn.textContent = n > 0 ? `⬇ Download ${n} Track` : "⬇ Download Terpilih";
}

if (playlistSelectAll) {
  playlistSelectAll.onclick = () => {
    const checks = playlistItems.querySelectorAll(".pl-check");
    const allChecked = [...checks].every(c => c.checked);
    checks.forEach(c => {
      c.checked = !allChecked;
      if (c.checked) _selectedIds.add(c.dataset.id);
      else _selectedIds.delete(c.dataset.id);
    });
    updatePlaylistDownloadBtn();
  };
}

// ── Download Queue ────────────────────────────────────────────────────────────
let _downloadQueue = []; // { id, title, file, thumbnail, status: 'waiting'|'ready'|'uploading'|'done'|'error' }

const queuePanel = $("#queuePanel");
const queueList = $("#queueList");
const queueEmpty = $("#queueEmpty");
const queueClearBtn = $("#queueClearBtn");

function renderQueue() {
  if (!queueList) return;
  if (!_downloadQueue.length) {
    if (queuePanel) queuePanel.classList.add("hidden");
    queueEmpty.style.display = "flex";
    queueList.innerHTML = "";
    return;
  }
  queuePanel.classList.remove("hidden");
  queueEmpty.style.display = "none";
  queueList.innerHTML = _downloadQueue.map((item, i) => {
    const statusIcon = {
      waiting:   "⏳",
      ready:     "✏️",
      uploading: "⬆️",
      done:      "✓",
      error:     "✗",
    }[item.status] || "⏳";
    const statusClass = `queue-item-${item.status}`;
    return `
      <div class="queue-item ${statusClass}" data-qi="${i}">
        <img class="queue-thumb" src="${item.thumbnail || ""}" alt="" onerror="this.style.display='none'">
        <div class="queue-meta">
          <div class="queue-title">${item.title}</div>
          <div class="queue-status-text">${
            item.status === "waiting"   ? "Mendownload..." :
            item.status === "ready"     ? "Siap diedit" :
            item.status === "uploading" ? "Mengupload ke Roblox..." :
            item.status === "done"      ? "✓ Selesai diupload" :
            item.status === "error"     ? "✗ Gagal" : ""
          }</div>
        </div>
        <div class="queue-actions">
          ${item.status === "ready" ? `
            <button class="ghost-btn queue-edit-btn" data-qi="${i}">✏ Edit & Upload</button>
            <button class="primary-btn queue-upload-btn" data-qi="${i}" style="padding:7px 12px;font-size:12px;width:auto;margin:0">⬆ Upload Langsung</button>
          ` : ""}
          ${item.status === "error" ? `<button class="ghost-btn queue-retry-btn" data-qi="${i}">↺ Retry</button>` : ""}
        </div>
      </div>`;
  }).join("");

  // Wire buttons
  queueList.querySelectorAll(".queue-edit-btn").forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.qi);
      const item = _downloadQueue[idx];
      if (!item?.file) return;
      selectFile(item.file);
      $("#assetName").value = clampAssetName(item.title);
      refreshUploadButton();
      // Scroll to editor
      document.querySelector(".upload-panel")?.scrollIntoView({ behavior: "smooth" });
    };
  });

  queueList.querySelectorAll(".queue-upload-btn").forEach(btn => {
    btn.onclick = async () => {
      const idx = parseInt(btn.dataset.qi);
      const item = _downloadQueue[idx];
      if (!item?.file) return;
      item.status = "uploading";
      renderQueue();
      selectFile(item.file);
      $("#assetName").value = clampAssetName(item.title);
      refreshUploadButton();
      await new Promise(r => setTimeout(r, 300));
      const uploadBtn = $("#uploadBtn");
      if (uploadBtn && !uploadBtn.disabled) {
        uploadBtn.click();
        item.status = "done";
        setTimeout(renderQueue, 3000);
      } else {
        item.status = "error";
        renderQueue();
      }
    };
  });

  queueList.querySelectorAll(".queue-retry-btn").forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.qi);
      const item = _downloadQueue[idx];
      if (item) { item.status = "waiting"; downloadQueueItem(idx); }
    };
  });
}

if (queueClearBtn) {
  queueClearBtn.onclick = () => {
    _downloadQueue = _downloadQueue.filter(i => i.status === "waiting");
    renderQueue();
  };
}

async function downloadQueueItem(idx) {
  const item = _downloadQueue[idx];
  if (!item) return;
  item.status = "waiting";
  renderQueue();

  await new Promise((resolve) => {
    const evtSrc = new EventSource(`/api/fetch-url-stream?url=${encodeURIComponent(item.url)}`);

    evtSrc.addEventListener("progress", e => {
      const d = JSON.parse(e.data);
      // Update progress in playlist card too
      if (d.percent !== undefined && playlistProgText) {
        playlistProgText.textContent = `${item.title}: ${Math.round(d.percent)}%`;
      }
    });

    evtSrc.addEventListener("file", e => {
      evtSrc.close();
      const d = JSON.parse(e.data);
      const bytes = Uint8Array.from(atob(d.data), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: d.mimeType });
      item.file = new File([blob], `${d.title}.mp3`, { type: d.mimeType });
      item.status = "ready";
      renderQueue();
      resolve();
    });

    evtSrc.addEventListener("error", e => {
      evtSrc.close();
      item.status = "error";
      renderQueue();
      resolve();
    });

    evtSrc.onerror = () => {
      if (evtSrc.readyState === EventSource.CLOSED) return;
      evtSrc.close();
      item.status = "error";
      renderQueue();
      resolve();
    };
  });
}

// Playlist download queue — download to local queue, not direct upload
if (playlistDownloadBtn) {
  playlistDownloadBtn.onclick = async () => {
    const selected = _playlistItems.filter(item => _selectedIds.has(item.id));
    if (!selected.length) return;

    playlistDownloadBtn.disabled = true;
    playlistSelectAll.disabled = true;
    playlistProgress.classList.remove("hidden");

    const total = selected.length;

    // Add all to queue first
    const startIdx = _downloadQueue.length;
    selected.forEach(item => {
      _downloadQueue.push({
        id: item.id,
        title: item.title,
        thumbnail: item.thumbnail,
        url: item.webpage_url,
        file: null,
        status: "waiting",
      });
    });
    renderQueue();

    // Download one by one
    for (let i = 0; i < selected.length; i++) {
      const qIdx = startIdx + i;
      playlistProgText.textContent = `Mendownload ${i + 1}/${total}: ${selected[i].title}`;
      playlistProgBar.style.width = (i / total * 100) + "%";

      const label = playlistItems.querySelector(`[data-idx="${_playlistItems.indexOf(selected[i])}"]`);
      if (label) label.classList.add("pl-downloading");

      await downloadQueueItem(qIdx);

      if (label) {
        label.classList.remove("pl-downloading");
        label.classList.add(_downloadQueue[qIdx].status === "ready" ? "pl-done" : "pl-error");
      }

      await new Promise(r => setTimeout(r, 800));
    }

    playlistProgBar.style.width = "100%";
    playlistProgText.textContent = `✓ ${selected.length} track masuk antrian — edit & upload satu per satu!`;
    playlistDownloadBtn.disabled = false;
    playlistSelectAll.disabled = false;
  };
}

// Step 1: Cek Info — detect playlist vs single
urlInfoBtn.onclick = async () => {
  const url = urlInput.value.trim();
  if (!url) return;
  urlInfoBtn.disabled = true;
  resetPreview();
  resetPlaylist();
  setUrlStatus("⏳ Mengambil info...");

  try {
    // Try playlist first
    const resp = await fetch("/api/playlist-info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Gagal mengambil info.");

    if (data.isPlaylist && data.items.length > 1) {
      // Show playlist UI
      _playlistItems = data.items;
      playlistTitle.textContent = data.playlistTitle || "Playlist";
      playlistMeta.textContent = `${data.total} track${data.limited ? " (max 50 ditampilkan)" : ""}`;
      renderPlaylistItems(data.items);
      playlistCard.classList.remove("hidden");
      clearUrlStatus();
    } else {
      // Single video — show normal preview card
      const item = data.items[0];
      const thumb = $("#urlThumb");
      if (item.thumbnail) { thumb.src = item.thumbnail; thumb.classList.remove("hidden"); }
      else thumb.classList.add("hidden");
      $("#urlTitle").textContent = item.title;
      $("#urlUploader").textContent = item.uploader || "";
      $("#urlDuration").textContent = item.duration_string ? `⏱ ${item.duration_string}` : "";
      urlPreviewCard.classList.remove("hidden");
      urlFetchBtn.disabled = false;
      clearUrlStatus();
    }
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
  _allItems = items;
  $("#heroApproved").textContent  = items.filter(i => i.roblox?.moderation === "approved").length;
  $("#heroRejected").textContent  = items.filter(i => i.roblox?.moderation === "rejected").length;
  $("#heroReviewing").textContent = items.filter(i => i.roblox?.moderation === "reviewing").length;
  applyLibraryFilter();
}

function _renderItems(items) {
  const lib = $("#library"), empty = $("#empty");
  if (!items.length) { empty.style.display="flex"; lib.innerHTML=""; return; }
  empty.style.display="none";
  lib.innerHTML = items.map(item => {
    const rid = item.roblox?.assetId;
    const sound = rid ? `rbxassetid://${rid}` : "";
    const moderation = item.roblox?.moderation;
    const modIcon = { approved: "✓", rejected: "✕", reviewing: "🛡" }[moderation] || "🛡";
    // Build editor meta badge
    const m = item.editorMeta;
    const metaBadges = m ? [
      m.pitch  !== 0             ? `Pitch ${m.pitch > 0 ? "+" : ""}${m.pitch} st` : null,
      m.speed  !== 1             ? `Speed ${m.speed}x` : null,
      m.volume !== 0             ? `Vol ${m.volume > 0 ? "+" : ""}${m.volume} dB` : null,
      m.reverb > 0               ? `Reverb ${m.reverb}%` : null,
      m.stereo !== 0             ? `Stereo ${m.stereo > 0 ? "+" : ""}${m.stereo}%` : null,
    ].filter(Boolean) : [];

    return `<article class="track-row">
      <div class="row-art">♫</div>
      <div class="row-main">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.originalName)} · ${formatSize(item.size)} · ${formatDateTime(item.createdAt)}</span>
        ${metaBadges.length ? `<div class="editor-meta-badges">${metaBadges.map(b => `<span class="editor-meta-badge">${b}</span>`).join("")}</div>` : ""}
      </div>
      <div class="chips">
        <span class="chip ${statusClass(item.roblox?.status)}">R ${statusLabel(item.roblox?.status)}</span>
        ${moderation ? `<span class="chip ${statusClass(moderation)}" title="Roblox content moderation">${modIcon} ${statusLabel(moderation)}</span>` : ""}
        <span class="chip ${statusClass(item.telegram?.status)}">T ${statusLabel(item.telegram?.status)}</span>
        ${item.conversion?.status && item.conversion.status !== "not_needed" ? `<span class="chip ${statusClass(item.conversion?.status)}">↻ ${statusLabel(item.conversion?.status)}</span>` : ""}
      </div>
      <div class="asset-id">${rid ? `
        <b>${rid}</b>
        <div class="asset-btns">
          <button onclick="copyText('${sound}')">Copy ID</button>
          ${moderation === "approved" ? `<a href="https://create.roblox.com/store/asset/${rid}" target="_blank" rel="noopener" class="asset-link-btn">🔗 Creator</a>` : ""}
          ${moderation === "reviewing" ? `<button onclick="recheckModeration('${item.id}')">Recheck</button>` : ""}
        </div>
      ` : `<span>${item.roblox?.error || "Waiting..."}</span>`}</div>
    </article>`;
  }).join("");
}

// ── Library filter state & logic ─────────────────────────────────────────────
let _allItems = [];
let _activeFilter = "all";
let _searchQuery = "";

document.querySelectorAll(".lib-filter").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".lib-filter").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    _activeFilter = btn.dataset.filter;
    applyLibraryFilter();
  });
});

const libSearch = $("#libSearch");
if (libSearch) {
  libSearch.addEventListener("input", () => {
    _searchQuery = libSearch.value.trim().toLowerCase();
    applyLibraryFilter();
  });
}

function applyLibraryFilter() {
  const lib = $("#library");
  const empty = $("#empty");
  const empty2 = $("#libEmpty2");
  if (!_allItems.length) {
    empty.style.display = "flex";
    if (empty2) empty2.classList.add("hidden");
    lib.innerHTML = "";
    return;
  }
  empty.style.display = "none";

  let filtered = _allItems;
  if (_activeFilter !== "all") {
    filtered = filtered.filter(i => (i.roblox?.moderation || "") === _activeFilter);
  }
  if (_searchQuery) {
    filtered = filtered.filter(i =>
      (i.name || "").toLowerCase().includes(_searchQuery) ||
      (i.originalName || "").toLowerCase().includes(_searchQuery)
    );
  }

  if (!filtered.length) {
    if (empty2) empty2.classList.remove("hidden");
    lib.innerHTML = "";
    return;
  }
  if (empty2) empty2.classList.add("hidden");
  _renderItems(filtered);
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

  // Collect editor metadata if available
  try {
    const meta = {};
    const gainEl   = document.getElementById("editorGain");
    const speedEl  = document.getElementById("editorSpeed");
    const pitchEl  = document.getElementById("editorPitch");
    const reverbEl = document.getElementById("editorReverb");
    const roomEl   = document.getElementById("editorRoom");
    const stereoEl = document.getElementById("editorStereo");
    if (gainEl)   meta.volume  = parseFloat(gainEl.value) || 0;
    if (speedEl)  meta.speed   = parseFloat(speedEl.value) || 1;
    if (pitchEl)  meta.pitch   = parseFloat(pitchEl.value) || 0;
    if (reverbEl) meta.reverb  = parseFloat(reverbEl.value) || 0;
    if (roomEl)   meta.room    = parseFloat(roomEl.value) || 50;
    if (stereoEl) meta.stereo  = parseFloat(stereoEl.value) || 0;
    // Only include if any non-default value
    const hasEdit = meta.volume !== 0 || meta.speed !== 1 || meta.pitch !== 0 ||
                    meta.reverb !== 0 || meta.stereo !== 0;
    if (hasEdit) fd.append("editorMeta", JSON.stringify(meta));
  } catch {}

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

// ── yt-dlp update ────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  const btn = $("#ytdlpUpdateBtn");
  const log = $("#ytdlpUpdateLog");
  if (!btn) return;

  btn.onclick = () => {
    if (btn.disabled) return;
    btn.disabled = true;
    log.classList.remove("hidden");
    log.innerHTML = "";

    const addLine = (text, cls = "") => {
      const p = document.createElement("p");
      p.textContent = text;
      if (cls) p.className = cls;
      log.appendChild(p);
      log.scrollTop = log.scrollHeight;
    };

    addLine("Memulai update yt-dlp...");

    const evtSrc = new EventSource("/api/update-ytdlp");

    evtSrc.addEventListener("progress", e => {
      const d = JSON.parse(e.data);
      addLine(d.message);
    });

    evtSrc.addEventListener("done", e => {
      evtSrc.close();
      const d = JSON.parse(e.data);
      addLine(d.message, d.updated ? "update-success" : "update-info");
      btn.disabled = false;
      btn.title = "Update yt-dlp";
      // Refresh version display
      fetch("/api/config").then(r => r.json()).then(cfg => {
        const ytVer = cfg.ytdlpVersion || "";
        $("#ytdlpText").textContent = `Tersedia${ytVer ? " · v" + ytVer : ""} — URL source aktif`;
      });
    });

    evtSrc.addEventListener("error", e => {
      evtSrc.close();
      let msg = "Gagal update.";
      try { msg = JSON.parse(e.data).message; } catch {}
      addLine(msg, "update-error");
      btn.disabled = false;
    });

    evtSrc.onerror = () => {
      if (evtSrc.readyState === EventSource.CLOSED) return;
      evtSrc.close();
      addLine("Koneksi terputus.", "update-error");
      btn.disabled = false;
    };
  };
});

// ── Roblox Account Manager ───────────────────────────────────────────────────
const accountDrawer = $("#accountDrawer");
const accountList = $("#accountList");
const manageAccountsBtn = $("#manageAccountsBtn");
const accountDrawerClose = $("#accountDrawerClose");
const addAccountForm = $("#addAccountForm");
const accFormStatus = $("#accFormStatus");

function setAccStatus(msg, isError = false) {
  if (!accFormStatus) return;
  accFormStatus.classList.remove("hidden");
  accFormStatus.textContent = msg;
  accFormStatus.className = "url-status " + (isError ? "error" : "info");
}

async function loadAccounts() {
  const r = await fetch("/api/roblox-accounts");
  const data = await r.json();

  // Update roblox service row text
  $("#robloxText").textContent = data.activeLabel || "Tidak ada akun aktif";
  $("#robloxService").classList.toggle("off", !data.active && !data.hasEnvFallback);

  if (!accountList) return;

  const rows = [];
  if (data.hasEnvFallback) {
    const isActive = !data.active;
    rows.push(`
      <div class="account-item ${isActive ? "account-active" : ""}">
        <div class="account-info">
          <div class="account-label">.env Default ${isActive ? "✓" : ""}</div>
          <div class="account-sub">Dari environment variable</div>
        </div>
        ${!isActive ? `<button class="ghost-btn account-activate-btn" data-id="env">Aktifkan</button>` : ""}
      </div>`);
  }
  data.accounts.forEach(acc => {
    const isActive = acc.id === data.active;
    rows.push(`
      <div class="account-item ${isActive ? "account-active" : ""}">
        <div class="account-info">
          <div class="account-label">${escapeHtml(acc.label)} ${isActive ? "✓" : ""}</div>
          <div class="account-sub">User ID: ${acc.userId} · Key: ${acc.apiKey}</div>
        </div>
        <div style="display:flex;gap:5px">
          ${!isActive ? `<button class="ghost-btn account-activate-btn" data-id="${acc.id}">Aktifkan</button>` : ""}
          <button class="ghost-btn account-delete-btn" data-id="${acc.id}" style="color:#fca5a5;border-color:#ef444433">✕</button>
        </div>
      </div>`);
  });

  if (!rows.length) rows.push('<div style="padding:12px;color:var(--muted);font-size:12px">Belum ada akun tersimpan.</div>');
  accountList.innerHTML = rows.join("");

  accountList.querySelectorAll(".account-activate-btn").forEach(btn => {
    btn.onclick = async () => {
      await fetch(`/api/roblox-accounts/${btn.dataset.id}/activate`, { method: "PATCH" });
      loadAccounts();
    };
  });

  accountList.querySelectorAll(".account-delete-btn").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Hapus akun ini?")) return;
      await fetch(`/api/roblox-accounts/${btn.dataset.id}`, { method: "DELETE" });
      loadAccounts();
    };
  });
}

if (manageAccountsBtn) {
  manageAccountsBtn.onclick = () => {
    accountDrawer.classList.toggle("hidden");
    if (!accountDrawer.classList.contains("hidden")) loadAccounts();
  };
}
if (accountDrawerClose) {
  accountDrawerClose.onclick = () => accountDrawer.classList.add("hidden");
}

if (addAccountForm) {
  addAccountForm.onsubmit = async (e) => {
    e.preventDefault();
    const label  = $("#accLabel").value.trim();
    const userId = $("#accUserId").value.trim();
    const apiKey = $("#accApiKey").value.trim();
    setAccStatus("Menyimpan...");
    const r = await fetch("/api/roblox-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, userId, apiKey })
    });
    const d = await r.json();
    if (r.ok) {
      setAccStatus("✓ Akun berhasil disimpan!");
      addAccountForm.reset();
      loadAccounts();
    } else {
      setAccStatus("✗ " + (d.error || "Gagal menyimpan."), true);
    }
  };
}

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
    const ytVer = cfg.ytdlpVersion || "";
    $("#ytdlpText").textContent = cfg.ytdlpAvailable
      ? `Tersedia${ytVer ? " · v" + ytVer : ""} — URL source aktif`
      : "Tidak tersedia — install: pip install yt-dlp";
    $("#robloxService").classList.toggle("off", !cfg.robloxConfigured);
    $("#telegramService").classList.toggle("off", !cfg.telegramConfigured);
    $("#ytdlpService").classList.toggle("off", !cfg.ytdlpAvailable);
    if (cfg.ytdlpAvailable) $("#ytdlpUpdateBtn").style.display = "";

    // Auto-vary toggle
    const varyBtn = $("#autoVaryToggle");
    if (varyBtn) {
      let _autoVary = cfg.autoVary !== false;
      const updateVaryBtn = () => {
        varyBtn.textContent = _autoVary ? "ON" : "OFF";
        varyBtn.className = "vary-toggle " + (_autoVary ? "vary-on" : "vary-off");
      };
      updateVaryBtn();
      varyBtn.onclick = async () => {
        const r = await fetch("/api/toggle-auto-vary", { method: "POST" });
        const d = await r.json();
        _autoVary = d.autoVary;
        updateVaryBtn();
      };
    }
    $("#serverBadge").innerHTML = "<i></i> Online";
  } catch {
    $("#serverBadge").innerHTML = "<i></i> Offline";
  }
  refresh();
  setInterval(refresh, 7000);
})();
