const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const events = {}, frames = new Map(), properties = new Map(), observers = [];
let nextId = 0, animations = 0, cancels = 0;
const preference = { matches: false, addEventListener: (_, callback) => { events.preference = callback; } };
const hero = {
  offsetHeight: 1000,
  getBoundingClientRect: () => ({ top: 100 - window.scrollY }),
  style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) }
};
const card = {
  dataset: { homeScrollReveal: '2' },
  animate: (keyframes, options) => {
    animations++;
    assert.equal(options.delay, 130);
    assert.equal(keyframes[1].opacity, 1);
    const animation = { cancel() { cancels++; animation.oncancel?.(); } };
    return animation;
  }
};
const document = {
  hidden: false,
  querySelector: () => hero,
  querySelectorAll: () => [card],
  addEventListener: (name, callback) => { events[name] = callback; }
};
const window = {
  scrollY: 0,
  matchMedia: () => preference,
  IntersectionObserver: true,
  addEventListener: (name, callback, options) => {
    if (name === 'scroll') assert.equal(options.passive, true);
    events[name] = callback;
  }
};
vm.runInNewContext(fs.readFileSync('assets/js/home-scroll.js', 'utf8'), {
  window, document,
  IntersectionObserver: class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {} unobserve() {} disconnect() {}
  },
  requestAnimationFrame: callback => { frames.set(++nextId, callback); return nextId; },
  cancelAnimationFrame: id => frames.delete(id)
});
function flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); }
flush();
assert.equal(properties.get('--scroll-art-y'), '0.00px');
window.scrollY = 600;
events.scroll(); events.scroll(); events.scroll();
assert.equal(frames.size, 1, 'Coalesce scroll events into one frame');
flush();
assert.equal(properties.get('--scroll-art-y'), '110.00px');
assert.equal(properties.get('--scroll-copy-y'), '-60.00px');
window.scrollY = 10000; events.scroll(); flush();
assert.equal(properties.get('--scroll-art-y'), '220.00px', 'Clamp motion after the hero');
observers[0].callback([{ isIntersecting: false }]);
events.scroll(); assert.equal(frames.size, 0, 'Do not animate an offscreen hero');
observers[1].callback([{ target: card, isIntersecting: true }]);
observers[1].callback([{ target: card, isIntersecting: true }]);
assert.equal(animations, 1, 'Reveal each card once');
preference.matches = true; events.preference();
assert.equal(properties.size, 0, 'Restore natural layout for reduced motion');
assert.equal(cancels, 1);
events.scroll(); assert.equal(frames.size, 0);
preference.matches = false; document.hidden = true; events.preference();
assert.equal(frames.size, 0, 'No frames while the tab is hidden');
assert.ok(!events.wheel && !events.touchmove, 'Keep native wheel and touch scrolling');
console.log('PASS home scroll: bounded parallax, frame coalescing, offscreen/hidden pause, one-shot stagger, reduced motion and native input');
