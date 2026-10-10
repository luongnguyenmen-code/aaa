
    let currentSteamId = null;
    let currentBalance = 0;
    let selectedTaiXiuType = 'tai';
    let currentTaiXiuBet = 10;
    let isRolling = false;

    // Bầu cua state
    let bauCuaChip = 10;
    const bauCuaBets = { rex: 0, trike: 0, deino: 0, cua: 0, ga: 0, ech: 0 };
    const symbolMap = {
      rex: { icon: '🦖', label: 'T-REX' },
      trike: { icon: '🦣', label: 'TRIKE' },
      deino: { icon: '🐊', label: 'DEINO' },
      cua: { icon: '🦀', label: 'CUA' },
      ga: { icon: '🐔', label: 'GÀ' },
      ech: { icon: '🐸', label: 'ẾCH' }
    };

    // Đua Khủng Long state
    let raceChip = 10;
    const raceBets = { galli: 0, carno: 0, pachy: 0, cera: 0, deino: 0 };
    const raceInfo = {
      galli: { name: 'Gallimimus (Gà Gió Lốc)', icon: '🏃', odds: 2.0, color: '#fbbf24' },
      carno: { name: 'Carnotaurus (Tên Lửa Đỏ)', icon: '🦖', odds: 2.6, color: '#f87171' },
      pachy: { name: 'Pachycephalosaurus (Thiết Đầu)', icon: '🦘', odds: 3.8, color: '#60a5fa' },
      cera: { name: 'Ceratosaurus (Độc Nhãn)', icon: '🐊', odds: 5.0, color: '#34d399' },
      deino: { name: 'Deinosuchus (Thần Cá Sấu)', icon: '🦆', odds: 7.5, color: '#c084fc' }
    };
    let isRacing = false;

    document.addEventListener('DOMContentLoaded', async () => {
      // 1. Identify player
      try {
        const stored = localStorage.getItem('st25_steam_user');
        if (stored) {
          const u = JSON.parse(stored);
          if (u && u.steam_id) currentSteamId = u.steam_id;
        }
      } catch (_) {}

      const params = new URLSearchParams(window.location.search);
      if (params.get('steamId')) currentSteamId = params.get('steamId');

      await refreshCasinoStats();
    });

    async function refreshCasinoStats() {
      try {
        let url = ST25API.routes.casinoStats;
        if (currentSteamId) url += `?steamId=${encodeURIComponent(currentSteamId)}`;
        const res = await App.readResponse(url);
        if (res.status === 404) { window.location.replace('index.html'); return; }
        if (res.ok) {
          const data = await res.json();
          currentBalance = data.myBalance || 0;
          document.getElementById('user-lua-balance').textContent = `${currentBalance.toLocaleString()} 🌾`;
          document.getElementById('server-treasury-amount').textContent = `${(data.totalTreasury || 18450).toLocaleString()} 🌾`;

          if (currentSteamId) {
            document.getElementById('user-steam-id').textContent = `SteamID: ${currentSteamId}`;
            // Load persona name if stored
            try {
              const u = JSON.parse(localStorage.getItem('st25_steam_user') || '{}');
              if (u.persona_name) document.getElementById('user-name').textContent = u.persona_name;
              else document.getElementById('user-name').textContent = `Chiến binh ${currentSteamId.slice(-4)}`;
              if (u.avatar) document.getElementById('user-avatar').src = u.avatar;
            } catch (_) {}
          } else {
            document.getElementById('user-name').textContent = 'Chưa đăng nhập Steam';
            document.getElementById('user-steam-id').innerHTML = '<a href="lien-ket-steam.html" style="color: #fbbf24;">Bấm để liên kết Steam</a>';
          }

          renderTaiXiuHistory(data.taiXiuHistory || []);
          renderRaceHistory(data.raceHistory || []);
        }
      } catch (err) {
        console.error('Failed to load casino stats:', err);
      }
    }

    function switchGame(game) {
      const target = document.getElementById('game-' + game + '-sec');
      if (!target || target.style.display !== 'none') return;
      const tabs = document.querySelectorAll('.casino-tab-btn');
      tabs.forEach(t => t.classList.remove('active'));
      document.getElementById('game-taixiu-sec').style.display = 'none';
      document.getElementById('game-baucua-sec').style.display = 'none';
      document.getElementById('game-race-sec').style.display = 'none';

      if (game === 'taixiu') {
        tabs[0].classList.add('active');
        document.getElementById('game-taixiu-sec').style.display = 'block';
      } else if (game === 'baucua') {
        tabs[1].classList.add('active');
        document.getElementById('game-baucua-sec').style.display = 'block';
      } else if (game === 'race') {
        tabs[2].classList.add('active');
        document.getElementById('game-race-sec').style.display = 'block';
      }
      window.ST25Motion?.enter(target);
    }

    // ==========================================
    // TÀI XỈU FUNCTIONS
    // ==========================================
    function selectTaiXiuBet(type) {
      if (isRolling) return;
      selectedTaiXiuType = type;
      document.getElementById('bet-opt-tai').classList.remove('selected');
      document.getElementById('bet-opt-xiu').classList.remove('selected');
      document.getElementById('bet-opt-bao').classList.remove('selected');
      document.getElementById(`bet-opt-${type}`).classList.add('selected');
    }

    function setBetAmount(amt) {
      if (isRolling) return;
      currentTaiXiuBet = amt;
      document.getElementById('taixiu-bet-input').value = amt;
      const chips = document.querySelectorAll('#game-taixiu-sec .chip-btn');
      chips.forEach(c => {
        if (Number(c.textContent.trim()) === amt) c.classList.add('active');
        else c.classList.remove('active');
      });
    }

    function renderTaiXiuHistory(list) {
      const beadsWrap = document.getElementById('taixiu-history-beads');
      if (!list || list.length === 0) {
        beadsWrap.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">Chưa có ván cược nào.</span>';
        return;
      }
      let taiCount = 0;
      let xiuCount = 0;
      beadsWrap.innerHTML = list.slice(0, 15).map(item => {
        if (item.result === 'tai') taiCount++;
        else if (item.result === 'xiu') xiuCount++;
        const letter = item.result === 'tai' ? 'T' : (item.result === 'xiu' ? 'X' : 'B');
        return `<div class="bead ${item.result}" title="${item.dice.join('-')} = ${item.sum} (${item.result.toUpperCase()})">${letter}</div>`;
      }).join('');

      document.getElementById('taixiu-ratio-stat').textContent = `Tài: ${taiCount} | Xỉu: ${xiuCount}`;
    }

    function getAuthHeaders() {
      const headers = { 'Content-Type': 'application/json' };
      if (currentSteamId) headers['x-steam-id'] = currentSteamId;
      return headers;
    }

    async function playTaiXiu() {
      if (isRolling) return;
      if (!currentSteamId) {
        App.showToast('Vui lòng liên kết tài khoản Steam trước khi chơi!', 'warning');
        return;
      }

      const betVal = Math.floor(Number(document.getElementById('taixiu-bet-input').value));
      if (isNaN(betVal) || betVal < 1) {
        App.showToast('Mức cược tối thiểu là 1 Lúa!', 'error');
        return;
      }
      if (betVal > currentBalance) {
        App.showToast(`Bạn chỉ còn ${currentBalance} Lúa, không đủ cược!`, 'error');
        return;
      }

      isRolling = true;
      const rollBtn = document.getElementById('btn-roll-taixiu');
      rollBtn.disabled = true;
      rollBtn.innerHTML = '⏳ ĐANG LẮC BÁT...';

      const plate = document.getElementById('taixiu-plate');
      const d1 = document.getElementById('t-dice-1');
      const d2 = document.getElementById('t-dice-2');
      const d3 = document.getElementById('t-dice-3');
      const sumDisplay = document.getElementById('taixiu-sum-display');
      const announce = document.getElementById('taixiu-announcement');
      announce.style.display = 'none';

      plate.classList.add('shaking');
      d1.classList.add('rolling');
      d2.classList.add('rolling');
      d3.classList.add('rolling');
      sumDisplay.textContent = '🎲 Đang xóc đĩa... Chờ mở bát!';

      // Sound synthesis
      playShakeSound();

      try {
        const res = await fetch(ST25API.routes.casinoTaiXiuPlay, {
          method: 'POST',
          headers: getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({
            betType: selectedTaiXiuType,
            betAmount: betVal
          })
        });
        const result = await res.json();

        // Delay 1.2s for suspense effect
        await new Promise(r => setTimeout(r, 1200));

        plate.classList.remove('shaking');
        d1.classList.remove('rolling');
        d2.classList.remove('rolling');
        d3.classList.remove('rolling');

        if (res.ok && result.success) {
          // Render dice values
          d1.textContent = result.dice[0];
          d2.textContent = result.dice[1];
          d3.textContent = result.dice[2];

          d1.className = `dice-cube ${result.dice[0] % 2 === 0 ? 'red' : ''}`;
          d2.className = `dice-cube ${result.dice[1] % 2 === 0 ? 'red' : ''}`;
          d3.className = `dice-cube ${result.dice[2] % 2 === 0 ? 'red' : ''}`;

          const typeName = result.resultType === 'tai' ? '🥩 TÀI (ĂN THỊT)' : (result.resultType === 'xiu' ? '🥗 XỈU (ĂN CỎ)' : '⚡ BÃO DINO');
          sumDisplay.innerHTML = `Tổng: <strong>${result.sum} Điểm</strong> — [${typeName}]`;

          currentBalance = result.newBalance;
          document.getElementById('user-lua-balance').textContent = `${currentBalance.toLocaleString()} 🌾`;
          document.getElementById('server-treasury-amount').textContent = `${result.totalTreasury.toLocaleString()} 🌾`;

          announce.style.display = 'block';
          if (result.won) {
            playWinSound();
            announce.className = 'result-announcement win';
            announce.innerHTML = `🎉 THẮNG LỚN! Bạn nhận ngay <strong>+${result.netProfit} Lúa 🌾</strong> vào ví!`;
            App.showToast(`+${result.netProfit} Lúa 🌾`, 'success');
          } else {
            announce.className = 'result-announcement lose';
            announce.innerHTML = `💀 THUA RỒI! Mất <strong>-${betVal} Lúa 🌾</strong> vào Kho Bạc ST25.`;
            App.showToast(`-${betVal} Lúa`, 'error');
          }

          await refreshCasinoStats();
        } else {
          plate.classList.remove('shaking');
          sumDisplay.textContent = 'Lỗi kết nối máy chủ.';
          App.showToast(result.error || 'Có lỗi xảy ra khi đặt cược!', 'error');
        }
      } catch (err) {
        console.error(err);
        plate.classList.remove('shaking');
        App.showToast('Lỗi mạng khi quay!', 'error');
      } finally {
        isRolling = false;
        rollBtn.disabled = false;
        rollBtn.innerHTML = '🎲 LẮC BÁT & ĐẶT CƯỢC NGAY 🚀';
      }
    }

    // ==========================================
    // BẦU CUA FUNCTIONS
    // ==========================================
    function setBauCuaChip(amt) {
      bauCuaChip = amt;
      const chips = document.querySelectorAll('#game-baucua-sec .chip-btn');
      chips.forEach(c => {
        if (Number(c.textContent.replace('+', '').trim()) === amt) c.classList.add('active');
        else c.classList.remove('active');
      });
    }

    function addBauCuaBet(sym) {
      if (isRolling) return;
      const totalCurrent = Object.values(bauCuaBets).reduce((a,b) => a+b, 0);
      if (totalCurrent + bauCuaChip > currentBalance) {
        App.showToast('Số dư Lúa không đủ để cược thêm!', 'warning');
        return;
      }
      bauCuaBets[sym] = (bauCuaBets[sym] || 0) + bauCuaChip;
      updateBauCuaUI();
    }

    function clearBauCuaBets() {
      if (isRolling) return;
      for (const k in bauCuaBets) bauCuaBets[k] = 0;
      updateBauCuaUI();
    }

    function updateBauCuaUI() {
      let total = 0;
      for (const k in bauCuaBets) {
        const val = bauCuaBets[k];
        total += val;
        const el = document.getElementById(`bc-bet-${k}`);
        if (el) el.textContent = val;
        const parent = el ? el.closest('.baucua-cell') : null;
        if (parent) {
          if (val > 0) parent.classList.add('active-bet');
          else parent.classList.remove('active-bet');
        }
      }
      document.getElementById('bc-total-bet-display').textContent = total.toLocaleString();
    }

    async function playBauCua() {
      if (isRolling) return;
      if (!currentSteamId) {
        App.showToast('Vui lòng liên kết tài khoản Steam trước khi chơi!', 'warning');
        return;
      }

      const totalBet = Object.values(bauCuaBets).reduce((a,b) => a+b, 0);
      if (totalBet <= 0) {
        App.showToast('Vui lòng click vào ít nhất 1 linh vật để đặt cược!', 'warning');
        return;
      }
      if (totalBet > currentBalance) {
        App.showToast('Số dư Lúa không đủ!', 'error');
        return;
      }

      isRolling = true;
      const rollBtn = document.getElementById('btn-roll-baucua');
      rollBtn.disabled = true;
      rollBtn.innerHTML = '⏳ ĐANG XÓC ĐĨA BẦU CUA...';

      const plate = document.getElementById('baucua-plate');
      const d1 = document.getElementById('bc-dice-1');
      const d2 = document.getElementById('bc-dice-2');
      const d3 = document.getElementById('bc-dice-3');
      const resultDisplay = document.getElementById('baucua-result-display');
      const announce = document.getElementById('baucua-announcement');
      announce.style.display = 'none';

      plate.classList.add('shaking');
      resultDisplay.textContent = '🦀 Đang xóc... Hồi hộp chờ kết quả!';
      playShakeSound();

      try {
        const res = await fetch(ST25API.routes.casinoBauCuaPlay, {
          method: 'POST',
          headers: getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({ bets: bauCuaBets })
        });
        const result = await res.json();

        await new Promise(r => setTimeout(r, 1200));
        plate.classList.remove('shaking');

        if (res.ok && result.success) {
          // Render dice
          const s1 = symbolMap[result.dice[0]];
          const s2 = symbolMap[result.dice[1]];
          const s3 = symbolMap[result.dice[2]];

          d1.innerHTML = `<span class="icon">${s1.icon}</span><span class="label">${s1.label}</span>`;
          d2.innerHTML = `<span class="icon">${s2.icon}</span><span class="label">${s2.label}</span>`;
          d3.innerHTML = `<span class="icon">${s3.icon}</span><span class="label">${s3.label}</span>`;

          resultDisplay.innerHTML = `Kết quả: [${s1.icon} ${s1.label}] - [${s2.icon} ${s2.label}] - [${s3.icon} ${s3.label}]`;

          currentBalance = result.newBalance;
          document.getElementById('user-lua-balance').textContent = `${currentBalance.toLocaleString()} 🌾`;
          document.getElementById('server-treasury-amount').textContent = `${result.totalTreasury.toLocaleString()} 🌾`;

          announce.style.display = 'block';
          if (result.won) {
            playWinSound();
            announce.className = 'result-announcement win';
            announce.innerHTML = `🎉 THẮNG LỚN! Trúng <strong>+${result.netProfit} Lúa 🌾</strong> (Tổng nhận ${result.totalPayout} Lúa)!`;
            App.showToast(`+${result.netProfit} Lúa 🌾`, 'success');
          } else if (result.netProfit === 0) {
            announce.className = 'result-announcement win';
            announce.innerHTML = `🤝 HÒA VỐN! Bạn nhận lại đủ vốn ván này.`;
          } else {
            announce.className = 'result-announcement lose';
            announce.innerHTML = `💀 THUA! Bị Kho Bạc ST25 hút <strong>-${Math.abs(result.netProfit)} Lúa 🌾</strong>.`;
            App.showToast(`-${Math.abs(result.netProfit)} Lúa`, 'error');
          }

          clearBauCuaBets();
          await refreshCasinoStats();
        } else {
          plate.classList.remove('shaking');
          App.showToast(result.error || 'Có lỗi khi xóc Bầu Cua!', 'error');
        }
      } catch (err) {
        console.error(err);
        plate.classList.remove('shaking');
        App.showToast('Lỗi mạng khi xóc Bầu Cua!', 'error');
      } finally {
        isRolling = false;
        rollBtn.disabled = false;
        rollBtn.innerHTML = '🦀 XÓC BẦU CUA & MỞ BÁT 🚀';
      }
    }

    // Audio effects using Web Audio API (No external sound files required)
    function playShakeSound() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        for (let i = 0; i < 6; i++) {
          setTimeout(() => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(140 + Math.random() * 80, ctx.currentTime);
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.08);
          }, i * 150);
        }
      } catch (_) {}
    }

    function playWinSound() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [261.63, 329.63, 392.00, 523.25];
        notes.forEach((freq, idx) => {
          setTimeout(() => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
          }, idx * 100);
        });
      } catch (_) {}
    }

    // ==========================================
    // ĐUA KHỦNG LONG FUNCTIONS
    // ==========================================
    function setRaceChip(amt) {
      raceChip = amt;
      const chips = document.querySelectorAll('#game-race-sec .chip-btn');
      chips.forEach(c => {
        if (Number(c.textContent.replace('+', '').trim()) === amt) c.classList.add('active');
        else c.classList.remove('active');
      });
    }

    function addRaceBet(racerId) {
      if (isRacing) return;
      const totalCurrent = Object.values(raceBets).reduce((a, b) => a + b, 0);
      if (totalCurrent + raceChip > currentBalance) {
        App.showToast('Số dư Lúa không đủ để cược thêm!', 'warning');
        return;
      }
      raceBets[racerId] = (raceBets[racerId] || 0) + raceChip;
      updateRaceUI();
    }

    function clearRaceBets() {
      if (isRacing) return;
      for (const k in raceBets) raceBets[k] = 0;
      updateRaceUI();
    }

    function updateRaceUI() {
      let total = 0;
      for (const k in raceBets) {
        const val = raceBets[k];
        total += val;
        const valEl = document.getElementById(`race-bet-val-${k}`);
        if (valEl) valEl.textContent = val;
        const card = document.getElementById(`card-bet-${k}`);
        if (card) {
          if (val > 0) card.classList.add('active-bet');
          else card.classList.remove('active-bet');
        }
      }
      document.getElementById('race-total-bet-display').textContent = total.toLocaleString();
    }

    function renderRaceHistory(list) {
      const ribbon = document.getElementById('race-history-ribbon');
      if (!list || list.length === 0) {
        ribbon.innerHTML = '<span style="color: var(--text-muted); font-size: 0.8rem;">Chưa có trận đua nào gần đây.</span>';
        return;
      }
      ribbon.innerHTML = list.slice(0, 8).map(item => {
        const info = raceInfo[item.winnerId] || { icon: '🦖', name: item.winnerName };
        return `<span style="background: rgba(255,255,255,0.06); padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; color: #fbbf24; border: 1px solid rgba(245,158,11,0.2);">${info.icon} ${item.winnerName.split(' ')[0]}</span>`;
      }).join('');
      if (list[0]) {
        document.getElementById('race-recent-winner-tag').textContent = `Mới nhất: ${list[0].winnerName}`;
      }
    }

    async function startDinoRace() {
      if (isRacing) return;
      if (!currentSteamId) {
        App.showToast('Vui lòng liên kết tài khoản Steam trước khi chơi!', 'warning');
        return;
      }

      const totalBet = Object.values(raceBets).reduce((a, b) => a + b, 0);
      if (totalBet <= 0) {
        App.showToast('Vui lòng đặt cược vào ít nhất 1 chiến mã khủng long!', 'warning');
        return;
      }
      if (totalBet > currentBalance) {
        App.showToast('Số dư Lúa không đủ!', 'error');
        return;
      }

      isRacing = true;
      const startBtn = document.getElementById('btn-start-race');
      startBtn.disabled = true;
      startBtn.innerHTML = '🔥 ĐANG TRANH TÀI QUYẾT LIỆT...';

      const announcer = document.getElementById('race-live-narrator');
      const announce = document.getElementById('race-announcement');
      announce.style.display = 'none';

      const racerIds = ['galli', 'carno', 'pachy', 'cera', 'deino'];
      const runners = {};
      racerIds.forEach(id => {
        const el = document.getElementById(`runner-${id}`);
        el.style.left = '0%';
        el.classList.remove('winner-boost');
        el.classList.add('running');
        runners[id] = el;
      });

      announcer.innerHTML = '🚨 <strong>CÁC CHIẾN MÃ VÀO VẠCH XUẤT PHÁT!</strong> 3... 2... 1... XUẤT PHÁT! 🚀';
      playRaceStartSound();

      try {
        // Gửi lệnh đặt cược lên server
        const res = await fetch(ST25API.routes.casinoDinoRacePlay, {
          method: 'POST',
          headers: getAuthHeaders(),
          credentials: 'include',
          body: JSON.stringify({ bets: raceBets })
        });
        const result = await res.json();

        if (!res.ok || !result.success) {
          racerIds.forEach(id => runners[id].classList.remove('running'));
          App.showToast(result.error || 'Lỗi khi xuất phát cuộc đua!', 'error');
          isRacing = false;
          startBtn.disabled = false;
          startBtn.innerHTML = '🏁 XUẤT PHÁT ĐUA NGAY 🚀';
          return;
        }

        // Bắt đầu simulation chạy đua 6 giây cực kỳ chân thực & kịch tính
        const winnerId = result.winnerId;
        const rankings = result.rankings || [winnerId, ...racerIds.filter(x => x !== winnerId)];

        const commentaryStages = [
          { time: 1000, text: '🏃 Gallimimus bứt tốc ban đầu cực nhanh! Các chiến mã lao đi như vũ bão!' },
          { time: 2200, text: '🦖 Carnotaurus và Ceratosaurus đang sải bước cuồng phong áp sát!' },
          { time: 3500, text: '🦘 Pachycephalosaurus và Deinosuchus rướn lên! Trận đấu vô cùng căng thẳng!' },
          { time: 4800, text: `⚡ KHÚC CUA QUYẾT ĐỊNH! ${raceInfo[winnerId]?.name || 'Chiến mã'} BẮT ĐẦU BỨT PHÁ DẪN ĐẦU! 🔥` }
        ];

        commentaryStages.forEach(st => {
          setTimeout(() => {
            if (isRacing) announcer.innerHTML = `📢 ${st.text}`;
          }, st.time);
        });

        // Loop animation cập nhật vị trí các chiến mã trong 6 giây
        const startTime = Date.now();
        const raceDuration = 6000; // 6 seconds

        const interval = setInterval(() => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(1, elapsed / raceDuration);

          if (progress < 0.75) {
            // Giai đoạn 0 -> 4.5s: Giằng co ngẫu nhiên giữa 5 con
            racerIds.forEach(id => {
              const baseDist = progress * 65; // tiến dần đến 65%
              const jitter = (Math.random() - 0.45) * 12;
              const pos = Math.max(0, Math.min(70, baseDist + jitter));
              runners[id].style.left = `${pos}%`;
            });
          } else {
            // Giai đoạn nước rút 4.5s -> 6s: Con chiến thắng bứt phá về đích
            const sprintProgress = (progress - 0.75) / 0.25; // 0 -> 1
            runners[winnerId].style.left = `${70 + sprintProgress * 23}%`; // chạm vạch đích ~93%

            // Các con còn lại về sau theo thứ tự rankings
            rankings.forEach((id, rankIdx) => {
              if (id === winnerId) return;
              const maxTarget = 88 - (rankIdx * 6); // lùi dần phía sau
              runners[id].style.left = `${65 + sprintProgress * (maxTarget - 65)}%`;
            });
          }

          if (progress >= 1) {
            clearInterval(interval);
            finishRace(result);
          }
        }, 120);

      } catch (err) {
        console.error(err);
        racerIds.forEach(id => runners[id].classList.remove('running'));
        App.showToast('Lỗi mạng khi tham gia cuộc đua!', 'error');
        isRacing = false;
        startBtn.disabled = false;
        startBtn.innerHTML = '🏁 XUẤT PHÁT ĐUA NGAY 🚀';
      }
    }

    function finishRace(result) {
      const racerIds = ['galli', 'carno', 'pachy', 'cera', 'deino'];
      racerIds.forEach(id => {
        const el = document.getElementById(`runner-${id}`);
        el.classList.remove('running');
      });

      const winnerEl = document.getElementById(`runner-${result.winnerId}`);
      if (winnerEl) winnerEl.classList.add('winner-boost');

      const announcer = document.getElementById('race-live-narrator');
      announcer.innerHTML = `🏆 <strong>VỀ ĐÍCH!</strong> [${result.winnerName}] đã xuất sắc giành NGÔI VƯƠNG Derby ST25! 🎉`;

      currentBalance = result.newBalance;
      document.getElementById('user-lua-balance').textContent = `${currentBalance.toLocaleString()} 🌾`;
      document.getElementById('server-treasury-amount').textContent = `${result.totalTreasury.toLocaleString()} 🌾`;

      const announce = document.getElementById('race-announcement');
      announce.style.display = 'block';

      if (result.won) {
        playWinSound();
        announce.className = 'result-announcement win';
        announce.innerHTML = `🎉 VÔ ĐỊCH! ${result.winnerName} về Nhất! Bạn nhận ngay <strong>+${result.netProfit} Lúa 🌾</strong> (Tổng nhận ${result.totalPayout} Lúa)!`;
        App.showToast(`+${result.netProfit} Lúa 🌾`, 'success');
      } else {
        announce.className = 'result-announcement lose';
        announce.innerHTML = `💀 THUA RỒI! ${result.winnerName} về Nhất. Mất <strong>-${Math.abs(result.netProfit)} Lúa 🌾</strong> vào Kho Bạc ST25.`;
        App.showToast(`-${Math.abs(result.netProfit)} Lúa`, 'error');
      }

      clearRaceBets();
      refreshCasinoStats();

      isRacing = false;
      const startBtn = document.getElementById('btn-start-race');
      startBtn.disabled = false;
      startBtn.innerHTML = '🏁 XUẤT PHÁT ĐUA NGAY 🚀';
    }

    function playRaceStartSound() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.35);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } catch (_) {}
    }
  
