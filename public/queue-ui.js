/* RobloxMID canonical queue UI. No observers, no polling, no render loops. */
(() => {
  "use strict";

  const css = `
    #queuePanel.queue-panel{
      padding:26px !important;
      margin-top:18px !important;
    }
    #queuePanel .panel-head{
      display:flex !important;
      justify-content:space-between !important;
      align-items:center !important;
      margin:0 0 20px !important;
      gap:14px !important;
    }
    #queuePanel .panel-head>div{
      display:flex !important;
      align-items:center !important;
      gap:12px !important;
      min-width:0 !important;
    }
    #queuePanel .panel-head h2{
      margin:0 !important;
      font-size:17px !important;
      line-height:1.25 !important;
    }
    #queuePanel .panel-head p{
      margin:2px 0 0 !important;
      color:var(--muted) !important;
      font-size:12px !important;
      line-height:1.35 !important;
    }
    #queuePanel .panel-head .ghost-btn{
      width:auto !important;
      min-height:36px !important;
      margin:0 !important;
      padding:8px 12px !important;
      white-space:nowrap !important;
    }
    #queuePanel .queue-list{
      display:flex !important;
      flex-direction:column !important;
      max-height:520px !important;
      overflow:auto !important;
      padding:0 !important;
      margin:0 !important;
    }
    #queuePanel .queue-item{
      display:grid !important;
      grid-template-columns:46px minmax(0,1fr) auto !important;
      align-items:center !important;
      gap:14px !important;
      min-height:72px !important;
      padding:14px 0 !important;
      margin:0 !important;
      border:0 !important;
      border-top:1px solid var(--line) !important;
      border-radius:0 !important;
      background:transparent !important;
      box-shadow:none !important;
    }
    #queuePanel .queue-item:hover,
    #queuePanel .queue-item.queue-item-ready,
    #queuePanel .queue-item.queue-item-error,
    #queuePanel .queue-item.queue-item-uploading,
    #queuePanel .queue-item.is-download-active,
    #queuePanel .queue-item.is-editing{
      border-color:var(--line) !important;
      background:linear-gradient(90deg,#ffffff03,transparent) !important;
      box-shadow:none !important;
    }
    #queuePanel .queue-thumb{
      display:block !important;
      width:42px !important;
      height:42px !important;
      border:0 !important;
      border-radius:11px !important;
      object-fit:cover !important;
      background:linear-gradient(135deg,#7c3aed,#0891b2) !important;
    }
    #queuePanel .queue-meta{
      min-width:0 !important;
      align-self:center !important;
    }
    #queuePanel .queue-title{
      display:block !important;
      color:var(--text) !important;
      font-size:13px !important;
      font-weight:800 !important;
      line-height:1.35 !important;
      white-space:nowrap !important;
      overflow:hidden !important;
      text-overflow:ellipsis !important;
    }
    #queuePanel .queue-status-text{
      display:block !important;
      margin-top:3px !important;
      color:var(--muted) !important;
      font-size:11px !important;
      line-height:1.35 !important;
    }
    #queuePanel .queue-item-ready .queue-status-text{color:var(--good) !important}
    #queuePanel .queue-item-error .queue-status-text{color:var(--danger) !important}
    #queuePanel .queue-item-uploading .queue-status-text{color:#fbbf24 !important}
    #queuePanel .queue-actions{
      display:flex !important;
      align-items:center !important;
      justify-content:flex-end !important;
      gap:6px !important;
      min-width:max-content !important;
      flex-wrap:wrap !important;
    }
    #queuePanel .queue-actions button{
      width:auto !important;
      min-width:0 !important;
      min-height:36px !important;
      margin:0 !important;
      padding:8px 11px !important;
      border-radius:10px !important;
      font-size:10.5px !important;
      line-height:1.2 !important;
      white-space:nowrap !important;
    }
    #queuePanel .queue-error-detail{
      margin-top:6px !important;
      padding:6px 8px !important;
      border:1px solid #fb71851f !important;
      border-radius:8px !important;
      background:#fb718508 !important;
      color:#fda4af !important;
      font-size:10px !important;
      line-height:1.4 !important;
      white-space:normal !important;
      overflow-wrap:anywhere !important;
    }
    #queuePanel .queue-download-progress{
      height:4px !important;
      margin-top:7px !important;
      border-radius:999px !important;
      overflow:hidden !important;
      background:#ffffff0a !important;
    }
    #queuePanel .queue-download-progress>i{
      display:block !important;
      height:100% !important;
      background:linear-gradient(90deg,#8b5cf6,#22d3ee) !important;
      transition:width .15s ease !important;
    }
    #queuePanel #queueEmpty{min-height:180px !important}

    @media(max-width:700px){
      #queuePanel.queue-panel{padding:18px !important}
      #queuePanel .panel-head{align-items:flex-start !important}
      #queuePanel .queue-item{
        grid-template-columns:42px minmax(0,1fr) !important;
        gap:12px !important;
        padding:13px 0 !important;
      }
      #queuePanel .queue-thumb{width:42px !important;height:42px !important}
      #queuePanel .queue-actions{
        grid-column:2 !important;
        justify-content:flex-start !important;
        min-width:0 !important;
      }
      #queuePanel .queue-title{white-space:normal !important;overflow-wrap:anywhere !important}
    }
    @media(max-width:480px){
      #queuePanel.queue-panel{padding:16px !important}
      #queuePanel .queue-item{grid-template-columns:40px minmax(0,1fr) !important;gap:10px !important}
      #queuePanel .queue-thumb{width:40px !important;height:40px !important}
      #queuePanel .queue-actions{grid-column:1 / -1 !important}
      #queuePanel .panel-head{gap:10px !important}
      #queuePanel .panel-head h2{font-size:15px !important}
    }
  `;

  const apply = () => {
    if (document.getElementById("robloxMidQueueCanonicalCss")) return;
    const style = document.createElement("style");
    style.id = "robloxMidQueueCanonicalCss";
    style.textContent = css;
    document.head.appendChild(style);
  };

  apply();
})();
