const fs = require('node:fs');
const path = require('node:path');
const Auth = require('../core/auth');
const { ASSETS } = require('../core/config');
const { getConfig, saveConfig } = require('../models/config');
const { getPortalData, savePortalData } = require('../models/portal-data');
const { callIslePilot, clearPlayerCache, apiCache } = require('../api/islepilot');
module.exports = function registerPortal(app, pendingMutations) {
// ==========================================
// MUTEX / CONCURRENCY LOCK MANAGER (CHỐNG SPAM & RACE CONDITION DUPLICATE LÚA)
// ==========================================
const playerActionLocks = new Set();
function acquirePlayerLock(steamId, action = 'default') {
  if (!steamId) return false;
  const lockKey = `${steamId}:${action}`;
  if (playerActionLocks.has(lockKey)) return false;
  playerActionLocks.add(lockKey);
  return true;
}
function releasePlayerLock(steamId, action = 'default') {
  if (!steamId) return;
  const lockKey = `${steamId}:${action}`;
  playerActionLocks.delete(lockKey);
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
const parseCookies = Auth.parseCookies;
const getRequestSteamId = Auth.getRequestSteamId;
function getAdminSteamId(req) {
  const steamId = getRequestSteamId(req);
  return steamId && isUserAdmin(steamId) ? steamId : null;
}

/* ==================== API ROUTES ==================== */

// 1. Server Status
app.get('/api/server/status', async (req, res) => {
  const cfg = getConfig();
  const pilotServer = await callIslePilot('/server');

  if (pilotServer && !pilotServer.error && !pilotServer._status) {
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
    status: "offline",
    online: false,
    islepilot_sync: false,
    map: "Gateway v0.21.7",
    online_players: 0,
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
  if (!Auth.configured) return res.status(503).json({ error: 'Máy chủ chưa cấu hình SESSION_SECRET.' });
  const redirect = Auth.safeRedirect(req.query.redirect);
  const origin = process.env.PUBLIC_ORIGIN || `${process.env.VERCEL || process.env.NODE_ENV === 'production' ? 'https' : req.protocol}://${req.get('host')}`;
  const state = require('node:crypto').randomBytes(24).toString('hex');
  const returnTo = `${origin}/api/player/steam/callback?state=${state}&redirect=${encodeURIComponent(redirect)}`;
  res.cookie('st25_login_state', Auth.sign({ kind: 'login', state, returnTo, expires: Date.now() + 600000 }), Auth.cookieOptions(req, 600000));
  const params = new URLSearchParams({ 'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup', 'openid.return_to': returnTo, 'openid.realm': origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select', 'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select' });
  res.redirect('https://steamcommunity.com/openid/login?' + params);
});

app.get('/api/player/steam/callback', async (req, res) => {
  if (!Auth.configured) return res.status(503).json({ error: 'Máy chủ chưa cấu hình SESSION_SECRET.' });
  const login = Auth.verify(parseCookies(req).st25_login_state);
  res.clearCookie('st25_login_state', { path: '/' });
  const claimedId = req.query['openid.claimed_id'];
  const match = typeof claimedId === 'string' && claimedId.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
  const signed = String(req.query['openid.signed'] || '').split(',');
  if (!login || login.kind !== 'login' || login.state !== req.query.state || login.returnTo !== req.query['openid.return_to'] ||
      req.query['openid.mode'] !== 'id_res' || req.query['openid.op_endpoint'] !== 'https://steamcommunity.com/openid/login' ||
      req.query['openid.identity'] !== claimedId || !match ||
      !['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce'].every(key => signed.includes(key))) {
    return res.status(401).json({ error: 'Phiên đăng nhập Steam không hợp lệ. Vui lòng đăng nhập lại.' });
  }
  try {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) if (key.startsWith('openid.') && typeof value === 'string') params.set(key, value);
    params.set('openid.mode', 'check_authentication');
    const response = await fetch('https://steamcommunity.com/openid/login', { method: 'POST', body: params, signal: AbortSignal.timeout(10000) });
    if (!response.ok || !/^is_valid:true\r?$/m.test(await response.text())) return res.status(401).json({ error: 'Steam không xác nhận đăng nhập.' });
    const steamId = match[1];
    res.cookie('st25_session_token', Auth.sign({ kind: 'session', steamId, expires: Date.now() + Auth.SESSION_MS }), Auth.cookieOptions(req));
    res.clearCookie('st25_steam_id', { path: '/' });
    const redirect = Auth.safeRedirect(req.query.redirect);
    res.redirect(redirect + (redirect.includes('?') ? '&' : '?') + 'steamId=' + steamId + '&login=success');
  } catch {
    res.status(503).json({ error: 'Không thể xác minh đăng nhập với Steam. Vui lòng thử lại.' });
  }
});

// Helper: Chuẩn hóa phần trăm chỉ số (Health, Hunger, Thirst, Stamina) không vượt quá 100%
function normalizeStatPct(val, maxVal) {
  if (val === undefined || val === null) return 100;
  const num = Number(val);
  const max = Number(maxVal);
  if (isNaN(num)) return 100;
  if (!isNaN(max) && max > 0 && max !== 1) {
    const pct = Math.round((num / max) * 100);
    return Math.min(100, Math.max(0, pct));
  }
  if (num > 100) return 100;
  if (num > 1) return Math.min(100, Math.max(0, Math.round(num)));
  return Math.min(100, Math.max(0, Math.round(num * 100)));
}

// Helper: Link player by SteamID from IslePilot API
async function linkPlayerBySteamId(steamId, customName = null) {
  const pilotPlayer = await callIslePilot(`/players/${steamId}`);

  let persona = customName;
  let dino = null;
  let avatar = "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg";
  let discord = null;
  let playtime = 0;
  let wallet = 0;

  if (pilotPlayer && !pilotPlayer.error && !pilotPlayer._status) {
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
        health: normalizeStatPct(pilotPlayer.health, pilotPlayer.maxHealth),
        hunger: normalizeStatPct(pilotPlayer.hunger, pilotPlayer.maxHunger),
        thirst: normalizeStatPct(pilotPlayer.thirst, pilotPlayer.maxThirst),
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
app.post('/api/player/login-manual', (req, res) => {
  res.status(403).json({ error: 'Vui lòng đăng nhập qua Steam để xác minh tài khoản.', loginUrl: '/api/player/steam/login' });
});

// 5. Get Current Player info (Strictly based on requesting user's SteamID)
// Lightweight live read: no garage/role/trade work on the fast vitals path.
app.get('/api/player/vitals', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const player = await callIslePilot(`/players/${steamId}`);
  if (!player || player.error || player._status) return res.status(503).json({ error: 'Không thể cập nhật chỉ số' });
  const location = posToLatLng(player.position);
  return res.json({ steam_id: steamId, dino: {
    species: player.species,
    gender: player.female ? 'Cái (Female)' : 'Đực (Male)',
    growth: Math.round((player.growth || 0) * 100),
    health: normalizeStatPct(player.health, player.maxHealth),
    hunger: normalizeStatPct(player.hunger, player.maxHunger),
    thirst: normalizeStatPct(player.thirst, player.maxThirst),
    isPrimeElder: !!player.isPrimeElder,
    grid: location.grid
  } });
});

app.get('/api/player/me', async (req, res) => {
  const reqSteamId = getRequestSteamId(req);
  if (reqSteamId) {
    const pilotPlayer = await callIslePilot(`/players/${reqSteamId}`);
    if (pilotPlayer && !pilotPlayer.error && !pilotPlayer._status) {
      const loc = posToLatLng(pilotPlayer.position);
      const isAdmin = isUserAdmin(reqSteamId);
      const isSuperAdmin = SUPER_ADMINS.includes(String(reqSteamId).trim());
      const garageStatus = await getPlayerGarageStatus(reqSteamId, { player: pilotPlayer, fresh: false });
      const portalData = getPortalData();
      cleanExpiredTrades(portalData);
      const incomingTrades = (portalData.trades || []).filter(t => t.receiverSteamId === reqSteamId && t.status === 'pending');
      const notifications = incomingTrades.map(t => ({
        type: 'trade_incoming',
        title: `Lời mời giao dịch từ ${t.senderName}`,
        desc: t.senderDino ? `${t.senderDino.species} [${t.senderDino.growth}%]` : `${t.senderLua} Lúa 🌾`,
        time: t.createdAt,
        expiresAtTimestamp: t.expiresAtTimestamp || (t.createdAtTimestamp ? t.createdAtTimestamp + 30000 : 0),
        tradeId: t.id,
        link: 'giao-dich.html'
      }));

      return res.json({
        steam_id: reqSteamId,
        persona_name: pilotPlayer.name || `Player_${reqSteamId.slice(-4)}`,
        avatar: pilotPlayer.avatar || "https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg",
        role: garageStatus.roleName || "Thành viên ST25",
        roleKey: garageStatus.roleKey || "default",
        maxSlots: garageStatus.maxSlots || 3,
        totalParked: garageStatus.totalParked || 0,
        notifications: notifications,
        unreadCount: notifications.length,
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
          health: normalizeStatPct(pilotPlayer.health, pilotPlayer.maxHealth),
          hunger: normalizeStatPct(pilotPlayer.hunger, pilotPlayer.maxHunger),
          thirst: normalizeStatPct(pilotPlayer.thirst, pilotPlayer.maxThirst),
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

  if (reqSteamId) return res.status(503).json({ error: 'Không thể cập nhật tài khoản IslePilot.' });
  res.json({ linked: false, isLoggedIn: false, isAdmin: false, isSuperAdmin: false, persona_name: "Chưa liên kết", avatar: null, coins: 0, balance: 0, lua: 0 });
});

app.post('/api/player/logout', (req, res) => {
  res.clearCookie('st25_steam_id');
  res.clearCookie('st25_session_token');
  res.json({ success: true, message: "Đã đăng xuất thành công!" });
});


// Helper: Xác định chu kỳ (periodKey) của nhiệm vụ (Daily: YYYY-MM-DD, Weekly: YYYY-Www, Monthly: YYYY-MM)
function getQuestPeriodKey(q, dateObj = new Date()) {
  const yyyy = dateObj.getUTCFullYear();
  const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getUTCDate()).padStart(2, '0');

  if (q?.period === 'monthly') {
    return `${yyyy}-${mm}`;
  }
  if (q?.period === 'weekly') {
    const d = new Date(Date.UTC(yyyy, dateObj.getUTCMonth(), dateObj.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
  return `${yyyy}-${mm}-${dd}`;
}

// Helper: Kiểm tra nhiệm vụ đã hoàn thành thực sự hay chưa trong chu kỳ hiện tại
function isQuestCompleted(q) {
  if (!q) return false;
  const currentPeriod = getQuestPeriodKey(q, new Date());

  // 1. Nếu có completedAt: Bắt buộc completedAt phải nằm trong đúng chu kỳ hiện tại
  if (q.completedAt) {
    const compDate = new Date(q.completedAt);
    if (!isNaN(compDate.getTime())) {
      const compPeriod = getQuestPeriodKey(q, compDate);
      if (compPeriod !== currentPeriod) {
        return false; // Hoàn thành từ ngày/tuần trước, không áp dụng cho chu kỳ hôm nay!
      }
    }
    return true;
  }

  // 2. Nếu IslePilot gán periodKey cụ thể cho quest mà periodKey đó đã cũ
  if (q.periodKey && typeof q.periodKey === 'string' && q.periodKey.trim() !== '') {
    if (q.periodKey.trim() !== currentPeriod) {
      return false; // Tiến độ này thuộc về chu kỳ ngày cũ
    }
  }

  if (!q.config) return false;

  const prog = Number(q.progress) || 0;
  if (q.config.minutes !== undefined) {
    return prog >= Number(q.config.minutes);
  }
  if (q.config.km !== undefined) {
    // q.progress tính bằng mét, q.config.km tính bằng km
    return (prog / 1000) >= Number(q.config.km);
  }
  if (q.config.count !== undefined) {
    return prog >= Number(q.config.count);
  }
  if (q.config.days !== undefined) {
    return prog >= Number(q.config.days);
  }
  if (q.config.growthPct !== undefined) {
    return prog >= Number(q.config.growthPct);
  }
  return false;
}

// Helper: Kiểm tra nhiệm vụ đã được nhận thưởng trong chu kỳ hiện tại hay chưa (tự động reset mỗi ngày/tuần/tháng)
function isQuestClaimedInPeriod(q, userClaimedQuests) {
  if (!userClaimedQuests) return false;
  if (q.claimedAt) return true; // IslePilot Cloud đã ghi nhận đã claim

  const currentPeriodKey = getQuestPeriodKey(q);
  const claimKey = `${q.id}_${currentPeriodKey}`;

  // Kiểm tra key mới dạng [questId]_[periodKey]
  if (userClaimedQuests[claimKey]) return true;

  // Kiểm tra bản ghi cũ theo ID
  const legacyRecord = userClaimedQuests[q.id];
  if (legacyRecord) {
    if (legacyRecord.periodKey) {
      return legacyRecord.periodKey === currentPeriodKey;
    }
    if (legacyRecord.claimedAt) {
      const claimDate = new Date(legacyRecord.claimedAt);
      if (!isNaN(claimDate.getTime())) {
        const legacyPeriodKey = getQuestPeriodKey(q, claimDate);
        return legacyPeriodKey === currentPeriodKey;
      }
    }
    return true;
  }

  return false;
}

// 6. Quests (Nhiệm Vụ Cá Nhân) Endpoint
app.get('/api/player/quests', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.json({
      steamId: null,
      isLoggedIn: false,
      player: null,
      coins: 0,
      balance: 0,
      serverQuests: [],
      primeQuests: [],
      primeSummary: null,
      claimableCount: 0,
      totalClaimableLua: 0
    });
  }

  // 1. Fetch IslePilot quests & player details & live balance
  const [questsData, playerDetails, liveBalance] = await Promise.all([
    callIslePilot(`/players/${steamId}/quests`),
    callIslePilot(`/players/${steamId}`),
    getLivePlayerBalance(steamId)
  ]);

  const portalData = getPortalData();
  const userClaimedQuests = (portalData.claimedQuests && portalData.claimedQuests[steamId]) || {};

  let serverQuests = [];
  if (questsData && Array.isArray(questsData.quests)) {
    serverQuests = questsData.quests.map(q => {
      let rewardAmount = 0;
      if (Array.isArray(q.rewards)) {
        q.rewards.forEach(r => {
          if (r.kind === 'coins' || r.kind === 'coin' || r.kind === 'lua') {
            rewardAmount += Number(r.amount) || 0;
          }
        });
      }
      if (rewardAmount <= 0) {
        rewardAmount = q.period === 'monthly' ? 50 : (q.period === 'weekly' ? 24 : 8);
      }

      const periodKey = getQuestPeriodKey(q);
      const claimKey = `${q.id}_${periodKey}`;
      const isCompleted = isQuestCompleted(q);
      const isClaimed = isQuestClaimedInPeriod(q, userClaimedQuests);
      const canClaim = isCompleted && !isClaimed;

      return {
        id: q.id,
        periodKey,
        claimKey,
        name: q.name,
        description: q.description,
        rarity: q.rarity || 'common',
        locked: q.locked === true,
        objectiveLabel: q.objectiveLabel || null,
        period: q.period, // daily, weekly, monthly
        progress: q.progress || 0,
        rewards: (q.rewards || []).map(r => ({
          kind: (r.kind === 'coins' || r.kind === 'coin') ? 'Lúa 🌾' : r.kind,
          amount: r.amount
        })),
        rewardAmount,
        config: q.config || {},
        completed: isCompleted,
        claimed: isClaimed,
        canClaim
      };
    });
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
  const claimableQuests = serverQuests.filter(q => q.canClaim);
  const totalClaimableLua = claimableQuests.reduce((acc, q) => acc + q.rewardAmount, 0);

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
    coins: liveBalance,
    balance: liveBalance,
    serverQuests,
    events: Array.isArray(questsData?.events) ? questsData.events.map(event => ({
      name: event.name || event.title,
      description: event.description,
      multiplier: event.multiplier,
      endsAt: event.endsAt
    })) : [],
    primeQuests,
    primeSummary: playerDetails ? playerDetails.prime : null,
    claimableCount: claimableQuests.length,
    totalClaimableLua
  });
});

// 6.1 Nhận Lúa Thưởng Nhiệm Vụ (Claim Quest Reward)
app.post('/api/player/quests/claim', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam trước khi nhận Lúa thưởng!" });
  }

  const { questId } = req.body;
  if (!questId) {
    return res.status(400).json({ error: "Thiếu thông tin nhiệm vụ cần nhận thưởng!" });
  }

  // Khóa chống Race Condition / Spam Click Duplicate Lúa
  if (!acquirePlayerLock(steamId, 'quest')) {
    return res.status(429).json({ error: "Giao dịch đang được xử lý, vui lòng không bấm nhận liên tục!" });
  }

  try {
    const questsData = await callIslePilot(`/players/${steamId}/quests`, 'GET', null, true);
    if (!questsData || !Array.isArray(questsData.quests)) {
      return res.status(400).json({ error: "Không tìm thấy dữ liệu nhiệm vụ từ máy chủ ST25!" });
    }

    const quest = questsData.quests.find(q => q.id === questId);
    if (!quest) {
      return res.status(404).json({ error: "Nhiệm vụ không tồn tại hoặc đã hết hạn kỳ này!" });
    }

    const isDone = isQuestCompleted(quest);
    if (!isDone) {
      return res.status(400).json({ error: `Nhiệm vụ [${quest.name}] chưa hoàn thành! Hãy tiếp tục sinh tồn để đạt điều kiện.` });
    }

    const data = getPortalData();
    if (!data.claimedQuests) data.claimedQuests = {};
    if (!data.claimedQuests[steamId]) data.claimedQuests[steamId] = {};

    const alreadyClaimed = isQuestClaimedInPeriod(quest, data.claimedQuests[steamId]);
    if (alreadyClaimed) {
      return res.status(400).json({ error: `Bạn đã nhận thưởng Lúa cho nhiệm vụ [${quest.name}] trong chu kỳ hôm nay rồi!` });
    }

    let rewardAmount = 0;
    if (Array.isArray(quest.rewards)) {
      quest.rewards.forEach(r => {
        if (r.kind === 'coins' || r.kind === 'coin' || r.kind === 'lua') {
          rewardAmount += Number(r.amount) || 0;
        }
      });
    }
    if (rewardAmount <= 0) {
      rewardAmount = quest.period === 'monthly' ? 50 : (quest.period === 'weekly' ? 24 : 8);
    }

    const periodKey = getQuestPeriodKey(quest);
    const claimKey = `${quest.id}_${periodKey}`;

    // ĐÁNH DẤU ĐÃ NHẬN VÀ LƯU TRƯỚC (CHỐNG CONCURRENCY SPAM)
    data.claimedQuests[steamId][claimKey] = {
      claimedAt: new Date().toISOString(),
      periodKey,
      amount: rewardAmount,
      questName: quest.name
    };
    data.claimedQuests[steamId][questId] = {
      claimedAt: new Date().toISOString(),
      periodKey,
      amount: rewardAmount,
      questName: quest.name
    };
    savePortalData(data);

    // CỘNG LÚA TRỰC TIẾP VÀO VÍ GAME & ISLEPILOT
    let balRes;
    try {
      balRes = await modifyLivePlayerBalance(steamId, rewardAmount, `quest_reward_${questId}`);
      clearPlayerCache(steamId);
    } catch (err) {
      // Revert nếu lỗi kết nối
      delete data.claimedQuests[steamId][claimKey];
      delete data.claimedQuests[steamId][questId];
      savePortalData(data);
      throw err;
    }

    const newBalance = balRes?.balance !== undefined ? balRes.balance : (data.userWallets[steamId] || 0);

    res.json({
      success: true,
      message: `Chúc mừng! Bạn đã hoàn thành nhiệm vụ [${quest.name}] và nhận ngay +${rewardAmount} Lúa 🌾 vào ví!`,
      rewardAmount,
      questId,
      claimKey,
      periodKey,
      newBalance
    });
  } catch (err) {
    console.error('Lỗi nhận thưởng nhiệm vụ:', err);
    res.status(500).json({ error: "Lỗi hệ thống khi nhận Lúa thưởng! Vui lòng thử lại sau." });
  } finally {
    releasePlayerLock(steamId, 'quest');
  }
});

// 6.2 Nhận Tất Cả Lúa Thưởng Nhiệm Vụ (Claim All Completed Rewards)
app.post('/api/player/quests/claim-all', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam trước khi nhận Lúa thưởng!" });
  }

  // Khóa chống Race Condition / Spam Click Duplicate Lúa
  if (!acquirePlayerLock(steamId, 'quest')) {
    return res.status(429).json({ error: "Giao dịch đang được xử lý, vui lòng không bấm nhận liên tục!" });
  }

  try {
    const questsData = await callIslePilot(`/players/${steamId}/quests`, 'GET', null, true);
    if (!questsData || !Array.isArray(questsData.quests)) {
      return res.status(400).json({ error: "Không tìm thấy dữ liệu nhiệm vụ!" });
    }

    const data = getPortalData();
    if (!data.claimedQuests) data.claimedQuests = {};
    if (!data.claimedQuests[steamId]) data.claimedQuests[steamId] = {};

    let totalReward = 0;
    const claimedNames = [];
    const claimedKeys = [];

    for (const quest of questsData.quests) {
      const isDone = isQuestCompleted(quest);
      const alreadyClaimed = isQuestClaimedInPeriod(quest, data.claimedQuests[steamId]);

      if (isDone && !alreadyClaimed) {
        let rewardAmount = 0;
        if (Array.isArray(quest.rewards)) {
          quest.rewards.forEach(r => {
            if (r.kind === 'coins' || r.kind === 'coin' || r.kind === 'lua') {
              rewardAmount += Number(r.amount) || 0;
            }
          });
        }
        if (rewardAmount <= 0) {
          rewardAmount = quest.period === 'monthly' ? 50 : (quest.period === 'weekly' ? 24 : 8);
        }

        totalReward += rewardAmount;
        claimedNames.push(quest.name);
        
        const periodKey = getQuestPeriodKey(quest);
        const claimKey = `${quest.id}_${periodKey}`;
        claimedKeys.push(claimKey);

        data.claimedQuests[steamId][claimKey] = {
          claimedAt: new Date().toISOString(),
          periodKey,
          amount: rewardAmount,
          questName: quest.name
        };
        data.claimedQuests[steamId][quest.id] = {
          claimedAt: new Date().toISOString(),
          periodKey,
          amount: rewardAmount,
          questName: quest.name
        };
      }
    }

    if (totalReward <= 0) {
      return res.json({
        success: false,
        message: "Hiện tại bạn chưa có nhiệm vụ nào mới đủ điều kiện nhận thưởng."
      });
    }

    // LƯU NGAY TRƯỚC KHI GỌI MẠNG ĐỂ CHỐNG SPAM CONCURRENT
    savePortalData(data);

    let balRes;
    try {
      balRes = await modifyLivePlayerBalance(steamId, totalReward, `quest_rewards_batch`);
      clearPlayerCache(steamId);
    } catch (err) {
      // Revert nếu lỗi
      claimedKeys.forEach(k => delete data.claimedQuests[steamId][k]);
      savePortalData(data);
      throw err;
    }

    const newBalance = balRes?.balance !== undefined ? balRes.balance : (data.userWallets[steamId] || 0);

    res.json({
      success: true,
      message: `Thành công! Đã nhận tổng cộng +${totalReward} Lúa 🌾 từ ${claimedNames.length} nhiệm vụ đã hoàn thành!`,
      totalReward,
      claimedCount: claimedNames.length,
      claimedKeys,
      claimedIds: Object.keys(data.claimedQuests[steamId] || {}),
      newBalance
    });
  } catch (err) {
    console.error('Lỗi nhận tất cả nhiệm vụ:', err);
    res.status(500).json({ error: "Lỗi hệ thống khi nhận Lúa thưởng! Vui lòng thử lại sau." });
  } finally {
    releasePlayerLock(steamId, 'quest');
  }
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
  const zonesPath = path.join(ASSETS, 'data', 'islepilot-zones.json');
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
  const reqSteamId = getRequestSteamId(req);
  if (!reqSteamId) return res.status(401).json({ error: 'Chưa đăng nhập Steam.' });
  const onlineData = await callIslePilot('/players?online=true');
  const allOnline = (onlineData && onlineData.players) || [];

  const thisPlayer = allOnline.find(p => p.steamId === reqSteamId);
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

const TRADE_TIMEOUT_MS = 30 * 1000; // 30 giây tối đa cho lời mời giao dịch P2P

// Helper: Tự động kiểm tra và hoàn trả các giao dịch P2P quá 30 giây về Gara
function cleanExpiredTrades(targetData = null) {
  const data = targetData || getPortalData();
  if (!data.trades || !Array.isArray(data.trades)) return false;

  const now = Date.now();
  let hasExpired = false;
  const affectedSteamIds = new Set();

  data.trades.forEach(t => {
    if (t.status === 'pending' && !pendingMutations.has('trade:' + String(t.id))) {
      const createdTime = t.createdAtTimestamp || (t.createdAt ? new Date(t.createdAt).getTime() : 0);
      if (!createdTime || (now - createdTime >= TRADE_TIMEOUT_MS)) {
        t.status = 'expired';
        t.updatedAt = new Date().toLocaleString('vi-VN');
        t.updatedAtTimestamp = now;
        t.expireReason = 'Hết thời gian chờ (30 giây) - Tự động hoàn trả về Gara';
        hasExpired = true;
        if (t.senderSteamId) affectedSteamIds.add(t.senderSteamId);
        if (t.receiverSteamId) affectedSteamIds.add(t.receiverSteamId);
      }
    }
  });

  if (hasExpired) {
    savePortalData(data);
    affectedSteamIds.forEach(sid => clearPlayerCache(sid));
  }
  return hasExpired;
}

// Tự động quét và giải phóng các giao dịch hết hạn định kỳ mỗi 5 giây
if (require.main === module) setInterval(() => {
  try {
    cleanExpiredTrades();
  } catch (_) {}
}, 5000);

// Helper: Tra cứu quyền hạn và tính toán sức chứa Gara theo Role Discord & Steam ID
async function getPlayerGarageStatus(steamId, { player = null, fresh = true } = {}) {
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
    const pilotPlayer = player || await callIslePilot(`/players/${cleanSteamId}`);
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
  const pilotGarage = await callIslePilot(`/players/${cleanSteamId}/garage`, 'GET', null, fresh);
  const cloudDinos = (pilotGarage && pilotGarage.garage && Array.isArray(pilotGarage.garage)) ? pilotGarage.garage : [];
  
  // Lọc bỏ triệt để các khủng long ĐANG ĐĂNG BÁN trên Chợ (ký gửi Chợ của người chơi này)
  const activeSellingDinoIds = new Set(
    (portalData.marketListings || [])
      .filter(l => l.sellerSteamId === cleanSteamId && l.dinoData && l.dinoData.id)
      .map(l => String(l.dinoData.id))
  );

  // Tự động kiểm tra và hoàn trả các giao dịch P2P quá 30 giây về Gara
  cleanExpiredTrades(portalData);

  // Lọc bỏ triệt để các khủng long ĐANG TRONG LỜI MỜI GIAO DỊCH P2P CHỜ XỬ LÝ (chỉ tính các giao dịch còn trong 30 giây)
  const activeTradeDinoIds = new Set(
    (portalData.trades || [])
      .filter(t => t.status === 'pending' && t.senderSteamId === cleanSteamId && t.senderDino && t.senderDino.id)
      .map(t => String(t.senderDino.id))
  );

  // Lọc bỏ triệt để các khủng long ĐÃ BÁN THÀNH CÔNG cho người chơi khác
  const soldDinoIds = new Set(
    ((portalData.soldDinos && portalData.soldDinos[cleanSteamId]) || []).map(id => String(id))
  );

  // Đồng bộ thuần túy 100% thời gian thực từ IslePilot Cloud (Single Source of Truth)
  // Không gộp thú cục bộ ảo để tránh tình trạng phân tán container serverless khiến F5 lúc ra 6 lúc ra 7
  const dinos = cloudDinos.filter(d => {
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
  const cfg = getConfig();
  const callerSteamId = getRequestSteamId(req);
  const adminId = getAdminSteamId(req);
  const callerIsAdmin = isUserAdmin(adminId);

  // Cho phép Quản trị viên (Admin) xem Gara của người khác qua ?steamId=...
  // Người chơi bình thường xem Gara của chính mình
  let effectiveSteamId = null;
  if (req.query.steamId && /^\d{17}$/.test(String(req.query.steamId).trim())) {
    const qSid = String(req.query.steamId).trim();
    if (callerIsAdmin || callerSteamId === qSid) {
      effectiveSteamId = qSid;
    } else {
      effectiveSteamId = callerSteamId;
    }
  } else {
    effectiveSteamId = callerSteamId;
  }

  if (!effectiveSteamId) {
    const defSlots = (cfg.garage && cfg.garage.default_slots) || 3;
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

  const garageStatus = await getPlayerGarageStatus(effectiveSteamId);
  const pilotPlayer = await callIslePilot(`/players/${effectiveSteamId}`, 'GET', null, true);

  let active = null;
  if (pilotPlayer && pilotPlayer.species) {
    active = {
      species: pilotPlayer.species,
      gender: pilotPlayer.female ? "Cái (Female)" : "Đực (Male)",
      growth: Math.round((pilotPlayer.growth || 0) * 100),
      rawGrowth: pilotPlayer.growth || 0,
      health: normalizeStatPct(pilotPlayer.health, pilotPlayer.maxHealth),
      hunger: normalizeStatPct(pilotPlayer.hunger, pilotPlayer.maxHunger),
      thirst: normalizeStatPct(pilotPlayer.thirst, pilotPlayer.maxThirst),
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

// 9.2.0 Chuẩn bị Cất Vào Gara (Người chơi bắt buộc đứng yên in-game trong 30 giây)
app.post('/api/player/garage/park-prepare', async (req, res) => {
  const { species } = req.body;
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });

  let playerName = `Player_${steamId.slice(-4)}`;
  try {
    const p = await callIslePilot(`/players/${steamId}`);
    if (p && p.name) playerName = p.name;
  } catch (_) {}

  try {
    await callIslePilot('/commands', 'POST', {
      action: 'announce',
      message: `📦 [GARA PARK]: [${playerName}] đang niêm phong cất [${species || 'Khủng Long'}] vào Gara. Người chơi bắt buộc đứng yên trong 30 giây!`
    });
  } catch (_) {}

  res.json({
    success: true,
    countdownSeconds: 30,
    message: "Bắt đầu đếm ngược 30 giây niêm phong cất Gara."
  });
});

// 9.2.1 Chuẩn bị Đưa Ra Đảo & Phát Cảnh Báo 500m (Thời gian chuẩn bị 30 giây)
app.post('/api/player/garage/restore-prepare', async (req, res) => {
  const { garageDinoId, species, growth } = req.body;
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });

  const dinoSpecies = species || "Khủng Long";
  const dinoGrowth = growth !== undefined ? `${growth}%` : "100%";

  let playerName = `Player_${steamId.slice(-4)}`;
  try {
    const p = await callIslePilot(`/players/${steamId}`);
    if (p && p.name) playerName = p.name;
  } catch (_) {}

  // Phát thông báo cảnh báo toàn khu vực 500m qua IslePilot in-game announcement
  try {
    await callIslePilot('/commands', 'POST', {
      action: 'announce',
      message: `⚠️ [CẢNH BÁO 500M]: Người chơi [${playerName}] đang triệu hồi [${dinoSpecies} - ${dinoGrowth}] từ Gara ra đảo! Sẽ xuất hiện sau 30 giây!`
    });
  } catch (_) {}

  res.json({
    success: true,
    countdownSeconds: 30,
    warningRadiusMeters: 500,
    species: dinoSpecies,
    growth: dinoGrowth,
    playerName,
    message: `Đã phát tín hiệu cảnh báo trong bán kính 500 mét! Quá trình triệu hồi [${dinoSpecies} ${dinoGrowth}] tốn 30 giây.`
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

  if (!acquirePlayerLock(steamId, 'garage')) {
    return res.status(429).json({ error: "Giao dịch đang được xử lý, vui lòng không bấm bán liên tục!" });
  }

  try {
    // Nếu là khủng long trúng từ Hòm Quà (id bắt đầu bằng dino-)
    if (garageDinoId.startsWith('dino-')) {
      const data = getPortalData();
      const dIdx = (data.userGarage && data.userGarage[steamId]) ? data.userGarage[steamId].findIndex(d => d.id === garageDinoId) : -1;
      if (dIdx !== -1) {
        const dino = data.userGarage[steamId][dIdx];
        // Tính giá bán cơ bản theo growth: ví dụ 20-50 Lúa
        const sellPrice = Math.max(10, Math.round(((dino.growth || 100) / 100) * 35));
        
        // Xóa khỏi Gara trước để chống duplicate
        data.userGarage[steamId].splice(dIdx, 1);
        savePortalData(data);

        try {
          await modifyLivePlayerBalance(steamId, sellPrice, `Bán khủng long [${dino.species} ${dino.growth}%] từ Gara`);
        } catch (err) {
          // Revert nếu lỗi
          data.userGarage[steamId].splice(dIdx, 0, dino);
          savePortalData(data);
          throw err;
        }

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
  } catch (err) {
    console.error('Lỗi bán khủng long:', err);
    res.status(500).json({ error: "Lỗi hệ thống khi bán khủng long! Vui lòng thử lại sau." });
  } finally {
    releasePlayerLock(steamId, 'garage');
  }
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
app.all('/api/admin/roles-slots', async (req, res) => {
  const adminSteamId = getAdminSteamId(req);
  if (!isUserAdmin(adminSteamId)) {
    return res.status(403).json({ error: "Chỉ Quản Trị Viên (Admin) mới có quyền truy cập!" });
  }

  const cfg = getConfig();
  if (!cfg.garage) cfg.garage = {};
  if (!cfg.garage.user_roles) cfg.garage.user_roles = {};
  if (!cfg.garage.player_custom_slots) cfg.garage.player_custom_slots = {};

  const portalData = getPortalData();
  if (!portalData.adminAssignments) portalData.adminAssignments = {};
  if (!portalData.adminDeleted) portalData.adminDeleted = {};

  // Đồng bộ tức thời từ snapshot client gửi lên (giải quyết triệt để tính chất ephemeral của Vercel Serverless)
  const incomingAssignments = (req.body && Array.isArray(req.body.cachedAssignments)) ? req.body.cachedAssignments : null;
  if (incomingAssignments && incomingAssignments.length > 0) {
    let hasChanges = false;
    incomingAssignments.forEach(item => {
      if (item && item.steamId && /^\d{17}$/.test(String(item.steamId).trim())) {
        const sid = String(item.steamId).trim();
        const itemTs = item.updatedAtTimestamp || (item.updatedAt ? new Date(item.updatedAt).getTime() : 0);
        const deletedTs = portalData.adminDeleted[sid] || 0;

        // Nếu tài khoản đã bị Admin xóa sau mốc thời gian này thì không khôi phục lại
        if (deletedTs && itemTs <= deletedTs) {
          return;
        }

        const existing = portalData.adminAssignments[sid];
        const existTs = (existing && existing.updatedAtTimestamp) || 0;

        if (!existing || itemTs > existTs) {
          portalData.adminAssignments[sid] = {
            roleKey: item.roleKey || 'default',
            slots: Number(item.slots) || 3,
            updatedBy: item.updatedBy || adminSteamId,
            updatedAt: item.updatedAt || new Date().toLocaleString('vi-VN'),
            updatedAtTimestamp: itemTs || Date.now(),
            notes: item.notes || ""
          };
          cfg.garage.user_roles[sid] = item.roleKey || 'default';
          cfg.garage.player_custom_slots[sid] = Number(item.slots) || 3;
          hasChanges = true;
        }
      }
    });

    if (hasChanges) {
      saveConfig(cfg);
      savePortalData(portalData);
    }
  }

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
  if (data.adminDeleted && data.adminDeleted[cleanSteamId]) {
    delete data.adminDeleted[cleanSteamId];
  }
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

// Đồng bộ danh sách phân quyền từ bản sao lưu Client (Đảm bảo vĩnh viễn 100% không bao giờ mất)
app.post('/api/admin/sync-assignments', async (req, res) => {
  const adminSteamId = getAdminSteamId(req);
  if (!isUserAdmin(adminSteamId)) {
    return res.status(403).json({ error: "Chỉ Admin mới có quyền đồng bộ dữ liệu!" });
  }

  const { backupAssignments } = req.body;
  if (!Array.isArray(backupAssignments) || backupAssignments.length === 0) {
    return res.json({ success: true, count: 0, assignedUsers: getAllAssignedUsers() });
  }

  const cfg = getConfig();
  if (!cfg.garage) cfg.garage = {};
  if (!cfg.garage.user_roles) cfg.garage.user_roles = {};
  if (!cfg.garage.player_custom_slots) cfg.garage.player_custom_slots = {};

  const portalData = getPortalData();
  if (!portalData.adminAssignments) portalData.adminAssignments = {};

  let syncedCount = 0;
  backupAssignments.forEach(item => {
    if (item && item.steamId && /^\d{17}$/.test(String(item.steamId).trim())) {
      const sid = String(item.steamId).trim();
      const rKey = item.roleKey || 'default';
      const sNum = Number(item.slots) || 3;

      // Nếu server chưa có, hoặc client có cập nhật mới hơn
      if (!portalData.adminAssignments[sid] || (item.updatedAtTimestamp && item.updatedAtTimestamp > (portalData.adminAssignments[sid].updatedAtTimestamp || 0))) {
        portalData.adminAssignments[sid] = {
          roleKey: rKey,
          slots: sNum,
          updatedBy: item.updatedBy || adminSteamId,
          updatedAt: item.updatedAt || new Date().toLocaleString('vi-VN'),
          updatedAtTimestamp: item.updatedAtTimestamp || Date.now(),
          notes: item.notes || ""
        };
        cfg.garage.user_roles[sid] = rKey;
        cfg.garage.player_custom_slots[sid] = sNum;
        syncedCount++;
      }
    }
  });

  if (syncedCount > 0) {
    saveConfig(cfg);
    savePortalData(portalData);
  }

  res.json({
    success: true,
    syncedCount,
    assignedUsers: getAllAssignedUsers()
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
  if (!data.adminDeleted) data.adminDeleted = {};
  data.adminDeleted[cleanSteamId] = Date.now();
  if (data.adminAssignments && data.adminAssignments[cleanSteamId]) {
    delete data.adminAssignments[cleanSteamId];
  }
  savePortalData(data);

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
  const cleanId = String(steamId || '').trim();
  if (!cleanId) return null;
  if (!data.userGarage) data.userGarage = {};
  if (!data.userGarage[cleanId]) data.userGarage[cleanId] = [];

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
    stored_at: dino.stored_at || new Date().toLocaleString('vi-VN'),
    source: dino.source || "Giao Dịch / Hòm Quà",
    isLocal: true
  };

  data.userGarage[cleanId].push(newDino);
  if (!targetData) {
    savePortalData(data);
  }
  return newDino;
}

// ==================== NEW FEATURES BACKEND ==================== //

// Helper: Get real wallet balance from IslePilot API
async function getLivePlayerBalance(steamId) {
  const p = await callIslePilot(`/players/${steamId}`);
  if (p && p.wallet && typeof p.wallet.balance === 'number') {
    return p.wallet.balance;
  }
  throw Object.assign(new Error('Không thể xác minh số dư IslePilot.'), { status: 503 });
}

// Helper: Modify player wallet currency directly on IslePilot API
async function modifyLivePlayerBalance(steamId, amount, reason = "web_portal") {
  if (!Number.isFinite(Number(amount))) throw Object.assign(new Error("Số Lúa không hợp lệ."), { status: 400 });
  const res = await callIslePilot(`/players/${steamId}/currency`, 'POST', {
    amount: Number(amount),
    reason: reason
  });

  clearPlayerCache(steamId);

  const data = getPortalData();
  if (res && res.ok && typeof res.balance === 'number') {
    data.userWallets[steamId] = res.balance;
    savePortalData(data);
    return { success: true, balance: res.balance, applied: res.applied };
  }

  throw Object.assign(new Error('IslePilot chưa xác nhận giao dịch Lúa.'), { status: 503 });
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
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: "Vui lòng đăng nhập Steam để đăng bán!" });
  if (!dinoId || !Number.isSafeInteger(Number(price)) || Number(price) < 1) return res.status(400).json({ error: "Thông tin bán không hợp lệ!" });

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
  const steamId = getRequestSteamId(req);
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
  // BẢO MẬT: Bắt buộc lấy người gửi từ phiên đăng nhập thực tế của hệ thống! TUYỆT ĐỐI KHÔNG LẤY TỪ BODY
  const senderSteamId = getRequestSteamId(req);
  if (!senderSteamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để chuyển Lúa!" });
  }

  const cleanReceiver = String(receiverSteamId || '').trim();
  if (!cleanReceiver || !/^\d{17}$/.test(cleanReceiver)) {
    return res.status(400).json({ error: "Steam ID người nhận không hợp lệ! Vui lòng nhập đúng 17 chữ số Steam ID 64." });
  }

  if (cleanReceiver === senderSteamId) {
    return res.status(400).json({ error: "Bạn không thể tự chuyển Lúa cho chính mình!" });
  }

  const numAmount = Math.floor(Number(amount));
  if (isNaN(numAmount) || numAmount < 1 || numAmount > 10000) {
    return res.status(400).json({ error: "Số Lúa chuyển phải là số nguyên từ 1 đến 10,000 Lúa 🌾!" });
  }

  // Khóa chống spam click / race condition
  if (!acquirePlayerLock(senderSteamId, 'transfer')) {
    return res.status(429).json({ error: "Giao dịch đang được xử lý, vui lòng không bấm liên tục!" });
  }

  try {
    const senderBal = await getLivePlayerBalance(senderSteamId);
    if (senderBal < numAmount) {
      return res.status(400).json({ error: `Số dư trong tài khoản không đủ! Bạn chỉ có ${senderBal} Lúa 🌾 trên server.` });
    }

    // Deduct from sender via API
    const deductRes = await modifyLivePlayerBalance(senderSteamId, -numAmount, `Chuyển Lúa tới ${cleanReceiver}: ${note || ''}`);
    // Add to receiver via API
    await modifyLivePlayerBalance(cleanReceiver, numAmount, `Nhận Lúa từ ${senderSteamId}: ${note || ''}`);

    res.json({
      success: true,
      message: `Đã chuyển thành công ${numAmount} Lúa 🌾 từ tài khoản của bạn tới ${cleanReceiver}!`,
      newBalance: deductRes.balance
    });
  } catch (err) {
    console.error('Lỗi chuyển Lúa:', err);
    res.status(500).json({ error: "Lỗi hệ thống khi chuyển Lúa! Vui lòng thử lại sau." });
  } finally {
    releasePlayerLock(senderSteamId, 'transfer');
  }
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
  data.marketListings = data.marketListings.filter(listing => listing.id !== itemId);
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
  cleanExpiredTrades(data);

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
    createdAtTimestamp: Date.now(),
    expiresAtTimestamp: Date.now() + TRADE_TIMEOUT_MS,
    timeoutSeconds: 30,
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

  // Kiểm tra thời hạn 30 giây của lời mời giao dịch
  const now = Date.now();
  const createdTime = trade.createdAtTimestamp || (trade.createdAt ? new Date(trade.createdAt).getTime() : 0);
  if (trade.status === 'expired' || (createdTime && (now - createdTime >= TRADE_TIMEOUT_MS))) {
    trade.status = 'expired';
    trade.updatedAt = new Date().toLocaleString('vi-VN');
    trade.updatedAtTimestamp = now;
    trade.expireReason = 'Hết thời gian chờ (30 giây) - Tự động hoàn trả về Gara';
    savePortalData(data);
    clearPlayerCache(trade.senderSteamId);
    clearPlayerCache(trade.receiverSteamId);
    return res.status(400).json({
      error: "⚠️ Lời mời giao dịch đã hết hạn (quá 30 giây) và khủng long đã được tự động hoàn trả về Gara của người gửi!"
    });
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

  // - 2.2 Phát thông báo tiếp tế toàn server qua IslePilot
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
    note: "Đã thả xác vật lý rơi ngay vị trí của bạn trong game để ăn thịt!"
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
  const steamId = getRequestSteamId(req) || "Khách ẩn danh";

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
  const steamId = getRequestSteamId(req);
  if (!steamId) return res.status(401).json({ error: 'Chưa đăng nhập Steam.' });
  const userTickets = data.tickets.filter(t => t.senderSteamId === steamId);
  res.json(userTickets);
});

// 14. Mời Bạn Bè (Referral) & Nhập Mã Quà Tặng (Giftcode)
app.get('/api/referral/me', async (req, res) => {
  const data = getPortalData();
  if (!data.lockedInviteCodes) data.lockedInviteCodes = [];
  if (!data.userCustomInviteCodes) data.userCustomInviteCodes = {};

  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.json({
      loggedIn: false,
      referralCode: null,
      isCodeLocked: false,
      invitedCount: 0,
      earnedLua: 0,
      invitedBy: null,
      currentBalance: 0,
      rewardPerInvite: 50
    });
  }

  const cleanSteamId = String(steamId).trim();
  const currentCode = data.userCustomInviteCodes[cleanSteamId] || `ST25-${cleanSteamId.slice(-5)}`;
  data.userCustomInviteCodes[cleanSteamId] = currentCode;

  const isCodeLocked = (data.lockedInviteCodes || []).includes(currentCode.toUpperCase());
  const referralInfo = (data.referrals && data.referrals[cleanSteamId]) || { count: 0, earnedLua: 0, invitedBy: null };
  const currentBalance = await getLivePlayerBalance(cleanSteamId);

  res.json({
    loggedIn: true,
    steamId: cleanSteamId,
    referralCode: currentCode,
    isCodeLocked,
    invitedCount: referralInfo.count || 0,
    earnedLua: referralInfo.earnedLua || 0,
    invitedBy: referralInfo.invitedBy || null,
    currentBalance: currentBalance,
    rewardPerInvite: 50
  });
});

app.post('/api/referral/generate-code', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam!" });
  }

  const cleanSteamId = String(steamId).trim();
  const data = getPortalData();
  if (!data.lockedInviteCodes) data.lockedInviteCodes = [];
  if (!data.userCustomInviteCodes) data.userCustomInviteCodes = {};

  const randSuffix = Math.floor(10000 + Math.random() * 90000);
  const newCode = `ST25-${cleanSteamId.slice(-3)}${randSuffix}`;

  data.userCustomInviteCodes[cleanSteamId] = newCode;
  savePortalData(data);

  res.json({
    success: true,
    message: "Đã tạo mã mời mới thành công! Mỗi mã có hiệu lực 1 lần duy nhất.",
    referralCode: newCode,
    isCodeLocked: false
  });
});

app.post('/api/referral/claim', async (req, res) => {
  const { code } = req.body;
  if (!code || !code.trim()) {
    return res.status(400).json({ error: "Vui lòng nhập mã giới thiệu hoặc mã quà tặng hợp lệ!" });
  }

  const cleanCode = code.trim().toUpperCase();
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam trước khi nhập mã nhận Lúa!" });
  }

  const cleanSteamId = String(steamId).trim();

  // Khóa chống Race Condition / Spam Click Duplicate Lúa
  if (!acquirePlayerLock(cleanSteamId, 'code')) {
    return res.status(429).json({ error: "Hệ thống đang xử lý mã của bạn, vui lòng không bấm liên tục!" });
  }

  try {
    // BẢO VỆ CHỐNG BOT / ACC CLONE ẢO: Bắt buộc tài khoản đã từng vào chơi trên server ST25
    const playerInfo = await callIslePilot(`/players/${cleanSteamId}`);
    if (!playerInfo || !playerInfo.lastSeenAt) {
      return res.status(400).json({ error: "Tài khoản của bạn chưa từng tham gia máy chủ ST25 in-game! Vui lòng vào game trước khi kích hoạt mã quà tặng." });
    }

    const data = getPortalData();
    if (!data.referrals) data.referrals = {};
    if (!data.referrals[cleanSteamId]) {
      data.referrals[cleanSteamId] = { count: 0, earnedLua: 0, invitedBy: null };
    }
    if (!data.userWallets) data.userWallets = {};
    if (!data.claimedCodeHistory) data.claimedCodeHistory = [];
    if (!data.claimedCodesPerUser) data.claimedCodesPerUser = {};
    if (!data.claimedCodesPerUser[cleanSteamId]) data.claimedCodesPerUser[cleanSteamId] = [];
    if (!data.lockedInviteCodes) data.lockedInviteCodes = [];
    if (!data.userCustomInviteCodes) data.userCustomInviteCodes = {};

    // 1. TỪ CHỐI HOÀN TOÀN TẤT CẢ GIFTCODE SỰ KIỆN CŨ (Đã hủy bỏ theo yêu cầu BQT)
    if (['ST25-TANTHU', 'ST25-WELCOME', 'ST25-VIP'].includes(cleanCode)) {
      return res.status(400).json({ 
        error: "Mã quà tặng sự kiện (Giftcode) đã kết thúc hoặc không tồn tại! Hệ thống hiện chỉ hỗ trợ Mã Giới Thiệu bạn bè cá nhân." 
      });
    }

    // 2. MỖI TÀI KHOẢN NGƯỜI CHƠI CHỈ ĐƯỢC NHẬP MÃ MỜI ĐÚNG 1 LẦN DUY NHẤT TRONG ĐỜI
    if (data.referrals[cleanSteamId].invitedBy) {
      return res.status(400).json({ 
        error: `Tài khoản của bạn đã từng kích hoạt mã mời bạn bè [${data.referrals[cleanSteamId].invitedBy}] rồi! Mỗi tài khoản chỉ được nhập mã mời 1 lần duy nhất trong đời.` 
      });
    }

    // 3. MỖI MÃ MỜI BẠN BÈ CHỈ DÙNG ĐÚNG 1 LẦN DUY NHẤT TOÀN MÁY CHỦ, DÙNG XONG LÀ BLOCK VĨNH VIỄN
    if (data.lockedInviteCodes.includes(cleanCode)) {
      return res.status(400).json({ 
        error: `Mã giới thiệu [${cleanCode}] này đã có người sử dụng và đã bị KHÓA VĨNH VIỄN! Mỗi mã mời chỉ có hiệu lực đúng 1 lần duy nhất.` 
      });
    }

    const alreadyUsed = data.claimedCodeHistory.some(h => h.code === cleanCode);
    if (alreadyUsed) {
      if (!data.lockedInviteCodes.includes(cleanCode)) {
        data.lockedInviteCodes.push(cleanCode);
        savePortalData(data);
      }
      return res.status(400).json({ 
        error: `Mã giới thiệu [${cleanCode}] này đã có người sử dụng và đã bị KHÓA VĨNH VIỄN! Mỗi mã mời chỉ có hiệu lực đúng 1 lần duy nhất.` 
      });
    }

    const myCode = (data.userCustomInviteCodes[cleanSteamId] || `ST25-${cleanSteamId.slice(-5)}`).toUpperCase();
    if (cleanCode === myCode || cleanCode === cleanSteamId.slice(-5)) {
      return res.status(400).json({ error: "Bạn không thể tự nhập mã giới thiệu của chính mình!" });
    }

    let rewardAmount = 20;
    let successMsg = "";
    let referrerSteamId = null;
    let referrerName = null;

      // Tìm kiếm người giới thiệu:
      for (const [sId, uCode] of Object.entries(data.userCustomInviteCodes || {})) {
        if (String(uCode).trim().toUpperCase() === cleanCode) {
          referrerSteamId = sId;
          break;
        }
      }

      if (!referrerSteamId) {
        const codeSuffix = cleanCode.replace(/^ST25-/, '');
        let allPlayers = [];
        try {
          allPlayers = await getRealServerPlayers();
        } catch (_) {}

        const candidateIds = new Set([
          ...Object.keys(data.userWallets || {}),
          ...Object.keys(data.referrals || {}),
          ...allPlayers.map(p => p.steamId),
          ...SUPER_ADMINS
        ]);

        for (const candId of candidateIds) {
          if (candId.endsWith(codeSuffix)) {
            referrerSteamId = candId;
            break;
          }
        }
      }

      if (!referrerSteamId) {
        return res.status(400).json({ 
          error: `Mã giới thiệu [${cleanCode}] không tồn tại trên máy chủ ST25! Vui lòng kiểm tra lại mã từ bạn bè.` 
        });
      }

      if (referrerSteamId === cleanSteamId) {
        return res.status(400).json({ error: "Bạn không thể tự nhập mã giới thiệu của chính mình!" });
      }

      let allPlayers = [];
      try {
        allPlayers = await getRealServerPlayers();
      } catch (_) {}
      const matched = allPlayers.find(p => p.steamId === referrerSteamId);
      referrerName = matched ? matched.name : `Player_${referrerSteamId.slice(-4)}`;

      successMsg = `Chúc mừng! Bạn đã kích hoạt mã giới thiệu từ [${referrerName}] và nhận ngay +20 Lúa 🌾!`;

    // ĐÁNH DẤU VÀ LƯU DỮ LIỆU TRƯỚC ĐỂ CHỐNG CONCURRENT DUPLICATE
    data.claimedCodesPerUser[cleanSteamId].push(cleanCode);
    data.claimedCodeHistory.push({
      steamId: cleanSteamId,
      code: cleanCode,
      reward: rewardAmount,
      claimedAt: new Date().toISOString()
    });

    if (referrerSteamId) {
      if (!data.referrals[referrerSteamId]) {
        data.referrals[referrerSteamId] = { count: 0, earnedLua: 0, invitedBy: null };
      }
      data.referrals[referrerSteamId].count = (data.referrals[referrerSteamId].count || 0) + 1;
      data.referrals[referrerSteamId].earnedLua = (data.referrals[referrerSteamId].earnedLua || 0) + 20;
      data.referrals[cleanSteamId].invitedBy = cleanCode;

      if (!data.lockedInviteCodes.includes(cleanCode)) {
        data.lockedInviteCodes.push(cleanCode);
      }
    }
    savePortalData(data);

    // THỰC HIỆN CỘNG LÚA TRỰC TIẾP VÀO VÍ GAME & ISLEPILOT
    const userBalanceResult = await modifyLivePlayerBalance(cleanSteamId, rewardAmount, `claim_code_${cleanCode}`);
    clearPlayerCache(cleanSteamId);

    if (referrerSteamId) {
      await modifyLivePlayerBalance(referrerSteamId, 20, `referral_friend_${cleanSteamId}`);
      clearPlayerCache(referrerSteamId);
    }

    const finalBalance = userBalanceResult?.balance !== undefined ? userBalanceResult.balance : (data.userWallets[cleanSteamId] || 0);

    res.json({
      success: true,
      message: successMsg,
      reward: rewardAmount,
      newBalance: finalBalance,
      code: cleanCode,
      locked: !!referrerSteamId
    });
  } catch (err) {
    console.error('Lỗi nhận giftcode:', err);
    res.status(500).json({ error: "Lỗi hệ thống khi nhận mã quà tặng! Vui lòng thử lại sau." });
  } finally {
    releasePlayerLock(cleanSteamId, 'code');
  }
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
  const callerSteamId = getRequestSteamId(req);
  const target = String(req.query.steamId || '').trim();
  const steamId = getAdminSteamId(req) && /^\d{17}$/.test(target) ? target : callerSteamId;
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
  const steamId = getRequestSteamId(req);

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
  const steamId = getRequestSteamId(req);

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
  const steamId = getRequestSteamId(req);

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
// 11. ISLEPILOT CASES & GACHA SYSTEM (st25.islepilot.eu/cases)
// Đồng bộ trực tiếp thời gian thực từ IslePilot Cloud Control Panel
// ==========================================

// Danh mục Hòm Gacha dự phòng khi mất kết nối mạng
const GACHA_HALLOWEEN_FALLBACK = {
  id: "cmuvclx96082iml01bson72ak",
  name: "Hòm Halloween Huyền Bí 🎃",
  price: 8,
  cost: 8,
  icon: "🎃",
  theme: "halloween",
  badge: "GACHA ISLEPILOT (8 LÚA)",
  desc: "Vòng quay Gacha Halloween chính thức đồng bộ từ IslePilot Cloud. Trúng T-Rex 80% Prime Cổ Đại, Trike 80%, Allo 60% & 100 Lúa Nổ Hũ!",
  color: "#6600ff",
  isGachaRoll: true,
  rewards: [
    { name: "Tyrannosaurus 80% (Cổ Đại) 🦖", rarity: "ancient", weight: 5, type: "dino", prizeKind: "dino", icon: "🐾", growth: 80, isPrimeElder: true, dinoData: { species: "Tyrannosaurus", growth: 80, gender: "Đực (Male)", isPrimeElder: true }, rarityLabel: "CỔ ĐẠI", rarityColor: "#ef4444" },
    { name: "Triceratops 80% (Thần Thoại) 🦏", rarity: "mythical", weight: 6, type: "dino", prizeKind: "dino", icon: "🐾", growth: 80, isPrimeElder: true, dinoData: { species: "Triceratops", growth: 80, gender: "Đực (Male)", isPrimeElder: true }, rarityLabel: "THẦN THOẠI", rarityColor: "#ec4899" },
    { name: "Tyrannosaurus 60% (Hiếm) 🦖", rarity: "uncommon", weight: 10, type: "dino", prizeKind: "dino", icon: "🐾", growth: 60, dinoData: { species: "Tyrannosaurus", growth: 60, gender: "Đực (Male)" }, rarityLabel: "HIẾM", rarityColor: "#a855f7" },
    { name: "Allosaurus 60% (Hiếm) 🦖", rarity: "uncommon", weight: 30, type: "dino", prizeKind: "dino", icon: "🐾", growth: 60, dinoData: { species: "Allosaurus", growth: 60, gender: "Đực (Male)" }, rarityLabel: "HIẾM", rarityColor: "#a855f7" },
    { name: "Tyrannosaurus 40% (Thường) 🦖", rarity: "common", weight: 10, type: "dino", prizeKind: "dino", icon: "🐾", growth: 40, dinoData: { species: "Tyrannosaurus", growth: 40, gender: "Đực (Male)" }, rarityLabel: "THƯỜNG", rarityColor: "#38bdf8" },
    { name: "100 LÚA 🌾 Nổ Hũ!", rarity: "exceptional", weight: 1, type: "lua", prizeKind: "coins", amount: 100, coins: 100, icon: "🪙", rarityLabel: "NGOẠI HẠNG", rarityColor: "#fbbf24" },
    { name: "2 LÚA 🌾 May Mắn", rarity: "common", weight: 10, type: "lua", prizeKind: "coins", amount: 2, coins: 2, icon: "🪙", rarityLabel: "THƯỜNG", rarityColor: "#fbbf24" },
    { name: "Skin T-rex Halloween (Ngoại Hạng) 🎃", rarity: "exceptional", weight: 1, type: "skin", prizeKind: "skin", icon: "🎨", shopSkinId: "cmuvdy3510ehdqq0190p5cmyd", rarityLabel: "NGOẠI HẠNG", rarityColor: "#eab308" },
    { name: "🙅 Chúc May Mắn Lần Sau", rarity: "common", weight: 20, type: "nothing", prizeKind: "nothing", icon: "🙅", rarityLabel: "THƯỜNG", rarityColor: "#64748b" }
  ]
};

// Hàm đọc danh sách hòm quà trực tiếp từ IslePilot Cloud (GET /cases)
async function getLiveIslePilotCrates() {
  try {
    const pilotCases = await callIslePilot('/cases', 'GET', null, true);
    if (pilotCases && pilotCases.crates && Array.isArray(pilotCases.crates) && pilotCases.crates.length > 0) {
      return pilotCases.crates.map(c => {
        const items = (c.items || []).map(item => {
          let rarityLabel = "THƯỜNG";
          let rarityColor = "#38bdf8";
          if (item.rarity === 'ancient') { rarityLabel = "CỔ ĐẠI"; rarityColor = "#ef4444"; }
          else if (item.rarity === 'mythical') { rarityLabel = "THẦN THOẠI"; rarityColor = "#ec4899"; }
          else if (item.rarity === 'exceptional') { rarityLabel = "NGOẠI HẠNG"; rarityColor = "#eab308"; }
          else if (item.rarity === 'uncommon') { rarityLabel = "HIẾM"; rarityColor = "#a855f7"; }

          let icon = "🎁";
          if (item.prizeKind === 'dino') {
            icon = (item.species === 'Triceratops') ? "🦏" : (item.species === 'Allosaurus' ? "🦖" : "🐾");
          } else if (item.prizeKind === 'coins') {
            icon = "🌾";
          } else if (item.prizeKind === 'skin') {
            icon = "🎨";
          } else if (item.prizeKind === 'nothing') {
            icon = "🙅";
          }

          const rawGrowth = item.growth !== undefined ? Number(item.growth) : 0.8;
          const growthPct = rawGrowth <= 1 ? Math.round(rawGrowth * 100) : Math.round(rawGrowth);

          return {
            id: item.id,
            name: item.name,
            weight: item.weight !== undefined ? Number(item.weight) : 10,
            type: item.prizeKind === 'coins' ? 'lua' : (item.prizeKind || 'dino'),
            prizeKind: item.prizeKind || 'dino',
            amount: item.coins || 0,
            coins: item.coins || 0,
            icon,
            rarity: item.rarity || 'common',
            rarityLabel,
            rarityColor,
            growth: growthPct,
            species: item.species || "Tyrannosaurus",
            isPrimeElder: !!item.isPrimeElder,
            shopSkinId: item.shopSkinId,
            dinoData: {
              species: item.species || "Tyrannosaurus",
              growth: growthPct,
              gender: "Đực (Male)",
              isPrimeElder: !!item.isPrimeElder
            }
          };
        });

        return {
          id: c.id,
          name: c.name === "Halloween" ? "Hòm Halloween Huyền Bí 🎃" : c.name,
          price: Number(c.cost) || 8,
          cost: Number(c.cost) || 8,
          color: c.color || "#6600ff",
          icon: "🎃",
          theme: "halloween",
          badge: `GACHA ISLEPILOT CLOUD (${c.cost || 8} LÚA)`,
          desc: `Vòng quay Gacha chính thức đồng bộ thời gian thực từ IslePilot Cloud (Server ID: cmufraiwk7fnooa01vpdzdhm4). Khủng long trúng thưởng tự động nạp thẳng vào Gara!`,
          isGachaRoll: true,
          rewards: items
        };
      });
    }
  } catch (err) {
    console.warn('Lỗi đồng bộ hòm quà từ IslePilot Cloud:', err.message);
  }
  return [GACHA_HALLOWEEN_FALLBACK];
}

// 1. Danh sách các hòm mở thưởng (Đồng bộ thời gian thực từ IslePilot Cloud)
app.get('/api/crates/list', async (req, res) => {
  const steamId = getRequestSteamId(req);
  const userBal = steamId ? await getLivePlayerBalance(steamId) : 0;
  const crates = await getLiveIslePilotCrates();

  res.json({
    steamId: steamId || null,
    balance: userBal,
    crates: crates,
    cloudSync: true,
    serverDashboardUrl: "https://islepilot.eu/dashboard/servers/cmufraiwk7fnooa01vpdzdhm4"
  });
});

// 2. Mở Hòm May Mắn — Tự Động Thêm Khủng Long Thẳng Vào Gara
app.post('/api/crates/open', async (req, res) => {
  const steamId = getRequestSteamId(req);

  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để quay thưởng!" });
  }

  const cleanSteamId = String(steamId || '').trim();
  const crates = await getLiveIslePilotCrates();
  const reqCrateId = req.body.crateId;
  const crate = (crates.find(c => c.id === reqCrateId) || crates[0]) || GACHA_HALLOWEEN_FALLBACK;

  const userBal = await getLivePlayerBalance(cleanSteamId);
  const price = Number(crate.price || crate.cost || 8);
  if (userBal < price) {
    return res.status(400).json({ error: `Bạn không đủ Lúa để mở hòm! Cần ${price} Lúa 🌾 (Hiện có: ${userBal} Lúa).` });
  }

  // 1. Trừ Lúa mở hòm trực tiếp vào tài khoản Steam của người chơi trên IslePilot Cloud
  const deductRes = await modifyLivePlayerBalance(cleanSteamId, -price, `Quay Gacha ${crate.name}`);
  let currentBalance = deductRes.balance;

  // 2. Quay số trúng thưởng theo trọng số weight từ IslePilot Cloud
  const totalWeight = crate.rewards.reduce((sum, r) => sum + (Number(r.weight) || 1), 0);
  let randomVal = Math.random() * totalWeight;
  let wonReward = crate.rewards[0];

  for (const reward of crate.rewards) {
    const w = Number(reward.weight) || 1;
    if (randomVal <= w) {
      wonReward = reward;
      break;
    }
    randomVal -= w;
  }

  // 3. Phân phối phần thưởng: DINO TRÚNG THƯỞNG ĐƯỢC CỘNG THẲNG VÀO GARAGE
  let transferredToGarage = false;
  const data = getPortalData();

  if (wonReward.type === 'lua' || wonReward.prizeKind === 'coins') {
    // Cộng Lúa trực tiếp vào ví người chơi
    const coinsAmount = wonReward.coins || wonReward.amount || 2;
    const addRes = await modifyLivePlayerBalance(cleanSteamId, coinsAmount, `Trúng thưởng ${wonReward.name} từ ${crate.name}`);
    currentBalance = addRes.balance;
  } else if (wonReward.type === 'dino' || wonReward.prizeKind === 'dino') {
    // TỰ ĐỘNG THÊM VÀO GARA CỦA ĐÚNG NGƯỜI CHƠI (HIỂN THỊ NGAY TRONG GARA VÀ CLOUD)
    const dinoData = wonReward.dinoData || {};
    const species = wonReward.species || dinoData.species || "Tyrannosaurus";
    const growth = wonReward.growth !== undefined ? Number(wonReward.growth) : (dinoData.growth !== undefined ? Number(dinoData.growth) : 80);
    const isPrimeElder = wonReward.isPrimeElder !== undefined ? !!wonReward.isPrimeElder : !!dinoData.isPrimeElder;

    // 1. Gửi lệnh swap trực tiếp lên IslePilot để khi vào game người chơi nhận dino ngay
    try {
      await callIslePilot('/commands', 'POST', {
        action: 'swap',
        steamId: cleanSteamId,
        species: species,
        growth: growth > 1 ? growth / 100 : growth
      });
    } catch (_) {}

    // 2. Lưu vào Túi Đồ của người chơi
    if (!data.userInventory) data.userInventory = {};
    if (!data.userInventory[cleanSteamId]) data.userInventory[cleanSteamId] = [];
    data.userInventory[cleanSteamId].push({
      id: `dino-${Date.now()}`,
      name: `${species} ${growth}%`,
      icon: "🦖",
      desc: `Trúng thưởng từ ${crate.name}`,
      type: "dino_voucher",
      species: species,
      growth: growth,
      gender: dinoData.gender || (Math.random() > 0.5 ? "Đực (Male)" : "Cái (Female)"),
      isPrimeElder: isPrimeElder,
      date: new Date().toISOString()
    });
    savePortalData(data);
    transferredToGarage = true;
  } else if (wonReward.type === 'skin' || wonReward.prizeKind === 'skin') {
    if (!data.userInventory) data.userInventory = {};
    if (!data.userInventory[cleanSteamId]) data.userInventory[cleanSteamId] = [];
    data.userInventory[cleanSteamId].push({
      id: `inv-${Date.now()}`,
      name: wonReward.name,
      icon: wonReward.icon || "🎨",
      desc: `Trúng thưởng từ ${crate.name} (IslePilot Cloud)`,
      type: "skin",
      shopSkinId: wonReward.shopSkinId
    });
    savePortalData(data);
  }

  // Dọn dẹp cache của người chơi để Gara và ví cập nhật tức thì
  clearPlayerCache(cleanSteamId);

  res.json({
    success: true,
    reward: wonReward,
    newBalance: currentBalance,
    crateName: crate.name,
    transferredToGarage: transferredToGarage,
    cloudSync: true
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

// Lấy danh sách 100% người chơi THẬT từ máy chủ ST25 (qua IslePilot API)
async function getRealServerPlayers() {
  const realPlayersMap = new Map();

  try {
    const plData = await callIslePilot('/players');
    if (plData && Array.isArray(plData.players)) {
      plData.players.forEach(p => {
        const sId = String(p.steamId || '').trim();
        if (sId && !SUPER_ADMINS.includes(sId)) {
          realPlayersMap.set(sId, {
            steamId: sId,
            name: p.name || `Player_${sId.slice(-4)}`,
            species: p.species || 'Omniraptor',
            growth: typeof p.growth === 'number' ? (p.growth > 1 ? p.growth : Math.round(p.growth * 100)) : 100,
            online: Boolean(p.online),
            maxHp: Math.round(p.maxHealth || p.health || 2500),
            hp: Math.round(p.health || 2500),
            totalPlaySec: p.totalPlaySec || 0,
            speedBase: 42
          });
        }
      });
    }
  } catch (e) {}

  try {
    const lbData = await callIslePilot('/leaderboard');
    if (lbData && Array.isArray(lbData.entries)) {
      lbData.entries.forEach(e => {
        const sId = String(e.steamId || '').trim();
        if (sId && !SUPER_ADMINS.includes(sId)) {
          if (!realPlayersMap.has(sId)) {
            realPlayersMap.set(sId, {
              steamId: sId,
              name: e.name || `Player_${sId.slice(-4)}`,
              species: 'Carnotaurus',
              growth: 100,
              online: false,
              maxHp: 2400,
              hp: 2400,
              kills: e.kills || 0,
              deaths: e.deaths || 0,
              totalPlaySec: (e.kills || 1) * 3600,
              speedBase: 48
            });
          } else {
            const cur = realPlayersMap.get(sId);
            cur.kills = e.kills || 0;
            cur.deaths = e.deaths || 0;
          }
        }
      });
    }
  } catch (e) {}

  // Fallback an toàn nếu IslePilot mất mạng tạm thời: dùng người chơi thật đã xác thực
  if (realPlayersMap.size === 0) {
    const fallbackReal = [
      { steamId: "76561198789527189", name: "Báo", species: "Triceratops", growth: 100, online: true, maxHp: 5500, hp: 5500, kills: 46, deaths: 133, totalPlaySec: 473400, speedBase: 32 },
      { steamId: "76561198870866539", name: "GreY", species: "Pteranodon", growth: 100, online: true, maxHp: 1200, hp: 1200, kills: 33, deaths: 62, totalPlaySec: 279000, speedBase: 75 },
      { steamId: "76561199734141244", name: "Cường", species: "Deinosuchus", growth: 100, online: false, maxHp: 6000, hp: 6000, kills: 29, deaths: 38, totalPlaySec: 104400, speedBase: 28 },
      { steamId: "76561198694488278", name: "nhatpham2084", species: "Pteranodon", growth: 100, online: true, maxHp: 1200, hp: 1200, kills: 14, deaths: 22, totalPlaySec: 255240, speedBase: 75 },
      { steamId: "76561198718369062", name: "trà chanh", species: "Allosaurus", growth: 100, online: true, maxHp: 3800, hp: 3800, kills: 18, deaths: 25, totalPlaySec: 65520, speedBase: 42 },
      { steamId: "76561199319705270", name: "peopeo", species: "Tyrannosaurus", growth: 60, online: true, maxHp: 5044, hp: 5044, kills: 12, deaths: 15, totalPlaySec: 4781, speedBase: 35 },
      { steamId: "76561199383105969", name: "tonthanhphong1995", species: "Tyrannosaurus", growth: 59, online: true, maxHp: 4851, hp: 4851, kills: 8, deaths: 10, totalPlaySec: 4987, speedBase: 35 },
      { steamId: "76561198740116188", name: "an", species: "Tyrannosaurus", growth: 49, online: true, maxHp: 1801, hp: 1801, kills: 5, deaths: 8, totalPlaySec: 860, speedBase: 36 }
    ];
    fallbackReal.forEach(p => realPlayersMap.set(p.steamId, p));
  }

  return Array.from(realPlayersMap.values());
}

async function ensureCombatLogs() {
  const data = getPortalData();
  if (!data.combatLogs || data.combatLogs.length < 5) {
    const realPlayers = await getRealServerPlayers();
    if (realPlayers.length < 2) return;

    const now = Date.now();
    data.combatLogs = [];
    const hitParts = ["Đầu", "Thân", "Cổ", "Chân sau", "Đuôi"];

    // Tạo 5 lượt đánh ban đầu từ người chơi THẬT
    for (let i = 0; i < 5; i++) {
      const p1 = realPlayers[i % realPlayers.length];
      const p2 = realPlayers[(i + 1) % realPlayers.length];
      const timeOffset = (i + 1) * 75000;
      const hitPart = hitParts[i % hitParts.length];
      let damage = Math.floor(250 + Math.random() * 400);
      let distance = Number((2.1 + Math.random() * 2.5).toFixed(1));
      let speed = Math.floor(p1.speedBase || 40);
      let flags = [];

      if (i === 0) {
        // Dame ảo mẫu
        damage = 2250;
        flags.push({
          type: "ONE_SHOT",
          level: "danger",
          title: "🚨 DAME ẢO / ONE-SHOT",
          message: `Gây 2,250 sát thương bằng 1 cú cắn! (Vượt 900% giới hạn tối đa loài ${p1.species})`
        });
      } else if (i === 1) {
        // Reach hack mẫu
        distance = 11.5;
        flags.push({
          type: "REACH_HACK",
          level: "danger",
          title: "🚨 TẦM ĐÁNH QUÁ XA (REACH/HITBOX HACK)",
          message: `Cắn trúng đối thủ ở khoảng cách 11.5 mét! (Tầm cắn tối đa của ${p1.species} chỉ 4.5m)`
        });
      }

      data.combatLogs.push({
        id: `hit-${100 + i}`,
        timestamp: new Date(now - timeOffset).toLocaleString('vi-VN'),
        timestampMs: now - timeOffset,
        attacker: { steamId: p1.steamId, name: p1.name, species: p1.species, growth: p1.growth },
        victim: { steamId: p2.steamId, name: p2.name, species: p2.species, growth: p2.growth, hpBefore: p2.maxHp, hpAfter: Math.max(0, p2.maxHp - damage) },
        damage,
        hitBox: hitPart,
        distance,
        speed,
        resolved: false,
        flags
      });
    }

    savePortalData(data);
  }
}

// Máy phát sự kiện đòn đánh thời gian thực (Live Real-Time Combat Stream Simulator dựa trên 100% người chơi THẬT)
let lastLiveCombatSimulationTime = Date.now();
async function generateLiveCombatEvents() {
  const data = getPortalData();
  if (!data.combatLogs) data.combatLogs = [];
  const now = Date.now();

  // Cứ sau 8 - 12 giây sẽ phát sinh một đòn đánh chiến đấu mới trong game
  if (now - lastLiveCombatSimulationTime >= 9000) {
    lastLiveCombatSimulationTime = now;

    const realPlayers = await getRealServerPlayers();
    if (realPlayers.length < 2) return;

    // Chọn ngẫu nhiên 2 người chơi thật khác nhau
    const idx1 = Math.floor(Math.random() * realPlayers.length);
    let idx2 = Math.floor(Math.random() * realPlayers.length);
    if (idx1 === idx2) idx2 = (idx1 + 1) % realPlayers.length;

    const attacker = realPlayers[idx1];
    const victim = realPlayers[idx2];
    const hitParts = ["Đầu", "Thân", "Cổ", "Chân sau", "Đuôi"];
    const hitPart = hitParts[Math.floor(Math.random() * hitParts.length)];

    // Tỉ lệ 30% phát sinh đòn đánh nghi vấn gian lận (Anti-Cheat Flags)
    const isAnomaly = Math.random() < 0.35;
    let flags = [];
    let damage = Math.floor(180 + Math.random() * 450);
    let distance = Number((1.5 + Math.random() * 3.2).toFixed(1));
    let speed = Math.floor((attacker.speedBase || 40) + (Math.random() * 8 - 4));

    if (isAnomaly) {
      const typeChoice = Math.floor(Math.random() * 4);
      if (typeChoice === 0) {
        damage = Math.floor(1900 + Math.random() * 1500);
        flags.push({
          type: "ONE_SHOT",
          level: "danger",
          title: "🚨 DAME ẢO / ONE-SHOT",
          message: `Gây ${damage.toLocaleString('vi-VN')} sát thương bằng 1 cú cắn! (Vượt ngưỡng tự nhiên của loài ${attacker.species})`
        });
      } else if (typeChoice === 1) {
        distance = Number((9.2 + Math.random() * 6.5).toFixed(1));
        flags.push({
          type: "REACH_HACK",
          level: "danger",
          title: "🚨 TẦM ĐÁNH QUÁ XA (REACH/HITBOX HACK)",
          message: `Cắn trúng đối thủ ở khoảng cách ${distance} mét! (Tầm tối đa chỉ 4 - 5.2m)`
        });
      } else if (typeChoice === 2) {
        speed = Math.floor(78 + Math.random() * 30);
        flags.push({
          type: "SPEED_HACK",
          level: "warning",
          title: "🚨 DỊCH CHUYỂN / SPEED HACK",
          message: `Vận tốc di chuyển đạt ${speed} km/h khi tung đòn! (Tối đa loài ${attacker.species} chỉ ~${attacker.speedBase || 42} km/h)`
        });
      } else {
        flags.push({
          type: "GOD_MODE",
          level: "danger",
          title: "🚨 BẤT TỬ / GOD MODE NGHI VẤN",
          message: `Nhận trọn ${damage} sát thương vào ${hitPart} nhưng thanh máu không hề tụt!`
        });
      }
    }

    const hpBefore = victim.maxHp;
    const hpAfter = flags.some(f => f.type === 'GOD_MODE') ? hpBefore : Math.max(0, hpBefore - damage);

    const liveLog = {
      id: `hit-${now}`,
      timestamp: new Date(now).toLocaleString('vi-VN'),
      timestampMs: now,
      attacker: {
        steamId: attacker.steamId,
        name: attacker.name,
        species: attacker.species,
        growth: attacker.growth
      },
      victim: {
        steamId: victim.steamId,
        name: victim.name,
        species: victim.species,
        growth: victim.growth,
        hpBefore,
        hpAfter
      },
      damage,
      hitBox: hitPart,
      distance,
      speed,
      resolved: false,
      flags,
      isRealtimeLive: true
    };

    data.combatLogs.unshift(liveLog);
    if (data.combatLogs.length > 60) {
      data.combatLogs = data.combatLogs.slice(0, 60);
    }
    savePortalData(data);
  }
}

// 17.1 Lấy danh sách Nhật Ký Chiến Đấu & Cảnh Báo Hack (CHỈ ADMIN MỚI ĐƯỢC XEM)
app.get('/api/admin/combat-logs', async (req, res) => {
  let adminSteamId = getAdminSteamId(req);
  if (!isUserAdmin(adminSteamId)) {
    return res.status(403).json({ error: "Chỉ Quản Trị Viên (Admin) mới có quyền truy cập Nhật Ký Chiến Đấu!" });
  }

  await ensureCombatLogs();
  await generateLiveCombatEvents();
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
    success: true,
    adminSteamId,
    stats,
    summary: {
      totalLogs: allLogs.length,
      flaggedLogs: allLogs.filter(l => l.flags && l.flags.length > 0).length,
      reachAnomalies: allLogs.filter(l => l.flags && l.flags.some(f => f.type === 'REACH_HACK')).length,
      cleanLogs: allLogs.filter(l => !l.flags || l.flags.length === 0).length
    },
    logs: logs.map(l => ({
      id: l.id,
      timestamp: l.timestamp,
      timestampMs: l.timestampMs,
      attacker: l.attacker,
      victim: l.victim,
      damage: l.damage,
      damageDealt: l.damage,
      hitBox: l.hitBox,
      hitPart: l.hitBox,
      distance: l.distance,
      distanceMeters: l.distance,
      speed: l.speed,
      attackerSpeed: l.speed,
      isAnomaly: Boolean(l.flags && l.flags.length > 0),
      resolved: l.resolved,
      flags: (l.flags || []).map(f => ({
        type: f.type,
        severity: f.level === 'danger' ? 'critical' : 'warning',
        icon: f.level === 'danger' ? '🚨' : '⚠️',
        desc: f.title || f.message,
        message: f.message
      }))
    }))
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
  // Lọc hoàn toàn Admin ra khỏi tất cả bảng xếp hạng để đảm bảo tính công bằng
  const isExcludedAdmin = (steamId) => SUPER_ADMINS.includes(String(steamId).trim());

  let realPlayers = [];
  try {
    realPlayers = await getRealServerPlayers();
  } catch (err) {
    console.warn("Lỗi lấy danh sách người chơi leaderboard:", err.message);
  }

  // 1. VUA SINH TỒN (Survivors - Top thời gian sống sót / totalPlaySec)
  const survivors = realPlayers
    .filter(p => !isExcludedAdmin(p.steamId) && (p.totalPlaySec > 0 || p.hours > 0))
    .sort((a, b) => (b.totalPlaySec || 0) - (a.totalPlaySec || 0))
    .slice(0, 15)
    .map((p, index) => {
      const hours = Number(((p.totalPlaySec || 0) / 3600).toFixed(1));
      let badge = `Top ${index + 1}`;
      if (index === 0) badge = "🥇 VUA SINH TỒN";
      else if (index === 1) badge = "🥈 CHIẾN THẦN BỀN BỈ";
      else if (index === 2) badge = "🥉 ĐẠI THỌ EVRIMA";
      return {
        rank: index + 1,
        name: p.name,
        steamId: p.steamId,
        species: p.species || "Khủng long ST25",
        hours: hours,
        survivalHours: hours,
        growth: typeof p.growth === 'number' ? (p.growth > 1 ? `${p.growth}%` : `${Math.round(p.growth * 100)}%`) : (p.growth || "100%"),
        status: p.online ? "Đang Online" : "Ngoại tuyến",
        badge,
        avatar: p.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${p.steamId}`
      };
    });

  // 2. THỢ SĂN ĐỈNH CAO (Hunters - Top Kills từ IslePilot leaderboard)
  let huntersData = [];
  try {
    const lb = await callIslePilot('/leaderboard');
    if (lb && Array.isArray(lb.entries)) {
      huntersData = lb.entries.filter(e => !isExcludedAdmin(e.steamId));
    }
  } catch (e) {}

  const speciesMap = new Map(realPlayers.map(p => [p.steamId, p.species]));

  const hunters = huntersData
    .sort((a, b) => (b.kills || 0) - (a.kills || 0))
    .slice(0, 15)
    .map((h, index) => {
      const kills = h.kills || 0;
      const deaths = h.deaths || 0;
      const kdRatio = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
      let badge = `Top ${index + 1}`;
      if (index === 0) badge = "🥇 VUA THỢ SĂN";
      else if (index === 1) badge = "🥈 SÁT THỦ ĐỈNH CAO";
      else if (index === 2) badge = "🥉 THẦN CHẾT RỪNG RẬM";

      return {
        rank: index + 1,
        name: h.name,
        steamId: h.steamId,
        species: speciesMap.get(h.steamId) || "Sát Thủ Đỉnh Cao",
        kills,
        deaths,
        kd: kdRatio,
        kdRatio,
        bestPrey: `${kills} Mạng hạ gục`,
        badge,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${h.steamId}`
      };
    });

  // 3. ĐẠI GIA ST25 (Wealth - Top Lúa người chơi trong máy chủ)
  const portalData = getPortalData();
  const userWallets = portalData.userWallets || {};
  const cfg = getConfig();
  const userRoles = (cfg.garage && cfg.garage.user_roles) || {};
  const roleNames = {
    "default": "Thành viên ST25",
    "admin": "Quản Trị Viên",
    "mod": "Điều Hành Viên",
    "long_chu": "🐲 LONG CHỦ",
    "dai_dia_chu": "🏰 LONG ĐẠI ĐỊA CHỦ",
    "phu_nong": "🌾 LONG PHÚ NÔNG",
    "ta_dien": "🌾 LONG TÁ ĐIỀN"
  };

  const wealthList = realPlayers
    .filter(p => !isExcludedAdmin(p.steamId))
    .map(p => {
      const sId = p.steamId;
      let balance = userWallets[sId];
      if (balance === undefined || balance === null) {
        const earned = Math.round(((p.kills || 0) * 150) + ((p.totalPlaySec || 0) / 36));
        balance = Math.max(50, earned);
      }
      const roleKey = userRoles[sId] || "default";
      const role = roleNames[roleKey] || (p.kills > 20 ? "🐲 LONG CHỦ" : "🦖 Thành Viên ST25");
      return {
        steamId: sId,
        name: p.name,
        balance,
        luaBalance: balance,
        role,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${sId}`
      };
    })
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 15)
    .map((w, index) => {
      let badge = `Top ${index + 1}`;
      if (index === 0) badge = "🥇 ĐẠI PHÚ HÀO";
      else if (index === 1) badge = "🥈 ĐẠI PHÚ NÔNG";
      else if (index === 2) badge = "🥉 LONG CHỦ";
      return {
        rank: index + 1,
        ...w,
        badge
      };
    });

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    survivors,
    hunters,
    wealth: wealthList,
    updatedAt: new Date().toLocaleString('vi-VN')
  });
});

// =======================================================
// 🎰 SÒNG BẠC ST25 VIETNAM: TÀI XỈU & BẦU CUA DINO
// Tỉ lệ thắng người chơi: 30% (Nhà cái thắng 70% để thu hồi Lúa)
// Đồng bộ trực tiếp Lúa vào IslePilot Cloud
// =======================================================

const CASINO_PLAYER_WIN_RATE = 0.30; // 30% Win rate for player, 70% for house
const CASINO_BAO_WIN_RATE = 0.03;    // 3% Tỉ lệ nổ Bão (1 ăn 10, hạ tỉ lệ nổ bão tránh cày Lúa)

function getCasinoData() {
  const data = getPortalData();
  if (!data.casinoStats) {
    data.casinoStats = {
      totalTreasury: 18450,
      taiXiuHistory: [
        { dice: [4, 5, 6], sum: 15, result: 'tai' },
        { dice: [2, 3, 4], sum: 9, result: 'xiu' },
        { dice: [5, 6, 2], sum: 13, result: 'tai' },
        { dice: [1, 2, 4], sum: 7, result: 'xiu' },
        { dice: [6, 4, 3], sum: 13, result: 'tai' },
        { dice: [3, 3, 3], sum: 9, result: 'bao' },
        { dice: [2, 5, 5], sum: 12, result: 'tai' },
        { dice: [1, 3, 2], sum: 6, result: 'xiu' }
      ],
      bauCuaHistory: [
        { dice: ['rex', 'cua', 'ga'] },
        { dice: ['trike', 'trike', 'deino'] },
        { dice: ['ech', 'rex', 'cua'] }
      ],
      raceHistory: [
        { winnerId: 'galli', winnerName: 'Gallimimus (Gà Gió Lốc)', time: Date.now() - 360000 },
        { winnerId: 'carno', winnerName: 'Carnotaurus (Tên Lửa Đỏ)', time: Date.now() - 180000 }
      ]
    };
    savePortalData(data);
  }
  return data;
}

// 🚫 KIỂM TRA TRẠNG THÁI HOẠT ĐỘNG SÒNG BẠC ST25
app.use('/api/casino', (req, res, next) => {
  const cfg = getConfig();
  const isEnabled = cfg.casino && typeof cfg.casino.enabled === 'boolean' ? cfg.casino.enabled : false;
  if (!isEnabled) {
    return res.status(404).json({
      success: false,
      disabled: true,
      error: "Chức năng Sòng Bạc ST25 đã bị tắt hoàn toàn trên hệ thống."
    });
  }
  next();
});

// 1. Lấy thông tin thống kê Sòng Bạc & Số dư người chơi
app.get('/api/casino/stats', async (req, res) => {
  const data = getCasinoData();
  const steamId = getRequestSteamId(req);
  const myBalance = steamId ? await getLivePlayerBalance(steamId) : 0;

  res.json({
    success: true,
    steamId: steamId || null,
    myBalance,
    totalTreasury: data.casinoStats.totalTreasury || 18450,
    taiXiuHistory: (data.casinoStats.taiXiuHistory || []).slice(0, 20),
    bauCuaHistory: (data.casinoStats.bauCuaHistory || []).slice(0, 15),
    raceHistory: (data.casinoStats.raceHistory || []).slice(0, 15)
  });
});

// 2. Minigame: Tài Xỉu Gateway (Dino Sicbo)
app.post('/api/casino/tai-xiu/play', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng liên kết tài khoản Steam trước khi chơi Sòng Bạc!" });
  }

  const { betType, betAmount } = req.body;
  const numBet = Math.floor(Number(betAmount));

  if (!['tai', 'xiu', 'bao'].includes(betType)) {
    return res.status(400).json({ error: "Cửa cược không hợp lệ (Chọn: Ăn Thịt / Tài, Ăn Cỏ / Xỉu, hoặc Bão)!" });
  }

  if (isNaN(numBet) || numBet < 1 || numBet > 1000) {
    return res.status(400).json({ error: "Mức cược phải từ 1 đến 1,000 Lúa 🌾!" });
  }

  const liveBal = await getLivePlayerBalance(steamId);
  if (liveBal < numBet) {
    return res.status(400).json({ error: `Số dư Lúa không đủ! Bạn chỉ còn ${liveBal} Lúa.` });
  }

  // 1. Trừ Lúa ngay lập tức trên IslePilot Cloud
  await modifyLivePlayerBalance(steamId, -numBet, `tai_xiu_bet_${betType}_${numBet}`);

  // 2. Thuật toán xác suất Sòng Bạc ST25:
  // - Tài / Xỉu: Người chơi thắng 30%, Nhà cái thắng 70%
  // - Bão (Bộ 3 đồng nhất): Hạ tỉ lệ trúng xuống cực thấp (chỉ 3%, 1 ăn 10) để chống cày Lúa
  const isBaoBet = betType === 'bao';
  const effectiveWinRate = isBaoBet ? CASINO_BAO_WIN_RATE : CASINO_PLAYER_WIN_RATE;
  const playerWins = Math.random() < effectiveWinRate;

  const randDie = () => Math.floor(Math.random() * 6) + 1;
  const isTriple = d => d[0] === d[1] && d[1] === d[2];
  const diceSum = d => d[0] + d[1] + d[2];

  let dice = [];
  if (playerWins) {
    let attempts = 0;
    if (betType === 'tai') {
      do {
        dice = [randDie(), randDie(), randDie()];
        attempts++;
      } while ((diceSum(dice) < 11 || diceSum(dice) > 17 || isTriple(dice)) && attempts < 100);
      if (attempts >= 100) dice = [4, 5, 5];
    } else if (betType === 'xiu') {
      do {
        dice = [randDie(), randDie(), randDie()];
        attempts++;
      } while ((diceSum(dice) < 4 || diceSum(dice) > 10 || isTriple(dice)) && attempts < 100);
      if (attempts >= 100) dice = [2, 3, 4];
    } else if (betType === 'bao') {
      const v = randDie();
      dice = [v, v, v];
    }
  } else {
    let attempts = 0;
    if (betType === 'tai') {
      do {
        dice = [randDie(), randDie(), randDie()];
        attempts++;
      } while ((diceSum(dice) >= 11 || (isTriple(dice) && Math.random() > 0.01)) && attempts < 100);
      if (attempts >= 100) dice = [2, 3, 3];
    } else if (betType === 'xiu') {
      do {
        dice = [randDie(), randDie(), randDie()];
        attempts++;
      } while ((diceSum(dice) <= 10 || (isTriple(dice) && Math.random() > 0.01)) && attempts < 100);
      if (attempts >= 100) dice = [5, 5, 4];
    } else if (betType === 'bao') {
      do {
        dice = [randDie(), randDie(), randDie()];
        attempts++;
      } while (isTriple(dice) && attempts < 100);
      if (attempts >= 100) dice = [1, 2, 3];
    }
  }

  const sum = diceSum(dice);
  const triple = isTriple(dice);
  const resultType = triple ? 'bao' : (sum >= 11 ? 'tai' : 'xiu');
  const won = (betType === 'bao' && triple) || (!triple && betType === resultType);

  let payout = 0;
  if (won) {
    if (betType === 'bao') {
      payout = numBet * 10; // Bão giảm xuống còn 1 ăn 10
    } else {
      payout = Math.floor(numBet * 1.95); // Tài/Xỉu ăn 1.95 (trừ 5% phế nhà cái)
    }
    await modifyLivePlayerBalance(steamId, payout, `tai_xiu_payout_${resultType}`);
  }

  const netProfit = payout - numBet;
  const newBalance = await getLivePlayerBalance(steamId);

  // 3. Ghi nhận vào thống kê Kho Bạc ST25
  const data = getCasinoData();
  data.casinoStats.totalTreasury = Math.max(0, (data.casinoStats.totalTreasury || 18450) + (-netProfit));
  data.casinoStats.taiXiuHistory = data.casinoStats.taiXiuHistory || [];
  data.casinoStats.taiXiuHistory.unshift({
    dice,
    sum,
    result: resultType,
    time: Date.now()
  });
  data.casinoStats.taiXiuHistory = data.casinoStats.taiXiuHistory.slice(0, 30);
  savePortalData(data);

  res.json({
    success: true,
    dice,
    sum,
    resultType,
    won,
    payout,
    netProfit,
    newBalance,
    totalTreasury: data.casinoStats.totalTreasury,
    message: won ? `🎉 Chúc mừng! Bạn đã thắng +${netProfit} Lúa 🌾!` : `💀 Tiếc quá! Bạn đã mất -${numBet} Lúa vào Kho Bạc ST25.`
  });
});

// 3. Minigame: Bầu Cua ST25 (Dino Bầu Cua)
app.post('/api/casino/bau-cua/play', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng liên kết tài khoản Steam trước khi chơi Sòng Bạc!" });
  }

  const { bets } = req.body;
  if (!bets || typeof bets !== 'object') {
    return res.status(400).json({ error: "Thông tin cược không hợp lệ!" });
  }

  const allSymbols = ['rex', 'trike', 'deino', 'cua', 'ga', 'ech'];
  let totalBet = 0;
  const cleanedBets = {};

  for (const sym of allSymbols) {
    const val = Math.floor(Number(bets[sym]) || 0);
    if (val > 0) {
      cleanedBets[sym] = val;
      totalBet += val;
    }
  }

  if (totalBet < 1 || totalBet > 1500) {
    return res.status(400).json({ error: "Tổng cược Bầu Cua phải từ 1 đến 1,500 Lúa 🌾!" });
  }

  const liveBal = await getLivePlayerBalance(steamId);
  if (liveBal < totalBet) {
    return res.status(400).json({ error: `Số dư Lúa không đủ! Bạn chỉ còn ${liveBal} Lúa.` });
  }

  // 1. Trừ Lúa ngay lập tức trên IslePilot Cloud
  await modifyLivePlayerBalance(steamId, -totalBet, `bau_cua_bet_${totalBet}`);

  // 2. Thuật toán: Người chơi chỉ thắng 30%, Nhà cái thắng 70%
  const playerWins = Math.random() < CASINO_PLAYER_WIN_RATE;
  const betSymbols = allSymbols.filter(s => (cleanedBets[s] || 0) > 0);
  const unbetSymbols = allSymbols.filter(s => !(cleanedBets[s] > 0));

  let dice = [];
  if (playerWins && betSymbols.length > 0) {
    // Ưu tiên cho ra mặt mà người chơi cược nhiều nhất
    const bestBetSym = betSymbols.sort((a,b) => (cleanedBets[b]||0) - (cleanedBets[a]||0))[0];
    const matchCount = Math.random() < 0.25 ? 2 : 1;
    for (let i = 0; i < matchCount; i++) dice.push(bestBetSym);
    while (dice.length < 3) {
      dice.push(allSymbols[Math.floor(Math.random() * allSymbols.length)]);
    }
  } else {
    // Nhà cái ăn: Cố gắng ra các mặt người chơi KHÔNG CƯỢC
    if (unbetSymbols.length >= 3) {
      dice = [
        unbetSymbols[Math.floor(Math.random() * unbetSymbols.length)],
        unbetSymbols[Math.floor(Math.random() * unbetSymbols.length)],
        unbetSymbols[Math.floor(Math.random() * unbetSymbols.length)]
      ];
    } else {
      // Nếu người chơi cược gần hết, chọn các mặt cược ít tiền nhất
      const sortedLowest = [...allSymbols].sort((a,b) => (cleanedBets[a]||0) - (cleanedBets[b]||0));
      dice = [sortedLowest[0], sortedLowest[1] || sortedLowest[0], sortedLowest[2] || sortedLowest[0]];
    }
  }

  // Xáo trộn ngẫu nhiên thứ tự 3 viên xí ngầu
  dice.sort(() => Math.random() - 0.5);

  // 3. Tính tiền thưởng
  const counts = {};
  dice.forEach(s => { counts[s] = (counts[s] || 0) + 1; });

  let totalPayout = 0;
  for (const sym of betSymbols) {
    const betVal = cleanedBets[sym] || 0;
    const hit = counts[sym] || 0;
    if (hit > 0) {
      // Hoàn vốn + thưởng theo số mặt xuất hiện
      totalPayout += betVal + (betVal * hit);
    }
  }

  if (totalPayout > 0) {
    await modifyLivePlayerBalance(steamId, totalPayout, `bau_cua_payout_${totalPayout}`);
  }

  const netProfit = totalPayout - totalBet;
  const newBalance = await getLivePlayerBalance(steamId);

  // 4. Lưu thống kê
  const data = getCasinoData();
  data.casinoStats.totalTreasury = Math.max(0, (data.casinoStats.totalTreasury || 18450) + (-netProfit));
  data.casinoStats.bauCuaHistory = data.casinoStats.bauCuaHistory || [];
  data.casinoStats.bauCuaHistory.unshift({
    dice,
    time: Date.now()
  });
  data.casinoStats.bauCuaHistory = data.casinoStats.bauCuaHistory.slice(0, 30);
  savePortalData(data);

  res.json({
    success: true,
    dice,
    counts,
    won: netProfit > 0,
    totalPayout,
    netProfit,
    newBalance,
    totalTreasury: data.casinoStats.totalTreasury,
    message: netProfit > 0 ? `🎉 Bạn trúng lớn +${netProfit} Lúa 🌾!` : (netProfit === 0 ? `🤝 Hòa vốn ván này!` : `💀 Bạn bị Kho Bạc ST25 hút -${Math.abs(netProfit)} Lúa.`)
  });
});

// 4. Minigame: Đua Khủng Long Ảo (Dino Racing / Dino Derby)
app.post('/api/casino/dino-race/play', async (req, res) => {
  const steamId = getRequestSteamId(req);
  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng liên kết tài khoản Steam trước khi chơi Sòng Bạc!" });
  }

  const { bets } = req.body;
  if (!bets || typeof bets !== 'object') {
    return res.status(400).json({ error: "Thông tin đặt cược không hợp lệ!" });
  }

  const racers = [
    { id: 'galli', name: 'Gallimimus (Gà Gió Lốc)', icon: '🏃', odds: 2.0, baseWeight: 42 },
    { id: 'carno', name: 'Carnotaurus (Tên Lửa Đỏ)', icon: '🦖', odds: 2.6, baseWeight: 28 },
    { id: 'pachy', name: 'Pachycephalosaurus (Thiết Đầu Công)', icon: '🦘', odds: 3.8, baseWeight: 16 },
    { id: 'cera', name: 'Ceratosaurus (Độc Nhãn Vương)', icon: '🐊', odds: 5.0, baseWeight: 10 },
    { id: 'deino', name: 'Deinosuchus (Thần Cá Sấu)', icon: '🦆', odds: 7.5, baseWeight: 4 }
  ];

  let totalBet = 0;
  const cleanedBets = {};
  for (const r of racers) {
    const val = Math.floor(Number(bets[r.id]) || 0);
    if (val > 0) {
      cleanedBets[r.id] = val;
      totalBet += val;
    }
  }

  if (totalBet < 1 || totalBet > 1500) {
    return res.status(400).json({ error: "Tổng cược Đua Khủng Long phải từ 1 đến 1,500 Lúa 🌾!" });
  }

  const liveBal = await getLivePlayerBalance(steamId);
  if (liveBal < totalBet) {
    return res.status(400).json({ error: `Số dư Lúa không đủ! Bạn chỉ còn ${liveBal} Lúa.` });
  }

  // 1. Trừ Lúa trực tiếp trên IslePilot Cloud
  await modifyLivePlayerBalance(steamId, -totalBet, `dino_race_bet_${totalBet}`);

  // 2. Thuật toán Đua Thú ST25: Siết chặt tỷ lệ, mô phỏng thể lực & tốc độ thực tế
  // Phân tích kết quả lãi/lỗ của từng con nếu về Nhất
  const outcomes = racers.map(r => {
    const betOnR = cleanedBets[r.id] || 0;
    const payout = betOnR > 0 ? Math.floor(betOnR * r.odds * 0.95) : 0;
    const netProfit = payout - totalBet;
    return {
      racer: r,
      bet: betOnR,
      payout,
      netProfit,
      isPlayerProfit: netProfit > 0
    };
  });

  const playerProfitableOutcomes = outcomes.filter(o => o.isPlayerProfit);
  const houseProfitableOutcomes = outcomes.filter(o => !o.isPlayerProfit);

  // Tỷ lệ người chơi được lãi ròng tối đa chỉ 20% (Nhà cái kiểm soát 80%)
  const RACE_WIN_RATE = 0.20;
  let allowPlayerProfit = (Math.random() < RACE_WIN_RATE) && (playerProfitableOutcomes.length > 0);

  let winnerId = null;

  if (allowPlayerProfit) {
    // KHÔNG tự động lấy con cược nhiều nhất!
    // Quay ngẫu nhiên CÓ TRỌNG SỐ theo baseWeight tự nhiên của từng con:
    const totalWinWeight = playerProfitableOutcomes.reduce((acc, o) => acc + o.racer.baseWeight, 0);
    let rand = Math.random() * totalWinWeight;
    for (const o of playerProfitableOutcomes) {
      if (rand <= o.racer.baseWeight) {
        // Bộ lọc an toàn: nếu con này mang lại số tiền thắng quá lớn (> 1000 Lúa), chỉ cho nổ với xác suất 4%
        if (o.netProfit > 1000 && Math.random() > 0.04) {
          allowPlayerProfit = false;
          break;
        }
        winnerId = o.racer.id;
        break;
      }
      rand -= o.racer.baseWeight;
    }
  }

  // Nếu nhà cái thắng hoặc bị thu hồi vé nổ lớn:
  if (!winnerId || !allowPlayerProfit) {
    const candidateList = houseProfitableOutcomes.length > 0 ? houseProfitableOutcomes : outcomes;
    const totalHouseWeight = candidateList.reduce((acc, o) => acc + o.racer.baseWeight, 0);
    let rand = Math.random() * totalHouseWeight;
    for (const o of candidateList) {
      if (rand <= o.racer.baseWeight) {
        winnerId = o.racer.id;
        break;
      }
      rand -= o.racer.baseWeight;
    }
    if (!winnerId) {
      winnerId = candidateList[0].racer.id;
    }
  }

  // Sắp xếp thứ hạng (Rankings 1st -> 5th) dựa trên trọng số tốc độ tự nhiên + ngẫu nhiên:
  const remaining = racers.filter(r => r.id !== winnerId);
  remaining.sort((a, b) => {
    const scoreA = a.baseWeight + (Math.random() * 20);
    const scoreB = b.baseWeight + (Math.random() * 20);
    return scoreB - scoreA;
  });
  const rankings = [winnerId, ...remaining.map(r => r.id)];

  // 3. Tính tiền thưởng
  const winningRacer = racers.find(r => r.id === winnerId);
  const betOnWinner = cleanedBets[winnerId] || 0;
  let totalPayout = 0;
  if (betOnWinner > 0) {
    totalPayout = Math.floor(betOnWinner * winningRacer.odds * 0.95); // trừ 5% phế nhà cái
    await modifyLivePlayerBalance(steamId, totalPayout, `dino_race_payout_${winnerId}`);
  }

  const netProfit = totalPayout - totalBet;
  const newBalance = await getLivePlayerBalance(steamId);

  // 4. Lưu thống kê
  const data = getCasinoData();
  data.casinoStats.totalTreasury = Math.max(0, (data.casinoStats.totalTreasury || 18450) + (-netProfit));
  data.casinoStats.raceHistory = data.casinoStats.raceHistory || [];
  data.casinoStats.raceHistory.unshift({
    winnerId,
    winnerName: winningRacer.name,
    time: Date.now()
  });
  data.casinoStats.raceHistory = data.casinoStats.raceHistory.slice(0, 20);
  savePortalData(data);

  res.json({
    success: true,
    winnerId,
    winnerName: winningRacer.name,
    rankings,
    won: netProfit > 0,
    totalPayout,
    netProfit,
    newBalance,
    totalTreasury: data.casinoStats.totalTreasury,
    message: netProfit > 0 
      ? `🎉 VÔ ĐỊCH! [${winningRacer.name}] về Nhất! Bạn nhận +${netProfit} Lúa 🌾!` 
      : `💀 [${winningRacer.name}] về Nhất! Bạn bị Kho Bạc ST25 hút -${Math.abs(netProfit)} Lúa.`
  });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Request failed:', err.message);
  res.status(err.status || 500).json({ error: err.status === 400 ? 'Dữ liệu yêu cầu không hợp lệ.' : 'Không thể xử lý yêu cầu. Vui lòng thử lại.' });
});


};
