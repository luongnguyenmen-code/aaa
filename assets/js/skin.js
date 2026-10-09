// ST25 skin editor: cached separately from page markup.
let myLiveBalance = 0;
    let currentSpecies = "Tyrannosaurus";
    let isUserOnlineInGame = false;
    let currentGender = "female"; // 'female' or 'male'
    let currentMode = "std"; // 'std' or 'glitch'
    let currentGrowth = 100;
    let skinLoadRequest = null;
    let skinMutationBusy = false;

    // 10 Kênh Màu chuẩn Evrima & IslePilot
    const CHANNELS = [
      { id: 'body', label: 'Thân', defaultColor: '#897559', desc: 'Màu nền thân chính' },
      { id: 'markings', label: 'Hoa văn', defaultColor: '#352f2a', desc: 'Vằn sọc hoa văn lưng' },
      { id: 'flank', label: 'Hông', defaultColor: '#594a35', desc: 'Sườn hông và mảng tối' },
      { id: 'underbelly', label: 'Bụng dưới', defaultColor: '#d3b48b', desc: 'Hàm dưới, ngực & bụng' },
      { id: 'detail1', label: 'Chi tiết', defaultColor: '#000000', desc: 'Đốm vảy và gờ sọ' },
      { id: 'male_display', label: 'Display', defaultColor: '#6c3729', desc: 'Mào sừng và sắc tố đực' },
      { id: 'eyes', label: 'Mắt', defaultColor: '#ffdfcb', desc: 'Màu mắt và tròng mắt' },
      { id: 'teeth', label: 'Răng', defaultColor: '#e8e2d0', desc: 'Răng nanh săn mồi' },
      { id: 'mouth', label: 'Miệng', defaultColor: '#7a3b3b', desc: 'Vòm miệng và nướu' },
      { id: 'claws', label: 'Móng vuốt', defaultColor: '#3a3a3a', desc: 'Móng vuốt tay chân' }
    ];

    // State hiện tại của 10 màu
    let currentColors = {};
    CHANNELS.forEach(c => { currentColors[c.id] = c.defaultColor; });

    // Trạng thái khóa (locked) khi xáo trộn ngẫu nhiên
    let lockedChannels = {};
    CHANNELS.forEach(c => { lockedChannels[c.id] = false; });

    // Bảng Presets phối sẵn
    const BUILTIN_PRESETS = {
      default_evrima: {
        name: "🦖 Mặc Định Evrima",
        colors: { body: "#897559", markings: "#352f2a", flank: "#594a35", underbelly: "#d3b48b", detail1: "#000000", male_display: "#6c3729", eyes: "#ffdfcb", teeth: "#e8e2d0", mouth: "#7a3b3b", claws: "#3a3a3a" }
      },
      golden_rice: {
        name: "🌾 Hoàng Kim ST25",
        colors: { body: "#2d261e", markings: "#fbbf24", flank: "#78581f", underbelly: "#fef3c7", detail1: "#d97706", male_display: "#f59e0b", eyes: "#ef4444", teeth: "#fffbeb", mouth: "#991b1b", claws: "#292524" }
      },
      shadow: {
        name: "🌑 Hắc Long Bóng Đêm",
        colors: { body: "#090d16", markings: "#1e293b", flank: "#334155", underbelly: "#475569", detail1: "#0284c7", male_display: "#38bdf8", eyes: "#00f0ff", teeth: "#e2e8f0", mouth: "#881337", claws: "#020617" }
      },
      jungle: {
        name: "🌿 Rừng Dừa Xanh Mướt",
        colors: { body: "#14532d", markings: "#84cc16", flank: "#166534", underbelly: "#dcfce7", detail1: "#15803d", male_display: "#eab308", eyes: "#facc15", teeth: "#f0fdf4", mouth: "#991b1b", claws: "#1c1917" }
      },
      volcano: {
        name: "🌋 Nham Thạch Núi Lửa",
        colors: { body: "#450a0a", markings: "#ea580c", flank: "#7f1d1d", underbelly: "#fed7aa", detail1: "#991b1b", male_display: "#f97316", eyes: "#facc15", teeth: "#fff7ed", mouth: "#7f1d1d", claws: "#18181b" }
      },
      albino: {
        name: "❄️ Bạch Tạng Albino Hiếm",
        colors: { body: "#f8fafc", markings: "#cbd5e1", flank: "#e2e8f0", underbelly: "#ffffff", detail1: "#f472b6", male_display: "#fb7185", eyes: "#ec4899", teeth: "#ffffff", mouth: "#fda4af", claws: "#94a3b8" }
      }
    };

    function renderColorChannels() {
      const container = document.getElementById('color-channels-list');
      if (!container) return;

      container.innerHTML = CHANNELS.map(ch => {
        const col = currentColors[ch.id] || ch.defaultColor;
        const isLocked = !!lockedChannels[ch.id];
        return `
          <div class="color-channel-row" id="row-${ch.id}">
            <div class="color-swatch-box" style="background-color: ${col};" id="swatch-${ch.id}" title="Bấm để chọn màu trực quan">
              <input type="color" value="${col}" id="picker-${ch.id}" oninput="onColorPickerChange('${ch.id}', this.value)">
            </div>
            <span class="color-channel-label">${ch.label}</span>
            <input type="text" class="color-hex-input" id="hex-${ch.id}" value="${col.toUpperCase()}" onchange="onHexInputChange('${ch.id}', this.value)" maxlength="7" spellcheck="false">
            <button type="button" class="btn-icon-sm ${isLocked ? 'locked' : ''}" id="lock-${ch.id}" onclick="toggleLockChannel('${ch.id}')" title="${isLocked ? 'Đang khóa (không bị xáo trộn)' : 'Khóa màu này'}">
              ${isLocked ? '🔒' : '🔓'}
            </button>
            <button type="button" class="btn-icon-sm" onclick="resetSingleChannel('${ch.id}')" title="Khôi phục mặc định">
              🔄
            </button>
          </div>
        `;
      }).join('');
    }

    function onColorPickerChange(id, hexVal) {
      currentColors[id] = hexVal.toLowerCase();
      const hexInp = document.getElementById(`hex-${id}`);
      if (hexInp) hexInp.value = hexVal.toUpperCase();
      const swatch = document.getElementById(`swatch-${id}`);
      if (swatch) swatch.style.backgroundColor = hexVal;
      updateDinoPreview();
    }

    function onHexInputChange(id, val) {
      let clean = val.trim();
      if (!clean.startsWith('#')) clean = '#' + clean;
      if (!/^#[0-9a-fA-F]{6}$/.test(clean)) {
        App.showToast('Mã màu Hex không hợp lệ! (Ví dụ: #897559)', 'error');
        const hexInp = document.getElementById(`hex-${id}`);
        if (hexInp) hexInp.value = currentColors[id].toUpperCase();
        return;
      }
      currentColors[id] = clean.toLowerCase();
      const picker = document.getElementById(`picker-${id}`);
      if (picker) picker.value = clean;
      const swatch = document.getElementById(`swatch-${id}`);
      if (swatch) swatch.style.backgroundColor = clean;
      updateDinoPreview();
    }

    function toggleLockChannel(id) {
      lockedChannels[id] = !lockedChannels[id];
      const btn = document.getElementById(`lock-${id}`);
      if (btn) {
        btn.innerHTML = lockedChannels[id] ? '🔒' : '🔓';
        btn.classList.toggle('locked', lockedChannels[id]);
        btn.title = lockedChannels[id] ? 'Đang khóa (không bị xáo trộn)' : 'Khóa màu này';
      }
    }

    function resetSingleChannel(id) {
      const ch = CHANNELS.find(c => c.id === id);
      if (!ch) return;
      onColorPickerChange(id, ch.defaultColor);
    }

    function resetAllColors() {
      CHANNELS.forEach(ch => {
        currentColors[ch.id] = ch.defaultColor;
      });
      renderColorChannels();
      updateDinoPreview();
      App.showToast('Đã khôi phục toàn bộ 10 màu về mặc định!', 'info');
    }

    function randomizeColors() {
      const PALETTES = [
        ['#2c241d', '#5c3a21', '#8b5a2b', '#c49a6c', '#1b1b1b', '#d97706', '#f59e0b', '#ffffff', '#831843', '#1c1917'],
        ['#1f2937', '#374151', '#4b5563', '#9ca3af', '#111827', '#0284c7', '#38bdf8', '#e5e7eb', '#991b1b', '#030712'],
        ['#14532d', '#166534', '#15803d', '#86efac', '#052e16', '#eab308', '#facc15', '#f0fdf4', '#7f1d1d', '#1c1917'],
        ['#3f1d38', '#5b2149', '#831843', '#fbcfe8', '#1e1b4b', '#db2777', '#f43f5e', '#fff1f2', '#881337', '#171717'],
        ['#451a03', '#78350f', '#92400e', '#fef3c7', '#000000', '#ea580c', '#fb923c', '#ffffff', '#991b1b', '#262626']
      ];
      const chosen = PALETTES[Math.floor(Math.random() * PALETTES.length)];
      CHANNELS.forEach((ch, idx) => {
        if (!lockedChannels[ch.id]) {
          currentColors[ch.id] = chosen[idx % chosen.length];
        }
      });
      renderColorChannels();
      updateDinoPreview();
      App.showToast('Đã xáo trộn màu sắc ngẫu nhiên!', 'success');
    }

    function updateDinoPreview() {
      window.ST25SkinUI?.syncPresets();
      window.ST25Skin3D?.sync();
      refreshSkinCode();
      const bodyEl = document.getElementById('svg-body');
      const bodyLegEl = document.getElementById('svg-body-leg');
      const bodyArmEl = document.getElementById('svg-body-arm');
      const flankEl = document.getElementById('svg-flank');
      const bellyEl = document.getElementById('svg-belly');
      const patternEl = document.getElementById('svg-pattern');
      const detailEl = document.getElementById('svg-detail');
      const displayEl = document.getElementById('svg-display');
      const mouthEl = document.getElementById('svg-mouth');
      const teethEl = document.getElementById('svg-teeth');
      const eyeEl = document.getElementById('svg-eye');
      const clawsEl = document.getElementById('svg-claws');

      if (bodyEl) bodyEl.setAttribute('fill', currentColors.body);
      if (bodyLegEl) bodyLegEl.setAttribute('fill', currentColors.body);
      if (bodyArmEl) bodyArmEl.setAttribute('fill', currentColors.body);
      if (flankEl) flankEl.setAttribute('fill', currentColors.flank);
      if (bellyEl) bellyEl.setAttribute('fill', currentColors.underbelly);
      if (patternEl) patternEl.setAttribute('stroke', currentColors.markings);
      if (detailEl) detailEl.setAttribute('fill', currentColors.detail1);
      if (displayEl) {
        displayEl.setAttribute('fill', currentColors.male_display);
        displayEl.style.opacity = currentGender === 'male' ? '1.0' : '0.35';
      }
      if (mouthEl) mouthEl.setAttribute('fill', currentColors.mouth);
      if (teethEl) {
        teethEl.setAttribute('fill', currentColors.teeth);
        teethEl.setAttribute('stroke', currentColors.teeth);
      }
      if (eyeEl) eyeEl.setAttribute('fill', currentColors.eyes);
      if (clawsEl) clawsEl.setAttribute('fill', currentColors.claws);

      const svgEl = document.getElementById('dino-svg');
      if (svgEl) {
        svgEl.style.filter = currentMode === 'glitch' 
          ? 'drop-shadow(0 0 18px rgba(0,240,255,0.75)) hue-rotate(90deg)'
          : 'drop-shadow(0 15px 30px rgba(0, 0, 0, 0.6))';
      }
    }

    function updateGrowth(val) {
      currentGrowth = Math.min(100, Math.max(10, Number(val) || 100));
      window.ST25Skin3D?.sync();
      const growthValEl = document.getElementById('growth-val');
      if (growthValEl) growthValEl.textContent = `${currentGrowth}%`;

      const wrapper = document.getElementById('dino-svg-wrapper');
      if (wrapper) {
        const scale = 0.55 + 0.45 * (currentGrowth / 100);
        wrapper.style.transform = `scale(${scale})`;
      }
    }

    function setGender(gender) {
      currentGender = gender;
      document.getElementById('btn-gender-female')?.classList.toggle('active', gender === 'female');
      document.getElementById('btn-gender-male')?.classList.toggle('active', gender === 'male');
      updateDinoPreview();
    }

    function setSkinMode(mode) {
      currentMode = mode;
      document.getElementById('btn-mode-std')?.classList.toggle('active', mode === 'std');
      document.getElementById('btn-mode-glitch')?.classList.toggle('active', mode === 'glitch');
      updateDinoPreview();
    }

    function changePreviewBg(bgKey) {
      const box = document.getElementById('skin-preview-box');
      if (!box) return;
      box.className = `preview-box scene-${bgKey}`;
    }

    function changeSpecies(name) {
      currentSpecies = name;
      const select = document.getElementById('dino-species-select');
      if (select) select.value = name;
      const badge = document.getElementById('selected-species-badge');
      if (badge) badge.textContent = name;
      window.ST25SkinUI?.syncSpecies();
      window.ST25Skin3D?.sync();
      refreshSkinCode();
    }

    function refreshSkinCode() {
      const box = document.getElementById('export-box');
      if (box && box.style.display !== 'none') document.getElementById('skin-code-output').value = generateEvrimaCode();
    }

    function applyPreset(presetKey) {
      const p = BUILTIN_PRESETS[presetKey];
      if (!p) return;

      Object.keys(p.colors).forEach(k => {
        if (currentColors[k] !== undefined) {
          currentColors[k] = p.colors[k];
        }
      });
      renderColorChannels();
      updateDinoPreview();
      App.showToast(`Đã áp dụng mẫu [${App.escapeHTML(p.name)}]!`, 'success');
    }

    function getSkinPayload() {
      const variation = parseInt(document.getElementById('skin-variation')?.value) || 0;
      const pattern = parseInt(document.getElementById('skin-pattern-idx')?.value) || 0;
      const theme = parseInt(document.getElementById('skin-theme')?.value) || 0;
      const cleanSpecies = currentSpecies.replace(/[^a-zA-Z0-9]+/g, "");

      return {
        class: `BP_${cleanSpecies}_C`,
        species: currentSpecies,
        female: currentGender === 'female',
        variation: variation,
        pattern: pattern,
        theme: theme,
        growth: currentGrowth / 100,
        colors: { ...currentColors }
      };
    }

    function copySkinJson() {
      const payload = getSkinPayload();
      const jsonStr = JSON.stringify(payload, null, 2);
      navigator.clipboard.writeText(jsonStr).then(() => {
        App.showToast('Đã sao chép cấu hình JSON bảng màu vào bộ nhớ tạm!', 'success');
      }).catch(() => {
        App.showToast('Không thể sao chép JSON!', 'error');
      });
    }

    function downloadSkinJson() {
      const payload = getSkinPayload();
      const jsonStr = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `st25_skin_${currentSpecies}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      App.showToast('Đã tải xuống file JSON Skin!', 'success');
    }

    function generateEvrimaCode() {
      const p = getSkinPayload();
      const c = p.colors;
      return `[${p.species}_Skin_v2:Body=${c.body.replace('#','')}:Markings=${c.markings.replace('#','')}:Flank=${c.flank.replace('#','')}:Underbelly=${c.underbelly.replace('#','')}:Detail=${c.detail1.replace('#','')}:Display=${c.male_display.replace('#','')}:Eyes=${c.eyes.replace('#','')}:Teeth=${c.teeth.replace('#','')}:Mouth=${c.mouth.replace('#','')}:Claws=${c.claws.replace('#','')}:Gender=${p.female ? 'F':'M'}:Var=${p.variation}:Pat=${p.pattern}]`;
    }

    function exportSkinCode() {
      const code = generateEvrimaCode();
      const outBox = document.getElementById('export-box');
      const outText = document.getElementById('skin-code-output');
      if (outText) outText.value = code;
      if (outBox) {
        outBox.style.display = 'block';
        outBox.scrollIntoView({ behavior: 'smooth' });
      }
      App.showToast('Đã xuất mã Skin Evrima! Hãy sao chép để dán vào game.', 'success');
    }

    function copySkinCode() {
      const text = document.getElementById('skin-code-output')?.value;
      if (!text) return;
      Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => {
        App.showToast('Đã sao chép mã Skin vào bộ nhớ tạm!', 'success');
        const btn = document.getElementById('btn-copy-skin');
        if (btn) {
          btn.textContent = '✅ Đã Sao Chép!';
          setTimeout(() => btn.textContent = '📑 Sao Chép 1-Click', 2000);
        }
      }).catch(() => App.showToast('Không thể sao chép mã skin. Hãy chọn và sao chép mã thủ công.', 'error'));
    }

    function parseAndApplySkinInput(inputStr) {
      if (!inputStr || !inputStr.trim()) return false;
      const str = inputStr.trim();

      // 1. JSON
      if (str.startsWith('{') && str.endsWith('}')) {
        try {
          const data = JSON.parse(str);
          if (!data.colors || typeof data.colors !== 'object' || !CHANNELS.some(c => data.colors[c.id])) throw new Error('Missing colors');
          if (CHANNELS.some(c => data.colors[c.id] !== undefined && !/^#[0-9a-f]{6}$/i.test(data.colors[c.id]))) throw new Error('Invalid colors');
          if (data.species && ![...document.getElementById('dino-species-select').options].some(o => o.value === data.species)) throw new Error('Invalid species');
          if (data.colors) {
            Object.keys(data.colors).forEach(k => {
              let val = data.colors[k];
              if (typeof val === 'string' && val.startsWith('#')) {
                if (currentColors[k] !== undefined) currentColors[k] = val.toLowerCase();
              }
            });
          }
          if (data.species) {
            const sel = document.getElementById('dino-species-select');
            if (sel) sel.value = data.species;
            changeSpecies(data.species);
          }
          if (data.female !== undefined) setGender(data.female ? 'female' : 'male');
          if (data.variation !== undefined) document.getElementById('skin-variation').value = data.variation;
          if (data.pattern !== undefined) document.getElementById('skin-pattern-idx').value = data.pattern;
          if (data.theme !== undefined) document.getElementById('skin-theme').value = data.theme;
          if (data.growth !== undefined) {
            const gVal = Math.round(data.growth * 100);
            document.getElementById('growth-slider').value = gVal;
            updateGrowth(gVal);
          }
          renderColorChannels();
          updateDinoPreview();
          App.showToast('Đã nạp thành công cấu hình Skin từ JSON!', 'success');
          return true;
        } catch (_) {
          App.showToast('JSON skin không hợp lệ. Màu phải có dạng #RRGGBB và loài phải nằm trong danh sách.', 'error');
          return false;
        }
      }

      // 2. Chuỗi mã Evrima [Species_Skin_v2:Body=...:...]
      if (str.includes(':') && (str.includes('=') || str.includes('Body='))) {
        const parts = str.replace(/[\[\]]/g, '').split(':');
        const colorKeys = /^(body|b|markings|pattern|p|flank|underbelly|belly|u|detail|detail1|display|eyes|eye|e|teeth|mouth|claws)$/i;
        const colorParts = parts.filter(part => colorKeys.test(part.split('=')[0]?.trim()));
        if (!colorParts.length || colorParts.some(part => !/^#?[0-9a-f]{6}$/i.test(part.split('=')[1]?.trim() || ''))) {
          App.showToast('Mã skin chứa màu không hợp lệ.', 'error');
          return false;
        }
        const species = parts[0].replace(/_Skin_v2$/i, '');
        if ([...document.getElementById('dino-species-select').options].some(o => o.value === species)) changeSpecies(species);
        parts.forEach(part => {
          const [k, v] = part.split('=');
          if (!k || !v) return;
          const key = k.trim().toLowerCase();
          const hex = (v.trim().startsWith('#') ? v.trim() : '#' + v.trim()).toLowerCase();
          if (key === 'body' || key === 'b') currentColors.body = hex;
          if (key === 'markings' || key === 'pattern' || key === 'p') currentColors.markings = hex;
          if (key === 'flank') currentColors.flank = hex;
          if (key === 'underbelly' || key === 'belly' || key === 'u') currentColors.underbelly = hex;
          if (key === 'detail' || key === 'detail1') currentColors.detail1 = hex;
          if (key === 'display') currentColors.male_display = hex;
          if (key === 'eyes' || key === 'eye' || key === 'e') currentColors.eyes = hex;
          if (key === 'teeth') currentColors.teeth = hex;
          if (key === 'mouth') currentColors.mouth = hex;
          if (key === 'claws') currentColors.claws = hex;
          if (key === 'gender') setGender(v.trim().toUpperCase() === 'F' ? 'female' : 'male');
          if (key === 'var') document.getElementById('skin-variation').value = parseInt(v) || 0;
          if (key === 'pat') document.getElementById('skin-pattern-idx').value = parseInt(v) || 0;
        });
        renderColorChannels();
        updateDinoPreview();
        App.showToast('Đã nạp mã Skin Evrima thành công!', 'success');
        return true;
      }

      App.showToast('Mã skin không đúng định dạng JSON hoặc Evrima Code!', 'error');
      return false;
    }

    async function pasteSkinCodeFromClipboard() {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          parseAndApplySkinInput(text);
        } else {
          promptImportCustomCode();
        }
      } catch (_) {
        promptImportCustomCode();
      }
    }

    function promptImportCustomCode() {
      const code = prompt('Dán chuỗi mã Skin hoặc JSON The Isle vào đây:');
      if (code) {
        parseAndApplySkinInput(code);
      }
    }

    function importSkinJson() {
      promptImportCustomCode();
    }

    // Quản lý Presets tùy chỉnh đã lưu trong localStorage
    function readSavedSkinPresets() {
      try {
        const saved = JSON.parse(localStorage.getItem('st25_user_skin_presets') || '[]');
        return Array.isArray(saved) ? saved.filter(p => p && typeof p.name === 'string' && p.colors && CHANNELS.every(c => /^#[0-9a-f]{6}$/i.test(p.colors[c.id]))) : [];
      } catch (_) { return []; }
    }

    function writeSavedSkinPresets(saved) {
      try { localStorage.setItem('st25_user_skin_presets', JSON.stringify(saved)); return true; }
      catch (_) { App.showToast('Không thể lưu preset. Bộ nhớ trình duyệt bị chặn hoặc đã đầy.', 'error'); return false; }
    }

    function loadSavedPresets() {
      const listEl = document.getElementById('saved-presets-list');
      if (!listEl) return;

      const saved = readSavedSkinPresets();

      // Render cả builtin pills + saved
      let html = '';
      Object.keys(BUILTIN_PRESETS).forEach(key => {
        const p = BUILTIN_PRESETS[key];
        html += `<span class="preset-pill" onclick="applyPreset('${key}')">${App.escapeHTML(p.name)}</span>`;
      });

      saved.forEach((item, index) => {
        html += `
          <span class="preset-pill" style="border-color: #10b981; color: #34d399;" onclick="applyCustomSavedPreset(${index})">
            ⭐ ${App.escapeHTML(item.name)}
            <small onclick="event.stopPropagation(); deleteCustomPreset(${index})" style="margin-left: 6px; color: #ef4444; font-weight: bold; cursor: pointer;">&times;</small>
          </span>
        `;
      });

      listEl.innerHTML = html;
    }

    function saveCurrentPreset() {
      const inp = document.getElementById('preset-save-name');
      const name = (inp ? inp.value.trim() : '') || `${currentSpecies} #${Date.now().toString().slice(-4)}`;

      const saved = readSavedSkinPresets();

      saved.push({
        name: name,
        species: currentSpecies,
        colors: { ...currentColors }
      });

      if (!writeSavedSkinPresets(saved)) return;
      if (inp) inp.value = '';
      loadSavedPresets();
      App.showToast(`Đã lưu mẫu [${App.escapeHTML(name)}] vào danh sách preset của bạn!`, 'success');
    }

    function applyCustomSavedPreset(index) {
      const saved = readSavedSkinPresets();

      const p = saved[index];
      if (!p || !p.colors) return;

      Object.keys(p.colors).forEach(k => {
        if (currentColors[k] !== undefined) {
          currentColors[k] = p.colors[k];
        }
      });
      if (p.species) {
        const sel = document.getElementById('dino-species-select');
        if (sel) sel.value = p.species;
        changeSpecies(p.species);
      }
      renderColorChannels();
      updateDinoPreview();
      App.showToast(`Đã nạp preset [${App.escapeHTML(p.name)}]!`, 'success');
    }

    function deleteCustomPreset(index) {
      const saved = readSavedSkinPresets();

      saved.splice(index, 1);
      if (!writeSavedSkinPresets(saved)) return;
      loadSavedPresets();
      App.showToast('Đã xóa preset.', 'info');
    }

    function getActiveSteamId() {
      if (App.user?.steam_id) {
        const query = new URLSearchParams(location.search).get('steamId')?.trim();
        return App.user.isAdmin && /^\d{17}$/.test(query || '') ? query : App.user.steam_id;
      }
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const qId = urlParams.get('steamId');
        if (qId && /^\d{17}$/.test(qId.trim())) return qId.trim();
        const stored = localStorage.getItem('st25_steam_user');
        if (stored) {
          const u = JSON.parse(stored);
          if (u && u.steam_id && /^\d{17}$/.test(u.steam_id.trim())) return u.steam_id.trim();
        }
      } catch (_) {}
      return null;
    }

    function switchSkinSteamUser(sid) {
      if (!sid || !sid.trim()) return;
      window.location.search = `?steamId=${encodeURIComponent(sid.trim())}`;
    }

    async function quickLoginSkinManual() {
      window.location.href = '/api/player/steam/login?redirect=/skin.html';
    }

    function loadSkinPageData() {
      if (!skinLoadRequest) skinLoadRequest = fetchSkinPageData().finally(() => { skinLoadRequest = null; });
      return skinLoadRequest;
    }

    async function fetchSkinPageData() {
      try {
        let meUser = null;
        try {
          const meData = App.authResolved ? App.user : await App.readJSON('/api/player/me');
          if (meData) {
            if (meData && meData.isLoggedIn && meData.steam_id) {
              meUser = meData;
            }
          }
        } catch (_) {}

        const loginPanel = document.getElementById('skin-login-required-panel');
        const contentPanel = document.getElementById('skin-authenticated-content');
        const adminBar = document.getElementById('skin-admin-quick-bar');

        if (!meUser) {
          try { localStorage.removeItem('st25_steam_user'); } catch (_) {}
          if (loginPanel) loginPanel.style.display = 'block';
          if (contentPanel) contentPanel.style.display = 'block';
          myLiveBalance = 0;
          document.getElementById('skin-balance-val').textContent = '—';
          document.getElementById('player-status-tag').textContent = 'Thiết kế tự do · Đăng nhập để áp dụng trong game';
          document.getElementById('player-dino-status-text').textContent = 'Bạn có thể phối màu, xem 3D và lưu mẫu ngay trên thiết bị.';
          renderOwnedSkins([]);
          document.getElementById('skin-shop-grid').textContent = 'Đăng nhập Steam để xem cửa hàng skin.';
          document.getElementById('shop-skin-count').textContent = 'Cần đăng nhập';
          if (adminBar) adminBar.style.display = 'none';
          return;
        }

        if (loginPanel) loginPanel.style.display = 'none';
        if (contentPanel) contentPanel.style.display = 'block';

        const isUserAdmin = !!meUser.isAdmin;
        if (adminBar) adminBar.style.display = isUserAdmin ? 'flex' : 'none';

        let activeSid = meUser.steam_id;
        const urlParams = new URLSearchParams(window.location.search);
        const querySid = urlParams.get('steamId');
        if (querySid && isUserAdmin) {
          activeSid = querySid.trim();
        }

        const swInp = document.getElementById('skin-switcher-steamid');
        if (swInp) swInp.value = activeSid;

        const url = `/api/skin/info?steamId=${encodeURIComponent(activeSid)}`;
        const data = await App.readJSON(url, { headers: { 'x-steam-id': activeSid } });

        myLiveBalance = data.balance || 0;
        isUserOnlineInGame = !!data.isOnline;
        document.getElementById('skin-balance-val').textContent = myLiveBalance.toLocaleString('vi-VN');
        document.getElementById('player-status-tag').textContent = `Tài khoản: ${data.personaName} (${data.steamId})`;

        if (data.species) {
          currentSpecies = data.species;
          const dinoSpeciesSelect = document.getElementById('dino-species-select');
          if (dinoSpeciesSelect) dinoSpeciesSelect.value = data.species;
          changeSpecies(data.species);

          const statusTextEl = document.getElementById('player-dino-status-text');
          if (statusTextEl) {
            statusTextEl.innerHTML = `Khủng long in-game: <strong style="color: #38bdf8;">${App.escapeHTML(data.species)}</strong> (<span style="color: #10b981; font-weight: 700;">${App.escapeHTML(data.growth)}% Growth</span>) • Trạng thái: <strong style="color: ${data.isOnline ? '#10b981' : '#f59e0b'};">${data.isOnline ? '🟢 Đang Trong Game (Online)' : '🟡 Ngoại Tuyến (Offline)'}</strong>`;
          }
        }

        // Render Owned Skins
        renderOwnedSkins(data.ownedSkins || []);

        // Render Skin Shop
        const shopGrid = document.getElementById('skin-shop-grid');
        const shopCount = document.getElementById('shop-skin-count');
        const skins = Array.isArray(data.shopSkins) ? data.shopSkins : [];
        if (shopCount) shopCount.textContent = `${skins.length} mẫu skin`;

        if (shopGrid) {
          shopGrid.innerHTML = skins.map(s => `
            <div class="skin-shop-card">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                  <span style="font-size: 2.2rem;">${App.escapeHTML(s.icon || '🎃')}</span>
                  <span class="rule-badge badge-allow" style="font-weight: 800; color: #fbbf24; font-size: 0.9rem;">
                    ${Number(s.price) || 0} Lúa 🌾
                  </span>
                </div>
                <h4 style="color: #fff; font-size: 1.1rem; margin-bottom: 6px;">${App.escapeHTML(s.name)}</h4>
                <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 12px;">Dành riêng cho loài <strong>${App.escapeHTML(s.species || 'Tất cả')}</strong></p>
              </div>
              <button data-id="${App.escapeHTML(s.id)}" data-name="${App.escapeHTML(s.name)}" data-price="${Number(s.price) || 0}" onclick="handleBuySkin(this.dataset.id, this.dataset.name, Number(this.dataset.price))" class="btn btn-primary btn-sm" style="width: 100%; font-weight: 700;">
                🌾 Mua Bằng Lúa (${Number(s.price) || 0} Lúa 🌾)
              </button>
            </div>
          `).join('') || '<p class="skin-help">Chưa có skin trong cửa hàng.</p>';
        }

      } catch (e) {
        console.error('Error loading skin data:', e);
        document.getElementById('player-status-tag').textContent = 'Không tải được dữ liệu. Hãy thử tải lại trang.';
      }
    }

    function renderOwnedSkins(ownedList) {
      if (!Array.isArray(ownedList)) ownedList = [];
      const ownedGrid = document.getElementById('owned-skin-grid');
      const countEl = document.getElementById('owned-skin-count');
      if (countEl) countEl.textContent = `${ownedList.length} Mẫu Skin`;
      if (!ownedGrid) return;

      if (!ownedList.length) {
        ownedGrid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 35px; background: rgba(0,0,0,0.25); border-radius: 8px; color: #94a3b8;">
            Bạn chưa có skin nào trong kho. Hãy mua tại Shop bên dưới hoặc mở Hòm May Mắn để nhận skin hiếm!
          </div>
        `;
        return;
      }

      ownedGrid.innerHTML = ownedList.map(s => `
        <div class="owned-skin-card">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <span style="font-size: 2rem;">${App.escapeHTML(s.icon || '🎨')}</span>
              <span class="rule-badge badge-allow" style="font-size: 0.75rem;">ĐÃ SỞ HỮU</span>
            </div>
            <h4 style="color: #fff; font-size: 1.05rem; margin-bottom: 4px;">${App.escapeHTML(s.name)}</h4>
            <small style="color: #94a3b8; display: block; margin-bottom: 14px;">${App.escapeHTML(s.source || 'IslePilot Cloud')}</small>
          </div>
          <button data-id="${App.escapeHTML(s.id)}" data-name="${App.escapeHTML(s.name)}" onclick="handleApplyOwnedPreset(this.dataset.id, this.dataset.name)" class="btn btn-primary btn-sm" style="width: 100%; font-weight: 700; background: #0284c7; border: none;">
            ⚡ Áp Dụng Lên Dino In-Game
          </button>
        </div>
      `).join('');
    }

    async function handleApplySkinWithLua() {
      if (skinMutationBusy) return;
      const activeSid = getActiveSteamId();
      if (!activeSid) {
        App.showToast('Vui lòng đăng nhập Steam để đổi màu skin!', 'error');
        return;
      }

      if (myLiveBalance < 10) {
        App.showToast(`Tài khoản không đủ Lúa! Cần 10 Lúa 🌾 để đổi màu skin (Hiện có: ${myLiveBalance}).`, 'error');
        return;
      }

      if (!confirm(`Xác nhận dùng 10 Lúa 🌾 để đổi màu skin trực tiếp in-game cho [${currentSpecies}]? Toàn bộ 10 lớp màu sẽ áp dụng ngay lập tức trên nhân vật của bạn!`)) {
        return;
      }

      const code = generateEvrimaCode();
      const payload = getSkinPayload();

      skinMutationBusy = true;
      try {
        App.showToast('Đang kết nối IslePilot để áp dụng 10 lớp màu da trực tiếp vào game...', 'info');
        const res = await fetch('/api/skin/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-steam-id': activeSid },
          body: JSON.stringify({
            species: currentSpecies,
            colors: currentColors,
            female: currentGender === 'female',
            variation: payload.variation,
            pattern: payload.pattern,
            theme: payload.theme,
            skinCode: code,
            steamId: activeSid
          })
        });
        const result = await res.json();
        if (res.ok && result.success) {
          App.showToast(result.message, 'success');
          myLiveBalance = result.newBalance;
          document.getElementById('skin-balance-val').textContent = myLiveBalance.toLocaleString('vi-VN');
          exportSkinCode();
        } else {
          App.showToast(result.error || 'Áp dụng skin thất bại!', 'error');
        }
      } catch (e) {
        App.showToast('Lỗi mạng khi kết nối máy chủ!', 'error');
      } finally {
        skinMutationBusy = false;
      }
    }

    async function handleBuySkin(skinId, skinName, price) {
      if (skinMutationBusy) return;
      const activeSid = getActiveSteamId();
      if (myLiveBalance < price) {
        App.showToast(`Tài khoản không đủ Lúa! Cần ${price} Lúa 🌾 (Hiện có: ${myLiveBalance}).`, 'error');
        return;
      }

      if (!confirm(`Xác nhận dùng ${price} Lúa 🌾 trong ví để mua skin [${App.escapeHTML(skinName)}]?`)) return;

      skinMutationBusy = true;
      try {
        App.showToast('Đang xử lý giao dịch mua skin...', 'info');
        const res = await fetch('/api/skin/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-steam-id': activeSid },
          body: JSON.stringify({ skinId, skinName, price, steamId: activeSid })
        });
        const result = await res.json();
        if (res.ok && result.success) {
          App.showToast(result.message, 'success');
          myLiveBalance = result.newBalance;
          document.getElementById('skin-balance-val').textContent = myLiveBalance.toLocaleString('vi-VN');
          await loadSkinPageData();
        } else {
          App.showToast(result.error || 'Mua skin thất bại!', 'error');
        }
      } catch (e) {
        App.showToast('Lỗi mạng khi kết nối máy chủ!', 'error');
      } finally {
        skinMutationBusy = false;
      }
    }

    async function handleApplyOwnedPreset(presetId, skinName) {
      if (skinMutationBusy) return;
      const activeSid = getActiveSteamId();
      if (!confirm(`Xác nhận áp dụng skin [${App.escapeHTML(skinName)}] lên khủng long đang chơi in-game?`)) return;

      skinMutationBusy = true;
      try {
        App.showToast(`Đang áp dụng ${App.escapeHTML(skinName)} vào nhân vật...`, 'info');
        const res = await fetch('/api/skin/preset/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-steam-id': activeSid },
          body: JSON.stringify({ presetId, variation: 0, steamId: activeSid })
        });
        const result = await res.json();
        if (res.ok && result.success) {
          App.showToast(result.message, 'success');
        } else {
          App.showToast(result.error || 'Không thể áp dụng skin lúc này!', 'error');
        }
      } catch (e) {
        App.showToast('Lỗi kết nối máy chủ!', 'error');
      } finally {
        skinMutationBusy = false;
      }
    }

    document.addEventListener('DOMContentLoaded', () => {
      renderColorChannels();
      updateDinoPreview();
      loadSavedPresets();
      loadSkinPageData();
      for (const id of ['skin-variation', 'skin-pattern-idx', 'skin-theme']) document.getElementById(id)?.addEventListener('input', refreshSkinCode);
    });
