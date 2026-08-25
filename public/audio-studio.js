/* Advanced Sound Studio — real Web Audio powered editor + spectrum analyzer.
 * Wired to the #advancedEditor card in index.html. Requires app.js to be
 * loaded first (uses window.MusicLabTrack + the global `toast` helper).
 */
(function () {
  const card = document.getElementById("advancedEditor");
  const audioEl = document.getElementById("audio");
  if (!card || !audioEl) return;

  const statusEl = document.getElementById("editorStatus");
  const gainEl = document.getElementById("editorGain");
  const fadeInEl = document.getElementById("editorFadeIn");
  const fadeOutEl = document.getElementById("editorFadeOut");
  const speedEl = document.getElementById("editorSpeed");
  const gainVal = document.getElementById("editorGainVal");
  const fadeInVal = document.getElementById("editorFadeInVal");
  const fadeOutVal = document.getElementById("editorFadeOutVal");
  const speedVal = document.getElementById("editorSpeedVal");
  const previewBtn = document.getElementById("editorPreview");
  const applyBtn = document.getElementById("editorApply");
  const resetBtn = document.getElementById("editorReset");
  const waveCanvas = document.getElementById("editorWave");
  const specCanvas = document.getElementById("editorSpectrum");

  const controls = [gainEl, fadeInEl, fadeOutEl, speedEl];

  let audioCtx = null;
  let analyser = null;
  let gainNode = null;
  let sourceNode = null;
  let originalFile = null;
  let originalBuffer = null;
  let isPreviewing = false;
  let fadeOutTimer = null;
  let rafId = null;

  const say = (msg, type) => { if (typeof toast === "function") toast(msg, type); };
  const dbToGain = db => Math.pow(10, db / 20);

  function setControlsEnabled(enabled) {
    controls.forEach(el => (el.disabled = !enabled));
    previewBtn.disabled = !enabled;
    applyBtn.disabled = !enabled;
    resetBtn.disabled = !enabled;
  }

  function updateBubbles() {
    gainVal.textContent = `${gainEl.value} dB`;
    fadeInVal.textContent = `${parseFloat(fadeInEl.value).toFixed(1)}s`;
    fadeOutVal.textContent = `${parseFloat(fadeOutEl.value).toFixed(1)}s`;
    speedVal.textContent = `${parseFloat(speedEl.value).toFixed(1)}x`;
  }
  updateBubbles();

  function ensureContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioCtx.createMediaElementSource(audioEl);
      gainNode = audioCtx.createGain();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;
      sourceNode.connect(gainNode);
      gainNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  // ---------- Waveform (static preview of the loaded track) ----------
  function sizeCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    return dpr;
  }

  function drawWaveform(buffer) {
    const ctx = waveCanvas.getContext("2d");
    sizeCanvas(waveCanvas);
    const w = waveCanvas.width, h = waveCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / w));
    const mid = h / 2;
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#8b5cf6");
    grad.addColorStop(1, "#22d3ee");
    ctx.fillStyle = grad;
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      const start = x * step;
      for (let j = 0; j < step; j++) {
        const v = data[start + j];
        if (v !== undefined) { if (v < min) min = v; if (v > max) max = v; }
      }
      const y1 = mid + min * mid;
      const y2 = mid + max * mid;
      ctx.fillRect(x, Math.min(y1, y2), 1, Math.max(1, Math.abs(y2 - y1)));
    }
  }

  // ---------- Live spectrum bars ----------
  function drawSpectrum() {
    rafId = requestAnimationFrame(drawSpectrum);
    const ctx = specCanvas.getContext("2d");
    const w = specCanvas.width, h = specCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const barCount = 40;
    const barGap = w / barCount * 0.25;
    const barWidth = w / barCount - barGap;

    let data;
    if (analyser && isPreviewing) {
      data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
    }

    for (let i = 0; i < barCount; i++) {
      let v = 0.03; // idle floor so the bars are always visible, not blank
      if (data) {
        const idx = Math.floor((i / barCount) * data.length);
        v = Math.max(0.03, data[idx] / 255);
      }
      const barH = v * h;
      const x = i * (barWidth + barGap);
      const grad = ctx.createLinearGradient(0, h, 0, h - barH);
      grad.addColorStop(0, "#8b5cf6");
      grad.addColorStop(1, "#22d3ee");
      ctx.fillStyle = grad;
      const r = Math.min(3, barWidth / 2);
      roundRect(ctx, x, h - barH, barWidth, barH, r);
      ctx.fill();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (h <= 0 || w <= 0) return;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  sizeCanvas(specCanvas);
  rafId = requestAnimationFrame(drawSpectrum);
  window.addEventListener("resize", () => {
    sizeCanvas(specCanvas);
    if (originalBuffer) drawWaveform(originalBuffer);
  });

  // ---------- Loading a track for editing ----------
  async function loadFile(file) {
    originalFile = file;
    originalBuffer = null;
    setControlsEnabled(false);
    statusEl.textContent = "⏳ Decoding audio...";
    try {
      const arrayBuffer = await file.arrayBuffer();
      const tmpCtx = new (window.AudioContext || window.webkitAudioContext)();
      originalBuffer = await tmpCtx.decodeAudioData(arrayBuffer.slice(0));
      tmpCtx.close();
      drawWaveform(originalBuffer);
      statusEl.textContent = "🎵 Audio loaded - editor ready";
      setControlsEnabled(true);
    } catch (err) {
      console.error("Audio decode failed:", err);
      statusEl.textContent = "⚠ Format tidak bisa diedit di browser";
      setControlsEnabled(false);
    }
  }

  document.addEventListener("musiclab:file-selected", e => loadFile(e.detail.file));
  document.addEventListener("musiclab:file-cleared", () => {
    originalFile = null;
    originalBuffer = null;
    stopPreview();
    setControlsEnabled(false);
    statusEl.textContent = "Waiting audio...";
    const wctx = waveCanvas.getContext("2d");
    wctx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
  });

  // ---------- Live preview (plays the actual <audio> element through the graph) ----------
  function clearFadeOutTimer() {
    if (fadeOutTimer) { clearInterval(fadeOutTimer); fadeOutTimer = null; }
  }

  function armFades() {
    const fadeIn = parseFloat(fadeInEl.value) || 0;
    const fadeOut = parseFloat(fadeOutEl.value) || 0;
    const base = dbToGain(parseFloat(gainEl.value) || 0);
    const now = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    if (fadeIn > 0) {
      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(base, now + fadeIn);
    } else {
      gainNode.gain.setValueAtTime(base, now);
    }
    clearFadeOutTimer();
    if (fadeOut > 0) {
      fadeOutTimer = setInterval(() => {
        if (!audioEl.duration || audioEl.paused) return;
        const rate = audioEl.playbackRate || 1;
        const remaining = (audioEl.duration - audioEl.currentTime) / rate;
        if (remaining <= fadeOut) {
          const t = audioCtx.currentTime;
          gainNode.gain.cancelScheduledValues(t);
          gainNode.gain.setValueAtTime(gainNode.gain.value, t);
          gainNode.gain.linearRampToValueAtTime(0.0001, t + Math.max(0.02, remaining));
          clearFadeOutTimer();
        }
      }, 100);
    }
  }

  function applyLiveGain() {
    if (!audioCtx || !gainNode) return;
    // Only nudge gain live when we're not mid fade-in/out ramp for the base level.
    const base = dbToGain(parseFloat(gainEl.value) || 0);
    gainNode.gain.setTargetAtTime(base, audioCtx.currentTime, 0.05);
  }

  controls.forEach(el => el.addEventListener("input", () => {
    updateBubbles();
    if (isPreviewing) {
      if (el === speedEl) audioEl.playbackRate = parseFloat(speedEl.value) || 1;
      else applyLiveGain();
    }
  }));

  function startPreview() {
    if (!originalFile) { say("Pilih file audio dulu.", "error"); return; }
    ensureContext();
    audioEl.playbackRate = parseFloat(speedEl.value) || 1;
    armFades();
    audioEl.currentTime = 0;
    audioEl.play();
  }

  function stopPreview() {
    clearFadeOutTimer();
    if (!audioEl.paused) audioEl.pause();
  }

  previewBtn.addEventListener("click", () => {
    if (isPreviewing) stopPreview();
    else startPreview();
  });

  audioEl.addEventListener("play", () => {
    isPreviewing = true;
    previewBtn.textContent = "⏸ Stop Preview";
  });
  audioEl.addEventListener("pause", () => {
    isPreviewing = false;
    previewBtn.textContent = "▶ Preview";
    clearFadeOutTimer();
  });
  audioEl.addEventListener("ended", () => {
    isPreviewing = false;
    previewBtn.textContent = "▶ Preview";
    clearFadeOutTimer();
  });

  // ---------- Apply edit: render offline and bake a new file for upload ----------
  // Exported as MP3 (compressed) so long tracks don't blow past the server's
  // upload size limit the way an uncompressed WAV would. Falls back to WAV
  // only if the MP3 encoder library failed to load (e.g. offline/blocked CDN).
  function floatTo16BitPCM(float32Array) {
    const out = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
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
    const numCh = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const frames = buffer.length;
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
        let s = Math.max(-1, Math.min(1, channels[c][i]));
        s = s < 0 ? s * 0x8000 : s * 0x7fff;
        view.setInt16(offset, s, true);
        offset += 2;
      }
    }
    return new Blob([out], { type: "audio/wav" });
  }

  async function renderEdited(buffer, opts) {
    const speed = Math.max(0.5, Math.min(2, opts.speed));
    const outLength = Math.max(1, Math.round(buffer.length / speed));
    const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, outLength, buffer.sampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = speed;
    const gain = offlineCtx.createGain();
    const duration = outLength / buffer.sampleRate;
    const base = dbToGain(opts.gainDb);
    if (opts.fadeIn > 0) {
      gain.gain.setValueAtTime(0.0001, 0);
      gain.gain.linearRampToValueAtTime(base, Math.min(opts.fadeIn, duration));
    } else {
      gain.gain.setValueAtTime(base, 0);
    }
    if (opts.fadeOut > 0) {
      const start = Math.max(0, duration - opts.fadeOut);
      gain.gain.setValueAtTime(base, start);
      gain.gain.linearRampToValueAtTime(0.0001, duration);
    }
    src.connect(gain);
    gain.connect(offlineCtx.destination);
    src.start(0);
    return offlineCtx.startRendering();
  }

  applyBtn.addEventListener("click", async () => {
    if (!originalBuffer) { say("Pilih file audio dulu.", "error"); return; }
    const opts = {
      gainDb: parseFloat(gainEl.value) || 0,
      fadeIn: parseFloat(fadeInEl.value) || 0,
      fadeOut: parseFloat(fadeOutEl.value) || 0,
      speed: parseFloat(speedEl.value) || 1
    };
    if (!opts.gainDb && !opts.fadeIn && !opts.fadeOut && opts.speed === 1) {
      say("Geser slider dulu sebelum apply.", "error");
      return;
    }
    stopPreview();
    const prevLabel = applyBtn.textContent;
    applyBtn.disabled = true;
    applyBtn.textContent = "⏳ Processing...";
    try {
      const rendered = await renderEdited(originalBuffer, opts);
      const baseName = (originalFile.name || "track").replace(/\.[^/.]+$/, "");

      let blob = bufferToMp3(rendered, 192);
      let outName = `${baseName}-edited.mp3`;
      if (!blob) {
        // MP3 encoder unavailable (e.g. CDN blocked) — fall back to WAV,
        // but warn since it can be much larger and may hit the upload limit.
        blob = bufferToWav(rendered);
        outName = `${baseName}-edited.wav`;
        say("MP3 encoder gak bisa dimuat, pakai WAV (ukuran lebih besar).", "error");
      }

      const editedFile = new File([blob], outName, { type: blob.type });
      window.MusicLabTrack.set(editedFile);
      statusEl.textContent = "✅ Edited - ready to upload";
      applyBtn.textContent = "✓ Applied";
      say("Audio berhasil diedit ✓", "success");
    } catch (err) {
      console.error("Apply edit failed:", err);
      statusEl.textContent = "⚠ Gagal memproses edit";
      say("Gagal memproses audio.", "error");
    } finally {
      setTimeout(() => { applyBtn.textContent = prevLabel; applyBtn.disabled = false; }, 1400);
    }
  });

  resetBtn.addEventListener("click", () => {
    gainEl.value = 0; fadeInEl.value = 0; fadeOutEl.value = 0; speedEl.value = 1;
    updateBubbles();
    audioEl.playbackRate = 1;
    stopPreview();
    if (audioCtx && gainNode) gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
    if (originalFile) {
      window.MusicLabTrack.set(originalFile);
      statusEl.textContent = "🎵 Audio loaded - editor ready (reset)";
    }
  });
})();
