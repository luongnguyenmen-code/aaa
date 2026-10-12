const PilotAPI = require('../api/upstream-endpoints');
const ST25API = require('../api/endpoints');
// crates feature HTTP handlers. Dependencies are supplied by the application.
module.exports = function register(app, context) {
  const {getPortalData, savePortalData, callIslePilot, clearPlayerCache, getRequestSteamId, getLivePlayerBalance, modifyLivePlayerBalance, addDinoToGarage, getLiveIslePilotCrates} = context;


// 1. Danh sách các hòm mở thưởng (Đồng bộ thời gian thực từ IslePilot Cloud)
app.get(ST25API.routes.cratesList, async (req, res) => {
  const steamId = getRequestSteamId(req);
  const [userBal, crates] = await Promise.all([
    steamId ? getLivePlayerBalance(steamId) : 0, getLiveIslePilotCrates()
  ]);

  res.json({
    steamId: steamId || null,
    balance: userBal,
    crates: crates,
    cloudSync: true,
    serverDashboardUrl: "https://islepilot.eu/dashboard/servers/cmufraiwk7fnooa01vpdzdhm4"
  });
});


// 2. Mở Hòm May Mắn — Tự Động Thêm Khủng Long Thẳng Vào Gara
app.post(ST25API.routes.cratesOpen, async (req, res) => {
  const steamId = getRequestSteamId(req);

  if (!steamId) {
    return res.status(401).json({ error: "Vui lòng đăng nhập Steam để quay thưởng!" });
  }

  const cleanSteamId = String(steamId || '').trim();
  const crates = await getLiveIslePilotCrates();
  const reqCrateId = req.body.crateId;
  const crate = crates.find(c => c.id === reqCrateId);
  if (!crate) return res.status(400).json({ error: 'Hòm quà không tồn tại.' });

  const userBal = await getLivePlayerBalance(cleanSteamId);
  const price = Number(crate.price ?? crate.cost ?? 8);
  const rewards = (crate.rewards || []).filter(reward => Number.isFinite(Number(reward.weight ?? 1)) && Number(reward.weight ?? 1) > 0);
  if (!Number.isSafeInteger(price) || price < 0 || !rewards.length) return res.status(503).json({ error: 'Danh mục hòm quà chưa hợp lệ. Chưa trừ Lúa.' });
  if (userBal < price) {
    return res.status(400).json({ error: `Bạn không đủ Lúa để mở hòm! Cần ${price} Lúa 🌾 (Hiện có: ${userBal} Lúa).` });
  }

  // 2. Quay số trúng thưởng theo trọng số weight từ IslePilot Cloud
  const totalWeight = rewards.reduce((sum, r) => sum + Number(r.weight ?? 1), 0);
  if (!Number.isFinite(totalWeight)) return res.status(503).json({ error: 'Trọng số hòm quà không hợp lệ.' });
  let randomVal = Math.random() * totalWeight;
  let wonReward = rewards[0];

  for (const reward of rewards) {
    const w = Number(reward.weight ?? 1);
    if (randomVal < w) {
      wonReward = reward;
      break;
    }
    randomVal -= w;
  }
  await require('../services/mutation-journal').annotate({ crateId: crate.id, reward: wonReward });
  const deductRes = await modifyLivePlayerBalance(cleanSteamId, -price, `Quay Gacha ${crate.name}`);
  let currentBalance = deductRes.balance;

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

    addDinoToGarage(cleanSteamId, {
      species, growth: growth <= 1 ? growth * 100 : growth,
      gender: dinoData.gender || (Math.random() > 0.5 ? "Đực (Male)" : "Cái (Female)"),
      isPrimeElder, source: `Trúng thưởng từ ${crate.name}`
    }, data);
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
};
