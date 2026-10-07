(() => {
  const root = document.querySelector('[data-admin-dashboard]');
  if (!root) return;
  const categories = [...root.querySelectorAll('[data-dashboard-category]')];
  const cards = categories.flatMap(section => [...section.querySelectorAll('[data-module]')]);
  const favoritesGrid = root.querySelector('[data-favorites-grid]');
  const search = root.querySelector('[data-dashboard-search]');
  const status = root.querySelector('[data-favorite-status]');
  const selected = new Set(cards.filter(card => card.querySelector('button').getAttribute('aria-pressed') === 'true').map(card => card.dataset.module));
  const normalize = value => value.toLocaleLowerCase('de').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let saving = false;
  function filter() {
    const terms = normalize(search.value.trim()).split(/\s+/).filter(Boolean);
    root.querySelectorAll('[data-module]').forEach(card => { card.hidden = !terms.every(term => normalize(card.dataset.search).includes(term)); });
    let total = 0;
    categories.forEach(section => {
      const count = [...section.querySelectorAll('[data-module]')].filter(card => !card.hidden).length;
      section.hidden = !count;
      section.querySelector('[data-category-count]').textContent = `${count} Bereiche`;
      total += count;
    });
    root.querySelector('[data-search-status]').textContent = `${total} Funktionen${terms.length ? ' gefunden' : ' verfügbar'}`;
    root.querySelector('[data-search-empty]').hidden = total > 0;
    const empty = root.querySelector('[data-favorites-empty]');
    empty.hidden = [...favoritesGrid.children].some(card => !card.hidden);
    empty.textContent = selected.size ? 'Keine Favoriten für diese Suche.' : 'Klicke auf den Stern einer Transaktion, um sie hier anzuheften. Deine Auswahl wird in deinem Konto gespeichert.';
  }
  function refresh() {
    cards.forEach(card => {
      const favorite = selected.has(card.dataset.module);
      const button = card.querySelector('[data-favorite-toggle]');
      const label = favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen';
      button.setAttribute('aria-pressed', String(favorite));
      button.setAttribute('aria-label', `${card.querySelector('h3').textContent}: ${label}`);
      button.title = label;
      button.querySelector('span').textContent = favorite ? '★' : '☆';
      card.querySelector('[name="favorite"]').value = favorite ? '0' : '1';
    });
    favoritesGrid.replaceChildren(...cards.filter(card => selected.has(card.dataset.module)).map(card => card.cloneNode(true)));
    root.querySelector('[data-favorites-count]').textContent = `${selected.size} angeheftet`;
    filter();
  }
  root.addEventListener('submit', async event => {
    const form = event.target.closest('.admin-favorite-form');
    if (!form) return;
    event.preventDefault();
    if (saving) return;
    saving = true;
    const key = form.elements.module.value;
    const fromFavorites = favoritesGrid.contains(form);
    const focusButton = form.querySelector('button');
    root.querySelectorAll('[data-favorite-toggle]').forEach(button => { button.disabled = true; });
    status.textContent = 'Favoriten werden gespeichert …';
    try {
      const response = await fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ module: key, favorite: form.elements.favorite.value }) });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Favoriten konnten nicht gespeichert werden. Bitte erneut versuchen oder neu anmelden.');
      const data = await response.json();
      if (!Array.isArray(data.favorites)) throw new Error('Ungültige Antwort. Bitte die Seite neu laden.');
      selected.clear(); data.favorites.forEach(id => selected.add(id));
      refresh();
      status.textContent = selected.has(key) ? 'Transaktion zu Favoriten hinzugefügt.' : 'Transaktion aus Favoriten entfernt.';
    } catch (error) { status.textContent = error.message; }
    finally {
      saving = false;
      root.querySelectorAll('[data-favorite-toggle]').forEach(button => { button.disabled = false; });
      if (focusButton.isConnected) focusButton.focus();
      else {
        const target = fromFavorites && [...favoritesGrid.children].find(card => card.dataset.module === key) || cards.find(card => card.dataset.module === key);
        target?.querySelector('button').focus();
      }
    }
  });
  root.querySelector('[data-dashboard-search-panel]').hidden = false;
  search.addEventListener('input', filter);
  root.querySelector('[data-search-clear]').addEventListener('click', () => { search.value = ''; filter(); search.focus(); });
  refresh();
})();
