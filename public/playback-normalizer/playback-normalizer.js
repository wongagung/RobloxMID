(() => {
  'use strict';

  const sourceInput = document.querySelector('#sourceSpeed');
  const targetInput = document.querySelector('#targetSpeed');
  const resultEl = document.querySelector('#playbackResult');
  const resultText = document.querySelector('#resultText');
  const sourceSummary = document.querySelector('#sourceSummary');
  const targetSummary = document.querySelector('#targetSummary');
  const robloxSummary = document.querySelector('#robloxSummary');
  const copyResult = document.querySelector('#copyResult');
  const copyCode = document.querySelector('#copyCode');
  const luaCode = document.querySelector('#luaCode code');
  const referenceBody = document.querySelector('#referenceBody');

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const cleanNumber = (value, fallback = 1) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const format = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}×`;
  };
  const formatPlayback = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  };

  function calculate() {
    const source = clamp(cleanNumber(sourceInput?.value, 1), 0.05, 8);
    const target = clamp(cleanNumber(targetInput?.value, 1), 0.05, 8);
    if (sourceInput) sourceInput.value = source;
    if (targetInput) targetInput.value = target;

    const playback = target / source;
    const formattedPlayback = formatPlayback(playback);

    if (resultEl) resultEl.textContent = `${formatPlayback(playback)}×`;
    if (sourceSummary) sourceSummary.textContent = format(source);
    if (targetSummary) targetSummary.textContent = format(target);
    if (robloxSummary) robloxSummary.textContent = `${formattedPlayback}×`;

    if (resultText) {
      const relation = Math.abs(target - 1) < 0.000001
        ? source === 1
          ? 'Source normal 1× → gunakan PlaybackSpeed 1×.'
          : `Audio diedit ${formatPlayback(source)}× → set PlaybackSpeed ke ${formattedPlayback}× untuk target normal 1×.`
        : `Audio diedit ${formatPlayback(source)}× → target ${formatPlayback(target)}× → gunakan PlaybackSpeed ${formattedPlayback}×.`;
      resultText.textContent = relation;
    }

    const safePlayback = Number(formattedPlayback);
    if (luaCode) {
      luaCode.textContent = `local sound = workspace.MusicPlayer.Sound\n\nsound.SoundId = "rbxassetid://ASSET_ID"\nsound.PlaybackSpeed = ${Number.isFinite(safePlayback) ? safePlayback : formattedPlayback}\nsound.Volume = 1\nsound.Looped = true\n\nsound:Play()`;
    }
  }

  function buildReference() {
    if (!referenceBody) return;
    const values = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    referenceBody.innerHTML = values.map((source) => {
      const playback = 1 / source;
      return `<tr><td>${format(source)}</td><td>${formatPlayback(playback)}×</td><td>${source === 1 ? 'Normal source' : 'Normal target 1×'}</td></tr>`;
    }).join('');
  }

  async function copyText(text, button, successLabel) {
    try {
      await navigator.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = successLabel;
      setTimeout(() => { button.textContent = original; }, 1300);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      const original = button.textContent;
      button.textContent = successLabel;
      setTimeout(() => { button.textContent = original; }, 1300);
    }
  }

  sourceInput?.addEventListener('input', calculate);
  targetInput?.addEventListener('input', calculate);

  copyResult?.addEventListener('click', () => {
    copyText(resultEl?.textContent || '1×', copyResult, 'Copied ✓');
  });

  copyCode?.addEventListener('click', () => {
    copyText(luaCode?.textContent || '', copyCode, 'Copied ✓');
  });

  calculate();
  buildReference();
})();
