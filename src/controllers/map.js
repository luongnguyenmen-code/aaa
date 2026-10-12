const PilotAPI = require('../api/upstream-endpoints');
const ST25API = require('../api/endpoints');
// map feature HTTP handlers. Dependencies are supplied by the application.
module.exports = function register(app, context) {
  const {fs, path, Core, callIslePilot, posToLatLng, getRequestSteamId, normalizeStatPct} = context;


// 7. Live Map Coordinates (Member View - Only show this player, hide others)
app.get(ST25API.routes.playerMap, async (req, res) => {
  const reqSteamId = getRequestSteamId(req);
  const [onlineData, ownPlayer] = await Promise.all([
    callIslePilot(PilotAPI.paths.playersOnline),
    reqSteamId ? callIslePilot(PilotAPI.player(reqSteamId)) : null
  ]);
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
  let player = ownPlayer && !ownPlayer.error && !ownPlayer._status ? ownPlayer : null;
  let isOnline = false;

  const foundOnline = allOnline.find(p => p.steamId === reqSteamId);
  if (foundOnline) {
    player = foundOnline;
    isOnline = true;
  } else if (player) {
    isOnline = player.online !== false;
  }
  if (!player) return res.status(503).json({ error: 'Không thể cập nhật vị trí nhân vật.' });

  let activePlayer = player;

  let playerPosition = activePlayer ? activePlayer.position : null;
  let loc = posToLatLng(playerPosition);

  // Member View Policy: ONLY return the active player's own marker. All other players are completely hidden!
  const myMarker = activePlayer ? [{
    steamId: activePlayer.steamId,
    name: activePlayer.name,
    species: activePlayer.species || "Chưa chọn",
    growth: `${Math.round((activePlayer.growth || 0) * 100)}%`,
    health: normalizeStatPct(activePlayer.health, activePlayer.maxHealth),
    hunger: normalizeStatPct(activePlayer.hunger, activePlayer.maxHunger),
    thirst: normalizeStatPct(activePlayer.thirst, activePlayer.maxThirst),
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
    health: activePlayer ? normalizeStatPct(activePlayer.health, activePlayer.maxHealth) : 100,
    hunger: activePlayer ? normalizeStatPct(activePlayer.hunger, activePlayer.maxHunger) : 100,
    thirst: activePlayer ? normalizeStatPct(activePlayer.thirst, activePlayer.maxThirst) : 100,
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
app.get(ST25API.routes.mapZones, (req, res) => {
  const zonesPath = path.join(Core.root, 'assets', 'data', 'islepilot-zones.json');
  if (fs.existsSync(zonesPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(zonesPath, 'utf8'));
      return res.json(data);
    } catch (e) { }
  }
  res.json({ pois: [], categories: [] });
});
};
