/* Explicitly marked page titles only; content remains readable without JavaScript. */
(() => {
  'use strict';
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set();
  const glyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?#';
  const segmenter = typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('vi', { granularity: 'grapheme' }) : null;
  const split = text => segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text);

  function play(title) {
    if (preference.matches || document.hidden) return;
    const source = document.createElement('span');
    source.style.opacity = '0';
    while (title.firstChild) source.appendChild(title.firstChild);
    const visual = source.cloneNode(true);
    visual.removeAttribute('style');
    visual.setAttribute('aria-hidden', 'true');
    visual.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    for (const node of visual.querySelectorAll('[id]')) node.removeAttribute('id');
    const position = title.style.position;
    title.style.position = 'relative';
    title.append(source, visual);
    const walker = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
    const runs = [];
    let node, count = 0;
    while ((node = walker.nextNode())) {
      if (node.parentElement.closest('svg, [aria-hidden="true"] svg')) continue;
      const chars = split(node.nodeValue);
      const indices = chars.map(char => /\p{L}|\p{N}/u.test(char) ? count++ : -1);
      runs.push({ node, chars, indices });
    }
    let frame = 0, start = null, lastStep = -1;
    function finish() {
      cancelAnimationFrame(frame);
      visual.remove();
      source.replaceWith(...source.childNodes);
      title.style.position = position;
      active.delete(finish);
    }
    active.add(finish);
    function tick(time) {
      if (start === null) start = time;
      const progress = Math.min((time - start) / 850, 1);
      if (progress === 1) { finish(); return; }
      const step = Math.floor((time - start) / 48);
      if (step !== lastStep) {
        lastStep = step;
        const resolved = Math.floor(progress * count);
        for (const run of runs) run.node.nodeValue = run.chars.map((char, i) => {
          const index = run.indices[i];
          if (index < 0 || index < resolved) return char;
          // A short decoding front grows across the title, matching the reference.
          return index < resolved + Math.max(3, count * .15)
            ? glyphs[(index * 7 + step * 11) % glyphs.length] : '\u00a0';
        }).join('');
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  }

  function init() {
    if (preference.matches || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        observer.unobserve(entry.target);
        play(entry.target);
      }
    }, { threshold: .25 });
    document.querySelectorAll('[data-title-scramble]').forEach(title => observer.observe(title));
  }
  function finishAll() { for (const finish of [...active]) finish(); }
  preference.addEventListener('change', () => { if (preference.matches) finishAll(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishAll(); });
  window.addEventListener('pagehide', finishAll);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
