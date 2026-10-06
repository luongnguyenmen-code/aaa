// Dinosaur Garage System Script for ST25 (Synchronized with IslePilot Cloud & In-Game Plugin)
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
    App.showToast('Đang đồng bộ dữ liệu với IslePilot...', 'info');
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
        App.showToast('Hết 30 giây chuẩn bị! Khủng long đã sẵn sàng xuất chiến trong game.', 'success');
        // Tự động làm mới dữ liệu để hiển thị con active mới nhất
        await this.fetchGarageData();
        this.render();
      }
      this.updateCooldownUI();
    }, 1000);
  },

  updateCooldownUI() {
    const badge = document.getElementById('cooldown-badge');
    const timerText = document.getElementById('cooldown-timer-text');
    if (!badge || !timerText) return;

    if (this.cooldownSeconds > 0) {
      badge.style.display = 'inline-flex';
      const m = Math.floor(this.cooldownSeconds / 60);
      const s = this.cooldownSeconds % 60;
      timerText.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    } else {
      badge.style.display = 'none';
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
          roleName: data.roleName || '🦖 Thành Viên ST25 (3 Slots)',
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
    const capEl = document.getElementById('garage-capacity-text');
    const roleBadge = document.getElementById('garage-role-badge');
    const roleDesc = document.getElementById('garage-role-desc');

    if (nameEl) nameEl.textContent = `Tài khoản: ${this.playerInfo.personaName}`;
    if (steamEl) steamEl.textContent = `Steam ID: ${this.playerInfo.steamId || 'Chưa đăng nhập'}`;
    if (countEl) countEl.textContent = `Đang lưu: ${this.playerInfo.totalParked} / ${this.playerInfo.maxSlots} Khủng Long`;
    if (capEl) capEl.textContent = `Sức chứa tối đa: ${this.playerInfo.maxSlots} khủng long (${this.playerInfo.roleName})`;
    if (roleDesc) {
      roleDesc.innerHTML = `Bạn đang có quyền hạn: <strong style="color: #fbbf24;">${this.playerInfo.roleName}</strong> — Giới hạn lưu trữ: <strong style="color: #38bdf8;">${this.playerInfo.maxSlots} slot</strong> khủng long. Khi đầy Gara sẽ không thể cất thêm hoặc mua khủng long mới!`;
    }

    const adminBtn = document.getElementById('btn-admin-manage');
    if (adminBtn) {
      const key = (this.playerInfo.roleKey || '').toLowerCase();
      if (['.', 'admin', 'mod', 'dev'].includes(key) || this.playerInfo.maxSlots >= 20) {
        adminBtn.style.display = 'inline-flex';
      } else {
        adminBtn.style.display = 'none';
      }
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
          <h3 style="color: #fff; margin-bottom: 6px;">Bạn hiện không có khủng long nào đang chơi (Active)</h3>
          <p style="color: #94a3b8;">Hãy vào game spawn khủng long mới hoặc chọn một con từ Gara bên dưới bấm <strong>"Lấy ra đảo chơi"</strong> để đưa trực tiếp vào game.</p>
        </div>
      `;
      return;
    }

    const d = this.activeDino;
    panel.innerHTML = `
      <div class="dino-avatar-box">
        <h3 style="color: #fff; margin-bottom: 6px; font-size: 1.5rem;">${d.species}</h3>
        <span class="rule-badge badge-allow">${d.gender}</span>
        <p style="font-size: 0.9rem; color: var(--text-muted); margin-top: 10px;">
          Tăng trưởng: <b style="color: #10b981; font-size: 1.1rem;">${d.growth}%</b>
        </p>
        <button onclick="Garage.storeActiveDino()" class="btn btn-secondary btn-sm" style="margin-top: 16px; width: 100%; font-weight: 700;">
          📥 Cất Vào Gara (Park 35s)
        </button>
      </div>

      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h4 style="color: #fff;">Chỉ số sinh tồn in-game</h4>
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
            <div class="stat-label-wrap"><span>Thể lực (Stamina)</span><b>${d.stamina}%</b></div>
            <div class="stat-bar-track"><div class="stat-bar-fill fill-stamina" style="width: ${d.stamina}%"></div></div>
          </div>
          <div class="stat-item" style="grid-column: 1 / -1;">
            <div class="stat-label-wrap"><span>Mức độ trưởng thành (Growth)</span><b>${d.growth}%</b></div>
            <div class="stat-bar-track"><div class="stat-bar-fill fill-growth" style="width: ${d.growth}%"></div></div>
          </div>
        </div>

        <div style="margin-top: 20px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: var(--radius-sm); border: 1px solid rgba(255,255,255,0.08);">
          <strong style="font-size: 0.85rem; color: var(--accent-emerald-light);">Đột biến kích hoạt:</strong>
          <span style="font-size: 0.85rem; color: #cbd5e1; margin-left: 8px;">${d.mutations && d.mutations.length ? d.mutations.join(', ') : 'Chưa có đột biến'}</span>
        </div>
      </div>
    `;
  },

  renderSlots() {
    const grid = document.getElementById('garage-slots-grid');
    if (!grid) return;

    if (!this.slots || this.slots.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          Chưa có khủng long nào trong Gara.
        </div>
      `;
      return;
    }

    grid.innerHTML = this.slots.map((s, idx) => {
      if (s.empty) {
        return `
          <div class="garage-slot-card empty">
            <div style="font-size: 0.85rem; color: var(--text-muted);">Ô số ${idx + 1}</div>
            <div style="text-align: center; padding: 30px 0;">
              <span style="font-size: 1.8rem; color: var(--text-muted); font-weight: 700;">+</span>
              <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 6px;">Ô trống</p>
            </div>
            ${this.activeDino ? `<button onclick="Garage.storeActiveDino()" class="btn btn-secondary btn-sm">Cất con hiện tại vào</button>` : ''}
          </div>
        `;
      }

      return `
        <div class="garage-slot-card" style="display: flex; flex-direction: column; justify-content: space-between; border-color: ${s.isPrimeElder ? 'rgba(251, 191, 36, 0.4)' : 'rgba(16, 185, 129, 0.3)'};">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-weight: 800; color: #fff;">Ô #${idx + 1}</span>
              <div style="display: flex; gap: 4px; align-items: center;">
                ${s.isPrimeElder ? '<span class="rule-badge badge-warn" style="font-size: 0.7rem; font-weight: 700; background: rgba(245, 158, 11, 0.15); border-color: #f59e0b; color: #fbbf24;">⭐ Prime Elder</span>' : ''}
                <span class="rule-badge badge-allow" style="font-weight: 700;">${s.growth}% lớn</span>
              </div>
            </div>

            <div>
              <h4 style="color: #fbbf24; font-size: 1.2rem; margin-bottom: 4px;">🦖 ${s.species}</h4>
              <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 6px;">
                ${s.gender} • Cất: <span style="color: #cbd5e1;">${s.stored_at || 'Đã lưu'}</span>
              </p>

              <!-- Live Stats Mini Bars (IslePilot Cloud Sync) -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 10px 0; font-size: 0.72rem;">
                <div style="background: rgba(0,0,0,0.25); padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                  <span style="color: #94a3b8;">Máu:</span> <strong style="color: #ef4444;">${s.health !== undefined ? s.health : 100}%</strong>
                </div>
                <div style="background: rgba(0,0,0,0.25); padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                  <span style="color: #94a3b8;">Đói:</span> <strong style="color: #f59e0b;">${s.hunger !== undefined ? s.hunger : 100}%</strong>
                </div>
                <div style="background: rgba(0,0,0,0.25); padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                  <span style="color: #94a3b8;">Khát:</span> <strong style="color: #38bdf8;">${s.thirst !== undefined ? s.thirst : 100}%</strong>
                </div>
                <div style="background: rgba(0,0,0,0.25); padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.05);">
                  <span style="color: #94a3b8;">Thể lực:</span> <strong style="color: #10b981;">${s.stamina !== undefined ? s.stamina : 100}%</strong>
                </div>
              </div>

              <!-- Mutations List -->
              ${s.mutations && s.mutations.filter(m => m && m !== 'None').length > 0 ? `
                <div style="margin: 8px 0; font-size: 0.72rem; color: #a7f3d0; background: rgba(16, 185, 129, 0.08); padding: 5px 8px; border-radius: 4px;">
                  🧬 <b>Đột biến:</b> ${s.mutations.filter(m => m && m !== 'None').join(', ')}
                </div>
              ` : ''}

              <div style="font-size: 0.75rem; color: var(--text-muted);">
                Nguồn: <span style="color: #38bdf8;">${s.source || 'IslePilot Cloud'}</span>
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 14px;">
            <button onclick="Garage.restoreDino('${s.id}', ${s.slot}, '${s.species}', ${s.growth})" class="btn btn-primary btn-sm" style="flex: 1; font-weight: 800;">
              🚀 Lấy Ra Chơi (30s)
            </button>
            <button onclick="Garage.deleteDino('${s.id}', ${s.slot}, '${s.species}')" class="btn btn-danger btn-sm" title="Xoá / Giải phóng">
              🗑️
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  parkingTimer: null,
  parkingSeconds: 0,

  async storeActiveDino() {
    if (!this.activeDino) {
      App.showToast('Bạn không có khủng long đang chơi để cất!', 'warning');
      return;
    }

    if (this.parkingSeconds > 0) {
      App.showToast(`Đang trong tiến trình cất thú (${this.parkingSeconds}s còn lại). Vui lòng đứng yên!`, 'warning');
      return;
    }

    if (!confirm(`Xác nhận cất ${this.activeDino.species} (${this.activeDino.growth}%) vào Gara?\n\n• Hệ thống yêu cầu chờ đúng 30 GIÂY.\n• Bạn phải đứng yên an toàn trong game (không di chuyển, không dính sát thương) theo Điều 8!\n\nBắt đầu 30 giây cất thú?`)) {
      return;
    }

    try {
      App.showToast('Bắt đầu đếm ngược 30 giây cất thú. Vui lòng đứng yên trong game! ⏳', 'info');
      const startRes = await fetch('/api/player/garage/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      });

      this.parkingSeconds = 30;
      this.updateParkingUI();

      if (this.parkingTimer) clearInterval(this.parkingTimer);
      this.parkingTimer = setInterval(async () => {
        this.parkingSeconds--;
        this.updateParkingUI();

        if (this.parkingSeconds <= 0) {
          clearInterval(this.parkingTimer);
          this.parkingTimer = null;

          App.showToast('Đang hoàn tất lưu khủng long vào Gara...', 'info');
          const finishRes = await fetch('/api/player/garage/store', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'confirm' })
          });
          const finishData = await finishRes.json();

          if (finishRes.ok) {
            App.showToast(finishData.message || 'Đã cất khủng long vào Gara thành công sau 30 giây!', 'success');
            await this.fetchGarageData();
            this.render();
          } else {
            App.showToast(finishData.error || 'Cất thú thất bại!', 'error');
          }
        }
      }, 1000);

    } catch (e) {
      console.error(e);
      App.showToast('Lỗi mạng khi cất khủng long!', 'error');
    }
  },

  updateParkingUI() {
    const badge = document.getElementById('cooldown-badge');
    const timerText = document.getElementById('cooldown-timer-text');
    if (!badge || !timerText) return;

    if (this.parkingSeconds > 0) {
      badge.style.display = 'inline-flex';
      badge.className = 'rule-badge badge-warn';
      const m = Math.floor(this.parkingSeconds / 60);
      const s = this.parkingSeconds % 60;
      badge.innerHTML = `Đang cất Gara: <strong id="cooldown-timer-text">${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}</strong>`;
    } else if (this.cooldownSeconds <= 0) {
      badge.style.display = 'none';
    }
  },

  async restoreDino(id, slotNum, species, growth) {
    if (this.cooldownSeconds > 0) {
      App.showToast(`Bạn đang trong thời gian đếm ngược (${this.cooldownSeconds}s còn lại)!`, 'warning');
      return;
    }

    if (this.parkingSeconds > 0) {
      App.showToast(`Đang trong tiến trình cất thú (${this.parkingSeconds}s còn lại)!`, 'warning');
      return;
    }

    const currentName = this.activeDino ? this.activeDino.species : 'nhân vật hiện tại';
    const confirmMsg = `⚠️ XÁC NHẬN LẤY KHỦNG LONG RA ĐẢO:\n\n` +
      `• Khi lấy [${species} ${growth}%] ra chơi, con [${currentName}] đang chơi trong game sẽ BỊ MẤT LUÔN (không lưu vào kho)!\n` +
      `• Quá trình chuẩn bị xuất chiến sẽ mất đúng 30 GIÂY.\n` +
      `• Kể cả con nhỏ dưới 25% vẫn xuất kích bình thường.\n\n` +
      `Bạn có đồng ý đưa [${species}] ra đảo?`;

    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      App.showToast(`Đang gửi lệnh xuất xưởng [${species} ${growth}%]... Bắt đầu chờ 30 giây! 🚀`, 'info');
      const res = await fetch('/api/player/garage/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: id,
          slot: slotNum,
          species: species,
          growth: growth
        })
      });
      const data = await res.json();

      if (res.ok) {
        // Kích hoạt đồng hồ 30 giây xuất chiến
        const cooldownDuration = data.cooldown_seconds || 30;
        this.cooldownSeconds = cooldownDuration;
        localStorage.setItem('the_isle_garage_cooldown', (Date.now() + cooldownDuration * 1000).toString());
        this.startCooldownTimer();

        App.showToast(data.message || `Đã đưa [${species}] ra đảo thành công! Đang đếm ngược 30 giây hoàn tất.`, 'success');

        // Làm mới dữ liệu Gara
        setTimeout(async () => {
          await this.fetchGarageData();
          this.render();
        }, 1200);

      } else {
        App.showToast(data.error || 'Lấy khủng long thất bại!', 'error');
      }
    } catch (e) {
      App.showToast('Lỗi mạng khi lấy khủng long!', 'error');
    }
  },

  async deleteDino(id, slotNum, species) {
    if (!confirm(`Bạn có chắc chắn muốn xoá vĩnh viễn [${species}] ở ô ${slotNum}? Hành động này sẽ bán/giải phóng thú khỏi Gara!`)) {
      return;
    }

    try {
      const res = await fetch('/api/player/garage/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, slot: slotNum })
      });
      if (res.ok) {
        App.showToast(`Đã xoá [${species}] khỏi Gara.`, 'info');
        await this.fetchGarageData();
        this.render();
      } else {
        App.showToast('Không thể xoá thú!', 'error');
      }
    } catch (e) {
      App.showToast('Lỗi mạng khi xoá thú!', 'error');
    }
  },

  openAdminModal() {
    const modal = document.getElementById('admin-role-modal');
    if (modal) {
      modal.style.display = 'flex';
      this.onAdminRoleChange();
    }
  },

  closeAdminModal() {
    const modal = document.getElementById('admin-role-modal');
    if (modal) modal.style.display = 'none';
  },

  onAdminRoleChange() {
    const roleSel = document.getElementById('admin-target-role');
    const slotInput = document.getElementById('admin-target-slots');
    if (!roleSel || !slotInput) return;

    const defaultLimits = {
      ".": 20, "admin": 20, "mod": 20, "long_dai_dia_chu": 20,
      "long_phu_nong": 18, "long_ta_dien": 12, "dev": 10,
      "long_chu": 8, "booster": 5, "streamer": 5, "default": 3
    };

    if (roleSel.value !== 'custom') {
      slotInput.value = defaultLimits[roleSel.value] || 3;
    }
  },

  async submitAdminRole() {
    const steamId = (document.getElementById('admin-target-steamid').value || '').trim();
    const role = document.getElementById('admin-target-role').value;
    const slots = Number(document.getElementById('admin-target-slots').value) || 3;

    if (!steamId || steamId.length < 10) {
      App.showToast('Vui lòng nhập Steam ID hợp lệ (17 số)!', 'error');
      return;
    }

    try {
      App.showToast('Đang lưu quyền hạn lên hệ thống máy chủ...', 'info');
      const res = await fetch('/api/admin/set-garage-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamId, role, slots })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        App.showToast(`Đã cấp quyền thành công cho [${steamId}]! Role: ${role.toUpperCase()} (${slots} slots)`, 'success');
        this.closeAdminModal();
        await this.fetchGarageData();
        this.render();
      } else {
        App.showToast(data.error || 'Lỗi khi cấp quyền!', 'error');
      }
    } catch (e) {
      console.error(e);
      App.showToast('Lỗi mạng khi lưu quyền hạn!', 'error');
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('garage-slots-grid')) {
    Garage.init();
  }
});
