/* RobloxMID Queue UI — canonical visual state + edit selection indicator. */
(function () {
  if (window.__ROBLOXMID_QUEUE_UI__) return;
  window.__ROBLOXMID_QUEUE_UI__ = true;

  const STYLE_ID = "robloxmid-queue-ui-style";
  const ACTIVE_ID = "robloxmid-active-editing";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function injectStyles() {
    if ($(`#${STYLE_ID}`)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* Queue shell */
      #queuePanel {
        order: -1;
        overflow: hidden;
      }
      #queuePanel .panel-head {
        margin-bottom: 14px;
        align-items: center;
      }
      #queuePanel .panel-head > div {
        min-width: 0;
      }
      #queuePanel .panel-head h2 {
        line-height: 1.25;
      }
      #queuePanel .panel-head p {
        line-height: 1.35;
      }
      #${ACTIVE_ID} {
        display: none;
        align-items: center;
        gap: 9px;
        width: 100%;
        margin: 0 0 12px;
        padding: 9px 12px;
        border: 1px solid #8b5cf633;
        border-radius: 10px;
        background: linear-gradient(90deg, #8b5cf60d, #22d3ee08);
        color: #c4b5fd;
        font-size: 11px;
        line-height: 1.35;
      }
      #${ACTIVE_ID}.visible { display: flex; }
      #${ACTIVE_ID} .queue-active-icon {
        width: 22px;
        height: 22px;
        flex: 0 0 22px;
        display: grid;
        place-items: center;
        border-radius: 7px;
        background: linear-gradient(135deg, #7c3aed, #0891b2);
        color: #fff;
        font-size: 11px;
      }
      #${ACTIVE_ID} strong {
        color: #f5f7ff;
        font-weight: 800;
      }

      /* Canonical item layout */
      #queuePanel .queue-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 460px;
        overflow-y: auto;
        padding-right: 2px;
      }
      #queuePanel .queue-item {
        position: relative;
        display: grid;
        grid-template-columns: 56px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        min-height: 62px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 13px;
        background: rgba(255,255,255,.018);
        transition: border-color .16s, background .16s, box-shadow .16s;
      }
      #queuePanel .queue-item:hover {
        background: rgba(255,255,255,.028);
        border-color: rgba(255,255,255,.13);
      }
      #queuePanel .queue-item.queue-item-error {
        border-color: #ef44441d;
        background: #ef444406;
      }
      #queuePanel .queue-item.queue-item-ready {
        border-color: #8b5cf625;
        background: #8b5cf606;
      }
      #queuePanel .queue-item.is-editing {
        border-color: #8b5cf677;
        background: linear-gradient(90deg, #8b5cf612, #22d3ee08);
        box-shadow: 0 0 0 1px #8b5cf61c, 0 10px 30px #00000022;
      }
      #queuePanel .queue-item.is-editing::before {
        content: "";
        position: absolute;
        left: 0;
        top: 10px;
        bottom: 10px;
        width: 3px;
        border-radius: 0 3px 3px 0;
        background: linear-gradient(180deg, #8b5cf6, #22d3ee);
      }

      #queuePanel .queue-thumb {
        width: 56px;
        height: 42px;
        border-radius: 8px;
        object-fit: cover;
        background: #080b13;
        border: 1px solid #ffffff0d;
      }
      #queuePanel .queue-meta {
        min-width: 0;
        align-self: center;
      }
      #queuePanel .queue-title {
        display: block;
        min-width: 0;
        font-size: 13px;
        font-weight: 750;
        line-height: 1.35;
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #queuePanel .queue-status-text {
        margin-top: 4px;
        font-size: 10.5px;
        line-height: 1.35;
        color: var(--muted);
      }
      #queuePanel .queue-item-ready .queue-status-text { color: #6ee7b7; }
      #queuePanel .queue-item-uploading .queue-status-text { color: #67e8f9; }
      #queuePanel .queue-item-done .queue-status-text { color: #6ee7b7; }
      #queuePanel .queue-item-error .queue-status-text { color: #fca5a5; }
      #queuePanel .queue-item.is-editing .queue-status-text { color: #67e8f9; font-weight: 750; }

      #queuePanel .queue-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        flex-wrap: wrap;
      }
      #queuePanel .queue-actions .ghost-btn,
      #queuePanel .queue-actions .primary-btn {
        width: auto;
        min-width: 0;
        margin: 0;
        padding: 8px 11px;
        border-radius: 9px;
        font-size: 10.5px;
        line-height: 1;
        white-space: nowrap;
      }
      #queuePanel .queue-actions .primary-btn {
        justify-content: center;
        background: linear-gradient(90deg, #7c3aed, #0891b2);
      }
      #queuePanel .queue-edit-btn {
        border-color: #ffffff12;
      }

      .queue-edit-state {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-top: 6px;
        padding: 4px 8px;
        border: 1px solid #22d3ee33;
        border-radius: 999px;
        background: #22d3ee0b;
        color: #67e8f9;
        font-size: 9px;
        font-weight: 850;
        letter-spacing: .05em;
        text-transform: uppercase;
        width: fit-content;
      }
      .queue-edit-state::before {
        content: "✓";
        width: 12px;
        height: 12px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: #22d3ee18;
      }

      @media (max-width: 760px) {
        #queuePanel .queue-item {
          grid-template-columns: 52px minmax(0, 1fr);
          gap: 10px;
        }
        #queuePanel .queue-thumb {
          width: 52px;
          height: 40px;
        }
        #queuePanel .queue-actions {
          grid-column: 2;
          justify-content: flex-start;
        }
      }

      @media (max-width: 480px) {
        #queuePanel .queue-item {
          grid-template-columns: 48px minmax(0, 1fr);
          padding: 9px 10px;
        }
        #queuePanel .queue-thumb {
          width: 48px;
          height: 38px;
        }
        #queuePanel .queue-actions .ghost-btn,
        #queuePanel .queue-actions .primary-btn {
          padding: 7px 9px;
          font-size: 10px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureActiveBanner() {
    const panel = $("#queuePanel");
    if (!panel || $(`#${ACTIVE_ID}`)) return;
    const head = panel.querySelector(".panel-head");
    if (!head) return;
    const banner = document.createElement("div");
    banner.id = ACTIVE_ID;
    banner.innerHTML = `<span class="queue-active-icon">✎</span><span>Siap mengedit: <strong class="queue-active-title"></strong></span>`;
    head.insertAdjacentElement("afterend", banner);
  }

  function clearEditingState() {
    $$("#queuePanel .queue-item.is-editing").forEach(item => {
      item.classList.remove("is-editing");
      $(".queue-edit-state", item)?.remove();
    });
  }

  function setEditingItem(item) {
    if (!item) return;
    clearEditingState();
    item.classList.add("is-editing");

    const meta = $(".queue-meta", item);
    if (meta && !$(".queue-edit-state", item)) {
      const state = document.createElement("div");
      state.className = "queue-edit-state";
      state.textContent = "Loaded for editing";
      meta.appendChild(state);
    }

    const title = $(".queue-title", item)?.textContent?.trim() || "Track";
    const banner = $(`#${ACTIVE_ID}`);
    const bannerTitle = $(".queue-active-title", banner);
    if (banner && bannerTitle) {
      bannerTitle.textContent = title;
      banner.classList.add("visible");
    }
  }

  function normalizeExistingItems() {
    const list = $("#queueList");
    if (!list) return;
    $$(".queue-item", list).forEach(item => {
      const actions = $(".queue-actions", item);
      const title = $(".queue-title", item);
      if (!title || !actions) return;
      item.dataset.queueNormalized = "true";
      const editButton = $(".queue-edit-btn", item);
      if (editButton) editButton.title = "Muat track ini ke editor";
    });
  }

  function bindEvents() {
    const list = $("#queueList");
    if (!list || list.dataset.queueUiBound === "true") return;
    list.dataset.queueUiBound = "true";

    list.addEventListener("click", event => {
      const editButton = event.target.closest?.(".queue-edit-btn");
      if (!editButton || !list.contains(editButton)) return;
      const item = editButton.closest(".queue-item");
      setEditingItem(item);
    });
  }

  function boot() {
    injectStyles();
    ensureActiveBanner();
    bindEvents();
    normalizeExistingItems();

    const list = $("#queueList");
    if (list && !list.dataset.queueUiObserved) {
      list.dataset.queueUiObserved = "true";
      const observer = new MutationObserver(() => {
        normalizeExistingItems();
        bindEvents();
      });
      observer.observe(list, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  const panelObserver = new MutationObserver(boot);
  panelObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
