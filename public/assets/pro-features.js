(function () {
  'use strict';

  const STORAGE = 'roblox_asset_hub_pro';
  const PRO_CSS_ID = 'asset-hub-pro-runtime-style';

  const $ = (selector) => document.querySelector(selector);
  const esc2 = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
  const idOnly = (value) => /^\d+$/.test(String(value || '').trim());
  const uri = (id) => `rbxassetid://${id}`;

  function loadStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE) || '{}'); }
    catch { return {}; }
  }

  function saveStore(value) {
    localStorage.setItem(STORAGE, JSON.stringify(value));
  }

  function codeFor(id, type) {
    const asset = uri(id);
    if (type === 'audio') return [
      'local SoundService = game:GetService("SoundService")',
      'local sound = Instance.new("Sound")',
      `sound.SoundId = ${JSON.stringify(asset)}`,
      'sound.Parent = SoundService',
      'sound:Play()'
    ].join('\n');
    if (type === 'animation') return [
      'local animation = Instance.new("Animation")',
      `animation.AnimationId = ${JSON.stringify(asset)}`,
      '-- Load this animation through an Animator.'
    ].join('\n');
    if (type === 'image' || type === 'decal') return [
      `local IMAGE_ID = ${JSON.stringify(asset)}`,
      'local image = script.Parent',
      'image.Image = IMAGE_ID'
    ].join('\n');
    return [
      `local ASSET_ID = ${JSON.stringify(String(id))}`,
      '-- Use the asset ID in your Roblox experience.'
    ].join('\n');
  }

  function open(title, body) {
    const modal = $('#modal');
    const modalTitle = $('#modalTitle');
    const modalBody = $('#modalBody');
    const eyebrow = $('#modalEyebrow');
    if (!modal || !modalTitle || !modalBody) return;
    if (eyebrow) eyebrow.textContent = 'ASSET HUB PRO';
    modalTitle.textContent = title;
    modalBody.innerHTML = `<div class="pro-modal-content">${body}</div>`;
    modal.classList.remove('hidden');
  }

  function close() {
    $('#modal')?.classList.add('hidden');
  }

  function injectRuntimeStyle() {
    if ($('#' + PRO_CSS_ID)) return;
    const style = document.createElement('style');
    style.id = PRO_CSS_ID;
    style.textContent = `
      .pro-card{position:relative!important;margin-top:24px!important;padding:0 22px 22px!important;border:1px solid var(--line2)!important;border-radius:20px!important;background:var(--surface)!important;overflow:hidden!important;box-shadow:var(--shadow)!important}
      .pro-card::before{content:"";display:block;height:4px;margin:0 -22px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
      .pro-card .section-head{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:start!important;gap:18px!important;padding:22px 0 0!important;margin:0!important}
      .pro-card .section-head>div:first-child{min-width:0!important}
      .pro-card .section-head .eyebrow{display:block!important;margin:0 0 8px!important}
      .pro-card .section-head h2{margin:0 0 8px!important;font-size:24px!important;line-height:1.15!important;letter-spacing:-.03em!important}
      .pro-card .section-head p{margin:0!important;max-width:720px!important;font-size:13px!important;line-height:1.6!important;color:var(--muted)!important}
      .pro-badge{align-self:start!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:32px!important;padding:8px 12px!important;border:1px solid var(--line2)!important;border-radius:999px!important;font-size:10px!important;line-height:1!important;letter-spacing:.15em!important;font-weight:800!important;color:var(--accent)!important;background:rgba(124,92,255,.09)!important;white-space:nowrap!important}
      .pro-grid{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:14px!important;margin-top:22px!important}
      .pro-tool{position:relative!important;min-height:126px!important;padding:18px 44px 18px 18px!important;border:1px solid var(--line)!important;border-radius:16px!important;background:var(--surface2)!important;color:var(--text)!important;display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:flex-start!important;gap:10px!important;text-align:left!important;cursor:pointer!important;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease,background .18s ease!important}
      .pro-tool strong{margin:0!important;padding:0!important;font-size:13px!important;line-height:1.4!important;color:var(--text)!important}
      .pro-tool span{margin:0!important;max-width:36ch!important;font-size:11.5px!important;line-height:1.55!important;color:var(--muted)!important}
      .pro-tool::after{content:"→";position:absolute;right:14px;top:14px;width:28px;height:28px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:9px;background:var(--surface3);color:var(--muted)}
      .pro-tool:hover{transform:translateY(-3px)!important;border-color:var(--accent)!important;box-shadow:0 14px 34px rgba(0,0,0,.14)!important}
      .pro-card input:not([type="file"]),.pro-card textarea,.pro-card select,.pro-modal-content input:not([type="file"]),.pro-modal-content textarea,.pro-modal-content select,.pro-output{box-sizing:border-box!important;width:100%!important;min-height:44px!important;border:1px solid var(--line)!important;border-radius:12px!important;background:var(--surface2)!important;color:var(--text)!important;padding:11px 13px!important;outline:none!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.025)!important;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease!important}
      .pro-card textarea,.pro-modal-content textarea{min-height:104px!important;resize:vertical!important}
      .pro-card input:not([type="file"]):hover,.pro-card textarea:hover,.pro-card select:hover,.pro-modal-content input:not([type="file"]):hover,.pro-modal-content textarea:hover,.pro-modal-content select:hover{border-color:var(--line2)!important;background:var(--surface3)!important}
      .pro-card input:not([type="file"]):focus,.pro-card textarea:focus,.pro-card select:focus,.pro-modal-content input:not([type="file"]):focus,.pro-modal-content textarea:focus,.pro-modal-content select:focus{border-color:var(--accent)!important;background:var(--surface)!important;box-shadow:0 0 0 3px rgba(124,92,255,.11)!important}
      .pro-card input::placeholder,.pro-card textarea::placeholder,.pro-modal-content input::placeholder,.pro-modal-content textarea::placeholder{color:var(--muted)!important;opacity:.78}
      .pro-card select,.pro-modal-content select{appearance:none!important;padding-right:38px!important;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%)!important;background-position:calc(100% - 17px) 19px,calc(100% - 12px) 19px!important;background-size:5px 5px!important;background-repeat:no-repeat!important}
      input:not([type="file"]),textarea,select{box-sizing:border-box;min-height:44px;border-radius:12px}
      input:not([type="file"]):focus,textarea:focus,select:focus{outline:none;box-shadow:0 0 0 3px rgba(124,92,255,.10)}
      .pro-form-row{display:flex;gap:9px;flex-wrap:wrap}.pro-form-row>*{min-width:0}.pro-form-row input,.pro-form-row select{flex:1 1 180px}
      .recovery-bar{display:flex;align-items:center;gap:8px;margin:20px 0 0;padding:14px 0 0;border-top:1px solid var(--line)}.recovery-bar span{min-width:0;margin-right:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .scan-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}.scan-stats>div{min-width:0;padding:13px;border:1px solid var(--line);border-radius:12px;background:var(--surface2)}.scan-stats strong{display:block;font-size:22px;line-height:1.1;color:var(--text)}.scan-stats span{display:block;margin-top:4px;font-size:11px;color:var(--muted)}
      .scan-list,.collection-list,.collection-assets,.diff-list{display:grid;gap:7px;max-height:320px;overflow:auto}.scan-list>div,.collection-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface2)}.scan-list span,.collection-row strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.scan-list em{font-size:11px;color:var(--muted);font-style:normal}.collection-row button,.collection-assets button{padding:7px 10px;border:1px solid var(--line2);border-radius:8px;background:var(--surface3);color:var(--text);cursor:pointer}
      .pro-output{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:360px;overflow:auto}.health-score{display:flex;align-items:flex-end;gap:8px;margin:4px 0 14px}.health-score strong{font-size:48px;line-height:.9;letter-spacing:-.04em}.health-score span{padding-bottom:4px;color:var(--muted);font-size:12px}.pro-checks{display:grid;gap:6px}.pro-checks p{margin:0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;color:var(--text);background:var(--surface2)}
      .analytics-grid{display:grid;gap:9px;margin-bottom:15px}.bar-row{display:grid;grid-template-columns:84px minmax(0,1fr) 36px;align-items:center;gap:8px;font-size:12px}.bar-row>div{height:9px;border-radius:999px;background:var(--surface3);overflow:hidden}.bar-row i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:inherit}
      .diff-summary{padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface2);margin-bottom:8px}.diff-list>div{display:grid;gap:4px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--surface2);font-size:11px}.diff-list span{color:var(--muted);overflow-wrap:anywhere}.command-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      body.compact .pro-card{background:#fff!important;border-color:#d9e0e8!important;box-shadow:0 14px 34px rgba(35,50,70,.08)!important}body.compact .pro-tool{background:#f8fafc!important;border-color:#d9e0e8!important}body.compact .pro-tool:hover{background:#fff!important;border-color:#6c50e8!important}body.compact .pro-tool::after{background:#f1f4f8!important;border-color:#d9e0e8!important}body.compact .pro-card input:not([type="file"]),body.compact .pro-card textarea,body.compact .pro-card select,body.compact .pro-modal-content input:not([type="file"]),body.compact .pro-modal-content textarea,body.compact .pro-modal-content select{background:#f8fafc!important;color:#172230!important;border-color:#d9e0e8!important}body.compact .pro-card input:not([type="file"]):focus,body.compact .pro-card textarea:focus,body.compact .pro-card select:focus,body.compact .pro-modal-content input:not([type="file"]):focus,body.compact .pro-modal-content textarea:focus,body.compact .pro-modal-content select:focus{background:#fff!important;border-color:#6c50e8!important}.hidden{display:none!important}
      @media(max-width:1050px){.pro-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.scan-stats{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
      @media(max-width:700px){.pro-card{padding:0 16px 16px!important}.pro-card::before{margin-left:-16px;margin-right:-16px}.pro-card .section-head{grid-template-columns:1fr!important}.pro-card .section-head h2{font-size:21px!important}.pro-grid,.command-grid{grid-template-columns:1fr!important}.pro-tool{min-height:108px!important}.recovery-bar{flex-wrap:wrap}.recovery-bar span{width:100%;margin-right:0}}
    `;
    document.head.appendChild(style);
  }

  function injectUI() {
    const actions = document.querySelector('.head-actions');
    if (actions && !$('#commandCenterBtn')) {
      actions.insertAdjacentHTML('beforeend', '<button id="commandCenterBtn" class="secondary-btn">Command Center</button>');
    }

    const anchor = $('#quickManifest');
    if (anchor && !$('#quickScanner')) {
      anchor.insertAdjacentHTML('beforebegin', '<button id="quickScanner">⌁ <span>Smart Asset Scanner</span><b>→</b></button>');
    }

    const queue = $('#queuePanel');
    if (queue && !$('#proToolsCard')) {
      queue.insertAdjacentHTML('afterend', `
        <section class="card pro-card" id="proToolsCard">
          <div class="section-head">
            <div>
              <span class="eyebrow">ASSET HUB PRO</span>
              <h2>Creator Command Center</h2>
              <p>Scan, organize, audit, compare and generate developer-ready asset workflows from one place.</p>
            </div>
            <span class="pro-badge">PRO PIPELINE</span>
          </div>
          <div class="pro-grid">
            <button class="pro-tool" data-pro="scan"><strong>⌁ Smart Scanner</strong><span>Scan folders, detect formats, duplicates, oversized files and naming issues.</span></button>
            <button class="pro-tool" data-pro="toolbox"><strong>⌘ Asset ID Toolbox</strong><span>Generate URI, Store URL, Lua and ModuleScript snippets from an ID.</span></button>
            <button class="pro-tool" data-pro="collections"><strong>▦ Collections</strong><span>Keep related Roblox asset IDs grouped into reusable local collections.</span></button>
            <button class="pro-tool" data-pro="health"><strong>♥ Asset Health</strong><span>Audit your local upload history for failures, processing and duplicates.</span></button>
            <button class="pro-tool" data-pro="analytics"><strong>◫ Analytics</strong><span>See the asset mix, workspace usage and recent activity at a glance.</span></button>
            <button class="pro-tool" data-pro="pipeline"><strong>⚡ Pipeline</strong><span>Run the safe scanner → review → queue workflow without auto-uploading.</span></button>
            <button class="pro-tool" data-pro="compare"><strong>⇄ Version Diff</strong><span>Compare two Roblox asset versions and highlight changed fields.</span></button>
            <button class="pro-tool" data-pro="snippet"><strong>{ } Studio Snippets</strong><span>Generate a clean ModuleScript from recent uploaded assets.</span></button>
          </div>
          <div class="recovery-bar"><span id="recoveryState">Recovery snapshot: idle</span><button id="saveRecovery" class="secondary-btn small">Save snapshot</button><button id="exportRecovery" class="secondary-btn small">Export JSON</button></div>
        </section>
      `);
    }

    const footer = document.querySelector('.site-footer');
    if (footer && !$('#proStatus')) {
      footer.insertAdjacentHTML('beforebegin', '<div id="proStatus" class="pro-status" aria-live="polite"><span>Asset Hub Pro</span><b id="proStatusText">Local tools ready</b></div>');
    }
  }

  function getTypeInfo(file) {
    if (typeof window.typeForFile === 'function') return window.typeForFile(file);
    const extension = typeof window.ext === 'function' ? window.ext(file.name) : String(file.name).toLowerCase().match(/\.[^.]+$/)?.[0] || '';
    const map = {
      '.png':'image','.jpg':'image','.jpeg':'image','.bmp':'image','.tga':'image',
      '.fbx':'model','.gltf':'model','.glb':'model','.rbxm':'model','.rbxmx':'model',
      '.mp3':'audio','.wav':'audio','.ogg':'audio','.flac':'audio',
      '.mp4':'video','.mov':'video','.webm':'video'
    };
    return map[extension] || null;
  }

  async function digestFile(file) {
    if (typeof window.hashFile === 'function') return window.hashFile(file);
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function scanner() {
    open('Smart Asset Scanner', `
      <p class="pro-muted">Pilih folder atau banyak file. Scanner hanya menganalisis file lokal; tidak ada upload otomatis.</p>
      <label class="dropzone compact-drop"><input id="proFolderInput" type="file" hidden multiple webkitdirectory directory><div class="drop-symbol">⌁</div><h3>Choose asset folder</h3><p>Scan, validate and review before queueing.</p></label>
      <div id="scanSummary" class="pro-report hidden"></div>
      <div class="modal-actions"><button id="runScan" class="primary-btn">Run scan</button><button id="queueScan" class="secondary-btn" disabled>Send valid files to queue</button><button class="secondary-btn" data-close>Close</button></div>
    `);
    const input = $('#proFolderInput');
    let files = [];
    input.onchange = () => { files = [...input.files]; $('#scanSummary')?.classList.add('hidden'); const button = $('#queueScan'); if (button) button.disabled = true; };
    $('#runScan').onclick = async () => {
      if (!files.length) { toast('Pilih folder atau file dulu.', 'error'); return; }
      const rows = [];
      const seen = new Set();
      const historyHashes = new Set((typeof window.getHistory === 'function' ? window.getHistory() : []).map((item) => item.sha256).filter(Boolean));
      for (const file of files) {
        const type = getTypeInfo(file);
        let hash = '';
        try { hash = await digestFile(file); } catch {}
        const duplicate = Boolean(hash && (seen.has(hash) || historyHashes.has(hash)));
        if (hash) seen.add(hash);
        rows.push({ file, type, hash, duplicate, oversize: file.size > 20 * 1024 * 1024 });
      }
      const valid = rows.filter((row) => row.type && !row.oversize && !row.duplicate);
      const duplicates = rows.filter((row) => row.duplicate);
      const invalid = rows.filter((row) => !row.type || row.oversize);
      const summary = $('#scanSummary');
      summary.classList.remove('hidden');
      summary.innerHTML = `<div class="scan-stats"><div><strong>${rows.length}</strong><span>Files</span></div><div><strong>${valid.length}</strong><span>Ready</span></div><div><strong>${duplicates.length}</strong><span>Duplicates</span></div><div><strong>${invalid.length}</strong><span>Invalid</span></div></div><div class="scan-list">${rows.slice(0, 100).map((row) => `<div><span>${esc2(row.file.name)}</span><em>${row.duplicate ? 'Duplicate' : row.oversize ? '&gt;20 MB' : row.type || 'Unsupported'}</em></div>`).join('')}${rows.length > 100 ? '<small>Showing first 100 results.</small>' : ''}</div>`;
      const queueButton = $('#queueScan');
      queueButton.disabled = !valid.length;
      queueButton.onclick = async () => {
        if (typeof window.addFiles !== 'function') { toast('Queue uploader tidak tersedia.', 'error'); return; }
        await window.addFiles(valid.map((row) => row.file));
        close();
        toast(`${valid.length} file siap di batch queue.`, 'success');
      };
    };
    $('#modalBody').querySelector('[data-close]')?.addEventListener('click', close);
  }

  function toolbox() {
    open('Asset ID Toolbox', `
      <div class="pro-form-row"><input id="toolId" inputmode="numeric" placeholder="123456789" autocomplete="off"><select id="toolType"><option value="model">Model</option><option value="image">Image</option><option value="decal">Decal</option><option value="audio">Audio</option><option value="animation">Animation</option></select><button id="toolGo" class="primary-btn">Generate</button></div>
      <div id="toolOut" class="pro-output muted">Enter an Asset ID.</div>
      <div class="modal-actions"><button class="secondary-btn" data-close>Close</button></div>
    `);
    $('#toolGo').onclick = () => {
      const id = $('#toolId').value.trim();
      if (!idOnly(id)) { toast('Asset ID harus berupa angka.', 'error'); return; }
      const type = $('#toolType').value;
      const store = `https://create.roblox.com/store/asset/${id}`;
      const output = `Asset ID: ${id}\nURI: ${uri(id)}\nStore: ${store}\n\nLua:\n${codeFor(id, type)}\n\nModuleScript:\nreturn {\n  Id = ${JSON.stringify(id)},\n  Uri = ${JSON.stringify(uri(id))},\n  Store = ${JSON.stringify(store)}\n}`;
      $('#toolOut').textContent = output;
      $('#toolOut').classList.remove('muted');
      $('#toolOut').onclick = () => (typeof window.copyText === 'function' ? window.copyText(output, 'Toolbox output copied.') : navigator.clipboard.writeText(output));
    };
    $('#modalBody').querySelector('[data-close]')?.addEventListener('click', close);
  }

  function collections() {
    const data = loadStore();
    const collections = data.collections && typeof data.collections === 'object' ? data.collections : {};
    const names = Object.keys(collections);
    const list = names.length ? names.map((name) => `<div class="collection-row"><strong>${esc2(name)}</strong><span>${collections[name].length} assets</span><button data-col="${esc2(name)}">Open</button></div>`).join('') : '<div class="pro-muted">No collections yet.</div>';
    open('Asset Collections', `
      <div class="pro-form-row"><input id="newCol" placeholder="e.g. Weapons" maxlength="60"><button id="createCol" class="primary-btn">Create</button></div>
      <div class="collection-list">${list}</div>
      <div class="modal-actions"><button id="addCurrentCol" class="secondary-btn">Add current inspected asset</button><button class="secondary-btn" data-close>Close</button></div>
    `);
    $('#createCol').onclick = () => {
      const name = $('#newCol').value.trim();
      if (!name) { toast('Nama collection wajib diisi.', 'error'); return; }
      const next = loadStore(); next.collections = next.collections || {};
      if (!next.collections[name]) next.collections[name] = [];
      saveStore(next); collections();
    };
    $('#addCurrentCol').onclick = () => {
      const current = window.state?.inspecting || window.assetHubState?.inspecting || null;
      const target = Object.keys((loadStore().collections || {}))[0];
      if (!target || !current) { toast('Buat collection dan inspect asset dulu.', 'error'); return; }
      const next = loadStore(); next.collections[target] = Array.from(new Set([...(next.collections[target] || []), String(current)])); saveStore(next); toast(`Asset #${current} ditambahkan ke ${target}.`, 'success'); collections();
    };
    $('#modalBody').querySelectorAll('[data-col]').forEach((button) => button.onclick = () => {
      const name = button.dataset.col; const ids = (loadStore().collections || {})[name] || [];
      open(`Collection: ${name}`, `<p class="pro-muted">${ids.length} asset(s)</p><div class="collection-assets">${ids.map((id) => `<button data-open-col="${esc2(id)}">#${esc2(id)}</button>`).join('') || '<span>Empty collection.</span>'}</div><div class="modal-actions"><button class="secondary-btn" data-close>Close</button></div>`);
      $('#modalBody').querySelectorAll('[data-open-col]').forEach((item) => item.onclick = () => { const id = item.dataset.openCol; close(); if (typeof window.inspect === 'function') window.inspect(id); });
      $('#modalBody').querySelector('[data-close]')?.addEventListener('click', close);
    });
    $('#modalBody').querySelector('[data-close]')?.addEventListener('click', close);
  }

  function health() {
    const history = typeof window.getHistory === 'function' ? window.getHistory() : [];
    const total = history.length;
    const completed = history.filter((item) => ['completed', 'done'].includes(String(item.status).toLowerCase())).length;
    const processing = history.filter((item) => String(item.status).toLowerCase().includes('processing')).length;
    const failed = history.filter((item) => ['rejected', 'failed', 'error'].includes(String(item.status).toLowerCase())).length;
    const hashes = history.map((item) => item.sha256).filter(Boolean);
    const duplicateEntries = hashes.length - new Set(hashes).size;
    const score = total ? Math.max(0, Math.round(((completed + (processing * .5)) / total) * 100)) : 100;
    open('Asset Health', `<div class="health-score"><strong>${score}</strong><span>/100 health</span></div><div class="scan-stats"><div><strong>${total}</strong><span>Tracked</span></div><div><strong>${completed}</strong><span>Completed</span></div><div><strong>${processing}</strong><span>Processing</span></div><div><strong>${failed}</strong><span>Failed</span></div></div><div class="pro-checks"><p>✓ Local history is readable.</p><p>${duplicateEntries ? '⚠' : '✓'} Duplicate entries detected: ${duplicateEntries}</p><p>${failed ? '⚠' : '✓'} ${failed ? 'Review failed uploads.' : 'No failed uploads recorded.'}</p></div><div class="modal-actions"><button class="secondary-btn" data-close>Close</button></div>`);
    $('#modalBody').querySelector('[data-close]')?.addEventListener('click', close);
  }

  function analytics() {
    const history = typeof window.getHistory === 'function' ? window.getHistory() : [];
    const counts = { image: 0, decal: 0, model: 0, animation: 0, audio: 0, video: 0 };
    history.forEach((item) => { if (counts[item.type] !== undefined) counts[item.type] += 1; });
    const max = Math.max(1, ...Object.values(counts));
    const workspaces = new Set(history.map((item) => item.workspace || 'General'));
    const lastDay = history.filter((item) => item.createdAt && Date.now() - new Date(item.createdAt).getTime() < 86400000).length;
    open('Asset Analytics', `<div class="analytics-grid">${Object.entries(counts).map(([type, count]) => `<div class="bar-row"><span>${esc2(type)}</span><div><i style="width:${Math.round((count / max) * 100)}%"></i></div><b>${count}</b></div>`).join('')}</div><div class="scan-stats"><div><strong>${history.length}</strong><span>Recent assets</span></div><div><strong>${workspaces.size}</strong><span>Workspaces</span></div><div><strong>${lastDay}</strong><span>Last 24h</span></div><div><strong>${new Set(history.map((item) => item.assetId).filter(Boolean)).size}</strong><span>Unique IDs</span></div></div><div class="modal-actions"><button class="secondary-btn" data-close>Close</button></div>`);
    $('#modalBody').querySelector('[data-close]')?.addEventListener('click', close);
  }

  async function compare() {
    open('Version Diff', `<div class="pro-form-row"><input id="diffId" inputmode="numeric" placeholder="Asset ID"><input id="diffA" inputmode="numeric" placeholder="Version A"><input id="diffB" inputmode="numeric" placeholder="Version B"><button id="diffGo" class="primary-btn">Compare</button></div><div id="diffOut" class="pro-output muted">Enter asset and two version numbers.</div><div class="modal-actions"><button class="secondary-btn" data-close>Close</button></div>`);
    $('#diffGo').onclick = async () => {
      const id = $('#diffId').value.trim(), a = $('#diffA').value.trim(), b = $('#diffB').value.trim();
      if (!idOnly(id) || !idOnly(a) || !idOnly(b)) { toast('Asset ID dan version harus numerik.', 'error'); return; }
      $('#diffOut').textContent = 'Loading versions…';
      try {
        const [ra, rb] = await Promise.all([fetch(`/api/assets/${encodeURIComponent(id)}/versions/${encodeURIComponent(a)}`), fetch(`/api/assets/${encodeURIComponent(id)}/versions/${encodeURIComponent(b)}`)]);
        const [da, db] = await Promise.all([ra.json(), rb.json()]);
        if (!ra.ok || !rb.ok) throw new Error(da.error || db.error || 'Version unavailable');
        const keys = Array.from(new Set([...Object.keys(da || {}), ...Object.keys(db || {})]));
        const changed = keys.filter((key) => JSON.stringify(da[key]) !== JSON.stringify(db[key]));
        $('#diffOut').innerHTML = `<div class="diff-summary"><strong>${changed.length}</strong> changed top-level field(s)</div><div class="diff-list">${changed.map((key) => `<div><b>${esc2(key)}</b><span>v${esc2(a)}: ${esc2(JSON.stringify(da[key]))}</span><span>v${esc2(b)}: ${esc2(JSON.stringify(db[key]))}</span></div>`).join('') || '<span>No top-level differences detected.</span>'}</div>`;
      } catch (error) { $('#diffOut').textContent = error.message || 'Compare failed'; }
    };
    $('#modalBody').querySelector('[data-close]')?.addEventListener('click', close);
  }

  function snippets() {
    const history = (typeof window.getHistory === 'function' ? window.getHistory() : []).filter((item) => idOnly(item.assetId)).slice(0, 50);
    const code = `return {\n${history.map((item) => `  ${JSON.stringify(String(item.name || 'Asset').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40))} = ${JSON.stringify(String(item.assetId))},`).join('\n')}\n}`;
    open('Studio Snippet Generator', `<p class="pro-muted">Generated from recent uploaded assets.</p><div class="pro-output">${esc2(code)}</div><div class="modal-actions"><button id="copyStudio" class="secondary-btn">Copy ModuleScript</button><button class="secondary-btn" data-close>Close</button></div>`);
    $('#copyStudio').onclick = () => (typeof window.copyText === 'function' ? window.copyText(code, 'ModuleScript copied.') : navigator.clipboard.writeText(code));
    $('#modalBody').querySelector('[data-close]')?.addEventListener('click', close);
  }

  function saveRecovery() {
    const items = Array.isArray(window.state?.files) ? window.state.files : [];
    const snapshot = {
      savedAt: new Date().toISOString(),
      workspace: window.state?.workspace || 'General',
      items: items.map((item) => ({
        name: item.file?.name || '', size: item.file?.size || 0, lastModified: item.file?.lastModified || 0,
        type: item.detectedType || null, status: item.status || 'queued', sha256: item.hash || null
      }))
    };
    const data = loadStore(); data.recovery = snapshot; saveStore(data);
    $('#recoveryState').textContent = `Snapshot saved ${new Date(snapshot.savedAt).toLocaleTimeString('id-ID')}`;
    $('#proStatusText').textContent = `${snapshot.items.length} queue item(s) snapshotted`;
    toast('Recovery snapshot tersimpan.', 'success');
  }

  function exportRecovery() {
    const data = loadStore().recovery || { savedAt: null, items: [] };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'asset-hub-recovery.json'; link.click(); URL.revokeObjectURL(url);
    toast('Recovery JSON exported.', 'success');
  }

  function commandCenter() {
    open('Command Center', `<div class="command-grid">${[
      ['scan','⌁','Smart Scanner'],['toolbox','⌘','ID Toolbox'],['collections','▦','Collections'],['health','♥','Asset Health'],['analytics','◫','Analytics'],['compare','⇄','Version Diff'],['snippet','{ }','Studio Snippets'],['pipeline','⚡','Pipeline']
    ].map(([key, icon, label]) => `<button class="pro-tool" data-cc="${key}"><strong>${icon} ${label}</strong><span>Open ${label.toLowerCase()}.</span></button>`).join('')}</div><div class="modal-actions"><button class="secondary-btn" data-close>Close</button></div>`);
    const handlers = { scan: scanner, toolbox, collections, health, analytics, compare, snippet: snippets, pipeline: scanner };
    $('#modalBody').querySelectorAll('[data-cc]').forEach((button) => button.onclick = () => handlers[button.dataset.cc]?.());
    $('#modalBody').querySelector('[data-close]')?.addEventListener('click', close);
  }

  function bind() {
    document.querySelectorAll('[data-pro]').forEach((button) => {
      button.addEventListener('click', () => {
        const handlers = { scan: scanner, toolbox, collections, health, analytics, compare, snippet: snippets, pipeline: scanner };
        handlers[button.dataset.pro]?.();
      });
    });
    $('#commandCenterBtn')?.addEventListener('click', commandCenter);
    $('#quickScanner')?.addEventListener('click', scanner);
    $('#saveRecovery')?.addEventListener('click', saveRecovery);
    $('#exportRecovery')?.addEventListener('click', exportRecovery);
  }

  function init() {
    injectRuntimeStyle();
    injectUI();
    bind();
    const recovery = loadStore().recovery;
    if (recovery?.savedAt && $('#recoveryState')) $('#recoveryState').textContent = `Last snapshot ${new Date(recovery.savedAt).toLocaleString('id-ID')}`;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
