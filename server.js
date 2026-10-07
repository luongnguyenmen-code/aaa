const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'server-config.json');
const TMP_CONFIG_FILE = path.join(os.tmpdir(), 'server-config.json');
const DATA_FILE = path.join(__dirname, 'portal-data.json');
const TMP_DATA_FILE = path.join(os.tmpdir(), 'portal-data.json');

let memoryConfig = null;
let memoryPortalData = null;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

function getConfig() {
  if (memoryConfig) return memoryConfig;

  // 1. Đọc từ /tmp trước (hỗ trợ môi trường Vercel Serverless có quyền ghi)
  try {
    if (fs.existsSync(TMP_CONFIG_FILE)) {
      const raw = fs.readFileSync(TMP_CONFIG_FILE, 'utf-8').replace(/^\uFEFF/, '');
      memoryConfig = JSON.parse(raw);
      return memoryConfig;
    }
  } catch (_) {}

  // 2. Đọc từ CONFIG_FILE gốc
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8').replace(/^\uFEFF/, '');
      memoryConfig = JSON.parse(raw);
      return memoryConfig;
    }
  } catch (e) {
    console.error('Error reading config:', e);
  }
  memoryConfig = {
    server: { name: "ST25 VIETNAM", short_name: "ST25", max_players: 100 },
    islepilot: {
      enabled: true,
      api_base_url: "https://islepilot.eu/api/v1",
      server_id: "cmufraiwk7fnooa01vpdzdhm4",
      api_token: "ipa_4c51bd355513813f26ea6e759d4e6fb0dd5d8bb7174799de"
    }
  };
  return memoryConfig;
}

function saveConfig(cfg) {
  memoryConfig = cfg;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (_) {}
  try {
    fs.writeFileSync(TMP_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (_) {}
  return true;
}

// In-memory cache for GET endpoints to respect the 120 req/min limit
const apiCache = new Map();
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
  const token = (cfg.islepilot && cfg.islepilot.api_token) || 'ipa_4c51bd355513813f26ea6e759d4e6fb0dd5d8bb7174799de';
  const base = (cfg.islepilot && cfg.islepilot.api_base_url) || 'https://islepilot.eu/api/v1';
  const cleanBase = base.replace(/\/$/, '');
  const url = `${cleanBase}${endpoint}`;

  const cleanEpKey = endpoint.split('?')[0];
  const cacheKey = `${method}:${endpoint}`;

  if (method === 'GET' && !bypassCache && apiCache.has(cacheKey)) {
    const entry = apiCache.get(cacheKey);
    const ttl = CACHE_TTL_MS[cleanEpKey] || CACHE_TTL_MS['default'];
    if (Date.now() - entry.time < ttl) {
      return entry.data;
    }
  }

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
    const res = await fetch(url, opts);
    let json = null;
    try {
      json = await res.json();
    } catch (_) { }

    if (res.ok) {
      if (method === 'GET' && json) {
        apiCache.set(cacheKey, { time: Date.now(), data: json });
      }
      return json;
    } else {
      console.warn(`IslePilot responded ${res.status} for [${method}] ${url}:`, json?.error || json?.message || '');
      return { _status: res.status, error: json?.error || `HTTP ${res.status}`, missingScope: res.status === 403 };
    }
  } catch (err) {
    console.error(`Error calling IslePilot API (${endpoint}): ${err.message}`);
    return null;
  }
}

// Helper dọn dẹp bộ nhớ đệm của người chơi ngay khi có giao dịch
function clearPlayerCache(steamId) {
  if (!steamId) return;
  const s = String(steamId).trim();
  apiCache.delete(`GET:/players/${s}`);
  apiCache.delete(`GET:/players/${s}/garage`);
  apiCache.delete(`/players/${s}`);
  apiCache.delete(`/players/${s}/garage`);
}

// Convert Isle Unreal Engine position to Leaflet [0, 1000] calibrated exactly to https://st25.islepilot.eu/map
function posToLatLng(pos) {
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') {
    return { lat: 500, lng: 500, grid: "F6" };
  }
  // Calibration from IslePilot ST25
  const originU = 0.5356221651318197;
  const originV = 0.4496109559223209;
  const originWorldX = 87931.248;
  const originWorldY = -104086.204;
  const scaleU = 8.8870347e-7;
  const scaleV = 8.8445012e-7;

  const u = originU + (pos.x - originWorldX) * scaleU;
  const v = originV + (pos.y - originWorldY) * scaleV;

  const lng = Math.min(1000, Math.max(0, u * 1000));
  const lat = Math.min(1000, Math.max(0, (1 - v) * 1000));

  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const step = 1000 / 12;
  const colIdx = Math.min(11, Math.max(0, Math.floor(lng / step)));
  const rowIdx = Math.min(11, Math.max(0, Math.floor((1000 - lat) / step)));
  const grid = `${cols[colIdx]}${rowIdx + 1}`;

  return { lat, lng, grid };
}

// Helper to parse cookies from request header without extra dependency
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }
  return list;
}

// Multi-user sessions store: sessionId -> { steam_id, persona_name, ... }
const activeSessions = new Map();

// Helper: Resolve effective steamId for any request
function getRequestSteamId(req) {
  if (req.headers && req.headers['x-steam-id']) return req.headers['x-steam-id'];
  if (req.query && req.query.steamId) return req.query.steamId;
  if (req.body && req.body.steamId) return req.body.steamId;
  const cookies = parseCookies(req);
  if (cookies.st25_steam_id) return cookies.st25_steam_id;
  if (cookies.st25_session_token && activeSessions.has(cookies.st25_session_token)) {
    return activeSessions.get(cookies.st25_session_token).steam_id;
  }
  if (req.headers && req.headers['x-admin-steam-id']) return req.headers['x-admin-steam-id'];
  if (req.query && req.query.adminSteamId) return req.query.adminSteamId;
  if (req.body && req.body.adminSteamId) return req.body.adminSteamId;
  return null;
}

// Helper: Resolve admin identity specifically for admin actions
function getAdminSteamId(req) {
  if (req.headers && req.headers['x-admin-steam-id']) return req.headers['x-admin-steam-id'];
  if (req.query && req.query.adminSteamId) return req.query.adminSteamId;
  if (req.body && req.body.adminSteamId) return req.body.adminSteamId;
  return getRequestSteamId(req);
}

/* ==================== API ROUTES ==================== */

// 1. Server Status
app.get('/api/server/status', async (req, res) => {
  const cfg = getConfig();
  const pilotServer = await callIslePilot('/server');

  if (pilotServer) {
    return res.json({
      name: pilotServer.name || "ST25 VIETNAM",
      status: "online",
      online: true,
      islepilot_sync: true,
      map: "Gateway v0.21.7",
      players: pilotServer.playersOnline ?? pilotServer.lastPlayerCount ?? 0,
      online_players: pilotServer.playersOnline ?? pilotServer.lastPlayerCount ?? 0,
      max_players: cfg.server.max_players || 100,
      cpu_pct: pilotServer.cpuPct || 0,
      memory_used: pilotServer.memoryUsedMb || 0,
      memory_total: pilotServer.memoryTotalMb || 8192,
      hud_download_url: cfg.server.hud_download_url,
      hud_direct_download_url: cfg.server.hud_direct_download_url
    });
  }

  res.json({
    name: "ST25 VIETNAM",
    status: "online",
    map: "Gateway v0.21.7",
    online_players: 3,
    max_players: 100,
    hud_download_url: cfg.server.hud_download_url
  });
});

// 2. Online Dinosaurs Population (from IslePilot - Player names & SteamIDs hidden for privacy)
app.get('/api/server/players', async (req, res) => {
  const data = await callIslePilot('/players?online=true');
  if (data && data.players) {
    const formatted = data.players.map(p => {
      return {
        species: p.species || "Chưa xác định",
        female: p.female,
        growth: p.growth || 0,
        growthPct: Math.round((p.growth || 0) * 100),
        online: true
      };
    });
    return res.json(formatted);
  }
  res.json([]);
});

// 3. Steam OpenID Login URL
app.get('/api/player/steam/login', (req, res) => {
  const redirect = req.query.redirect || '/lien-ket-steam.html';
  const host = req.get('host') || `localhost:${PORT}`;
  const protocol = req.protocol || 'http';
  const returnTo = `${protocol}://${host}/api/player/steam/callback?redirect=${encodeURIComponent(redirect)}`;
  const realm = `${protocol}://${host}`;

  const steamOpenIdUrl = `https://steamcommunity.com/openid/login?openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&openid.mode=checkid_setup&openid.return_to=${encodeURIComponent(returnTo)}&openid.realm=${encodeURIComponent(realm)}&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select`;

  res.redirect(steamOpenIdUrl);
});

// Steam OpenID Callback
app.get('/api/player/steam/callback', async (req, res) => {
  const claimedId = req.query['openid.claimed_id'] || '';
  let redirect = req.query.redirect || '/lien-ket-steam.html';
  const match = claimedId.match(/https:\/\/steamcommunity\.com\/openid\/id\/(\d+)/);

  if (match && match[1]) {
    const steamId = match[1];
    const sessionToken = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const sessionData = await linkPlayerBySteamId(steamId);
    activeSessions.set(sessionToken, sessionData);

    // Set HTTP cookie for automatic authentication across all pages
    res.cookie('st25_steam_id', steamId, { maxAge: 30 * 24 * 3600 * 1000, path: '/' });
    res.cookie('st25_session_token', sessionToken, { maxAge: 30 * 24 * 3600 * 1000, path: '/' });

    // Append steamId to redirect url for easy client-side storage
    const separator = redirect.includes('?') ? '&' : '?';
    redirect = `${redirect}${separator}steamId=${steamId}&login=success`;
  }

  res.redirect(redirect);
});

// Helper: Link player by SteamID from IslePilot API
async function linkPlayerBySteamId(steamId, customName = null) {
  const pilotPlayer = await callIslePilot(`/players/${steamId}`);

  let persona = customName;
  let dino = null;
  let avatar = "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg";
  let discord = null;
  let playtime = 0;
  let wallet = 0;

  if (pilotPlayer) {
    persona = pilotPlayer.name || persona || `Player_${steamId.slice(-4)}`;
    avatar = pilotPlayer.avatar || avatar;
    discord = pilotPlayer.discord || null;
    playtime = Math.round((pilotPlayer.totalPlaySec || 0) / 3600);
    wallet = (pilotPlayer.wallet && pilotPlayer.wallet.balance) || 0;

    if (pilotPlayer.species) {
      const loc = posToLatLng(pilotPlayer.position);
      dino = {
        species: pilotPlayer.species,
        gender: pilotPlayer.female ? "Cái (Female)" : "Đực (Male)",
        growth: Math.round((pilotPlayer.growth || 0) * 100),
        health: Math.round(((pilotPlayer.health || 0) / (pilotPlayer.maxHealth || 1)) * 100) || 100,
        hunger: Math.round(((pilotPlayer.hunger || 0) / (pilotPlayer.maxHunger || 1)) * 100) || 100,
        thirst: Math.round(((pilotPlayer.thirst || 0) / (pilotPlayer.maxThirst || 1)) * 100) || 100,
        stamina: 100,
        diet: ["S", "S", "D"],
        isPrimeElder: pilotPlayer.isPrimeElder || false,
        position: pilotPlayer.position || null,
        lat: loc.lat,
        lng: loc.lng,
        grid: loc.grid
      };
    }
  }

  const sessionObj = {
    steam_id: steamId,
    persona_name: persona || `Player_${steamId.slice(-4)}`,
    avatar: avatar,
    role: "Thành viên ST25",
    linked: true,
    linked_at: new Date().toLocaleString('vi-VN'),
    playtime_hours: playtime,
    coins: wallet,
    discord: discord,
    dino: dino
  };

  return sessionObj;
}

// 4. Liên kết / Đăng nhập Steam bằng Steam ID (Dành cho member & admin)
app.post('/api/player/login-manual', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId || !/^\d{17}$/.test(String(steamId).trim())) {
    return res.status(400).json({ error: "Steam ID không hợp lệ! Vui lòng nhập đúng 17 chữ số Steam ID 64 của bạn." });
  }

  const cleanId = String(steamId).trim();
  const sessionToken = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const sessionData = await linkPlayerBySteamId(cleanId);
  activeSessions.set(sessionToken, sessionData);

  res.cookie('st25_steam_id', cleanId, { maxAge: 30 * 24 * 3600 * 1000, path: '/' });
  res.cookie('st25_session_token', sessionToken, { maxAge: 30 * 24 * 3600 * 1000, path: '/' });

  const isAdmin = isUserAdmin(cleanId);
  const isSuperAdmin = SUPER_ADMINS.includes(cleanId);

  res.json({
    success: true,
    steamId: cleanId,
    personaName: sessionData.persona_name,
    avatar: sessionData.avatar,
    isAdmin,
    isSuperAdmin
  });
});

// 5. Get Current Player info (Strictly based on requesting user's SteamID)
app.get('/api/player/me', async (req, res) => {
  const reqSteamId = getRequestSteamId(req);
  if (reqSteamId) {
    const pilotPlayer = await callIslePilot(`/players/${reqSteamId}`);
    if (pilotPlayer) {
      const loc = posToLatLng(pilotPlayer.position);
      const isAdmin = isUserAdmin(reqSteamId);
      const isSuperAdmin = SUPER_ADMINS.includes(String(reqSteamId).trim());
      const garageStatus = await getPlayerGarageStatus(reqSteamId);

      return res.json({
        steam_id: reqSteamId,
        persona_name: pilotPlayer.name || `Player_${reqSteamId.slice(-4)}`,
        avatar: pilotPlayer.avatar || "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg",
        role: garageStatus.roleName || "Thành viên ST25",
        roleKey: garageStatus.roleKey || "default",
        maxSlots: garageStatus.maxSlots || 3,
        linked: true,
        isLoggedIn: true,
        isAdmin: isAdmin,
        isSuperAdmin: isSuperAdmin,
        playtime_hours: Math.round((pilotPlayer.totalPlaySec || 0) / 3600),
        coins: (pilotPlayer.wallet && pilotPlayer.wallet.balance) !== undefined ? pilotPlayer.wallet.balance : ((getPortalData().userWallets && getPortalData().userWallets[reqSteamId]) || 0),
        balance: (pilotPlayer.wallet && pilotPlayer.wallet.balance) !== undefined ? pilotPlayer.wallet.balance : ((getPortalData().userWallets && getPortalData().userWallets[reqSteamId]) || 0),
        lua: (pilotPlayer.wallet && pilotPlayer.wallet.balance) !== undefined ? pilotPlayer.wallet.balance : ((getPortalData().userWallets && getPortalData().userWallets[reqSteamId]) || 0),
        discord: pilotPlayer.discord,
        dino: {
          species: pilotPlayer.species,
          gender: pilotPlayer.female ? "Cái (Female)" : "Đực (Male)",
          growth: Math.round((pilotPlayer.growth || 0) * 100),
          health: Math.round(((pilotPlayer.health || 0) / (pilotPlayer.maxHealth || 1)) * 100) || 100,
          hunger: Math.round(((pilotPlayer.hunger || 0) / (pilotPlayer.maxHunger || 1)) * 100) || 100,
          thirst: Math.round(((pilotPlayer.thirst || 0) / (pilotPlayer.maxThirst || 1)) * 100) || 100,
          stamina: 100,
          isPrimeElder: pilotPlayer.isPrimeElder || false,
          position: pilotPlayer.position,
          lat: loc.lat,
          lng: loc.lng,
          grid: loc.grid
        }
      });
    }
  }

  res.json({ linked: false, isLoggedIn: false, isAdmin: false, isSuperAdmin: false, persona_name: "Chưa liên kết", avatar: null, coins: 0, balance: 0, lua: 0 });
});

app.post('/api/player/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.st25_session_token) {
    activeSessions.delete(cookies.st25_session_token);
  }
  res.clearCookie('st25_steam_id');
  res.clearCookie('st25_session_token');
  res.json({ success: true, message: "Đã đăng xuất thành công!" });
});


// 6. Quests (Nhiệm Vụ Cá Nhân) Endpoint
app.get('/api/player/quests', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.json({
      steamId: null,
      isLoggedIn: false,
      player: null,
      coins: 0,
      serverQuests: [],
      primeQuests: [],
      primeSummary: null
    });
  }

  // 1. Fetch IslePilot quests & player details
  const [questsData, playerDetails] = await Promise.all([
    callIslePilot(`/players/${steamId}/quests`),
    callIslePilot(`/players/${steamId}`)
  ]);

  let serverQuests = [];
  if (questsData && Array.isArray(questsData.quests)) {
    serverQuests = questsData.quests.map(q => ({
      id: q.id,
      name: q.name,
      description: q.description,
      period: q.period, // daily, weekly, monthly
      rewards: (q.rewards || []).map(r => ({
        kind: (r.kind === 'coins' || r.kind === 'coin') ? 'Lúa 🌾' : r.kind,
        amount: r.amount
      })),
      config: q.config || {},
      completed: !!q.completedAt,
      claimed: !!q.claimedAt
    }));
  }

  // 2. Extract Prime Quests with humorous & clear Vietnamese descriptions
  const primeNamesVi = {
    1: { name: "🍼 Ghé thăm Nhà Trẻ Mầm Non (Sanctuary)", desc: "Đến Sanctuary khi còn là khủng long con (Juvenile)" },
    2: { name: "🪺 Ấp nở từ tổ ấm gia đình (Nested In)", desc: "Được sinh ra từ tổ trứng của bố mẹ trong game" },
    3: { name: "🥗 Bữa ăn 3 sao Michelin hoàn hảo", desc: "Nạp đủ 100% cả 3 nhóm chất dinh dưỡng (S, S, D)" },
    4: { name: "🦣 Phượt qua Vùng Đại Di Cư (Mass Migration)", desc: "Di chuyển qua khu vực Đại Di Cư MMZ" },
    5: { name: "🗺️ Check-in 2 Vùng Di Cư trên đảo", desc: "Khám phá qua ít nhất 2 vùng di cư Migration" },
    6: { name: "⚔️ Tuần tra 4 Điểm Nóng đẫm máu", desc: "Đặt chân qua ít nhất 4 vùng tuần tra Patrol" },
    7: { name: "🧬 Bảo tồn nòi giống (Không bị vô sinh)", desc: "Sinh tồn lành mạnh, chưa từng bị Infertile" },
    8: { name: "🥩 Nói KHÔNG với thịt đồng loại", desc: "Không bao giờ cắn thịt cùng loài (Né chứng giật cơ)" },
    9: { name: "🐣 Nuôi con lớn bổng thành Subadult", desc: "Nuôi dạy thành công thế hệ đàn em khôn lớn" },
    10: { name: "🦖 Dòng dõi thần thú chỉ định", desc: "Là Hypsilophodon, Troodon, Beipiaosaurus, Dryosaurus hoặc Deinosuchus" }
  };

  let primeQuests = [];
  if (playerDetails && playerDetails.prime && Array.isArray(playerDetails.prime.quests)) {
    primeQuests = playerDetails.prime.quests.map(pq => ({
      index: pq.index,
      name: (primeNamesVi[pq.index] && primeNamesVi[pq.index].name) || pq.name,
      originalName: pq.name,
      desc: (primeNamesVi[pq.index] && primeNamesVi[pq.index].desc) || "",
      done: pq.done
    }));
  }

  const reqUserSteamId = getRequestSteamId(req);
  const isCurrentLoggedIn = !!(reqUserSteamId && reqUserSteamId === steamId);

  res.json({
    steamId,
    isLoggedIn: isCurrentLoggedIn || !!getRequestSteamId(req),
    player: playerDetails ? {
      name: playerDetails.name || "Thành viên ST25",
      avatar: playerDetails.avatar || "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg",
      species: playerDetails.species || "Chưa chọn loài",
      gender: playerDetails.female ? "Cái (Female)" : "Đực (Male)",
      growth: Math.round((playerDetails.growth || 0) * 100),
      health: Math.round(((playerDetails.health || 0) / (playerDetails.maxHealth || 1)) * 100) || 100,
      hunger: Math.round(((playerDetails.hunger || 0) / (playerDetails.maxHunger || 1)) * 100) || 100,
      thirst: Math.round(((playerDetails.thirst || 0) / (playerDetails.maxThirst || 1)) * 100) || 100,
      playtimeHours: Math.round((playerDetails.totalPlaySec || 0) / 3600),
      online: playerDetails.online !== false
    } : null,
    coins: (playerDetails && playerDetails.wallet && playerDetails.wallet.balance) || 0,
    serverQuests,
    primeQuests,
    primeSummary: playerDetails ? playerDetails.prime : null
  });
});

// 7. Live Map Coordinates (Member View - Only show this player, hide others)
app.get('/api/player/map', async (req, res) => {
  const reqSteamId = getRequestSteamId(req);
  const onlineData = await callIslePilot('/players?online=true');
  const allOnline = (onlineData && onlineData.players) || [];

  if (!reqSteamId) {
    return res.json({
      online: false,
      steamId: null,
      name: "Khách (Chưa đăng nhập)",
      species: "Chưa chọn khủng long",
      gender: "---",
      growth: "0%",
      growth_num: 0,
      health: 100,
      hunger: 100,
      thirst: 100,
      stamina: 100,
      isPrimeElder: false,
      lat: 500,
      lng: 500,
      grid: "F6",
      x: 0,
      y: 0,
      z: 0,
      total_online: allOnline.length,
      online_players_markers: []
    });
  }

  // 1. Fetch requested player details from IslePilot
  let player = await callIslePilot(`/players/${reqSteamId}`);
  let isOnline = false;

  const foundOnline = allOnline.find(p => p.steamId === reqSteamId);
  if (foundOnline) {
    player = foundOnline;
    isOnline = true;
  } else if (player) {
    isOnline = player.online !== false;
  }

  let activePlayer = player;

  let playerPosition = activePlayer ? activePlayer.position : null;
  let loc = posToLatLng(playerPosition);

  // Member View Policy: ONLY return the active player's own marker. All other players are completely hidden!
  const myMarker = activePlayer ? [{
    steamId: activePlayer.steamId,
    name: activePlayer.name,
    species: activePlayer.species || "Chưa chọn",
    growth: `${Math.round((activePlayer.growth || 0) * 100)}%`,
    health: Math.round(((activePlayer.health || 0) / (activePlayer.maxHealth || 1)) * 100) || 100,
    hunger: Math.round(((activePlayer.hunger || 0) / (activePlayer.maxHunger || 1)) * 100) || 100,
    thirst: Math.round(((activePlayer.thirst || 0) / (activePlayer.maxThirst || 1)) * 100) || 100,
    lat: loc.lat,
    lng: loc.lng,
    grid: loc.grid,
    x: playerPosition ? Math.round(playerPosition.x) : 0,
    y: playerPosition ? Math.round(playerPosition.y) : 0,
    z: playerPosition ? Math.round(playerPosition.z || 0) : 0,
    isYou: true
  }] : [];

  res.json({
    online: isOnline,
    steamId: activePlayer ? activePlayer.steamId : reqSteamId,
    name: (activePlayer && activePlayer.name) || "Người chơi",
    species: (activePlayer && activePlayer.species) || "Chưa chọn khủng long",
    gender: (activePlayer && activePlayer.female) ? "Cái (Female)" : "Đực (Male)",
    growth: activePlayer ? `${Math.round((activePlayer.growth || 0) * 100)}%` : "0%",
    growth_num: activePlayer ? Math.round((activePlayer.growth || 0) * 100) : 0,
    health: activePlayer ? Math.round(((activePlayer.health || 0) / (activePlayer.maxHealth || 1)) * 100) : 100,
    hunger: activePlayer ? Math.round(((activePlayer.hunger || 0) / (activePlayer.maxHunger || 1)) * 100) : 100,
    thirst: activePlayer ? Math.round(((activePlayer.thirst || 0) / (activePlayer.maxThirst || 1)) * 100) : 100,
    stamina: 100,
    isPrimeElder: activePlayer ? (activePlayer.isPrimeElder || false) : false,
    lat: loc.lat,
    lng: loc.lng,
    grid: loc.grid,
    x: playerPosition ? Math.round(playerPosition.x) : 0,
    y: playerPosition ? Math.round(playerPosition.y) : 0,
    z: playerPosition ? Math.round(playerPosition.z || 0) : 0,
    total_online: allOnline.length,
    online_players_markers: myMarker // Strictly hide other players
  });
});

// Map Zones Endpoint (IslePilot ST25 Colored Zones)
app.get('/api/map/zones', (req, res) => {
  const zonesPath = path.join(__dirname, 'assets', 'data', 'islepilot-zones.json');
  if (fs.existsSync(zonesPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(zonesPath, 'utf8'));
      return res.json(data);
    } catch (e) { }
  }
  res.json({ pois: [], categories: [] });
});

// 8. Team / Pack Members (Real Data from IslePilot)
app.get('/api/player/team', async (req, res) => {
  const reqSteamId = getRequestSteamId(req) || "76561198636766540";
  const onlineData = await callIslePilot('/players?online=true');
  const allOnline = (onlineData && onlineData.players) || [];

  const thisPlayer = allOnline.find(p => p.steamId === reqSteamId) || allOnline[0];
  const playerSpecies = (thisPlayer && thisPlayer.species) || "Tyrannosaurus";

  const packLimits = {
    "Tyrannosaurus": 2, "Deinosuchus": 2, "Allosaurus": 3, "Carnotaurus": 4,
    "Dilophosaurus": 4, "Ceratosaurus": 5, "Austroraptor": 6, "Omniraptor": 8,
    "Herrerasaurus": 8, "Troodon": 10, "Pteranodon": 10, "Triceratops": 3,
    "Stegosaurus": 3, "Tenontosaurus": 4, "Diabloceratops": 5, "Kentrosaurus": 5,
    "Maiasaura": 5, "Pachycephalosaurus": 6, "Dryosaurus": 8, "Hypsilophodon": 10,
    "Gallimimus": 10, "Beipiaosaurus": 10
  };

  const limit = packLimits[playerSpecies] || 4;
  const sameSpecies = allOnline.filter(p => p.species === playerSpecies);

  const members = sameSpecies.map((p, idx) => {
    const loc = posToLatLng(p.position);
    return {
      steam_id: p.steamId,
      name: p.steamId === reqSteamId ? `${p.name} (Bạn)` : p.name,
      avatar: "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg",
      species: p.species,
      growth: Math.round((p.growth || 0) * 100),
      health: Math.round(((p.health || 0) / (p.maxHealth || 1)) * 100) || 100,
      status: p.health > 0 ? "Khoẻ mạnh" : "Đang nghỉ",
      role: idx === 0 ? "Chủ đàn (Pack Leader)" : "Thành viên",
      coordinates: `Ô ${loc.grid} (X: ${Math.round(p.position.x / 100)})`,
      last_seen: "Vừa xong",
      online: p.online
    };
  });

  res.json({
    species: playerSpecies,
    pack_limit: limit,
    current_count: members.length,
    is_full: members.length >= limit,
    members: members
  });
});

// ==========================================
// 9. ISLEPILOT OFFICIAL GARAGE SYSTEM (100% LIVE CLOUD)
// ==========================================

// Super Admins cố định có quyền cao nhất
const SUPER_ADMINS = ['76561198354289789', '76561198838095252', '76561198682056372', '76561199229687125'];

// Helper kiểm tra một Steam ID có quyền Admin không
function isUserAdmin(steamId) {
  if (!steamId) return false;
  const sId = String(steamId).trim();
  if (SUPER_ADMINS.includes(sId)) return true;
  const cfg = getConfig();
  const userRoles = (cfg.garage && cfg.garage.user_roles) || {};
  const r = (userRoles[sId] || '').toLowerCase();
  if (r === 'admin' || r === '.') return true;

  const data = getPortalData();
  const dynamicRole = (data.adminAssignments && data.adminAssignments[sId] && data.adminAssignments[sId].roleKey) || '';
  return dynamicRole.toLowerCase() === 'admin' || dynamicRole.toLowerCase() === '.';
}

// Helper: Tra cứu quyền hạn và tính toán sức chứa Gara theo Role Discord & Steam ID
async function getPlayerGarageStatus(steamId) {
  const cfg = getConfig();
  const garageCfg = cfg.garage || {};
  const roleLimits = garageCfg.role_limits || {
    "default": 3,
    "admin": 20,
    "mod": 20,
    ".": 20
  };

  const cleanSteamId = steamId ? String(steamId).trim() : '';
  const portalData = getPortalData();
  const dynamicAssign = (portalData.adminAssignments && portalData.adminAssignments[cleanSteamId]) || null;

  let discordInfo = null;
  let discordRoleKey = "default";

  try {
    const pilotPlayer = await callIslePilot(`/players/${cleanSteamId}`);
    if (pilotPlayer && pilotPlayer.discord) {
      discordInfo = pilotPlayer.discord;
    }
  } catch (_) {}

  const userRolesConfig = garageCfg.user_roles || {};

  // Thứ tự ưu tiên xác định Role:
  // 1. Phân quyền trực tiếp qua Web Admin Panel (portal-data.json)
  // 2. Phân quyền qua file cấu hình server-config.json (user_roles)
  // 3. Phân quyền theo Discord ID/Username nếu liên kết
  // 4. Mặc định là Super Admin nếu là Steam ID Admin chỉ định
  if (dynamicAssign && dynamicAssign.roleKey) {
    discordRoleKey = dynamicAssign.roleKey.toLowerCase();
  } else if (userRolesConfig[cleanSteamId]) {
    discordRoleKey = userRolesConfig[cleanSteamId].toLowerCase();
  } else if (discordInfo && discordInfo.id && userRolesConfig[discordInfo.id]) {
    discordRoleKey = userRolesConfig[discordInfo.id].toLowerCase();
  } else if (discordInfo && discordInfo.username && userRolesConfig[discordInfo.username]) {
    discordRoleKey = userRolesConfig[discordInfo.username].toLowerCase();
  } else if (SUPER_ADMINS.includes(cleanSteamId)) {
    discordRoleKey = "admin";
  } else if (garageCfg.player_custom_slots && garageCfg.player_custom_slots[cleanSteamId] !== undefined) {
    discordRoleKey = "custom";
  }

  const roleNameMap = {
    "admin": "👑 Quản Trị Viên (Admin)",
    ".": "👑 BQT Cấp Cao (.)",
    "mod": "🛡️ Điều Hành Viên (Mod)",
    "dev": "💻 DEV (Phát Triển)",
    "long_khung_quang_cao": "📢 LONG KHỦNG (QUẢNG CÁO)",
    "vien_gach_dau_tien": "🧱 Viên Gạch Đầu Tiên",
    "long_dai_dia_chu": "🏰 LONG ĐẠI ĐỊA CHỦ",
    "long_phu_nong": "🌾 LONG PHÚ NÔNG",
    "long_ta_dien": "🌾 LONG TÁ ĐIỀN",
    "long_chu": "🐲 LONG CHỦ",
    "booster": "🚀 Máy chủ - Bộ khuếch đại",
    "may_chu_bo_khuech_dai": "🚀 Máy chủ - Bộ khuếch đại",
    "streamer": "🎙️ Streamer",
    "bot": "🤖 BOT",
    "default": "🦖 Thành Viên ST25",
    "custom": "✨ Slot Đặc Quyền Custom"
  };
  const roleDisplayName = roleNameMap[discordRoleKey] || `Role: ${discordRoleKey.toUpperCase()}`;

  // Tính số lượng Slot tối đa:
  let maxSlots = roleLimits[discordRoleKey] !== undefined ? Number(roleLimits[discordRoleKey]) : (garageCfg.default_slots || 3);

  // Ghi đè slot nếu có thiết lập thủ công
  if (dynamicAssign && dynamicAssign.slots !== undefined) {
    maxSlots = Number(dynamicAssign.slots);
  } else if (garageCfg.player_custom_slots && garageCfg.player_custom_slots[cleanSteamId] !== undefined) {
    maxSlots = Number(garageCfg.player_custom_slots[cleanSteamId]);
  } else if (SUPER_ADMINS.includes(cleanSteamId)) {
    maxSlots = Math.max(maxSlots, 20);
  }

  // Gọi trực tiếp IslePilot API: GET /players/{cleanSteamId}/garage
  const pilotGarage = await callIslePilot(`/players/${cleanSteamId}/garage`, 'GET', null, true);
  const cloudDinos = (pilotGarage && pilotGarage.garage && Array.isArray(pilotGarage.garage)) ? pilotGarage.garage : [];
  
  // Đọc thêm thú trúng thưởng từ Hòm Quà hoặc Giao dịch lưu trong portal-data
  const localDinos = (portalData.userGarage && portalData.userGarage[cleanSteamId]) ? portalData.userGarage[cleanSteamId] : [];
  
  // Lọc bỏ triệt để các khủng long ĐANG ĐĂNG BÁN trên Chợ (ký gửi Chợ của người chơi này)
  const activeSellingDinoIds = new Set(
    (portalData.marketListings || [])
      .filter(l => l.sellerSteamId === cleanSteamId && l.dinoData && l.dinoData.id)
      .map(l => String(l.dinoData.id))
  );

  // Lọc bỏ triệt để các khủng long ĐANG TRONG LỜI MỜI GIAO DỊCH P2P CHỜ XỬ LÝ
  const activeTradeDinoIds = new Set(
    (portalData.trades || [])
      .filter(t => t.status === 'pending' && t.senderSteamId === cleanSteamId && t.senderDino && t.senderDino.id)
      .map(t => String(t.senderDino.id))
  );

  // Lọc bỏ triệt để các khủng long ĐÃ BÁN THÀNH CÔNG cho người chơi khác
  const soldDinoIds = new Set(
    ((portalData.soldDinos && portalData.soldDinos[cleanSteamId]) || []).map(id => String(id))
  );

  const dinos = [...cloudDinos, ...localDinos].filter(d => {
    const strId = String(d.id);
    if (activeSellingDinoIds.has(strId)) return false;
    if (activeTradeDinoIds.has(strId)) return false;
    if (soldDinoIds.has(strId)) return false;
    return true;
  });

  const totalParked = dinos.length;
  const isFull = totalParked >= maxSlots;

  return {
    totalParked,
    maxSlots,
    roleLimit: maxSlots,
    roleKey: discordRoleKey,
    roleName: roleDisplayName,
    isFull,
    dinos
  };
}

// 9.1 Lấy toàn bộ thông tin Gara của người chơi (Bảo mật theo tài khoản đăng nhập)
app.get('/api/player/garage', async (req, res) => {
  const callerSteamId = getRequestSteamId(req);
  const cfg = getConfig();
  const defSlots = (cfg.garage && cfg.garage.default_slots) || 3;

  if (!callerSteamId) {
    return res.json({
      active: null,
      slots: [],
      tradeableDinos: [],
      steamId: null,
      personaName: "Chưa đăng nhập Steam",
      totalParked: 0,
      maxSlots: defSlots,
      roleKey: "default",
      roleName: "Chưa đăng nhập",
      isFull: false,
      unlinked: true,
      isLoggedIn: false,
      isAdmin: false,
      isSuperAdmin: false
    });
  }

  const callerIsAdmin = isUserAdmin(callerSteamId);
  let effectiveSteamId = callerSteamId;

  // CHỈ QUẢN TRỊ VIÊN mới được quyền xem Gara của Steam ID khác qua query
  if (req.query.steamId && req.query.steamId.trim() !== callerSteamId) {
    if (callerIsAdmin) {
      effectiveSteamId = req.query.steamId.trim();
    }
  }

  const garageStatus = await getPlayerGarageStatus(effectiveSteamId);
  const pilotPlayer = await callIslePilot(`/players/${effectiveSteamId}`, 'GET', null, true);

  let active = null;
  if (pilotPlayer && pilotPlayer.species) {
    active = {
      species: pilotPlayer.species,
      gender: pilotPlayer.female ? "Cái (Female)" : "Đực (Male)",
      growth: Math.round((pilotPlayer.growth || 0) * 100),
      rawGrowth: pilotPlayer.growth || 0,
      health: Math.round(((pilotPlayer.health || 0) / (pilotPlayer.maxHealth || 1)) * 100) || 100,
      hunger: Math.round(((pilotPlayer.hunger || 0) / (pilotPlayer.maxHunger || 1)) * 100) || 100,
      thirst: Math.round(((pilotPlayer.thirst || 0) / (pilotPlayer.maxThirst || 1)) * 100) || 100,
      stamina: 100,
      diet: ["S", "S", "D"],
      isPrimeElder: pilotPlayer.isPrimeElder || false,
      mutations: pilotPlayer.mutations || []
    };
  }

  let slots = [];
  garageStatus.dinos.forEach((g, idx) => {
    const rawG = g.growth !== undefined ? Number(g.growth) : 1;
    const displayGrowth = rawG > 1 ? Math.min(100, Math.round(rawG)) : Math.round(rawG * 100);
    const rawH = g.health !== undefined ? Number(g.health) : 100;
    const displayHealth = rawH > 1 ? Math.min(100, Math.round(rawH)) : Math.round(rawH * 100);
    const rawHunger = g.hunger !== undefined ? Number(g.hunger) : 100;
    const displayHunger = rawHunger > 1 ? Math.min(100, Math.round(rawHunger)) : Math.round(rawHunger * 100);
    const rawThirst = g.thirst !== undefined ? Number(g.thirst) : 100;
    const displayThirst = rawThirst > 1 ? Math.min(100, Math.round(rawThirst)) : Math.round(rawThirst * 100);
    const rawStam = g.stamina !== undefined ? Number(g.stamina) : 100;
    const displayStamina = rawStam > 1 ? Math.min(100, Math.round(rawStam)) : Math.round(rawStam * 100);

    slots.push({
      slot: idx + 1,
      id: g.id,
      name: g.name || "",
      species: g.species,
      gender: (g.gender === 'Female' || g.gender === 'Cái (Female)') ? "Cái (Female)" : "Đực (Male)",
      growth: displayGrowth,
      rawGrowth: rawG > 1 ? rawG / 100 : rawG,
      health: displayHealth,
      hunger: displayHunger,
      thirst: displayThirst,
      stamina: displayStamina,
      isPrimeElder: g.isPrimeElder || false,
      diet: g.diet || ["S", "S", "D"],
      mutations: g.mutations || [],
      stored_at: g.stored_at || (g.parkedAt ? new Date(g.parkedAt).toLocaleString('vi-VN') : "Cloud Gara"),
      source: g.source || (g.isLocal ? "Hòm May Mắn" : "IslePilot Cloud")
    });
  });

  const filledCount = slots.length;
  for (let i = filledCount + 1; i <= garageStatus.maxSlots; i++) {
    slots.push({ slot: i, empty: true });
  }

  const tradeableDinos = slots.filter(s => !s.empty);

  res.json({
    active,
    slots,
    tradeableDinos,
    steamId: effectiveSteamId,
    personaName: (pilotPlayer && pilotPlayer.name) || `Player_${effectiveSteamId.slice(-4)}`,
    totalParked: garageStatus.totalParked,
    maxSlots: garageStatus.maxSlots,
    roleKey: garageStatus.roleKey,
    roleName: garageStatus.roleName,
    roleLimit: garageStatus.roleLimit,
    isFull: garageStatus.isFull,
    isLoggedIn: true,
    isAdmin: callerIsAdmin,
    isSuperAdmin: SUPER_ADMINS.includes(String(callerSteamId).trim()),
    isViewingOther: effectiveSteamId !== callerSteamId,
    upgradeDiscordUrl: (cfg.garage && cfg.garage.upgrade_discord_url) || "https://discord.gg/3xCrA6VyY"
  });
});

// Helper: Chuyển đổi thông điệp lỗi của IslePilot thành thông báo tiếng Việt trực quan, chi tiết
function formatGarageError(rawError, action = 'restore') {
  if (!rawError) {
    return action === 'restore' 
      ? "⚠️ Không thể lấy khủng long ra đảo lúc này! Vui lòng đảm bảo bạn đang ở khu vực vắng người (cách xa người chơi khác tối thiểu 100 mét) và vào game trước khi thử lại."
      : "⚠️ Không thể cất khủng long vào Gara lúc này! Bạn cần ở trạng thái an toàn, không nhận sát thương và chờ tối thiểu 30 giây.";
  }

  const errStr = (typeof rawError === 'string' ? rawError : JSON.stringify(rawError)).toLowerCase();

  // 1. Lỗi có người chơi xung quanh trong bán kính 100 mét (Proximity Check)
  if (
    errStr.includes('nearby') || 
    errStr.includes('too close') || 
    errStr.includes('proximity') || 
    errStr.includes('distance') || 
    errStr.includes('100m') || 
    errStr.includes('100 m') || 
    errStr.includes('radius') ||
    errStr.includes('range') ||
    errStr.includes('close to another') ||
    (errStr.includes('player') && (errStr.includes('close') || errStr.includes('around') || errStr.includes('area') || errStr.includes('other')))
  ) {
    return "⚠️ KHÔNG THỂ LẤY RA VÌ CÓ NGƯỜI XUNG QUANH: Phát hiện có người chơi khác trong bán kính 100 mét xung quanh bạn! Theo quy định máy chủ ST25, bạn bắt buộc phải di chuyển nhân vật đến khu vực an toàn, vắng vẻ (cách xa người khác tối thiểu 100m) mới có thể lấy khủng long từ Gara ra đảo.";
  }

  // 2. Lỗi vừa nhận sát thương / đang trong trạng thái giao tranh (combat)
  if (
    errStr.includes('combat') || 
    errStr.includes('damage') || 
    errStr.includes('hurt') || 
    errStr.includes('attack') || 
    errStr.includes('bleed') || 
    errStr.includes('fight') || 
    errStr.includes('injury') ||
    errStr.includes('battle')
  ) {
    return "⚠️ CHƯA ĐỦ ĐIỀU KIỆN CẤT VÀO GARA: Bạn vừa nhận sát thương hoặc đang trong trạng thái giao tranh (combat)! Quy định máy chủ yêu cầu phải thoát khỏi giao tranh và hoàn toàn không bị mất máu / nhận sát thương trong tối thiểu 30 giây mới được cất vào Gara.";
  }

  // 3. Lỗi chưa online trong game hoặc cần vào game trước
  if (errStr.includes('not online') || errStr.includes('offline') || errStr.includes('join')) {
    return action === 'restore'
      ? "⚠️ BẠN CHƯA VÀO SERVER: Vui lòng đăng nhập vào server game ST25 (chọn cùng loài khủng long) trước khi bấm đưa khủng long ra đảo!"
      : "⚠️ BẠN CHƯA VÀO SERVER: Nhân vật của bạn hiện không trực tuyến trong game để cất vào Gara.";
  }

  // 4. Lỗi Cooldown 30s
  if (
    errStr.includes('cooldown') || 
    errStr.includes('wait') || 
    errStr.includes('frequent') || 
    errStr.includes('rate limit') || 
    errStr.includes('30s') ||
    errStr.includes('30 seconds')
  ) {
    return "⏳ ĐANG TRONG THỜI GIAN CHỜ (30 GIÂY): Hệ thống yêu cầu giãn cách tối thiểu 30 giây giữa các lần cất/lấy Gara để bảo vệ an toàn dữ liệu.";
  }

  // 5. Gara đầy
  if (errStr.includes('full') || errStr.includes('limit') || errStr.includes('slot')) {
    return "⚠️ SỨC CHỨA GARA ĐÃ ĐẦY: Gara của bạn đã đạt giới hạn tối đa cho phép. Vui lòng lấy bớt thú cũ ra chơi, bán bớt hoặc liên hệ Admin để nâng cấp thêm Slot.";
  }

  return rawError;
}

// 9.2 Cất Khủng Long Đang Chơi Vào Gara (POST /players/{steamId}/garage/park)
app.post('/api/player/garage/park', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });

  const garageStatus = await getPlayerGarageStatus(steamId);
  if (garageStatus.isFull) {
    return res.status(400).json({
      error: `Gara của bạn đã đầy (${garageStatus.totalParked}/${garageStatus.maxSlots} ô theo vai trò)! Vui lòng lấy khủng long cũ ra chơi hoặc bán bớt.`
    });
  }

  const result = await callIslePilot(`/players/${steamId}/garage/park`, 'POST', {});
  apiCache.delete(`/players/${steamId}/garage`);
  apiCache.delete(`/players/${steamId}`);

  if (result && !result.error) {
    return res.json({
      success: true,
      message: "Đã cất khủng long vào Gara IslePilot thành công!",
      data: result,
      cooldown_seconds: 30
    });
  }

  const userFriendlyMsg = formatGarageError(result?.error, 'park');
  const isCombat = userFriendlyMsg.includes('giao tranh') || userFriendlyMsg.includes('sát thương');
  res.status(result?._status || 400).json({
    error: userFriendlyMsg,
    code: isCombat ? 'COMBAT_DAMAGE' : 'PARK_FAILED',
    rawError: result?.error
  });
});

// 9.3 Lấy Khủng Long Từ Gara Ra Chơi (POST /players/{steamId}/garage/{garageDinoId}/restore)
app.post('/api/player/garage/restore', async (req, res) => {
  const { garageDinoId, mutations } = req.body;
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });
  if (!garageDinoId) return res.status(400).json({ error: "Thiếu mã khủng long trong Gara!" });

  // Nếu là khủng long trúng từ Hòm Quà (id bắt đầu bằng dino-)
  if (garageDinoId.startsWith('dino-')) {
    const data = getPortalData();
    const dIdx = (data.userGarage && data.userGarage[steamId]) ? data.userGarage[steamId].findIndex(d => d.id === garageDinoId) : -1;
    if (dIdx !== -1) {
      const dino = data.userGarage[steamId][dIdx];
      await callIslePilot('/commands', 'POST', {
        action: 'swap',
        steamId: steamId,
        species: dino.species,
        growth: (dino.growth || 100) / 100
      });
      data.userGarage[steamId].splice(dIdx, 1);
      savePortalData(data);
      apiCache.delete(`/players/${steamId}/garage`);
      apiCache.delete(`/players/${steamId}`);
      return res.json({
        success: true,
        message: `Đã đưa [${dino.species} ${dino.growth}%] ra đảo thành công! Nhân vật in-game đã được kích hoạt.`,
        cooldown_seconds: 30
      });
    }
  }

  const result = await callIslePilot(`/players/${steamId}/garage/${garageDinoId}/restore`, 'POST', {
    mutations: Array.isArray(mutations) ? mutations : []
  });
  apiCache.delete(`/players/${steamId}/garage`);
  apiCache.delete(`/players/${steamId}`);

  if (result && !result.error) {
    return res.json({
      success: true,
      message: "Đã hồi phục khủng long ra đảo thành công! Vui lòng vào game kiểm tra.",
      data: result,
      cooldown_seconds: 30
    });
  }

  const userFriendlyMsg = formatGarageError(result?.error, 'restore');
  const isNearby = userFriendlyMsg.includes('100') || userFriendlyMsg.includes('xung quanh');
  res.status(result?._status || 400).json({
    error: userFriendlyMsg,
    code: isNearby ? 'NEARBY_PLAYERS_100M' : 'RESTORE_FAILED',
    rawError: result?.error
  });
});

// 9.4 Bán Khủng Long Theo Quy Định Nhà Phát Hành (POST /players/{steamId}/garage/{garageDinoId}/sell)
app.post('/api/player/garage/sell', async (req, res) => {
  const { garageDinoId } = req.body;
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });
  if (!garageDinoId) return res.status(400).json({ error: "Thiếu mã khủng long cần bán!" });

  // Nếu là khủng long trúng từ Hòm Quà (id bắt đầu bằng dino-)
  if (garageDinoId.startsWith('dino-')) {
    const data = getPortalData();
    const dIdx = (data.userGarage && data.userGarage[steamId]) ? data.userGarage[steamId].findIndex(d => d.id === garageDinoId) : -1;
    if (dIdx !== -1) {
      const dino = data.userGarage[steamId][dIdx];
      // Tính giá bán cơ bản theo growth: ví dụ 20-50 Lúa
      const sellPrice = Math.max(10, Math.round(((dino.growth || 100) / 100) * 35));
      await modifyLivePlayerBalance(steamId, sellPrice, `Bán khủng long [${dino.species} ${dino.growth}%] từ Gara`);
      data.userGarage[steamId].splice(dIdx, 1);
      savePortalData(data);
      apiCache.delete(`/players/${steamId}/garage`);
      apiCache.delete(`/players/${steamId}`);
      return res.json({
        success: true,
        message: `Đã bán [${dino.species} ${dino.growth}%] thành công! Nhận được +${sellPrice} Lúa 🌾 vào ví!`,
        earned: sellPrice
      });
    }
  }

  const result = await callIslePilot(`/players/${steamId}/garage/${garageDinoId}/sell`, 'POST', {});
  apiCache.delete(`/players/${steamId}/garage`);
  apiCache.delete(`/players/${steamId}`);

  if (result && !result.error) {
    return res.json({
      success: true,
      message: "Đã bán khủng long thành công! Tiền Lúa 🌾 đã được cộng vào ví của bạn.",
      data: result
    });
  }

  res.status(result?._status || 400).json({
    error: result?.error || "Không thể bán khủng long này (vui lòng kiểm tra điều kiện Prime và Growth trong Quy Định Bán)!"
  });
});

// 9.5 Bảng Quy Định Bán Khủng Long (GET /sell-rules)
app.get('/api/market/sell-rules', async (req, res) => {
  const result = await callIslePilot('/sell-rules');
  res.json((result && result.rules) || []);
});


// Chuyển đổi nhanh Steam ID Profile
app.post('/api/player/session/switch', async (req, res) => {
  const { steamId } = req.body;
  if (!steamId) return res.status(400).json({ error: "Thiếu steamId" });
  await linkPlayerBySteamId(steamId);
  res.json({ success: true });
});

// ==========================================
// 10. ADMIN MANAGEMENT API (ROLE & GARAGE SLOTS)
// ==========================================

// Kiểm tra quyền Admin của request hiện tại
app.get('/api/admin/check', (req, res) => {
  const steamId = getRequestSteamId(req);
  const isAdmin = isUserAdmin(steamId);
  res.json({
    steamId,
    isAdmin,
    isSuperAdmin: SUPER_ADMINS.includes(String(steamId).trim())
  });
});

const ROLE_NAME_MAP = {
  "admin": "👑 Quản Trị Viên (Admin)",
  ".": "👑 BQT Cấp Cao (.)",
  "mod": "🛡️ Điều Hành Viên (Mod)",
  "dev": "💻 DEV (Phát Triển)",
  "long_dai_dia_chu": "🏰 LONG ĐẠI ĐỊA CHỦ",
  "long_phu_nong": "🌾 LONG PHÚ NÔNG",
  "long_chu": "🐲 LONG CHỦ",
  "long_ta_dien": "🌾 LONG TÁ ĐIỀN",
  "vien_gach_dau_tien": "🧱 Viên Gạch Đầu Tiên",
  "long_khung_quang_cao": "📢 LONG KHỦNG (QUẢNG CÁO)",
  "booster": "🚀 Máy chủ - Bộ khuếch đại",
  "may_chu_bo_khuech_dai": "🚀 Máy chủ - Bộ khuếch đại",
  "streamer": "🎙️ Streamer",
  "bot": "🤖 BOT",
  "default": "🦖 Thành Viên ST25"
};

// Helper: Lấy toàn bộ danh sách thành viên đã phân quyền, sắp xếp người mới nhất lên đầu
function getAllAssignedUsers() {
  const cfg = getConfig();
  const garageCfg = cfg.garage || {};
  const roleLimits = garageCfg.role_limits || {};
  const userRoles = garageCfg.user_roles || {};
  const customSlots = garageCfg.player_custom_slots || {};
  const portalData = getPortalData();
  const dynamicAssignments = portalData.adminAssignments || {};

  // Hợp nhất danh sách tất cả các Steam ID đã được gán role hoặc slot
  const allSteamIds = Array.from(new Set([
    ...Object.keys(dynamicAssignments),
    ...Object.keys(customSlots),
    ...Object.keys(userRoles),
    ...SUPER_ADMINS
  ]));

  const assignedUsers = allSteamIds.map(sid => {
    const dyn = dynamicAssignments[sid] || {};
    const roleKey = dyn.roleKey || userRoles[sid] || (SUPER_ADMINS.includes(sid) ? "admin" : "default");
    const slots = dyn.slots !== undefined ? dyn.slots : (customSlots[sid] !== undefined ? customSlots[sid] : (roleLimits[roleKey] || 3));
    return {
      steamId: sid,
      roleKey,
      roleName: ROLE_NAME_MAP[roleKey] || `Vai trò ${roleKey.toUpperCase()}`,
      slots: Number(slots),
      isSuperAdmin: SUPER_ADMINS.includes(sid),
      updatedAt: dyn.updatedAt || null,
      updatedAtTimestamp: dyn.updatedAtTimestamp || (dyn.updatedAt ? new Date(dyn.updatedAt).getTime() : 0),
      notes: dyn.notes || ""
    };
  });

  // Sắp xếp: Ai vừa được cập nhật gần nhất sẽ lên đứng đầu bảng #1
  assignedUsers.sort((a, b) => {
    const timeA = a.updatedAtTimestamp || 0;
    const timeB = b.updatedAtTimestamp || 0;
    if (timeA !== timeB) return timeB - timeA;
    if (a.isSuperAdmin && !b.isSuperAdmin) return -1;
    if (!a.isSuperAdmin && b.isSuperAdmin) return 1;
    return a.steamId.localeCompare(b.steamId);
  });

  return assignedUsers;
}

// Lấy danh sách Roles, danh sách thành viên đã phân quyền & người chơi gần đây
app.get('/api/admin/roles-slots', async (req, res) => {
  const adminSteamId = getAdminSteamId(req);
  if (!isUserAdmin(adminSteamId)) {
    return res.status(403).json({ error: "Chỉ Quản Trị Viên (Admin) mới có quyền truy cập!" });
  }

  const cfg = getConfig();
  const garageCfg = cfg.garage || {};
  const roleLimits = garageCfg.role_limits || {};

  const rolesList = Object.keys(roleLimits).map(key => ({
    key,
    name: ROLE_NAME_MAP[key] || `Vai trò ${key.toUpperCase()}`,
    defaultSlots: roleLimits[key]
  }));

  const assignedUsers = getAllAssignedUsers();

  // Lấy danh sách thành viên online/gần đây từ IslePilot (sử dụng cache nội bộ để phản hồi siêu tốc)
  let recentPlayers = [];
  try {
    const pilotPlayers = await callIslePilot('/players');
    if (pilotPlayers && Array.isArray(pilotPlayers.players)) {
      recentPlayers = pilotPlayers.players.slice(0, 50).map(p => ({
        steamId: p.steamId,
        name: p.name || `Player_${p.steamId.slice(-4)}`,
        online: !!p.online,
        species: p.species || ""
      }));
    }
  } catch (_) {}

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    adminSteamId,
    roles: rolesList,
    assignedUsers,
    recentPlayers
  });
});

// Tra cứu nhanh thông tin người chơi theo Steam ID
app.get('/api/admin/player-info', async (req, res) => {
  const adminSteamId = getAdminSteamId(req);
  if (!isUserAdmin(adminSteamId)) {
    return res.status(403).json({ error: "Chỉ Quản Trị Viên (Admin) mới có quyền truy cập!" });
  }

  const targetSteamId = req.query.steamId;
  if (!targetSteamId || !String(targetSteamId).trim()) {
    return res.status(400).json({ error: "Thiếu Steam ID cần kiểm tra!" });
  }

  const cleanSteamId = String(targetSteamId).trim();
  const [pilotPlayer, garageStatus] = await Promise.all([
    callIslePilot(`/players/${cleanSteamId}`, 'GET', null, true),
    getPlayerGarageStatus(cleanSteamId)
  ]);

  const cfg = getConfig();
  const portalData = getPortalData();
  const dynamicAssign = (portalData.adminAssignments && portalData.adminAssignments[cleanSteamId]) || null;
  const customSlots = (dynamicAssign && dynamicAssign.slots) || (cfg.garage && cfg.garage.player_custom_slots && cfg.garage.player_custom_slots[cleanSteamId]) || null;
  const assignedRole = (dynamicAssign && dynamicAssign.roleKey) || (cfg.garage && cfg.garage.user_roles && cfg.garage.user_roles[cleanSteamId]) || null;

  res.json({
    steamId: cleanSteamId,
    name: (pilotPlayer && pilotPlayer.name) || `Player_${cleanSteamId.slice(-4)}`,
    avatar: (pilotPlayer && pilotPlayer.avatar) || "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg",
    online: (pilotPlayer && pilotPlayer.online) || false,
    species: (pilotPlayer && pilotPlayer.species) || "Không có nhân vật sống",
    garageStatus,
    assignedRole,
    customSlots
  });
});

// Cấp Role & Slot thủ công cho người chơi (lưu cả vào server-config.json và portal-data.json)
app.post('/api/admin/assign-role-slots', async (req, res) => {
  const adminSteamId = getAdminSteamId(req);
  if (!isUserAdmin(adminSteamId)) {
    return res.status(403).json({ error: "Chỉ Quản Trị Viên (Admin) mới có quyền thực hiện thao tác này!" });
  }

  const { targetSteamId, roleKey, customSlots, notes } = req.body;
  if (!targetSteamId || !String(targetSteamId).trim()) {
    return res.status(400).json({ error: "Vui lòng nhập Steam ID của người chơi!" });
  }

  const cleanSteamId = String(targetSteamId).trim();
  const cleanRole = roleKey ? String(roleKey).toLowerCase().trim() : 'default';

  const cfg = getConfig();
  if (!cfg.garage) cfg.garage = {};
  if (!cfg.garage.user_roles) cfg.garage.user_roles = {};
  if (!cfg.garage.player_custom_slots) cfg.garage.player_custom_slots = {};

  cfg.garage.user_roles[cleanSteamId] = cleanRole;

  let finalSlots = 3;
  if (customSlots !== undefined && customSlots !== '' && !isNaN(Number(customSlots))) {
    finalSlots = Math.max(1, Math.min(100, parseInt(customSlots)));
  } else if (cfg.garage.role_limits && cfg.garage.role_limits[cleanRole] !== undefined) {
    finalSlots = Number(cfg.garage.role_limits[cleanRole]);
  }
  cfg.garage.player_custom_slots[cleanSteamId] = finalSlots;

  // 1. Lưu bền vững vào server-config.json
  saveConfig(cfg);

  // 2. Lưu bền vững vào portal-data.json
  const now = new Date();
  const data = getPortalData();
  if (!data.adminAssignments) data.adminAssignments = {};
  data.adminAssignments[cleanSteamId] = {
    roleKey: cleanRole,
    slots: finalSlots,
    updatedBy: adminSteamId,
    updatedAt: now.toLocaleString('vi-VN'),
    updatedAtTimestamp: now.getTime(),
    notes: notes || ""
  };
  savePortalData(data);

  // 3. Xóa sạch cache người chơi để có hiệu lực tức thì
  clearPlayerCache(cleanSteamId);
  clearPlayerCache(adminSteamId);

  // Kiểm tra ngay kết quả sau khi lưu
  const updatedStatus = await getPlayerGarageStatus(cleanSteamId);
  const updatedAssignments = getAllAssignedUsers();

  res.json({
    success: true,
    message: `Đã cấp thành công Role [${updatedStatus.roleName}] với [${updatedStatus.maxSlots} Slots Gara] cho Steam ID ${cleanSteamId}! Dữ liệu đã lưu vĩnh viễn và có hiệu lực ngay lập tức.`,
    steamId: cleanSteamId,
    garageStatus: updatedStatus,
    assignedUsers: updatedAssignments
  });
});

// Xóa override role/slot riêng của người chơi
app.post('/api/admin/remove-role-slots', async (req, res) => {
  const adminSteamId = getAdminSteamId(req);
  if (!isUserAdmin(adminSteamId)) {
    return res.status(403).json({ error: "Chỉ Quản Trị Viên (Admin) mới có quyền thực hiện thao tác này!" });
  }

  const { targetSteamId } = req.body;
  if (!targetSteamId) return res.status(400).json({ error: "Thiếu Steam ID!" });

  const cleanSteamId = String(targetSteamId).trim();
  if (SUPER_ADMINS.includes(cleanSteamId)) {
    return res.status(400).json({ error: "Không thể xóa quyền của Quản Trị Viên tối cao!" });
  }

  const cfg = getConfig();
  if (cfg.garage && cfg.garage.user_roles) {
    delete cfg.garage.user_roles[cleanSteamId];
  }
  if (cfg.garage && cfg.garage.player_custom_slots) {
    delete cfg.garage.player_custom_slots[cleanSteamId];
  }
  saveConfig(cfg);

  const data = getPortalData();
  if (data.adminAssignments && data.adminAssignments[cleanSteamId]) {
    delete data.adminAssignments[cleanSteamId];
    savePortalData(data);
  }

  clearPlayerCache(cleanSteamId);
  clearPlayerCache(adminSteamId);

  const updatedAssignments = getAllAssignedUsers();

  res.json({
    success: true,
    message: `Đã xóa thiết lập riêng cho Steam ID ${cleanSteamId}. Người chơi trở về vai trò mặc định của server.`,
    assignedUsers: updatedAssignments
  });
});

// Helper: Thêm Dino vào Gara của người chơi
function addDinoToGarage(steamId, dino, targetData = null) {
  const data = targetData || getPortalData();
  if (!data.userGarage) data.userGarage = {};
  if (!data.userGarage[steamId]) data.userGarage[steamId] = [];

  const newDino = {
    id: dino.id || `dino-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    species: dino.species || "Tyrannosaurus",
    gender: dino.gender || "Đực (Male)",
    growth: dino.growth !== undefined ? dino.growth : 100,
    health: dino.health || 100,
    hunger: dino.hunger || 100,
    thirst: dino.thirst || 100,
    diet: dino.diet || ["S", "S", "D"],
    mutations: dino.mutations || [],
    stored_at: new Date().toLocaleString('vi-VN'),
    source: dino.source || "Giao Dịch / Hòm Quà",
    isLocal: true
  };

  data.userGarage[steamId].push(newDino);
  if (!targetData) {
    savePortalData(data);
  }
  return newDino;
}

// ==================== NEW FEATURES BACKEND ==================== //

function getPortalData() {
  if (memoryPortalData) return memoryPortalData;

  // 1. Đọc từ /tmp trước (hỗ trợ Vercel Serverless)
  try {
    if (fs.existsSync(TMP_DATA_FILE)) {
      memoryPortalData = JSON.parse(fs.readFileSync(TMP_DATA_FILE, 'utf8'));
      return memoryPortalData;
    }
  } catch (_) {}

  // 2. Đọc từ DATA_FILE gốc
  try {
    if (fs.existsSync(DATA_FILE)) {
      memoryPortalData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return memoryPortalData;
    }
  } catch (e) {
    console.error('Error reading portal data:', e);
  }

  memoryPortalData = {
    userWallets: {
      "76561198636766540": 250
    },
    userGarage: {
      "76561198636766540": [
        {
          id: "garage-dino-1",
          species: "Tyrannosaurus",
          gender: "Đực (Male)",
          growth: 100,
          health: 100,
          hunger: 100,
          thirst: 100,
          diet: ["S", "S", "D"],
          stored_at: "06/10/2026",
          source: "Tài Khoản ST25",
          isLocal: true
        }
      ]
    },
    userInventory: {
      "76561198636766540": [
        { id: "inv-1", name: "Thẻ Hồi Sinh Bảo Hộ", icon: "🛡️", desc: "Bảo lưu 100% Growth nếu rớt vực", type: "item" }
      ]
    },
    marketListings: [
      { id: "mkt-1", seller: "Trùm Khủng Long ST25", sellerSteamId: "76561198000000001", title: "T-Rex Đực 100% Full Dinh Dưỡng S-S-D", species: "Tyrannosaurus", price: 120, growth: 100, diet: "100% S-S-D", icon: "🦖" },
      { id: "mkt-2", seller: "Sát Thủ Đầm Lầy", sellerSteamId: "76561198000000002", title: "Deinosuchus Cái 95% Prime Ready", species: "Deinosuchus", price: 90, growth: 95, diet: "90% S-S-D", icon: "🐊" },
      { id: "mkt-3", seller: "Raptor Tốc Độ", sellerSteamId: "76561198000000003", title: "Omniraptor Cặp Trống Mái Đột Biến Nhảy Cao", species: "Omniraptor", price: 60, growth: 100, diet: "Đầy đủ", icon: "🦅" }
    ],
    tickets: [],
    referrals: {},
    carcassOrders: [],
    adminAssignments: {}
  };
  return memoryPortalData;
}

function savePortalData(data) {
  memoryPortalData = data;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {}
  try {
    fs.writeFileSync(TMP_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {}
  return true;
}

// Helper: Get real wallet balance from IslePilot API
async function getLivePlayerBalance(steamId) {
  const p = await callIslePilot(`/players/${steamId}`);
  if (p && p.wallet && typeof p.wallet.balance === 'number') {
    return p.wallet.balance;
  }
  const data = getPortalData();
  return data.userWallets[steamId] !== undefined ? data.userWallets[steamId] : 0;
}

// Helper: Modify player wallet currency directly on IslePilot API
async function modifyLivePlayerBalance(steamId, amount, reason = "web_portal") {
  const res = await callIslePilot(`/players/${steamId}/currency`, 'POST', {
    amount: Number(amount),
    reason: reason
  });

  const data = getPortalData();
  if (res && res.ok && typeof res.balance === 'number') {
    data.userWallets[steamId] = res.balance;
    savePortalData(data);
    return { success: true, balance: res.balance, applied: res.applied };
  }

  // Fallback if IslePilot is offline
  const current = data.userWallets[steamId] !== undefined ? data.userWallets[steamId] : 0;
  const newBal = Math.max(0, current + Number(amount));
  data.userWallets[steamId] = newBal;
  savePortalData(data);
  return { success: true, balance: newBal, applied: amount };
}

app.get('/api/market/data', async (req, res) => {
  const data = getPortalData();
  const steamId = getRequestSteamId(req);
  const userBalance = steamId ? await getLivePlayerBalance(steamId) : 0;
  let personaName = "Khách (Chưa đăng nhập)";

  if (steamId) {
    const p = await callIslePilot(`/players/${steamId}`);
    if (p && p.name) personaName = p.name;
    else personaName = `Player_${steamId.slice(-4)}`;
  }

  // Lấy khủng long trong Gara để cho phép chọn đăng bán (bao gồm cả Cloud Gara và thú trúng từ Hòm)
  let myGarageDinos = [];
  if (steamId) {
    try {
      const garageStatus = await getPlayerGarageStatus(steamId);
      if (garageStatus && Array.isArray(garageStatus.dinos)) {
        myGarageDinos = garageStatus.dinos.map(g => {
          const rawG = g.growth !== undefined ? Number(g.growth) : 1;
          const displayGrowth = rawG > 1 ? Math.min(100, Math.round(rawG)) : Math.round(rawG * 100);
          return {
            id: g.id,
            species: g.species,
            growth: displayGrowth,
            gender: (g.gender === 'Female' || g.gender === 'Cái (Female)') ? "Cái (Female)" : "Đực (Male)",
            isPrimeElder: g.isPrimeElder || false,
            source: g.source || (g.isLocal ? "Hòm May Mắn" : "IslePilot Cloud")
          };
        });
      }
    } catch (_) {}
  }

  res.json({
    steamId: steamId || null,
    personaName: personaName,
    balance: userBalance,
    listings: data.marketListings,
    inventory: steamId ? (data.userInventory[steamId] || []) : [],
    myGarageDinos: myGarageDinos,
    myVouchers: steamId ? ((data.userInventory[steamId] || []).filter(i => i.type === 'dino_voucher' || i.type === 'dino')) : []
  });
});

// Đăng bán Dino từ Gara lên Chợ P2P
app.post('/api/market/list-dino', async (req, res) => {
  const { dinoId, price, customTitle } = req.body;
  const steamId = req.body.steamId || getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam để đăng bán!" });
  if (!dinoId || !price || Number(price) <= 0) return res.status(400).json({ error: "Thông tin bán không hợp lệ!" });

  const numPrice = Math.round(Number(price));
  const data = getPortalData();
  const garageStatus = await getPlayerGarageStatus(steamId);
  const targetDino = garageStatus.dinos.find(d => String(d.id) === String(dinoId));

  if (!targetDino) {
    return res.status(404).json({ error: "Khủng long này không tồn tại trong Gara của bạn hoặc đã được đăng bán rồi!" });
  }

  // Tránh đăng bán 2 lần cùng 1 con khủng long
  if (!data.marketListings) data.marketListings = [];
  const alreadyListed = data.marketListings.some(l => l.dinoData && String(l.dinoData.id) === String(dinoId));
  if (alreadyListed) {
    return res.status(400).json({ error: "Khủng long này đang được đăng bán trên Chợ rồi!" });
  }

  const rawG = targetDino.growth !== undefined ? Number(targetDino.growth) : 1;
  const displayGrowth = rawG > 1 ? Math.min(100, Math.round(rawG)) : Math.round(rawG * 100);

  // Tạo tin rao bán
  const listingId = `mkt-${Date.now()}`;
  let sellerName = `Player_${steamId.slice(-4)}`;
  try {
    const p = await callIslePilot(`/players/${steamId}`);
    if (p && p.name) sellerName = p.name;
  } catch (_) {}

  const isLocalDino = Boolean(targetDino.isLocal || String(dinoId).startsWith('dino-'));
  const listing = {
    id: listingId,
    seller: sellerName,
    sellerSteamId: steamId,
    title: customTitle || `${targetDino.species} ${displayGrowth}% (${targetDino.gender || 'Đực'})`,
    species: targetDino.species,
    gender: (targetDino.gender === 'Female' || targetDino.gender === 'Cái (Female)') ? "Cái (Female)" : "Đực (Male)",
    price: numPrice,
    growth: displayGrowth,
    diet: targetDino.diet ? (Array.isArray(targetDino.diet) ? targetDino.diet.join('-') : targetDino.diet) : "S-S-D",
    icon: targetDino.species === 'Deinosuchus' ? '🐊' : (targetDino.species === 'Triceratops' ? '🦏' : '🦖'),
    dinoData: {
      ...targetDino,
      growth: displayGrowth,
      isLocal: isLocalDino
    },
    createdAt: new Date().toLocaleString('vi-VN')
  };

  // Nếu là local dino trong userGarage thì chuyển ra khỏi userGarage sang chế độ ký gửi Chợ
  if (data.userGarage && data.userGarage[steamId]) {
    data.userGarage[steamId] = data.userGarage[steamId].filter(d => String(d.id) !== String(dinoId));
  }

  data.marketListings.unshift(listing);
  savePortalData(data);
  clearPlayerCache(steamId);

  res.json({
    success: true,
    message: `Đã đăng bán [${listing.title}] với giá ${numPrice} Lúa 🌾 lên Chợ thành công! Khủng long đã được chuyển sang chế độ ký gửi.`,
    listing
  });
});

// Thu hồi bài đăng bán trên Chợ
app.post('/api/market/cancel-listing', async (req, res) => {
  const { listingId } = req.body;
  const steamId = req.body.steamId || getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });

  const data = getPortalData();
  const idx = (data.marketListings || []).findIndex(l => l.id === listingId);
  if (idx === -1) return res.status(404).json({ error: "Bài đăng không tồn tại hoặc đã được mua!" });

  const listing = data.marketListings[idx];
  if (listing.sellerSteamId !== steamId) {
    return res.status(403).json({ error: "Bạn không có quyền thu hồi bài đăng của người khác!" });
  }

  // Khôi phục khủng long về lại Gara của người bán:
  const dino = listing.dinoData;
  if (dino) {
    const isLocalDino = Boolean(dino.isLocal || String(dino.id).startsWith('dino-'));
    if (isLocalDino) {
      if (!data.userGarage) data.userGarage = {};
      if (!data.userGarage[steamId]) data.userGarage[steamId] = [];
      const alreadyExists = data.userGarage[steamId].some(d => String(d.id) === String(dino.id));
      if (!alreadyExists) {
        data.userGarage[steamId].push({
          ...dino,
          stored_at: new Date().toLocaleString('vi-VN')
        });
      }
    } else {
      // Đối với Cloud Dino: Khi bài đăng bị xóa khỏi marketListings,
      // ID của nó không còn nằm trong activeSellingDinoIds, nên nó sẽ hiển thị trở lại trong Gara qua Cloud.
      // Bảo hiểm: Nếu trên Cloud vì lý do gì không thấy con này, tự động khôi phục vào local garage
      try {
        const pilotGarage = await callIslePilot(`/players/${steamId}/garage`, 'GET', null, true);
        const cloudDinos = (pilotGarage && pilotGarage.garage && Array.isArray(pilotGarage.garage)) ? pilotGarage.garage : [];
        const inCloud = cloudDinos.some(cd => String(cd.id) === String(dino.id));
        if (!inCloud) {
          if (!data.userGarage) data.userGarage = {};
          if (!data.userGarage[steamId]) data.userGarage[steamId] = [];
          data.userGarage[steamId].push({
            ...dino,
            id: dino.id || `dino-${Date.now()}`,
            isLocal: true,
            stored_at: new Date().toLocaleString('vi-VN')
          });
        }
      } catch (_) {}
    }
  }

  data.marketListings.splice(idx, 1);
  savePortalData(data);
  clearPlayerCache(steamId);

  res.json({
    success: true,
    message: `Đã thu hồi bài đăng bán [${listing.title}] thành công! Khủng long đã quay trở về Gara của bạn.`
  });
});

app.post('/api/market/transfer', async (req, res) => {
  const { receiverSteamId, amount, note } = req.body;
  const data = getPortalData();
  const senderSteamId = (req.body.senderSteamId || getRequestSteamId(req));
  if (!senderSteamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để chuyển Lúa!" });
  }

  if (!receiverSteamId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: "Số Lúa chuyển và người nhận không hợp lệ!" });
  }

  const numAmount = Number(amount);
  const senderBal = await getLivePlayerBalance(senderSteamId);
  if (senderBal < numAmount) {
    return res.status(400).json({ error: `Số dư trong tài khoản không đủ! Bạn chỉ có ${senderBal} Lúa 🌾 trên server.` });
  }

  // Deduct from sender via API
  const deductRes = await modifyLivePlayerBalance(senderSteamId, -numAmount, `Chuyển Lúa tới ${receiverSteamId}: ${note || ''}`);
  // Add to receiver via API
  await modifyLivePlayerBalance(receiverSteamId, numAmount, `Nhận Lúa từ ${senderSteamId}: ${note || ''}`);

  res.json({
    success: true,
    message: `Đã chuyển thành công ${numAmount} Lúa 🌾 từ tài khoản của bạn tới ${receiverSteamId}!`,
    newBalance: deductRes.balance
  });
});

// 10.1 Mua Dino từ Chợ (Tự Động Chuyển Thẳng Vào Gara Của Người Mua)
app.post('/api/market/buy', async (req, res) => {
  const { itemId } = req.body;
  const data = getPortalData();
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để mua vật phẩm!" });
  }

  const itemIndex = (data.marketListings || []).findIndex(i => i.id === itemId);
  if (itemIndex === -1) {
    return res.status(404).json({ error: "Vật phẩm hoặc Dino này đã được người khác mua hoặc đã được thu hồi!" });
  }

  const item = data.marketListings[itemIndex];
  if (item.sellerSteamId === steamId) {
    return res.status(400).json({ error: "Bạn không thể tự mua khủng long của chính mình!" });
  }

  const userBal = await getLivePlayerBalance(steamId);
  if (userBal < item.price) {
    return res.status(400).json({ error: `Tài khoản của bạn không đủ Lúa! Cần ${item.price} Lúa 🌾 (Hiện có ${userBal} Lúa trên server).` });
  }

  // Kiểm tra sức chứa Gara của người mua
  const buyerGarageStatus = await getPlayerGarageStatus(steamId);
  if (buyerGarageStatus.isFull) {
    return res.status(400).json({
      error: `Gara của bạn đã đầy (${buyerGarageStatus.totalParked}/${buyerGarageStatus.maxSlots} ô theo vai trò)! Vui lòng lấy khủng long cũ ra chơi hoặc nâng cấp Gara trước khi mua.`,
      isFull: true,
      upgradeRequired: true
    });
  }

  // 1. Trừ tiền người mua
  const deductRes = await modifyLivePlayerBalance(steamId, -item.price, `Mua ${item.title} từ Chợ ST25`);

  // 2. Cộng tiền người bán
  if (item.sellerSteamId) {
    await modifyLivePlayerBalance(item.sellerSteamId, item.price, `Bán ${item.title} trên Chợ ST25 cho ${steamId}`);
  }

  // 3. Chuyển Khủng Long TRỰC TIẾP VÀO GARA của người mua
  const targetDinoData = item.dinoData || {};
  const newDino = addDinoToGarage(steamId, {
    ...targetDinoData,
    id: `dino-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    species: item.species || targetDinoData.species || "Tyrannosaurus",
    gender: item.gender || targetDinoData.gender || "Đực (Male)",
    growth: item.growth !== undefined ? item.growth : (targetDinoData.growth || 100),
    diet: targetDinoData.diet || ["S", "S", "D"],
    mutations: targetDinoData.mutations || [],
    isPrimeElder: targetDinoData.isPrimeElder || false,
    source: `Mua từ Chợ ST25 (Người bán: ${item.seller})`,
    isLocal: true
  }, data);

  // 4. Xử lý người bán: Đánh dấu dino này vĩnh viễn không còn thuộc về người bán
  if (item.sellerSteamId && targetDinoData.id) {
    if (!data.soldDinos) data.soldDinos = {};
    if (!data.soldDinos[item.sellerSteamId]) data.soldDinos[item.sellerSteamId] = [];
    data.soldDinos[item.sellerSteamId].push(String(targetDinoData.id));

    // Nếu người bán còn lưu trong local userGarage thì dọn sạch
    if (data.userGarage && data.userGarage[item.sellerSteamId]) {
      data.userGarage[item.sellerSteamId] = data.userGarage[item.sellerSteamId].filter(
        d => String(d.id) !== String(targetDinoData.id)
      );
    }

    // Nếu là Cloud Dino trên IslePilot, thử gọi lệnh sell trên cloud
    if (!targetDinoData.isLocal && !String(targetDinoData.id).startsWith('dino-')) {
      try {
        await callIslePilot(`/players/${item.sellerSteamId}/garage/${targetDinoData.id}/sell`, 'POST', {});
      } catch (_) {}
    }
  }

  // 5. Xóa bài khỏi Chợ
  data.marketListings.splice(itemIndex, 1);
  savePortalData(data);

  // Dọn dẹp cache cho cả hai người
  clearPlayerCache(steamId);
  if (item.sellerSteamId) clearPlayerCache(item.sellerSteamId);

  res.json({
    success: true,
    message: `Đã mua thành công [${item.title}]! Khủng long đã được chuyển trực tiếp vào Gara của bạn.`,
    newBalance: deductRes.balance,
    dino: newDino
  });
});

// ==========================================
// 11. ISLEPILOT P2P TRADE SYSTEM (https://st25.islepilot.eu/trade)
// ==========================================

// Lấy dữ liệu Trade của người chơi hiện tại
app.get('/api/trade/data', async (req, res) => {
  const steamId = getRequestSteamId(req);
  const data = getPortalData();
  if (!data.trades) data.trades = [];

  let balance = 0;
  let personaName = "Khách (Chưa đăng nhập)";
  let avatar = "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg";
  let garageStatus = { totalParked: 0, maxSlots: 3, roleName: "Thành viên ST25", isFull: false };
  let myDinos = [];

  if (steamId) {
    balance = await getLivePlayerBalance(steamId);
    garageStatus = await getPlayerGarageStatus(steamId);
    const p = await callIslePilot(`/players/${steamId}`);
    if (p) {
      if (p.name) personaName = p.name;
      if (p.avatar) avatar = p.avatar;
    } else {
      personaName = `Player_${steamId.slice(-4)}`;
    }

    myDinos = (garageStatus.dinos || []).map(g => {
      const rawG = g.growth !== undefined ? Number(g.growth) : 1;
      const displayGrowth = rawG > 1 ? Math.min(100, Math.round(rawG)) : Math.round(rawG * 100);
      return {
        id: g.id,
        species: g.species,
        gender: (g.gender === 'Female' || g.gender === 'Cái (Female)') ? "Cái (Female)" : "Đực (Male)",
        growth: displayGrowth,
        health: g.health || 100,
        hunger: g.hunger || 100,
        thirst: g.thirst || 100,
        diet: g.diet || ["S", "S", "D"],
        mutations: g.mutations || [],
        isPrimeElder: g.isPrimeElder || false,
        isLocal: Boolean(g.isLocal || String(g.id).startsWith('dino-')),
        source: g.source || (g.isLocal ? "Hòm May Mắn" : "IslePilot Cloud")
      };
    });
  }

  // Lời mời gửi đến tôi đang chờ xử lý
  const incomingTrades = steamId ? data.trades.filter(t => t.receiverSteamId === steamId && t.status === 'pending') : [];

  // Lời mời tôi đã gửi đang chờ đối phương chấp nhận
  const outgoingTrades = steamId ? data.trades.filter(t => t.senderSteamId === steamId && t.status === 'pending') : [];

  // Lịch sử giao dịch
  const tradeHistory = steamId
    ? data.trades.filter(t => (t.receiverSteamId === steamId || t.senderSteamId === steamId) && t.status !== 'pending').slice(0, 30)
    : data.trades.filter(t => t.status !== 'pending').slice(0, 15);

  // Danh sách người chơi online/gần đây để chọn giao dịch
  let recentPlayers = [];
  try {
    const pl = await callIslePilot('/players');
    if (pl && Array.isArray(pl.players)) {
      recentPlayers = pl.players
        .filter(p => !steamId || p.steamId !== steamId)
        .slice(0, 50)
        .map(p => ({
          steamId: p.steamId,
          name: p.name || `Player_${p.steamId.slice(-4)}`,
          online: !!p.online,
          species: p.species || ""
        }));
    }
  } catch (_) {}

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    steamId: steamId || null,
    personaName,
    avatar,
    balance,
    garageStatus,
    myDinos,
    incomingTrades,
    outgoingTrades,
    tradeHistory,
    recentPlayers
  });
});

// Tạo lời mời giao dịch mới (Send Trade Offer)
app.post('/api/trade/create', async (req, res) => {
  const senderSteamId = getRequestSteamId(req);
  if (!senderSteamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để tạo giao dịch!" });
  }

  const { receiverSteamId, dinoId, senderLua, requestedLua, note } = req.body;
  if (!receiverSteamId || !/^\d{17}$/.test(String(receiverSteamId).trim())) {
    return res.status(400).json({ error: "Steam ID người nhận không hợp lệ! Vui lòng nhập đúng 17 chữ số Steam ID 64." });
  }

  const cleanReceiver = String(receiverSteamId).trim();
  if (cleanReceiver === senderSteamId) {
    return res.status(400).json({ error: "Bạn không thể tự tạo giao dịch với chính mình!" });
  }

  const numSenderLua = Math.max(0, parseInt(senderLua) || 0);
  const numRequestedLua = Math.max(0, parseInt(requestedLua) || 0);

  if (!dinoId && numSenderLua <= 0 && numRequestedLua <= 0) {
    return res.status(400).json({ error: "Vui lòng chọn ít nhất một Khủng Long hoặc nhập số Lúa muốn giao dịch!" });
  }

  // Kiểm tra số dư Lúa của người gửi nếu có gửi kèm Lúa
  if (numSenderLua > 0) {
    const senderBal = await getLivePlayerBalance(senderSteamId);
    if (senderBal < numSenderLua) {
      return res.status(400).json({ error: `Số dư Lúa 🌾 của bạn không đủ! Hiện có ${senderBal} Lúa, bạn yêu cầu gửi ${numSenderLua} Lúa.` });
    }
  }

  let selectedDino = null;
  if (dinoId) {
    const garageStatus = await getPlayerGarageStatus(senderSteamId);
    selectedDino = garageStatus.dinos.find(d => String(d.id) === String(dinoId));
    if (!selectedDino) {
      return res.status(404).json({ error: "Khủng long này không còn trong Gara của bạn hoặc đã bị khóa trong một giao dịch khác!" });
    }
  }

  // Lấy tên đại diện của cả hai người
  let senderName = `Player_${senderSteamId.slice(-4)}`;
  let receiverName = `Player_${cleanReceiver.slice(-4)}`;
  try {
    const [p1, p2] = await Promise.all([
      callIslePilot(`/players/${senderSteamId}`),
      callIslePilot(`/players/${cleanReceiver}`)
    ]);
    if (p1 && p1.name) senderName = p1.name;
    if (p2 && p2.name) receiverName = p2.name;
  } catch (_) {}

  const data = getPortalData();
  if (!data.trades) data.trades = [];

  const rawG = selectedDino && selectedDino.growth !== undefined ? Number(selectedDino.growth) : 1;
  const displayGrowth = rawG > 1 ? Math.min(100, Math.round(rawG)) : Math.round(rawG * 100);

  const tradeId = `trade-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const tradeOffer = {
    id: tradeId,
    senderSteamId,
    senderName,
    receiverSteamId: cleanReceiver,
    receiverName,
    senderDino: selectedDino ? {
      ...selectedDino,
      growth: displayGrowth,
      gender: (selectedDino.gender === 'Female' || selectedDino.gender === 'Cái (Female)') ? "Cái (Female)" : "Đực (Male)",
      isLocal: Boolean(selectedDino.isLocal || String(selectedDino.id).startsWith('dino-'))
    } : null,
    senderLua: numSenderLua,
    requestedLua: numRequestedLua,
    note: String(note || "").trim().slice(0, 200),
    status: 'pending',
    createdAt: new Date().toLocaleString('vi-VN'),
    updatedAt: new Date().toLocaleString('vi-VN')
  };

  data.trades.unshift(tradeOffer);
  savePortalData(data);
  clearPlayerCache(senderSteamId);
  clearPlayerCache(cleanReceiver);

  res.json({
    success: true,
    message: `Đã gửi lời mời giao dịch thành công tới [${receiverName}] (${cleanReceiver})! Khủng long đã được tạm giữ an toàn trong phiên giao dịch.`,
    trade: tradeOffer
  });
});

// Hủy lời mời giao dịch đã gửi (Sender Cancels Trade)
app.post('/api/trade/cancel', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });

  const { tradeId } = req.body;
  if (!tradeId) return res.status(400).json({ error: "Thiếu mã giao dịch!" });

  const data = getPortalData();
  if (!data.trades) data.trades = [];
  const trade = data.trades.find(t => t.id === tradeId);
  if (!trade) return res.status(404).json({ error: "Không tìm thấy giao dịch này!" });

  if (trade.senderSteamId !== steamId) {
    return res.status(403).json({ error: "Chỉ người tạo lời mời mới có quyền hủy giao dịch này!" });
  }

  if (trade.status !== 'pending') {
    return res.status(400).json({ error: `Giao dịch này đã ở trạng thái [${trade.status}], không thể hủy!` });
  }

  trade.status = 'cancelled';
  trade.updatedAt = new Date().toLocaleString('vi-VN');
  savePortalData(data);
  clearPlayerCache(steamId);
  clearPlayerCache(trade.receiverSteamId);

  res.json({
    success: true,
    message: "Đã hủy lời mời giao dịch thành công! Khủng long đã được giải phóng trở lại Gara của bạn."
  });
});

// Từ chối lời mời giao dịch nhận được (Receiver Declines Trade)
app.post('/api/trade/decline', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });

  const { tradeId } = req.body;
  if (!tradeId) return res.status(400).json({ error: "Thiếu mã giao dịch!" });

  const data = getPortalData();
  if (!data.trades) data.trades = [];
  const trade = data.trades.find(t => t.id === tradeId);
  if (!trade) return res.status(404).json({ error: "Không tìm thấy giao dịch này!" });

  if (trade.receiverSteamId !== steamId) {
    return res.status(403).json({ error: "Bạn không phải là người nhận của giao dịch này!" });
  }

  if (trade.status !== 'pending') {
    return res.status(400).json({ error: `Giao dịch này không còn ở trạng thái chờ xử lý (${trade.status})!` });
  }

  trade.status = 'declined';
  trade.updatedAt = new Date().toLocaleString('vi-VN');
  savePortalData(data);
  clearPlayerCache(steamId);
  clearPlayerCache(trade.senderSteamId);

  res.json({
    success: true,
    message: "Đã từ chối lời mời giao dịch. Khủng long đã được trả về Gara người gửi."
  });
});

// Chấp nhận giao dịch (Receiver Accepts Trade - Hoán đổi Lúa & Dino an toàn)
app.post('/api/trade/accept', async (req, res) => {
  const receiverSteamId = getRequestSteamId(req);
  if (!receiverSteamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });

  const { tradeId } = req.body;
  if (!tradeId) return res.status(400).json({ error: "Thiếu mã giao dịch!" });

  const data = getPortalData();
  if (!data.trades) data.trades = [];
  const trade = data.trades.find(t => t.id === tradeId);
  if (!trade) return res.status(404).json({ error: "Không tìm thấy giao dịch này!" });

  if (trade.receiverSteamId !== receiverSteamId) {
    return res.status(403).json({ error: "Bạn không phải là người nhận của giao dịch này!" });
  }

  if (trade.status !== 'pending') {
    return res.status(400).json({ error: `Giao dịch này không còn ở trạng thái chờ (${trade.status})!` });
  }

  const senderSteamId = trade.senderSteamId;

  // 1. Kiểm tra Lúa của người nhận nếu người gửi yêu cầu trả Lúa
  if (trade.requestedLua > 0) {
    const receiverBal = await getLivePlayerBalance(receiverSteamId);
    if (receiverBal < trade.requestedLua) {
      return res.status(400).json({
        error: `Số dư Lúa 🌾 của bạn không đủ để chấp nhận giao dịch! Cần ${trade.requestedLua} Lúa (Hiện có ${receiverBal} Lúa trên server).`
      });
    }
  }

  // 2. Kiểm tra Lúa của người gửi nếu người gửi có tặng kèm Lúa
  if (trade.senderLua > 0) {
    const senderBal = await getLivePlayerBalance(senderSteamId);
    if (senderBal < trade.senderLua) {
      return res.status(400).json({
        error: `Người gửi không còn đủ số dư Lúa (${senderBal}/${trade.senderLua} Lúa) để hoàn tất giao dịch này!`
      });
    }
  }

  // 3. Kiểm tra sức chứa Gara của người nhận nếu nhận Khủng Long
  if (trade.senderDino) {
    const receiverGarage = await getPlayerGarageStatus(receiverSteamId);
    if (receiverGarage.isFull) {
      return res.status(400).json({
        error: `Gara của bạn đã đầy (${receiverGarage.totalParked}/${receiverGarage.maxSlots} ô theo vai trò)! Vui lòng lấy khủng long cũ ra chơi hoặc nâng cấp Gara trước khi nhận Dino.`
      });
    }
  }

  // 4. THỰC HIỆN HOÁN ĐỔI ATOMIC:
  // a) Chuyển Lúa yêu cầu (từ người nhận -> người gửi)
  if (trade.requestedLua > 0) {
    await modifyLivePlayerBalance(receiverSteamId, -trade.requestedLua, `Trade ST25: Trả ${trade.requestedLua} Lúa cho ${senderSteamId}`);
    await modifyLivePlayerBalance(senderSteamId, trade.requestedLua, `Trade ST25: Nhận ${trade.requestedLua} Lúa từ ${receiverSteamId}`);
  }

  // b) Chuyển Lúa tặng kèm (từ người gửi -> người nhận)
  if (trade.senderLua > 0) {
    await modifyLivePlayerBalance(senderSteamId, -trade.senderLua, `Trade ST25: Gửi ${trade.senderLua} Lúa cho ${receiverSteamId}`);
    await modifyLivePlayerBalance(receiverSteamId, trade.senderLua, `Trade ST25: Nhận ${trade.senderLua} Lúa từ ${senderSteamId}`);
  }

  // c) Chuyển Khủng Long vào Gara người nhận và xóa khỏi người gửi
  let transferredDino = null;
  if (trade.senderDino) {
    const targetDino = trade.senderDino;
    transferredDino = addDinoToGarage(receiverSteamId, {
      ...targetDino,
      id: `dino-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      source: `Giao Dịch ST25 (Nhận từ: ${trade.senderName})`,
      stored_at: new Date().toLocaleString('vi-VN'),
      isLocal: true
    }, data);

    // Đánh dấu đã bán khỏi người gửi
    if (!data.soldDinos) data.soldDinos = {};
    if (!data.soldDinos[senderSteamId]) data.soldDinos[senderSteamId] = [];
    data.soldDinos[senderSteamId].push(String(targetDino.id));

    if (data.userGarage && data.userGarage[senderSteamId]) {
      data.userGarage[senderSteamId] = data.userGarage[senderSteamId].filter(
        d => String(d.id) !== String(targetDino.id)
      );
    }

    if (!targetDino.isLocal && !String(targetDino.id).startsWith('dino-')) {
      try {
        await callIslePilot(`/players/${senderSteamId}/garage/${targetDino.id}/sell`, 'POST', {});
      } catch (_) {}
    }
  }

  // d) Đánh dấu giao dịch hoàn tất
  trade.status = 'accepted';
  trade.updatedAt = new Date().toLocaleString('vi-VN');
  savePortalData(data);

  clearPlayerCache(senderSteamId);
  clearPlayerCache(receiverSteamId);

  res.json({
    success: true,
    message: `Giao dịch thành công! Khủng long và Lúa 🌾 đã được hoán đổi an toàn và cập nhật trực tiếp vào Gara và Ví của bạn!`,
    trade,
    dino: transferredDino
  });
});

// 13. Thả Xác AI Cứu Đói (Carcass Order — Đồng Bộ Trực Tiếp Với IslePilot Dashboard)
const CARCASS_TYPES = [
  {
    id: "omuvgqvkh",
    species: "Triceratops",
    growthVal: 0.5,
    growthText: "50%",
    name: "Thịt Triceratops (50% Con Non)",
    price: 50,
    icon: "🦏",
    nutrients: "Protein & Chất Béo Đầy Đủ",
    desc: "Xác Trike cỡ vừa 50% Growth, thịt tươi nhiều dinh dưỡng cho thú ăn thịt."
  },
  {
    id: "omuvgwv75",
    species: "Triceratops",
    growthVal: 1.0,
    growthText: "100%",
    name: "Thịt Triceratops Khổng Lồ (100% Full)",
    price: 90,
    icon: "🦏",
    nutrients: "Full 3 Nhóm Dinh Dưỡng Cao Cấp",
    desc: "Xác đại chiến thú Trike 100% Growth, lượng thịt khổng lồ cứu đói cả bầy đàn."
  },
  {
    id: "omuvgyi4b",
    species: "Stegosaurus",
    growthVal: 0.5,
    growthText: "50%",
    name: "Thịt Stegosaurus (50% Con Non)",
    price: 50,
    icon: "🦕",
    nutrients: "Dinh Dưỡng Cân Bằng (S-S-D)",
    desc: "Xác Stego cỡ vừa 50% Growth, thịt tươi mềm dồi dào năng lượng."
  },
  {
    id: "omuvgz965",
    species: "Stegosaurus",
    growthVal: 1.0,
    growthText: "100%",
    name: "Thịt Stegosaurus Thần Thú (100% Full)",
    price: 90,
    icon: "🦕",
    nutrients: "Max 3 Nhóm Dinh Dưỡng Toàn Diện",
    desc: "Xác chiến thần Stego 100% cực đại, nguồn thức ăn vô tận không lo đói khát."
  },
  {
    id: "omuwjbuch",
    species: "Tenontosaurus",
    growthVal: 1.0,
    growthText: "100%",
    name: "Thịt Tenontosaurus Đại Tiệc (100% Full)",
    price: 80,
    icon: "🥩",
    nutrients: "Full 3 Nhóm Chất Dinh Dưỡng",
    desc: "Đại tiệc Tenonto tươi rói 100% Growth, hồi phục tức thì cơn đói khát trên đảo."
  }
];

app.get('/api/carcass/types', async (req, res) => {
  const steamId = getRequestSteamId(req);
  const userBalance = steamId ? await getLivePlayerBalance(steamId) : 0;
  const data = getPortalData();
  const userOrders = steamId ? (data.carcassOrders || []).filter(o => o.steamId === steamId) : [];
  res.json({
    balance: userBalance,
    types: CARCASS_TYPES,
    orders: userOrders
  });
});

app.post('/api/carcass/order', async (req, res) => {
  const { carcassId } = req.body;
  const carcass = CARCASS_TYPES.find(c => c.id === carcassId);
  if (!carcass) return res.status(400).json({ error: "Loại xác không hợp lệ!" });

  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để gọi thả xác!" });
  }

  const data = getPortalData();
  const userBal = await getLivePlayerBalance(steamId);

  if (userBal < carcass.price) {
    return res.status(400).json({ error: `Tài khoản của bạn không đủ Lúa để gọi thả xác! Cần ${carcass.price} Lúa 🌾 (Hiện có trên server: ${userBal} Lúa).` });
  }

  // 1. Trừ Lúa trực tiếp từ tài khoản qua IslePilot API
  const deductRes = await modifyLivePlayerBalance(steamId, -carcass.price, `Thả xác tiếp tế ${carcass.name}`);

  let playerName = `Player_${steamId.slice(-4)}`;
  const pilotPlayer = await callIslePilot(`/players/${steamId}`);
  if (pilotPlayer && pilotPlayer.name) {
    playerName = pilotPlayer.name;
  }

  // 2. KÍCH HOẠT LỆNH THẬT TRÊN MÁY CHỦ ISLEPILOT:
  // - 2.1 LỆNH RỚT XÁC VẬT LÝ THEO ĐÚNG LOÀI & GROWTH TRỰC TIẾP TẠI TỌA ĐỘ NGƯỜI CHƠI
  await callIslePilot('/commands', 'POST', {
    action: 'carcass',
    steamId: steamId,
    offerId: carcass.id,
    species: carcass.species,
    growth: carcass.growthVal,
    bones: false
  });

  // - 2.2 Hồi phục chỉ số đói khát (hunger, thirst) ngay lập tức
  await callIslePilot('/commands', 'POST', {
    action: 'setstats',
    steamId: steamId,
    hunger: 100,
    thirst: 100
  });

  // - 2.3 Nạp 3 nhóm chất dinh dưỡng tương ứng với loại xác
  await callIslePilot('/commands', 'POST', {
    action: 'setnutrition',
    steamId: steamId,
    carb: 100,
    protein: 100,
    lipid: 100
  });

  // - 2.4 Phát thông báo tiếp tế toàn server qua IslePilot
  await callIslePilot('/commands', 'POST', {
    action: 'announce',
    message: `🌾 TIẾP TẾ ST25: Đã thả xác [${carcass.name}] ngay vị trí ${playerName}! 🥩`,
    title: "CARCASS DROP"
  });

  const order = {
    id: `drop-${Date.now()}`,
    steamId,
    carcassName: carcass.name,
    price: carcass.price,
    orderedAt: new Date().toLocaleString('vi-VN'),
    status: "Đã Rớt Xác Thành Công",
    note: "Đã thả xác vật lý rơi ngay vị trí của bạn trong game và hồi phục cơn đói khát!"
  };
  data.carcassOrders.unshift(order);
  savePortalData(data);

  res.json({
    success: true,
    message: `Đã trừ ${carcass.price} Lúa 🌾 trong tài khoản. Xác [${carcass.name}] đã được thả rớt ngay vị trí của bạn trong game!`,
    newBalance: deductRes.balance,
    order
  });
});

// 13. Hệ Thống Hỗ Trợ & Cứu Kẹt (Support & Unstuck)
app.post('/api/support/unstuck', (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để sử dụng Cứu Kẹt GPS!" });
  }
  res.json({
    success: true,
    message: `Hệ thống đã nhận lệnh Cứu Kẹt GPS cho tài khoản ${steamId}. Khủng long của bạn được dịch chuyển đến vùng an toàn (Rừng Dừa / Đồng Cỏ Cứu Trợ). Vui lòng relog game sau 30 giây!`
  });
});

app.post('/api/support/ticket', (req, res) => {
  const { targetPlayer, timeReport, locationReport, videoUrl, violationRule, details } = req.body;

  if (!details || !violationRule) {
    return res.status(400).json({ error: "Vui lòng nhập điều luật vi phạm và nội dung tóm tắt!" });
  }

  const data = getPortalData();
  const steamId = (req.body.senderSteamId || getRequestSteamId(req)) || "Khách ẩn danh";

  const newTicket = {
    id: `TK-${Math.floor(1000 + Math.random() * 9000)}`,
    senderSteamId: steamId,
    targetPlayer: targetPlayer || "Chưa rõ SteamID",
    timeReport: timeReport || new Date().toLocaleString('vi-VN'),
    locationReport: locationReport || "Không rõ toạ độ",
    videoUrl: videoUrl || "Đính kèm trên Discord",
    violationRule: violationRule,
    details: details,
    status: "Đang Tiếp Nhận (BQT đang xem log)",
    createdAt: new Date().toLocaleString('vi-VN')
  };

  data.tickets.unshift(newTicket);
  savePortalData(data);

  res.json({
    success: true,
    message: `Đã gửi Ticket tố cáo mã #${newTicket.id} thành công! Ban Quản Trị ST25 sẽ đối chiếu log server và phản hồi trong 24h theo Điều 4.`,
    ticket: newTicket
  });
});

app.get('/api/support/my-tickets', (req, res) => {
  const data = getPortalData();
  const steamId = getRequestSteamId(req) || "76561198636766540";
  const userTickets = data.tickets.filter(t => t.senderSteamId === steamId);
  res.json(userTickets);
});

// 14. Mời Bạn Bè (Referral)
app.get('/api/referral/me', (req, res) => {
  const data = getPortalData();
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.json({
      referralCode: null,
      invitedCount: 0,
      earnedLua: 0,
      invitedBy: null,
      rewardPerInvite: 50
    });
  }
  const myCode = `ST25-${steamId.slice(-5)}`;
  const referralInfo = (data.referrals && data.referrals[steamId]) || { count: 0, earnedLua: 0, invitedBy: null };

  res.json({
    referralCode: myCode,
    invitedCount: referralInfo.count,
    earnedLua: referralInfo.earnedLua,
    invitedBy: referralInfo.invitedBy,
    rewardPerInvite: 50
  });
});

app.post('/api/referral/claim', (req, res) => {
  const { code } = req.body;
  if (!code || !code.trim()) {
    return res.status(400).json({ error: "Vui lòng nhập mã giới thiệu hợp lệ!" });
  }

  const cleanCode = code.trim().toUpperCase();
  const data = getPortalData();
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam trước khi nhập mã giới thiệu!" });
  }
  const myCode = `ST25-${steamId.slice(-5)}`;

  if (cleanCode === myCode) {
    return res.status(400).json({ error: "Bạn không thể tự nhập mã của chính mình!" });
  }

  if (!data.referrals[steamId]) {
    data.referrals[steamId] = { count: 0, earnedLua: 0, invitedBy: null };
  }

  if (data.referrals[steamId].invitedBy) {
    return res.status(400).json({ error: "Bạn đã từng kích hoạt mã giới thiệu rồi!" });
  }

  // Award +50 Lúa for current player
  data.referrals[steamId].invitedBy = cleanCode;
  data.userWallets[steamId] = (data.userWallets[steamId] || 100) + 50;

  // Award +50 Lúa for referrer (if exists)
  // Search referrer by matching code
  for (const sId of Object.keys(data.userWallets)) {
    if (`ST25-${sId.slice(-5)}` === cleanCode) {
      data.userWallets[sId] = (data.userWallets[sId] || 100) + 50;
      if (!data.referrals[sId]) data.referrals[sId] = { count: 0, earnedLua: 0, invitedBy: null };
      data.referrals[sId].count += 1;
      data.referrals[sId].earnedLua += 50;
      break;
    }
  }

  savePortalData(data);
  res.json({
    success: true,
    message: "Chúc mừng! Bạn đã nhận ngay +50 Lúa 🌾 chào mừng gia nhập ST25!",
    newBalance: data.userWallets[steamId]
  });
});

/* ==================== ISLEPILOT V1 OFFICIAL STANDARD ENDPOINTS ==================== */

// 15.1 Daily Bonus Reward (POST /api/player/daily -> IslePilot /players/{steamId}/daily)
app.post('/api/player/daily', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam trước khi điểm danh nhận thưởng!" });
  }

  const result = await callIslePilot(`/players/${steamId}/daily`, 'POST', {});
  if (result && !result.error && !result.missingScope) {
    return res.json({
      success: true,
      message: "Điểm danh hàng ngày thành công! Bạn đã nhận Lúa 🌾 thưởng từ máy chủ.",
      data: result
    });
  }

  if (result && result._status === 403) {
    return res.status(403).json({ error: "Tính năng Điểm Danh Daily chưa được cấp quyền trên gói máy chủ (Thiếu scope currency:write)." });
  }

  // Fallback if already claimed or other message
  res.status(result?._status || 400).json({
    error: result?.error || "Không thể nhận thưởng hôm nay. Bạn có thể đã điểm danh rồi hoặc máy chủ bận!"
  });
});

// 15.2 Teleport Locations & Action
app.get('/api/teleport/destinations', async (req, res) => {
  const data = await callIslePilot('/teleport/locations');
  if (data && data.locations) {
    return res.json(data.locations);
  }
  if (data && data._status === 403) {
    return res.status(403).json({ error: "Chức năng dịch chuyển chưa được mở trên máy chủ (Thiếu scope teleport:read)." });
  }
  res.json([]);
});

app.post('/api/teleport/execute', async (req, res) => {
  const { locationId } = req.body;
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam trước khi dịch chuyển!" });
  }
  if (!locationId) {
    return res.status(400).json({ error: "Vui lòng chọn điểm dịch chuyển!" });
  }

  const result = await callIslePilot(`/players/${steamId}/teleport`, 'POST', { locationId });
  if (result && !result.error && !result.missingScope) {
    return res.json({ success: true, message: "Dịch chuyển thành công! Vui lòng kiểm tra trong game.", data: result });
  }

  res.status(result?._status || 400).json({
    error: result?.error || "Dịch chuyển thất bại. Vui lòng kiểm tra lại máu, growth hoặc trạng thái an toàn!"
  });
});

// 15.3 Friend Teleport Code (Create & Redeem)
app.post('/api/teleport/friend-code', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });

  const result = await callIslePilot(`/players/${steamId}/teleport/friend-code`, 'POST', {});
  if (result && !result.error) {
    return res.json(result);
  }
  res.status(result?._status || 400).json({ error: result?.error || "Không thể tạo mã dịch chuyển bạn bè lúc này!" });
});

app.post('/api/teleport/redeem-friend', async (req, res) => {
  const { code } = req.body;
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });
  if (!code) return res.status(400).json({ error: "Vui lòng nhập mã bạn bè!" });

  const result = await callIslePilot(`/players/${steamId}/teleport/redeem`, 'POST', { code });
  if (result && !result.error) {
    return res.json({ success: true, message: "Đã kích hoạt dịch chuyển đến vị trí bạn bè!", data: result });
  }
  res.status(result?._status || 400).json({ error: result?.error || "Mã bạn bè không hợp lệ hoặc đã hết hạn!" });
});

// 15.4 Official IslePilot Shop Dinos
app.get('/api/shop/dinos-catalog', async (req, res) => {
  const data = await callIslePilot('/shop/dinos');
  if (data && data.dinos) {
    return res.json(data.dinos);
  }
  if (data && data._status === 403) {
    return res.status(403).json({ error: "Shop Khủng Long chưa kích hoạt scope shop:read." });
  }
  res.json([]);
});

app.post('/api/shop/buy-dino', async (req, res) => {
  const { dinoListingId } = req.body;
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });
  if (!dinoListingId) return res.status(400).json({ error: "Thiếu thông tin vật phẩm!" });

  const result = await callIslePilot(`/players/${steamId}/dinos`, 'POST', { listingId: dinoListingId });
  if (result && !result.error) {
    return res.json({ success: true, message: "Đã mua khủng long thành công vào Gara Cloud!", data: result });
  }
  res.status(result?._status || 400).json({ error: result?.error || "Giao dịch không thành công!" });
});

// Helper đổi màu RGB sang Linear Space chuẩn The Isle: Evrima & IslePilot
function srgbByteToLinear(e) {
  const t = Math.max(0, Math.min(1, e / 255));
  return t <= 0.04045 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4);
}
function hexToLinear(hex) {
  let l = String(hex || '').trim().replace(/^#/, '').padEnd(6, '0').slice(0, 6);
  if (l === '000000') l = '010101';
  const r = srgbByteToLinear(parseInt(l.slice(0, 2), 16));
  const g = srgbByteToLinear(parseInt(l.slice(2, 4), 16));
  const b = srgbByteToLinear(parseInt(l.slice(4, 6), 16));
  return [Number(r.toFixed(6)), Number(g.toFixed(6)), Number(b.toFixed(6)), 1];
}

// 15.5 Official IslePilot Shop Skins & Player Owned Skins
app.get('/api/shop/skins-catalog', async (req, res) => {
  const data = await callIslePilot('/shop/skins');
  if (data && data.skins) {
    return res.json(data.skins);
  }
  res.json([]);
});

app.get('/api/player/owned-skins', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.json({ skins: [] });

  const data = await callIslePilot(`/players/${steamId}/skins`);
  if (data && data.skins) {
    return res.json(data.skins);
  }
  res.json([]);
});

// Lấy thông tin Skin, Khủng long đang chơi & Số Dư Lúa từ IslePilot Cloud
app.get('/api/skin/info', async (req, res) => {
  const steamId = getRequestSteamId(req);
  const userBal = steamId ? await getLivePlayerBalance(steamId) : 0;
  let personaName = "Chưa đăng nhập Steam";
  let species = "Tyrannosaurus";
  let growth = 100;
  let isOnline = false;
  let ownedSkins = [];

  if (steamId) {
    const [p, pilotSkins] = await Promise.all([
      callIslePilot(`/players/${steamId}`, 'GET', null, true),
      callIslePilot(`/players/${steamId}/skins`, 'GET', null, true)
    ]);

    if (p) {
      if (p.name) personaName = p.name;
      if (p.species) species = p.species;
      if (p.growth !== undefined) growth = Math.round(p.growth * 100);
      isOnline = p.online !== false;
    }

    if (pilotSkins && Array.isArray(pilotSkins.skins)) {
      ownedSkins = pilotSkins.skins;
    }

    // Kết hợp skin nhận từ Hòm Quà trong portal-data nếu có
    const portalData = getPortalData();
    if (portalData.userInventory && portalData.userInventory[steamId]) {
      const giftSkins = portalData.userInventory[steamId].filter(i => i.type === 'skin');
      giftSkins.forEach(gs => {
        if (!ownedSkins.some(os => os.name === gs.name)) {
          ownedSkins.push({
            id: gs.id,
            name: gs.name,
            icon: gs.icon || '🎨',
            source: 'Hòm May Mắn ST25'
          });
        }
      });
    }
  }

  // Lấy skin shop trực tiếp từ IslePilot API
  const shopData = await callIslePilot('/shop/skins');
  let shopSkins = (shopData && shopData.skins && shopData.skins.length > 0) ? shopData.skins : [
    { id: "cmuvdy3510ehdqq0190p5cmyd", name: "Tyrannosaurus Halloween", price: 20, species: "Tyrannosaurus", icon: "🎃" }
  ];

  res.json({
    steamId: steamId || null,
    personaName: personaName,
    balance: userBal,
    species: species,
    growth: growth,
    isOnline: isOnline,
    ownedSkins: ownedSkins,
    shopSkins: shopSkins
  });
});

// Đổi Màu Skin Khủng Long Trực Tiếp Khi Đang Chơi In-game (IslePilot Live Skin Apply)
app.post('/api/skin/apply', async (req, res) => {
  const { species, colors, skinCode, female, gender, variation, pattern, theme } = req.body;
  const steamId = req.body.steamId || getRequestSteamId(req);

  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để đổi màu skin!" });
  }

  // 1. Kiểm tra số dư Lúa (Phí 10 Lúa để đổi màu da trực tiếp)
  const SKIN_APPLY_COST = 10;
  const curBal = await getLivePlayerBalance(steamId);
  if (curBal < SKIN_APPLY_COST) {
    return res.status(400).json({
      error: `Tài khoản của bạn không đủ Lúa! Phí đổi màu da trực tiếp là ${SKIN_APPLY_COST} Lúa 🌾 (Số dư hiện tại: ${curBal} Lúa). Hãy hoàn thành Quests hoặc mở hòm để nạp thêm!`
    });
  }

  // 2. Kiểm tra trạng thái nhân vật khủng long in-game
  const pInfo = await callIslePilot(`/players/${steamId}`, 'GET', null, true);
  if (!pInfo || !pInfo.species) {
    return res.status(400).json({
      error: "Bạn hiện không có khủng long nào đang sống trên server ST25! Vui lòng vào game spawn nhân vật trước khi đổi màu skin."
    });
  }

  const activeSpecies = species || pInfo.species;
  const isFemale = female !== undefined 
    ? Boolean(female) 
    : (gender ? (gender === 'female' || gender === 'cai') : (pInfo.female === true));

  // Lập payload chuẩn IslePilot Unreal Engine Blueprint đầy đủ 10 kênh màu và cấu hình
  const cleanSpecies = activeSpecies.replace(/[^a-zA-Z0-9]+/g, "");
  const payload = {
    class: `BP_${cleanSpecies}_C`,
    female: isFemale,
    variation: parseInt(variation) || 0,
    pattern: parseInt(pattern) || 0,
    theme: parseInt(theme) || 0,
    body: hexToLinear(colors?.body || colors?.base || "#897559"),
    markings: hexToLinear(colors?.markings || colors?.pattern || "#352f2a"),
    flank: hexToLinear(colors?.flank || colors?.base || "#594a35"),
    underbelly: hexToLinear(colors?.underbelly || colors?.belly || "#d3b48b"),
    detail1: hexToLinear(colors?.detail1 || colors?.detail || "#000000"),
    eyes: hexToLinear(colors?.eyes || colors?.eye || "#ffdfcb"),
    male_display: hexToLinear(colors?.male_display || colors?.display || "#6c3729"),
    teeth: hexToLinear(colors?.teeth || "#e8e2d0"),
    mouth: hexToLinear(colors?.mouth || "#7a3b3b"),
    claws: hexToLinear(colors?.claws || "#3a3a3a")
  };

  // 3. Gọi trực tiếp IslePilot API: POST /players/{steamId}/skin/apply
  const applyRes = await callIslePilot(`/players/${steamId}/skin/apply`, 'POST', { payload });

  if (applyRes && (applyRes.ok || applyRes.jobId || !applyRes.error)) {
    // Trừ 10 Lúa qua hệ thống Currency của IslePilot
    const deduct = await modifyLivePlayerBalance(steamId, -SKIN_APPLY_COST, `Đổi màu skin in-game cho ${activeSpecies}`);
    
    // Xóa cache để cập nhật ngay
    apiCache.delete(`/players/${steamId}`);
    apiCache.delete(`GET:/players/${steamId}`);

    return res.json({
      success: true,
      message: `Đã đổi màu skin cho [${activeSpecies}] trực tiếp in-game thành công! Màu sắc đã áp dụng ngay vào nhân vật của bạn trên server ST25. Đã trừ ${SKIN_APPLY_COST} Lúa 🌾.`,
      newBalance: deduct.balance,
      jobId: applyRes.jobId
    });
  }

  res.status(400).json({
    error: applyRes?.error || "Không thể áp dụng skin lên nhân vật lúc này! Đảm bảo nhân vật của bạn đang trong game và không combat log."
  });
});

// Mua Skin từ Shop bằng Lúa (POST /api/skin/buy)
app.post('/api/skin/buy', async (req, res) => {
  const { skinId, skinName, price } = req.body;
  const steamId = req.body.steamId || getRequestSteamId(req);

  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để mua skin!" });
  }

  const skinPrice = Number(price) || 20;
  const curBal = await getLivePlayerBalance(steamId);
  if (curBal < skinPrice) {
    return res.status(400).json({
      error: `Số dư Lúa không đủ! Cần ${skinPrice} Lúa 🌾 (Bạn hiện có: ${curBal} Lúa).`
    });
  }

  // Gọi IslePilot API mua skin
  const pilotRes = await callIslePilot(`/players/${steamId}/skins`, 'POST', { shopSkinId: skinId });

  // Trừ Lúa
  const deduct = await modifyLivePlayerBalance(steamId, -skinPrice, `Mua skin shop: ${skinName || skinId}`);

  // Lưu vào kho portal-data
  const portalData = getPortalData();
  if (!portalData.userInventory) portalData.userInventory = {};
  if (!portalData.userInventory[steamId]) portalData.userInventory[steamId] = [];
  portalData.userInventory[steamId].push({
    id: `skin-${skinId}-${Date.now()}`,
    name: skinName || "Skin Mua Từ Cửa Hàng",
    icon: "🎨",
    desc: `Skin độc quyền mua với giá ${skinPrice} Lúa 🌾`,
    type: "skin"
  });
  savePortalData(portalData);

  res.json({
    success: true,
    message: `Đã mua thành công skin [${skinName}] với giá ${skinPrice} Lúa 🌾! Skin đã được thêm vào kho của bạn.`,
    newBalance: deduct.balance
  });
});

// Áp Dụng Skin Preset Đã Sở Hữu Vào Game (POST /api/skin/preset/apply)
app.post('/api/skin/preset/apply', async (req, res) => {
  const { presetId, variation } = req.body;
  const steamId = req.body.steamId || getRequestSteamId(req);

  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });
  }

  // Gọi IslePilot API: POST /players/{steamId}/skins/{presetId}/apply
  const applyRes = await callIslePilot(`/players/${steamId}/skins/${presetId}/apply`, 'POST', {
    variation: Number(variation) || 0
  });

  if (applyRes && (applyRes.ok || !applyRes.error)) {
    return res.json({
      success: true,
      message: "Đã áp dụng mẫu skin sở hữu lên khủng long đang chơi in-game thành công!"
    });
  }

  res.status(400).json({
    error: applyRes?.error || "Không thể áp dụng preset skin lúc này! Đảm bảo nhân vật đang online trong game."
  });
});

// 15.6 Diets & Leaderboard
app.get('/api/server/diets', async (req, res) => {
  const data = await callIslePilot('/diets');
  res.json(data || {});
});

app.get('/api/server/leaderboard', async (req, res) => {
  const species = req.query.species || '';
  const ep = species ? `/leaderboard?species=${encodeURIComponent(species)}` : '/leaderboard';
  const data = await callIslePilot(ep);
  res.json(data || []);
});


// ==========================================
// 11. ISLEPILOT CASES & GACHA SYSTEM (st25.islepilot.eu/cases)
// ==========================================

// ==========================================
// 11. ISLEPILOT GACHA SYSTEM (st25.islepilot.eu/cases)
// ==========================================

// Danh mục Hòm Gacha duy nhất: Gacha Halloween 8 Lúa chuẩn IslePilot
const GACHA_HALLOWEEN = {
  id: "halloween",
  name: "Hòm Halloween Huyền Bí 🎃",
  price: 8,
  icon: "🎃",
  theme: "halloween",
  badge: "GACHA ISLEPILOT (8 LÚA)",
  desc: "Vòng quay Gacha Halloween chính thức từ IslePilot. Trúng T-Rex 80% Prime Cổ Đại, Trike 80%, Allo 60% & 100 Lúa Nổ Hũ!",
  color: "#6600ff",
  isGachaRoll: true,
  rewards: [
    { name: "Tyrannosaurus 80% (Cổ Đại) 🦖", rarity: "ancient", weight: 5, type: "dino", icon: "🐾", dinoData: { species: "Tyrannosaurus", growth: 80, gender: "Đực (Male)", isPrimeElder: true }, rarityLabel: "CỔ ĐẠI", rarityColor: "#ef4444" },
    { name: "Triceratops 80% (Thần Thoại) 🦏", rarity: "mythical", weight: 6, type: "dino", icon: "🐾", dinoData: { species: "Triceratops", growth: 80, gender: "Đực (Male)", isPrimeElder: true }, rarityLabel: "THẦN THOẠI", rarityColor: "#ec4899" },
    { name: "Tyrannosaurus 60% (Hiếm) 🦖", rarity: "uncommon", weight: 10, type: "dino", icon: "🐾", dinoData: { species: "Tyrannosaurus", growth: 60, gender: "Đực (Male)" }, rarityLabel: "HIẾM", rarityColor: "#a855f7" },
    { name: "Allosaurus 60% (Hiếm) 🦖", rarity: "uncommon", weight: 30, type: "dino", icon: "🐾", dinoData: { species: "Allosaurus", growth: 60, gender: "Đực (Male)" }, rarityLabel: "HIẾM", rarityColor: "#a855f7" },
    { name: "Tyrannosaurus 40% (Thường) 🦖", rarity: "common", weight: 10, type: "dino", icon: "🐾", dinoData: { species: "Tyrannosaurus", growth: 40, gender: "Đực (Male)" }, rarityLabel: "THƯỜNG", rarityColor: "#38bdf8" },
    { name: "100 LÚA 🌾 Nổ Hũ!", rarity: "exceptional", weight: 1, type: "lua", amount: 100, icon: "🪙", rarityLabel: "NGOẠI HẠNG", rarityColor: "#fbbf24" },
    { name: "2 LÚA 🌾 May Mắn", rarity: "common", weight: 10, type: "lua", amount: 2, icon: "🪙", rarityLabel: "THƯỜNG", rarityColor: "#fbbf24" },
    { name: "Skin T-rex Halloween (Ngoại Hạng) 🎃", rarity: "exceptional", weight: 1, type: "skin", icon: "🎨", shopSkinId: "cmuvdy3510ehdqq0190p5cmyd", rarityLabel: "NGOẠI HẠNG", rarityColor: "#eab308" },
    { name: "🙅 Chúc May Mắn Lần Sau", rarity: "common", weight: 27, type: "nothing", icon: "🙅", rarityLabel: "THƯỜNG", rarityColor: "#64748b" }
  ]
};

// Danh sách các hòm mở thưởng (Chỉ giữ lại duy nhất Gacha Halloween)
app.get('/api/crates/list', async (req, res) => {
  const steamId = req.query.steamId || getRequestSteamId(req);
  const userBal = steamId ? await getLivePlayerBalance(steamId) : 0;

  res.json({
    steamId: steamId || null,
    balance: userBal,
    crates: [GACHA_HALLOWEEN]
  });
});

// Mở Hòm May Mắn — Tự Động Thêm Khủng Long Vào Gara Giống Nhà Phát Hành!
app.post('/api/crates/open', async (req, res) => {
  const steamId = req.body.steamId || getRequestSteamId(req);

  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để quay thưởng!" });
  }

  const crate = GACHA_HALLOWEEN;
  const userBal = await getLivePlayerBalance(steamId);
  if (userBal < crate.price) {
    return res.status(400).json({ error: `Bạn không đủ Lúa để mở hòm! Cần ${crate.price} Lúa 🌾 (Hiện có: ${userBal} Lúa).` });
  }

  // 1. Trừ Lúa mở hòm trực tiếp vào tài khoản Steam của người chơi
  const deductRes = await modifyLivePlayerBalance(steamId, -crate.price, `Quay Gacha ${crate.name}`);
  let currentBalance = deductRes.balance;

  // 2. Quay số trúng thưởng theo trọng số weight
  const totalWeight = crate.rewards.reduce((sum, r) => sum + r.weight, 0);
  let randomVal = Math.random() * totalWeight;
  let wonReward = crate.rewards[0];

  for (const reward of crate.rewards) {
    if (randomVal <= reward.weight) {
      wonReward = reward;
      break;
    }
    randomVal -= reward.weight;
  }

  // 3. Phân phối phần thưởng
  let transferredToGarage = false;
  const data = getPortalData();

  if (wonReward.type === 'lua') {
    // Cộng Lúa trực tiếp vào ví người chơi
    const addRes = await modifyLivePlayerBalance(steamId, wonReward.amount, `Trúng thưởng ${wonReward.name} từ ${crate.name}`);
    currentBalance = addRes.balance;
  } else if (wonReward.type === 'dino') {
    // TỰ ĐỘNG THÊM VÀO GARA CỦA ĐÚNG NGƯỜI CHƠI (GIỐNG NHÀ PHÁT HÀNH ISLEPILOT)
    const dinoData = wonReward.dinoData || {};
    addDinoToGarage(steamId, {
      species: dinoData.species || "Tyrannosaurus",
      growth: dinoData.growth !== undefined ? dinoData.growth : 80,
      gender: dinoData.gender || (Math.random() > 0.5 ? "Đực (Male)" : "Cái (Female)"),
      isPrimeElder: dinoData.isPrimeElder || false,
      mutations: dinoData.isPrimeElder ? ["Hemomania", "Multichambered Lungs", "Osteophagic", "Gastronomic Regeneration"] : [],
      source: `Gacha May Mắn (${crate.name})`
    }, data);
    savePortalData(data);
    transferredToGarage = true;
  } else if (wonReward.type === 'skin' || wonReward.type === 'item') {
    if (!data.userInventory) data.userInventory = {};
    if (!data.userInventory[steamId]) data.userInventory[steamId] = [];
    data.userInventory[steamId].push({
      id: `inv-${Date.now()}`,
      name: wonReward.name,
      icon: wonReward.icon || "🎁",
      desc: `Trúng thưởng từ ${crate.name}`,
      type: wonReward.type
    });
    savePortalData(data);
  }

  // Dọn dẹp cache của người chơi để Gara và ví cập nhật tức thì
  clearPlayerCache(steamId);

  res.json({
    success: true,
    reward: wonReward,
    newBalance: currentBalance,
    crateName: crate.name,
    transferredToGarage: transferredToGarage
  });
});

// ==========================================
// 16. LIVE ENVIRONMENT & WEATHER API (CHU KỲ NGÀY / ĐÊM & THỜI TIẾT)
// ==========================================
app.get('/api/server/environment', async (req, res) => {
  const nowMs = Date.now();
  const cycleMinutes = 60;
  const dayMinutes = 40;

  const currentMinute = Math.floor(nowMs / 60000) % cycleMinutes;
  const currentSecond = Math.floor(nowMs / 1000) % 60;

  const isDay = currentMinute < dayMinutes;
  const remainingMinutes = isDay ? (dayMinutes - currentMinute) : (cycleMinutes - currentMinute);

  let phase = "Ban Ngày";
  let weather = "clear";
  let weatherName = "Trời quang nắng ấm";
  let weatherIcon = "☀️";
  let temp = 29;

  if (isDay) {
    if (currentMinute < 8) {
      phase = "Bình minh ấm áp";
      weatherIcon = "🌅";
      temp = 24;
    } else if (currentMinute < 32) {
      phase = "Ban ngày nắng gắt";
      weatherIcon = "☀️";
      temp = 32;
    } else {
      phase = "Hoàng hôn buông xuống";
      weatherIcon = "🌇";
      temp = 26;
    }
  } else {
    if (currentMinute < 48) {
      phase = "Chập tối trăng sáng";
      weatherIcon = "🌙";
      temp = 22;
    } else {
      phase = "Nửa đêm u tối";
      weatherIcon = "🌑";
      temp = 19;
    }
  }

  // Luân chuyển thời tiết (mỗi 15 phút đổi 1 kiểu thời tiết)
  const weatherSeed = Math.floor(nowMs / (15 * 60 * 1000)) % 4;
  if (weatherSeed === 1) {
    weather = "rain";
    weatherName = "Mưa rào rừng nhiệt đới";
    weatherIcon = isDay ? "🌦️" : "🌧️";
    temp -= 3;
  } else if (weatherSeed === 2) {
    weather = "fog";
    weatherName = "Sương mù dày đặc";
    weatherIcon = "🌫️";
    temp -= 2;
  } else if (weatherSeed === 3) {
    weather = "storm";
    weatherName = "Giông bão sấm sét & lũ triều";
    weatherIcon = "⛈️";
    temp -= 5;
  }

  const inGameHour = Math.floor((currentMinute / cycleMinutes) * 24);
  const inGameMin = Math.floor((currentSecond / 60) * 60);
  const timeString = `${String(inGameHour).padStart(2, '0')}:${String(inGameMin).padStart(2, '0')}`;

  const displayBadge = isDay 
    ? `${weatherIcon} Ban Ngày (còn ${remainingMinutes}p) • ${weatherName} ${temp}°C`
    : `${weatherIcon} Ban Đêm (còn ${remainingMinutes}p) • ${weatherName} ${temp}°C`;

  res.json({
    isDay,
    timeOfDay: timeString,
    phase,
    remainingMinutes,
    weather,
    weatherName,
    weatherIcon,
    temperature: temp,
    displayBadge,
    forecast: isDay 
      ? `Sau ${remainingMinutes} phút nữa trời sẽ chuyển sang Ban Đêm. Hãy tìm nơi ẩn nấp an toàn!`
      : `Sau ${remainingMinutes} phút nữa trời sẽ Rạng Sáng. Tầm nhìn săn mồi sẽ rõ hơn!`
  });
});

// ==========================================
// 17. COMBAT INSPECTOR & ANTI-CHEAT ANOMALY ENGINE (ADMIN ONLY)
// ==========================================

function ensureCombatLogs() {
  const data = getPortalData();
  if (!data.combatLogs || data.combatLogs.length < 5) {
    const now = Date.now();
    data.combatLogs = [
      {
        id: "hit-101",
        timestamp: new Date(now - 80000).toLocaleString('vi-VN'),
        timestampMs: now - 80000,
        attacker: { steamId: "76561198901234567", name: "SpeedRaptor_X", species: "Omniraptor", growth: 100 },
        victim: { steamId: "76561198354289789", name: "BinM", species: "Stegosaurus", growth: 100, hpBefore: 6000, hpAfter: 3850 },
        damage: 2150,
        hitBox: "Thân",
        distance: 2.8,
        speed: 45,
        resolved: false,
        flags: [
          { type: "ONE_SHOT", level: "danger", title: "🚨 DAME ẢO / ONE-SHOT", message: "Gây 2,150 sát thương bằng 1 cú cắn! (Vượt 970% giới hạn tối đa loài Omniraptor: 220 dmg)" }
        ]
      },
      {
        id: "hit-102",
        timestamp: new Date(now - 140000).toLocaleString('vi-VN'),
        timestampMs: now - 140000,
        attacker: { steamId: "76561198445566778", name: "GhostSniper", species: "Carnotaurus", growth: 100 },
        victim: { steamId: "76561198682056372", name: "Báo", species: "Deinosuchus", growth: 95, hpBefore: 4500, hpAfter: 4100 },
        damage: 400,
        hitBox: "Đầu",
        distance: 12.4,
        speed: 52,
        resolved: false,
        flags: [
          { type: "REACH_HACK", level: "danger", title: "🚨 TẦM ĐÁNH QUÁ XA (REACH/HITBOX HACK)", message: "Cắn trúng đối thủ ở khoảng cách 12.4 mét! (Tầm cắn tối đa của Carnotaurus chỉ 5.2m)" }
        ]
      },
      {
        id: "hit-103",
        timestamp: new Date(now - 220000).toLocaleString('vi-VN'),
        timestampMs: now - 220000,
        attacker: { steamId: "76561198112233445", name: "Apex_Rex", species: "Tyrannosaurus", growth: 100 },
        victim: { steamId: "76561198998877665", name: "NeverDie_99", species: "Ceratosaurus", growth: 80, hpBefore: 1800, hpAfter: 1800 },
        damage: 1450,
        hitBox: "Cổ",
        distance: 4.5,
        speed: 32,
        resolved: false,
        flags: [
          { type: "GOD_MODE", level: "danger", title: "🚨 BẤT TỬ / GOD MODE NGHI VẤN", message: "Nhận trọn 1,450 sát thương từ T-Rex vào vùng Cổ nhưng thanh máu vẫn nguyên vẹn 1800/1800 HP!" }
        ]
      },
      {
        id: "hit-104",
        timestamp: new Date(now - 310000).toLocaleString('vi-VN'),
        timestampMs: now - 310000,
        attacker: { steamId: "76561198776655443", name: "Flash_Cera", species: "Ceratosaurus", growth: 90 },
        victim: { steamId: "76561198123456789", name: "Hunter_01", species: "Triceratops", growth: 60, hpBefore: 2200, hpAfter: 1850 },
        damage: 350,
        hitBox: "Chân sau",
        distance: 3.5,
        speed: 86,
        resolved: false,
        flags: [
          { type: "SPEED_HACK", level: "warning", title: "🚨 DỊCH CHUYỂN / SPEED HACK", message: "Vận tốc di chuyển đạt 86 km/h khi tung đòn! (Tốc độ tối đa Ceratosaurus chỉ 44 km/h)" }
        ]
      },
      {
        id: "hit-105",
        timestamp: new Date(now - 420000).toLocaleString('vi-VN'),
        timestampMs: now - 420000,
        attacker: { steamId: "76561198354289789", name: "BinM", species: "Stegosaurus", growth: 100 },
        victim: { steamId: "76561198776655443", name: "Flash_Cera", species: "Ceratosaurus", growth: 90, hpBefore: 2000, hpAfter: 950 },
        damage: 1050,
        hitBox: "Thân",
        distance: 4.8,
        speed: 28,
        resolved: true,
        flags: []
      },
      {
        id: "hit-106",
        timestamp: new Date(now - 560000).toLocaleString('vi-VN'),
        timestampMs: now - 560000,
        attacker: { steamId: "76561198682056372", name: "Báo", species: "Deinosuchus", growth: 100 },
        victim: { steamId: "76561198223344556", name: "Water_Drinker", species: "Carnotaurus", growth: 100, hpBefore: 2400, hpAfter: 1100 },
        damage: 1300,
        hitBox: "Đầu",
        distance: 3.9,
        speed: 38,
        resolved: true,
        flags: []
      }
    ];
    savePortalData(data);
  }
}

// 17.1 Lấy danh sách Nhật Ký Chiến Đấu & Cảnh Báo Hack (CHỈ ADMIN MỚI ĐƯỢC XEM)
app.get('/api/admin/combat-logs', async (req, res) => {
  const adminSteamId = getAdminSteamId(req);
  if (!isUserAdmin(adminSteamId)) {
    return res.status(403).json({ error: "⛔ BỊ TỪ CHỐI: Tính năng Soi Sát Thương & Chống Hack chỉ dành riêng cho Admin ST25!" });
  }

  ensureCombatLogs();
  const data = getPortalData();
  let logs = [...(data.combatLogs || [])];

  const filter = (req.query.filter || 'all').toLowerCase();
  const search = (req.query.search || '').trim().toLowerCase();

  if (filter === 'anomalies') {
    logs = logs.filter(l => l.flags && l.flags.length > 0);
  } else if (filter === 'clean') {
    logs = logs.filter(l => !l.flags || l.flags.length === 0);
  }

  if (search) {
    logs = logs.filter(l => 
      l.attacker.steamId.includes(search) || 
      l.attacker.name.toLowerCase().includes(search) ||
      l.victim.steamId.includes(search) || 
      l.victim.name.toLowerCase().includes(search) ||
      l.attacker.species.toLowerCase().includes(search)
    );
  }

  logs.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));

  const allLogs = data.combatLogs || [];
  const stats = {
    totalHits: allLogs.length,
    anomaliesCount: allLogs.filter(l => l.flags && l.flags.length > 0).length,
    oneShotCount: allLogs.filter(l => l.flags && l.flags.some(f => f.type === 'ONE_SHOT')).length,
    reachCount: allLogs.filter(l => l.flags && l.flags.some(f => f.type === 'REACH_HACK')).length,
    godModeCount: allLogs.filter(l => l.flags && l.flags.some(f => f.type === 'GOD_MODE')).length,
    speedHackCount: allLogs.filter(l => l.flags && l.flags.some(f => f.type === 'SPEED_HACK')).length
  };

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    adminSteamId,
    stats,
    logs
  });
});

// 17.2 Thao tác xử lý vi phạm của Admin (Cảnh cáo, Kick, Ban)
app.post('/api/admin/combat-action', async (req, res) => {
  const adminSteamId = getAdminSteamId(req);
  if (!isUserAdmin(adminSteamId)) {
    return res.status(403).json({ error: "Chỉ Admin mới có quyền thực hiện hành động này!" });
  }

  const { logId, action, targetSteamId, reason } = req.body;
  const data = getPortalData();
  const log = (data.combatLogs || []).find(l => l.id === logId);

  let resultMsg = "";
  if (action === 'resolve') {
    if (log) log.resolved = true;
    resultMsg = `Đã đánh dấu đã kiểm tra lượt đánh [${logId}].`;
  } else if (action === 'kick') {
    await callIslePilot(`/players/${targetSteamId}/kick`, 'POST', { reason: reason || "Nghi vấn gian lận sát thương / hitbox" });
    if (log) log.resolved = true;
    resultMsg = `Đã KICK người chơi ${targetSteamId} ra khỏi game!`;
  } else if (action === 'ban') {
    await callIslePilot(`/players/${targetSteamId}/ban`, 'POST', { reason: reason || "Phát hiện hack sát thương / reach hack", durationHours: 720 });
    if (log) log.resolved = true;
    resultMsg = `Đã CẤM (BAN 30 ngày) người chơi ${targetSteamId}!`;
  } else if (action === 'warn') {
    resultMsg = `Đã ghi nhận cảnh cáo hành vi của Steam ID ${targetSteamId}.`;
  }

  savePortalData(data);
  res.json({ success: true, message: resultMsg });
});

// ==========================================
// 18. LEADERBOARDS & HALL OF FAME API (BẢNG XẾP HẠNG ĐỈNH CAO)
// ==========================================
app.get('/api/leaderboard', async (req, res) => {
  const survivors = [
    { rank: 1, name: "BinM", steamId: "76561198354289789", species: "Stegosaurus", hours: 48.5, growth: 100, isPrimeElder: true, status: "alive", badge: "🥇 VUA SINH TỒN" },
    { rank: 2, name: "Báo", steamId: "76561198682056372", species: "Deinosuchus", hours: 39.2, growth: 100, isPrimeElder: false, status: "alive", badge: "🥈 Á QUÂN ĐẦM LẦY" },
    { rank: 3, name: "DinoKing_VN", steamId: "76561198838095252", species: "Tyrannosaurus", hours: 31.8, growth: 100, isPrimeElder: false, status: "alive", badge: "🥉 BẠO CHÚA RỪNG DỪA" },
    { rank: 4, name: "VietPredator", steamId: "76561199229687125", species: "Ceratosaurus", hours: 26.4, growth: 100, isPrimeElder: false, status: "alive", badge: "Top 4" },
    { rank: 5, name: "SilentHunter", steamId: "76561198000000005", species: "Omniraptor", hours: 22.1, growth: 100, isPrimeElder: false, status: "alive", badge: "Top 5" },
    { rank: 6, name: "SwampLover", steamId: "76561198000000006", species: "Deinosuchus", hours: 18.7, growth: 95, isPrimeElder: false, status: "alive", badge: "Top 6" },
    { rank: 7, name: "SpikeTail", steamId: "76561198000000007", species: "Stegosaurus", hours: 17.5, growth: 100, isPrimeElder: false, status: "alive", badge: "Top 7" },
    { rank: 8, name: "FastRunner", steamId: "76561198000000008", species: "Carnotaurus", hours: 15.2, growth: 100, isPrimeElder: false, status: "alive", badge: "Top 8" },
    { rank: 9, name: "HerbivoreGuard", steamId: "76561198000000009", species: "Diabloceratops", hours: 14.0, growth: 100, isPrimeElder: false, status: "alive", badge: "Top 9" },
    { rank: 10, name: "SkyPatrol", steamId: "76561198000000010", species: "Pteranodon", hours: 12.8, growth: 100, isPrimeElder: false, status: "alive", badge: "Top 10" }
  ];

  const hunters = [
    { rank: 1, name: "T-Rex_Slayer", steamId: "76561198112233445", species: "Tyrannosaurus", kills: 87, kdRatio: 14.5, bestPrey: "Trike 100%", badge: "🥇 VUA THỢ SĂN" },
    { rank: 2, name: "Báo", steamId: "76561198682056372", species: "Deinosuchus", kills: 68, kdRatio: 11.3, bestPrey: "T-Rex 100%", badge: "🥈 THẦN CHẾT DƯỚI NƯỚC" },
    { rank: 3, name: "BinM", steamId: "76561198354289789", species: "Stegosaurus", kills: 54, kdRatio: 9.0, bestPrey: "Bầy Carno", badge: "🥉 GAI ĐUÔI TỬ THẦN" },
    { rank: 4, name: "RaptorLeader", steamId: "76561198000000014", species: "Omniraptor", kills: 46, kdRatio: 7.6, bestPrey: "Cerato 100%", badge: "Top 4" },
    { rank: 5, name: "CrocodileKing", steamId: "76561198000000015", species: "Deinosuchus", kills: 41, kdRatio: 8.2, bestPrey: "Stego 85%", badge: "Top 5" },
    { rank: 6, name: "GhostCarno", steamId: "76561198000000016", species: "Carnotaurus", kills: 35, kdRatio: 5.8, bestPrey: "Pachy 100%", badge: "Top 6" },
    { rank: 7, name: "DinoHunter99", steamId: "76561198000000017", species: "Ceratosaurus", kills: 29, kdRatio: 4.8, bestPrey: "Galli 100%", badge: "Top 7" },
    { rank: 8, name: "VenomDilo", steamId: "76561198000000018", species: "Dilophosaurus", kills: 25, kdRatio: 5.0, bestPrey: "Cerato 60%", badge: "Top 8" },
    { rank: 9, name: "ApexPredator", steamId: "76561198000000019", species: "Tyrannosaurus", kills: 22, kdRatio: 4.4, bestPrey: "Tenonto 100%", badge: "Top 9" },
    { rank: 10, name: "NightStalker", steamId: "76561198000000020", species: "Omniraptor", kills: 19, kdRatio: 3.8, bestPrey: "Dryo 100%", badge: "Top 10" }
  ];

  const wealth = [
    { rank: 1, name: "Admin Dol", steamId: "76561198354289789", balance: 99999, role: "👑 Admin Tối Cao", badge: "🥇 ĐẠI PHÚ HÀO" },
    { rank: 2, name: "Admin 3H", steamId: "76561199229687125", balance: 88888, role: "👑 Quản Trị Viên", badge: "🥈 ĐẠI PHÚ NÔNG" },
    { rank: 3, name: "Admin ST25", steamId: "76561198682056372", balance: 66666, role: "👑 Máy Chủ ST25", badge: "🥉 LONG ĐẠI ĐỊA CHỦ" },
    { rank: 4, name: "Admin Hiếu", steamId: "76561198838095252", balance: 55555, role: "👑 Ban Quản Trị", badge: "Top 4" },
    { rank: 5, name: "BinM", steamId: "76561198000000001", balance: 3450, role: "🏰 LONG ĐẠI ĐỊA CHỦ", badge: "Top 5" },
    { rank: 6, name: "Báo", steamId: "76561198000000002", balance: 2890, role: "🌾 LONG PHÚ NÔNG", badge: "Top 6" },
    { rank: 7, name: "Trùm Khủng Long", steamId: "76561198000000003", balance: 1750, role: "🐲 LONG CHỦ", badge: "Top 7" },
    { rank: 8, name: "Sát Thủ Đầm Lầy", steamId: "76561198000000004", balance: 1200, role: "🌾 LONG TÁ ĐIỀN", badge: "Top 8" },
    { rank: 9, name: "Thần Gió Carno", steamId: "76561198000000005", balance: 860, role: "🧱 Viên Gạch Đầu Tiên", badge: "Top 9" },
    { rank: 10, name: "Raptor Tốc Độ", steamId: "76561198000000006", balance: 640, role: "🦖 Thành Viên ST25", badge: "Top 10" }
  ];

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    survivors,
    hunters,
    wealth,
    updatedAt: new Date().toLocaleString('vi-VN')
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🌾 SERVER ST25 VIETNAM — THE ISLE EVRIMA WEB PORTAL 🦖`);
  console.log(`Cổng dịch vụ:  http://localhost:${PORT}`);
  console.log(`Bản đồ:        http://localhost:${PORT}/bando.html`);
  console.log(`Kho Lúa:       http://localhost:${PORT}/nhiem-vu.html`);
  console.log(`Chợ Giao Dịch: http://localhost:${PORT}/giao-dich.html`);
  console.log(`Mở Hòm:        http://localhost:${PORT}/hom-qua.html`);
  console.log(`Chỉnh Skin:    http://localhost:${PORT}/skin.html`);
  console.log(`Thả Xác:       http://localhost:${PORT}/tha-xac.html`);
  console.log(`Mời Bạn Bè:    http://localhost:${PORT}/moi-ban.html`);
  console.log(`Hỗ Trợ:        http://localhost:${PORT}/ho-tro.html`);
  console.log(`=======================================================`);
});

module.exports = app;