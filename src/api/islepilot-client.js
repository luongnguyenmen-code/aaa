const Core = require('../core/config');
const { getConfig } = require('../models/settings');
const Journal = require('../services/mutation-journal');
// In-memory cache for GET endpoints to respect the 120 req/min limit
const apiCache = new Map();
const pendingReads = new Map();
const readCooldowns = new Map();
const CACHE_TTL_MS = {
  '/server': 15000,
  '/players': 10000,
  '/teleport/locations': 60000,
  '/shop/dinos': 60000,
  '/shop/skins': 60000,
  '/diets': 300000,
  '/leaderboard': 60000,
  'default': 5000
};

// Helper: Call live IslePilot API with caching and scope awareness
async function callIslePilot(endpoint, method = 'GET', body = null, bypassCache = false) {
  const cfg = getConfig();
  const token = process.env.ISLEPILOT_API_TOKEN || cfg.islepilot?.api_token || '';
  if (!token || cfg.islepilot?.enabled === false) return null;
  const base = process.env.ISLEPILOT_API_BASE_URL || cfg.islepilot?.api_base_url || Core.upstreamBaseURL;
  const cleanBase = base.replace(/\/$/, '');
  const url = `${cleanBase}${endpoint}`;

  const cleanEpKey = endpoint.split('?')[0];
  const cacheKey = `${method}:${endpoint}`;
  const scope = JSON.stringify([cleanBase, token]);

  if (method === 'GET' && !bypassCache && apiCache.has(cacheKey)) {
    const entry = apiCache.get(cacheKey);
    const ttl = /^\/players\/\d{17}(?:\/garage)?$/.test(cleanEpKey) ? 2000 : (CACHE_TTL_MS[cleanEpKey] || CACHE_TTL_MS['default']);
    if (entry.scope === scope && Date.now() - entry.time < ttl) {
      return entry.data;
    }
    apiCache.delete(cacheKey);
  }
  const cooldown = readCooldowns.get(scope);
  if (method === 'GET' && cooldown && Date.now() < cooldown) return { _status: 429, error: 'IslePilot đang giới hạn lượt đọc. Dữ liệu sẽ được cập nhật sau.', retryAfterMs: cooldown - Date.now() };
  if (cooldown && Date.now() >= cooldown) readCooldowns.delete(scope);

  // Fresh reads used around transactions must not join an older cached read.
  const pendingKey = JSON.stringify([url, token]);
  const shared = method === 'GET' && !bypassCache;
  if (shared && pendingReads.has(pendingKey)) return pendingReads.get(pendingKey).promise;
  const entry = { cacheKey, invalidated: false };
  const request = (async () => {
    const step = method === 'GET' ? null : await Journal.before(endpoint, method, body);
    let outcome;
    try {
      const opts = {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Api-Key': token,
          'Content-Type': 'application/json'
        }
      };
      if (body && method !== 'GET') {
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
      let json = null;
      try {
        json = await res.json();
      } catch (_) { }

      if (res.ok) {
        if (method !== 'GET' && (!json || typeof json !== 'object')) {
          outcome = { _status: 503, _uncertain: true, error: 'IslePilot chưa trả về xác nhận hợp lệ. Không gửi lại thao tác trước khi kiểm tra.' };
          return outcome;
        }
        if (json?.ok === false || json?.success === false) json = { ...json, error: json.error || json.message || 'IslePilot từ chối thao tác.' };
        if (shared && json && !entry.invalidated) {
          if (apiCache.size >= 500 && !apiCache.has(cacheKey)) apiCache.delete(apiCache.keys().next().value);
          apiCache.set(cacheKey, { time: Date.now(), data: json, scope });
        }
        outcome = json;
        return outcome;
      } else {
        if (res.status === 429) {
          const retry = res.headers?.get?.('retry-after');
          const delay = Number.isFinite(Number(retry)) && retry !== null && retry !== undefined ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
          readCooldowns.clear();
          readCooldowns.set(scope, Date.now() + Math.max(1000, Number.isFinite(delay) ? delay : 15000));
        }
        console.warn(`IslePilot responded ${res.status} for [${method}] ${url}:`, json?.error || json?.message || '');
        outcome = { _status: res.status, error: json?.error || `HTTP ${res.status}`, missingScope: res.status === 403, ...(method !== 'GET' && res.status >= 500 ? { _uncertain: true } : {}) };
        return outcome;
      }
    } catch (err) {
      console.error(`Error calling IslePilot API (${endpoint}): ${err.message}`);
      outcome = method === 'GET' ? null : { _status: 503, _uncertain: true, error: 'Kết nối IslePilot bị gián đoạn. Chưa xác nhận thao tác; hãy kiểm tra trước khi gửi lại.' };
      return outcome;
    } finally {
      if (method !== 'GET' && !(endpoint === '/commands' && body?.action === 'announce')) {
        const affected = endpoint.match(/^\/players\/(\d{17})(?:\/|$)/)?.[1] || body?.steamId;
        if (affected) clearPlayerCache(affected);
      }
      await Journal.after(step, outcome);
    }
  })();
  entry.promise = request;
  if (shared) pendingReads.set(pendingKey, entry);
  try { return await request; }
  finally { if (pendingReads.get(pendingKey) === entry) pendingReads.delete(pendingKey); }
}

// Helper dọn dẹp bộ nhớ đệm của người chơi ngay khi có giao dịch
function clearPlayerCache(steamId) {
  if (!steamId) return;
  const s = String(steamId).trim();
  const matches = key => key === 'GET:/players' || key.startsWith('GET:/players?') || key === `GET:/players/${s}` || key.startsWith(`GET:/players/${s}/`) || key.startsWith(`GET:/players/${s}?`);
  for (const [key, entry] of pendingReads) {
    if (matches(entry.cacheKey)) {
      entry.invalidated = true;
      pendingReads.delete(key);
    }
  }
  for (const key of apiCache.keys()) if (matches(key)) apiCache.delete(key);
  apiCache.delete(`GET:/players/${s}`);
  apiCache.delete(`GET:/players/${s}/garage`);
  apiCache.delete(`/players/${s}`);
  apiCache.delete(`/players/${s}/garage`);
}


module.exports = { callIslePilot, clearPlayerCache, apiCache };
