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
  let currentItems = [];
  const selectedIds = new Set();
  const selectedItems = new Map();

  const esc = v => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;");
  const setStatus = (msg, error = false) => {
    if (!urlStatus || !urlStatusText) return;
    urlStatus.classList.remove("hidden"); urlStatusText.textContent = msg; urlStatus.className = `url-status ${error ? "error" : "info"}`;
  };

  function injectStyles() {
    if ($("#playlistUiFixStyles")) return;
    const style = document.createElement("style"); style.id = "playlistUiFixStyles";
    style.textContent = `
      #playlistCard{margin-top:14px;padding:16px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.025)}
      #playlistCard .playlist-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding-bottom:14px;border-bottom:1px solid var(--line)}
      #playlistCard .playlist-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
      #playlistCard .playlist-items{display:flex;flex-direction:column;gap:7px;margin-top:12px;max-height:520px;overflow:auto;padding-right:2px}
      #playlistCard .playlist-item{display:grid;grid-template-columns:20px 46px minmax(0,1fr);gap:10px;align-items:center;padding:9px;border:1px solid transparent;border-radius:12px;background:#ffffff03;transition:.15s}
      #playlistCard .playlist-item:hover{border-color:var(--line);background:#ffffff06}
      #playlistCard .playlist-item.is-selected{border-color:#36e0a133;background:#36e0a108}
      #playlistCard .playlist-item input{accent-color:#8b5cf6}
      #playlistCard .pl-thumb{width:46px;height:46px;border-radius:9px;object-fit:cover;background:#0b1020}
      #playlistCard .pl-meta{min-width:0}
      #playlistCard .pl-title{font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #playlistCard .pl-sub{font-size:10px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .playlist-selected-count{font-size:10px;color:#a78bfa;font-weight:700;margin-top:2px}
      .playlist-pagination-fixed{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
      .playlist-page-actions-fixed{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
      .playlist-page-btn-fixed,.playlist-limit-fixed{border:1px solid var(--line);background:#ffffff05;color:var(--text);border-radius:9px;padding:7px 10px;font-size:11px;font-weight:700}
      .playlist-page-btn-fixed{cursor:pointer}.playlist-page-btn-fixed:hover{border-color:#8b5cf655;background:#8b5cf60c}.playlist-page-btn-fixed:disabled{opacity:.4;cursor:not-allowed}
      .playlist-limit-fixed{outline:none}.playlist-pagination-note{font-size:10px;color:var(--muted)}
      .playlist-select-all-btn.is-active{border-color:#8b5cf655;background:#8b5cf610;color:#c4b5fd}
      #selected{position:relative;border-color:#36e0a133;background:linear-gradient(90deg,#36e0a108,#22d3ee05)}
      #selected::after{content:'✓ LOADED / SELECTED';margin-left:auto;padding:5px 9px;border:1px solid #36e0a144;border-radius:999px;color:var(--good);background:#36e0a10b;font-size:9px;font-weight:900;letter-spacing:.08em;white-space:nowrap}
      #editorStatus.loaded{color:var(--good);border-color:#36e0a144;background:#36e0a10b}
      @media(max-width:700px){#selected::after{content:'✓ SELECTED'}.playlist-pagination-fixed{align-items:flex-start;flex-direction:column}.playlist-page-actions-fixed{width:100%}.playlist-page-btn-fixed{flex:1}}
    `; document.head.appendChild(style);
  }

  function ensureControls() {
    let el = $("#playlistPaginationFixed"); if (el) return el;
    el = document.createElement("div"); el.id="playlistPaginationFixed"; el.className="playlist-pagination-fixed";
    el.innerHTML=`<div><div class="playlist-pagination-note" id="playlistPageNote"></div><div class="playlist-selected-count" id="playlistSelectedCount">0 dipilih</div></div><div class="playlist-page-actions-fixed"><button id="playlistPrevFixed" class="playlist-page-btn-fixed">← Prev</button><button id="playlistNextFixed" class="playlist-page-btn-fixed">Next →</button><select id="playlistLimitFixed" class="playlist-limit-fixed"><option value="100">100 track</option><option value="500">500 track</option><option value="0">Semua</option></select></div>`;
    playlistCard.appendChild(el);
    $("#playlistPrevFixed").onclick=()=>loadPage(page-1);
    $("#playlistNextFixed").onclick=()=>loadPage(page+1);
    $("#playlistLimitFixed").onchange=async e=>{maxItems=Number(e.target.value);selectedIds.clear();selectedItems.clear();await loadPage(1)};
    return el;
  }

  function render() {
    playlistItems.innerHTML=currentItems.map(item=>{const id=String(item.id);return `<label class="playlist-item ${selectedIds.has(id)?'is-selected':''}"><input class="pl-check-fixed" type="checkbox" data-id="${esc(id)}" ${selectedIds.has(id)?'checked':''}><img class="pl-thumb" src="${esc(item.thumbnail||'')}" alt="" onerror="this.style.display='none'"><div class="pl-meta"><div class="pl-title">${esc(item.title)}</div><div class="pl-sub">${esc(item.uploader||'')}${item.duration_string?` · ⏱ ${esc(item.duration_string)}`:''}</div></div></label>`}).join('');
    playlistItems.querySelectorAll('.pl-check-fixed').forEach(c=>c.addEventListener('change',()=>{const id=String(c.dataset.id),item=currentItems.find(x=>String(x.id)===id);if(c.checked){selectedIds.add(id);if(item)selectedItems.set(id,item)}else{selectedIds.delete(id);selectedItems.delete(id)}c.closest('.playlist-item')?.classList.toggle('is-selected',c.checked);updateControls()}));
    updateControls();
  }

  function updateControls(){
    if(playlistDownloadBtn){playlistDownloadBtn.disabled=selectedIds.size===0||loading;playlistDownloadBtn.textContent=selectedIds.size?`⬇ Download ${selectedIds.size} Track`:'⬇ Download Terpilih'}
    const count=$("#playlistSelectedCount");if(count)count.textContent=`${selectedIds.size} dipilih`;
    const info=$("#playlistPageNote"),prev=$("#playlistPrevFixed"),next=$("#playlistNextFixed"),lim=$("#playlistLimitFixed");
    if(info){const loaded=(page-1)*pageSize+currentItems.length;info.textContent=`Halaman ${page} · ${currentItems.length} tampil · ${loaded}${hasNext?'+':''} dimuat${maxItems?` · batas ${maxItems}`:' · tanpa batas'}`}
    if(prev)prev.disabled=loading||page<=1;if(next)next.disabled=loading||!hasNext;if(lim)lim.value=String(maxItems);
    if(playlistSelectAll){const all=currentItems.length>0&&currentItems.every(x=>selectedIds.has(String(x.id)));playlistSelectAll.classList.toggle('is-active',all);playlistSelectAll.textContent=all?'Batal Pilih':'Pilih Semua'}
  }

  async function loadPage(targetPage){
    if(loading||targetPage<1||!playlistUrl)return;loading=true;updateControls();
    try{const qs=new URLSearchParams({page:String(targetPage),pageSize:String(pageSize),maxItems:String(maxItems)});const r=await fetch(`/api/playlist-info?${qs}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:playlistUrl})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Gagal mengambil playlist.');page=Number(d.page||targetPage);hasNext=Boolean(d.hasNext);currentItems=d.items||[];playlistTitle.textContent=d.playlistTitle||'Playlist';playlistMeta.textContent=`${currentItems.length?((page-1)*pageSize+currentItems.length):0}${hasNext?'+':''} track dimuat${maxItems?` · batas ${maxItems}`:' · tanpa batas'}`;playlistCard.classList.remove('hidden');render()}catch(e){setStatus('✗ '+(e.message||'Gagal mengambil playlist.'),true);playlistCard.classList.add('hidden')}finally{loading=false;updateControls()}
  }

  async function checkPlaylist(){const url=urlInput.value.trim();if(!url)return;playlistUrl=url;page=1;hasNext=false;currentItems=[];selectedIds.clear();selectedItems.clear();injectStyles();ensureControls();setStatus('⏳ Memuat playlist...');if(urlPreviewCard)urlPreviewCard.classList.add('hidden');await loadPage(1);if(!loading&&!urlStatus?.classList.contains('error'))urlStatus.classList.add('hidden')}

  if(playlistSelectAll)playlistSelectAll.onclick=()=>{const all=currentItems.length>0&&currentItems.every(x=>selectedIds.has(String(x.id)));currentItems.forEach(item=>{const id=String(item.id);if(all){selectedIds.delete(id);selectedItems.delete(id)}else{selectedIds.add(id);selectedItems.set(id,item)}});render()};

  if(playlistDownloadBtn)playlistDownloadBtn.onclick=async()=>{if(!selectedItems.size||loading||typeof _downloadQueue==='undefined'||typeof downloadQueueItem!=='function')return;playlistDownloadBtn.disabled=true;if(playlistSelectAll)playlistSelectAll.disabled=true;if(playlistProgress)playlistProgress.classList.remove('hidden');const chosen=[...selectedItems.values()],start=_downloadQueue.length;chosen.forEach(item=>_downloadQueue.push({id:item.id,title:item.title,thumbnail:item.thumbnail,url:item.webpage_url,file:null,status:'waiting'}));if(typeof renderQueue==='function')renderQueue();for(let i=0;i<chosen.length;i++){const qi=start+i;if(playlistProgText)playlistProgText.textContent=`Mendownload ${i+1}/${chosen.length}: ${chosen[i].title}`;if(playlistProgBar)playlistProgBar.style.width=((i/chosen.length)*100)+'%';await downloadQueueItem(qi)}if(playlistProgBar)playlistProgBar.style.width='100%';if(playlistProgText)playlistProgText.textContent=`✓ ${chosen.length} track selesai diproses ke antrian`;playlistDownloadBtn.disabled=false;if(playlistSelectAll)playlistSelectAll.disabled=false};

  const observer=new MutationObserver(()=>{const selected=$("#selected"),editorStatus=$("#editorStatus");if(selected&&!selected.classList.contains('hidden')&&editorStatus){editorStatus.textContent='✓ Loaded / Selected';editorStatus.classList.add('loaded')}});const selectedEl=$("#selected");if(selectedEl)observer.observe(selectedEl,{attributes:true,attributeFilter:['class']});
  urlInfoBtn.onclick=checkPlaylist;
})();
