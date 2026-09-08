/* RobloxMID playlist UI polish. Loaded after app.js + playlist-pagination.js. */
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

  let playlistUrl = "";
  let page = 1;
  let pageSize = 50;
  let maxItems = 100;
  let hasNext = false;
  let loading = false;
  let playlistInfo = { title: null, loaded: 0 };
  const selectedIds = new Set();
  const selectedItems = new Map();

  const esc = v => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const status = (msg, error=false) => { if (!urlStatus || !urlStatusText) return; urlStatus.classList.remove("hidden"); urlStatusText.textContent = msg; urlStatus.className = `url-status ${error ? "error" : "info"}`; };

  function injectStyles() {
    if ($("#playlistUiFixStyles")) return;
    const style = document.createElement("style");
    style.id = "playlistUiFixStyles";
    style.textContent = `
      #playlistCard{margin-top:14px;padding:16px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.025)}
      #playlistCard .playlist-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding-bottom:14px;border-bottom:1px solid var(--line)}
      #playlistCard .playlist-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
      #playlistCard .playlist-items{display:flex;flex-direction:column;gap:7px;margin-top:12px;max-height:520px;overflow:auto;padding-right:2px}
      #playlistCard .playlist-item{display:grid;grid-template-columns:20px 46px minmax(0,1fr);gap:10px;align-items:center;padding:9px;border:1px solid transparent;border-radius:12px;background:#ffffff03;transition:.15s}
      #playlistCard .playlist-item:hover{border-color:var(--line);background:#ffffff06}
      #playlistCard .playlist-item input{accent-color:#8b5cf6}
      #playlistCard .pl-thumb{width:46px;height:46px;border-radius:9px;object-fit:cover;background:#0b1020}
      #playlistCard .pl-meta{min-width:0}
      #playlistCard .pl-title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #playlistCard .pl-sub{font-size:10px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .playlist-selected-count{font-size:10px;color:#a78bfa;font-weight:700}
      .playlist-pagination-fixed{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
      .playlist-page-actions-fixed{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .playlist-page-btn-fixed,.playlist-limit-fixed{border:1px solid var(--line);background:#ffffff05;color:var(--text);border-radius:9px;padding:7px 10px;font-size:11px;font-weight:700}
      .playlist-page-btn-fixed{cursor:pointer}.playlist-page-btn-fixed:disabled{opacity:.4;cursor:not-allowed}
      .playlist-limit-fixed{outline:none}.playlist-pagination-note{font-size:10px;color:var(--muted)}
      .playlist-select-all-btn.is-active{border-color:#8b5cf655;background:#8b5cf610;color:#c4b5fd}
      #selected{position:relative;border-color:#36e0a133;background:linear-gradient(90deg,#36e0a108,#22d3ee05)}
      #selected::after{content:'✓ LOADED / SELECTED';margin-left:auto;padding:5px 9px;border:1px solid #36e0a144;border-radius:999px;color:var(--good);background:#36e0a10b;font-size:9px;font-weight:900;letter-spacing:.08em;white-space:nowrap}
      #selected .mini-btn{margin-left:4px}
      #editorStatus.loaded{color:var(--good);border-color:#36e0a144;background:#36e0a10b}
      @media(max-width:700px){#selected::after{content:'✓ SELECTED';}.playlist-pagination-fixed{align-items:flex-start;flex-direction:column}.playlist-page-actions-fixed{width:100%}.playlist-page-btn-fixed{flex:1}}
    `;
    document.head.appendChild(style);
  }

  function controls() {
    let el = $("#playlistPaginationFixed");
    if (el) return el;
    el = document.createElement("div"); el.id="playlistPaginationFixed"; el.className="playlist-pagination-fixed";
    el.innerHTML=`<div><div class="playlist-pagination-note" id="playlistPageNote"></div><div class="playlist-selected-count" id="playlistSelectedCount">0 dipilih</div></div><div class="playlist-page-actions-fixed"><button id="playlistPrevFixed" class="playlist-page-btn-fixed">← Prev</button><button id="playlistNextFixed" class="playlist-page-btn-fixed">Next →</button><select id="playlistLimitFixed" class="playlist-limit-fixed"><option value="100">100 track</option><option value="500">500 track</option><option value="0">Semua</option></select></div>`;
    playlistCard.appendChild(el);
    $("#playlistPrevFixed").onclick=()=>load(page-1,false);
    $("#playlistNextFixed").onclick=()=>load(page+1,false);
    $("#playlistLimitFixed").onchange=async e=>{maxItems=Number(e.target.value);selectedIds.clear();selectedItems.clear();await load(1,false)};
    return el;
  }

  function render(items) {
    playlistItems.innerHTML=items.map((item,i)=>`<label class="playlist-item"><input class="pl-check-fixed" type="checkbox" data-id="${esc(item.id)}" ${selectedIds.has(String(item.id))?'checked':''}><img class="pl-thumb" src="${esc(item.thumbnail||'')}" alt="" onerror="this.style.display='none'"><div class="pl-meta"><div class="pl-title">${esc(item.title)}</div><div class="pl-sub">${esc(item.uploader||'')}${item.duration_string?` · ⏱ ${esc(item.duration_string)}`:''}</div></div></label>`).join("");
    playlistItems.querySelectorAll('.pl-check-fixed').forEach(c=>c.onchange=()=>{const id=String(c.dataset.id);if(c.checked){selectedIds.add(id); const item=items.find(x=>String(x.id)===id); if(item)selectedItems.set(id,item)}else{selectedIds.delete(id);selectedItems.delete(id)};updateSelection()});
    updateSelection();
  }

  function updateSelection(){
    if(playlistDownloadBtn){playlistDownloadBtn.disabled=!selectedIds.size;playlistDownloadBtn.textContent=selectedIds.size?`⬇ Download ${selectedIds.size} Track`:'⬇ Download Terpilih'}
    const n=$("#playlistSelectedCount"); if(n)n.textContent=`${selectedIds.size} dipilih`;
    const info=$("#playlistPageNote"),prev=$("#playlistPrevFixed"),next=$("#playlistNextFixed"),sel=$("#playlistLimitFixed");
    if(info)info.textContent=`Halaman ${page} · ${playlistInfo.loaded} track dimuat${hasNext?' · masih ada lagi':''}`;
    if(prev)prev.disabled=loading||page<=1;if(next)next.disabled=loading||!hasNext;if(sel)sel.value=String(maxItems);
    if(playlistSelectAll)playlistSelectAll.classList.toggle('is-active',playlistItems.querySelectorAll('.pl-check-fixed').length>0&&[...playlistItems.querySelectorAll('.pl-check-fixed')].every(x=>x.checked));
  }

  async function load(targetPage,append){
    if(loading||!playlistUrl||targetPage<1)return; loading=true; updateSelection();
    try{
      const qs=new URLSearchParams({page:String(targetPage),pageSize:String(pageSize),maxItems:String(maxItems)});
      const r=await fetch(`/api/playlist-info?${qs}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:playlistUrl})});
      const d=await r.json().catch(()=>({})); if(!r.ok)throw new Error(d.error||'Gagal mengambil playlist.');
      page=Number(d.page||targetPage);hasNext=Boolean(d.hasNext);playlistInfo.loaded=(page-1)*pageSize+(d.items||[]).length;playlistInfo.title=d.playlistTitle||playlistInfo.title;
      playlistTitle.textContent=playlistInfo.title||'Playlist';playlistMeta.textContent=`${playlistInfo.loaded}${hasNext?'+':''} track`;
      render(d.items||[]);playlistCard.classList.remove('hidden');
    }catch(e){status('✗ '+(e.message||'Gagal mengambil playlist.'),true)}finally{loading=false;updateSelection()}
  }

  async function check(){const url=urlInput.value.trim();if(!url)return;playlistUrl=url;page=1;hasNext=false;selectedIds.clear();selectedItems.clear();injectStyles();controls();status('⏳ Memuat playlist...');if(urlPreviewCard)urlPreviewCard.classList.add('hidden');await load(1,false);if(!loading&&!urlStatus?.classList.contains('error'))urlStatus.classList.add('hidden')}

  if(playlistSelectAll)playlistSelectAll.onclick=()=>{const visible=[...playlistItems.querySelectorAll('.pl-check-fixed')];const all=visible.length&&visible.every(x=>x.checked);visible.forEach(c=>{c.checked=!all;const id=String(c.dataset.id);const item=[...selectedItems.values()].find(x=>String(x.id)===id);if(c.checked){selectedIds.add(id);if(item)selectedItems.set(id,item)}else{selectedIds.delete(id);selectedItems.delete(id)}});updateSelection()};

  if(playlistDownloadBtn)playlistDownloadBtn.onclick=async()=>{
    if(!selectedItems.size||loading)return;
    playlistDownloadBtn.disabled=true;if(playlistSelectAll)playlistSelectAll.disabled=true;if(playlistProgress)playlistProgress.classList.remove('hidden');
    const chosen=[...selectedItems.values()];const start=typeof _downloadQueue!=='undefined'?_downloadQueue.length:0;
    chosen.forEach(item=>{_downloadQueue.push({id:item.id,title:item.title,thumbnail:item.thumbnail,url:item.webpage_url,file:null,status:'waiting'})});
    if(typeof renderQueue==='function')renderQueue();
    for(let i=0;i<chosen.length;i++){const qi=start+i;if(playlistProgText)playlistProgText.textContent=`Mendownload ${i+1}/${chosen.length}: ${chosen[i].title}`;if(playlistProgBar)playlistProgBar.style.width=((i/chosen.length)*100)+'%';if(typeof downloadQueueItem==='function')await downloadQueueItem(qi)}
    if(playlistProgBar)playlistProgBar.style.width='100%';if(playlistProgText)playlistProgText.textContent=`✓ ${chosen.length} track masuk antrian`;
    playlistDownloadBtn.disabled=false;if(playlistSelectAll)playlistSelectAll.disabled=false;
  };

  // Improve the active file indicator whenever app.js loads a file into the editor.
  const observer=new MutationObserver(()=>{
    const sel=$("#selected"), statusEl=$("#editorStatus");
    if(sel&&!sel.classList.contains('hidden')&&statusEl){statusEl.textContent='✓ Loaded / Selected';statusEl.classList.add('loaded')}
  });
  const selectedEl=$("#selected"); if(selectedEl)observer.observe(selectedEl,{attributes:true,attributeFilter:['class']});

  urlInfoBtn.onclick=check;
})();
