const TYPES = {
  image: {label:'Image', icon:'▧', assetType:'Image', accept:'.png,.jpg,.jpeg,.bmp,.tga,image/png,image/jpeg,image/bmp,image/tga', formats:'PNG · JPG · BMP · TGA · under 8000×8000'},
  decal: {label:'Decal', icon:'◈', assetType:'Decal', accept:'.png,.jpg,.jpeg,.bmp,.tga,image/png,image/jpeg,image/bmp,image/tga', formats:'PNG · JPG · BMP · TGA · under 8000×8000'},
  model: {label:'Model', icon:'◇', assetType:'Model', accept:'.fbx,.gltf,.glb,.rbxm,.rbxmx,model/gltf+json,model/gltf-binary,model/x-rbxm', formats:'FBX · GLTF · GLB · RBXM · RBXMX · 20 MB'},
  mesh: {label:'Mesh', icon:'△', assetType:'Mesh', accept:'.mesh', formats:'Roblox-delivery mesh only · not normal file import'},
  animation: {label:'Animation', icon:'◎', assetType:'Animation', accept:'.rbxm,.rbxmx,model/x-rbxm', formats:'RBXM · RBXMX · 20 MB'},
  audio: {label:'Audio', icon:'♫', assetType:'Audio', accept:'.mp3,.wav,.ogg,.flac,audio/mpeg,audio/wav,audio/ogg,audio/flac', formats:'MP3 · WAV · OGG · FLAC · 20 MB'},
  video: {label:'Video', icon:'▶', assetType:'Video', accept:'.mp4,.mov,video/mp4,video/quicktime', formats:'MP4 · MOV · current UI limit 20 MB'}
};

const state = {
  type:'image',
  files:[],
  uploading:false,
  results:[]
};

const $ = id => document.getElementById(id);
const typeButtons = [...document.querySelectorAll('.type-card')];
const fileInput = $('fileInput');
const dropzone = $('dropzone');

fileInput.multiple = true;

function humanSize(bytes){
  if(bytes < 1024) return `${bytes} B`;
  if(bytes < 1024**2) return `${(bytes/1024).toFixed(1)} KB`;
  if(bytes < 1024**3) return `${(bytes/1024**2).toFixed(2)} MB`;
  return `${(bytes/1024**3).toFixed(2)} GB`;
}
function esc(v){
  return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
function toast(message, kind=''){
  const el = $('toast');
  el.textContent = message;
  el.className = `toast ${kind} show`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.className='toast', 3200);
}
function setProgress(p, text){
  $('progressWrap').classList.remove('hidden');
  $('progressBar').style.width = `${Math.max(0,Math.min(100,p))}%`;
  $('progressPct').textContent = `${Math.round(p)}%`;
  $('progressText').textContent = text;
}
function clearProgress(){ $('progressWrap').classList.add('hidden'); }

function injectMultiUi(){
  const selected = $('selectedFile');
  if(selected) selected.remove();

  const queue = document.createElement('div');
  queue.id = 'multiQueue';
  queue.className = 'multi-queue';
  queue.innerHTML = `
    <div class="queue-head">
      <div><strong id="queueCount">0 files selected</strong><span id="queueSummary">Add multiple files and upload them together.</span></div>
      <button type="button" class="ghost-small" id="clearQueue">Clear</button>
    </div>
    <div id="queueItems" class="queue-items"></div>`;
  dropzone.after(queue);

  const groupRow = document.createElement('label');
  groupRow.className = 'field full hidden';
  groupRow.id = 'groupField';
  groupRow.innerHTML = `<span>Group ID</span><input id="groupId" inputmode="numeric" placeholder="e.g. 123456789"><small>Required only when Creator is Group.</small>`;
  $('description').closest('.field').before(groupRow);

  $('clearQueue').addEventListener('click', clearFiles);
  $('creatorType').addEventListener('change', () => {
    $('groupField').classList.toggle('hidden', $('creatorType').value !== 'group');
  });
}

function updateType(type){
  state.type = type;
  const cfg = TYPES[type];
  typeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.type === type));
  fileInput.accept = cfg.accept;
  $('dropTitle').textContent = `Drop your ${cfg.label.toLowerCase()} files here`;
  $('dropMeta').textContent = cfg.formats;
  document.querySelector('.limit-badge').textContent = type === 'image' || type === 'decal' ? 'MAX 20 MB / FILE' : 'MAX 20 MB / FILE';
  if(type === 'mesh') toast('Mesh tidak menerima file FBX/OBJ biasa lewat Create Asset API; pilih Model untuk upload 3D.', 'error');
  renderQueue();
  updateButton();
}

function fileAllowed(file){
  const cfg = TYPES[state.type];
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
  const mime = String(file.type || '').toLowerCase();
  return cfg.accept.toLowerCase().split(',').some(v => v.trim() === ext || (mime && v.trim() === mime));
}

function addFiles(fileList){
  const incoming = [...(fileList || [])];
  if(!incoming.length) return;
  let rejected = 0;
  for(const file of incoming){
    if(state.type === 'mesh' || !fileAllowed(file) || file.size > 20 * 1024 * 1024){ rejected++; continue; }
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if(state.files.some(x => x.key === key)) continue;
    state.files.push({key,file,status:'queued',percent:0,result:null,error:null});
  }
  if(rejected) toast(`${rejected} file ditolak karena format/ukuran tidak cocok.`, 'error');
  renderQueue();
  updateButton();
}

function clearFiles(){
  if(state.uploading) return;
  state.files = [];
  fileInput.value = '';
  renderQueue();
  updateButton();
}

function removeFile(key){
  if(state.uploading) return;
  state.files = state.files.filter(x => x.key !== key);
  renderQueue();
  updateButton();
}

function renderQueue(){
  const list = $('queueItems');
  if(!list) return;
  $('queueCount').textContent = `${state.files.length} file${state.files.length===1?'':'s'} selected`;
  const done = state.files.filter(x => x.status === 'done').length;
  const failed = state.files.filter(x => x.status === 'error').length;
  $('queueSummary').textContent = state.uploading ? `${done} completed · ${failed} failed · uploads in progress` : (state.files.length ? 'Ready to upload as a batch.' : 'Add multiple files and upload them together.');
  list.innerHTML = state.files.map((item,i) => {
    const icon = TYPES[state.type]?.icon || '◇';
    const statusText = item.status === 'done' ? 'Completed' : item.status === 'error' ? 'Failed' : item.status === 'uploading' ? `Uploading ${item.percent}%` : 'Queued';
    const assetId = item.result?.assetId;
    const link = assetId ? `https://create.roblox.com/store/asset/${encodeURIComponent(assetId)}` : '';
    return `<div class="queue-item ${item.status}">
      <div class="queue-item-icon">${icon}</div>
      <div class="queue-item-main"><strong title="${esc(item.file.name)}">${esc(item.file.name)}</strong><small>${humanSize(item.file.size)} · ${statusText}</small>${item.error?`<em>${esc(item.error)}</em>`:''}</div>
      <div class="queue-progress"><i style="width:${Math.max(0,item.percent)}%"></i></div>
      <div class="queue-actions">${assetId?`<button type="button" class="queue-link" data-link="${esc(link)}">Open</button><button type="button" class="queue-copy" data-id="${esc(assetId)}">Copy ID</button>`:''}${!state.uploading && item.status !== 'done' ? `<button type="button" class="queue-remove" data-key="${esc(item.key)}">×</button>`:''}</div>
    </div>`;
  }).join('');

  document.querySelectorAll('.queue-remove').forEach(btn => btn.addEventListener('click',()=>removeFile(btn.dataset.key)));
  document.querySelectorAll('.queue-copy').forEach(btn => btn.addEventListener('click',()=>copyId(btn.dataset.id)));
  document.querySelectorAll('.queue-link').forEach(btn => btn.addEventListener('click',()=>window.open(btn.dataset.link,'_blank','noopener')));
}

function copyId(id){
  if(!id) return;
  navigator.clipboard?.writeText(id).then(()=>toast('Asset ID copied.','success')).catch(()=>toast(id));
}

function updateButton(){
  const name = $('assetName').value.trim();
  const validName = name.length >= 3 && name.length <= 50;
  $('nameHint').classList.toggle('error', name.length > 0 && !validName);
  $('uploadBtn').disabled = !(state.files.length && validName && !state.uploading);
  $('uploadBtnText').textContent = state.files.length ? `Upload ${state.files.length} asset${state.files.length===1?'':'s'} to Roblox` : 'Select files to continue';
}

async function uploadOne(item, position, total){
  item.status = 'uploading'; item.percent = 8; renderQueue();
  const form = new FormData();
  form.append('file', item.file, item.file.name);
  form.append('assetType', TYPES[state.type].assetType);
  form.append('displayName', ($('assetName').value.trim() || item.file.name.replace(/\.[^.]+$/,'')).slice(0,50));
  form.append('description', $('description').value.trim());
  form.append('creatorType', $('creatorType').value);
  if($('creatorType').value === 'group') form.append('groupId', $('groupId').value.trim());

  try{
    item.percent = 25; renderQueue();
    const response = await fetch('/api/assets/upload', {method:'POST',body:form});
    item.percent = 72; renderQueue();
    const data = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
    item.percent = 100; item.status = 'done'; item.result = data;
    addHistory({type:state.type,name:data.displayName || item.file.name,assetId:data.assetId || 'PROCESSING',status:data.status || 'processing',createdAt:new Date().toISOString()});
    renderQueue();
    return data;
  }catch(err){
    item.status = 'error'; item.percent = 0; item.error = String(err?.message || err);
    renderQueue();
    return null;
  }
}

async function uploadAsset(){
  if(state.uploading || !state.files.length) return;
  const name = $('assetName').value.trim();
  if(name.length < 3 || name.length > 50){ toast('Nama asset harus 3–50 karakter.', 'error'); return; }
  if($('creatorType').value === 'group' && !/^\d+$/.test($('groupId').value.trim())){ toast('Group ID wajib diisi dengan angka.', 'error'); return; }

  state.uploading = true;
  $('uploadBtn').disabled = true;
  const queue = [...state.files.filter(x=>x.status==='queued')];
  const concurrency = Math.min(2, Math.max(1, Number(localStorage.getItem('asset_upload_concurrency') || 2)));
  let cursor = 0;
  let active = 0;
  let completed = 0;

  await new Promise(resolve => {
    const next = () => {
      while(active < concurrency && cursor < queue.length){
        const item = queue[cursor++]; active++;
        uploadOne(item,cursor,queue.length).finally(()=>{
          active--; completed++;
          const pct = Math.round((completed / queue.length) * 100);
          setProgress(pct, completed === queue.length ? 'Batch complete' : `Uploading ${completed}/${queue.length}...`);
          if(completed >= queue.length && active === 0) resolve(); else next();
        });
      }
    };
    setProgress(2, `Starting ${queue.length} upload${queue.length===1?'':'s'}...`);
    next();
  });

  state.uploading = false;
  renderQueue();
  updateButton();
  const failed = state.files.filter(x=>x.status === 'error').length;
  const done = state.files.filter(x=>x.status === 'done').length;
  toast(`${done} berhasil · ${failed} gagal`, failed ? 'error' : 'success');
  setTimeout(clearProgress, 1100);
}

function getHistory(){
  try { return JSON.parse(localStorage.getItem('roblox_asset_hub_history') || '[]'); } catch { return []; }
}
function saveHistory(list){ localStorage.setItem('roblox_asset_hub_history', JSON.stringify(list.slice(0,100))); }
function addHistory(item){ const list=getHistory(); list.unshift(item); saveHistory(list); renderHistory(); }
function statusLabel(status){
  const s=String(status||'').toLowerCase();
  if(s.includes('approv') || s==='completed') return 'Approved';
  if(s.includes('reject')) return 'Rejected';
  return 'Reviewing';
}
function renderHistory(){
  const list=getHistory();
  $('statCompleted').textContent=list.filter(x=>x.status==='completed'||/approv/i.test(x.status)).length;
  $('statReviewing').textContent=list.filter(x=>/processing|review/i.test(x.status)).length;
  $('statRejected').textContent=list.filter(x=>/reject/i.test(x.status)).length;
  if(!list.length){ $('historyList').innerHTML='<div class="empty-history"><span>◇</span><h3>No assets yet</h3><p>Uploaded assets will be shown here.</p></div>'; return; }
  $('historyList').innerHTML=list.map(x=>{
    const cfg=TYPES[x.type]||TYPES.image;
    const status=statusLabel(x.status);
    const date=x.createdAt?new Date(x.createdAt).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):'';
    const id=String(x.assetId||'');
    const link=id && id!=='PROCESSING' ? `https://create.roblox.com/store/asset/${encodeURIComponent(id)}` : '';
    return `<div class="history-row"><div class="history-art">${cfg.icon}</div><div class="history-main"><strong>${esc(x.name)}</strong><small>${date}</small></div><div class="history-type">${cfg.label}</div><div class="history-status">${status}</div><div class="history-id">${esc(id||'—')}</div>${link?`<button class="history-open" data-link="${esc(link)}">Open</button>`:''}<button class="history-copy" data-id="${esc(id)}">Copy ID</button></div>`;
  }).join('');
  document.querySelectorAll('.history-copy').forEach(btn=>btn.addEventListener('click',()=>copyId(btn.dataset.id)));
  document.querySelectorAll('.history-open').forEach(btn=>btn.addEventListener('click',()=>window.open(btn.dataset.link,'_blank','noopener')));
}

// Events.
typeButtons.forEach(btn=>btn.addEventListener('click',()=>updateType(btn.dataset.type)));
fileInput.addEventListener('change',e=>addFiles(e.target.files));
['dragenter','dragover'].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.add('drag');}));
['dragleave','drop'].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.remove('drag');}));
dropzone.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
$('assetName').addEventListener('input',updateButton);
$('uploadBtn').addEventListener('click',uploadAsset);
$('scrollUpload').addEventListener('click',()=>$('uploadWorkspace').scrollIntoView({behavior:'smooth'}));
$('clearHistory').addEventListener('click',()=>{localStorage.removeItem('roblox_asset_hub_history');renderHistory();toast('History view cleared.','success');});

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!state.uploading)clearProgress();});

injectMultiUi();
updateType('image');
renderQueue();
renderHistory();
