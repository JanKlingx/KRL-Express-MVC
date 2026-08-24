document.addEventListener('DOMContentLoaded', () => {
  const board = document.querySelector('[data-race-control-lineup]');
  if (!board) return;

  const feedback = board.querySelector('[data-lineup-feedback]');
  const reserveCards = [...board.querySelectorAll('[data-reserve-card]')];
  const cockpits = [...board.querySelectorAll('[data-cockpit]')];
  let selectedReserveId = null;

  const cardFor = (id) => reserveCards.find((card) => String(card.dataset.reserveId) === String(id));
  const cockpitForReserve = (id) => cockpits.find((cockpit) => String(cockpit.querySelector('[data-replacement-input]')?.value || '') === String(id));
  const setFeedback = (message, error = false) => {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.toggle('is-error', error);
  };

  function refreshCard(card) {
    const assigned = Boolean(cockpitForReserve(card.dataset.reserveId));
    const locked = card.classList.contains('is-locked');
    const status = card.querySelector('[data-reserve-status-input]')?.value;
    const available = ['anwesend', 'unsicher', 'auf_abruf'].includes(status);
    card.classList.toggle('is-assigned', assigned);
    card.classList.toggle('is-unavailable', !available);
    card.draggable = !assigned && !locked && available;
    card.setAttribute('aria-disabled', String(assigned || locked || !available));
    const state = card.querySelector(':scope > span');
    if (state) state.textContent = locked ? '🔒 BESTÄTIGT' : assigned ? 'EINGETEILT' : available ? 'VERFÜGBAR' : 'NICHT VERFÜGBAR';
  }

  function renderAssignment(cockpit, card) {
    const seat = cockpit.querySelector('[data-seat]');
    seat.innerHTML = '';
    const assignment = document.createElement('div');
    assignment.className = 'race-control-assignment';
    assignment.dataset.assignment = '';
    assignment.dataset.reserveId = card.dataset.reserveId;
    const state = document.createElement('span');
    state.textContent = 'EINGETEILT';
    const name = document.createElement('strong');
    name.textContent = card.dataset.reserveName;
    const detail = document.createElement('small');
    detail.textContent = `Ersatz für ${cockpit.querySelector('.is-regular strong')?.textContent || 'Stammfahrer'}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.dataset.unassign = '';
    remove.setAttribute('aria-label', 'Zuordnung entfernen');
    remove.textContent = '×';
    assignment.append(state, name, detail, remove);
    seat.append(assignment);
  }

  function clearCockpit(cockpit, announce = false) {
    if (cockpit.classList.contains('is-locked')) {
      setFeedback('Diese Zuordnung ist durch die bestätigte Anwesenheit gesperrt.', true);
      return false;
    }
    const input = cockpit.querySelector('[data-replacement-input]');
    const previousCard = cardFor(input.value);
    input.value = '';
    const seat = cockpit.querySelector('[data-seat]');
    seat.innerHTML = '<span class="race-control-seat-empty">ERSATZ HIER ABLEGEN</span>';
    if (previousCard) refreshCard(previousCard);
    if (announce) setFeedback('Ersatzfahrer-Zuordnung wurde im Entwurf entfernt. Zum Übernehmen speichern.');
    return true;
  }

  function assign(card, cockpit) {
    if (!card || !cockpit) return;
    if (card.classList.contains('is-locked')) return setFeedback('Die Anwesenheit dieses Ersatzfahrers ist bereits bestätigt.', true);
    const status = card.querySelector('[data-reserve-status-input]')?.value;
    if (!['anwesend', 'unsicher', 'auf_abruf'].includes(status)) return setFeedback(`${card.dataset.reserveName} ist mit diesem Status nicht einsetzbar.`, true);
    const currentCockpit = cockpitForReserve(card.dataset.reserveId);
    if (currentCockpit && currentCockpit !== cockpit) return setFeedback(`${card.dataset.reserveName} ist in diesem Rennwochenende bereits einem Cockpit zugeordnet.`, true);
    if (cockpit.classList.contains('is-banned')) return setFeedback('Ein Fahrer mit Rennsperre darf nicht ersetzt werden.', true);
    if (cockpit.classList.contains('is-locked')) return setFeedback('Dieses Cockpit besitzt bereits eine bestätigte, gesperrte Zuordnung.', true);
    if (cockpit.querySelector('[data-replacement-input]').value && !clearCockpit(cockpit)) return;
    const regularStatus = cockpit.querySelector('[data-regular-status]');
    if (regularStatus && !['abgemeldet', 'unsicher'].includes(regularStatus.value)) regularStatus.value = 'unsicher';
    cockpit.querySelector('[data-replacement-input]').value = card.dataset.reserveId;
    renderAssignment(cockpit, card);
    refreshCard(card);
    selectedReserveId = null;
    reserveCards.forEach((item) => item.classList.remove('is-selected'));
    setFeedback(`${card.dataset.reserveName} ist jetzt ${cockpit.dataset.teamName} zugeordnet. Aufstellung speichern, um zu bestätigen.`);
  }

  reserveCards.forEach((card) => {
    const select = card.querySelector('[data-reserve-status-select]');
    const input = card.querySelector('[data-reserve-status-input]');
    select?.addEventListener('change', () => { input.value = select.value; refreshCard(card); });
    card.addEventListener('dragstart', (event) => {
      if (!card.draggable) return event.preventDefault();
      event.dataTransfer.setData('text/plain', card.dataset.reserveId);
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('is-dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    card.addEventListener('click', (event) => {
      if (event.target.closest('select')) return;
      if (!card.draggable) return;
      selectedReserveId = selectedReserveId === card.dataset.reserveId ? null : card.dataset.reserveId;
      reserveCards.forEach((item) => item.classList.toggle('is-selected', item.dataset.reserveId === selectedReserveId));
      if (selectedReserveId) setFeedback(`${card.dataset.reserveName} ausgewählt. Jetzt ein Cockpit antippen.`);
    });
    card.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && card.draggable) { event.preventDefault(); card.click(); }
    });
    refreshCard(card);
  });

  cockpits.forEach((cockpit) => {
    const seat = cockpit.querySelector('[data-seat]');
    seat.addEventListener('dragover', (event) => { event.preventDefault(); cockpit.classList.add('is-drop-target'); });
    seat.addEventListener('dragleave', () => cockpit.classList.remove('is-drop-target'));
    seat.addEventListener('drop', (event) => {
      event.preventDefault();
      cockpit.classList.remove('is-drop-target');
      assign(cardFor(event.dataTransfer.getData('text/plain')), cockpit);
    });
    seat.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-unassign]');
      if (remove) return clearCockpit(cockpit, true);
      if (selectedReserveId) assign(cardFor(selectedReserveId), cockpit);
    });
    seat.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && selectedReserveId) { event.preventDefault(); assign(cardFor(selectedReserveId), cockpit); }
    });
    cockpit.querySelector('[data-regular-status]')?.addEventListener('change', (event) => {
      if (!['abgemeldet', 'unsicher'].includes(event.target.value) && cockpit.querySelector('[data-replacement-input]').value) clearCockpit(cockpit, true);
    });
  });

  board.addEventListener('submit', (event) => {
    const ids = cockpits.map((cockpit) => cockpit.querySelector('[data-replacement-input]').value).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      event.preventDefault();
      setFeedback('Ein Ersatzfahrer wurde mehrfach zugeordnet. Bitte den markierten Konflikt korrigieren.', true);
    }
  });
});

document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('form.attendance-board');
  if (!form) return;
  const sourceGrid = form.querySelector('.lineup-team-grid');
  if (!sourceGrid) return;

  const labels = {
    anwesend: 'ANWESEND',
    zu_spaet_vorbesprechung: 'ZU SPÄT VORBESPR.',
    unsicher: 'UNSICHER',
    abgemeldet: 'ABGEMELDET',
    unabgemeldet: 'NICHT ERSCHIENEN',
    zu_spaet_abgemeldet: 'ZU SPÄT ABGEMELDET'
  };
  const board = document.createElement('section');
  board.className = 'attendance-race-control';
  const heading = document.createElement('header');
  heading.innerHTML = '<div><span>RACE CONTROL</span><strong>Fahrer auf Anwesenheitsstatus ziehen</strong><small>Antippen + Ziel antippen ist auf Touch-Geräten möglich.</small></div><button type="button" class="button button-ghost" data-attendance-details>Detailansicht</button>';
  const zones = document.createElement('div');
  zones.className = 'attendance-status-zones';
  board.append(heading, zones);
  form.insertBefore(board, sourceGrid);
  form.classList.add('has-race-control-attendance');

  let selectedSelect = null;
  function driverName(select) {
    const host = select.closest('.attendance-active-driver, .attendance-team-row');
    return host?.querySelector('.lineup-driver-name strong')?.textContent.replace(/^\s*#\d+\s*·\s*/, '').trim() || 'Fahrer';
  }
  function rebuild() {
    zones.innerHTML = '';
    const selects = [...form.querySelectorAll('[data-attendance-status]')].filter((select) => !select.disabled);
    Object.entries(labels).forEach(([value, label]) => {
      const zone = document.createElement('div');
      zone.className = `attendance-status-zone status-${value}`;
      zone.dataset.attendanceZone = value;
      zone.tabIndex = 0;
      zone.innerHTML = `<header><strong>${label}</strong><span>0</span></header><div data-status-cards></div>`;
      zones.append(zone);
    });
    selects.forEach((select) => {
      const zone = zones.querySelector(`[data-attendance-zone="${select.value}"]`) || zones.querySelector('[data-attendance-zone="anwesend"]');
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'attendance-control-card';
      card.draggable = true;
      card.textContent = driverName(select);
      card.dataset.selectName = select.name;
      card.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', select.name));
      card.addEventListener('click', () => {
        selectedSelect = selectedSelect === select ? null : select;
        zones.querySelectorAll('.attendance-control-card').forEach((item) => item.classList.toggle('is-selected', item.dataset.selectName === selectedSelect?.name));
      });
      zone.querySelector('[data-status-cards]').append(card);
    });
    zones.querySelectorAll('[data-attendance-zone]').forEach((zone) => {
      zone.querySelector('header span').textContent = zone.querySelectorAll('.attendance-control-card').length;
      const apply = (select) => {
        if (!select) return;
        select.value = zone.dataset.attendanceZone;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        selectedSelect = null;
        rebuild();
      };
      zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('is-drop-target'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('is-drop-target'));
      zone.addEventListener('drop', (event) => {
        event.preventDefault();
        zone.classList.remove('is-drop-target');
        apply([...form.querySelectorAll('[data-attendance-status]')].find((select) => select.name === event.dataTransfer.getData('text/plain')));
      });
      zone.addEventListener('click', (event) => { if (!event.target.closest('.attendance-control-card')) apply(selectedSelect); });
      zone.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && selectedSelect) { event.preventDefault(); apply(selectedSelect); } });
    });
  }

  form.querySelectorAll('[data-uncertain-present]').forEach((control) => control.addEventListener('change', () => setTimeout(rebuild, 0)));
  heading.querySelector('[data-attendance-details]').addEventListener('click', (event) => {
    const open = form.classList.toggle('show-attendance-details');
    event.currentTarget.textContent = open ? 'Details schließen' : 'Detailansicht';
  });
  form.addEventListener('submit', (event) => {
    const unresolved = [...form.querySelectorAll('[data-attendance-status]')].filter((select) => !select.disabled && select.value === 'unsicher');
    if (unresolved.length) {
      event.preventDefault();
      unresolved.forEach((select) => select.closest('.attendance-active-driver, .attendance-team-row')?.classList.add('has-error'));
      const first = zones.querySelector('[data-attendance-zone="unsicher"]');
      first?.classList.add('has-error');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  rebuild();
});
