/* Advanced Sound Studio — custom buffer-based audio editor.
 * Trim, Volume, Speed, Pitch (detune) and a 10-band EQ, all applied live
 * during preview and baked in for real when the user hits Save.
 * Requires app.js to be loaded first (uses window.MusicLabTrack + toast()).
 */
(function () {
  const card = document.getElementById("advancedEditor");
  if (!card) return;

  const statusEl = document.getElementById("editorStatus");
  const trackNameEl = document.getElementById("editorTrackName");
  const waveWrap = document.getElementById("waveWrap");
  const waveCanvas = document.getElementById("editorWave");
  const specCanvas = document.getElementById("editorSpectrum");
  const watermarkEl = document.getElementById("waveWatermark");
  const playheadEl = document.getElementById("playhead");
  const dimLeft = document.getElementById("trimDimLeft");
  const dimRight = document.getElementById("trimDimRight");
  const handleLeft = document.getElementById("trimHandleLeft");
  const handleRight = document.getElementById("trimHandleRight");
  const waveTimeStart = document.getElementById("waveTimeStart");
  const waveTimeCursor = document.getElementById("waveTimeCursor");
  const waveTimeEnd = document.getElementById("waveTimeEnd");

  const gainEl = document.getElementById("editorGain");
  const gainVal = document.getElementById("editorGainVal");
  const speedEl = document.getElementById("editorSpeed");
  const speedVal = document.getElementById("editorSpeedVal");
  const pitchEl = document.getElementById("editorPitch");
  const pitchVal = document.getElementById("editorPitchVal");

  const fadeInChk = document.getElementById("fadeInChk");
  const fadeOutChk = document.getElementById("fadeOutChk");
  const fadeInVal = document.getElementById("editorFadeInVal");
  const fadeOutVal = document.getElementById("editorFadeOutVal");

  const playBtn = document.getElementById("editorPlay");
  const trimRangeLabel = document.getElementById("trimRangeLabel");
  const applyBtn = document.getElementById("editorApply");
  const resetBtn = document.getElementById("editorReset");

  const eqPresetsEl = document.getElementById("eqPresets");
  const eqBandsEl = document.getElementById("eqBands");

  const EQ_FREQS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  const EQ_PRESETS = {
    "Default":            [0,0,0,0,0,0,0,0,0,0],
    "Classic":            [2,1.5,1,0,-1,-1,0,1,1.5,2],
    "Dance":              [5,4,1,0,-2,-2,0,2,3,3],
    "Club":               [-1,0,2,3,3,3,2,0,0,-1],
    "Full bass":          [6,6,5,3,1,0,-1,-2,-2,-2],
    "Full bass & treble": [5,4,0,-2,-3,-2,0,3,4,5],
    "Full treble":        [-3,-3,-2,-1,0,2,4,5,6,6]
  };

  let allEnabled = [gainEl, gainVal, speedEl, speedVal, pitchEl, pitchVal,
    fadeInChk, fadeOutChk, fadeInVal, fadeOutVal, playBtn, applyBtn, resetBtn];

  // ---- Web Audio graph ----
  let audioCtx = null;
  let analyser = null;
  let gainNode = null;
  let eqFilters = [];
  let eqGains = EQ_FREQS.map(() => 0);
  let activePreset = "Default";

  // ---- Track state ----
  let originalFile = null;
  let originalBuffer = null;
  let duration = 0;
  let trimStart = 0;
  let trimEnd = 0;
  let cursorPos = 0;

  // ---- Playback state ----
  let playSource = null;
  let isPlaying = false;
  let playStartCtxTime = 0;
  let playStartOffset = 0;
  let rafPlayId = null;
  let rafSpecId = null;
  let fadeOutTimer = null;

  const say = (msg, type) => { if (typeof toast === "function") toast(msg, type); };
  const dbToGain = db => Math.pow(10, db / 20);
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = (s - m * 60).toFixed(1);
    return `${String(m).padStart(2, "0")}:${sec.padStart(4, "0")}`;
  }

  function setEnabled(enabled) {
    allEnabled.forEach(el => { if (el) el.disabled = !enabled; });
    eqBandsEl.querySelectorAll("input").forEach(el => (el.disabled = !enabled));
    eqPresetsEl.querySelectorAll("button").forEach(el => (el.disabled = !enabled));
  }

  // ---------- Tabs ----------
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("hidden", p.dataset.panel !== tab));
    });
  });

  // ---------- EQ UI ----------
  function buildEqUI() {
    eqPresetsEl.innerHTML = Object.keys(EQ_PRESETS).map(name =>
      `<button type="button" class="eq-preset-btn${name === "Default" ? " active" : ""}" data-preset="${name}" disabled>${name}</button>`
    ).join("") + `<button type="button" class="eq-preset-btn" data-preset="Custom" disabled>Custom</button>`;

    eqBandsEl.innerHTML = EQ_FREQS.map((f, i) => `
      <div class="eq-band">
        <span class="eq-band-val" id="eqVal${i}">0.0</span>
        <div class="eq-slider-wrap">
          <input type="range" class="eq-slider" id="eqSlider${i}" min="-12" max="12" step="0.1" value="0" disabled>
        </div>
        <span class="eq-band-freq">${f >= 1000 ? (f / 1000) + "k" : f}</span>
      </div>
    `).join("");

    allEnabled.push(...eqBandsEl.querySelectorAll("input"));

    EQ_FREQS.forEach((f, i) => {
      const slider = document.getElementById(`eqSlider${i}`);
      const label = document.getElementById(`eqVal${i}`);
      slider.addEventListener("input", () => {
        const v = parseFloat(slider.value);
        eqGains[i] = v;
        label.textContent = v.toFixed(1);
        markCustomPreset();
        if (isPlaying && eqFilters[i]) eqFilters[i].gain.setTargetAtTime(v, audioCtx.currentTime, 0.05);
      });
    });

    eqPresetsEl.querySelectorAll(".eq-preset-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.preset;
        if (name === "Custom") return;
        applyEqPreset(name);
      });
    });
  }

  function applyEqPreset(name) {
    const values = EQ_PRESETS[name];
    activePreset = name;
    values.forEach((v, i) => {
      eqGains[i] = v;
      const slider = document.getElementById(`eqSlider${i}`);
      const label = document.getElementById(`eqVal${i}`);
      slider.value = v;
      label.textContent = v.toFixed(1);
      if (isPlaying && eqFilters[i]) eqFilters[i].gain.setTargetAtTime(v, audioCtx.currentTime, 0.05);
    });
    eqPresetsEl.querySelectorAll(".eq-preset-btn").forEach(b => b.classList.toggle("active", b.dataset.preset === name));
  }

  function markCustomPreset() {
    if (activePreset === "Custom") return;
    activePreset = "Custom";
    eqPresetsEl.querySelectorAll(".eq-preset-btn").forEach(b => b.classList.toggle("active", b.dataset.preset === "Custom"));
  }

  buildEqUI();

  // ---------- Web Audio graph setup ----------
  function ensureContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      gainNode = audioCtx.createGain();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;

      let node = gainNode;
      eqFilters = EQ_FREQS.map((f, i) => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = f;
        filter.Q.value = 1.1;
        filter.gain.value = eqGains[i];
        node.connect(filter);
        node = filter;
        return filter;
      });
      node.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  // ---------- Canvas sizing ----------
  function sizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }

  function drawWaveform(buffer) {
    const ctx = waveCanvas.getContext("2d");
    sizeCanvas(waveCanvas);
    const w = waveCanvas.width, h = waveCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    const mid = h / 2;
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      const start = x * step;
      for (let j = 0; j < step; j++) {
        const v = data[start + j];
        if (v !== undefined) { if (v < min) min = v; if (v > max) max = v; }
      }
      const y1 = mid + min * mid * 0.92;
      const y2 = mid + max * mid * 0.92;
      const barH = Math.max(1, y2 - y1);
      const grad = ctx.createLinearGradient(0, y1, 0, y2);
      grad.addColorStop(0, "#5eead4");
      grad.addColorStop(0.5, "#22d3ee");
      grad.addColorStop(1, "#5eead4");
      ctx.fillStyle = grad;
      ctx.fillRect(x, y1, 1, barH);
    }
  }

  function drawSpectrum() {
    rafSpecId = requestAnimationFrame(drawSpectrum);
    const ctx = specCanvas.getContext("2d");
    const w = specCanvas.width, h = specCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const barCount = 56;
    const barGap = w / barCount * 0.22;
    const barWidth = w / barCount - barGap;

    let data;
    if (analyser && isPlaying) {
      data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
    }
    for (let i = 0; i < barCount; i++) {
      let v = 0.04;
      if (data) v = Math.max(0.04, data[Math.floor((i / barCount) * data.length)] / 255);
      const barH = v * h;
      const x = i * (barWidth + barGap);
      const grad = ctx.createLinearGradient(0, h, 0, h - barH);
      grad.addColorStop(0, "#8b5cf6");
      grad.addColorStop(1, "#5eead4");
      ctx.fillStyle = grad;
      ctx.fillRect(x, h - barH, barWidth, barH);
    }
  }

  sizeCanvas(specCanvas);
  rafSpecId = requestAnimationFrame(drawSpectrum);
  window.addEventListener("resize", () => {
    sizeCanvas(specCanvas);
    if (originalBuffer) { drawWaveform(originalBuffer); layoutTrimHandles(); }
  });

  // ---------- Trim handles ----------
  function layoutTrimHandles() {
    if (!duration) return;
    const leftPct = (trimStart / duration) * 100;
    const rightPct = (trimEnd / duration) * 100;
    handleLeft.style.left = `${leftPct}%`;
    handleRight.style.left = `${rightPct}%`;
    dimLeft.style.width = `${leftPct}%`;
    dimRight.style.width = `${100 - rightPct}%`;
    waveTimeStart.textContent = fmtTime(trimStart);
    waveTimeEnd.textContent = fmtTime(duration);
    trimRangeLabel.textContent = `${fmtTime(trimStart)} — ${fmtTime(trimEnd)}`;
  }

  function dragHandle(handleEl, isLeft) {
    handleEl.addEventListener("pointerdown", e => {
      if (handleEl.disabled || !duration) return;
      e.preventDefault();
      stopPlayback();
      const rectBox = waveWrap.getBoundingClientRect();
      const move = ev => {
        const frac = clamp((ev.clientX - rectBox.left) / rectBox.width, 0, 1);
        const t = frac * duration;
        if (isLeft) trimStart = clamp(t, 0, trimEnd - 0.2);
        else trimEnd = clamp(t, trimStart + 0.2, duration);
        cursorPos = trimStart;
        layoutTrimHandles();
        drawPlayhead(cursorPos);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }
  dragHandle(handleLeft, true);
  dragHandle(handleRight, false);

  function drawPlayhead(pos) {
    if (!duration) return;
    const pct = (pos / duration) * 100;
    playheadEl.style.left = `${pct}%`;
    playheadEl.classList.toggle("show", isPlaying);
    waveTimeCursor.textContent = fmtTime(pos);
  }

  // ---------- Loading a track ----------
  async function loadFile(file) {
    originalFile = file;
    originalBuffer = null;
    setEnabled(false);
    statusEl.textContent = "⏳ Decoding audio...";
    trackNameEl.textContent = `🎚 ${file.name}`;
    watermarkEl.textContent = file.name;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
      originalBuffer = await tmpCtx.decodeAudioData(arrayBuffer.slice(0));
      tmpCtx.close();
      duration = originalBuffer.duration;
      trimStart = 0; trimEnd = duration; cursorPos = 0;
      drawWaveform(originalBuffer);
      layoutTrimHandles();
      drawPlayhead(0);
      statusEl.textContent = "🎵 Audio loaded - editor ready";
      setEnabled(true);
    } catch (err) {
      console.error("Audio decode failed:", err);
      statusEl.textContent = "⚠ Format tidak bisa diedit di browser";
      setEnabled(false);
    }
  }

  document.addEventListener("musiclab:file-selected", e => loadFile(e.detail.file));
  document.addEventListener("musiclab:file-cleared", () => {
    originalFile = null; originalBuffer = null; duration = 0;
    stopPlayback();
    setEnabled(false);
    statusEl.textContent = "Waiting audio...";
    trackNameEl.textContent = "🎚 Advanced Sound Studio";
    watermarkEl.textContent = "";
    waveCanvas.getContext("2d").clearRect(0, 0, waveCanvas.width, waveCanvas.height);
  });

  // ---------- Value bindings ----------
  function bindPair(range, val, onChange) {
    const commit = () => {
      const min = parseFloat(range.min), max = parseFloat(range.max);
      let v = parseFloat(val.value);
      if (Number.isNaN(v)) v = parseFloat(range.value);
      v = clamp(v, min, max);
      range.value = v; val.value = v.toFixed(2);
      onChange(v);
    };
    range.addEventListener("input", () => { val.value = parseFloat(range.value).toFixed(2); onChange(parseFloat(range.value)); });
    val.addEventListener("change", commit);
    val.addEventListener("keydown", e => { if (e.key === "Enter") val.blur(); });
  }

  bindPair(gainEl, gainVal, v => { if (isPlaying) gainNode.gain.setTargetAtTime(dbToGain(v), audioCtx.currentTime, 0.05); });
  bindPair(speedEl, speedVal, v => { if (isPlaying && playSource) playSource.playbackRate.value = v; });
  bindPair(pitchEl, pitchVal, v => { if (isPlaying && playSource && playSource.detune) playSource.detune.setTargetAtTime(v * 100, audioCtx.currentTime, 0.02); });

  // ---------- Playback engine ----------
  function stopPlayback() {
    if (playSource) {
      try { playSource.onended = null; playSource.stop(); } catch (e) {}
      try { playSource.disconnect(); } catch (e) {}
      playSource = null;
    }
    if (fadeOutTimer) { clearTimeout(fadeOutTimer); fadeOutTimer = null; }
    cancelAnimationFrame(rafPlayId);
    isPlaying = false;
    playheadEl.classList.remove("show");
    playBtn.textContent = "▶";
  }

  function tickPlayhead() {
    if (!isPlaying) return;
    const speed = parseFloat(speedEl.value) || 1;
    const pos = playStartOffset + (audioCtx.currentTime - playStartCtxTime) * speed;
    if (pos >= trimEnd) {
      cursorPos = trimStart;
      stopPlayback();
      drawPlayhead(cursorPos);
      return;
    }
    drawPlayhead(pos);
    rafPlayId = requestAnimationFrame(tickPlayhead);
  }

  function startPlayback(fromPos) {
    if (!originalBuffer) { say("Pilih file audio dulu.", "error"); return; }
    ensureContext();
    stopPlayback();

    const speed = parseFloat(speedEl.value) || 1;
    const offset = clamp(fromPos, trimStart, trimEnd - 0.05);
    const bufDur = trimEnd - offset;
    const realDur = bufDur / speed;

    playSource = audioCtx.createBufferSource();
    playSource.buffer = originalBuffer;
    playSource.playbackRate.value = speed;
    if (playSource.detune) playSource.detune.value = (parseFloat(pitchEl.value) || 0) * 100;
    playSource.connect(gainNode);

    const now = audioCtx.currentTime;
    const base = dbToGain(parseFloat(gainEl.value) || 0);
    gainNode.gain.cancelScheduledValues(now);
    const doFadeIn = fadeInChk.checked && offset <= trimStart + 0.05;
    const fadeInSec = parseFloat(fadeInVal.value) || 0;
    if (doFadeIn && fadeInSec > 0) {
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(base, now + Math.min(fadeInSec, realDur));
    } else {
      gainNode.gain.setValueAtTime(base, now);
    }
    if (fadeOutTimer) clearTimeout(fadeOutTimer);
    const fadeOutSec = parseFloat(fadeOutVal.value) || 0;
    if (fadeOutChk.checked && fadeOutSec > 0) {
      const delayMs = Math.max(0, (realDur - fadeOutSec)) * 1000;
      fadeOutTimer = setTimeout(() => {
        const t = audioCtx.currentTime;
        gainNode.gain.cancelScheduledValues(t);
        gainNode.gain.setValueAtTime(gainNode.gain.value, t);
        gainNode.gain.linearRampToValueAtTime(0.0001, t + Math.min(fadeOutSec, realDur));
      }, delayMs);
    }

    playSource.start(0, offset, bufDur);
    playStartCtxTime = now;
    playStartOffset = offset;
    isPlaying = true;
    playBtn.textContent = "⏸";
    playSource.onended = () => {
      if (isPlaying) { cursorPos = trimStart; stopPlayback(); drawPlayhead(cursorPos); }
    };
    tickPlayhead();
  }

  playBtn.addEventListener("click", () => {
    if (isPlaying) {
      const speed = parseFloat(speedEl.value) || 1;
      cursorPos = clamp(playStartOffset + (audioCtx.currentTime - playStartCtxTime) * speed, trimStart, trimEnd);
      stopPlayback();
      drawPlayhead(cursorPos);
    } else {
      startPlayback(cursorPos < trimStart || cursorPos >= trimEnd ? trimStart : cursorPos);
    }
  });

  // Clicking the waveform seeks (and keeps trim range as-is).
  waveWrap.addEventListener("pointerdown", e => {
    if (!duration || e.target === handleLeft || e.target === handleRight) return;
    const rectBox = waveWrap.getBoundingClientRect();
    const frac = clamp((e.clientX - rectBox.left) / rectBox.width, 0, 1);
    cursorPos = clamp(frac * duration, trimStart, trimEnd);
    drawPlayhead(cursorPos);
    if (isPlaying) startPlayback(cursorPos);
  });

  // ---------- Save (bake edits into a new file for upload) ----------
  function floatTo16BitPCM(float32Array) {
    const out = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = clamp(float32Array[i], -1, 1);
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function bufferToMp3(buffer, kbps = 192) {
    if (typeof lamejs === "undefined") return null;
    const numCh = Math.min(2, buffer.numberOfChannels);
    const sampleRate = buffer.sampleRate;
    const encoder = new lamejs.Mp3Encoder(numCh, sampleRate, kbps);
    const left = floatTo16BitPCM(buffer.getChannelData(0));
    const right = numCh > 1 ? floatTo16BitPCM(buffer.getChannelData(1)) : null;
    const blockSize = 1152;
    const chunks = [];
    for (let i = 0; i < left.length; i += blockSize) {
      const leftChunk = left.subarray(i, i + blockSize);
      const buf = right
        ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + blockSize))
        : encoder.encodeBuffer(leftChunk);
      if (buf.length > 0) chunks.push(new Int8Array(buf));
    }
    const end = encoder.flush();
    if (end.length > 0) chunks.push(new Int8Array(end));
    return new Blob(chunks, { type: "audio/mpeg" });
  }

  function bufferToWav(buffer) {
    const numCh = buffer.numberOfChannels, sampleRate = buffer.sampleRate, frames = buffer.length;
    const dataSize = frames * numCh * 2;
    const out = new ArrayBuffer(44 + dataSize);
    const view = new DataView(out);
    let offset = 0;
    const writeStr = s => { for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i)); };
    const write32 = v => { view.setUint32(offset, v, true); offset += 4; };
    const write16 = v => { view.setUint16(offset, v, true); offset += 2; };
    writeStr("RIFF"); write32(36 + dataSize); writeStr("WAVE");
    writeStr("fmt "); write32(16); write16(1); write16(numCh);
    write32(sampleRate); write32(sampleRate * numCh * 2); write16(numCh * 2); write16(16);
    writeStr("data"); write32(dataSize);
    const channels = [];
    for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = clamp(channels[c][i], -1, 1);
        s = s < 0 ? s * 0x8000 : s * 0x7fff;
        view.setInt16(offset, s, true); offset += 2;
      }
    }
    return new Blob([out], { type: "audio/wav" });
  }

  async function renderEdited() {
    const speed = clamp(parseFloat(speedEl.value) || 1, 0.5, 2);
    const trimmedLen = Math.max(1, Math.round((trimEnd - trimStart) * originalBuffer.sampleRate));
    const outLength = Math.max(1, Math.round(trimmedLen / speed));
    const offlineCtx = new OfflineAudioContext(originalBuffer.numberOfChannels, outLength, originalBuffer.sampleRate);

    const src = offlineCtx.createBufferSource();
    src.buffer = originalBuffer;
    src.playbackRate.value = speed;
    if (src.detune) src.detune.value = (parseFloat(pitchEl.value) || 0) * 100;

    const gain = offlineCtx.createGain();
    const duration_ = outLength / originalBuffer.sampleRate;
    const base = dbToGain(parseFloat(gainEl.value) || 0);
    const fadeIn = fadeInChk.checked ? (parseFloat(fadeInVal.value) || 0) : 0;
    const fadeOut = fadeOutChk.checked ? (parseFloat(fadeOutVal.value) || 0) : 0;
    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0.0001, 0);
      gain.gain.linearRampToValueAtTime(base, Math.min(fadeIn, duration_));
    } else {
      gain.gain.setValueAtTime(base, 0);
    }
    if (fadeOut > 0) {
      const start = Math.max(0, duration_ - fadeOut);
      gain.gain.setValueAtTime(base, start);
      gain.gain.linearRampToValueAtTime(0.0001, duration_);
    }

    let node = gain;
    const filters = EQ_FREQS.map((f, i) => {
      const filter = offlineCtx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = f;
      filter.Q.value = 1.1;
      filter.gain.value = eqGains[i];
      return filter;
    });
    src.connect(gain);
    filters.forEach(f => { node.connect(f); node = f; });
    node.connect(offlineCtx.destination);

    src.start(0, trimStart, trimEnd - trimStart);
    return offlineCtx.startRendering();
  }

  function hasAnyEdit() {
    const gainDb = parseFloat(gainEl.value) || 0;
    const speed = parseFloat(speedEl.value) || 1;
    const pitch = parseFloat(pitchEl.value) || 0;
    const trimmed = trimStart > 0.01 || trimEnd < duration - 0.01;
    const eqTouched = eqGains.some(v => Math.abs(v) > 0.01);
    const fades = (fadeInChk.checked && parseFloat(fadeInVal.value) > 0) || (fadeOutChk.checked && parseFloat(fadeOutVal.value) > 0);
    return Boolean(gainDb || speed !== 1 || pitch || trimmed || eqTouched || fades);
  }

  applyBtn.addEventListener("click", async () => {
    if (!originalBuffer) { say("Pilih file audio dulu.", "error"); return; }
    if (!hasAnyEdit()) { say("Belum ada perubahan buat disimpan.", "error"); return; }
    stopPlayback();
    const prevLabel = applyBtn.textContent;
    applyBtn.disabled = true;
    applyBtn.textContent = "⏳ Processing...";
    try {
      const rendered = await renderEdited();
      const baseName = (originalFile.name || "track").replace(/\.[^/.]+$/, "");
      let blob = bufferToMp3(rendered, 192);
      let outName = `${baseName}-edited.mp3`;
      if (!blob) {
        blob = bufferToWav(rendered);
        outName = `${baseName}-edited.wav`;
        say("MP3 encoder gak bisa dimuat, pakai WAV (ukuran lebih besar).", "error");
      }
      const editedFile = new File([blob], outName, { type: blob.type });
      window.MusicLabTrack.set(editedFile);
      statusEl.textContent = "✅ Edited - ready to upload";
      applyBtn.textContent = "✓ Saved";
      say("Audio berhasil diedit ✓", "success");
    } catch (err) {
      console.error("Save edit failed:", err);
      statusEl.textContent = "⚠ Gagal memproses edit";
      say("Gagal memproses audio.", "error");
    } finally {
      setTimeout(() => { applyBtn.textContent = prevLabel; applyBtn.disabled = false; }, 1400);
    }
  });

  resetBtn.addEventListener("click", () => {
    stopPlayback();
    gainEl.value = 0; gainVal.value = "0.00";
    speedEl.value = 1; speedVal.value = "1.00";
    pitchEl.value = 0; pitchVal.value = "0";
    fadeInChk.checked = false; fadeOutChk.checked = false;
    fadeInVal.value = 3; fadeOutVal.value = 3;
    applyEqPreset("Default");
    if (originalBuffer) {
      trimStart = 0; trimEnd = duration; cursorPos = 0;
      layoutTrimHandles();
      drawPlayhead(0);
    }
    if (audioCtx && gainNode) gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
    if (originalFile) {
      window.MusicLabTrack.set(originalFile);
      statusEl.textContent = "🎵 Audio loaded - editor ready (reset)";
    }
  });
})();
