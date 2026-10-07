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
      if (qId) return qId;
      const stored = localStorage.getItem('st25_steam_user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u && u.steam_id) return u.steam_id;
      }
    } catch (_) {}
    return null;
  },

  async fetchGarageData() {
    try {
      const sid = this.getActiveSteamId();
      const url = sid ? `/api/player/garage?steamId=${encodeURIComponent(sid)}` : '/api/player/garage';
      const res = await fetch(url, { headers: sid ? { 'x-steam-id': sid } : {} });
      if (res.ok) {
        const data = await res.json();
        this.activeDino = data.active;
        this.slots = data.slots || [];
        this.playerInfo = {
          steamId: data.steamId,
          personaName: data.personaName,
          totalParked: data.totalParked || 0,
          maxSlots: data.maxSlots || 3,
          roleKey: data.roleKey || 'default',
          roleName: data.roleName || '🦖 Thành Viên ST25',
          roleLimit: data.roleLimit || data.maxSlots || 3
        };
        this.updateHeaderUI();
        return;
      }
    } catch (e) {
      console.error('Lỗi nạp dữ liệu garage:', e);
      App.showToast('Không thể kết nối máy chủ để lấy dữ liệu Gara!', 'error');
    }
  },

  updateHeaderUI() {
    if (!this.playerInfo) return;
    const nameEl = document.getElementById('garage-player-name');
    const steamEl = document.getElementById('garage-player-steamid');
    const countEl = document.getElementById('garage-count-badge');
    const roleBadge = document.getElementById('garage-role-badge');
    const noticeEl = document.getElementById('garage-capacity-notice');
    const summaryBadge = document.getElementById('slots-capacity-summary');

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

    if (!this.activeDino) {
      panel.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          <span style="font-size: 2.5rem; display: block; margin-bottom: 12px;">🦖</span>
          <h3 style="color: #fff; margin-bottom: 6px;">Bạn hiện không có khủng long nào đang chơi trong game</h3>
          <p style="color: #94a3b8; max-width: 500px; margin: 0 auto;">
            Hãy vào game spawn khủng long mới hoặc chọn một con từ Gara bên dưới bấm <strong>"Đưa Ra Đảo (Restore)"</strong> để hồi phục vào server!
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
            <button onclick="Garage.restoreDino('${s.id}', '${s.species}', ${s.growth})" class="btn btn-primary btn-sm" style="width: 100%; font-weight: 700;">
              ⚔️ Đưa Ra Đảo (Restore)
            </button>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <button onclick="Garage.sellDino('${s.id}', '${s.species}', ${s.growth})" class="btn btn-secondary btn-sm" style="font-size: 0.8rem; border-color: #f59e0b; color: #fbbf24;">
                💰 Bán (Sell)
              </button>
              <a href="giao-dich.html" class="btn btn-secondary btn-sm" style="font-size: 0.8rem; text-align: center;">
                ⚖️ Rao Chợ
              </a>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  async parkActiveDino() {
    if (!this.activeDino) {
      App.showToast('Bạn hiện không có khủng long nào đang sống để cất!', 'error');
      return;
    }

    if (!confirm(`Xác nhận cất [${this.activeDino.species}] vào Gara IslePilot? Hãy đảm bảo bạn đang an toàn và không trong combat!`)) {
      return;
    }

    const sid = this.getActiveSteamId();
    try {
      App.showToast('Đang kết nối IslePilot để cất khủng long...', 'info');
      const res = await fetch('/api/player/garage/park', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(sid ? { 'x-steam-id': sid } : {}) },
        body: JSON.stringify({ steamId: sid })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(data.message, 'success');
        localStorage.setItem('the_isle_garage_cooldown', Date.now() + 30000);
        this.cooldownSeconds = 30;
        this.startCooldownTimer();
        await this.fetchGarageData();
        this.render();
      } else {
        App.showToast(data.error || 'Cất khủng long thất bại!', 'error');
      }
    } catch (e) {
      App.showToast('Lỗi mạng khi cất khủng long!', 'error');
    }
  },

  async restoreDino(garageDinoId, species, growth) {
    if (this.cooldownSeconds > 0) {
      App.showToast(`Vui lòng chờ hết thời gian đệm (${this.cooldownSeconds}s) để bảo vệ dữ liệu!`, 'warn');
      return;
    }

    if (!confirm(`Xác nhận đưa [${species} ${growth}%] ra đảo? Nhân vật hiện tại trong game sẽ được thế chỗ bằng con này!`)) {
      return;
    }

    const sid = this.getActiveSteamId();
    try {
      App.showToast(`Đang hồi phục [${species}] vào game server...`, 'info');
      const res = await fetch('/api/player/garage/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(sid ? { 'x-steam-id': sid } : {}) },
        body: JSON.stringify({ garageDinoId, steamId: sid })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(data.message, 'success');
        localStorage.setItem('the_isle_garage_cooldown', Date.now() + 30000);
        this.cooldownSeconds = 30;
        this.startCooldownTimer();
        await this.fetchGarageData();
        this.render();
      } else {
        App.showToast(data.error || 'Hồi phục khủng long thất bại!', 'error');
      }
    } catch (e) {
      App.showToast('Lỗi mạng khi hồi phục khủng long!', 'error');
    }
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
