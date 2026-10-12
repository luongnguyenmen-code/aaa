const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'st25-reliability-'));
process.env.ST25_DATA_DIR = directory;
process.env.PORTAL_DATABASE_URL = '';
process.env.SESSION_SECRET = 'offline-reliability-secret-at-least-32-characters';
process.env.ISLEPILOT_API_TOKEN = 'offline-test-token';
process.env.ISLEPILOT_API_BASE_URL = 'https://offline.invalid';
const sid = '76561198000000001', receiver = '76561198000000002';
const initial = { userWallets: {}, userGarage: { [sid]: [{ id: 'dino-local', species: 'Troodon', growth: 80, health: 0, hunger: 0, thirst: 0, isPrimeElder: true, isLocal: true }] }, userInventory: {}, marketListings: [], trades: [], tickets: [], referrals: {}, carcassOrders: [], adminAssignments: {} };
const cfg = JSON.parse(fs.readFileSync('src/core/server-config.json', 'utf8'));
cfg.islepilot.enabled = true;
fs.writeFileSync(path.join(directory, 'server-config.json'), JSON.stringify(cfg));
fs.writeFileSync(path.join(directory, 'portal-data.json'), JSON.stringify(initial));
let mode = 'normal', balance = { [sid]: 100, [receiver]: 100 }, calls = [], cloud = [];
const quests = [{ id: 'q1', name: 'Fixture quest', progress: 1, config: { count: 1 }, rewards: [{ kind: 'coins', amount: 8 }] }, { id: 'q2', name: 'Second quest', progress: 1, config: { count: 1 }, rewards: [{ kind: 'coins', amount: 9 }] }];
global.fetch = async (url, options = {}) => {
  const endpoint = new URL(url).pathname;
  const body = options.body ? JSON.parse(options.body) : {};
  calls.push({ endpoint, method: options.method, body });
  const respond = (data, status = 200) => new Response(JSON.stringify(data), { status });
  if (options.method === 'POST') {
    if (endpoint.endsWith('/currency')) {
      if (mode === 'currency-reject' || (mode === 'credit-reject' && endpoint.includes(receiver))) return respond({ error: 'Fixture rejection' }, 400);
      if (mode === 'currency-uncertain') throw Error('Fixture lost connection after dispatch');
      const id = endpoint.split('/')[2];
      balance[id] += body.amount;
      return respond({ ok: true, applied: true, balance: balance[id] });
    }
    if (endpoint.endsWith('/skins') && mode === 'skin-reject') return respond({ error: 'Fixture rejection' }, 400);
    if ((endpoint.endsWith('/kick') || endpoint.endsWith('/ban')) && mode === 'moderation-reject') return respond({ error: 'Fixture rejection' }, 400);
    if (endpoint === '/commands' && body.action !== 'announce' && mode === 'command-reject') return respond({ error: 'Fixture rejection' }, 400);
    return respond({ ok: true });
  }
  if (endpoint.endsWith('/garage')) return mode === 'garage-offline' ? respond({ error: 'Fixture offline' }, 503) : respond({ garage: cloud });
  if (endpoint.endsWith('/quests')) return respond({ quests });
  if (endpoint === '/shop/skins') return respond({ skins: [{ id: 'skin1', name: 'Fixture skin', price: 20 }] });
  if (endpoint === '/cases') return respond({ crates: [{ id: 'crate1', name: 'Fixture crate', cost: 8, items: [{ id: 'reward', name: 'Troodon', prizeKind: 'dino', weight: 1, species: 'Troodon', growth: 0.8 }] }] });
  if (endpoint === '/players') return respond({ players: [{ steamId: sid, name: 'Fixture', species: 'Troodon', health: 0, position: { x: 0, y: 0 } }] });
  const id = endpoint.split('/')[2];
  return respond({ steamId: id, name: 'Fixture', species: 'Troodon', growth: 0.8, health: 0, hunger: 0, thirst: 0, position: { x: 0, y: 0 }, online: true, wallet: { balance: balance[id] ?? 100 } });
};
const Core = require('../src/core/config');
const Auth = require('../src/core/auth');
const model = require('../src/models/portal-data');
const api = require('../src/api/islepilot-client');
const app = require('../src/app');
const server = app.listen(0, '127.0.0.1');
function request(route, method = 'GET', body, steam = sid) {
  return new Promise((resolve, reject) => {
    const token = Auth.sign({ kind: 'session', steamId: steam, expires: Date.now() + 60000 });
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: route, method, headers: { Cookie: `st25_session_token=${token}`, 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
}
function reset() {
  mode = 'normal'; balance = { [sid]: 100, [receiver]: 100 }; calls = []; cloud = []; api.apiCache.clear();
  const state = model.getPortalData();
  Object.keys(state).forEach(key => delete state[key]); Object.assign(state, structuredClone(initial)); model.savePortalData(state);
  if (fs.existsSync(Core.mutationJournalFile)) {
    const rows = JSON.parse(fs.readFileSync(Core.mutationJournalFile, 'utf8')); rows.forEach(row => row.status = 'resolved'); fs.writeFileSync(Core.mutationJournalFile, JSON.stringify(rows));
  }
}
async function backendChecks() {
  await new Promise(resolve => server.once('listening', resolve));
  let result = await request('/api/player/garage');
  assert.equal(result.status, 200); assert.equal(result.data.totalParked, 1); assert.equal(result.data.slots[0].health, 0); assert.equal(result.data.slots[0].isPrimeElder, true);
  mode = 'command-reject'; result = await request('/api/player/garage/restore', 'POST', { garageDinoId: 'dino-local' });
  assert.equal(result.status, 400); assert.equal(model.getPortalData().userGarage[sid].length, 1);
  const posts = calls.filter(call => call.method === 'POST').length;
  assert.equal((await request('/api/player/garage/restore', 'POST', { garageDinoId: 7 })).status, 400);
  assert.equal(calls.filter(call => call.method === 'POST').length, posts);
  reset();
  const data = model.getPortalData(); data.marketListings.push({ id: 'listing', sellerSteamId: sid, dinoData: initial.userGarage[sid][0], price: 20 }); model.savePortalData(data);
  assert.equal((await request('/api/player/garage/restore', 'POST', { garageDinoId: 'dino-local' })).status, 409);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  reset(); mode = 'garage-offline';
  assert.equal((await request('/api/player/garage')).status, 503); assert.equal(model.getPortalData().userGarage[sid].length, 1);
  reset(); mode = 'currency-reject';
  const previous = { periodKey: 'old', amount: 1 }; model.getPortalData().claimedQuests = { [sid]: { q1: previous } }; model.savePortalData(model.getPortalData());
  assert.equal((await request('/api/player/quests/claim-all', 'POST', {})).status, 500);
  assert.deepEqual(model.getPortalData().claimedQuests[sid], { q1: previous });
  reset(); mode = 'currency-uncertain';
  await request('/api/market/transfer', 'POST', { receiverSteamId: receiver, amount: 1 });
  const count = calls.length;
  assert.equal((await request('/api/market/transfer', 'POST', { receiverSteamId: receiver, amount: 1 })).status, 409);
  assert.equal((await request('/api/skin/buy', 'POST', { skinId: 'skin1' }, receiver)).status, 409);
  assert.equal(calls.length, count);
  const receipt = JSON.parse(fs.readFileSync(Core.mutationJournalFile, 'utf8')).find(row => row.status === 'review'); assert(receipt.steps.some(step => step.status === 'uncertain'));
  // Simulate a fresh process reading the persisted journal after a restart.
  delete require.cache[require.resolve('../src/services/mutation-journal')]; assert(require('../src/services/mutation-journal').unresolved([sid]));
  reset(); mode = 'credit-reject';
  result = await request('/api/market/transfer', 'POST', { receiverSteamId: receiver, amount: 7 }); assert.equal(result.status, 500); assert.match(result.data.error, /hoàn/);
  assert.equal(balance[sid], 100); assert.equal(balance[receiver], 100);
  assert.equal(JSON.parse(fs.readFileSync(Core.mutationJournalFile, 'utf8')).at(-1).compensated, true);
  reset(); mode = 'skin-reject';
  assert.equal((await request('/api/skin/buy', 'POST', { skinId: 'skin1', price: -900 })).status, 400);
  assert.equal(calls.filter(call => call.endpoint.endsWith('/currency')).length, 0);
  reset(); result = await request('/api/crates/open', 'POST', { crateId: 'unknown' }); assert.equal(result.status, 400);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  result = await request('/api/crates/open', 'POST', { crateId: 'crate1' }); assert.equal(result.status, 200); assert.equal(result.data.transferredToGarage, true);
  assert.equal(model.getPortalData().userGarage[sid].length, 2); assert(!calls.some(call => call.body.action === 'swap'));
  const ctx = require('../src/controllers/context')();
  reset(); mode = 'command-reject';
  result = await request('/api/support/unstuck', 'POST', {});
  assert.equal(result.status, 400); assert.notEqual(result.data.success, true);
  reset(); result = await request('/api/support/unstuck', 'POST', {});
  assert.equal(result.status, 200); assert.equal(result.data.success, true);
  assert(calls.some(call => call.endpoint === '/commands' && call.body.action === 'unstuck' && call.body.steamId === sid));
  reset(); mode = 'moderation-reject';
  model.getPortalData().combatLogs = [{ id: 'fixture-log', resolved: false }]; model.savePortalData(model.getPortalData());
  result = await request('/api/admin/combat-action', 'POST', { logId: 'fixture-log', action: 'kick', targetSteamId: receiver }, ctx.SUPER_ADMINS[0]);
  assert.equal(result.status, 400); assert.equal(model.getPortalData().combatLogs[0].resolved, false);
  reset(); mode = 'garage-offline';
  result = await request('/api/admin/assign-role-slots', 'POST', { targetSteamId: receiver, roleKey: 'default', customSlots: 4 }, ctx.SUPER_ADMINS[0]);
  assert.equal(result.status, 200); assert.equal(result.data.success, true); assert.equal(model.getPortalData().adminAssignments[receiver].slots, 4);
  reset(); model.getPortalData().trades.push({ id: 'expired', status: 'pending', createdAtTimestamp: Date.now() - 40000, senderSteamId: sid, receiverSteamId: receiver });
  ctx.pendingMutations.add('trade:expired'); assert.equal(ctx.cleanExpiredTrades(), false); ctx.pendingMutations.clear(); assert.equal(ctx.cleanExpiredTrades(), true); assert.equal(model.getPortalData().trades[0].status, 'expired');
  reset(); result = await request('/api/player/map'); assert.equal(result.data.health, 0); assert.equal(result.data.online_players_markers[0].health, 0);
  const stalled = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/market/transfer', method: 'POST', headers: { Cookie: `st25_session_token=${Auth.sign({kind:'session',steamId:sid,expires:Date.now()+60000})}`, 'Content-Type': 'application/json', 'Content-Length': 1000 } });
  stalled.on('error', () => {}); stalled.write('{');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await request('/api/skin/buy', 'POST', {})).status, 429);
  stalled.destroy(); await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await request('/api/skin/buy', 'POST', {})).status, 400, 'An aborted request body must not strand the player lock');
}

async function databaseChecks() {
  const documents = new Map(); let owner = null, updates = 0;
  class Pool {
    on() {}
    async query(sql, params) {
      if (sql.startsWith('INSERT')) { if (!documents.has(params[0])) documents.set(params[0], JSON.parse(params[1])); }
      return { rows: [] };
    }
    async connect() {
      const client = { release() {}, async query(sql, params) {
        if (sql.includes('pg_try_advisory_lock')) { const locked = !owner; if (locked) owner = client; return { rows: [{ locked }] }; }
        if (sql.includes('pg_advisory_unlock')) { assert.equal(owner, client); owner = null; return { rows: [] }; }
        if (sql.startsWith('SELECT name')) return { rows: params[0].map(name => ({ name, payload: structuredClone(documents.get(name)) })) };
        if (sql.startsWith('UPDATE')) { updates++; params[0].forEach((name, i) => documents.set(name, JSON.parse(params[1][i]))); return { rows: [] }; }
        throw Error('Unexpected fixture SQL');
      } }; return client;
    }
  }
  function instance() {
    const context = { module: { exports: {} }, process: { env: { PORTAL_DATABASE_URL: 'postgres://offline.invalid/fixture' } }, URL, console, require: name => name === 'pg' ? { Pool } : name === '../core/config' ? Core : name === '../api/endpoints' ? require('../src/api/endpoints') : require(name) };
    vm.runInNewContext(fs.readFileSync('src/models/persistent-state.js', 'utf8'), context); return context.module.exports;
  }
  const first = instance(), second = instance();
  let release, entered; const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
  const req = { method: 'POST', originalUrl: '/api/support/ticket' };
  const pending = first.run(req, async () => { entered(); first.set('portal', { ticket: 'kept' }); await gate; });
  await started; await assert.rejects(second.run(req, () => {}), error => error.status === 429); release(); await pending;
  await second.run({ method: 'GET', originalUrl: '/api/support/my-tickets' }, async () => { assert.equal(second.get('portal').ticket, 'kept'); second.set('portal', { ticket: 'stale-read' }); await second.flush(); });
  assert.equal(documents.get('portal').ticket, 'kept'); assert.equal(updates, 1);
  await assert.rejects(first.run(req, () => { throw Error('Fixture exception'); }), /Fixture exception/); assert.equal(owner, null);
  await second.run({ method: 'GET', originalUrl: '/api/player/vitals' }, () => { assert.equal(second.get('portal').ticket, undefined); assert(second.get('config')); });
  // Exercise the real HTTP/model/journal integration with the shared fake database.
  documents.clear();
  const modulePath = require.resolve('pg'), savedModule = require.cache[modulePath];
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: { Pool } };
  process.env.PORTAL_DATABASE_URL = 'postgres://offline.invalid/fixture';
  const disk = fs.readFileSync(Core.dataFile, 'utf8');
  try {
    let response = await request('/api/support/ticket', 'POST', { violationRule: 'Fixture rule', details: 'Offline fixture ticket' });
    assert.equal(response.status, 200);
    response = await request('/api/support/my-tickets'); assert.equal(response.data[0].details, 'Offline fixture ticket');
    assert.equal(fs.readFileSync(Core.dataFile, 'utf8'), disk, 'Database mode must not rewrite local JSON');
    mode = 'currency-uncertain';
    await request('/api/market/transfer', 'POST', { receiverSteamId: receiver, amount: 1 });
    assert(documents.get('journal').some(row => row.status === 'review'));
    assert.equal((await request('/api/skin/buy', 'POST', { skinId: 'skin1' }, receiver)).status, 409);
  } finally { process.env.PORTAL_DATABASE_URL = ''; if (savedModule) require.cache[modulePath] = savedModule; else delete require.cache[modulePath]; }
}

async function frontendChecks() {
  const timers = new Map(); let timerId = 0, calls = 0;
  const context = { document: { addEventListener() {}, hidden: false }, window: {}, Response, Headers, AbortController, ST25Core: { readTimeoutMs: 10000 }, setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id), fetch: async () => { calls++; return new Response('{"balance":0}'); } };
  vm.runInNewContext(fs.readFileSync('assets/js/app.js', 'utf8') + '\nglobalThis.app=App;', context);
  const app = context.app;
  context.ST25API = require('../src/api/endpoints');
  const [json, response] = await Promise.all([app.readJSON('/api/test', { credentials: 'same-origin', headers: { B: '2', A: '1' } }), app.readResponse('/api/test', { headers: { a: '1', b: '2' } })]);
  assert.equal(calls, 1); assert.equal(json.balance, 0); assert.equal((await response.json()).balance, 0); assert.throws(() => app.readJSON('/api/test', { method: 'POST' }), /GET/);
  const abort = new AbortController(); context.fetch = (_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('cancelled'))));
  const read = app.readJSON('/api/cancel', { signal: abort.signal }); const rejected = assert.rejects(read, /cancelled/); abort.abort(); await rejected;
  let finish; context.fetch = () => new Promise(resolve => finish = resolve); const mutation = app.mutate('/api/write', { method: 'POST' });
  await assert.rejects(app.mutate('/api/write', { method: 'POST' }), /đang được xử lý/); finish(new Response('{}')); await mutation; assert.equal(app.mutationRequests.size, 0);
  app.pollingInFlight = true; app.schedulePolling(0); assert.equal(timers.size, 0);
  let reloads = 0, logoutDone; app.user = { steam_id: sid }; app.showToast = () => {}; app.publishUser = () => {}; app.renderPlayerHUD = () => {}; app.updateUI = () => {}; context.window.location = { reload() { reloads++; } }; context.localStorage = { removeItem() { throw Error('blocked'); } }; app.mutate = () => new Promise(resolve => logoutDone = resolve);
  const logout = app.logoutUser(); assert.equal(reloads, 0); assert(app.user); logoutDone(new Response('{}')); await logout; assert.equal(reloads, 1); assert.equal(app.user, null);
  const ticketNodes = { 'ticket-count-badge': {}, 'tickets-list-container': {} };
  const ticketContext = { console, ST25API: require('../src/api/endpoints'), App: { escapeHTML: app.escapeHTML, readJSON: async () => [{ id:'fixture', status:'pending', violationRule:'<script>bad</script>', details:'<img src=x onerror=alert(1)>', videoUrl:'javascript:alert(1)', targetPlayer:'Fixture', timeReport:'now', locationReport:'here', createdAt:'now' }] }, document: { addEventListener() {}, getElementById: id => ticketNodes[id] } };
  vm.runInNewContext(fs.readFileSync('src/features/ho-tro.js','utf8'), ticketContext); await ticketContext.loadMyTickets();
  const html = ticketNodes['tickets-list-container'].innerHTML;
  assert(!html.includes('<script>')); assert(!html.includes('<img src=x')); assert(!html.includes('javascript:')); assert(html.includes('&lt;img'));
}

function storageChecks() {
  // Inject a rename failure after writing the temporary file. The original survives.
  const files = new Map([['fixture.json', '{"kept":true}']]); let temporary, descriptorClosed = false;
  const fakeFS = { mkdirSync() {}, openSync(file) { temporary = file; return 1; }, writeFileSync(fd, text) { assert.equal(fd, 1); files.set(temporary, text); }, fsyncSync() {}, closeSync() { descriptorClosed = true; }, renameSync() { throw Error('Fixture disk failure'); }, unlinkSync(file) { files.delete(file); } };
  const context = { module: { exports: {} }, process: { pid: 1 }, console, require: name => name === 'node:fs' ? fakeFS : require(name) };
  vm.runInNewContext(fs.readFileSync('src/models/json-store.js', 'utf8'), context);
  assert.throws(() => context.module.exports.writeJSON('fixture.json', { overwrite: true }), /disk failure/);
  assert.equal(files.get('fixture.json'), '{"kept":true}'); assert.equal(files.size, 1); assert(descriptorClosed);
  // Corrupt existing data must fail instead of silently resetting to a seed wallet.
  const corrupt = { module: { exports: {} }, console, require: name => name === 'node:fs' ? { existsSync: () => true, readFileSync: () => '{corrupt' } : name === './persistent-state' ? { current: () => null } : name === './json-store' ? {} : { dataFile: 'fixture.json' } };
  vm.runInNewContext(fs.readFileSync('src/models/portal-data.js', 'utf8'), corrupt);
  assert.throws(() => corrupt.module.exports.getPortalData(), error => error.status === 503);
}

(async () => { await backendChecks(); await databaseChecks(); await frontendChecks(); storageChecks(); console.log('PASS reliability: local/cloud garage, failed restore preservation, listing ownership, zero vitals, quest rollback, uncertain/restarted transactions, confirmed refunds, rejected purchases, crate delivery, shared trade locks, cross-instance database locks, read isolation, atomic disk failure, corrupt data rejection, shared frontend reads, cancellation, duplicate mutations, acknowledged logout; offline fixtures only'); })()
  .catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
