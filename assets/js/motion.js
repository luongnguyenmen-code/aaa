/* Short, cancellable entrance animations; tab logic always runs immediately. */
(() => {
  'use strict';
  const running = new WeakMap();
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set();

  function enter(targets) {
    const items = typeof targets === 'string'
      ? document.querySelectorAll(targets)
      : targets && typeof targets[Symbol.iterator] !== 'function' ? [targets] : targets || [];
    for (const element of items) {
      if (!element) continue;
      running.get(element)?.cancel();
      if (preference.matches || typeof element.animate !== 'function' || element.hidden || element.style.display === 'none') continue;
      const animation = element.animate(
        [{ opacity: .25, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
      running.set(element, animation);
      active.add(animation);
      const cleanup = () => {
        active.delete(animation);
        if (running.get(element) === animation) running.delete(element);
      };
      animation.onfinish = cleanup;
      animation.oncancel = cleanup;
    }
  }

  preference.addEventListener?.('change', () => {
    if (preference.matches) for (const animation of active) animation.cancel();
  });
  window.addEventListener('pagehide', () => {
    for (const animation of active) animation.cancel();
  });
  window.ST25Motion = Object.freeze({ enter });
})();
