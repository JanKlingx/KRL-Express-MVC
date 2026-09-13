document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-result-race-control]');
  const mount = form?.querySelector('[data-result-control-mount]');
  const dataNode = form?.querySelector('[data-result-control-points]');
  if (!form || !mount || !dataNode || form.dataset.resultInitialized) return;
  form.dataset.resultInitialized = 'true';

  let refreshSearch = () => {};
  function addDriverSearch() {
    const search = document.createElement('div'); search.className = 'result-driver-search';
    search.innerHTML = '<label>Fahrer suchen<input type="search" placeholder="Name eingeben …" autocomplete="off" data-result-search></label><button type="button" data-clear-result-search>Suche leeren</button><div data-result-search-matches aria-live="polite"></div>';
    mount.prepend(search);
    const input = search.querySelector('input'), matches = search.querySelector('[data-result-search-matches]');
    input.addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
    refreshSearch = () => {
      const focused = matches.contains(document.activeElement) ? { driver: document.activeElement.dataset.searchPosition, status: document.activeElement.dataset.searchStatus } : null;
      matches.replaceChildren(); const query = input.value.trim().toLocaleLowerCase('de');
      if (!query) return;
      const rows = [...form.querySelectorAll('[data-result-driver]')].filter(row => String(row.dataset.driverName).toLocaleLowerCase('de').includes(query));
      if (!rows.length) matches.textContent = 'Kein Fahrer gefunden.';
      rows.forEach(row => {
        const hit = document.createElement('article'); hit.className = 'result-search-hit';
        const name = document.createElement('strong'); name.textContent = row.dataset.driverName; hit.append(name);
        const board = [...mount.querySelectorAll('[data-result-board]')].find(item => !item.hidden);
        const type = board?.dataset.resultBoard || 'main';
        const positionInput = row.querySelector(`[data-result-position="${type}"]`);
        if (board && positionInput) {
          const label = document.createElement('label'); label.textContent = type === 'sprint' ? 'Sprint-Platz' : 'GP-Platz';
          const select = document.createElement('select'); select.dataset.searchPosition = row.dataset.resultDriver;
          select.setAttribute('aria-label', `${row.dataset.driverName}: ${label.textContent}`);
          const count = form.querySelectorAll('[data-result-driver]').length;
          for (let i = 0; i <= count; i++) { const option = document.createElement('option'); option.value = i ? String(i) : ''; option.textContent = i ? `P${i}` : 'Noch nicht eingeteilt'; select.append(option); }
          select.value = positionInput.value;
          select.addEventListener('change', () => board.dispatchEvent(new CustomEvent('result-search-position', { detail: { driverId: row.dataset.resultDriver, position: select.value } })));
          label.append(select); hit.append(label);
        }
        const sessionStatus = row.querySelector(`[data-result-status-race="${type}"]`) || (type === 'main' ? row.querySelector('[data-result-status]') : null);
        if (board && sessionStatus) {
          const label = document.createElement('label'); label.textContent = 'Status';
          const field = sessionStatus.cloneNode(true); field.removeAttribute('name'); field.removeAttribute('data-result-status'); field.removeAttribute('data-result-status-race'); field.dataset.searchStatus = row.dataset.resultDriver; field.value = sessionStatus.value;
          field.addEventListener('change', () => { sessionStatus.value = field.value; sessionStatus.dispatchEvent(new Event('change', { bubbles: true })); }); label.append(field); hit.append(label);
        }
        if (!board) {
          row.querySelectorAll('input[type="number"]').forEach(source => {
            const label = document.createElement('label'); label.textContent = source.name.includes('sprint') ? 'Sprint-Punkte' : 'GP-Punkte';
            const field = source.cloneNode(); field.removeAttribute('name'); field.removeAttribute('id'); field.required = false; field.value = source.value;
            field.setAttribute('aria-label', `${row.dataset.driverName}: ${label.textContent}`);
            field.addEventListener('input', () => { source.value = field.value; source.dispatchEvent(new Event('input', { bubbles: true })); });
            label.append(field); hit.append(label);
          });
        }
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Zur Kachel';
        button.addEventListener('click', () => {
          const board = [...mount.querySelectorAll('[data-result-board]')].find(item => !item.hidden);
          const card = board ? [...board.querySelectorAll('[data-driver-id]')].find(item => item.dataset.driverId === row.dataset.resultDriver) : row;
          if (!card) return;
          mount.querySelectorAll('.is-search-match').forEach(item => item.classList.remove('is-search-match'));
          card.classList.add('is-search-match'); card.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
          if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1'); card.focus({ preventScroll: true });
        }); hit.append(button); matches.append(hit);
      });
      if (focused) { const field = [...matches.querySelectorAll('select')].find(node => focused.driver ? node.dataset.searchPosition === focused.driver : node.dataset.searchStatus === focused.status); field?.focus({ preventScroll: true }); }
    };
    input.addEventListener('input', refreshSearch);
    search.querySelector('[data-clear-result-search]').addEventListener('click', () => { input.value = ''; refreshSearch(); input.focus(); });
  }

  const config = JSON.parse(dataNode.textContent || '{}');
  if (config.pointsMode === 'manual') {
    mount.innerHTML = '<div class="result-manual-notice"><strong>MANUELLE PUNKTE</strong><span>Positionen bleiben eindeutig; Punktwerte werden wie bisher manuell gepflegt.</span></div>';
    addDriverSearch();
    return;
  }

  const sourceRows = [...form.querySelectorAll('[data-result-driver]')];
  if (!sourceRows.length) return;
  form.classList.add('has-visual-result-control');
  const sourceGrid = sourceRows[0].closest('.lineup-team-grid');
  sourceGrid?.setAttribute('aria-hidden', 'true');

  const driverData = sourceRows.map((row) => ({
    id: row.dataset.resultDriver,
    name: row.dataset.driverName,
    team: row.dataset.teamName,
    logo: row.dataset.teamLogo,
    reserve: row.dataset.isReserve === 'true',
    row,
    status: row.querySelector('[data-result-status]')
  }));
  let activeDriver = null;
  const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));

  function inputFor(driver, raceType, kind) {
    if (kind === 'status') return driver.row.querySelector(`[data-result-status-race="${raceType}"]`) || (raceType === 'main' ? driver.row.querySelector('[data-result-status]') : null);
    if (kind === 'position') return driver.row.querySelector(`[data-result-position="${raceType}"]`);
    if (kind === 'fastest') return driver.row.querySelector(`[data-result-fastest="${raceType}"]`);
    if (kind === 'pole') return driver.row.querySelector(`[data-result-pole="${raceType}"]`);
    if (kind === 'dotd') return driver.row.querySelector(`[data-result-dotd="${raceType}"]`);
    return null;
  }

  function buildDriverCard(driver, raceType) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `result-control-driver ${driver.reserve ? 'is-reserve' : ''}`;
    card.dataset.driverId = driver.id;
    card.draggable = true;
    const statusInput = inputFor(driver, raceType, 'status');
    const status = statusInput?.value || '';
    const visualLogo = driver.reserve ? config.leagueLogo : driver.logo;
    const bonuses = [
      raceType === 'main' && inputFor(driver, raceType, 'pole')?.checked ? 'POLE' : '',
      raceType === 'main' && inputFor(driver, raceType, 'fastest')?.checked ? 'SCHNELLSTE RUNDE' : '',
      raceType === 'main' && inputFor(driver, raceType, 'dotd')?.checked ? 'DRIVER OF THE DAY' : '',
    ].filter(Boolean);
    card.innerHTML = `${visualLogo ? `<img src="${escapeHtml(visualLogo)}" alt="">` : '<span class="result-control-logo">KRL</span>'}<span><strong>${escapeHtml(driver.name)}</strong><small>${driver.reserve ? 'ERSATZ · ' : ''}${escapeHtml(driver.team || 'Team')}</small><em>${bonuses.map(escapeHtml).join(' · ')}</em></span><b data-result-card-status>${escapeHtml(status || 'GEWERTET')}</b>`;
    const statusBadge = card.querySelector('[data-result-card-status]');
    statusBadge.title = 'Status wechseln: Gewertet → DNF → DSQ';
    statusBadge.addEventListener('click', (event) => {
      event.stopPropagation();
      const values = ['', 'DNF', 'DSQ'];
      if (!statusInput) return;
      statusInput.value = values[(values.indexOf(statusInput.value) + 1) % values.length];
      statusInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    card.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', driver.id));
    card.addEventListener('dragover', (event) => {
      if (event.dataTransfer?.types?.includes('application/x-result-bonus')) event.preventDefault();
    });
    card.addEventListener('click', () => {
      activeDriver = activeDriver === driver.id ? null : driver.id;
      mount.querySelectorAll('.result-control-driver').forEach((item) => item.classList.toggle('is-selected', item.dataset.driverId === activeDriver));
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); }
    });
    return card;
  }

  function createRaceBoard(raceType) {
    const points = new Map((config[raceType] || []).map((row) => [Number(row.position), Number(row.points)]));
    const section = document.createElement('section');
    section.className = `result-control-board result-control-${raceType}`;
    section.dataset.resultBoard = raceType;
    section.innerHTML = `<header><div><span>${raceType === 'sprint' ? 'SPRINT' : 'HAUPTRENNEN'}</span><strong>Positionsturm</strong></div><div class="result-control-badges">${raceType === 'main' ? `<button type="button" draggable="true" data-bonus="pole">POLE POSITION</button><button type="button" draggable="true" data-bonus="fastest">SCHNELLSTE RUNDE</button><button type="button" draggable="true" data-bonus="dotd">DRIVER OF THE DAY</button>` : ''}</div></header><div class="result-control-workspace"><div class="result-position-tower" data-position-tower></div><aside class="result-driver-pool" data-driver-pool><header><strong>FAHRERPOOL</strong><small>Fahrer auf eine Position ziehen</small></header><div data-pool-cards></div></aside></div><div class="result-control-summary" data-result-summary></div>`;
    const tower = section.querySelector('[data-position-tower]');
    const pool = section.querySelector('[data-pool-cards]');

    for (let position = 1; position <= driverData.length; position += 1) {
      const slot = document.createElement('div');
      slot.className = 'result-position-slot';
      slot.dataset.position = String(position);
      slot.tabIndex = 0;
      slot.innerHTML = `<header><strong>P${position}</strong><span>${points.get(position) || 0} PKT</span></header><div data-position-card></div>`;
      tower.append(slot);
    }

    function positionOf(driverId) { return Number(inputFor(driverData.find((driver) => driver.id === String(driverId)), raceType, 'position')?.value || 0); }
    function render() {
      tower.querySelectorAll('[data-position-card]').forEach((container) => { container.innerHTML = ''; });
      pool.innerHTML = '';
      driverData.forEach((driver) => {
        const card = buildDriverCard(driver, raceType);
        const position = positionOf(driver.id);
        const target = position ? tower.querySelector(`[data-position="${position}"] [data-position-card]`) : pool;
        (target || pool).append(card);
      });
      updateSummary();
      refreshSearch();
    }

    function assign(driverId, targetPosition) {
      const driver = driverData.find((item) => item.id === String(driverId));
      if (!driver) return;
      const input = inputFor(driver, raceType, 'position');
      const oldPosition = Number(input.value || 0);
      const occupant = driverData.find((item) => positionOf(item.id) === Number(targetPosition) && item.id !== driver.id);
      if (occupant) inputFor(occupant, raceType, 'position').value = oldPosition || '';
      input.value = String(targetPosition);
      activeDriver = null;
      render();
    }

    function unassign(driverId) {
      const driver = driverData.find((item) => item.id === String(driverId));
      if (driver) inputFor(driver, raceType, 'position').value = '';
      activeDriver = null;
      render();
    }

    section.addEventListener('result-search-position', event => {
      if (event.detail.position) assign(event.detail.driverId, event.detail.position);
      else unassign(event.detail.driverId);
    });

    function setExclusive(kind, driverId) {
      if (raceType !== 'main') return;
      driverData.forEach((driver) => {
        const input = inputFor(driver, raceType, kind);
        if (input) input.checked = driver.id === String(driverId);
      });
      render();
    }

    function updateSummary() {
      const theoretical = Array.from(
        { length: driverData.length },
        (_, index) => points.get(index + 1) || 0
      ).reduce((sum, value) => sum + value, 0);
      let actual = 0;
      let bonuses = 0;
      let deductions = 0;
      driverData.forEach((driver) => {
        const position = positionOf(driver.id);
        if (!position) return;
        const base = points.get(position) || 0;
        const fastest = Boolean(raceType === 'main' && inputFor(driver, raceType, 'fastest')?.checked && config.fastestLapEnabled);
        const pole = Boolean(raceType === 'main' && inputFor(driver, raceType, 'pole')?.checked && config.polePositionEnabled);
        const bonus = (fastest ? Number(config.fastestLapPoints || 0) : 0) + (pole ? Number(config.polePositionPoints || 0) : 0);
        bonuses += bonus;
        if (inputFor(driver, raceType, 'status')?.value === 'DSQ') deductions += base + bonus;
        else actual += base + bonus;
      });
      const expected = theoretical + bonuses - deductions;
      const matches = actual === expected;
      section.querySelector('[data-result-summary]').innerHTML = `<span>SCHEMA-BASIS <strong>${theoretical}</strong></span><span>BONI <strong>+${bonuses}</strong></span><span>STATUS-ABZÜGE <strong>-${deductions}</strong></span><span>ERWARTET <strong>${expected}</strong></span><span class="${matches ? 'is-valid' : 'is-open'}">AKTUELL <strong>${actual} ${matches ? '✓' : ''}</strong></span>`;
    }

    tower.querySelectorAll('[data-position]').forEach((slot) => {
      slot.addEventListener('dragover', (event) => { event.preventDefault(); slot.classList.add('is-drop-target'); });
      slot.addEventListener('dragleave', () => slot.classList.remove('is-drop-target'));
      slot.addEventListener('drop', (event) => { event.preventDefault(); slot.classList.remove('is-drop-target'); assign(event.dataTransfer.getData('text/plain'), slot.dataset.position); });
      slot.addEventListener('click', () => { if (activeDriver) assign(activeDriver, slot.dataset.position); });
      slot.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && activeDriver) { event.preventDefault(); assign(activeDriver, slot.dataset.position); } });
    });
    section.querySelector('[data-driver-pool]').addEventListener('dragover', (event) => event.preventDefault());
    section.querySelector('[data-driver-pool]').addEventListener('drop', (event) => { event.preventDefault(); unassign(event.dataTransfer.getData('text/plain')); });
    section.querySelectorAll('[data-bonus]').forEach((badge) => {
      const kind = badge.dataset.bonus;
      // Awards remain available even when their points bonus is disabled.
      badge.addEventListener('dragstart', (event) => event.dataTransfer.setData('application/x-result-bonus', kind));
      badge.addEventListener('click', () => { badge.classList.toggle('is-active'); section.dataset.activeBonus = badge.classList.contains('is-active') ? kind : ''; });
    });
    section.addEventListener('drop', (event) => {
      const kind = event.dataTransfer?.getData('application/x-result-bonus');
      const card = event.target.closest('.result-control-driver');
      if (kind && card) { event.preventDefault(); setExclusive(kind, card.dataset.driverId); }
    });
    section.addEventListener('click', (event) => {
      const card = event.target.closest('.result-control-driver');
      const kind = section.dataset.activeBonus;
      if (card && kind) { setExclusive(kind, card.dataset.driverId); section.dataset.activeBonus = ''; section.querySelectorAll('[data-bonus]').forEach((badge) => badge.classList.remove('is-active')); }
    });
    driverData.forEach((driver) => inputFor(driver, raceType, 'status')?.addEventListener('change', render));
    render();
    return section;
  }

  const tabs = document.createElement('div');
  tabs.className = 'result-control-tabs';
  const mainBoard = createRaceBoard('main');
  mount.append(tabs, mainBoard);
  const boards = [mainBoard];
  if (config.hasSprint) { const sprintBoard = createRaceBoard('sprint'); sprintBoard.hidden = true; mount.append(sprintBoard); boards.push(sprintBoard); }
  boards.forEach((board, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = index ? 'SPRINT' : 'HAUPTRENNEN';
    button.className = index ? '' : 'is-active';
    button.setAttribute('aria-pressed', String(index === 0));
    button.addEventListener('click', () => {
      boards.forEach((item, itemIndex) => { item.hidden = itemIndex !== index; });
      [...tabs.children].forEach((item, itemIndex) => { item.classList.toggle('is-active', itemIndex === index); item.setAttribute('aria-pressed', String(itemIndex === index)); });
      refreshSearch();
    });
    tabs.append(button);
  });

  addDriverSearch();

  form.addEventListener('submit', (event) => {
    const missing = driverData.filter((driver) => !inputFor(driver, 'main', 'position')?.value || (config.hasSprint && !inputFor(driver, 'sprint', 'position')?.value));
    if (missing.length) {
      event.preventDefault();
      mount.classList.add('has-error');
      mount.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const message = mount.querySelector('.result-control-error') || document.createElement('div');
      message.className = 'result-control-error';
      message.textContent = `${missing.length} Fahrer besitzen noch keine vollständige Platzierung.`;
      mount.prepend(message);
    }
  });
});
