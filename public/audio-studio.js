/* RobloxMID Advanced Sound Studio — lean, event-driven editor. */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const card = $("advancedEditor");
  if (!card) return;

  const statusEl = $("editorStatus");
  const trackNameEl = $("editorTrackName");
  const waveWrap = $("waveWrap");
  const waveCanvas = $("editorWave");
  const specCanvas = $("editorSpectrum");
  const watermark = $("waveWatermark");
  const playhead = $("playhead");
  const dimLeft = $("trimDimLeft");
  const dimRight = $("trimDimRight");
  const handleLeft = $("trimHandleLeft");
  const handleRight = $("trimHandleRight");
  const timeStart = $("waveTimeStart");
  const timeCursor = $("waveTimeCursor");
  const timeEnd = $("waveTimeEnd");
  const playBtn = $("editorPlay");
  const applyBtn = $("editorApply");
  const resetBtn = $("editorReset");
  const trimLabel = $("trimRangeLabel");

  const controls = {
    gain: $("editorGain"), gainVal: $("editorGainVal"),
    speed: $("editorSpeed"), speedVal: $("editorSpeedVal"),
    pitch: $("editorPitch"), pitchVal: $("editorPitchVal"),
    reverb: $("editorReverb"), reverbVal: $("editorReverbVal"),
    room: $("editorRoom"), roomVal: $("editorRoomVal"),
    stereo: $("editorStereo"), stereoVal: $("editorStereoVal"),
    fadeIn: $("fadeInChk"), fadeInVal: $("editorFadeInVal"),
    fadeOut: $("fadeOutChk"), fadeOutVal: $("editorFadeOutVal")
  };
  const eqPresets = $("eqPresets");
  const eqBands = $("eqBands");

  const EQ_FREQS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  const PRESETS = {
    Default: [0,0,0,0,0,0,0,0,0,0],
    Classic: [2,1.5,1,0,-1,-1,0,1,1.5,2],
    Dance: [5,4,1,0,-2,-2,0,2,3,3],
    Club: [-1,0,2,3,3,3,2,0,0,-1],
    "Full bass": [6,6,5,3,1,0,-1,-2,-2,-2],
    "Full bass & treble": [5,4,0,-2,-3,-2,0,3,4,5],
    "Full treble": [-3,-3,-2,-1,0,2,4,5,6,6]
  };

  let audioCtx = null;
  let analyser = null;
  let previewGain = null;
  let previewFilters = [];
  let previewPanner = null;
  let previewWet = null;
  let previewDry = null;
  let previewReverb = null;
  let spectrumRaf = 0;

  let file = null;
  let buffer = null;
  let duration = 0;
  let trimStart = 0;
  let trimEnd = 0;
  let cursor = 0;
  let playing = false;
  let source = null;
  let playStartedAt = 0;
  let playOffset = 0;
  let peaks = null;
  let eqValues = [...PRESETS.Default];
  let preset = "Default";

  const enabledWhenReady = [
    controls.gain, controls.gainVal, controls.speed, controls.speedVal,
    controls.pitch, controls.pitchVal, controls.reverb, controls.reverbVal,
    controls.room, controls.roomVal, controls.stereo, controls.stereoVal,
    controls.fadeIn, controls.fadeInVal, controls.fadeOut, controls.fadeOutVal,
    playBtn, applyBtn, resetBtn
  ];

  const notify = (msg, type) => {
    if (typeof toast === "function") toast(msg, type);
  };
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const dbGain = db => Math.pow(10, db / 20);
  const fmt = seconds => {
    seconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const m = Math.floor(seconds / 60);
    return `${String(m).padStart(2, "0")}:${(seconds - m * 60).toFixed(1).padStart(4, "0")}`;
  };
  const setReady = ready => {
    enabledWhenReady.forEach(el => { if (el) el.disabled = !ready; });
    eqBands?.querySelectorAll("input").forEach(el => { el.disabled = !ready; });
    eqPresets?.querySelectorAll("button").forEach(el => { el.disabled = !ready; });
  };

  function sizeCanvas(canvas) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }

  function buildPeaks(audioBuffer, bins = 1400) {
    const data = audioBuffer.getChannelData(0);
    const out = new Float32Array(Math.min(bins, Math.max(1, Math.floor(data.length / 64))));
    const stride = data.length / out.length;
    for (let i = 0; i < out.length; i++) {
      const start = Math.floor(i * stride);
      const end = Math.min(data.length, Math.floor((i + 1) * stride));
      let peak = 0;
      for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(data[j]));
      out[i] = peak;
    }
    return out;
  }

  function drawWaveform() {
    if (!waveCanvas || !buffer) return;
    sizeCanvas(waveCanvas);
    const ctx = waveCanvas.getContext("2d");
    const w = waveCanvas.width;
    const h = waveCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const mid = h / 2;
    const count = peaks?.length || 1;
    ctx.fillStyle = "#22d3ee";
    for (let x = 0; x < w; x++) {
      const p = peaks[Math.min(count - 1, Math.floor(x / w * count))] || 0;
      const bar = Math.max(1, p * mid * 0.9);
      ctx.fillRect(x, mid - bar, 1, bar * 2);
    }
    ctx.fillStyle = "#ffffff12";
    ctx.fillRect(0, mid - 0.5, w, 1);
  }

  function drawTrim() {
    if (!duration) return;
    const left = trimStart / duration * 100;
    const right = trimEnd / duration * 100;
    handleLeft.style.left = `${left}%`;
    handleRight.style.left = `${right}%`;
    dimLeft.style.width = `${left}%`;
    dimRight.style.width = `${100 - right}%`;
    timeStart.textContent = fmt(trimStart);
    timeEnd.textContent = fmt(trimEnd);
    trimLabel.textContent = `${fmt(trimStart)} — ${fmt(trimEnd)}`;
    drawCursor(cursor);
  }

  function drawCursor(position) {
    if (!duration) return;
    playhead.style.left = `${clamp(position / duration * 100, 0, 100)}%`;
    playhead.classList.toggle("show", playing);
    timeCursor.textContent = fmt(position);
  }

  function buildEqUi() {
    if (!eqPresets || !eqBands) return;
    eqPresets.innerHTML = Object.keys(PRESETS)
      .map(name => `<button type="button" class="eq-preset-btn${name === "Default" ? " active" : ""}" data-preset="${name}" disabled>${name}</button>`)
      .join("") + `<button type="button" class="eq-preset-btn" data-preset="Custom" disabled>Custom</button>`;
    eqBands.innerHTML = EQ_FREQS.map((freq, index) => `
      <div class="eq-band">
        <span class="eq-band-val" id="eqVal${index}">0.0</span>
        <div class="eq-slider-wrap"><input id="eqSlider${index}" class="eq-slider" type="range" min="-12" max="12" step="0.1" value="0" disabled></div>
        <span class="eq-band-freq">${freq >= 1000 ? `${freq / 1000}k` : freq}</span>
      </div>`).join("");
    EQ_FREQS.forEach((_, index) => {
      const slider = $(`eqSlider${index}`);
      const label = $(`eqVal${index}`);
      slider.addEventListener("input", () => {
        eqValues[index] = Number(slider.value);
        label.textContent = Number(slider.value).toFixed(1);
        preset = "Custom";
        eqPresets.querySelectorAll("button").forEach(btn => btn.classList.toggle("active", btn.dataset.preset === "Custom"));
        updatePreviewGraph();
      });
    });
    eqPresets.querySelectorAll("button").forEach(btn => btn.addEventListener("click", () => {
      if (btn.dataset.preset !== "Custom") applyPreset(btn.dataset.preset);
    }));
  }

  function applyPreset(name) {
    const values = PRESETS[name];
    if (!values) return;
    preset = name;
    eqValues = [...values];
    EQ_FREQS.forEach((_, i) => {
      const slider = $(`eqSlider${i}`);
      const label = $(`eqVal${i}`);
      slider.value = values[i];
      label.textContent = Number(values[i]).toFixed(1);
    });
    eqPresets.querySelectorAll("button").forEach(btn => btn.classList.toggle("active", btn.dataset.preset === name));
    updatePreviewGraph();
  }

  function buildImpulse(ctx) {
    const room = clamp(Number(controls.room?.value || 50), 0, 100) / 100;
    const seconds = 0.35 + room * 1.65;
    const decay = 1.2 + room * 4;
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return ir;
  }

  function ensureAudioGraph() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      previewGain = audioCtx.createGain();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      let node = previewGain;
      previewFilters = EQ_FREQS.map((freq, i) => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = "peaking";
        filter.frequency.value = freq;
        filter.Q.value = 1.05;
        filter.gain.value = eqValues[i];
        node.connect(filter);
        node = filter;
        return filter;
      });
      previewDry = audioCtx.createGain();
      previewWet = audioCtx.createGain();
      previewReverb = audioCtx.createConvolver();
      previewDry.gain.value = 1;
      previewWet.gain.value = 0;
      previewReverb.buffer = buildImpulse(audioCtx);
      node.connect(previewDry);
      node.connect(previewReverb);
      previewReverb.connect(previewWet);
      previewPanner = audioCtx.createStereoPanner();
      previewDry.connect(previewPanner);
      previewWet.connect(previewPanner);
      previewPanner.connect(analyser);
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  }

  function updatePreviewGraph() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    previewGain?.gain.setTargetAtTime(dbGain(Number(controls.gain?.value || 0)), now, 0.04);
    previewFilters.forEach((filter, i) => filter.gain.setTargetAtTime(eqValues[i], now, 0.04));
    previewWet?.gain.setTargetAtTime(Number(controls.reverb?.value || 0) / 100, now, 0.04);
    previewDry?.gain.setTargetAtTime(1 - Number(controls.reverb?.value || 0) / 100, now, 0.04);
    previewPanner?.pan.setTargetAtTime(Number(controls.stereo?.value || 0) / 100, now, 0.04);
  }

  function drawSpectrum() {
    if (!specCanvas) return;
    sizeCanvas(specCanvas);
    const ctx = specCanvas.getContext("2d");
    ctx.clearRect(0, 0, specCanvas.width, specCanvas.height);
    const w = specCanvas.width;
    const h = specCanvas.height;
    if (!playing || !analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const bars = 48;
    const gap = w / bars * 0.2;
    const bw = w / bars - gap;
    for (let i = 0; i < bars; i++) {
      const v = Math.max(0.04, (data[Math.floor(i / bars * data.length)] || 0) / 255);
      const bh = v * h;
      const x = i * (bw + gap);
      const grad = ctx.createLinearGradient(0, h, 0, h - bh);
      grad.addColorStop(0, "#8b5cf6");
      grad.addColorStop(1, "#5eead4");
      ctx.fillStyle = grad;
      ctx.fillRect(x, h - bh, bw, bh);
    }
  }

  function startSpectrumLoop() {
    cancelAnimationFrame(spectrumRaf);
    const frame = () => {
      if (!playing) { drawSpectrum(); spectrumRaf = 0; return; }
      drawSpectrum();
      spectrumRaf = requestAnimationFrame(frame);
    };
    spectrumRaf = requestAnimationFrame(frame);
  }

  function stopPlayback() {
    if (source) {
      try { source.onended = null; source.stop(); } catch {}
      try { source.disconnect(); } catch {}
      source = null;
    }
    playing = false;
    cancelAnimationFrame(spectrumRaf);
    spectrumRaf = 0;
    playBtn.textContent = "▶";
    playhead.classList.remove("show");
    drawSpectrum();
  }

  function startPlayback(position = trimStart) {
    if (!buffer) return notify("Pilih file audio dulu.", "error");
    ensureAudioGraph();
    stopPlayback();
    updatePreviewGraph();
    const speed = clamp(Number(controls.speed?.value || 1), 0.5, 2);
    const offset = clamp(position, trimStart, Math.max(trimStart, trimEnd - 0.03));
    const length = Math.max(0.02, trimEnd - offset);
    source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = speed;
    source.detune.value = Number(controls.pitch?.value || 0) * 100;
    source.connect(previewGain);
    const now = audioCtx.currentTime;
    const base = dbGain(Number(controls.gain?.value || 0));
    previewGain.gain.cancelScheduledValues(now);
    previewGain.gain.setValueAtTime(base, now);
    if (controls.fadeIn.checked && offset <= trimStart + 0.05) {
      const fade = clamp(Number(controls.fadeInVal.value || 0), 0, 30);
      previewGain.gain.setValueAtTime(0.0001, now);
      previewGain.gain.linearRampToValueAtTime(base, now + Math.min(fade, length / speed));
    }
    source.start(0, offset, length);
    playStartedAt = now;
    playOffset = offset;
    playing = true;
    playBtn.textContent = "⏸";
    source.onended = () => {
      if (!playing) return;
      cursor = trimStart;
      stopPlayback();
      drawCursor(cursor);
    };
    startSpectrumLoop();
  }

  function tickCursor() {
    if (!playing || !audioCtx) return;
    const speed = Number(controls.speed?.value || 1);
    cursor = playOffset + (audioCtx.currentTime - playStartedAt) * speed;
    if (cursor >= trimEnd) {
      stopPlayback();
      cursor = trimStart;
      drawCursor(cursor);
      return;
    }
    drawCursor(cursor);
    requestAnimationFrame(tickCursor);
  }

  function dragHandle(handle, leftSide) {
    handle.addEventListener("pointerdown", event => {
      if (!duration) return;
      event.preventDefault();
      stopPlayback();
      const rect = waveWrap.getBoundingClientRect();
      const move = e => {
        const t = clamp((e.clientX - rect.left) / rect.width, 0, 1) * duration;
        if (leftSide) trimStart = clamp(t, 0, Math.max(0, trimEnd - 0.1));
        else trimEnd = clamp(t, Math.min(duration, trimStart + 0.1), duration);
        cursor = trimStart;
        drawTrim();
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    });
  }

  async function loadFile(nextFile) {
    stopPlayback();
    file = nextFile;
    buffer = null;
    peaks = null;
    duration = 0;
    setReady(false);
    statusEl.textContent = "⏳ Decoding audio...";
    trackNameEl.textContent = `🎚 ${file.name}`;
    watermark.textContent = file.name;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const data = await file.arrayBuffer();
      buffer = await ctx.decodeAudioData(data.slice(0));
      await ctx.close();
      duration = buffer.duration;
      trimStart = 0;
      trimEnd = duration;
      cursor = 0;
      peaks = buildPeaks(buffer);
      drawWaveform();
      drawTrim();
      drawSpectrum();
      statusEl.textContent = "🎵 Audio loaded — editor ready";
      setReady(true);
    } catch (error) {
      console.error("Audio decode failed:", error);
      statusEl.textContent = "⚠ Format tidak bisa diedit di browser";
      setReady(false);
    }
  }

  function bindRange(range, value, handler) {
    if (!range || !value) return;
    range.addEventListener("input", () => {
      value.value = Number(range.value).toFixed(range.step && Number(range.step) < 1 ? 2 : 0);
      handler(Number(range.value));
    });
    value.addEventListener("change", () => {
      const min = Number(range.min), max = Number(range.max);
      const v = clamp(Number(value.value) || Number(range.value), min, max);
      range.value = v;
      value.value = Number(v).toFixed(range.step && Number(range.step) < 1 ? 2 : 0);
      handler(v);
    });
  }

  bindRange(controls.gain, controls.gainVal, updatePreviewGraph);
  bindRange(controls.speed, controls.speedVal, () => updatePreviewGraph());
  bindRange(controls.pitch, controls.pitchVal, updatePreviewGraph);
  bindRange(controls.reverb, controls.reverbVal, updatePreviewGraph);
  bindRange(controls.room, controls.roomVal, () => {
    if (audioCtx && previewReverb) previewReverb.buffer = buildImpulse(audioCtx);
  });
  bindRange(controls.stereo, controls.stereoVal, updatePreviewGraph);

  document.querySelectorAll(".tab-btn").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("hidden", panel.dataset.panel !== btn.dataset.tab));
    btn.classList.add("active");
  }));

  buildEqUi();
  dragHandle(handleLeft, true);
  dragHandle(handleRight, false);

  waveWrap.addEventListener("pointerdown", event => {
    if (!duration || event.target === handleLeft || event.target === handleRight) return;
    const rect = waveWrap.getBoundingClientRect();
    cursor = clamp((event.clientX - rect.left) / rect.width, 0, 1) * duration;
    cursor = clamp(cursor, trimStart, trimEnd);
    drawCursor(cursor);
    if (playing) startPlayback(cursor);
  });

  playBtn.addEventListener("click", () => {
    if (playing) {
      if (audioCtx) cursor = clamp(playOffset + (audioCtx.currentTime - playStartedAt) * (Number(controls.speed.value) || 1), trimStart, trimEnd);
      stopPlayback();
      drawCursor(cursor);
    } else {
      startPlayback(cursor >= trimEnd || cursor < trimStart ? trimStart : cursor);
      requestAnimationFrame(tickCursor);
    }
  });

  function hasEdits() {
    return Number(controls.gain.value) !== 0 || Number(controls.speed.value) !== 1 || Number(controls.pitch.value) !== 0 ||
      trimStart > 0.01 || trimEnd < duration - 0.01 || eqValues.some(v => Math.abs(v) > 0.01) ||
      Number(controls.reverb.value) !== 0 || Number(controls.stereo.value) !== 0 ||
      controls.fadeIn.checked || controls.fadeOut.checked;
  }

  function createImpulse(ctx) {
    const room = clamp(Number(controls.room.value || 50), 0, 100) / 100;
    const length = Math.max(1, Math.floor(ctx.sampleRate * (0.3 + room * 1.7)));
    const decay = 1.2 + room * 4;
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return ir;
  }

  async function renderEdited() {
    const speed = clamp(Number(controls.speed.value || 1), 0.5, 2);
    const frames = Math.max(1, Math.round((trimEnd - trimStart) * buffer.sampleRate / speed));
    const ctx = new OfflineAudioContext(Math.max(1, Math.min(2, buffer.numberOfChannels)), frames, buffer.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = speed;
    src.detune.value = Number(controls.pitch.value || 0) * 100;
    const gain = ctx.createGain();
    const base = dbGain(Number(controls.gain.value || 0));
    gain.gain.value = base;
    const durationOut = frames / buffer.sampleRate;
    if (controls.fadeIn.checked) {
      const d = clamp(Number(controls.fadeInVal.value || 0), 0, durationOut);
      if (d > 0) { gain.gain.setValueAtTime(0.0001, 0); gain.gain.linearRampToValueAtTime(base, d); }
    }
    if (controls.fadeOut.checked) {
      const d = clamp(Number(controls.fadeOutVal.value || 0), 0, durationOut);
      if (d > 0) { gain.gain.setValueAtTime(base, Math.max(0, durationOut - d)); gain.gain.linearRampToValueAtTime(0.0001, durationOut); }
    }
    src.connect(gain);
    let node = gain;
    for (let i = 0; i < EQ_FREQS.length; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = EQ_FREQS[i];
      filter.Q.value = 1.05;
      filter.gain.value = eqValues[i];
      node.connect(filter);
      node = filter;
    }
    const reverbMix = clamp(Number(controls.reverb.value || 0), 0, 100) / 100;
    const stereo = clamp(Number(controls.stereo.value || 0), -100, 100) / 100;
    if (reverbMix > 0) {
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const conv = ctx.createConvolver();
      dry.gain.value = 1 - reverbMix;
      wet.gain.value = reverbMix;
      conv.buffer = createImpulse(ctx);
      node.connect(dry);
      node.connect(conv);
      conv.connect(wet);
      let out = ctx.createGain();
      dry.connect(out);
      wet.connect(out);
      node = out;
    }
    if (Math.abs(stereo) > 0.001) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = stereo;
      node.connect(panner);
      node = panner;
    }
    node.connect(ctx.destination);
    src.start(0, trimStart, trimEnd - trimStart);
    return ctx.startRendering();
  }

  function toPcm16(data) {
    const out = new Int16Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const x = clamp(data[i], -1, 1);
      out[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
    }
    return out;
  }

  function encodeMp3(audioBuffer, kbps = 192) {
    if (typeof lamejs === "undefined") return null;
    const channels = Math.min(2, audioBuffer.numberOfChannels);
    const encoder = new lamejs.Mp3Encoder(channels, audioBuffer.sampleRate, kbps);
    const left = toPcm16(audioBuffer.getChannelData(0));
    const right = channels > 1 ? toPcm16(audioBuffer.getChannelData(1)) : null;
    const chunks = [];
    for (let i = 0; i < left.length; i += 1152) {
      const leftChunk = left.subarray(i, i + 1152);
      const out = right ? encoder.encodeBuffer(leftChunk, right.subarray(i, i + 1152)) : encoder.encodeBuffer(leftChunk);
      if (out.length) chunks.push(new Int8Array(out));
    }
    const tail = encoder.flush();
    if (tail.length) chunks.push(new Int8Array(tail));
    return new Blob(chunks, { type: "audio/mpeg" });
  }

  applyBtn.addEventListener("click", async () => {
    if (!buffer || !file) return notify("Pilih file audio dulu.", "error");
    if (!hasEdits()) return notify("Belum ada perubahan buat disimpan.", "error");
    stopPlayback();
    const old = applyBtn.textContent;
    applyBtn.disabled = true;
    applyBtn.textContent = "⏳ Processing...";
    try {
      const rendered = await renderEdited();
      const base = file.name.replace(/\.[^/.]+$/, "");
      const blob = encodeMp3(rendered);
      const outBlob = blob || await (async () => rendered)();
      const outName = blob ? `${base}-edited.mp3` : `${base}-edited.wav`;
      const edited = new File([outBlob], outName, { type: outBlob.type || "audio/mpeg" });
      window.MusicLabTrack.set(edited);
      statusEl.textContent = "✅ Edited — ready to upload";
      applyBtn.textContent = "✓ Saved";
      notify("Audio berhasil diedit ✓", "success");
    } catch (error) {
      console.error("Save edit failed:", error);
      statusEl.textContent = "⚠ Gagal memproses edit";
      notify("Gagal memproses audio.", "error");
    } finally {
      setTimeout(() => { applyBtn.disabled = false; applyBtn.textContent = old; }, 1200);
    }
  });

  resetBtn.addEventListener("click", () => {
    stopPlayback();
    controls.gain.value = 0; controls.gainVal.value = "0.00";
    controls.speed.value = 1; controls.speedVal.value = "1.00";
    controls.pitch.value = 0; controls.pitchVal.value = "0";
    controls.reverb.value = 0; controls.reverbVal.value = "0";
    controls.room.value = 50; controls.roomVal.value = "50";
    controls.stereo.value = 0; controls.stereoVal.value = "0";
    controls.fadeIn.checked = false; controls.fadeOut.checked = false;
    eqValues = [...PRESETS.Default];
    applyPreset("Default");
    if (buffer) { trimStart = 0; trimEnd = duration; cursor = 0; drawTrim(); }
    if (file && window.MusicLabTrack) window.MusicLabTrack.set(file);
    statusEl.textContent = "🎵 Audio loaded — editor ready (reset)";
  });

  document.addEventListener("musiclab:file-selected", event => loadFile(event.detail.file));
  document.addEventListener("musiclab:file-cleared", () => {
    stopPlayback();
    file = null; buffer = null; peaks = null; duration = 0; cursor = 0;
    setReady(false);
    statusEl.textContent = "Waiting audio...";
    trackNameEl.textContent = "🎚 Advanced Sound Studio";
    watermark.textContent = "";
    waveCanvas.getContext("2d").clearRect(0, 0, waveCanvas.width, waveCanvas.height);
    specCanvas.getContext("2d").clearRect(0, 0, specCanvas.width, specCanvas.height);
  });

  sizeCanvas(waveCanvas);
  sizeCanvas(specCanvas);
  setReady(false);
  window.addEventListener("resize", () => {
    sizeCanvas(waveCanvas);
    sizeCanvas(specCanvas);
    drawWaveform();
    drawTrim();
    drawSpectrum();
  }, { passive: true });
})();
