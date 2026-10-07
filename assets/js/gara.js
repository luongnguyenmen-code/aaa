// ST25 Garage System — Synchronized 100% with IslePilot Cloud API (st25.islepilot.eu/garage)
const Garage = {
  activeDino: null,
  slots: [],
  playerInfo: null,
  cooldownSeconds: 0,
  cooldownTimer: null,

  async init() {
    this.checkCooldown();
    await this.fetchGarageData();
    this.render();
  },

  async refresh() {
    App.showToast('Đang đồng bộ dữ liệu với IslePilot Cloud...', 'info');
    await this.fetchGarageData();
    this.render();
    App.showToast('Đã đồng bộ dữ liệu Gara thành công!', 'success');
  },

  checkCooldown() {
    const expireTime = localStorage.getItem('the_isle_garage_cooldown');
    if (expireTime) {
      const remaining = Math.floor((parseInt(expireTime) - Date.now()) / 1000);
      if (remaining > 0) {
        this.cooldownSeconds = remaining;
        this.startCooldownTimer();
      } else {
        localStorage.removeItem('the_isle_garage_cooldown');
      }
    }
  },

  startCooldownTimer() {
    if (this.cooldownTimer) clearInterval(this.cooldownTimer);
    this.updateCooldownUI();

    this.cooldownTimer = setInterval(async () => {
      this.cooldownSeconds--;
      if (this.cooldownSeconds <= 0) {
        clearInterval(this.cooldownTimer);
        this.cooldownTimer = null;
        localStorage.removeItem('the_isle_garage_cooldown');
        App.showToast('Thời gian chuẩn bị hoàn tất! Dữ liệu đã sẵn sàng.', 'success');
        await this.fetchGarageData();
        this.render();
      }
      this.updateCooldownUI();
    }, 1000);
  },

  updateCooldownUI() {
    const alertBox = document.getElementById('cooldown-alert');
    const timerText = document.getElementById('cooldown-timer-text');
    if (!alertBox || !timerText) return;

    if (this.cooldownSeconds > 0) {
      alertBox.style.display = 'flex';
      const m = Math.floor(this.cooldownSeconds / 60);
      const s = this.cooldownSeconds % 60;
      timerText.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    } else {
      alertBox.style.display = 'none';
    }
  },

  getActiveSteamId() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const qId = urlParams.get('steamId');
      if (qId && /^\d{17}$/.test(qId.trim())) return qId.trim();

      const stored = localStorage.getItem('st25_steam_user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u && u.steam_id && /^\d{17}$/.test(u.steam_id.trim())) {
          return u.steam_id.trim();
        }
      }
    } catch (_) {}
    return null;
  },

  async quickLoginManual() {
    const inp = document.getElementById('manual-login-steamid');
    const sid = inp ? inp.value.trim() : '';
    if (!sid || !/^\d{17}$/.test(sid)) {
      App.showToast('Vui lòng nhập đúng 17 chữ số Steam ID 64 của bạn!', 'error');
      return;
    }

    App.showToast('Đang kết nối tài khoản Steam...', 'info');
    try {
      const res = await fetch('/api/player/login-manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamId: sid })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem('st25_steam_user', JSON.stringify({
          steam_id: data.steamId,
          persona_name: data.personaName,
          avatar: data.avatar,
          isAdmin: data.isAdmin
        }));
        App.showToast(`Chào mừng ${data.personaName}! Đã liên kết thành công.`, 'success');
        window.location.href = 'gara.html';
      } else {
        App.showToast(data.error || 'Không thể liên kết Steam ID này!', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('Lỗi kết nối máy chủ!', 'error');
    }
  },

  switchPlayer(targetSteamId) {
    if (!targetSteamId || !targetSteamId.trim()) {
      App.showToast('Vui lòng nhập Steam ID của người chơi cần xem!', 'error');
      return;
    }
    const cleanId = targetSteamId.trim();
    window.location.search = `?steamId=${encodeURIComponent(cleanId)}`;
  },

  resetToAdminSelf() {
    window.location.search = '';
  },

  openAssignForCurrent() {
    const curId = (this.playerInfo && this.playerInfo.steamId) || this.getActiveSteamId();
    if (curId) {
      window.location.href = `cai-dat.html?targetSteamId=${encodeURIComponent(curId)}`;
    }
  },

  async fetchGarageData() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const qId = urlParams.get('steamId');
      const sid = (qId && /^\d{17}$/.test(qId.trim())) ? qId.trim() : null;

      const storedUser = (() => {
        try {
          const s = localStorage.getItem('st25_steam_user');
          return s ? JSON.parse(s) : null;
        } catch (_) { return null; }
      })();

      const effectiveSid = sid || (storedUser && storedUser.steam_id && /^\d{17}$/.test(String(storedUser.steam_id).trim()) ? String(storedUser.steam_id).trim() : null);

      const hdrs = {};
      if (effectiveSid) {
        hdrs['x-steam-id'] = effectiveSid;
      }
      if (storedUser && storedUser.isAdmin && storedUser.steam_id) {
        hdrs['x-admin-steam-id'] = storedUser.steam_id;
      }

      const url = effectiveSid ? `/api/player/garage?steamId=${encodeURIComponent(effectiveSid)}` : '/api/player/garage';
      const res = await fetch(url, { headers: hdrs });
      if (res.ok) {
        const data = await res.json();
        
        // NẾU CHƯA ĐĂNG NHẬP (Chưa liên kết tài khoản Steam)
        if (!data.isLoggedIn || !data.steamId) {
          this.playerInfo = {
            steamId: null,
            personaName: 'Chưa đăng nhập Steam',
            totalParked: 0,
            maxSlots: data.maxSlots || 3,
            roleKey: 'default',
            roleName: 'Chưa liên kết',
            roleLimit: data.maxSlots || 3,
            isAdmin: false,
            isSuperAdmin: false,
            isViewingOther: false
          };
          this.activeDino = null;
          this.slots = [
            { slot: 1, empty: true },
            { slot: 2, empty: true },
            { slot: 3, empty: true }
          ];

          // Hiển thị khung mời đăng nhập và LUÔN GIỮ HIỂN THỊ GARA
          const loginPanel = document.getElementById('login-required-panel');
          const garagePanel = document.getElementById('garage-authenticated-content');
          if (loginPanel) loginPanel.style.display = 'block';
          if (garagePanel) garagePanel.style.display = 'block';

          // Để trắng ô nhập Steam ID nếu chưa có
          const manualInp = document.getElementById('manual-login-steamid');
          if (manualInp && !manualInp.value) manualInp.value = '';

          // Ẩn tất cả công cụ và liên kết Admin
          this.setAdminVisibility(false);
          this.updateHeaderUI();
          this.render();
          return;
        }

        // NẾU ĐÃ ĐĂNG NHẬP HỢP LỆ
        const loginPanel = document.getElementById('login-required-panel');
        const garagePanel = document.getElementById('garage-authenticated-content');
        if (loginPanel) loginPanel.style.display = 'none';
        if (garagePanel) garagePanel.style.display = 'block';

        this.activeDino = data.active;
        this.slots = data.slots || [];
        this.playerInfo = {
          steamId: data.steamId,
          personaName: data.personaName,
          totalParked: data.totalParked || 0,
          maxSlots: data.maxSlots || 3,
          roleKey: data.roleKey || 'default',
          roleName: data.roleName || '🦖 Thành Viên ST25',
          roleLimit: data.roleLimit || data.maxSlots || 3,
          isAdmin: !!data.isAdmin,
          isSuperAdmin: !!data.isSuperAdmin,
          isViewingOther: !!data.isViewingOther
        };

        // Lưu thông tin người dùng hiện tại vào localStorage
        if (!data.isViewingOther) {
          localStorage.setItem('st25_steam_user', JSON.stringify({
            steam_id: data.steamId,
            persona_name: data.personaName,
            isAdmin: !!data.isAdmin
          }));
        }

        // Điền Steam ID vào ô soi nhanh nếu là Admin
        const quickInp = document.getElementById('admin-quick-steamid');
        if (quickInp && data.steamId) {
          quickInp.value = data.steamId;
        }

        // Cập nhật ẩn/hiện công cụ Admin theo đúng thẩm quyền
        this.setAdminVisibility(!!data.isAdmin);

        this.updateHeaderUI();
        this.render();
        return;
      }
    } catch (e) {
      console.error('Lỗi nạp dữ liệu garage:', e);
      App.showToast('Không thể kết nối máy chủ để lấy dữ liệu Gara!', 'error');
    }
  },

  setAdminVisibility(isAdmin) {
    const adminLinkBtn = document.getElementById('btn-admin-panel-link');
    const adminBar = document.getElementById('admin-quick-bar');
    const navAdminItem = document.getElementById('nav-admin-link-item');
    const headerAdminBtn = document.getElementById('btn-header-admin');

    if (adminLinkBtn) adminLinkBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    if (adminBar) adminBar.style.display = isAdmin ? 'flex' : 'none';
    if (navAdminItem) navAdminItem.style.display = isAdmin ? 'inline-block' : 'none';
    if (headerAdminBtn) headerAdminBtn.style.display = isAdmin ? 'inline-flex' : 'none';
  },

  updateHeaderUI() {
    const nameEl = document.getElementById('garage-player-name');
    const steamEl = document.getElementById('garage-player-steamid');
    const countEl = document.getElementById('garage-count-badge');
    const roleBadge = document.getElementById('garage-role-badge');
    const noticeEl = document.getElementById('garage-capacity-notice');
    const summaryBadge = document.getElementById('slots-capacity-summary');

    if (!this.playerInfo || !this.playerInfo.steamId) {
      if (nameEl) nameEl.textContent = 'Chưa đăng nhập Steam';
      if (steamEl) steamEl.textContent = 'Steam ID: (Để trống)';
      if (countEl) countEl.textContent = 'Đang lưu: 0 / 3 Khủng Long';
      if (roleBadge) roleBadge.textContent = 'Chưa liên kết';
      if (noticeEl) {
        noticeEl.innerHTML = `Vui lòng đăng nhập hoặc nhập Steam ID 64 để đồng bộ khủng long riêng biệt của bạn trên ST25 Gara Cloud.`;
      }
      if (summaryBadge) {
        summaryBadge.textContent = '0 / 3 Slots';
      }
      return;
    }

    if (nameEl) nameEl.textContent = `Tài khoản: ${this.playerInfo.personaName}`;
    if (steamEl) steamEl.textContent = `Steam ID: ${this.playerInfo.steamId || 'Chưa đăng nhập'}`;
    if (countEl) countEl.textContent = `Đang lưu: ${this.playerInfo.totalParked} / ${this.playerInfo.maxSlots} Khủng Long`;
    if (roleBadge) roleBadge.textContent = `${this.playerInfo.roleName} (${this.playerInfo.maxSlots} Slots)`;
    if (noticeEl) {
      noticeEl.innerHTML = `Bạn đang có vai trò: <strong style="color: #fbbf24;">${this.playerInfo.roleName}</strong> — Giới hạn lưu trữ tối đa: <strong style="color: #38bdf8;">${this.playerInfo.maxSlots} slots</strong>. Dữ liệu được đồng bộ trực tiếp với IslePilot Cloud.`;
    }
    if (summaryBadge) {
      summaryBadge.textContent = `${this.playerInfo.totalParked} / ${this.playerInfo.maxSlots} Slots Đã Dùng`;
    }
  },

  render() {
    this.renderActiveDino();
    this.renderSlots();
    this.updateCooldownUI();
  },

  renderActiveDino() {
    const panel = document.getElementById('active-dino-content');
    if (!panel) return;

    if (!this.playerInfo || !this.playerInfo.steamId) {
      panel.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          <span style="font-size: 2.5rem; display: block; margin-bottom: 12px;">🦖</span>
          <h3 style="color: #fff; margin-bottom: 6px;">Chưa Đăng Nhập Tài Khoản Steam</h3>
          <p style="color: #94a3b8; max-width: 520px; margin: 0 auto 16px; line-height: 1.6;">
            Hãy đăng nhập bằng Steam chính chủ hoặc nhập nhanh Steam ID 64 ở ô phía trên để hiển thị khủng long đang sống in-game của bạn!
          </p>
          <a href="/api/player/steam/login?redirect=/gara.html" class="btn btn-primary btn-sm" style="font-weight: 700; background: linear-gradient(135deg, #10b981, #059669); border: none;">
            🎮 Đăng Nhập Steam Ngay
          </a>
        </div>
      `;
      return;
    }

    if (!this.activeDino) {
      panel.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          <span style="font-size: 2.5rem; display: block; margin-bottom: 12px;">🦖</span>
          <h3 style="color: #fff; margin-bottom: 6px;">Bạn hiện không có khủng long nào đang chơi trong game</h3>
          <p style="color: #94a3b8; max-width: 500px; margin: 0 auto;">
            Hãy vào game spawn khủng long mới hoặc chọn một con từ Gara bên dưới bấm <strong>"Đưa Ra Đảo (Restore 30s)"</strong> để hồi phục vào server!
          </p>
        </div>
      `;
      return;
    }

    const d = this.activeDino;
    panel.innerHTML = `
      <div style="background: rgba(0,0,0,0.3); border-radius: 12px; padding: 20px; text-align: center; border: 1px solid rgba(255,255,255,0.06);">
        <span style="font-size: 3rem; display: block; margin-bottom: 8px;">🦖</span>
        <h3 style="color: #fff; margin-bottom: 6px; font-size: 1.4rem;">${d.species}</h3>
        <span class="rule-badge badge-allow">${d.gender}</span>
        ${d.isPrimeElder ? '<span class="rule-badge badge-gold" style="margin-left: 6px;">👑 PRIME ELDER</span>' : ''}
        <p style="font-size: 0.95rem; color: var(--text-muted); margin-top: 14px;">
          Tăng trưởng: <b style="color: #10b981; font-size: 1.2rem;">${d.growth}%</b>
        </p>
        <button onclick="Garage.parkActiveDino()" class="btn btn-secondary btn-sm" style="margin-top: 16px; width: 100%; font-weight: 700; border-color: #10b981; color: #10b981;">
          📥 Cất Vào Gara (Park)
        </button>
      </div>

      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h4 style="color: #fff; margin: 0;">Chỉ số sinh tồn in-game</h4>
          <span style="font-size: 0.85rem; color: #fbbf24; font-weight: 600;">Dinh dưỡng: ${d.diet ? d.diet.join(' • ') : 'Đầy đủ'}</span>
        </div>

        <div class="stat-bars">
          <div class="stat-item">
            <div class="stat-label-wrap"><span>Máu (Health)</span><b>${d.health}%</b></div>
            <div class="stat-bar-track"><div class="stat-bar-fill fill-health" style="width: ${d.health}%"></div></div>
          </div>
          <div class="stat-item">
            <div class="stat-label-wrap"><span>Đói (Hunger)</span><b>${d.hunger}%</b></div>
            <div class="stat-bar-track"><div class="stat-bar-fill fill-hunger" style="width: ${d.hunger}%"></div></div>
          </div>
          <div class="stat-item">
            <div class="stat-label-wrap"><span>Khát (Thirst)</span><b>${d.thirst}%</b></div>
            <div class="stat-bar-track"><div class="stat-bar-fill fill-thirst" style="width: ${d.thirst}%"></div></div>
          </div>
          <div class="stat-item">
            <div class="stat-label-wrap"><span>Thể Lực (Stamina)</span><b>${d.stamina}%</b></div>
            <div class="stat-bar-track"><div class="stat-bar-fill fill-stamina" style="width: ${d.stamina}%"></div></div>
          </div>
        </div>

        <div style="margin-top: 18px; font-size: 0.8rem; color: #94a3b8; line-height: 1.6;">
          ⚠️ <strong>Lưu ý luật server:</strong> Cấm combat log (không cất khi đang bị săn đuổi). Khi cất vào Gara, con khủng long sẽ được lưu giữ an toàn tuyệt đối trên Cloud IslePilot.
        </div>
      </div>
    `;
  },

  renderSlots() {
    const grid = document.getElementById('garage-slots-grid');
    if (!grid) return;

    if (!this.playerInfo || !this.playerInfo.steamId) {
      grid.innerHTML = [1, 2, 3].map(slotNum => `
        <div class="slot-card empty-slot">
          <span class="slot-badge-num">Ô #${slotNum}</span>
          <div style="font-size: 2rem; margin-bottom: 8px; opacity: 0.4;">📦</div>
          <h4 style="color: #64748b; margin-bottom: 4px; font-size: 1.05rem;">Ô Trống #${slotNum}</h4>
          <p style="font-size: 0.8rem; margin: 0; color: #475569;">Đăng nhập Steam để nạp khủng long trong Gara Cloud</p>
        </div>
      `).join('');
      return;
    }

    if (this.slots.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          Gara của bạn hiện chưa có ô lưu trữ nào.
        </div>
      `;
      return;
    }

    grid.innerHTML = this.slots.map(s => {
      if (s.empty) {
        return `
          <div class="slot-card empty-slot">
            <span class="slot-badge-num">Ô #${s.slot}</span>
            <div style="font-size: 2rem; margin-bottom: 8px; opacity: 0.4;">📦</div>
            <h4 style="color: #64748b; margin-bottom: 4px; font-size: 1.05rem;">Ô Trống #${s.slot}</h4>
            <p style="font-size: 0.8rem; margin: 0; color: #475569;">Sẵn sàng cất khủng long mới</p>
          </div>
        `;
      }

      const mutHtml = (s.mutations && s.mutations.length > 0)
        ? s.mutations.map(m => `<span class="mutation-tag">🧬 ${m}</span>`).join('')
        : '<span style="font-size: 0.75rem; color: #64748b;">Chưa có đột biến</span>';

      return `
        <div class="slot-card">
          <span class="slot-badge-num">Ô #${s.slot}</span>
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div>
                <h4 style="color: #fff; margin: 0 0 4px; font-size: 1.2rem;">${s.species}</h4>
                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                  <span class="rule-badge badge-allow" style="font-size: 0.75rem; padding: 2px 6px;">${s.gender}</span>
                  ${s.isPrimeElder ? '<span class="rule-badge badge-gold" style="font-size: 0.75rem; padding: 2px 6px;">👑 PRIME</span>' : ''}
                  <span style="font-size: 0.8rem; color: #10b981; font-weight: 700;">${s.growth}% Growth</span>
                </div>
              </div>
            </div>

            <div style="background: rgba(0,0,0,0.2); border-radius: 6px; padding: 10px; margin: 12px 0;">
              <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 6px;">Đột biến gen:</div>
              <div>${mutHtml}</div>
            </div>

            <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 14px;">
              <span>🕒 Lưu lúc: ${s.stored_at}</span>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button onclick="Garage.startRestoreChanneling('${s.id}', '${s.species}', ${s.growth})" class="btn btn-primary btn-sm" style="width: 100%; font-weight: 800; padding: 10px 14px; font-size: 0.92rem; background: linear-gradient(135deg, #10b981, #059669); border: none; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);">
              ⚔️ Đưa Ra Đảo (Restore 30s)
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  async parkActiveDino() {
    if (this.cooldownSeconds > 0) {
      this.showActionAlert('⏳ Đang Trong Thời Gian Giãn Cách 30 Giây', `Vui lòng chờ thêm ${this.cooldownSeconds}s trước khi cất hoặc đổi khủng long!`, 'warning');
      App.showToast(`Vui lòng chờ hết thời gian đệm (${this.cooldownSeconds}s)!`, 'warn');
      return;
    }

    if (!this.activeDino) {
      App.showToast('Bạn hiện không có khủng long nào đang sống để cất!', 'error');
      return;
    }

    if (!confirm(`Xác nhận cất [${this.activeDino.species}] vào Gara IslePilot? Lưu ý: Bạn bắt buộc phải không bị nhận sát thương trong 30 giây gần nhất!`)) {
      return;
    }

    const sid = this.getActiveSteamId();
    try {
      this.hideActionAlert();
      App.showToast('Đang kết nối IslePilot để cất khủng long...', 'info');
      const res = await fetch('/api/player/garage/park', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(sid ? { 'x-steam-id': sid } : {}) },
        body: JSON.stringify({ steamId: sid })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(data.message, 'success');
        this.hideActionAlert();
        localStorage.setItem('the_isle_garage_cooldown', Date.now() + 30000);
        this.cooldownSeconds = 30;
        this.startCooldownTimer();
        await this.fetchGarageData();
        this.render();
      } else {
        const errMsg = data.error || 'Cất khủng long thất bại!';
        App.showToast(errMsg, 'error');
        this.showActionAlert('⚠️ Chưa Thể Cất Vào Gara Lúc Này', errMsg, 'error');
      }
    } catch (e) {
      App.showToast('Lỗi mạng khi cất khủng long!', 'error');
      this.showActionAlert('Lỗi Kết Nối', 'Không thể kết nối máy chủ ST25. Vui lòng kiểm tra lại đường truyền!', 'error');
    }
  },

  restoreChannelingTimer: null,
  restoreRemainingSeconds: 30,
  pendingRestoreDino: null,

  async startRestoreChanneling(garageDinoId, species, growth) {
    if (this.cooldownSeconds > 0) {
      this.showActionAlert('⏳ Đang Trong Thời Gian Giãn Cách 30 Giây', `Vui lòng chờ thêm ${this.cooldownSeconds}s để bảo vệ an toàn dữ liệu nhân vật!`, 'warning');
      App.showToast(`Vui lòng chờ hết thời gian đệm (${this.cooldownSeconds}s) để bảo vệ dữ liệu!`, 'warn');
      return;
    }

    if (!confirm(`Xác nhận đưa [${species} ${growth}%] ra đảo?\n\n⚠️ LƯU Ý QUAN TRỌNG TỪ MÁY CHỦ:\n• Hệ thống sẽ phát cảnh báo đến toàn bộ người chơi trong phạm vi 500 mét!\n• Quá trình chuẩn bị xuất hiện tốn đúng 30 giây.\n• Bạn phải giữ an toàn trong 30 giây này để khủng long xuất hiện an toàn!`)) {
      return;
    }

    const sid = this.getActiveSteamId();
    this.pendingRestoreDino = { garageDinoId, species, growth, steamId: sid };
    this.hideActionAlert();

    // 1. Gửi tín hiệu chuẩn bị lên Server để phát cảnh báo 500m
    try {
      App.showToast(`Đang phát tín hiệu cảnh báo 500m cho [${species}]...`, 'info');
      await fetch('/api/player/garage/restore-prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(sid ? { 'x-steam-id': sid } : {}) },
        body: JSON.stringify({ garageDinoId, species, growth, steamId: sid })
      });
    } catch (_) {}

    // 2. Mở Modal Đếm Ngược 30 Giây
    const modal = document.getElementById('restore-channeling-modal');
    const nameEl = document.getElementById('restore-modal-dino-name');
    const countEl = document.getElementById('restore-countdown-big');
    const progressEl = document.getElementById('restore-countdown-progress');

    if (nameEl) nameEl.textContent = `${species} (${growth}% Growth)`;
    if (countEl) countEl.textContent = '30s';
    if (progressEl) progressEl.style.width = '100%';
    if (modal) modal.style.display = 'flex';

    this.restoreRemainingSeconds = 30;
    if (this.restoreChannelingTimer) clearInterval(this.restoreChannelingTimer);

    this.restoreChannelingTimer = setInterval(async () => {
      this.restoreRemainingSeconds--;
      if (countEl) countEl.textContent = `${this.restoreRemainingSeconds}s`;
      if (progressEl) {
        const pct = Math.max(0, (this.restoreRemainingSeconds / 30) * 100);
        progressEl.style.width = `${pct}%`;
      }

      if (this.restoreRemainingSeconds <= 0) {
        clearInterval(this.restoreChannelingTimer);
        this.restoreChannelingTimer = null;
        if (countEl) countEl.textContent = '0s';
        await this.executeFinalRestore();
      }
    }, 1000);
  },

  cancelRestoreChanneling() {
    if (this.restoreChannelingTimer) {
      clearInterval(this.restoreChannelingTimer);
      this.restoreChannelingTimer = null;
    }
    this.pendingRestoreDino = null;
    const modal = document.getElementById('restore-channeling-modal');
    if (modal) modal.style.display = 'none';
    App.showToast('Đã hủy bỏ lệnh triệu hồi khủng long ra đảo.', 'info');
  },

  async executeFinalRestore() {
    const d = this.pendingRestoreDino;
    const modal = document.getElementById('restore-channeling-modal');
    if (modal) modal.style.display = 'none';

    if (!d) return;

    const sid = d.steamId || this.getActiveSteamId();
    App.showToast(`⏳ Hết 30 giây! Đang chính thức hồi phục [${d.species}] vào game server...`, 'info');

    try {
      const res = await fetch('/api/player/garage/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(sid ? { 'x-steam-id': sid } : {}) },
        body: JSON.stringify({ garageDinoId: d.garageDinoId, steamId: sid })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(`🎉 XUẤT HIỆN THÀNH CÔNG: [${d.species} ${d.growth}%] đã ra đảo!`, 'success');
        this.hideActionAlert();
        localStorage.setItem('the_isle_garage_cooldown', Date.now() + 30000);
        this.cooldownSeconds = 30;
        this.startCooldownTimer();
        await this.fetchGarageData();
        this.render();
      } else {
        const errMsg = data.error || 'Hồi phục khủng long thất bại!';
        App.showToast(errMsg, 'error');
        this.showActionAlert('⚠️ Không Thể Đưa Khủng Long Ra Đảo', errMsg, 'error');
      }
    } catch (e) {
      App.showToast('Lỗi mạng khi hồi phục khủng long!', 'error');
      this.showActionAlert('Lỗi Kết Nối', 'Không thể kết nối máy chủ game sau 30s. Vui lòng kiểm tra lại!', 'error');
    } finally {
      this.pendingRestoreDino = null;
    }
  },

  showActionAlert(title, message, type = 'error') {
    const el = document.getElementById('garage-action-alert');
    const titleEl = document.getElementById('garage-action-alert-title');
    const msgEl = document.getElementById('garage-action-alert-msg');
    const iconEl = document.getElementById('garage-action-alert-icon');
    if (!el || !titleEl || !msgEl) return;

    titleEl.textContent = title;
    msgEl.textContent = message;

    if (type === 'warning') {
      el.style.borderColor = '#f59e0b';
      el.style.backgroundColor = 'rgba(245, 158, 11, 0.15)';
      titleEl.style.color = '#fbbf24';
      msgEl.style.color = '#fef08a';
      if (iconEl) iconEl.textContent = '⏳';
    } else {
      el.style.borderColor = '#ef4444';
      el.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
      titleEl.style.color = '#f87171';
      msgEl.style.color = '#fca5a5';
      if (iconEl) iconEl.textContent = '⚠️';
    }

    el.style.display = 'block';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  hideActionAlert() {
    const el = document.getElementById('garage-action-alert');
    if (el) el.style.display = 'none';
  },

  async sellDino(garageDinoId, species, growth) {
    if (!confirm(`Xác nhận bán [${species} ${growth}%] vào hệ thống nhà phát hành IslePilot? Tiền Lúa 🌾 sẽ được cộng tự động vào ví của bạn.`)) {
      return;
    }

    const sid = this.getActiveSteamId();
    try {
      App.showToast(`Đang bán [${species}] vào hệ thống...`, 'info');
      const res = await fetch('/api/player/garage/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(sid ? { 'x-steam-id': sid } : {}) },
        body: JSON.stringify({ garageDinoId, steamId: sid })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(data.message, 'success');
        await this.fetchGarageData();
        this.render();
      } else {
        App.showToast(data.error || 'Bán khủng long thất bại!', 'error');
      }
    } catch (e) {
      App.showToast('Lỗi mạng khi bán khủng long!', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('garage-slots-grid')) {
    Garage.init();
  }
});
