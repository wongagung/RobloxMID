/* RobloxMID canonical playlist + queue UI. */
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
    if $("#robloxMidCanonicalPlaylistStyles")) return;
    const style = document.createElement("style");
    style.id = "robloxMidCanonicalPlaylistStyles";
    style.textContent = `
      #playlistCard{margin-top:16px;padding:18px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.025);overflow:hidden}
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

      #queuePanel{order:-1;margin-top:18px}
      #queuePanel .panel-head{margin-bottom:14px}
      #queuePanel .panel-head>div{min-width:0}
      #queuePanel .queue-list{display:flex;flex-direction:column;gap:8px;max-height:460px;overflow:auto;padding-right:2px}
      #queuePanel .queue-item{display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:12px;align-items:center;position:relative;min-height:64px;padding:10px 12px;border:1px solid var(--line);border-radius:13px;background:rgba(255,255,255,.018);transition:background .15s,border-color .15s,box-shadow .15s}
      #queuePanel .queue-item:hover{background:rgba(255,255,255,.03);border-color:rgba(255,255,255,.13)}
      #queuePanel .queue-item.queue-item-ready{border-color:#8b5cf625;background:#8b5cf606}
      #queuePanel .queue-item.queue-item-error{border-color:#ef44441d;background:#ef444406}
      #queuePanel .queue-item.queue-item-done{opacity:.6}
      #queuePanel .queue-item.is-editing{border-color:#8b5cf677;background:linear-gradient(90deg,#8b5cf612,#22d3ee08);box-shadow:0 0 0 1px #8b5cf61c,0 10px 28px #00000020}
      #queuePanel .queue-item.is-editing::before{content:"";position:absolute;left:0;top:9px;bottom:9px;width:3px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,#8b5cf6,#22d3ee)}
      #queuePanel .queue-thumb{display:block;width:56px;height:42px;border-radius:8px;object-fit:cover;background:#080b13;border:1px solid #ffffff0d}
      #queuePanel .queue-meta{min-width:0;align-self:center}
      #queuePanel .queue-title{display:block;font-size:13px;font-weight:800;line-height:1.38;color:var(--text);white-space:normal;overflow-wrap:anywhere;word-break:break-word}
      #queuePanel .queue-status-text{margin-top:4px;font-size:10.5px;line-height:1.35;color:var(--muted)}
      #queuePanel .queue-item-ready .queue-status-text{color:#6ee7b7}
      #queuePanel .queue-item-error .queue-status-text{color:#fca5a5}
      #queuePanel .queue-item.is-editing .queue-status-text{color:#67e8f9;font-weight:800}
      #queuePanel .queue-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap}
      #queuePanel .queue-actions button{width:auto!important;min-width:0;margin:0!important;padding:8px 11px!important;border-radius:9px;font-size:10.5px!important;line-height:1;white-space:nowrap}
      #queuePanel .queue-edit-btn{border-color:#ffffff13}
      #queuePanel .queue-edit-state{display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:4px 8px;border:1px solid #22d3ee33;border-radius:999px;background:#22d3ee0b;color:#67e8f9;font-size:9px;font-weight:850;letter-spacing:.05em;text-transform:uppercase;width:max-content}
      #queuePanel .queue-edit-state::before{content:"✓";display:grid;place-items:center;width:12px;height:12px;border-radius:50%;background:#22d3ee18}
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
      downloadButton.disabled = loading || selectedItems.size === 0;
      downloadButton.textContent = selectedItems.size ? `⬇ Download ${selectedItems.size} Track` : "⬇ Download Terpilih";
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

  function clearEditingMarkers() {
    document.querySelectorAll("#queuePanel .queue-item.is-editing").forEach(item => {
      item.classList.remove("is-editing");
      item.querySelector(".queue-edit-state")?.remove();
    });
  }

  function markQueueItemForEditing(item) {
    if (!item) return;
    ensureActiveEditingBanner();
    clearEditingMarkers();
    item.classList.add("is-editing");
    const meta = item.querySelector(".queue-meta");
    if (meta) {
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

  function normalizeQueueDom() {
    const queueList = $("#queueList");
    if (!queueList) return;
    queueList.querySelectorAll(".queue-item").forEach(item => {
      const edit = item.querySelector(".queue-edit-btn");
      if (edit) edit.title = "Muat track ini ke editor";
    });
  }

  function bindQueueEditSelection() {
    const queueList = $("#queueList");
    if (!queueList || queueList.dataset.editSelectorBound === "true") return;
    queueList.dataset.editSelectorBound = "true";
    queueList.addEventListener("click", event => {
      const button = event.target.closest?.(".queue-edit-btn");
      if (!button) return;
      markQueueItemForEditing(button.closest(".queue-item"));
    });
  }

  async function downloadSelected() {
    if (loading || selectedItems.size === 0) return;
    if (typeof _downloadQueue === "undefined" || typeof downloadQueueItem !== "function") {
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
        errorMessage: ""
      });
    });
    if (typeof renderQueue === "function") renderQueue();

    for (let i = 0; i < chosen.length; i++) {
      const qIndex = start + i;
      if (progressText) progressText.textContent = `Mendownload ${i + 1}/${chosen.length}: ${chosen[i].title}`;
      if (progressBar) progressBar.style.width = `${(i / chosen.length) * 100}%`;
      await downloadQueueItem(qIndex);
    }

    if (progressBar) progressBar.style.width = "100%";
    if (progressText) progressText.textContent = `✓ ${chosen.length} track diproses ke antrian`;
    downloadButton.disabled = false;
    selectAllButton.disabled = false;
    updateControls();
  }

  async function loadPage(targetPage) {
    if (loading || targetPage < 1 || !sourceUrl) return;
    loading = true;
    updateControls();
    try {
      const query = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(PAGE_SIZE),
        maxItems: String(maxItems)
      });
      const response = await fetch(`/api/playlist-info?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Gagal mengambil playlist.");

      if (!data.isPlaylist && data.items?.length === 1) {
        const item = data.items[0];
        if (preview) preview.classList.remove("hidden");
        const thumb = $("#urlThumb");
        const title = $("#urlTitle");
        const uploader = $("#urlUploader");
        const duration = $("#urlDuration");
        const fetchButton = $("#urlFetchBtn");
        const thumbUrl = youtubeThumbnail(item);
        if (thumb) { thumb.src = thumbUrl; thumb.classList.toggle("hidden", !thumbUrl); }
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
      metaEl.textContent = maxItems === 0
        ? `${currentItems.length}${hasNext ? "+" : ""} track di halaman ini`
        : `${((page - 1) * PAGE_SIZE) + currentItems.length}/${maxItems} track`;
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

  const globalObserver = new MutationObserver(() => {
    injectStyles();
    ensureActiveEditingBanner();
    bindQueueEditSelection();
    normalizeQueueDom();
  });
  globalObserver.observe(document.documentElement, { childList: true, subtree: true });

  injectStyles();
  ensureActiveEditingBanner();
  bindQueueEditSelection();
  normalizeQueueDom();
})();
