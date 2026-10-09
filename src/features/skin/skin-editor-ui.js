/* Rearrange the existing editor without replacing its skin or wallet actions. */
(() => {
  const content = document.getElementById('skin-authenticated-content');
  const layout = content?.querySelector('.editor-layout');
  if (!layout || content.dataset.editorReady) return;
  content.dataset.editorReady = 'true';
  const icon = (name) => {
    const paths = {
      brush: '<path d="m14 6 4-4 4 4-4 4-4-4Z"/><path d="m14 6-7 7 4 4 7-7M7 13c-5-1-2 7-5 7 5 2 9-2 9-3"/>',
      box: '<path d="m3 7 9-5 9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5M12 12v10"/>',
      shop: '<path d="M3 10h18l-2-7H5l-2 7Zm1 0v11h16V10M9 21v-7h6v7"/>',
      shuffle: '<path d="M3 5h3l12 14h3M3 19h3l4-5m4-4 4-5h3M18 2l3 3-3 3m0 8 3 3-3 3"/>',
      copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
      import: '<path d="M12 3v12m-4-4 4 4 4-4M3 15v6h18v-6"/>',
      reset: '<path d="M3 10a9 9 0 1 1 1 7M3 3v7h7"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
  };
  const banner = content.firstElementChild;
  banner.classList.add('skin-page-heading');
  banner.querySelector('h1').textContent = 'SKIN STUDIO';
  banner.lastElementChild.classList.add('skin-wallet');
  const intro = document.createElement('p');
  intro.className = 'skin-page-subtitle';
  intro.textContent = 'Phối màu khủng long theo phong cách của bạn.';
  banner.querySelector('h1').after(intro);
  const quickPresets = banner.nextElementSibling;
  quickPresets.classList.add('skin-quick-presets');
  const previewColumn = layout.firstElementChild;
  const oldControls = layout.lastElementChild;
  const [config, colors, actions, saved] = [...oldControls.children];
  previewColumn.classList.add('skin-preview-column');
  previewColumn.firstElementChild.classList.add('skin-preview-heading');
  config.classList.add('skin-config');
  colors.classList.add('skin-colors-panel');
  actions.classList.add('skin-apply-panel');
  saved.classList.add('skin-presets-panel');
  const left = document.createElement('aside');
  left.className = 'skin-left-column';
  left.setAttribute('aria-label', 'Bảng màu');
  left.append(colors);
  const right = document.createElement('aside');
  right.className = 'skin-right-column';
  right.setAttribute('aria-label', 'Áp dụng và lưu skin');
  const actionTitle = document.createElement('h3');
  actionTitle.className = 'skin-section-label';
  actionTitle.textContent = 'Áp dụng skin';
  const actionNote = document.createElement('p');
  actionNote.className = 'skin-help';
  actionNote.textContent = 'Áp dụng cho khủng long đang chơi. Chi phí: 10 Lúa.';
  actions.prepend(actionTitle, actionNote);
  actions.querySelector(':scope > button').textContent = 'Áp dụng · 10 Lúa';
  right.append(actions, saved);
  previewColumn.append(config);
  oldControls.remove();
  layout.prepend(left);
  layout.append(right);
  const previewNote = document.createElement('p');
  previewNote.className = 'skin-preview-note';
  previewNote.textContent = 'Bản phối màu minh họa · Hình dạng và màu trong game có thể khác.';
  document.getElementById('skin-preview-box').after(previewNote);

  const select = document.getElementById('dino-species-select');
  const speciesPanel = document.createElement('section');
  speciesPanel.className = 'skin-species-panel';
  speciesPanel.setAttribute('aria-label', 'Chọn loài khủng long');
  const label = document.createElement('h2');
  label.className = 'skin-section-label';
  label.textContent = 'Loài khủng long';
  const rail = document.createElement('div');
  rail.className = 'skin-species-grid';
  for (const option of select.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'skin-species-tile';
    button.dataset.species = option.value;
    button.setAttribute('aria-label', `Chọn ${option.value}`);
    const img = document.createElement('img');
    img.src = `assets/imges/thumbs/${option.value === 'Troodon' ? 'troodon' : option.value}.png`;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 128;
    img.height = 62;
    const name = document.createElement('span');
    name.textContent = option.value;
    button.append(img, name);
    rail.append(button);
  }
  const tiles = [...rail.children];
  let selectedSpecies;
  const syncSpecies = () => {
    if (selectedSpecies === select.value) return;
    selectedSpecies = select.value;
    tiles.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.species === selectedSpecies)));
  };
  rail.addEventListener('click', event => {
    const button = event.target.closest('button[data-species]');
    if (!button || !rail.contains(button)) return;
    select.value = button.dataset.species;
    select.dispatchEvent(new Event('change', {bubbles: true}));
  });
  select.addEventListener('change', syncSpecies);
  syncSpecies();
  speciesPanel.append(label, rail);
  layout.before(speciesPanel);
  colors.querySelectorAll('.btn-icon-sm').forEach((button, i) => {
    button.innerHTML = icon(['shuffle', 'copy', 'import', 'reset'][i]);
    button.setAttribute('aria-label', button.title);
  });
  const presetPills = [...quickPresets.querySelectorAll('.preset-pill')];
  const presetKeys = ['golden_rice', 'shadow', 'jungle', 'volcano', 'albino'];
  const syncPresets = () => presetPills.forEach((pill, index) => {
    const selected = CHANNELS.every(channel => currentColors[channel.id]?.toLowerCase() === BUILTIN_PRESETS[presetKeys[index]].colors[channel.id]);
    pill.classList.toggle('active', selected);
    pill.setAttribute('aria-pressed', String(selected));
  });
  window.ST25SkinUI = {syncSpecies, syncPresets};
  syncPresets();
  presetPills.forEach(pill => {
    pill.tabIndex = 0;
    pill.setAttribute('role', 'button');
    pill.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pill.click(); } });
  });
  const owned = document.getElementById('owned-skin-grid').closest('section');
  const shop = document.getElementById('skin-shop-grid').closest('section');
  owned.classList.add('skin-library-section');
  shop.classList.add('skin-library-section');
  const tabs = document.createElement('div');
  tabs.className = 'skin-workspace-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Skin Studio');
  const groups = [[quickPresets, speciesPanel, layout, document.getElementById('export-box')], [owned], [shop]];
  const buttons = ['Thiết kế skin', 'Kho skin', 'Cửa hàng'].map((text, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `skin-workspace-tab-${i}`;
    button.setAttribute('role', 'tab');
    button.innerHTML = icon(['brush', 'box', 'shop'][i]);
    button.append(document.createTextNode(text));
    button.addEventListener('click', () => activate(i));
    button.addEventListener('keydown', e => {
      const next = e.key === 'ArrowRight' ? (i + 1) % 3 : e.key === 'ArrowLeft' ? (i + 2) % 3 : e.key === 'Home' ? 0 : e.key === 'End' ? 2 : null;
      if (next !== null) { e.preventDefault(); activate(next); buttons[next].focus(); }
    });
    tabs.append(button);
    return button;
  });
  const activate = index => {
    buttons.forEach((button, i) => { button.setAttribute('aria-selected', String(i === index)); button.tabIndex = i === index ? 0 : -1; });
    groups.forEach((group, i) => group.forEach(panel => { panel.hidden = i !== index; }));
  };
  banner.after(tabs);
  activate(0);
})();
