const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const Core = require('../core/config');
const API = require('../api/endpoints').routes;
const lightweightReads = new Set(['playerVitals', 'serverStatus', 'serverEnvironment', 'serverPlayers', 'serverDiets', 'serverLeaderboard', 'shopDinosCatalog', 'shopSkinsCatalog', 'teleportDestinations', 'playerMap', 'playerTeam', 'mapZones', 'playerOwnedSkins'].map(key => API[key]));
const scope = new AsyncLocalStorage();
let pool, initialization;
const configured = () => !!process.env.PORTAL_DATABASE_URL;
const current = () => scope.getStore();
const error = (message, status) => Object.assign(Error(message), { status });

async function database() {
  const address = new URL(process.env.PORTAL_DATABASE_URL);
  if (/pooler|pgbouncer/i.test(address.hostname) || address.port === '6543') throw error('Portal cần PostgreSQL trực tiếp để giữ khóa giao dịch.', 503);
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.PORTAL_DATABASE_URL, max: 4, connectionTimeoutMillis: 5000, query_timeout: 10000 });
    pool.on('error', () => console.error('Portal database unavailable'));
  }
  if (!initialization) initialization = (async () => {
    await pool.query('CREATE TABLE IF NOT EXISTS st25_portal_state (name text PRIMARY KEY, payload jsonb NOT NULL)');
    const parse = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const defaults = { portal: parse(Core.dataFile), config: parse(Core.configFile), journal: [] };
    for (const [name, payload] of Object.entries(defaults)) await pool.query('INSERT INTO st25_portal_state(name,payload) VALUES($1,$2::jsonb) ON CONFLICT(name) DO NOTHING', [name, JSON.stringify(payload)]);
  })().catch(cause => { initialization = null; throw cause; });
  await initialization;
  return pool;
}

function get(name) { return current()?.documents[name]; }
function set(name, value) {
  const state = current();
  if (!state) return false;
  state.documents[name] = value;
  state.dirty.add(name);
  return true;
}
async function flush() {
  const state = current();
  // Reads may calculate expired offers, but must not overwrite a newer transaction.
  if (!state?.writable || !state.dirty.size) return;
  const names = [...state.dirty];
  const values = names.map(name => JSON.stringify(state.documents[name]));
  await state.client.query('UPDATE st25_portal_state s SET payload=v.payload::jsonb FROM unnest($1::text[],$2::text[]) AS v(name,payload) WHERE s.name=v.name', [names, values]);
  names.forEach(name => state.dirty.delete(name));
}
async function run(req, task) {
  if (!configured()) return task();
  const client = await (await database()).connect();
  const writable = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.originalUrl.startsWith('/api/player/logout');
  let locked = false, broken = false;
  try {
    if (writable) {
      locked = (await client.query("SELECT pg_try_advisory_lock(hashtext('st25-portal'),1) AS locked")).rows[0].locked;
      if (!locked) throw error('Giao dịch trước đang được xử lý. Vui lòng chờ.', 429);
    }
    const names = lightweightReads.has(req.originalUrl.split('?')[0]) && !writable ? ['config'] : ['portal', 'config', 'journal'];
    const rows = (await client.query('SELECT name,payload FROM st25_portal_state WHERE name=ANY($1::text[])', [names])).rows;
    const documents = Object.fromEntries(rows.map(row => [row.name, row.payload]));
    if (names.some(name => !documents[name]) || (writable && !Array.isArray(documents.journal))) throw error('Kho dữ liệu portal chưa đầy đủ.', 503);
    if (!writable) { documents.journal ||= []; documents.portal ||= {}; }
    return await scope.run({ client, writable, documents, dirty: new Set() }, async () => {
      const result = await task();
      await flush();
      return result;
    });
  } finally {
    if (locked) try { await client.query("SELECT pg_advisory_unlock(hashtext('st25-portal'),1)"); } catch { broken = true; }
    client.release(broken);
  }
}
module.exports = { configured, current, get, set, flush, run };
