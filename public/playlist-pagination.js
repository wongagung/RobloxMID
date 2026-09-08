/* Playlist pagination UI for RobloxMID. Loaded after app.js by the /app.js wrapper in asset-preload.js. */
(function () {
  const $ = s => document.querySelector(s);
  const urlInput = $("#urlInput");
  const urlInfoBtn = $("#urlInfoBtn");
  const playlistCard = $("#playlistCard");
  const playlistItems = $("#playlistItems");
  const playlistTitle = $("#playlistTitle");
  const playlistMeta = $("#playlistMeta");
  const playlistDownloadBtn = $("#playlistDownloadBtn");
  const playlistSelectAll = $("#playlistSelectAll");
  const playlistProgress = $("#playlistProgress");
  const playlistProgBar = $("#playlistProgBar");
  const playlistProgText = $("#playlistProgText");
  const urlPreviewCard = $("#urlPreviewCard");
  const urlStatus = $("#urlStatus");
  const urlStatusText = $("#urlStatusText");

  if (!urlInput || !urlInfoBtn || !playlistCard || !playlistItems) return;

  let items = [];
  let selected = new Set();
  let page = 1;
  let maxItems = 100;
  let hasNext = false;
  let loading = false;
  let playlistUrl = "";
  const PAGE_SIZE = 50;

  const esc = value => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  function setStatus(message, error = false) {
    if (!urlStatus || !urlStatusText) return;
    urlStatus.classList.remove("hidden");
    urlStatusText.textContent = message;
    urlStatus.className = "url-status" + (error ? " error" : " info");
  }

  function reset() {
    items = [];
    selected.clear();
    page = 1;
    hasNext = false;
    playlistUrl = "";
    if (playlistItems) playlistItems.innerHTML = "";
    if (playlistCard) playlistCard.classList.add("hidden");
  }

  function injectStyles() {
    if ($("#playlistPaginationStyles")) return;
    const style = document.createElement("style");
    style.id = "playlistPaginationStyles";
    style.textContent = `
      .playlist-pagination{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0 2px;border-top:1px solid var(--line);margin-top:10px;flex-wrap:wrap}
      .playlist-page-info{font-size:11px;color:var(--muted)}
      .playlist-page-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
      .playlist-page-btn{border:1px solid var(--line);background:#ffffff05;color:var(--text);border-radius:9px;padding:7px 11px;cursor:pointer;font-size:11px;font-weight:700}
      .playlist-page-btn:hover{border-color:#8b5cf655;background:#8b5cf60c}
      .playlist-page-btn:disabled{opacity:.4;cursor:not-allowed}
      .playlist-limit{border:1px solid var(--line);background:#080b13;color:var(--text);border-radius:9px;padding:7px 10px;font-size:11px;outline:none}
      .playlist-limit:focus{border-color:#8b5cf655}
      .playlist-page-loading{font-size:11px;color:#a78bfa}
    `;
    document.head.appendChild(style);
  }

  function getControls() {
    let el = $("#playlistPagination");
    if (el) return el;
    el = document.createElement("div");
    el.id = "playlistPagination";
    el.className = "playlist-pagination";
    el.innerHTML = `
      <div class="playlist-page-info" id="playlistPageInfo"></div>
      <div class="playlist-page-actions">
        <span class="playlist-page-loading hidden" id="playlistPageLoading">Memuat...</span>
        <select class="playlist-limit" id="playlistLimit" title="Batas playlist">
          <option value="100">100 track</option>
          <option value="500">500 track</option>
          <option value="0">Semua track</option>
        </select>
        <button type="button" class="playlist-page-btn" id="playlistPrev">← Sebelumnya</button>
        <button type="button" class="playlist-page-btn" id="playlistNext">Berikutnya →</button>
      </div>`;
    playlistCard.appendChild(el);
    $("#playlistLimit").value = String(maxItems);
    $("#playlistLimit").addEventListener("change", async e => {
      maxItems = Number(e.target.value);
      await reloadPlaylist();
    });
    $("#playlistPrev").addEventListener("click", async () => {
      if (loading || page <= 1) return;
      page -= 1;
      await loadPage(page, false);
    });
    $("#playlistNext").addEventListener("click", async () => {
      if (loading || !hasNext) return;
      page += 1;
      await loadPage(page, false);
    });
    return el;
  }

  function render() {
    playlistItems.innerHTML = items.map((item, i) => `
      <label class="playlist-item" data-pidx="${i}">
        <input type="checkbox" class="pl-check-paged" data-id="${esc(item.id)}" ${selected.has(String(item.id)) ? "checked" : ""}>
        <img class="pl-thumb" src="${esc(item.thumbnail || "")}" alt="" onerror="this.style.display='none'">
        <div class="pl-meta">
          <div class="pl-title">${esc(item.title)}</div>
          <div class="pl-sub">${esc(item.uploader || "")}${item.duration_string ? " · ⏱ " + esc(item.duration_string) : ""}</div>
        </div>
      </label>`).join("");

    playlistItems.querySelectorAll(".pl-check-paged").forEach(chk => {
      chk.addEventListener("change", () => {
        const id = String(chk.dataset.id);
        if (chk.checked) selected.add(id);
        else selected.delete(id);
        updateDownloadButton();
      });
    });

    updateDownloadButton();
    updateControls();
  }

  function updateDownloadButton() {
    if (!playlistDownloadBtn) return;
    playlistDownloadBtn.disabled = selected.size === 0;
    playlistDownloadBtn.textContent = selected.size
      ? `⬇ Download ${selected.size} Track`
      : "⬇ Download Terpilih";
  }

  function updateControls() {
    const info = $("#playlistPageInfo");
    const prev = $("#playlistPrev");
    const next = $("#playlistNext");
    const limit = $("#playlistLimit");
    if (!info || !prev || !next) return;
    const loadedEnd = (page - 1) * PAGE_SIZE + items.length;
    const cap = maxItems === 0 ? "Semua" : String(maxItems);
    info.textContent = `Halaman ${page} · ${items.length} track tampil · ${loadedEnd}${hasNext ? "+" : ""} dimuat · batas ${cap}`;
    prev.disabled = loading || page <= 1;
    next.disabled = loading || !hasNext;
    if (limit) limit.value = String(maxItems);
    const load = $("#playlistPageLoading");
    if (load) load.classList.toggle("hidden", !loading);
  }

  async function loadPage(targetPage, append) {
    loading = true;
    updateControls();
    try {
      const params = new URLSearchParams({
        url: playlistUrl,
        page: String(targetPage),
        pageSize: String(PAGE_SIZE),
        maxItems: String(maxItems),
      });
      const response = await fetch(`/api/playlist-info?${params.toString()}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: playlistUrl }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Gagal mengambil playlist.");

      if (!append) items = data.items || [];
      else items = [...items, ...(data.items || [])];

      page = Number(data.page || targetPage);
      hasNext = Boolean(data.hasNext);
      playlistTitle.textContent = data.playlistTitle || "Playlist";
      playlistMeta.textContent = maxItems === 0
        ? `${data.totalLoaded || items.length}${hasNext ? "+" : ""} track dimuat` 
        : `${Math.min(Number(data.available || data.totalLoaded || items.length), maxItems)} track maksimum`;
      playlistCard.classList.remove("hidden");
      render();
    } catch (error) {
      setStatus("✗ " + (error.message || "Gagal mengambil playlist."), true);
      playlistCard.classList.add("hidden");
    } finally {
      loading = false;
      updateControls();
    }
  }

  async function reloadPlaylist() {
    if (!playlistUrl) return;
    page = 1;
    items = [];
    selected.clear();
    await loadPage(1, false);
  }

  async function checkPlaylist() {
    const url = urlInput.value.trim();
    if (!url) return;
    playlistUrl = url;
    reset();
    playlistUrl = url;
    injectStyles();
    getControls();
    setStatus("⏳ Memuat playlist...");
    if (urlPreviewCard) urlPreviewCard.classList.add("hidden");
    if (playlistProgress) playlistProgress.classList.add("hidden");
    await loadPage(1, false);
    if (!loading) {
      const status = $("#urlStatus");
      if (status && !status.classList.contains("error")) status.classList.add("hidden");
    }
  }

  if (playlistDownloadBtn) {
    playlistDownloadBtn.onclick = async () => {
      if (!selected.size || !playlistUrl || loading) return;
      if (typeof window._downloadQueue === "undefined" && typeof _downloadQueue === "undefined") return;

      // When maxItems is larger than the loaded pages, automatically load the remaining pages first.
      while (hasNext && (maxItems === 0 || items.length < maxItems)) {
        page += 1;
        await loadPage(page, true);
        if (!hasNext) break;
      }

      const chosen = items.filter(item => selected.has(String(item.id)));
      if (!chosen.length) return;

      playlistDownloadBtn.disabled = true;
      if (playlistSelectAll) playlistSelectAll.disabled = true;
      if (playlistProgress) playlistProgress.classList.remove("hidden");
      const total = chosen.length;

      const startIdx = _downloadQueue.length;
      chosen.forEach(item => {
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

      for (let i = 0; i < chosen.length; i++) {
        const qIdx = startIdx + i;
        if (playlistProgText) playlistProgText.textContent = `Mendownload ${i + 1}/${total}: ${chosen[i].title}`;
        if (playlistProgBar) playlistProgBar.style.width = (i / total * 100) + "%";
        await downloadQueueItem(qIdx);
      }

      if (playlistProgBar) playlistProgBar.style.width = "100%";
      if (playlistProgText) playlistProgText.textContent = `✓ ${chosen.length} track masuk antrian — edit & upload satu per satu!`;
      playlistDownloadBtn.disabled = false;
      if (playlistSelectAll) playlistSelectAll.disabled = false;
    };
  }

  if (playlistSelectAll) {
    playlistSelectAll.onclick = () => {
      const visible = playlistItems.querySelectorAll(".pl-check-paged");
      const all = [...visible].every(c => c.checked);
      visible.forEach(c => {
        c.checked = !all;
        const id = String(c.dataset.id);
        if (c.checked) selected.add(id);
        else selected.delete(id);
      });
      updateDownloadButton();
    };
  }

  // Replace the original Cek Info handler after app.js finishes defining it.
  urlInfoBtn.onclick = checkPlaylist;
})();
