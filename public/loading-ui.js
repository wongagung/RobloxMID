/* RobloxMID loading-state UI: only shows motion while a real operation is active. */
(() => {
  "use strict";

  const styleId = "robloxMidLoadingUiCss";
  const css = `
    @keyframes robloxMidSpin { to { transform: rotate(360deg); } }
    @keyframes robloxMidPulse { 0%,100%{opacity:.45} 50%{opacity:1} }
    .rm-loading-spinner{display:inline-block;width:12px;height:12px;margin-right:7px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:robloxMidSpin .72s linear infinite}
    .rm-loading-spinner.sm{width:10px;height:10px;border-width:1.7px;margin-right:6px}
    .rm-loading-spinner.lg{width:15px;height:15px;border-width:2px}
    .rm-loading-state{position:relative}
    #progressWrap:not(.hidden) #progressText::before,
    #playlistProgress:not(.hidden) .playlist-prog-text::before,
    .queue-item-waiting .queue-status-text::before,
    .queue-item-uploading .queue-status-text::before{content:"";display:inline-block;width:11px;height:11px;margin-right:7px;border:1.8px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:robloxMidSpin .72s linear infinite}
    .queue-item-rejected .queue-status-text::before{content:"";display:inline-block;width:8px;height:8px;margin-right:7px;border-radius:50%;vertical-align:1px;background:currentColor;opacity:.7}
    .rm-loading-button{position:relative !important}
    .rm-loading-button > span{display:inline-flex;align-items:center;justify-content:center}
    .rm-loading-button > span::before{content:"";width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:robloxMidSpin .72s linear infinite;flex:0 0 auto}
    .rm-loading-button > span::before{margin-right:8px}
    #urlInfoBtn.rm-loading-button::before,
    #urlFetchBtn.rm-loading-button::before,
    #cookiesUploadBtn.rm-loading-button::before,
    #ytdlpUpdateBtn.rm-loading-button::before,
    #manageAccountsBtn.rm-loading-button::before,
    #refreshBtn.rm-loading-button::before{content:"";display:inline-block;width:12px;height:12px;margin-right:7px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-2px;animation:robloxMidSpin .72s linear infinite}
    .service.rm-checking .dot{animation:robloxMidPulse 1.1s ease-in-out infinite}
    .rm-loading-overlay{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;border-radius:inherit;background:rgba(8,11,18,.16);backdrop-filter:blur(1px)}
    .rm-loading-overlay .rm-loading-spinner{width:18px;height:18px}
    @media (prefers-reduced-motion:reduce){.rm-loading-spinner,.service.rm-checking .dot,#progressWrap:not(.hidden) #progressText::before,#playlistProgress:not(.hidden) .playlist-prog-text::before,.queue-item-waiting .queue-status-text::before,.queue-item-uploading .queue-status-text::before,.rm-loading-button::before,.rm-loading-button > span::before{animation-duration:1.6s}}
  `;

  function ensureStyles() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function textOf(selector) {
    const el = document.querySelector(selector);
    return el ? String(el.textContent || "").trim() : "";
  }

  function setButtonLoading(selector, active) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.toggle("rm-loading-button", Boolean(active));
    el.setAttribute("aria-busy", active ? "true" : "false");
  }

  function sync() {
    const urlStatus = textOf("#urlStatusText");
    const cookiesStatus = textOf("#cookiesStatusText");
    const progressVisible = Boolean(document.querySelector("#progressWrap:not(.hidden)"));
    const playlistVisible = Boolean(document.querySelector("#playlistProgress:not(.hidden)"));
    const ytdlpBusy = Boolean(document.querySelector("#ytdlpUpdateLog:not(.hidden)")) && Boolean(document.querySelector("#ytdlpUpdateBtn[disabled]"));

    setButtonLoading("#urlInfoBtn", urlStatus.startsWith("⏳"));
    setButtonLoading("#urlFetchBtn", progressVisible);
    setButtonLoading("#cookiesUploadBtn", cookiesStatus.startsWith("⏳"));
    setButtonLoading("#uploadBtn", progressVisible);
    setButtonLoading("#playlistDownloadBtn", playlistVisible);
    setButtonLoading("#ytdlpUpdateBtn", ytdlpBusy);

    document.querySelectorAll(".service").forEach(service => {
      const status = service.querySelector("span");
      const checking = String(status?.textContent || "").trim().toLowerCase().startsWith("checking");
      service.classList.toggle("rm-checking", checking);
      service.setAttribute("aria-busy", checking ? "true" : "false");
    });
  }

  function watch() {
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "disabled"] });
    sync();

    const refresh = document.getElementById("refreshBtn");
    if (refresh) {
      refresh.addEventListener("click", () => {
        setButtonLoading("#refreshBtn", true);
        window.setTimeout(() => setButtonLoading("#refreshBtn", false), 1400);
      });
    }
  }

  ensureStyles();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch, { once: true });
  else watch();
})();
