'use strict';

window.addEventListener('DOMContentLoaded', () => {
  const isHost = document.body.dataset.windowRole === 'host';
  const screen = document.getElementById('flowScreen');
  const worship = document.getElementById('worshipLayer');
  const video = document.getElementById('worshipVideo');
  const background = document.getElementById('bgImage');
  const canvas = document.createElement('canvas');
  canvas.width = 24;
  canvas.height = 14;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let backgroundKey = '';
  let backgroundColor = '#a89d90';
  let coverVisible = false;
  let windowActive = document.hasFocus();

  function sampleColor(source) {
    if (!context) return null;
    try {
      context.drawImage(source, 0, 0, 24, 14);
      const pixels = context.getImageData(0, 0, 24, 14).data;
      const groups = new Map();
      for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = pixels.slice(i, i + 3);
        const lightness = (r + g + b) / 3;
        if (lightness < 16 || lightness > 235) continue;
        const key = `${r >> 5},${g >> 5},${b >> 5}`;
        const group = groups.get(key) || [0, 0, 0, 0];
        group[0] += r; group[1] += g; group[2] += b; group[3]++;
        groups.set(key, group);
      }
      const dominant = [...groups.values()].sort((a, b) => b[3] - a[3])[0];
      if (!dominant) return '#97918a';
      // Blend the content colour with a neutral tone to keep the outline quiet.
      return `rgb(${dominant.slice(0, 3).map(value => Math.round(value / dominant[3] * .6 + 145 * .4)).join(', ')})`;
    } catch { return null; }
  }

  function setColor(color) {
    document.body.style.setProperty('--window-focus-color', color);
  }

  function update() {
    const reading = screen && !screen.classList.contains('hidden');
    const playing = worship && !worship.classList.contains('hidden');
    coverVisible = !isHost && !reading && !playing;
    const name = isHost ? '主持台' : reading
      ? (screen.dataset.step === 'utmost' ? '竭誠獻上' : '經文')
      : playing ? '敬拜影片' : '投影主畫面';
    document.body.classList.toggle('window-active', windowActive);
    document.title = `${name}｜早靈修${isHost ? '主持台' : '投影'}`;
    if (isHost) setColor('#ac99a5');
    else if (reading) setColor('#b5a18c');
    else if (playing) setColor(video.readyState >= 2 ? sampleColor(video) || '#97918a' : '#97918a');
    else setColor(backgroundColor);
  }

  function updateBackground() {
    const key = background?.style.backgroundImage || '';
    if (key === backgroundKey) return;
    backgroundKey = key;
    const match = key.match(/^url\(["']?(.*?)["']?\)$/);
    if (!match) { backgroundColor = '#a89d90'; update(); return; }
    const image = new Image();
    image.onload = () => {
      if (backgroundKey !== key) return;
      backgroundColor = sampleColor(image) || '#a89d90';
      if (coverVisible) setColor(backgroundColor);
    };
    image.src = match[1];
  }
  window.addEventListener('focus', () => { windowActive = true; update(); });
  window.addEventListener('blur', () => { windowActive = false; update(); });
  for (const element of [screen, worship]) {
    if (element) new MutationObserver(update).observe(element, { attributes: true, attributeFilter: ['class', 'data-step'] });
  }
  if (background) new MutationObserver(updateBackground).observe(background, { attributes: true, attributeFilter: ['style'] });
  if (video) {
    video.addEventListener('loadeddata', update);
    video.addEventListener('seeked', update);
    setInterval(() => {
      if (windowActive && !worship.classList.contains('hidden') && !video.paused && video.readyState >= 2) {
        setColor(sampleColor(video) || '#97918a');
      }
    }, 1200);
  }
  updateBackground();
  update();
});
