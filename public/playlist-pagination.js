/* RobloxMID canonical playlist UI + queue integration. */
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

  if (!input || !infoButton || !card || !list) return;

  const PAGE_SIZE = 50;
  let sourceUrl = "";
  let page = 1;
  let maxItems = 100;
  let hasNext = false;
  let loading = false;
  let currentItems = [];
  const selectedIds = new Set();
  const selectedItems = new Map();

  function normalizeUrl(value) {
    let url = String(value ?? "").trim();
    for (let i = 0; i < 2; i++) {
      try {
        const decoded = decodeURIComponent(url);
        if (decoded === url) break;
        url = decoded.trim();
      } catch {
        break;
      }
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
      if ((host === "youtube.com" || host === "www.youtube.com" || host === "music.youtube.com" || host === "youtu.be" || host === "www.youtu.be") && id) {
        return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
      }
    } catch {}
    if (id && /^(?:[A-Za-z0-9_-]{11})$/.test(id) && /(?:youtube\.com|youtu\.be)$/i.test(raw)) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    }
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
      #playlistCard{margin-top:16px;padding:18px;border:1px solid var(--line);border-radius:18px;background:var(--panel-bg,rgba(255,255,255,.025));overflow:hidden}
      #playlistCard .playlist-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding-bottom:14px;border-bottom:1px solid var(--line)}
      #playlistCard .playlist-title{font-size:15px;line-height:1.35;font-weight:800;color:var(--text);white-space:normal;overflow-wrap:anywhere;word-break:break-word}
      #playlistCard .playlist-meta{margin-top:5px;font-size:11px;line-height:1.4;color:var(--muted)}
      #playlistCard .playlist-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;flex:0 0 auto}
      #playlistCard .playlist-items{display:flex;flex-direction:column;gap:7px;margin-top:14px;max-height:540px;overflow:auto;padding-right:3px}
      #playlistCard .playlist-item{display:grid;grid-template-columns:20px 48px minmax(0,1fr);gap:11px;align-items:center;padding:9px 10px;border:1px solid transparent;border-radius:12px;background:rgba(255,255,255,.02);transition:background .15s,border-color .15s}
      #playlistCard .playlist-item:hover{border-color:var(--line);background:rgba(255,255,255,.045)}
      #playlistCard .playlist-item input{margin:0;accent-color:#8b5cf6}
      #playlistCard .pl-thumb{display:block;width:48px;height:48px;border-radius:10px;object-fit:cover;background:#0b1020;border:1px solid var(--line)}
      #playlistCard .pl-meta{min-width:0}
      #playlistCard .pl-title{font-size:12px;font-weight:750;line-height:1.35;white-space:normal;overflow-wrap:anywhere;word-break:break-word;color:var(--text)}
      #playlistCard .pl-sub{margin-top:4px;font-size:10px;line-height:1.3;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #playlistPagination{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
      #playlistPagination .pager-summary{min-width:0;font-size:10px;line-height:1.4;color:var(--muted)}
      #playlistPagination .pager-selected{margin-top:2px;font-weight:800;color:#a78bfa}
      #playlistPagination .pager-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
      #playlistPagination button,#playlistPagination select{min-height:34px;padding:7px 10px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.03);color:var(--text);font-size:11px;font-weight:750}
      #playlistPagination button{cursor:pointer}
      #playlistPagination button:disabled{opacity:.45;cursor:not-allowed}
      #queuePanel{margin-top:18px}
      #queuePanel .queue-list{display:flex;flex-direction:column;gap:8px}
      #queuePanel .queue-item{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:11px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.018)}
      #queuePanel .queue-thumb{width:48px;height:48px;display:block;object-fit:cover;border-radius:10px;background:#0b1020;border:1px solid var(--line)}
      #queuePanel .queue-meta{min-width:0}
      #queuePanel .queue-title{font-size:12px;font-weight:800;line-height:1.35;white-space:normal;overflow-wrap:anywhere;word-break:break-word;color:var(--text)}
      #queuePanel .queue-status-text{margin-top:4px;font-size:10px;line-height:1.35;color:var(--muted)}
      #queuePanel .queue-item-error .queue-status-text{color:#f87171}
      #queuePanel .queue-item-ready .queue-status-text{color:#34d399}
      #queuePanel .queue-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}
      #queuePanel .queue-actions button{width:auto!important;margin:0!important;min-height:34px;padding:7px 11px!important;font-size:11px!important}
      #queuePanel .queue-error-detail{grid-column:2 / -1;margin-top:-2px;padding:8px 10px;border-radius:9px;background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.16);color:#fca5a5;font-size:10px;line-height:1.45;overflow-wrap:anywhere}
      @media(max-width:700px){
        #playlistCard .playlist-head{flex-direction:column}
        #playlistCard .playlist-actions{width:100%;justify-content:stretch}
        #playlistCard .playlist-actions button{flex:1}
        #playlistPagination{align-items:flex-start;flex-direction:column}
        #playlistPagination .pager-actions{width:100%}
        #playlistPagination .pager-actions button,#playlistPagination .pager-actions select{flex:1}
        #queuePanel .queue-item{grid-template-columns:44px minmax(0,1fr)}
        #queuePanel .queue-actions{grid-column:1 / -1;justify-content:stretch}
        #queuePanel .queue-actions button{flex:1}
        #queuePanel .queue-error-detail{grid-column:1 / -1}
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

    const loadedStart = currentItems.length ? ((page - 1) * PAGE_SIZE) + 1 : 0;
    const loadedEnd = currentItems.length ? ((page - 1) * PAGE_SIZE) + currentItems.length : 0;
    if (pageInfo) pageInfo.textContent = `Halaman ${page} · ${loadedStart}–${loadedEnd}${hasNext ? "+" : ""}`;
    if (selectedInfo) selectedInfo.textContent = `${selectedItems.size} dipilih`;
    if (prev) prev.disabled = loading || page <= 1;
    if (next) next.disabled = loading || !hasNext;
    if (limit) limit.value = String(maxItems);
    if (downloadButton) {
      downloadButton.disabled = loading || selectedItems.size === 0;
      downloadButton.textContent = selectedItems.size ? `⬇ Download ${selectedItems.size} Track` : "⬇ Download Terpilih";
    }
    if (selectAllButton) {
      const allSelected = currentItems.length > 0 && currentItems.every(item => selectedIds.has(String(item.id)));
      selectAllButton.textContent = allSelected ? "Batal Pilih" : "Pilih Semua";
    }
  }

  function renderItems() {
    list.innerHTML = currentItems.map((item, index) => {
      const id = String(item.id || `row-${index}`);
      const thumb = youtubeThumbnail(item);
      const title = String(item.title || "Untitled");
      const uploader = String(item.uploader || "");
      const duration = String(item.duration_string || "");
      return `
        <label class="playlist-item" data-index="${index}">
          <input type="checkbox" class="playlist-check" data-id="${escapeHtml(id)}" ${selectedIds.has(id) ? "checked" : ""}>
          <img class="pl-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy" data-video-id="${escapeHtml(id)}">
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
        if (check.checked) {
          selectedIds.add(id);
          if (item) selectedItems.set(id, { ...item, webpage_url: canonicalItemUrl(item) });
        } else {
          selectedIds.delete(id);
          selectedItems.delete(id);
        }
        updateControls();
      };
    });

    list.querySelectorAll(".pl-thumb").forEach(image => {
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

  function addQueueItem(item) {
    if (typeof _downloadQueue === "undefined") return null;
    const normalized = {
      id: String(item.id || cryptoSafeId(item)),
      title: String(item.title || "Track"),
      thumbnail: youtubeThumbnail(item),
      url: canonicalItemUrl(item),
      file: null,
      status: "waiting",
      errorMessage: ""
    };
    _downloadQueue.push(normalized);
    return _downloadQueue.length - 1;
  }

  function cryptoSafeId(item) {
    const raw = canonicalItemUrl(item);
    let hash = 0;
    for (let i = 0; i < raw.length; i++) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    return `url-${Math.abs(hash)}`;
  }

  function renderQueueWithDetails() {
    if (typeof renderQueue === "function") renderQueue();
    const queueList = $("#queueList");
    if (!queueList || typeof _downloadQueue === "undefined") return;
    queueList.querySelectorAll(".queue-item").forEach(row => {
      const index = Number(row.dataset.qi);
      const item = _downloadQueue[index];
      if (!item?.errorMessage) return;
      const detail = document.createElement("div");
      detail.className = "queue-error-detail";
      detail.textContent = item.errorMessage;
      row.appendChild(detail);
    });
  }

  async function downloadOne(item, queueIndex, overallIndex, total) {
    const queueItem = _downloadQueue?.[queueIndex];
    if (!queueItem) return false;
    queueItem.status = "waiting";
    queueItem.errorMessage = "";
    renderQueueWithDetails();

    return new Promise(resolve => {
      const eventSource = new EventSource(`/api/fetch-url-stream?url=${encodeURIComponent(queueItem.url)}`);
      let finished = false;

      const finish = ok => {
        if (finished) return;
        finished = true;
        eventSource.close();
        renderQueueWithDetails();
        resolve(ok);
      };

      eventSource.addEventListener("progress", event => {
        try {
          const data = JSON.parse(event.data);
          if (progressText) progressText.textContent = `Mendownload ${overallIndex}/${total}: ${queueItem.title}${data.percent !== undefined ? ` · ${Math.round(data.percent)}%` : ""}`;
          if (progressBar && data.percent !== undefined) progressBar.style.width = `${Math.max(0, Math.min(100, Number(data.percent)))}%`;
        } catch {}
      });

      eventSource.addEventListener("file", event => {
        try {
          const data = JSON.parse(event.data);
          const binary = atob(data.data || "");
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: data.mimeType || "audio/mpeg" });
          const filename = `${String(data.title || queueItem.title).replace(/[\\/:*?\"<>|]/g, "_")}.mp3`;
          queueItem.file = new File([blob], filename, { type: blob.type });
          queueItem.title = String(data.title || queueItem.title);
          queueItem.status = "ready";
          finish(true);
        } catch (error) {
          queueItem.status = "error";
          queueItem.errorMessage = `Hasil download tidak dapat dibaca: ${error.message}`;
          finish(false);
        }
      });

      eventSource.addEventListener("error", event => {
        let message = "Download gagal.";
        try {
          const data = JSON.parse(event.data || "{}");
          if (data.message) message = data.code ? `${data.message} (${data.code})` : data.message;
        } catch {}
        queueItem.status = "error";
        queueItem.errorMessage = message;
        finish(false);
      });

      eventSource.onerror = () => {
        if (finished) return;
        queueItem.status = "error";
        queueItem.errorMessage = "Koneksi download terputus atau server tidak merespons.";
        finish(false);
      };
    });
  }

  async function downloadSelected() {
    if (!selectedItems.size || loading || typeof _downloadQueue === "undefined") return;
    const chosen = [...selectedItems.values()].map(item => ({ ...item, webpage_url: canonicalItemUrl(item) }));
    if (!chosen.length) return;

    downloadButton.disabled = true;
    selectAllButton && (selectAllButton.disabled = true);
    progress?.classList.remove("hidden");
    if (progressBar) progressBar.style.width = "0%";

    const firstQueueIndex = _downloadQueue.length;
    chosen.forEach(addQueueItem);
    renderQueueWithDetails();

    let okCount = 0;
    for (let i = 0; i < chosen.length; i++) {
      const queueIndex = firstQueueIndex + i;
      const ok = await downloadOne(chosen[i], queueIndex, i + 1, chosen.length);
      if (ok) okCount++;
      if (progressBar) progressBar.style.width = `${Math.round(((i + 1) / chosen.length) * 100)}%`;
    }

    if (progressText) progressText.textContent = `✓ ${okCount}/${chosen.length} track siap diedit`;
    renderQueueWithDetails();
    downloadButton.disabled = false;
    selectAllButton && (selectAllButton.disabled = false);
    updateControls();
  }

  async function loadPage(targetPage) {
    if (loading || !sourceUrl || targetPage < 1) return;
    loading = true;
    updateControls();
    try {
      const normalized = normalizeUrl(sourceUrl);
      sourceUrl = normalized;
      input.value = normalized;
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(PAGE_SIZE),
        maxItems: String(maxItems)
      });
      const response = await fetch(`/api/playlist-info?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Gagal mengambil playlist.");

      if (!data.isPlaylist && Array.isArray(data.items) && data.items.length === 1) {
        const item = data.items[0];
        const thumb = youtubeThumbnail(item);
        $("#urlTitle") && ($("#urlTitle").textContent = item.title || "Track");
        $("#urlUploader") && ($("#urlUploader").textContent = item.uploader || "");
        $("#urlDuration") && ($("#urlDuration").textContent = item.duration_string ? `⏱ ${item.duration_string}` : "");
        const image = $("#urlThumb");
        if (image) {
          image.src = thumb;
          image.classList.toggle("hidden", !thumb);
        }
        $("#urlFetchBtn") && ($("#urlFetchBtn").disabled = false);
        card.classList.add("hidden");
        preview?.classList.remove("hidden");
        hasNext = false;
        return;
      }

      page = Number(data.page || targetPage);
      hasNext = Boolean(data.hasNext);
      currentItems = Array.isArray(data.items) ? data.items : [];
      currentItems.forEach(item => {
        const id = String(item.id);
        if (selectedIds.has(id)) selectedItems.set(id, { ...item, webpage_url: canonicalItemUrl(item) });
      });

      titleEl.textContent = String(data.playlistTitle || "Playlist");
      metaEl.textContent = `${currentItems.length} track di halaman ini${hasNext ? " · masih ada lanjutan" : ""}`;
      card.classList.remove("hidden");
      preview?.classList.add("hidden");
      ensurePagination();
      renderItems();
      hideStatus();
    } catch (error) {
      card.classList.add("hidden");
      showStatus(`✗ ${error.message || "Gagal mengambil playlist."}`, true);
    } finally {
      loading = false;
      updateControls();
    }
  }

  async function checkPlaylist() {
    const normalized = normalizeUrl(input.value);
    if (!normalized) {
      showStatus("✗ Masukkan URL terlebih dahulu.", true);
      return;
    }
    sourceUrl = normalized;
    page = 1;
    currentItems = [];
    selectedIds.clear();
    selectedItems.clear();
    injectStyles();
    ensurePagination();
    input.value = normalized;
    showStatus("⏳ Memuat playlist...");
    await loadPage(1);
  }

  if (selectAllButton) {
    selectAllButton.onclick = () => {
      const allSelected = currentItems.length > 0 && currentItems.every(item => selectedIds.has(String(item.id)));
      currentItems.forEach(item => {
        const id = String(item.id);
        if (allSelected) {
          selectedIds.delete(id);
          selectedItems.delete(id);
        } else {
          selectedIds.add(id);
          selectedItems.set(id, { ...item, webpage_url: canonicalItemUrl(item) });
        }
      });
      renderItems();
    };
  }

  if (downloadButton) downloadButton.onclick = downloadSelected;
  infoButton.onclick = checkPlaylist;

  injectStyles();
  updateControls();
})();
