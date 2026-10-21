/* Native scroll parallax: one passive listener, one frame, no wheel/touch interception. */
(() => {
  'use strict';
  const hero = document.querySelector('.portal-home .st25-hero');
  if (!hero) return;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const targets = Array.from(document.querySelectorAll('[data-home-scroll-reveal]'));
  const seen = new WeakSet();
  const animations = new Set();
  let frame = 0, observer, heroTop = 0, heroHeight = 1, inView = true;

  function measure() {
    heroTop = hero.getBoundingClientRect().top + window.scrollY;
    heroHeight = Math.max(1, hero.offsetHeight);
    schedule();
  }
  function paint() {
    frame = 0;
    if (preference.matches || document.hidden) return;
    const distance = Math.max(0, Math.min(heroHeight, window.scrollY - heroTop));
    const progress = distance / heroHeight;
    hero.style.setProperty('--scroll-art-y', `${(distance * .22).toFixed(2)}px`);
    hero.style.setProperty('--scroll-copy-y', `${(-distance * .12).toFixed(2)}px`);
    hero.style.setProperty('--scroll-copy-opacity', String(Math.max(.15, 1 - progress * 1.15)));
  }
  function schedule() {
    if (!frame && inView && !preference.matches && !document.hidden) frame = requestAnimationFrame(paint);
  }
  function reveal(element) {
    if (seen.has(element) || preference.matches || document.hidden) return;
    seen.add(element);
    if (typeof element.animate !== 'function') return;
    const delay = Math.min(2, Number(element.dataset.homeScrollReveal) || 0) * 65;
    const animation = element.animate([
      { opacity: 0, transform: 'translate3d(0, 42px, 0)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0)' }
    ], { duration: 720, delay, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
    animations.add(animation);
    animation.onfinish = animation.oncancel = () => animations.delete(animation);
  }
  function observe() {
    observer?.disconnect();
    if (preference.matches || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (document.hidden) continue;
        observer.unobserve(entry.target);
        reveal(entry.target);
      }
    }, { threshold: .08, rootMargin: '0px 0px -24px 0px' });
    targets.forEach(element => { if (!seen.has(element)) observer.observe(element); });
  }
  function stop() {
    cancelAnimationFrame(frame); frame = 0;
    for (const animation of [...animations]) animation.cancel();
  }
  function reset() {
    stop();
    for (const property of ['--scroll-art-y', '--scroll-copy-y', '--scroll-copy-opacity']) hero.style.removeProperty(property);
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('pageshow', measure);
  window.addEventListener('pagehide', stop);
  preference.addEventListener('change', () => { reset(); observe(); measure(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else { observe(); measure(); }
  });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    if (inView) schedule();
  }).observe(hero);
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(hero);
  document.fonts?.ready.then(measure);
  observe(); measure();
})();
