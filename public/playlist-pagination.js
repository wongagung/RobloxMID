/* RobloxMID canonical playlist + queue controller. */
(function () {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const input = $("#urlInput");
  const infoButton = $("#urlInfoBtn");
  const card = $("#playlistCard");
  const list = $("#playlistItems");
  const titleEl = $("#playlistTitle");
  const metaEl = $("#playlistMeta");
  const selectAllButton = $("#playlistSelectAll");
  const downloadButton = $("#playlistDownloadBtn");
  const progress = $("#playlistProgress");
  const progressBar = $("#playlistProgBar");
  const progressText = $("#playlistProgText");
  const preview = $("#urlPreviewCard");
  const status = $("#urlStatus");
  const statusText = $("#urlStatusText");
  const queueList = $("#queueList");

  if (!input || !infoButton || !card || !list) return;

  const PAGE_SIZE = 50;
  const MAX_BROWSER_BYTES = 20 * 1024 * 1024;
  let sourceUrl = "";
  let page = 1;
  let maxItems = 100;
  let hasNext = false;
  let loading = false;
  let currentItems = [];
  const selectedIds = new Set();
  const selectedItems = new Map();
  const activeDownloads = new Set();

  function normalizeUrl(value) {
    let url = String(value ?? "").trim();
    for (let i = 0; i < 2; i++) {
      try {
        const decoded = decodeURIComponent(url);
        if (decoded === url) break;
        url = decoded.trim();
      } catch { break; }
    }
    url = url
      .replace(/&amp;/gi, "&")
      .replace(/^\s*[`'\"]+/, "")
      .replace(/[`'\"]+\s*$/, "")
      .trim();
    if (url && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && /^(?:www\.)?(?:youtube\.com|youtu\.be|music\.youtube\.com|soundcloud\.com)/i.test(url)) {
      url = `https://${url}`;
    }
    return url;
  }

  function canonicalItemUrl(item) {
    const raw = normalizeUrl(item?.webpage_url || item?.original_url || item?.url || sourceUrl);
    const id = String(item?.id || "").trim();
    try {
      const parsed = new URL(raw);
      const host = parsed.hostname.toLowerCase();
      if (["youtube.com", "www.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"].includes(host) && id) {
        return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
      }
    } catch {}
    return raw;
  }

  function youtubeThumbnail(item) {
    const supplied = normalizeUrl(item?.thumbnail || "");
    if (supplied) return supplied;
    const id = String(item?.id || "").trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(id)) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    return "";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function showStatus(message, isError = false) {
    if (!status || !statusText) return;
    statusText.textContent = message;
    status.className = `url-status ${isError ? "error" : "info"}`;
    status.classList.remove("hidden");
  }

  function hideStatus() {
    status?.classList.add("hidden");
  }

  function injectStyles() {
    if ($("#robloxMidCanonicalPlaylistStyles")) return;
    const style = document.createElement("style");
    style.id = "robloxMidCanonicalPlaylistStyles";
    style.textContent = `
      #playlistCard{margin-top:18px;padding:18px;border:1px solid var(--line);border-radius:16px;background:var(--panel,rgba(255,255,255,.025));overflow:hidden;box-shadow:0 8px 28px rgba(0,0,0,.08)}
      #playlistCard .playlist-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding-bottom:14px;border-bottom:1px solid var(--line)}
      #playlistCard .playlist-title{font-size:15px;line-height:1.38;font-weight:800;color:var(--text);white-space:normal;overflow-wrap:anywhere;word-break:break-word}
      #playlistCard .playlist-meta{margin-top:5px;font-size:11px;line-height:1.4;color:var(--muted)}
      #playlistCard .playlist-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;flex:0 0 auto}
      #playlistCard .playlist-actions .ghost-btn,#playlistCard .playlist-actions .primary-btn{width:auto;margin:0;padding:8px 12px;font-size:11px;white-space:nowrap}
      #playlistCard .playlist-items{display:flex;flex-direction:column;gap:7px;margin-top:14px;max-height:540px;overflow:auto;padding-right:3px}
      #playlistCard .playlist-item{display:grid;grid-template-columns:20px 48px minmax(0,1fr);gap:11px;align-items:center;padding:9px 10px;border:1px solid transparent;border-radius:12px;background:rgba(255,255,255,.02);transition:background .15s,border-color .15s}
      #playlistCard .playlist-item:hover{border-color:var(--line);background:rgba(255,255,255,.045)}
      #playlistCard .playlist-item.is-selected{border-color:#8b5cf644;background:#8b5cf60c}
      #playlistCard .playlist-item input{margin:0;accent-color:#8b5cf6}
      #playlistCard .pl-thumb{display:block;width:48px;height:48px;border-radius:10px;object-fit:cover;background:#0b1020;border:1px solid var(--line)}
      #playlistCard .pl-meta{min-width:0}
      #playlistCard .pl-title{font-size:12px;font-weight:750;line-height:1.4;white-space:normal;overflow-wrap:anywhere;word-break:break-word;color:var(--text)}
      #playlistCard .pl-sub{margin-top:4px;font-size:10px;line-height:1.3;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #playlistPagination{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
      #playlistPagination .pager-summary{min-width:0;font-size:10px;line-height:1.4;color:var(--muted)}
      #playlistPagination .pager-selected{margin-top:2px;font-weight:800;color:#a78bfa}
      #playlistPagination .pager-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
      #playlistPagination button,#playlistPagination select{min-height:34px;padding:7px 10px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.03);color:var(--text);font-size:11px;font-weight:750}
      #playlistPagination button{cursor:pointer}
      #playlistPagination button:disabled{opacity:.45;cursor:not-allowed}

      #queuePanel{margin-top:18px;overflow:hidden}
      #queuePanel .panel-head{margin-bottom:14px}
      #queuePanel .panel-head>div{min-width:0}
      #queuePanel .queue-list{display:flex;flex-direction:column;gap:8px;max-height:460px;overflow:auto;padding:0 2px 2px 0}
      #queuePanel .queue-item{display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:12px;align-items:center;position:relative;min-height:64px;padding:10px 12px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.018);transition:background .15s,border-color .15s,box-shadow .15s,opacity .15s}
      #queuePanel .queue-item:hover{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.13)}
      #queuePanel .queue-item.queue-item-ready{border-color:#22c55e33;background:#22c55e0a}
      #queuePanel .queue-item.queue-item-error{border-color:#ef444433;background:#ef44440a}
      #queuePanel .queue-item.queue-item-done{opacity:.62}
      #queuePanel .queue-item.queue-item-uploading{border-color:#f59e0b33;background:#f59e0b0a}
      #queuePanel .queue-item.is-editing{border-color:#8b5cf677;background:linear-gradient(90deg,#8b5cf612,#22d3ee08);box-shadow:0 0 0 1px #8b5cf61c,0 10px 28px #00000020}
      #queuePanel .queue-item.is-download-active{border-color:#22d3ee55;background:#22d3ee08}
      #queuePanel .queue-thumb{display:block;width:56px;height:42px;border-radius:8px;object-fit:cover;background:#080b13;border:1px solid var(--line)}
      #queuePanel .queue-meta{min-width:0;align-self:center}
      #queuePanel .queue-title{display:block;font-size:13px;font-weight:800;line-height:1.38;color:var(--text);white-space:normal;overflow-wrap:anywhere;word-break:break-word}
      #queuePanel .queue-status-text{margin-top:4px;font-size:10.5px;line-height:1.35;color:var(--muted)}
      #queuePanel .queue-item-ready .queue-status-text{color:#6ee7b7}
      #queuePanel .queue-item-error .queue-status-text{color:#fca5a5}
      #queuePanel .queue-item-uploading .queue-status-text{color:#fcd34d}
      #queuePanel .queue-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}
      #queuePanel .queue-actions button{width:auto!important;min-width:0;margin:0!important;padding:8px 11px!important;border-radius:9px;font-size:10.5px!important;line-height:1;white-space:nowrap}
      #queuePanel .queue-edit-btn{border-color:#ffffff13}
      #queuePanel .queue-edit-state{display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:4px 8px;border:1px solid #22d3ee33;border-radius:999px;background:#22d3ee0b;color:#67e8f9;font-size:9px;font-weight:850;letter-spacing:.05em;text-transform:uppercase;width:max-content}
      #queuePanel .queue-edit-state::before{content:"✓";display:grid;place-items:center;width:12px;height:12px;border-radius:50%;background:#22d3ee18}
      #queuePanel .queue-error-detail{margin-top:6px;padding:7px 8px;border-radius:9px;background:#ef44440b;border:1px solid #ef44441f;color:#fca5a5;font-size:10px;line-height:1.4;white-space:normal;overflow-wrap:anywhere}
      #queuePanel .queue-download-progress{height:3px;margin-top:7px;border-radius:999px;overflow:hidden;background:#ffffff0d}
      #queuePanel .queue-download-progress>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#8b5cf6,#22d3ee);transition:width .12s ease}
      #robloxMidActiveEditing{display:none;align-items:center;gap:9px;margin:0 0 12px;padding:9px 12px;border:1px solid #8b5cf633;border-radius:10px;background:linear-gradient(90deg,#8b5cf60d,#22d3ee08);color:#c4b5fd;font-size:11px;line-height:1.35}
      #robloxMidActiveEditing.visible{display:flex}
      #robloxMidActiveEditing .active-edit-icon{width:22px;height:22px;flex:0 0 22px;display:grid;place-items:center;border-radius:7px;background:linear-gradient(135deg,#7c3aed,#0891b2);color:#fff;font-size:11px}
      #robloxMidActiveEditing strong{color:#fff;font-weight:800}
      @media(max-width:700px){
        #playlistCard .playlist-head{flex-direction:column}
        #playlistCard .playlist-actions{width:100%;justify-content:stretch}
        #playlistCard .playlist-actions button{flex:1}
        #playlistPagination{align-items:flex-start;flex-direction:column}
        #playlistPagination .pager-actions{width:100%}
        #playlistPagination .pager-actions button,#playlistPagination .pager-actions select{flex:1}
        #queuePanel .queue-item{grid-template-columns:48px minmax(0,1fr)}
        #queuePanel .queue-thumb{width:48px;height:40px}
        #queuePanel .queue-actions{grid-column:1 / -1;justify-content:stretch}
        #queuePanel .queue-actions button{flex:1}
      }
      @media(max-width:480px){
        #queuePanel .queue-item{grid-template-columns:44px minmax(0,1fr);padding:9px 10px}
        #queuePanel .queue-thumb{width:44px;height:38px}
      }
    `;
    document.head.appendChild(style);
  }

  function ensurePagination() {
    let pager = $("#playlistPagination");
    if (pager) return pager;
    pager = document.createElement("div");
    pager.id = "playlistPagination";
    pager.innerHTML = `
      <div class="pager-summary">
        <div id="playlistPageInfo"></div>
        <div id="playlistSelectionCount" class="pager-selected">0 dipilih</div>
      </div>
      <div class="pager-actions">
        <button type="button" id="playlistPrev">← Sebelumnya</button>
        <button type="button" id="playlistNext">Berikutnya →</button>
        <select id="playlistLimit" aria-label="Batas playlist">
          <option value="100">100 track</option>
          <option value="500">500 track</option>
          <option value="0">Semua track</option>
        </select>
      </div>`;
    card.appendChild(pager);
    $("#playlistPrev").onclick = () => { if (page > 1 && !loading) loadPage(page - 1); };
    $("#playlistNext").onclick = () => { if (hasNext && !loading) loadPage(page + 1); };
    $("#playlistLimit").onchange = () => {
      maxItems = Number($("#playlistLimit").value);
      page = 1;
      selectedIds.clear();
      selectedItems.clear();
      loadPage(1);
    };
    return pager;
  }

  function updateControls() {
    const pageInfo = $("#playlistPageInfo");
    const selectedInfo = $("#playlistSelectionCount");
    const prev = $("#playlistPrev");
    const next = $("#playlistNext");
    const limit = $("#playlistLimit");
    const start = currentItems.length ? ((page - 1) * PAGE_SIZE) + 1 : 0;
    const end = currentItems.length ? ((page - 1) * PAGE_SIZE) + currentItems.length : 0;
    if (pageInfo) pageInfo.textContent = `Halaman ${page} · ${start}–${end}${hasNext ? "+" : ""}`;
    if (selectedInfo) selectedInfo.textContent = `${selectedItems.size} dipilih`;
    if (prev) prev.disabled = loading || page <= 1;
    if (next) next.disabled = loading || !hasNext;
    if (limit) limit.value = String(maxItems);
    if (downloadButton) {
      downloadButton.disabled = loading || selectedItems.size === 0 || activeDownloads.size > 0;
      downloadButton.textContent = activeDownloads.size ? `⏳ Downloading ${activeDownloads.size}...` : selectedItems.size ? `⬇ Download ${selectedItems.size} Track` : "⬇ Download Terpilih";
    }
    if (selectAllButton) {
      const all = currentItems.length > 0 && currentItems.every(item => selectedIds.has(String(item.id)));
      selectAllButton.textContent = all ? "Batal Pilih" : "Pilih Semua";
    }
  }

  function renderItems() {
    list.innerHTML = currentItems.map((item, index) => {
      const id = String(item.id || `row-${index}`);
      const thumb = youtubeThumbnail(item);
      const title = String(item.title || "Untitled");
      const uploader = String(item.uploader || "");
      const duration = String(item.duration_string || "");
      return `<label class="playlist-item ${selectedIds.has(id) ? "is-selected" : ""}" data-index="${index}">
        <input type="checkbox" class="playlist-check" data-id="${escapeHtml(id)}" ${selectedIds.has(id) ? "checked" : ""}>
        ${thumb ? `<img class="pl-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" data-video-id="${escapeHtml(id)}">` : `<span class="pl-thumb" aria-hidden="true"></span>`}
        <div class="pl-meta">
          <div class="pl-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="pl-sub">${escapeHtml(uploader)}${duration ? ` · ⏱ ${escapeHtml(duration)}` : ""}</div>
        </div>
      </label>`;
    }).join("");

    list.querySelectorAll(".playlist-check").forEach(check => {
      check.onchange = () => {
        const id = String(check.dataset.id);
        const item = currentItems.find(entry => String(entry.id) === id);
        const row = check.closest(".playlist-item");
        if (check.checked) {
          selectedIds.add(id);
          if (item) selectedItems.set(id, { ...item, webpage_url: canonicalItemUrl(item), thumbnail: youtubeThumbnail(item) });
          row?.classList.add("is-selected");
        } else {
          selectedIds.delete(id);
          selectedItems.delete(id);
          row?.classList.remove("is-selected");
        }
        updateControls();
      };
    });

    list.querySelectorAll(".pl-thumb[data-video-id]").forEach(image => {
      const id = String(image.dataset.videoId || "");
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
      image.onerror = () => {
        const fallback = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
        if (image.src !== fallback) {
          image.src = fallback;
          return;
        }
        image.style.display = "none";
      };
    });

    updateControls();
  }

  function ensureActiveEditingBanner() {
    const panel = $("#queuePanel");
    if (!panel || $("#robloxMidActiveEditing")) return;
    const head = panel.querySelector(".panel-head");
    if (!head) return;
    const banner = document.createElement("div");
    banner.id = "robloxMidActiveEditing";
    banner.innerHTML = `<span class="active-edit-icon">✎</span><span>Track terpilih untuk diedit: <strong class="active-edit-title"></strong></span>`;
    head.insertAdjacentElement("afterend", banner);
  }

  function markQueueItemForEditing(item) {
    if (!item) return;
    ensureActiveEditingBanner();
    queueList?.querySelectorAll(".queue-item.is-editing").forEach(active => {
      active.classList.remove("is-editing");
      active.querySelector(".queue-edit-state")?.remove();
    });
    item.classList.add("is-editing");
    const meta = item.querySelector(".queue-meta");
    if (meta && !meta.querySelector(".queue-edit-state")) {
      const state = document.createElement("div");
      state.className = "queue-edit-state";
      state.textContent = "Loaded for editing";
      meta.appendChild(state);
    }
    const title = item.querySelector(".queue-title")?.textContent?.trim() || "Track";
    const banner = $("#robloxMidActiveEditing");
    const bannerTitle = banner?.querySelector(".active-edit-title");
    if (banner && bannerTitle) {
      bannerTitle.textContent = title;
      banner.classList.add("visible");
    }
  }

  function queueSnapshot(index) {
    try {
      if (typeof _downloadQueue === "undefined" || !Array.isArray(_downloadQueue)) return null;
      return _downloadQueue[index] || null;
    } catch { return null; }
  }

  function rerenderQueue() {
    if (typeof renderQueue === "function") renderQueue();
    decorateQueueErrors();
  }

  function decorateQueueErrors() {
    if (!queueList || typeof _downloadQueue === "undefined" || !Array.isArray(_downloadQueue)) return;
    queueList.querySelectorAll(".queue-item[data-qi]").forEach(row => {
      const index = Number(row.dataset.qi);
      const item = _downloadQueue[index];
      if (!item) return;
      row.classList.toggle("is-download-active", activeDownloads.has(String(item.id)));
      row.querySelector(".queue-error-detail")?.remove();
      row.querySelector(".queue-download-progress")?.remove();
      if (item.errorMessage && item.status === "error") {
        const meta = row.querySelector(".queue-meta");
        if (meta) {
          const detail = document.createElement("div");
          detail.className = "queue-error-detail";
          detail.textContent = String(item.errorMessage).slice(0, 260);
          meta.appendChild(detail);
        }
      }
      if (activeDownloads.has(String(item.id))) {
        const meta = row.querySelector(".queue-meta");
        if (meta) {
          const wrap = document.createElement("div");
          wrap.className = "queue-download-progress";
          const bar = document.createElement("i");
          bar.style.width = `${Math.max(0, Math.min(100, Number(item.downloadPercent || 0)))}%`;
          wrap.appendChild(bar);
          meta.appendChild(wrap);
        }
      }
    });
  }

  async function downloadQueueBinary(index) {
    const item = queueSnapshot(index);
    if (!item || !item.url) return false;
    const id = String(item.id || index);
    if (activeDownloads.has(id)) return false;

    activeDownloads.add(id);
    item.status = "waiting";
    item.errorMessage = "";
    item.downloadPercent = 0;
    rerenderQueue();

    try {
      const response = await fetch("/api/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "audio/mpeg,audio/*" },
        body: JSON.stringify({ url: canonicalItemUrl(item) || normalizeUrl(item.url) })
      });

      if (!response.ok) {
        let message = `Server HTTP ${response.status}`;
        try {
          const data = await response.json();
          message = data?.error || data?.message || message;
          if (data?.code) message = `${message} [${data.code}]`;
        } catch {
          try {
            const text = await response.text();
            if (text.trim()) message = text.trim().slice(0, 260);
          } catch {}
        }
        throw new Error(message);
      }

      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_BROWSER_BYTES) throw new Error("File terlalu besar. Maksimal 20 MB.");

      const titleHeader = response.headers.get("x-track-title");
      let title = item.title || "Track";
      if (titleHeader) {
        try { title = decodeURIComponent(titleHeader); } catch { title = titleHeader; }
      }

      const contentType = response.headers.get("content-type") || "audio/mpeg";
      const reader = response.body?.getReader();
      const chunks = [];
      let received = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          received += value.byteLength;
          if (received > MAX_BROWSER_BYTES) {
            try { await reader.cancel(); } catch {}
            throw new Error("File terlalu besar. Maksimal 20 MB.");
          }
          chunks.push(value);
          item.downloadPercent = declared > 0 ? Math.min(100, Math.round(received / declared * 100)) : 0;
          rerenderQueue();
        }
      } else {
        const value = new Uint8Array(await response.arrayBuffer());
        received = value.byteLength;
        if (received > MAX_BROWSER_BYTES) throw new Error("File terlalu besar. Maksimal 20 MB.");
        chunks.push(value);
        item.downloadPercent = 100;
      }

      if (!received) throw new Error("Server mengembalikan file kosong.");

      const blob = new Blob(chunks, { type: contentType.includes("audio/") ? contentType : "audio/mpeg" });
      const safeTitle = String(title || item.title || "Track").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 100) || "Track";
      item.file = new File([blob], `${safeTitle}.mp3`, { type: blob.type });
      item.title = safeTitle;
      item.status = "ready";
      item.errorMessage = "";
      item.downloadPercent = 100;
      return true;
    } catch (error) {
      item.status = "error";
      item.errorMessage = error?.message || "Gagal mendownload audio.";
      item.file = null;
      return false;
    } finally {
      activeDownloads.delete(id);
      rerenderQueue();
      updateControls();
    }
  }

  function bindQueueController() {
    if (!queueList || queueList.dataset.canonicalQueueController === "true") return;
    queueList.dataset.canonicalQueueController = "true";

    queueList.addEventListener("click", event => {
      const button = event.target.closest?.("button[data-qi]");
      if (!button) return;
      const index = Number(button.dataset.qi);
      const item = queueSnapshot(index);
      if (!item) return;

      if (button.classList.contains("queue-retry-btn")) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        void downloadQueueBinary(index);
        return;
      }

      if (button.classList.contains("queue-edit-btn")) {
        markQueueItemForEditing(button.closest(".queue-item"));
      }
    }, true);
  }

  async function downloadSelected() {
    if (loading || selectedItems.size === 0 || activeDownloads.size > 0) return;
    if (typeof _downloadQueue === "undefined" || !Array.isArray(_downloadQueue)) {
      showStatus("Queue downloader belum siap. Refresh halaman lalu coba lagi.", true);
      return;
    }

    const chosen = [...selectedItems.values()];
    downloadButton.disabled = true;
    selectAllButton.disabled = true;
    progress?.classList.remove("hidden");

    const start = _downloadQueue.length;
    chosen.forEach(item => {
      _downloadQueue.push({
        id: String(item.id),
        title: String(item.title || "Track"),
        thumbnail: youtubeThumbnail(item),
        url: canonicalItemUrl(item),
        file: null,
        status: "waiting",
        errorMessage: "",
        downloadPercent: 0
      });
    });
    rerenderQueue();

    for (let i = 0; i < chosen.length; i++) {
      const qIndex = start + i;
      const selected = chosen[i];
      if (progressText) progressText.textContent = `Mendownload ${i + 1}/${chosen.length}: ${selected.title}`;
      if (progressBar) progressBar.style.width = `${Math.round((i / chosen.length) * 100)}%`;
      await downloadQueueBinary(qIndex);
    }

    if (progressBar) progressBar.style.width = "100%";
    const readyCount = chosen.filter((_, i) => _downloadQueue[start + i]?.status === "ready").length;
    const failedCount = chosen.length - readyCount;
    if (progressText) progressText.textContent = failedCount ? `⚠ ${readyCount} siap, ${failedCount} gagal. Cek detail error di antrian.` : `✓ ${readyCount} track siap diedit di antrian.`;
    downloadButton.disabled = false;
    selectAllButton.disabled = false;
    updateControls();
  }

  async function loadPage(targetPage) {
    if (loading || targetPage < 1 || !sourceUrl) return;
    loading = true;
    updateControls();
    try {
      const query = new URLSearchParams({ page: String(targetPage), pageSize: String(PAGE_SIZE), maxItems: String(maxItems) });
      const response = await fetch(`/api/playlist-info?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Gagal mengambil playlist.");

      if (!data.isPlaylist && data.items?.length === 1) {
        const item = data.items[0];
        const thumb = youtubeThumbnail(item);
        if (preview) preview.classList.remove("hidden");
        const image = $("#urlThumb");
        const title = $("#urlTitle");
        const uploader = $("#urlUploader");
        const duration = $("#urlDuration");
        const fetchButton = $("#urlFetchBtn");
        if (image) { image.src = thumb; image.classList.toggle("hidden", !thumb); }
        if (title) title.textContent = item.title || "Track";
        if (uploader) uploader.textContent = item.uploader || "";
        if (duration) duration.textContent = item.duration_string ? `⏱ ${item.duration_string}` : "";
        if (fetchButton) {
          fetchButton.disabled = false;
          fetchButton.dataset.sourceUrl = canonicalItemUrl(item);
        }
        card.classList.add("hidden");
        hasNext = false;
        hideStatus();
        return;
      }

      currentItems = (data.items || []).map(item => ({ ...item, webpage_url: canonicalItemUrl(item), thumbnail: youtubeThumbnail(item) }));
      currentItems.forEach(item => {
        const id = String(item.id);
        if (selectedIds.has(id)) selectedItems.set(id, item);
      });
      page = Number(data.page || targetPage);
      hasNext = Boolean(data.hasNext);
      titleEl.textContent = data.playlistTitle || "Playlist";
      const loadedStart = ((page - 1) * PAGE_SIZE) + 1;
      const loadedEnd = ((page - 1) * PAGE_SIZE) + currentItems.length;
      metaEl.textContent = maxItems === 0 ? `Track ${loadedStart}–${loadedEnd}${hasNext ? "+" : ""}` : `Track ${loadedStart}–${loadedEnd} · batas ${maxItems}`;
      card.classList.remove("hidden");
      preview?.classList.add("hidden");
      ensurePagination();
      renderItems();
      hideStatus();
    } catch (error) {
      card.classList.add("hidden");
      showStatus(`✗ ${error?.message || "Gagal mengambil playlist."}`, true);
    } finally {
      loading = false;
      updateControls();
    }
  }

  async function check() {
    sourceUrl = normalizeUrl(input.value);
    if (!sourceUrl) {
      showStatus("✗ Masukkan URL lengkap.", true);
      return;
    }
    input.value = sourceUrl;
    page = 1;
    currentItems = [];
    selectedIds.clear();
    selectedItems.clear();
    injectStyles();
    ensurePagination();
    ensureActiveEditingBanner();
    bindQueueController();
    showStatus("⏳ Memuat playlist...", false);
    preview?.classList.add("hidden");
    await loadPage(1);
  }

  selectAllButton && (selectAllButton.onclick = () => {
    const allSelected = currentItems.length > 0 && currentItems.every(item => selectedIds.has(String(item.id)));
    currentItems.forEach(item => {
      const id = String(item.id);
      if (allSelected) {
        selectedIds.delete(id);
        selectedItems.delete(id);
      } else {
        selectedIds.add(id);
        selectedItems.set(id, { ...item, webpage_url: canonicalItemUrl(item), thumbnail: youtubeThumbnail(item) });
      }
    });
    renderItems();
  });

  downloadButton && (downloadButton.onclick = downloadSelected);
  infoButton.onclick = check;

  injectStyles();
  ensureActiveEditingBanner();
  bindQueueController();
  decorateQueueErrors();
})();
