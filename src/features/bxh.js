
    const LeaderboardApp = {
      currentTab: 'survivors',
      data: {
        survivors: [],
        hunters: [],
        wealth: []
      },

      async init() {
        await this.loadData();
      },

      async loadData() {
        try {
          const res = await App.readResponse(ST25API.routes.leaderboard);
          if (res.ok) {
            const json = await res.json();
            const raw = json.categories || json;
            if (raw) {
              this.data = {
                survivors: Array.isArray(raw.survivors) ? raw.survivors.map(s => ({
                  name: s.name,
                  steamId: s.steamId,
                  species: s.species,
                  growth: s.growth != null ? (typeof s.growth === 'number' && s.growth > 1 ? `${s.growth}%` : s.growth) : '100%',
                  survivalHours: s.survivalHours ?? s.hours ?? 0,
                  avatar: s.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${s.steamId || s.name}`
                })) : [],
                hunters: Array.isArray(raw.hunters) ? raw.hunters.map(h => ({
                  name: h.name,
                  steamId: h.steamId,
                  species: h.species,
                  kills: h.kills ?? 0,
                  deaths: h.deaths ?? Math.max(1, Math.round((h.kills || 10) / (h.kdRatio || h.kd || 2))),
                  kd: h.kd ?? h.kdRatio ?? '0.0',
                  killStreak: h.killStreak ?? h.bestPrey ?? `${h.kills || 0} kills`,
                  avatar: h.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${h.steamId || h.name}`
                })) : [],
                wealth: Array.isArray(raw.wealth) ? raw.wealth.map(w => ({
                  name: w.name,
                  steamId: w.steamId,
                  species: w.species,
                  role: w.role || 'Thành viên',
                  luaBalance: w.luaBalance ?? w.balance ?? 0,
                  cratesWon: w.cratesWon ?? Math.floor((w.balance || w.luaBalance || 0) / 1000),
                  avatar: w.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${w.steamId || w.name}`
                })) : []
              };
              this.renderCurrentView();
            }
          }
        } catch (e) {
          console.error(e);
          App.showToast('Không thể nạp dữ liệu Bảng Xếp Hạng!', 'error');
        }
      },

      switchTab(tab) {
        if (this.currentTab === tab) return;
        this.currentTab = tab;
        ['survivors', 'hunters', 'wealth'].forEach(t => {
          const btn = document.getElementById(`tab-${t}`);
          if (btn) {
            if (t === tab) btn.classList.add('active');
            else btn.classList.remove('active');
          }
        });
        this.renderCurrentView();
        window.ST25Motion?.enter('#podium-container, .table-container');
      },

      renderCurrentView() {
        const list = this.data[this.currentTab] || [];
        this.renderPodium(list);
        this.renderTable(list);
      },

      renderPodium(list) {
        const pod = document.getElementById('podium-container');
        if (!pod) return;

        const getStatText = (item) => {
          if (this.currentTab === 'survivors') return `${App.escapeHTML(String(item.survivalHours ?? ""))} giờ`;
          if (this.currentTab === 'hunters') return `${App.escapeHTML(String(item.kills ?? ""))} mạng (K/D ${App.escapeHTML(String(item.kd ?? ""))})`;
          if (this.currentTab === 'wealth') return `${item.luaBalance?.toLocaleString('vi-VN')} Lúa 🌾`;
          return '';
        };

        const escape = value => App.escapeHTML(String(value ?? ''));
        pod.innerHTML = [0, 1, 2].map(index => {
          const item = list[index], rank = index + 1;
          const position = ['first', 'second', 'third'][index];
          if (!item) return `<article class="podium-card ${position} podium-card--empty" aria-label="Top ${rank}: chưa có người chơi">
            <span class="podium-place">TOP ${rank}</span>
            <div class="podium-art podium-art--missing"><span>Chưa có người chơi</span></div>
            <div class="podium-caption"><div class="podium-name">Đang chờ huyền thoại</div><div class="podium-sub">Chưa có dữ liệu xếp hạng</div></div>
          </article>`;
          const portrait = this.dinosaurPortrait(item.species);
          const image = portrait?.src;
          const species = item.species || 'Chưa xác định loài';
          return `<article class="podium-card ${position}" aria-label="Top ${rank}: ${escape(item.name)}">
            <span class="podium-place">${rank === 1 ? '♛ ' : ''}TOP ${rank}</span>
            <div class="podium-score">${escape(getStatText(item))}</div>
            <div class="podium-art${image ? '' : ' podium-art--missing'}">${image
              ? `<svg class="podium-dinosaur" viewBox="${portrait.box.join(' ')}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Đầu và cổ ${escape(species)} của ${escape(item.name)}">
                  <defs><clipPath id="podium-crop-${rank}"><rect x="${portrait.box[0]}" y="${portrait.box[1]}" width="${portrait.box[2]}" height="${portrait.box[3]}"/></clipPath></defs>
                  <image href="${image}" width="${portrait.width}" height="${portrait.height}" clip-path="url(#podium-crop-${rank})"/>
                </svg>`
              : '<span>Chưa có ảnh loài khủng long</span>'}</div>
            <div class="podium-caption">
              <div class="podium-name" title="${escape(item.name)}">${escape(item.name)}</div>
              <div class="podium-sub">${escape(species)}</div>
              <div class="podium-stat">${escape(getStatText(item))}</div>
            </div>
          </article>`;
        }).join('');
        pod.querySelectorAll('.podium-dinosaur image').forEach(image => image.addEventListener('error', () => {
          const art = image.closest('.podium-art');
          art.classList.add('podium-art--missing');
          art.textContent = 'Chưa có ảnh loài khủng long';
        }, { once: true }));
      },

      dinosaurImage(species) {
        const catalog = ['Allosaurus', 'Austroraptor', 'Beipiaosaurus', 'Carnotaurus',
          'Ceratosaurus', 'Deinosuchus', 'Diabloceratops', 'Dilophosaurus', 'Dryosaurus',
          'Gallimimus', 'Herrerasaurus', 'Hypsilophodon', 'Kentrosaurus', 'Maiasaura',
          'Omniraptor', 'Pachycephalosaurus', 'Pteranodon', 'Stegosaurus', 'Tenontosaurus',
          'Triceratops', 'troodon', 'Tyrannosaurus'];
        let key = String(species || '').toLowerCase().replace(/^bp_/, '').replace(/_c$/, '').replace(/[^a-z]/g, '');
        if (key === 'trex' || key === 'tyrannosaurusrex') key = 'tyrannosaurus';
        if (key === 'utahraptor') key = 'omniraptor';
        const filename = catalog.find(name => name.toLowerCase() === key);
        return filename ? `assets/imges/${filename}.png` : null;
      },

      dinosaurPortrait(species) {
        const src = this.dinosaurImage(species);
        if (!src) return null;
        // Source dimensions and neck/head crop, normalized per species and facing direction.
        const crops = {
          Allosaurus: [1181, 694, 0, 0, .30, .48],
          Austroraptor: [1114, 486, 0, .02, .36, .55],
          Beipiaosaurus: [1102, 745, 0, 0, .30, .52],
          Carnotaurus: [1167, 694, .70, 0, .30, .50],
          Ceratosaurus: [1191, 567, 0, 0, .29, .47],
          Deinosuchus: [1214, 314, 0, 0, .33, .75],
          Diabloceratops: [1173, 722, 0, 0, .45, .60],
          Dilophosaurus: [1112, 697, .72, 0, .28, .48],
          Dryosaurus: [1111, 654, .74, 0, .26, .46],
          Gallimimus: [1113, 760, .72, 0, .28, .53],
          Herrerasaurus: [1173, 666, 0, 0, .33, .52],
          Hypsilophodon: [1122, 657, .72, 0, .28, .44],
          Kentrosaurus: [1264, 848, .02, .25, .38, .42],
          Maiasaura: [1166, 585, 0, 0, .30, .46],
          Omniraptor: [1114, 700, 0, 0, .30, .45],
          Pachycephalosaurus: [1116, 698, .02, 0, .30, .44],
          Pteranodon: [943, 752, .30, 0, .70, .62],
          Stegosaurus: [1152, 684, 0, .25, .33, .46],
          Tenontosaurus: [1189, 630, .74, 0, .26, .52],
          Triceratops: [1211, 658, 0, 0, .50, .66],
          troodon: [1033, 722, 0, 0, .32, .46],
          Tyrannosaurus: [1168, 712, 0, 0, .30, .44]
        };
        const name = src.split('/').pop().replace('.png', '');
        const crop = crops[name];
        if (!crop) return null;
        const [width, height, x, y, w, h] = crop;
        return { src, width, height, box: [x * width, y * height, w * width, h * height].map(Math.round) };
      },

      renderTable(list) {
        const thead = document.getElementById('bxh-table-thead');
        const tbody = document.getElementById('bxh-table-tbody');
        if (!thead || !tbody) return;

        if (this.currentTab === 'survivors') {
          thead.innerHTML = `
            <tr>
              <th style="width: 60px;">Hạng</th>
              <th>Người Chơi</th>
              <th>Loài Khủng Long</th>
              <th>Độ Tăng Trưởng</th>
              <th>Thời Gian Sống</th>
              <th>Trạng Thái</th>
            </tr>
          `;
        } else if (this.currentTab === 'hunters') {
          thead.innerHTML = `
            <tr>
              <th style="width: 60px;">Hạng</th>
              <th>Thợ Săn</th>
              <th>Loài Ưa Thích</th>
              <th>Hạ Gục (Kills)</th>
              <th>Bị Hạ (Deaths)</th>
              <th>Chỉ Số K/D</th>
            </tr>
          `;
        } else {
          thead.innerHTML = `
            <tr>
              <th style="width: 60px;">Hạng</th>
              <th>Đại Gia ST25</th>
              <th>Vai Trò (Role)</th>
              <th>Kho Lúa Tích Lũy</th>
              <th>Số Lần Thắng Hòm</th>
              <th>Steam ID</th>
            </tr>
          `;
        }

        const tableList = list.slice(3); // Rank #4 trở đi
        if (!tableList.length) {
          tbody.innerHTML = `
            <tr>
              <td colspan="6" style="text-align: center; padding: 30px; color: #64748b;">
                Chưa có thêm thứ hạng nào khác.
              </td>
            </tr>
          `;
          return;
        }

        tbody.innerHTML = tableList.map((item, idx) => {
          const rankNum = idx + 4;
          const rankCls = rankNum === 4 ? 'top4' : (rankNum === 5 ? 'top5' : '');

          if (this.currentTab === 'survivors') {
            return `
              <tr>
                <td><span class="rank-number ${rankCls}">#${rankNum}</span></td>
                <td>
                  <strong style="color: #fff;">${App.escapeHTML(item.name)}</strong><br>
                  <small style="color: #64748b; font-family: monospace;">${App.escapeHTML(String(item.steamId ?? ""))}</small>
                </td>
                <td><span style="color: #fbbf24; font-weight: 700;">${App.escapeHTML(String(item.species ?? ""))}</span></td>
                <td><span style="color: #38bdf8; font-weight: 700;">${App.escapeHTML(String(item.growth ?? ""))}</span></td>
                <td><strong style="color: #10b981; font-size: 1.05rem;">${App.escapeHTML(String(item.survivalHours ?? ""))} giờ</strong></td>
                <td><span style="background: rgba(16, 185, 129, 0.15); color: #6ee7b7; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; border: 1px solid #10b981;">Còn Sống</span></td>
              </tr>
            `;
          } else if (this.currentTab === 'hunters') {
            return `
              <tr>
                <td><span class="rank-number ${rankCls}">#${rankNum}</span></td>
                <td>
                  <strong style="color: #fff;">${App.escapeHTML(item.name)}</strong><br>
                  <small style="color: #64748b; font-family: monospace;">${App.escapeHTML(String(item.steamId ?? ""))}</small>
                </td>
                <td><span style="color: #fbbf24; font-weight: 700;">${App.escapeHTML(String(item.species ?? ""))}</span></td>
                <td><strong style="color: #ef4444; font-size: 1.05rem;">${App.escapeHTML(String(item.kills ?? ""))}</strong></td>
                <td><span style="color: #94a3b8;">${App.escapeHTML(String(item.deaths ?? ""))}</span></td>
                <td><strong style="color: #fbbf24; font-size: 1.05rem;">${App.escapeHTML(String(item.kd ?? ""))}</strong></td>
              </tr>
            `;
          } else {
            return `
              <tr>
                <td><span class="rank-number ${rankCls}">#${rankNum}</span></td>
                <td>
                  <strong style="color: #fff;">${App.escapeHTML(item.name)}</strong>
                </td>
                <td><span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; padding: 3px 8px; border-radius: 4px; font-size: 0.8rem; border: 1px solid #fbbf24;">${item.role || 'Thành viên'}</span></td>
                <td><strong style="color: #fbbf24; font-size: 1.15rem;">${item.luaBalance?.toLocaleString('vi-VN')} 🌾</strong></td>
                <td><span style="color: #38bdf8;">${item.cratesWon || 0} lần</span></td>
                <td><code style="color: #64748b;">${App.escapeHTML(String(item.steamId ?? ""))}</code></td>
              </tr>
            `;
          }
        }).join('');
      }
    };

    document.addEventListener('DOMContentLoaded', () => LeaderboardApp.init());
  
