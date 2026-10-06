// Core App Script
const App = {
  user: null,
  config: null,

  async init() {
    this.bindEvents();
    await this.loadConfig();
    await this.checkAuth();
    this.updateUI();
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
        this.user = await res.json();
      }
    } catch (e) {
      // Local storage fallback for standalone demo
      const savedUser = localStorage.getItem('the_isle_demo_user');
      if (savedUser) {
        this.user = JSON.parse(savedUser);
      }
    }
  },

  updateServerStatusBadge() {
    const el = document.getElementById('server-player-count');
    if (el && this.config) {
      el.textContent = `${this.config.online_players || 42} / ${this.config.max_players || 100} người chơi`;
    }
  },

  updateUI() {
    const steamBtn = document.getElementById('btn-steam-auth');
    const userBadge = document.getElementById('user-badge');
    const userName = document.getElementById('user-display-name');

    if (this.user) {
      if (steamBtn) steamBtn.style.display = 'none';
      if (userBadge) {
        userBadge.style.display = 'flex';
        if (userName) userName.textContent = this.user.persona_name || this.user.name || 'Người chơi';
      }
    } else {
      if (steamBtn) steamBtn.style.display = 'inline-flex';
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
