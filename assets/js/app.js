// Core App Script
const App = {
  user: null,
  config: null,

  async init() {
    this.bindEvents();
    await this.loadConfig();
    await this.loadEnvironment();
    await this.checkAuth();
    this.updateUI();

    // Tự động làm mới thời tiết & ngày/đêm mỗi 30s
    setInterval(() => this.loadEnvironment(), 30000);
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

    // 1. Cập nhật hoặc tạo pill trên site-header
    let headerPill = document.getElementById('live-weather-header-pill');
    if (!headerPill) {
      const headerContainer = document.querySelector('.site-header .header-container') || document.querySelector('.site-header .container');
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
          localStorage.setItem('st25_steam_user', JSON.stringify({
            steam_id: u.steam_id,
            persona_name: u.persona_name,
            avatar: u.avatar,
            isAdmin: !!u.isAdmin
          }));
        } else {
          this.user = null;
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

  updateServerStatusBadge() {
    const el = document.getElementById('server-player-count');
    if (el && this.config) {
      el.textContent = `${this.config.online_players || 42} / ${this.config.max_players || 100} người chơi`;
    }
  },

  updateUI() {
    const steamBtn = document.getElementById('btn-steam-auth') || document.getElementById('nav-btn-steam');
    const userBadge = document.getElementById('user-badge');
    const userName = document.getElementById('user-display-name');

    const isLoggedIn = !!(this.user && this.user.linked && this.user.steam_id);
    const isAdmin = !!(isLoggedIn && this.user.isAdmin);

    // Ẩn/hiện các phần tử Admin trên toàn bộ website
    document.querySelectorAll('.admin-only, #nav-admin-link-item, #btn-header-admin, #btn-admin-panel-link, #admin-quick-bar').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });

    if (isLoggedIn) {
      if (steamBtn) {
        steamBtn.textContent = 'Đổi Steam';
        steamBtn.href = 'lien-ket-steam.html';
      }
      if (userBadge) {
        userBadge.style.display = 'flex';
        if (userName) userName.textContent = this.user.persona_name || this.user.name || 'Người chơi';
      }
    } else {
      if (steamBtn) {
        steamBtn.textContent = '🎮 Đăng Nhập Steam';
        steamBtn.href = '/api/player/steam/login';
      }
      if (userBadge) userBadge.style.display = 'none';
    }
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
