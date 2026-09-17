(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const source = $('#sourceSpeed');
  const target = $('#targetSpeed');
  const result = $('#playbackResult');
  const resultText = $('#resultText');
  const sourceSummary = $('#sourceSummary');
  const targetSummary = $('#targetSummary');
  const robloxSummary = $('#robloxSummary');
  const reference = $('#referenceBody');
  const lua = $('#luaCode code');

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const number = (value, fallback = 1) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const fmt = (value, suffix = '') => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}${suffix}`;
  };

  function calculate() {
    if (!source || !target) return;
    const sourceSpeed = clamp(number(source.value), 0.05, 8);
    const targetSpeed = clamp(number(target.value), 0.05, 8);
    const playback = targetSpeed / sourceSpeed;

    source.value = sourceSpeed;
    target.value = targetSpeed;
    result.textContent = `${fmt(playback)}×`;
    sourceSummary.textContent = `${fmt(sourceSpeed)}×`;
    targetSummary.textContent = `${fmt(targetSpeed)}×`;
    robloxSummary.textContent = `${fmt(playback)}×`;

    resultText.textContent = Math.abs(targetSpeed - 1) < 0.000001
      ? sourceSpeed === 1
        ? 'Source normal 1× → gunakan PlaybackSpeed 1×.'
        : `Audio diedit ${fmt(sourceSpeed)}× → gunakan PlaybackSpeed ${fmt(playback)}× untuk kembali ke target normal 1×.`
      : `Audio diedit ${fmt(sourceSpeed)}× → target ${fmt(targetSpeed)}× → gunakan PlaybackSpeed ${fmt(playback)}×.`;

    lua.textContent = [
      'local sound = workspace.MusicPlayer.Sound',
      '',
      'sound.SoundId = "rbxassetid://ASSET_ID"',
      `sound.PlaybackSpeed = ${fmt(playback)}`,
      'sound.Volume = 1',
      'sound.Looped = true',
      '',
      'sound:Play()'
    ].join('\n');
  }

  function buildReference() {
    if (!reference) return;
    const values = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    reference.innerHTML = values.map((speed) => `
      <tr>
        <td>${fmt(speed)}×</td>
        <td>${fmt(1 / speed)}×</td>
        <td>${speed === 1 ? 'Normal source' : 'Normal target 1×'}</td>
      </tr>`).join('');
  }

  async function copyText(text, button) {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    button.textContent = 'Copied ✓';
    setTimeout(() => { button.textContent = original; }, 1200);
  }

  source?.addEventListener('input', calculate);
  target?.addEventListener('input', calculate);
  $('#copyResult')?.addEventListener('click', (event) => copyText(result?.textContent || '1×', event.currentTarget));
  $('#copyCode')?.addEventListener('click', (event) => copyText(lua?.textContent || '', event.currentTarget));

  calculate();
  buildReference();
})();
