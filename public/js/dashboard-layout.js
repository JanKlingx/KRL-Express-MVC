(() => {
  const root = document.querySelector('[data-admin-dashboard]');
  const organizer = root?.querySelector('[data-dashboard-organizer]');
  if (!organizer) return;
  organizer.hidden = false;
  const status = organizer.querySelector('[data-layout-status]');
  const groups = () => [...root.querySelectorAll('[data-dashboard-category]')];
  let applying = false, dragged = null;
  let queue = Promise.resolve();
  function syncOptions() {
    const select = root.querySelector('[data-category-options]'), chosen = select.value;
    select.replaceChildren(...groups().map(group => new Option(group.querySelector('h2').textContent, group.dataset.categoryId)));
    if ([...select.options].some(option => option.value === chosen)) select.value = chosen;
  }
  function initialize(group) {
    group.dataset.collapsed = String(!group.open);
    group.addEventListener('toggle', () => {
      if (applying || root.querySelector('[data-dashboard-search]').value.trim()) return;
      const collapsed = String(!group.open);
      if (group.dataset.collapsed === collapsed) return;
      group.dataset.collapsed = collapsed;
      save({ action: 'collapse', category: group.dataset.categoryId, collapsed: group.open ? '0' : '1' });
    });
  }
  function render(layout) {
    applying = true;
    const cards = new Map(groups().flatMap(group => [...group.querySelectorAll('[data-module]')]).map(card => [card.dataset.module, card]));
    for (const category of layout.categories) {
      let group = groups().find(g => g.dataset.categoryId === category.id);
      if (!group) {
        group = document.createElement('details'); group.className = 'admin-group'; group.dataset.dashboardCategory = ''; group.dataset.categoryId = category.id;
        group.innerHTML = '<summary class="admin-group-heading"><h2></h2><span data-category-count></span></summary><div class="category-tools"><button type="button" class="button button-small button-ghost" data-category-rename>Kategorie umbenennen</button><button type="button" class="button button-small button-ghost" data-category-delete>Kategorie entfernen</button></div><div class="admin-grid"></div>';
        root.querySelector('[data-search-empty]').before(group); initialize(group);
      }
      group.querySelector('h2').textContent = category.name;
      group.dataset.collapsed = String(category.collapsed); group.open = !category.collapsed;
      const grid = group.querySelector('.admin-grid');
      for (const [id, card] of cards) if (layout.placements[id] === category.id) grid.append(card);
    }
    groups().filter(g => !layout.categories.some(c => c.id === g.dataset.categoryId)).forEach(g => g.remove());
    syncOptions(); root.dispatchEvent(new Event('layoutchange')); applying = false;
  }
  function save(action) {
    queue = queue.then(async () => {
      status.textContent = 'Anordnung wird gespeichert …';
      try {
        const response = await fetch(root.dataset.layoutUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(action) });
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Bitte erneut anmelden.');
        const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Speichern fehlgeschlagen.');
        render(data.layout); status.textContent = 'Deine Anordnung wurde gespeichert.';
      } catch (error) { status.textContent = error.message; }
    });
    return queue;
  }
  groups().forEach(group => {
    initialize(group);
    group.querySelectorAll('[data-module]').forEach(card => {
      const handle = document.createElement('button'); handle.type = 'button'; handle.draggable = true; handle.className = 'dashboard-drag-handle'; handle.textContent = '⠿'; handle.title = 'Transaktion verschieben'; handle.setAttribute('aria-label', card.querySelector('h3').textContent + ': verschieben'); handle.dataset.dragHandle = '';
      handle.addEventListener('click', () => { organizer.querySelector('[name="module"]').value = card.dataset.module; organizer.querySelector('[name="category"]').focus(); });
      card.append(handle);
    });
  });
  root.addEventListener('dragstart', event => { const handle = event.target.closest('[data-drag-handle]'); if (!handle) return; dragged = handle.closest('[data-module]').dataset.module; event.dataTransfer.setData('text/plain', dragged); event.dataTransfer.effectAllowed = 'move'; });
  root.addEventListener('dragover', event => { const group = event.target.closest('[data-dashboard-category]'); if (!group || !dragged) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; group.classList.add('is-drop-target'); });
  root.addEventListener('dragleave', event => { const group = event.target.closest('[data-dashboard-category]'); if (group && !group.contains(event.relatedTarget)) group.classList.remove('is-drop-target'); });
  root.addEventListener('dragend', () => { dragged = null; groups().forEach(g => g.classList.remove('is-drop-target')); });
  root.addEventListener('drop', event => { const group = event.target.closest('[data-dashboard-category]'); if (!group || !dragged) return; event.preventDefault(); save({ action: 'move', module: dragged, category: group.dataset.categoryId }); dragged = null; groups().forEach(g => g.classList.remove('is-drop-target')); });
  organizer.querySelector('[data-category-create]').addEventListener('submit', event => { event.preventDefault(); save({ action: 'create', name: event.target.elements.name.value }); });
  organizer.querySelector('[data-category-move]').addEventListener('submit', event => { event.preventDefault(); save({ action: 'move', module: event.target.elements.module.value, category: event.target.elements.category.value }); });
  root.addEventListener('click', event => {
    const group = event.target.closest('[data-dashboard-category]'); if (!group) return;
    if (event.target.closest('[data-category-rename]')) { const name = window.prompt('Neuer Kategoriename', group.querySelector('h2').textContent); if (name != null) save({ action: 'rename', category: group.dataset.categoryId, name }); }
    if (event.target.closest('[data-category-delete]') && window.confirm('Kategorie entfernen? Ihre Transaktionen kehren in die Standardkategorien zurück.')) save({ action: 'delete', category: group.dataset.categoryId });
  });
  syncOptions();
})();
