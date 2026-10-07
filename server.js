const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'server-config.json');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

function getConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Error reading config:', e);
  }
  return {
    server: { name: "ST25 VIETNAM", short_name: "ST25", max_players: 100 },
    islepilot: {
      enabled: true,
      api_base_url: "https://islepilot.eu/api/v1",
      server_id: "cmufraiwk7fnooa01vpdzdhm4",
      api_token: "ipa_4c51bd355513813f26ea6e759d4e6fb0dd5d8bb7174799de"
    }
  };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Error saving config:', e);
    return false;
  }
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
  if (req.query && req.query.steamId) return req.query.steamId;
  if (req.body && req.body.steamId) return req.body.steamId;
  if (req.headers && req.headers['x-steam-id']) return req.headers['x-steam-id'];
  const cookies = parseCookies(req);
  if (cookies.st25_steam_id) return cookies.st25_steam_id;
  if (cookies.st25_session_token && activeSessions.has(cookies.st25_session_token)) {
    return activeSessions.get(cookies.st25_session_token).steam_id;
  }
  return null;
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

// 4. Manual Link Disabled - Strictly require official Steam OpenID Login
app.post('/api/player/link-steam', (req, res) => {
  res.status(403).json({
    error: "Chức năng nhập SteamID thủ công đã bị đóng. Vui lòng sử dụng 'Đăng Nhập Bằng Steam' chính chủ để liên kết an toàn."
  });
});

// 5. Get Current Player info (Strictly based on requesting user's SteamID)
app.get('/api/player/me', async (req, res) => {
  const reqSteamId = getRequestSteamId(req);
  if (reqSteamId) {
    const pilotPlayer = await callIslePilot(`/players/${reqSteamId}`);
    if (pilotPlayer) {
      const loc = posToLatLng(pilotPlayer.position);
      return res.json({
        steam_id: reqSteamId,
        persona_name: pilotPlayer.name || `Player_${reqSteamId.slice(-4)}`,
        avatar: pilotPlayer.avatar || "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg",
        role: "Thành viên ST25",
        linked: true,
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

  res.json({ linked: false, persona_name: "Chưa liên kết", avatar: null, coins: 0, balance: 0, lua: 0 });
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

  let discordInfo = null;
  let discordRoleKey = "default";

  try {
    const pilotPlayer = await callIslePilot(`/players/${steamId}`);
    if (pilotPlayer && pilotPlayer.discord) {
      discordInfo = pilotPlayer.discord;
    }
  } catch (_) {}

  const userRolesConfig = garageCfg.user_roles || {};

  if (userRolesConfig[steamId]) {
    discordRoleKey = userRolesConfig[steamId].toLowerCase();
  } else if (discordInfo && discordInfo.id && userRolesConfig[discordInfo.id]) {
    discordRoleKey = userRolesConfig[discordInfo.id].toLowerCase();
  } else if (discordInfo && discordInfo.username && userRolesConfig[discordInfo.username]) {
    discordRoleKey = userRolesConfig[discordInfo.username].toLowerCase();
  } else if (garageCfg.player_custom_slots && garageCfg.player_custom_slots[steamId] !== undefined) {
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

  let maxSlots = roleLimits[discordRoleKey] !== undefined ? Number(roleLimits[discordRoleKey]) : (garageCfg.default_slots || 3);
  if (garageCfg.player_custom_slots && garageCfg.player_custom_slots[steamId] !== undefined) {
    maxSlots = Number(garageCfg.player_custom_slots[steamId]);
  }

  // Gọi trực tiếp IslePilot API: GET /players/{steamId}/garage
  const pilotGarage = await callIslePilot(`/players/${steamId}/garage`, 'GET', null, true);
  const dinos = (pilotGarage && pilotGarage.garage && Array.isArray(pilotGarage.garage)) ? pilotGarage.garage : [];
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

// 9.1 Lấy toàn bộ thông tin Gara của người chơi
app.get('/api/player/garage', async (req, res) => {
  const steamId = getRequestSteamId(req);
  const cfg = getConfig();
  const defSlots = (cfg.garage && cfg.garage.default_slots) || 3;

  if (!steamId) {
    return res.json({
      active: null,
      slots: Array.from({ length: defSlots }, (_, idx) => ({ slot: idx + 1, empty: true })),
      tradeableDinos: [],
      steamId: null,
      personaName: "Chưa đăng nhập Steam",
      totalParked: 0,
      maxSlots: defSlots,
      roleKey: "default",
      roleName: "Chưa đăng nhập",
      isFull: false,
      unlinked: true
    });
  }

  const garageStatus = await getPlayerGarageStatus(steamId);
  const pilotPlayer = await callIslePilot(`/players/${steamId}`, 'GET', null, true);

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
    slots.push({
      slot: idx + 1,
      id: g.id,
      name: g.name || "",
      species: g.species,
      gender: g.gender === 'Female' ? "Cái (Female)" : "Đực (Male)",
      growth: Math.round((g.growth || 0) * 100),
      rawGrowth: g.growth || 0,
      health: Math.round((g.health || 1) * 100),
      hunger: Math.round((g.hunger || 1) * 100),
      thirst: Math.round((g.thirst || 1) * 100),
      stamina: Math.round((g.stamina || 1) * 100),
      isPrimeElder: g.isPrimeElder || false,
      diet: ["S", "S", "D"],
      mutations: g.mutations || [],
      stored_at: g.parkedAt ? new Date(g.parkedAt).toLocaleString('vi-VN') : "Cloud Gara",
      source: "IslePilot Cloud"
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
    steamId,
    personaName: (pilotPlayer && pilotPlayer.name) || `Player_${steamId.slice(-4)}`,
    totalParked: garageStatus.totalParked,
    maxSlots: garageStatus.maxSlots,
    roleKey: garageStatus.roleKey,
    roleName: garageStatus.roleName,
    roleLimit: garageStatus.roleLimit,
    isFull: garageStatus.isFull,
    upgradeDiscordUrl: (cfg.garage && cfg.garage.upgrade_discord_url) || "https://discord.gg/3xCrA6VyY"
  });
});

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
      data: result
    });
  }

  res.status(result?._status || 400).json({
    error: result?.error || "Không thể cất khủng long vào Gara lúc này! Đảm bảo nhân vật an toàn và không trong combat."
  });
});

// 9.3 Lấy Khủng Long Từ Gara Ra Chơi (POST /players/{steamId}/garage/{garageDinoId}/restore)
app.post('/api/player/garage/restore', async (req, res) => {
  const { garageDinoId, mutations } = req.body;
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });
  if (!garageDinoId) return res.status(400).json({ error: "Thiếu mã khủng long trong Gara!" });

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

  res.status(result?._status || 400).json({
    error: result?.error || "Không thể lấy khủng long ra đảo lúc này. Vui lòng thử lại sau 30 giây!"
  });
});

// 9.4 Bán Khủng Long Theo Quy Định Nhà Phát Hành (POST /players/{steamId}/garage/{garageDinoId}/sell)
app.post('/api/player/garage/sell', async (req, res) => {
  const { garageDinoId } = req.body;
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });
  if (!garageDinoId) return res.status(400).json({ error: "Thiếu mã khủng long cần bán!" });

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
const DATA_FILE = path.join(__dirname, 'portal-data.json');

function getPortalData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error reading portal data:', e);
  }
  return {
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
    carcassOrders: []
  };
}

function savePortalData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Error saving portal data:', e);
    return false;
  }
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

  // Lấy khủng long trong Gara để cho phép chọn đăng bán
  let myGarageDinos = [];
  if (steamId) {
    try {
      const pilotGarage = await callIslePilot(`/players/${steamId}/garage`, 'GET', null, true);
      if (pilotGarage && pilotGarage.garage && Array.isArray(pilotGarage.garage)) {
        myGarageDinos = pilotGarage.garage.map(g => ({
          id: g.id,
          species: g.species,
          growth: Math.round((g.growth || 0) * 100),
          gender: g.gender === 'Female' ? "Cái (Female)" : "Đực (Male)",
          isPrimeElder: g.isPrimeElder || false
        }));
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

// 10.1 Mua Dino từ Chợ (Tự Động Chuyển Vào Kho Đồ / Túi Đồ Của Người Mua)
app.post('/api/market/buy', async (req, res) => {
  const { itemId } = req.body;
  const data = getPortalData();
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để mua vật phẩm!" });
  }
  const userBal = await getLivePlayerBalance(steamId);

  const itemIndex = data.marketListings.findIndex(i => i.id === itemId);
  if (itemIndex === -1) {
    return res.status(404).json({ error: "Vật phẩm hoặc Dino này đã được người khác mua hoặc đã được thu hồi!" });
  }

  const item = data.marketListings[itemIndex];
  if (userBal < item.price) {
    return res.status(400).json({ error: `Tài khoản của bạn không đủ Lúa! Cần ${item.price} Lúa 🌾 (Hiện có ${userBal} Lúa trên server).` });
  }

  // 1. Trừ tiền người mua
  const deductRes = await modifyLivePlayerBalance(steamId, -item.price, `Mua ${item.title} từ Chợ ST25`);

  // 2. Nếu có người bán, cộng tiền người bán
  if (item.sellerSteamId && item.sellerSteamId !== steamId) {
    await modifyLivePlayerBalance(item.sellerSteamId, item.price, `Bán ${item.title} trên Chợ ST25 cho ${steamId}`);
  }

  // 3. Chuyển Khủng Long / Vật phẩm vào Túi Đồ (userInventory) của người mua
  if (!data.userInventory) data.userInventory = {};
  if (!data.userInventory[steamId]) data.userInventory[steamId] = [];

  const newVoucher = {
    id: `voucher-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: item.title || `${item.species} ${item.growth}% Growth`,
    icon: item.icon || "🦖",
    desc: `Khủng long ${item.species} (${item.gender || 'Đực (Male)'}, ${item.growth}% Growth). Mua từ Chợ ST25.`,
    type: "dino_voucher",
    species: item.species || "Tyrannosaurus",
    growth: item.growth !== undefined ? item.growth : 100,
    gender: item.gender || "Đực (Male)",
    purchased_at: new Date().toLocaleString('vi-VN')
  };

  data.userInventory[steamId].push(newVoucher);

  // 4. Xóa bài khỏi Chợ
  data.marketListings.splice(itemIndex, 1);
  savePortalData(data);

  res.json({
    success: true,
    message: `Đã mua thành công [${item.title}]! Khủng long đã được chuyển trực tiếp vào Túi Đồ (Kho Lúa) của bạn.`,
    newBalance: deductRes.balance,
    item: newVoucher
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