/* SVG coordinates follow the photograph, so the eye stays aligned at every size. */
(() => {
  'use strict';
  const scene = document.querySelector('[data-hero-gaze]');
  if (!scene) return;
  const pupil = scene.querySelector('[data-gaze-pupil]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia('(any-pointer: fine)');
  let frame = 0, previous = 0, x = 0, y = 0, targetX = 0, targetY = 0;
  let bounds = scene.getBoundingClientRect();
  let visible = true;

  function animate(time) {
    frame = 0;
    const dt = previous ? Math.min(time - previous, 64) : 16.67;
    previous = time;
    const blend = 1 - Math.exp(-dt / 85);
    x += (targetX - x) * blend;
    y += (targetY - y) * blend;
    if (Math.abs(targetX - x) + Math.abs(targetY - y) < 0.015) {
      x = targetX; y = targetY;
    }
    pupil.setAttribute('transform', `translate(${x.toFixed(3)} ${y.toFixed(3)})`);
    if (x !== targetX || y !== targetY) frame = requestAnimationFrame(animate);
    else previous = 0;
  }
  function start() {
    if (!frame && !document.hidden && visible && !reduced.matches) frame = requestAnimationFrame(animate);
  }
  function reset() { targetX = 0; targetY = 0; start(); }
  function refreshBounds() { bounds = scene.getBoundingClientRect(); }
  window.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !fine.matches || reduced.matches || !visible || document.hidden) return;
    if (!bounds.width || !bounds.height) return;
    const dx = event.clientX - (bounds.left + bounds.width * 530 / 1920);
    const dy = event.clientY - (bounds.top + bounds.height * 166 / 1080);
    // Rotate into the eye's local axes and clamp to an ellipse inside the eyelids.
    const angle = 20 * Math.PI / 180;
    const localX = (dx * Math.cos(angle) + dy * Math.sin(angle)) / Math.max(bounds.width * .3, 1);
    const localY = (-dx * Math.sin(angle) + dy * Math.cos(angle)) / Math.max(bounds.height * .6, 1);
    const length = Math.max(1, Math.hypot(localX, localY));
    targetX = 5 * localX / length;
    targetY = 3 * localY / length;
    start();
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', reset);
  window.addEventListener('blur', reset);
  window.addEventListener('resize', refreshBounds, { passive: true });
  window.addEventListener('scroll', refreshBounds, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(refreshBounds).observe(scene);
  function stop() { cancelAnimationFrame(frame); frame = 0; previous = 0; }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else reset(); });
  reduced.addEventListener('change', () => {
    stop(); x = y = targetX = targetY = 0;
    pupil.setAttribute('transform', 'translate(0 0)');
  });
  fine.addEventListener('change', reset);
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) { refreshBounds(); reset(); } else stop();
  }).observe(scene);
})();
