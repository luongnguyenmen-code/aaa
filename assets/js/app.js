// Core App Script — Server ST25 Vietnam The Isle Portal
const App = {
  user: null,
  config: null,
  notifications: [],

  async init() {
    this.bindEvents();
    await this.loadConfig();
    await this.loadEnvironment();
    await this.checkAuth();
    this.renderEnhancedNav();
    this.renderPlayerHUD();
    this.renderMobileNavigation();
    this.init3DTiltCards();
    this.updateUI();

    // Tự động làm mới thời tiết & ngày/đêm mỗi 30s
    setInterval(() => this.loadEnvironment(), 30000);
    // Tự động làm mới thông báo & số dư Lúa mỗi 15s
    setInterval(() => this.checkAuthSilently(), 15000);
  },

  async loadEnvironment() {
    try {
      const res = await fetch('/api/server/environment');
      if (res.ok) {
        const env = await res.json();
        this.renderWeatherWidget(env);
      }
    } catch (e) {
      // offline fallback
    }
  },

  renderWeatherWidget(env) {
    if (!env) return;

    let headerPill = document.getElementById('live-weather-header-pill');
    if (!headerPill) {
      const headerContainer = document.querySelector('.site-header .nav-wrap') || document.querySelector('.site-header .header-container') || document.querySelector('.site-header .container');
      if (headerContainer) {
        headerPill = document.createElement('div');
        headerPill.id = 'live-weather-header-pill';
        headerPill.style.display = 'inline-flex';
        headerPill.style.alignItems = 'center';
        headerPill.style.gap = '8px';
        headerPill.style.fontSize = '0.8rem';
        headerPill.style.fontWeight = '700';
        headerPill.style.padding = '5px 12px';
        headerPill.style.borderRadius = '20px';
        headerPill.style.background = 'rgba(15, 23, 42, 0.85)';
        headerPill.style.border = '1px solid rgba(251, 191, 36, 0.35)';
        headerPill.style.color = '#e2e8f0';
        headerPill.style.backdropFilter = 'blur(6px)';
        headerPill.style.cursor = 'default';
        headerPill.style.whiteSpace = 'nowrap';
        headerPill.title = `Chu kỳ game: ${env.phaseDesc}. Thời tiết: ${env.weatherDesc} (${env.temperature}°C)`;

        const navActions = headerContainer.querySelector('.nav-actions');
        if (navActions) {
          headerContainer.insertBefore(headerPill, navActions);
        } else {
          headerContainer.appendChild(headerPill);
        }
      }
    }

    if (headerPill) {
      const isNight = env.phase === 'NIGHT';
      headerPill.style.borderColor = isNight ? 'rgba(168, 85, 247, 0.4)' : 'rgba(251, 191, 36, 0.4)';
      headerPill.innerHTML = `
        <span style="font-size: 1rem;">${env.weatherIcon || '☀️'}</span>
        <span>${env.displayBadge}</span>
      `;
    }
  },

  async loadConfig() {
    try {
      const res = await fetch('/api/server/status');
      if (res.ok) {
        this.config = await res.json();
        this.updateServerStatusBadge();
      }
    } catch (e) {
      console.warn('API offline, running in standalone mode');
    }
  },

  async checkAuth() {
    try {
      const res = await fetch('/api/player/me');
      if (res.ok) {
        const u = await res.json();
        if (u && u.linked && u.steam_id) {
          this.user = u;
          this.notifications = u.notifications || [];
          localStorage.setItem('st25_steam_user', JSON.stringify({
            steam_id: u.steam_id,
            persona_name: u.persona_name,
            avatar: u.avatar,
            isAdmin: !!u.isAdmin
          }));
        } else {
          this.user = null;
          this.notifications = [];
          localStorage.removeItem('st25_steam_user');
          localStorage.removeItem('the_isle_demo_user');
        }
      } else {
        this.user = null;
      }
    } catch (e) {
      this.user = null;
    }
  },

  async checkAuthSilently() {
    try {
      const res = await fetch('/api/player/me');
      if (res.ok) {
        const u = await res.json();
        if (u && u.linked && u.steam_id) {
          this.user = u;
          this.notifications = u.notifications || [];
          this.renderPlayerHUD();
        }
      }
    } catch (_) {}
  },

  updateServerStatusBadge() {
    const el = document.getElementById('server-player-count');
    if (el && this.config) {
      el.textContent = `${this.config.online_players || 42} / ${this.config.max_players || 100} người chơi`;
    }
  },

  // ==========================================
  // ITEM 1: CATEGORIZED DROPDOWN NAVIGATION
  // ==========================================
  renderEnhancedNav() {
    const navUl = document.querySelector('.nav-links');
    if (!navUl) return;

    const currentFile = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const isAdmin = !!(this.user && this.user.isAdmin);

    const isSurvivalActive = ['bando.html', 'gara.html', 'tha-xac.html', 'skin.html'].includes(currentFile);
    const isEconomyActive = ['nhiem-vu.html', 'giao-dich.html', 'hom-qua.html', 'song-bac.html'].includes(currentFile);
    const isCommunityActive = ['bxh.html', 'moi-ban.html', 'ho-tro.html', 'noi-quy.html', 'cai-dat.html'].includes(currentFile);

    navUl.innerHTML = `
      <li>
        <a href="index.html" class="nav-link ${currentFile === 'index.html' ? 'active' : ''}">
          🌾 Trang chủ
        </a>
      </li>

      <!-- NHÓM 1: SINH TỒN -->
      <li class="nav-dropdown">
        <a href="javascript:void(0)" class="nav-link nav-dropdown-toggle ${isSurvivalActive ? 'active' : ''}">
          🏕️ Sinh Tồn
        </a>
        <div class="nav-dropdown-menu">
          <a href="bando.html" class="nav-dropdown-item ${currentFile === 'bando.html' ? 'active' : ''}">
            🗺️ Bản Đồ Gateway
          </a>
          <a href="gara.html" class="nav-dropdown-item ${currentFile === 'gara.html' ? 'active' : ''}">
            🦖 Gara Khủng Long
          </a>
          <a href="tha-xac.html" class="nav-dropdown-item ${currentFile === 'tha-xac.html' ? 'active' : ''}">
            🥩 Thả Xác Cứu Đói
          </a>
          <a href="skin.html" class="nav-dropdown-item ${currentFile === 'skin.html' ? 'active' : ''}">
            🎨 Chỉnh Sửa Skin
          </a>
        </div>
      </li>

      <!-- NHÓM 2: KINH TẾ & CHỢ -->
      <li class="nav-dropdown">
        <a href="javascript:void(0)" class="nav-link nav-dropdown-toggle ${isEconomyActive ? 'active' : ''}">
          🌾 Kinh Tế & Chợ
        </a>
        <div class="nav-dropdown-menu">
          <a href="nhiem-vu.html" class="nav-dropdown-item ${currentFile === 'nhiem-vu.html' ? 'active' : ''}">
            🌾 Kho Lúa & Nhiệm Vụ
          </a>
          <a href="giao-dich.html" class="nav-dropdown-item ${currentFile === 'giao-dich.html' ? 'active' : ''}">
            ⚖️ Chợ Giao Dịch P2P
          </a>
          <a href="hom-qua.html" class="nav-dropdown-item ${currentFile === 'hom-qua.html' ? 'active' : ''}">
            🎁 Mở Hòm May Mắn
          </a>
          <a href="song-bac.html" class="nav-dropdown-item ${currentFile === 'song-bac.html' ? 'active' : ''}">
            🎲 Sòng Bạc ST25
          </a>
        </div>
      </li>

      <!-- NHÓM 3: CỘNG ĐỒNG & HỖ TRỢ -->
      <li class="nav-dropdown">
        <a href="javascript:void(0)" class="nav-link nav-dropdown-toggle ${isCommunityActive ? 'active' : ''}">
          🛡️ Cộng Đồng
        </a>
        <div class="nav-dropdown-menu">
          <a href="bxh.html" class="nav-dropdown-item ${currentFile === 'bxh.html' ? 'active' : ''}">
            🏆 Bảng Xếp Hạng
          </a>
          <a href="moi-ban.html" class="nav-dropdown-item ${currentFile === 'moi-ban.html' ? 'active' : ''}">
            👥 Mời Bạn Nhận Lúa
          </a>
          <a href="ho-tro.html" class="nav-dropdown-item ${currentFile === 'ho-tro.html' ? 'active' : ''}">
            🆘 Hỗ Trợ & Ticket
          </a>
          <a href="noi-quy.html" class="nav-dropdown-item ${currentFile === 'noi-quy.html' ? 'active' : ''}">
            📜 13 Điều Nội Quy
          </a>
          <a href="cai-dat.html" class="nav-dropdown-item admin-only ${currentFile === 'cai-dat.html' ? 'active' : ''}" style="${isAdmin ? '' : 'display: none;'}">
            👑 Cấp Role & Slot (Admin)
          </a>
        </div>
      </li>
    `;
  },

  // ==========================================
  // ITEM 1: PERSISTENT PLAYER HUD BAR
  // ==========================================
  renderPlayerHUD() {
    const navActions = document.querySelector('.nav-actions');
    if (!navActions) return;

    const isLoggedIn = !!(this.user && this.user.linked && this.user.steam_id);

    if (!isLoggedIn) {
      navActions.innerHTML = `
        <a href="lien-ket-steam.html" class="btn btn-secondary btn-sm" id="btn-steam-auth">
          🎮 Đăng Nhập Steam
        </a>
        <a href="tai-hud.html" class="btn btn-hud btn-sm" style="display: none;">Tải IsleLiveMap</a>
        <a href="https://discord.gg/3xCrA6VyY" target="_blank" class="btn btn-primary btn-sm">Discord ST25</a>
      `;
      return;
    }

    const u = this.user;
    const balance = u.balance || u.lua || u.coins || 0;
    const totalParked = u.totalParked || 0;
    const maxSlots = u.maxSlots || 3;
    const unreadCount = (this.notifications || []).length;
    const isAdmin = !!u.isAdmin;
    const avatar = u.avatar || 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg';
    const roleClass = isAdmin ? 'role-admin' : (u.roleKey && u.roleKey.includes('vip') ? 'role-vip' : '');

    navActions.innerHTML = `
      <div class="player-hud-bar">
        <!-- Lúa Counter Pill -->
        <a href="nhiem-vu.html" class="hud-pill hud-pill-lua" title="Số Lúa của bạn (Bấm để mở Kho Lúa)">
          <span>🌾</span>
          <span class="lua-val">${balance.toLocaleString()} Lúa</span>
        </a>

        <!-- Garage Capacity Pill -->
        <a href="gara.html" class="hud-pill hud-pill-garage" title="Sức chứa Gara (Bấm để quản lý khủng long)">
          <span>🦖</span>
          <span class="garage-val">${totalParked}/${maxSlots}</span>
        </a>

        <!-- Notification Bell -->
        <div style="position: relative;">
          <button type="button" class="hud-bell-btn" onclick="App.toggleNotificationPopover(event)" title="Thông báo hệ thống">
            <span>🔔</span>
            ${unreadCount > 0 ? `<span class="hud-bell-badge">${unreadCount}</span>` : ''}
          </button>

          <!-- Notification Popover -->
          <div id="hud-notification-popover" class="hud-popover">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">
              <strong style="color: #fbbf24; font-size: 0.9rem;">🔔 Thông Báo (${unreadCount})</strong>
              <a href="giao-dich.html" style="font-size: 0.78rem; color: #38bdf8;">Xem phòng Trade</a>
            </div>
            <div style="max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
              ${this.notifications.length === 0 ? `
                <div style="text-align: center; padding: 20px; color: #64748b; font-size: 0.85rem;">
                  Không có thông báo mới nào.
                </div>
              ` : this.notifications.map(n => `
                <a href="${n.link || 'giao-dich.html'}" style="background: rgba(0,0,0,0.4); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 10px; display: block; text-decoration: none;">
                  <div style="font-size: 0.82rem; font-weight: 700; color: #fff;">${n.title}</div>
                  <div style="font-size: 0.78rem; color: #34d399; margin: 3px 0;">${n.desc}</div>
                  <div style="font-size: 0.72rem; color: #94a3b8;">${n.time}</div>
                </a>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- User Profile Pill -->
        <div style="position: relative;">
          <div class="hud-profile-pill" onclick="App.toggleProfilePopover(event)">
            <img src="${avatar}" class="hud-avatar ${roleClass}" alt="Steam Avatar">
            <span class="hud-username">${u.persona_name || 'Người chơi'}</span>
            <span style="font-size: 0.7rem; color: #94a3b8;">▾</span>
          </div>

          <!-- Profile Popover -->
          <div id="hud-profile-popover" class="hud-popover" style="width: 250px;">
            <div style="text-align: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
              <img src="${avatar}" style="width: 50px; height: 50px; border-radius: 50%; border: 2px solid #fbbf24; margin-bottom: 6px;" alt="Avatar">
              <div style="font-weight: 800; color: #fff; font-size: 0.95rem;">${u.persona_name}</div>
              <div style="font-size: 0.75rem; color: #94a3b8; font-family: monospace;">${u.steam_id}</div>
              <div style="margin-top: 4px;"><span class="rule-badge badge-allow" style="font-size: 0.72rem;">${u.role || 'Thành viên'}</span></div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; padding-top: 4px;">
              <a href="lien-ket-steam.html" class="nav-dropdown-item">🔄 Đổi Tài Khoản Steam</a>
              ${isAdmin ? '<a href="cai-dat.html" class="nav-dropdown-item" style="color: #fbbf24;">👑 Bảng Quản Trị Admin</a>' : ''}
              <a href="javascript:void(0)" onclick="App.logoutUser()" class="nav-dropdown-item" style="color: #ef4444;">🚪 Đăng Xuất</a>
            </div>
          </div>
        </div>
      </div>
    `;

    // Click outside to close popovers
    document.addEventListener('click', (e) => {
      const notifPopover = document.getElementById('hud-notification-popover');
      const profilePopover = document.getElementById('hud-profile-popover');
      if (notifPopover && !e.target.closest('.hud-bell-btn') && !e.target.closest('#hud-notification-popover')) {
        notifPopover.classList.remove('open');
      }
      if (profilePopover && !e.target.closest('.hud-profile-pill') && !e.target.closest('#hud-profile-popover')) {
        profilePopover.classList.remove('open');
      }
    });
  },

  toggleNotificationPopover(e) {
    e.stopPropagation();
    const notifPopover = document.getElementById('hud-notification-popover');
    const profilePopover = document.getElementById('hud-profile-popover');
    if (profilePopover) profilePopover.classList.remove('open');
    if (notifPopover) notifPopover.classList.toggle('open');
  },

  toggleProfilePopover(e) {
    e.stopPropagation();
    const profilePopover = document.getElementById('hud-profile-popover');
    const notifPopover = document.getElementById('hud-notification-popover');
    if (notifPopover) notifPopover.classList.remove('open');
    if (profilePopover) profilePopover.classList.toggle('open');
  },

  // ==========================================
  // ITEM 1: MOBILE BOTTOM NAVIGATION & DRAWER
  // ==========================================
  renderMobileNavigation() {
    if (document.getElementById('mobile-bottom-nav-bar')) return;

    const currentFile = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();

    // 1. Bottom Bar
    const bottomNav = document.createElement('nav');
    bottomNav.id = 'mobile-bottom-nav-bar';
    bottomNav.className = 'mobile-bottom-nav';
    bottomNav.innerHTML = `
      <a href="index.html" class="mobile-bottom-item ${currentFile === 'index.html' ? 'active' : ''}">
        <span class="mob-icon">🏠</span>
        <span>Trang Chủ</span>
      </a>
      <a href="bando.html" class="mobile-bottom-item ${currentFile === 'bando.html' ? 'active' : ''}">
        <span class="mob-icon">🗺️</span>
        <span>Bản Đồ</span>
      </a>
      <a href="nhiem-vu.html" class="mobile-bottom-item ${currentFile === 'nhiem-vu.html' ? 'active' : ''}">
        <span class="mob-icon">🌾</span>
        <span>Kho Lúa</span>
      </a>
      <a href="gara.html" class="mobile-bottom-item ${currentFile === 'gara.html' ? 'active' : ''}">
        <span class="mob-icon">🦖</span>
        <span>Gara</span>
      </a>
      <a href="javascript:void(0)" class="mobile-bottom-item" onclick="App.toggleMobileDrawer()">
        <span class="mob-icon">☰</span>
        <span>Thêm</span>
      </a>
    `;
    document.body.appendChild(bottomNav);

    // 2. Slide Drawer Overlay
    const overlay = document.createElement('div');
    overlay.id = 'mobile-drawer-overlay';
    overlay.className = 'mobile-drawer-overlay';
    overlay.onclick = () => App.toggleMobileDrawer();

    const drawer = document.createElement('div');
    drawer.id = 'mobile-drawer-content';
    drawer.className = 'mobile-drawer-content';
    drawer.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px;">
        <span style="font-weight: 800; color: #fbbf24; font-size: 1.1rem;">🌾 MENU TỔNG HỢP ST25</span>
        <button type="button" onclick="App.toggleMobileDrawer()" style="background: none; border: none; color: #cbd5e1; font-size: 1.5rem; cursor: pointer;">&times;</button>
      </div>

      <div>
        <div style="font-size: 0.78rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">🏕️ Sinh Tồn</div>
        <a href="bando.html" class="nav-dropdown-item">🗺️ Bản Đồ Gateway</a>
        <a href="gara.html" class="nav-dropdown-item">🦖 Gara Khủng Long</a>
        <a href="tha-xac.html" class="nav-dropdown-item">🥩 Thả Xác Cứu Đói</a>
        <a href="skin.html" class="nav-dropdown-item">🎨 Chỉnh Sửa Skin</a>
      </div>

      <div>
        <div style="font-size: 0.78rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">🌾 Kinh Tế & Chợ</div>
        <a href="nhiem-vu.html" class="nav-dropdown-item">🌾 Kho Lúa & Nhiệm Vụ</a>
        <a href="giao-dich.html" class="nav-dropdown-item">⚖️ Chợ Giao Dịch P2P</a>
        <a href="hom-qua.html" class="nav-dropdown-item">🎁 Mở Hòm May Mắn</a>
        <a href="song-bac.html" class="nav-dropdown-item">🎲 Sòng Bạc ST25</a>
      </div>

      <div>
        <div style="font-size: 0.78rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">🛡️ Cộng Đồng</div>
        <a href="bxh.html" class="nav-dropdown-item">🏆 Bảng Xếp Hạng</a>
        <a href="moi-ban.html" class="nav-dropdown-item">👥 Mời Bạn Bè</a>
        <a href="ho-tro.html" class="nav-dropdown-item">🆘 Hỗ Trợ & Ticket</a>
        <a href="noi-quy.html" class="nav-dropdown-item">📜 13 Điều Nội Quy</a>
        <a href="cai-dat.html" class="nav-dropdown-item admin-only" style="${this.user && this.user.isAdmin ? '' : 'display: none;'}">👑 Quản Trị Admin</a>
      </div>

      <div style="margin-top: auto; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1);">
        <a href="https://discord.gg/3xCrA6VyY" target="_blank" class="btn btn-primary" style="width: 100%; text-align: center;">Discord ST25</a>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);
  },

  toggleMobileDrawer() {
    const overlay = document.getElementById('mobile-drawer-overlay');
    const drawer = document.getElementById('mobile-drawer-content');
    if (overlay && drawer) {
      overlay.classList.toggle('open');
      drawer.classList.toggle('open');
    }
  },

  // ==========================================
  // ITEM 3: 3D PERSPECTIVE TILT FOR TCG DINO CARDS
  // ==========================================
  init3DTiltCards() {
    const bindTilt = (el) => {
      if (el.dataset.tiltBound) return;
      el.dataset.tiltBound = 'true';

      el.addEventListener('mousemove', (e) => {
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -7;
        const rotateY = ((x - centerX) / centerX) * 7;

        el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-5px)`;
      });

      el.addEventListener('mouseleave', () => {
        el.style.transform = '';
      });
    };

    document.querySelectorAll('.dino-card-tcg, .slot-card:not(.empty-slot), .dino-preview-card').forEach(bindTilt);

    // Watch for dynamically added dino cards
    const observer = new MutationObserver(() => {
      document.querySelectorAll('.dino-card-tcg, .slot-card:not(.empty-slot), .dino-preview-card').forEach(bindTilt);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  },

  updateUI() {
    const isLoggedIn = !!(this.user && this.user.linked && this.user.steam_id);
    const isAdmin = !!(isLoggedIn && this.user.isAdmin);

    // Ẩn/hiện các phần tử Admin trên toàn bộ website
    document.querySelectorAll('.admin-only, #nav-admin-link-item, #btn-header-admin, #btn-admin-panel-link, #admin-quick-bar').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });
  },

  loginDemoUser() {
    this.user = {
      steam_id: '76561198000000001',
      persona_name: 'DinoHunter_VN',
      avatar: 'https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_full.jpg',
      role: 'Player'
    };
    localStorage.setItem('the_isle_demo_user', JSON.stringify(this.user));
    this.updateUI();
    this.showToast('Đăng nhập Steam thành công (Demo Mode)!', 'success');
    window.location.reload();
  },

  logoutUser() {
    this.user = null;
    localStorage.removeItem('the_isle_demo_user');
    localStorage.removeItem('st25_steam_user');
    fetch('/api/player/logout', { method: 'POST' }).catch(() => {});
    this.updateUI();
    this.showToast('Đã đăng xuất tài khoản.', 'info');
    setTimeout(() => window.location.reload(), 500);
  },

  showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <div>${message}</div>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  bindEvents() {
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.logoutUser();
      });
    }

    const demoLoginBtn = document.getElementById('btn-demo-login');
    if (demoLoginBtn) {
      demoLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.loginDemoUser();
      });
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
