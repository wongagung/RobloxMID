/* RobloxMID canonical UI foundation: queue, controls, notifications and confirmation modal. */
(() => {
  "use strict";

  const css = `
    #queuePanel.queue-panel{padding:26px !important;margin-top:18px !important}
    #queuePanel .panel-head{display:flex !important;justify-content:space-between !important;align-items:center !important;margin:0 0 20px !important;gap:14px !important}
    #queuePanel .panel-head>div{display:flex !important;align-items:center !important;gap:12px !important;min-width:0 !important}
    #queuePanel .panel-head h2{margin:0 !important;font-size:17px !important;line-height:1.25 !important}
    #queuePanel .panel-head p{margin:2px 0 0 !important;color:var(--muted) !important;font-size:12px !important;line-height:1.35 !important}
    #queuePanel .panel-head .ghost-btn{width:auto !important;min-height:36px !important;margin:0 !important;padding:8px 12px !important;white-space:nowrap !important}
    #queuePanel .queue-list{display:flex !important;flex-direction:column !important;max-height:520px !important;overflow:auto !important;padding:0 !important;margin:0 !important}
    #queuePanel .queue-item{display:grid !important;grid-template-columns:46px minmax(0,1fr) auto !important;align-items:center !important;gap:14px !important;min-height:72px !important;padding:14px 0 !important;margin:0 !important;border:0 !important;border-top:1px solid var(--line) !important;border-radius:0 !important;background:transparent !important;box-shadow:none !important;transition:background .15s,opacity .15s !important}
    #queuePanel .queue-item:hover,#queuePanel .queue-item.queue-item-ready,#queuePanel .queue-item.queue-item-error,#queuePanel .queue-item.queue-item-uploading,#queuePanel .queue-item.is-download-active,#queuePanel .queue-item.is-editing{border-color:var(--line) !important;background:linear-gradient(90deg,#ffffff03,transparent) !important;box-shadow:none !important}
    #queuePanel .queue-item.queue-item-done{opacity:.58 !important}
    #queuePanel .queue-thumb{display:block !important;width:42px !important;height:42px !important;border:0 !important;border-radius:11px !important;object-fit:cover !important;background:linear-gradient(135deg,#7c3aed,#0891b2) !important}
    #queuePanel .queue-meta{min-width:0 !important;align-self:center !important}
    #queuePanel .queue-title{display:block !important;color:var(--text) !important;font-size:13px !important;font-weight:800 !important;line-height:1.35 !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important}
    #queuePanel .queue-status-text{display:block !important;margin-top:3px !important;color:var(--muted) !important;font-size:11px !important;line-height:1.35 !important}
    #queuePanel .queue-item-ready .queue-status-text{color:var(--good) !important}
    #queuePanel .queue-item-error .queue-status-text{color:var(--danger) !important}
    #queuePanel .queue-item-uploading .queue-status-text{color:#fbbf24 !important}
    #queuePanel .queue-actions{display:flex !important;align-items:center !important;justify-content:flex-end !important;gap:6px !important;min-width:max-content !important;flex-wrap:wrap !important}
    #queuePanel .queue-actions button{width:auto !important;min-width:0 !important;min-height:36px !important;margin:0 !important;padding:8px 11px !important;border-radius:10px !important;font-size:10.5px !important;line-height:1.2 !important;white-space:nowrap !important}
    #queuePanel .queue-error-detail{margin-top:6px !important;padding:6px 8px !important;border:1px solid #fb71851f !important;border-radius:8px !important;background:#fb718508 !important;color:#fda4af !important;font-size:10px !important;line-height:1.4 !important;white-space:normal !important;overflow-wrap:anywhere !important}
    #queuePanel .queue-download-progress{height:4px !important;margin-top:7px !important;border-radius:999px !important;overflow:hidden !important;background:#ffffff0a !important}
    #queuePanel .queue-download-progress>i{display:block !important;height:100% !important;background:linear-gradient(90deg,#8b5cf6,#22d3ee) !important;transition:width .15s ease !important}
    #playlistPagination select,.playlist-limit-select,#queuePanel select,select.ui-select{appearance:none !important;-webkit-appearance:none !important;min-height:36px !important;min-width:118px !important;padding:8px 38px 8px 12px !important;border:1px solid var(--line) !important;border-radius:10px !important;background-color:#080b13 !important;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2398A2B3' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important;background-repeat:no-repeat !important;background-position:right 12px center !important;background-size:14px 14px !important;color:var(--text) !important;font:inherit !important;font-size:11px !important;font-weight:750 !important;line-height:1.2 !important;outline:none !important;cursor:pointer !important;color-scheme:dark !important;box-shadow:inset 0 1px 0 #ffffff08 !important}
    #playlistPagination select:focus,#queuePanel select:focus,select.ui-select:focus{border-color:#8b5cf666 !important;box-shadow:0 0 0 3px #8b5cf612 !important}
    #playlistPagination select:hover,#queuePanel select:hover,select.ui-select:hover{border-color:#ffffff18 !important}
    #playlistPagination select option,#queuePanel select option,select.ui-select option{background:#0f121d;color:#f5f7ff}
    body.light #playlistPagination select,body.light #queuePanel select,body.light select.ui-select{background-color:#fff !important;color:#111827 !important;color-scheme:light !important}
    body.light #playlistPagination select option,body.light #queuePanel select option,body.light select.ui-select option{background:#fff;color:#111827}
    #playlistPagination{align-items:center !important}
    #playlistPagination .pager-actions{display:flex !important;align-items:center !important;gap:7px !important;flex-wrap:wrap !important}
    .toast{position:fixed !important;right:22px !important;bottom:22px !important;z-index:100 !important;min-width:280px !important;max-width:min(420px,calc(100vw - 44px)) !important;padding:12px 14px !important;border:1px solid var(--line) !important;border-radius:13px !important;background:rgba(17,21,33,.96) !important;box-shadow:0 18px 55px rgba(0,0,0,.4) !important;color:var(--text) !important;font-size:12px !important;line-height:1.4 !important;backdrop-filter:blur(16px) !important;transform:translateY(14px) scale(.98) !important;opacity:0 !important;pointer-events:none !important;transition:opacity .2s ease,transform .2s ease !important}
    .toast.show{opacity:1 !important;transform:none !important}
    .toast.success{border-color:#36e0a144 !important}
    .toast.error{border-color:#fb718544 !important}
    .toast.info{border-color:#22d3ee33 !important}
    body.light .toast{background:rgba(255,255,255,.97) !important;color:#111827 !important}
    #mlConfirm[hidden],#mlNotifyStack[hidden]{display:none !important}
    #mlConfirm{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:20px}
    #mlConfirm .ml-backdrop{position:absolute;inset:0;background:rgba(3,6,12,.68);backdrop-filter:blur(7px)}
    #mlConfirm .ml-dialog{position:relative;width:min(430px,100%);padding:22px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,#141a2a,#0d111c);box-shadow:0 28px 90px rgba(0,0,0,.52)}
    #mlConfirm .ml-icon{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;background:#fb71851a;color:#fda4af;font-size:18px;margin-bottom:14px}
    #mlConfirm h3{margin:0;color:var(--text);font-size:16px;line-height:1.3}
    #mlConfirm p{margin:7px 0 0;color:var(--muted);font-size:12px;line-height:1.5}
    #mlConfirm .ml-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
    #mlConfirm .ml-actions button{width:auto;min-width:88px;min-height:36px;margin:0;padding:8px 12px;border-radius:10px;border:1px solid var(--line);font:inherit;font-size:11px;font-weight:750;cursor:pointer}
    #mlConfirm .ml-cancel{background:#ffffff05;color:var(--text)}
    #mlConfirm .ml-ok{border-color:#fb718544;background:#fb71851a;color:#fda4af}
    body.light #mlConfirm .ml-dialog{background:#fff}
    @media(max-width:700px){#queuePanel.queue-panel{padding:18px !important}#queuePanel .panel-head{align-items:flex-start !important}#queuePanel .queue-item{grid-template-columns:42px minmax(0,1fr) !important;gap:12px !important;padding:13px 0 !important}#queuePanel .queue-thumb{width:42px !important;height:42px !important}#queuePanel .queue-actions{grid-column:2 !important;justify-content:flex-start !important;min-width:0 !important}#queuePanel .queue-title{white-space:normal !important;overflow-wrap:anywhere !important}}
    @media(max-width:480px){#queuePanel.queue-panel{padding:16px !important}#queuePanel .queue-item{grid-template-columns:40px minmax(0,1fr) !important;gap:10px !important}#queuePanel .queue-thumb{width:40px !important;height:40px !important}#queuePanel .queue-actions{grid-column:1 / -1 !important}#queuePanel .panel-head{gap:10px !important}#queuePanel .panel-head h2{font-size:15px !important}}
    @media(max-width:560px){.toast{right:12px !important;bottom:12px !important;min-width:0 !important;max-width:calc(100vw - 24px) !important}.ml-dialog{padding:18px !important}.ml-actions{flex-direction:column-reverse !important}.ml-actions button{width:100% !important}}
  `;

  function ensureStyles(){
    if(document.getElementById("robloxMidQueueCanonicalCss")) return;
    const style=document.createElement("style");
    style.id="robloxMidQueueCanonicalCss";
    style.textContent=css;
    document.head.appendChild(style);
  }

  function ensureConfirm(){
    let root=document.getElementById("mlConfirm");
    if(root) return root;
    root=document.createElement("div");
    root.id="mlConfirm";
    root.hidden=true;
    root.innerHTML='<div class="ml-backdrop" data-confirm-cancel></div><div class="ml-dialog" role="dialog" aria-modal="true" aria-labelledby="mlConfirmTitle"><div class="ml-icon">!</div><h3 id="mlConfirmTitle">Konfirmasi</h3><p id="mlConfirmMessage"></p><div class="ml-actions"><button type="button" class="ml-cancel">Batal</button><button type="button" class="ml-ok">Konfirmasi</button></div></div>';
    document.body.appendChild(root);
    return root;
  }

  function confirmInApp({title="Konfirmasi",message="Lanjutkan tindakan ini?",confirmText="Konfirmasi",danger=true}={}){
    const root=ensureConfirm();
    root.querySelector("#mlConfirmTitle").textContent=title;
    root.querySelector("#mlConfirmMessage").textContent=message;
    const ok=root.querySelector(".ml-ok");
    const cancel=root.querySelector(".ml-cancel");
    ok.textContent=confirmText;
    ok.classList.toggle("danger",danger);
    root.hidden=false;
    document.body.classList.add("ml-modal-open");
    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;root.hidden=true;document.body.classList.remove("ml-modal-open");document.removeEventListener("keydown",onKey,true);ok.onclick=null;cancel.onclick=null;root.querySelector(".ml-backdrop").onclick=null;resolve(value)};
      const onKey=e=>{if(e.key==="Escape"){e.preventDefault();finish(false)}else if(e.key==="Enter"){e.preventDefault();finish(true)}};
      ok.onclick=()=>finish(true);
      cancel.onclick=()=>finish(false);
      root.querySelector(".ml-backdrop").onclick=()=>finish(false);
      document.addEventListener("keydown",onKey,true);
      setTimeout(()=>ok.focus(),0);
    });
  }

  function notify(message,type="info",title=""){
    const toast=document.getElementById("toast");
    if(!toast) return;
    toast.className=`toast show ${type}`;
    toast.textContent=title ? `${title}: ${message}` : String(message||"");
    clearTimeout(notify._timer);
    notify._timer=setTimeout(()=>{toast.className="toast"},3800);
  }

  function installAccountDeleteInterceptor(){
    if(document.documentElement.dataset.musiclabConfirmInstalled==="1") return;
    document.documentElement.dataset.musiclabConfirmInstalled="1";
    document.addEventListener("click",async event=>{
      const button=event.target.closest?.(".account-delete-btn");
      if(!button) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const row=button.closest(".account-item");
      const label=row?.querySelector(".account-label")?.textContent?.replace("✓","").trim() || "akun Roblox";
      const confirmed=await confirmInApp({title:"Hapus akun Roblox?",message:`Akun ${label} akan dihapus dari daftar akun. Tindakan ini tidak dapat dibatalkan.`,confirmText:"Hapus",danger:true});
      if(!confirmed) return;
      const id=button.dataset.id;
      try{
        const response=await fetch(`/api/roblox-accounts/${encodeURIComponent(id)}`,{method:"DELETE"});
        const data=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(data.error||"Gagal menghapus akun.");
        notify("Akun berhasil dihapus.","success");
        if(typeof loadAccounts==="function") await loadAccounts();
      }catch(error){
        notify(error?.message||"Gagal menghapus akun.","error");
      }
    },true);
  }

  function install(){
    ensureStyles();
    ensureConfirm();
    installAccountDeleteInterceptor();
    window.MusicLabNotify=notify;
    window.MusicLabConfirm=confirmInApp;
  }

  install();
})();
