/* RobloxMID canonical download queue UI. */
(function () {
  "use strict";

  if (window.__ROBLOXMID_CANONICAL_QUEUE__) return;
  window.__ROBLOXMID_CANONICAL_QUEUE__ = true;

  const $ = selector => document.querySelector(selector);
  let activeQueueId = null;
  let rendering = false;

  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[ch]);

  function youtubeThumb(item) {
    const given = String(item?.thumbnail || "").trim();
    if (given) return given;
    const id = String(item?.id || "").trim();
    return /^[A-Za-z0-9_-]{11}$/.test(id)
      ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`
      : "";
  }

  function injectStyles() {
    if ($("#robloxMidQueueCanonicalStyles")) return;
    const style = document.createElement("style");
    style.id = "robloxMidQueueCanonicalStyles";
    style.textContent = `
      #queuePanel { order:-1; margin-top:18px; overflow:hidden; }
      #queuePanel .panel-head { margin-bottom:14px; }
      #queuePanel .panel-head > div { min-width:0; }
      #queuePanel .panel-head h2 { line-height:1.25; }
      #queuePanel .panel-head p { line-height:1.35; }
      #robloxMidQueueActive {
        display:none; align-items:center; gap:9px; margin:0 0 12px;
        padding:9px 12px; border:1px solid #8b5cf633; border-radius:10px;
        background:linear-gradient(90deg,#8b5cf60d,#22d3ee08);
        color:#c4b5fd; font-size:11px; line-height:1.35;
      }
      #robloxMidQueueActive.visible { display:flex; }
      #robloxMidQueueActive .queue-active-icon {
        width:22px; height:22px; flex:0 0 22px; display:grid; place-items:center;
        border-radius:7px; background:linear-gradient(135deg,#7c3aed,#0891b2);
        color:#fff; font-size:11px;
      }
      #robloxMidQueueActive strong { color:#fff; font-weight:800; }

      #queuePanel #queueList {
        display:flex; flex-direction:column; gap:8px; max-height:460px;
        overflow:auto; padding:0 2px 2px 0;
      }
      #queuePanel #queueList .queue-item {
        display:grid; grid-template-columns:58px minmax(0,1fr) auto;
        align-items:center; gap:12px; min-height:66px; padding:10px 12px;
        position:relative; border:1px solid var(--line); border-radius:14px;
        background:rgba(255,255,255,.018);
        transition:border-color .15s,background .15s,box-shadow .15s,opacity .15s;
      }
      #queuePanel #queueList .queue-item:hover {
        background:rgba(255,255,255,.03); border-color:rgba(255,255,255,.13);
      }
      #queuePanel #queueList .queue-item.queue-item-ready {
        border-color:#8b5cf628; background:#8b5cf606;
      }
      #queuePanel #queueList .queue-item.queue-item-error {
        border-color:#ef44441c; background:#ef444405;
      }
      #queuePanel #queueList .queue-item.queue-item-done { opacity:.62; }
      #queuePanel #queueList .queue-item.is-editing {
        border-color:#8b5cf688; background:linear-gradient(90deg,#8b5cf612,#22d3ee08);
        box-shadow:0 0 0 1px #8b5cf620,0 10px 30px #00000020;
      }
      #queuePanel #queueList .queue-item.is-editing::before {
        content:""; position:absolute; left:0; top:10px; bottom:10px; width:3px;
        border-radius:0 3px 3px 0; background:linear-gradient(180deg,#8b5cf6,#22d3ee);
      }
      #queuePanel #queueList .queue-thumb {
        width:58px; height:44px; display:block; object-fit:cover;
        border-radius:9px; background:#080b13; border:1px solid #ffffff0d;
      }
      #queuePanel #queueList .queue-meta { min-width:0; }
      #queuePanel #queueList .queue-title {
        display:block; font-size:13px; font-weight:800; line-height:1.38;
        color:var(--text); white-space:normal; overflow-wrap:anywhere; word-break:break-word;
      }
      #queuePanel #queueList .queue-status-text {
        margin-top:4px; font-size:10.5px; line-height:1.35; color:var(--muted);
      }
      #queuePanel #queueList .queue-item-ready .queue-status-text { color:#6ee7b7; }
      #queuePanel #queueList .queue-item-error .queue-status-text { color:#fca5a5; }
      #queuePanel #queueList .queue-item.is-editing .queue-status-text {
        color:#67e8f9; font-weight:800;
      }
      #queuePanel #queueList .queue-actions {
        display:flex; align-items:center; justify-content:flex-end; gap:7px; flex-wrap:wrap;
      }
      #queuePanel #queueList .queue-actions button {
        width:auto !important; min-width:0; margin:0 !important; padding:8px 11px !important;
        border-radius:9px; font-size:10.5px !important; line-height:1; white-space:nowrap;
      }
      #queuePanel #queueList .queue-edit-btn { border-color:#ffffff15; }
      #queuePanel #queueList .queue-edit-state {
        display:inline-flex; align-items:center; gap:5px; width:max-content; margin-top:6px;
        padding:4px 8px; border:1px solid #22d3ee33; border-radius:999px;
        background:#22d3ee0b; color:#67e8f9; font-size:9px; font-weight:850;
        letter-spacing:.05em; text-transform:uppercase;
      }
      #queuePanel #queueList .queue-edit-state::before {
        content:"✓"; width:12px; height:12px; display:grid; place-items:center;
        border-radius:50%; background:#22d3ee18;
      }
      @media(max-width:720px){
        #queuePanel #queueList .queue-item {
          grid-template-columns:50px minmax(0,1fr); gap:10px;
        }
        #queuePanel #queueList .queue-thumb { width:50px; height:40px; }
        #queuePanel #queueList .queue-actions {
          grid-column:2; justify-content:flex-start;
        }
      }
      @media(max-width:480px){
        #queuePanel #queueList .queue-item { grid-template-columns:46px minmax(0,1fr); padding:9px 10px; }
        #queuePanel #queueList .queue-thumb { width:46px; height:38px; }
        #queuePanel #queueList .queue-actions { grid-column:1 / -1; }
        #queuePanel #queueList .queue-actions button { flex:1; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureActiveBanner() {
    const panel = $("#queuePanel");
    if (!panel || $("#robloxMidQueueActive")) return;
    const head = panel.querySelector(".panel-head");
    if (!head) return;
    const banner = document.createElement("div");
    banner.id = "robloxMidQueueActive";
    banner.innerHTML = `<span class="queue-active-icon">✎</span><span>Sedang diedit: <strong id="robloxMidQueueActiveTitle"></strong></span>`;
    head.insertAdjacentElement("afterend", banner);
  }

  function currentQueue() {
    try {
      if (typeof _downloadQueue === "undefined" || !Array.isArray(_downloadQueue)) return [];
      return _downloadQueue;
    } catch {
      return [];
    }
  }

  function markActive() {
    const queue = currentQueue();
    const list = $("#queueList");
    const banner = $("#robloxMidQueueActive");
    const bannerTitle = $("#robloxMidQueueActiveTitle");
    if (!list) return;

    list.querySelectorAll(".queue-item.is-editing").forEach(el => el.classList.remove("is-editing"));
    list.querySelectorAll(".queue-edit-state").forEach(el => el.remove());

    const active = queue.find(item => String(item.id) === String(activeQueueId));
    if (!active) {
      banner?.classList.remove("visible");
      return;
    }

    const index = queue.indexOf(active);
    const row = list.querySelector(`.queue-item[data-qi="${index}"]`);
    if (!row) return;
    row.classList.add("is-editing");
    const meta = row.querySelector(".queue-meta");
    if (meta) {
      const state = document.createElement("div");
      state.className = "queue-edit-state";
      state.textContent = "Loaded for editing";
      meta.appendChild(state);
    }
    if (banner && bannerTitle) {
      bannerTitle.textContent = String(active.title || "Track");
      banner.classList.add("visible");
    }
  }

  function render() {
    const list = $("#queueList");
    const panel = $("#queuePanel");
    const empty = $("#queueEmpty");
    if (!list || !panel) return;

    const queue = currentQueue();
    if (!queue.length) {
      panel.classList.add("hidden");
      if (empty) empty.style.display = "flex";
      list.innerHTML = "";
      return;
    }

    panel.classList.remove("hidden");
    if (empty) empty.style.display = "none";
    rendering = true;

    list.innerHTML = queue.map((item, index) => {
      const status = String(item.status || "waiting");
      const title = String(item.title || "Track");
      const thumb = youtubeThumb(item);
      const isReady = status === "ready";
      const isError = status === "error";
      const statusText = status === "waiting" ? "Mendownload..."
        : status === "ready" ? "Siap diedit"
        : status === "uploading" ? "Mengupload ke Roblox..."
        : status === "done" ? "✓ Selesai diupload"
        : isError ? "Gagal"
        : "Menunggu...";
      return `<article class="queue-item queue-item-${escapeHtml(status)}" data-qi="${index}">
        ${thumb ? `<img class="queue-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : `<div class="queue-thumb" aria-hidden="true"></div>`}
        <div class="queue-meta">
          <div class="queue-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          <div class="queue-status-text">${statusText}</div>
        </div>
        <div class="queue-actions">
          ${isReady ? `<button type="button" class="ghost-btn queue-edit-btn" data-qi="${index}">✎ Edit &amp; Upload</button>
          <button type="button" class="primary-btn queue-upload-btn" data-qi="${index}">⬆ Upload Langsung</button>` : ""}
          ${isError ? `<button type="button" class="ghost-btn queue-retry-btn" data-qi="${index}">↺ Retry</button>` : ""}
        </div>
      </article>`;
    }).join("");

    rendering = false;
    markActive();
  }

  async function edit(index) {
    const queue = currentQueue();
    const item = queue[index];
    if (!item?.file) return;
    activeQueueId = String(item.id);
    if (typeof selectFile === "function") selectFile(item.file);
    const nameInput = $("#assetName");
    if (nameInput) nameInput.value = typeof clampAssetName === "function" ? clampAssetName(item.title) : String(item.title || "Track");
    if (typeof refreshUploadButton === "function") refreshUploadButton();
    render();
    $(".upload-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function uploadDirect(index) {
    const queue = currentQueue();
    const item = queue[index];
    if (!item?.file) return;
    activeQueueId = String(item.id);
    item.status = "uploading";
    render();
    if (typeof selectFile === "function") selectFile(item.file);
    const nameInput = $("#assetName");
    if (nameInput) nameInput.value = typeof clampAssetName === "function" ? clampAssetName(item.title) : String(item.title || "Track");
    if (typeof refreshUploadButton === "function") refreshUploadButton();
    const upload = $("#uploadBtn");
    if (!upload || upload.disabled) {
      item.status = "error";
      item.errorMessage = "Track belum siap untuk upload.";
      render();
      return;
    }
    upload.click();
    setTimeout(() => {
      if (item.status === "uploading") item.status = "done";
      render();
    }, 1000);
  }

  async function retry(index) {
    const queue = currentQueue();
    const item = queue[index];
    if (!item || typeof downloadQueueItem !== "function") return;
    item.status = "waiting";
    item.errorMessage = "";
    render();
    await downloadQueueItem(index);
    render();
  }

  function bind() {
    const list = $("#queueList");
    if (!list || list.dataset.canonicalQueueBound === "true") return;
    list.dataset.canonicalQueueBound = "true";
    list.addEventListener("click", event => {
      const button = event.target.closest?.("button[data-qi]");
      if (!button) return;
      event.preventDefault();
      const index = Number(button.dataset.qi);
      if (button.classList.contains("queue-edit-btn")) edit(index);
      else if (button.classList.contains("queue-upload-btn")) uploadDirect(index);
      else if (button.classList.contains("queue-retry-btn")) retry(index);
    });
  }

  function boot() {
    injectStyles();
    ensureActiveBanner();
    bind();
    const list = $("#queueList");
    if (list && !list.dataset.canonicalQueueObserved) {
      list.dataset.canonicalQueueObserved = "true";
      const observer = new MutationObserver(() => {
        if (!rendering) render();
      });
      observer.observe(list, { childList: true, subtree: true });
    }
    if (currentQueue().length) render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once:true });
  else boot();

  setInterval(() => {
    try { if (!rendering && currentQueue().length) render(); } catch {}
  }, 1500);
})();
