const ST25API = require('../api/endpoints');
// casino feature HTTP handlers. Dependencies are supplied by the application.
module.exports = function register(app, context) {
  const {getConfig, savePortalData, getRequestSteamId, getLivePlayerBalance, modifyLivePlayerBalance, CASINO_PLAYER_WIN_RATE, CASINO_BAO_WIN_RATE, getCasinoData} = context;


// 🚫 KIỂM TRA TRẠNG THÁI HOẠT ĐỘNG SÒNG BẠC ST25
app.use(ST25API.routes.casino, (req, res, next) => {
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
app.get(ST25API.routes.casinoStats, async (req, res) => {
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
app.post(ST25API.routes.casinoTaiXiuPlay, async (req, res) => {
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
app.post(ST25API.routes.casinoBauCuaPlay, async (req, res) => {
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
app.post(ST25API.routes.casinoDinoRacePlay, async (req, res) => {
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
};
