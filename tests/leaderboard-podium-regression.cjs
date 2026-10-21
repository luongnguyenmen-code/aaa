const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('src/features/bxh.js', 'utf8');
const nodes = Object.fromEntries(['podium-container', 'bxh-table-thead', 'bxh-table-tbody'].map(id => [id, { innerHTML: '', querySelectorAll: () => [] }]));
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let payload;
const context = {
  document: { getElementById: id => nodes[id], addEventListener() {} },
  window: {}, console, ST25API: { routes: { leaderboard: '/api/leaderboard' } },
  App: { escapeHTML, readResponse: async () => ({ ok: true, json: async () => payload }), showToast() {} }
};
vm.runInNewContext(source + '\nglobalThis.subject = LeaderboardApp;', context);
const app = context.subject;
for (const name of ['Tyrannosaurus', 'Triceratops', 'Pteranodon', 'Troodon', 'T-Rex', 'BP_Carnotaurus_C']) {
  const image = app.dinosaurImage(name);
  assert.ok(image && fs.existsSync(image), name);
}
for (const name of [null, undefined, '__proto__', '../../private', '"><img src=x onerror=alert(1)>']) assert.equal(app.dinosaurImage(name), null);
for (const file of fs.readdirSync('assets/imges/thumbs').filter(file => file.endsWith('.png'))) {
  const portrait = app.dinosaurPortrait(file.replace('.png', ''));
  assert.ok(portrait, file);
  const [x, y, width, height] = portrait.box;
  assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0);
  assert.ok(x + width <= portrait.width + 1 && y + height <= portrait.height + 1);
  assert.ok(width < portrait.width && height < portrait.height, 'Never show the full body');
}
const player = (name, species) => ({ name, species, steamId: '76561198000000001', survivalHours: 12, kills: 9, kd: '3.0', luaBalance: 1234 });
const podium = nodes['podium-container'];
for (const tab of ['survivors', 'hunters', 'wealth']) {
  app.currentTab = tab;
  app.renderPodium([player('Champion', 'Tyrannosaurus'), player('Runner', 'Pteranodon'), player('Third', 'Triceratops')]);
  assert.equal((podium.innerHTML.match(/class="podium-dinosaur"/g) || []).length, 3);
  assert.ok(podium.innerHTML.includes('Tyrannosaurus.png'));
  assert.ok(podium.innerHTML.includes('Pteranodon.png'));
  assert.ok(podium.innerHTML.includes('clip-path="url(#podium-crop-1)"'));
  assert.ok(!podium.innerHTML.includes('podium-avatar'));
}
app.renderPodium([player('Only player', 'Troodon')]);
assert.equal((podium.innerHTML.match(/podium-card--empty/g) || []).length, 2);
assert.ok(podium.innerHTML.includes('troodon.png'));
app.renderPodium([]);
assert.equal((podium.innerHTML.match(/podium-card--empty/g) || []).length, 3);
app.renderPodium([player('<script>alert(1)</script>', 'unavailable')]);
assert.ok(!podium.innerHTML.includes('<script>'));
assert.ok(podium.innerHTML.includes('&lt;script&gt;'));
assert.ok(!podium.innerHTML.includes('src="assets/imges/Tyrannosaurus.png"'));
(async () => {
  const players = [player('One', 'Tyrannosaurus'), player('Two', 'Pteranodon'), player('Three', 'Deinosuchus')];
  payload = { survivors: players, hunters: players, wealth: players };
  await app.loadData();
  assert.equal(app.data.wealth[2].species, 'Deinosuchus');
  assert.ok(podium.innerHTML.includes('Deinosuchus.png'));
  let handler;
  const playersWithAdmin = [...players, { ...players[0], steamId: 'admin' }].map((item, index) => ({ ...item, totalPlaySec: 10000 - index * 100, kills: 9 - index, growth: 1 }));
  require('../src/controllers/leaderboard')({ get: (_, callback) => { handler = callback; } }, {
    getConfig: () => ({ garage: {} }), getPortalData: () => ({ userWallets: {} }),
    SUPER_ADMINS: ['admin'], getRealServerPlayers: async () => playersWithAdmin,
    callIslePilot: async () => ({ entries: playersWithAdmin })
  });
  let response;
  await handler({}, { setHeader() {}, json(value) { response = value; } });
  for (const category of ['survivors', 'hunters', 'wealth']) {
    assert.ok(response[category].length === 3);
    assert.ok(response[category].every(item => item.species && item.steamId !== 'admin'));
  }
  console.log('PASS podium: all categories, species assets and aliases, missing entries, unknown species, escaped names, wealth species and admin exclusion');
})().catch(error => { console.error(error); process.exitCode = 1; });
