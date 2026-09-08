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
  }
})();
