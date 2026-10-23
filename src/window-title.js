'use strict';

window.addEventListener('DOMContentLoaded', () => {
  const isHost = document.body.dataset.windowRole === 'host';
  const screen = document.getElementById('flowScreen');
  const worship = document.getElementById('worshipLayer');
  function updateTitle() {
    const reading = screen && !screen.classList.contains('hidden');
    const playing = worship && !worship.classList.contains('hidden');
    const name = isHost ? '主持台' : reading
      ? (screen.dataset.step === 'utmost' ? '竭誠獻上' : '經文')
      : playing ? '敬拜影片' : '投影主畫面';
    document.title = `${name}｜早靈修${isHost ? '主持台' : '投影'}`;
  }
  for (const element of [screen, worship]) {
    if (element) new MutationObserver(updateTitle).observe(element, { attributes: true, attributeFilter: ['class', 'data-step'] });
  }
  updateTitle();
});
