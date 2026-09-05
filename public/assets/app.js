const TYPES = {
  image: {label:'image', icon:'▧', accept:'.png,.jpg,.jpeg,.bmp,.tga,image/png,image/jpeg,image/bmp', formats:'PNG · JPG · BMP · TGA · up to 20 MB'},
  decal: {label:'decal image', icon:'◈', accept:'.png,.jpg,.jpeg,.bmp,.tga,image/png,image/jpeg,image/bmp', formats:'PNG · JPG · BMP · TGA · up to 20 MB'},
  model: {label:'3D model', icon:'◇', accept:'.fbx,.gltf,.glb,.rbxm,.rbxmx,model/gltf+json,model/gltf-binary', formats:'FBX · GLTF · GLB · RBXM · RBXMX · up to 20 MB'},
  mesh: {label:'mesh', icon:'△', accept:'.fbx,.obj,.gltf,.glb,.mesh', formats:'FBX · OBJ · GLTF · GLB · up to 20 MB'},
  animation: {label:'animation', icon:'◎', accept:'.fbx,.rbxm,.rbxmx', formats:'FBX · RBXM · RBXMX · up to 20 MB'},
  audio: {label:'audio', icon:'♫', accept:'.mp3,.wav,.ogg,.flac,audio/*', formats:'MP3 · WAV · OGG · FLAC · up to 20 MB'},
  video: {label:'video', icon:'▶', accept:'.mp4,.mov,.webm,video/mp4,video/quicktime,video/webm', formats:'MP4 · MOV · WEBM · up to 20 MB'}
};

const state = { type:'image', file:null, objectUrl:null };
const $ = id => document.getElementById(id);
const typeButtons = [...document.querySelectorAll('.type-card')];
const fileInput = $('fileInput');
const dropzone = $('dropzone');

function humanSize(bytes){
  if(bytes < 1024) return `${bytes} B`;
  if(bytes < 1024**2) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024**2).toFixed(2)} MB`;
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
  $('progressBar').style.width = `${p}%`;
  $('progressPct').textContent = `${Math.round(p)}%`;
  $('progressText').textContent = text;
}
function clearProgress(){ $('progressWrap').classList.add('hidden'); }

function updateType(type){
  state.type = type;
  const cfg = TYPES[type];
  typeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.type === type));
  fileInput.accept = cfg.accept;
  $('dropTitle').textContent = `Drop your ${cfg.label} here`;
  $('dropMeta').textContent = cfg.formats;
  $('fileIcon').textContent = cfg.icon;
  if(state.file){
    // Revalidate an already-selected file against the newly selected type.
    const ext = '.' + (state.file.name.split('.').pop() || '').toLowerCase();
    const allowed = cfg.accept.toLowerCase().split(',').some(v => v.trim() === ext || v.trim() === state.file.type.toLowerCase());
    if(!allowed){ clearFile(); toast(`File sebelumnya tidak cocok untuk ${cfg.label}.`, 'error'); }
  }
  updateButton();
}

function selectFile(file){
  if(!file) return;
  if(file.size > 20 * 1024 * 1024){ toast('File terlalu besar. Batas UI saat ini 20 MB.', 'error'); return; }
  state.file = file;
  if(state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(file);
  $('selectedFile').classList.remove('hidden');
  $('fileName').textContent = file.name;
  $('fileMeta').textContent = `${humanSize(file.size)} · ${file.type || 'unknown MIME'}`;
  $('fileIcon').textContent = TYPES[state.type].icon;
  if(!$('assetName').value){
    const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g,' ').trim();
    $('assetName').value = base.slice(0,50);
  }
  updateButton();
}
function clearFile(){
  state.file = null;
  if(state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = null;
  $('selectedFile').classList.add('hidden');
  fileInput.value = '';
  updateButton();
}
function updateButton(){
  const name = $('assetName').value.trim();
  const validName = name.length >= 3 && name.length <= 50;
  $('nameHint').classList.toggle('error', name.length > 0 && !validName);
  $('uploadBtn').disabled = !(state.file && validName);
  $('uploadBtnText').textContent = state.file ? 'Upload asset to Roblox' : 'Select a file to continue';
}

async function uploadAsset(){
  if(!state.file) return;
  const name = $('assetName').value.trim();
  if(name.length < 3 || name.length > 50){ toast('Nama asset harus 3–50 karakter.', 'error'); return; }

  /*
   * The existing Music Lab endpoint is intentionally not reused here.
   * This page is isolated and expects a future generic endpoint:
   * POST /api/assets/upload  (multipart: file, assetType, displayName, description, creatorType)
   */
  $('uploadBtn').disabled = true;
  setProgress(8, 'Preparing asset...');
  await new Promise(r => setTimeout(r, 180));

  try{
    const form = new FormData();
    form.append('file', state.file, state.file.name);
    form.append('assetType', state.type);
    form.append('displayName', name);
    form.append('description', $('description').value.trim());
    form.append('creatorType', $('creatorType').value);

    setProgress(32, 'Uploading...');
    const response = await fetch('/api/assets/upload', {method:'POST', body:form});
    setProgress(72, 'Waiting for Roblox...');
    const data = await response.json().catch(() => ({}));

    if(!response.ok) throw new Error(data.error || data.message || `Upload failed (HTTP ${response.status})`);

    setProgress(100, 'Upload complete');
    addHistory({
      type: state.type,
      name,
      assetId: data.assetId || data.id || 'PROCESSING',
      status: data.status || 'processing',
      createdAt: new Date().toISOString()
    });
    toast(data.assetId ? `Asset berhasil dibuat: ${data.assetId}` : 'Asset sedang diproses Roblox.', 'success');
    setTimeout(clearProgress, 900);
  }catch(err){
    clearProgress();
    const msg = String(err?.message || err);
    if(/fetch|404|failed to fetch/i.test(msg)){
      toast('UI siap. Endpoint /api/assets/upload belum dipasang di backend.', 'error');
    }else{
      toast(msg, 'error');
    }
  }finally{
    $('uploadBtn').disabled = false;
    updateButton();
  }
}

function getHistory(){
  try { return JSON.parse(localStorage.getItem('roblox_asset_hub_history') || '[]'); }
  catch { return []; }
}
function saveHistory(list){ localStorage.setItem('roblox_asset_hub_history', JSON.stringify(list.slice(0,50))); }
function addHistory(item){
  const list = getHistory();
  list.unshift(item);
  saveHistory(list);
  renderHistory();
}
function statusLabel(status){
  const s = String(status || '').toLowerCase();
  if(s.includes('approv') || s === 'completed') return 'Approved';
  if(s.includes('reject')) return 'Rejected';
  return 'Reviewing';
}
function renderHistory(){
  const list = getHistory();
  $('statCompleted').textContent = list.filter(x => x.status === 'completed' || /approv/i.test(x.status)).length;
  $('statReviewing').textContent = list.filter(x => /processing|review/i.test(x.status)).length;
  $('statRejected').textContent = list.filter(x => /reject/i.test(x.status)).length;

  if(!list.length){
    $('historyList').innerHTML = '<div class="empty-history"><span>◇</span><h3>No assets yet</h3><p>Uploaded assets will be shown here.</p></div>';
    return;
  }
  $('historyList').innerHTML = list.map((x,i) => {
    const cfg = TYPES[x.type] || TYPES.image;
    const status = statusLabel(x.status);
    const date = x.createdAt ? new Date(x.createdAt).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}) : '';
    return `<div class="history-row"><div class="history-art">${cfg.icon}</div><div class="history-main"><strong>${escapeHtml(x.name)}</strong><small>${date}</small></div><div class="history-type">${cfg.label}</div><div class="history-status">${status}</div><div class="history-id" title="${escapeHtml(String(x.assetId || ''))}">${escapeHtml(String(x.assetId || '—'))}</div><button class="history-copy" data-id="${escapeHtml(String(x.assetId || ''))}">Copy ID</button></div>`;
  }).join('');
  document.querySelectorAll('.history-copy').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.id;
    if(!id || id === 'PROCESSING') return toast('Asset ID belum tersedia.', 'error');
    navigator.clipboard?.writeText(id).then(() => toast('Asset ID copied.', 'success')).catch(() => toast(id));
  }));
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}

// Type selector.
typeButtons.forEach(btn => btn.addEventListener('click', () => updateType(btn.dataset.type)));
// File picker and drag/drop.
fileInput.addEventListener('change', e => selectFile(e.target.files?.[0]));
$('removeFile').addEventListener('click', clearFile);
['dragenter','dragover'].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave','drop'].forEach(type => dropzone.addEventListener(type, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', e => selectFile(e.dataTransfer.files?.[0]));
$('assetName').addEventListener('input', updateButton);
$('uploadBtn').addEventListener('click', uploadAsset);
$('scrollUpload').addEventListener('click', () => $('uploadWorkspace').scrollIntoView({behavior:'smooth'}));
$('clearHistory').addEventListener('click', () => { localStorage.removeItem('roblox_asset_hub_history'); renderHistory(); toast('History view cleared.', 'success'); });

document.addEventListener('keydown', e => { if(e.key === 'Escape') clearProgress(); });
updateType('image');
renderHistory();
