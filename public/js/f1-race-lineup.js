document.addEventListener('DOMContentLoaded', () => {
  const allowedReserveStatuses = new Set(['anwesend', 'unsicher', 'auf_abruf']);
  const replacementStatuses = new Set(['abgemeldet', 'unsicher', 'zu_spaet_abgemeldet']);

  document.querySelectorAll('[data-f1-lineup-matrix]').forEach((form) => {
    const reserveRows = [...form.querySelectorAll('[data-reserve-row]')];
    const regularRows = [...form.querySelectorAll('[data-regular-row]')];
    const feedback = form.querySelector('[data-lineup-feedback]');

    function reserveState(row) {
      return {
        id: String(row.dataset.reserveId),
        name: row.dataset.reserveName,
        status: row.querySelector('[data-reserve-status-input]')?.value || 'anwesend',
      };
    }

    function usedReserveIds(except = null) {
      const used = new Set();
      regularRows.forEach((row) => {
        const select = row.querySelector('[data-replacement-select]');
        if (select && select !== except && select.value) used.add(String(select.value));
      });
      return used;
    }

    function rebuildReplacementSelect(select) {
      if (!select || select.disabled) return;
      const previous = String(select.value || select.dataset.currentReplacement || '');
      const used = usedReserveIds(select);
      const options = reserveRows
        .filter((row) => row.dataset.reserveSelected !== 'false')
        .map(reserveState)
        .filter((reserve) => select.hasAttribute('data-vacant-select') ? ['anwesend','auf_abruf'].includes(reserve.status) : allowedReserveStatuses.has(reserve.status) || reserve.id === previous)
        .filter((reserve) => !used.has(reserve.id) || reserve.id === previous)
        .sort((left, right) => {
          const leftRank = left.status === 'anwesend' ? 0 : 1;
          const rightRank = right.status === 'anwesend' ? 0 : 1;
          return leftRank - rightRank || left.name.localeCompare(right.name, 'de');
        });

      select.replaceChildren(new Option(select.hasAttribute('data-vacant-select') ? 'Cockpit frei lassen' : 'Kein Ersatz', ''));
      options.forEach((reserve) => {
        const statusLabel = reserve.status === 'auf_abruf' ? 'AUF ABRUF' : reserve.status === 'anwesend' ? 'ANWESEND' : 'UNSICHER';
        select.add(new Option(`${reserve.name} · ${statusLabel}`, reserve.id, reserve.id === previous, reserve.id === previous));
      });
      if (![...select.options].some((option) => option.value === previous)) select.value = '';
      select.dataset.currentReplacement = select.value;
    }

    function updateAssignments() {
      const assignments = new Map();
      regularRows.forEach((row) => {
        const select = row.querySelector('[data-replacement-select]');
        if (!select?.value) return;
        assignments.set(String(select.value), {
          team: row.dataset.teamName,
          driver: row.querySelector('.f1-lineup-driver__name strong')?.textContent?.trim() || 'Stammfahrer',
        });
      });

      reserveRows.forEach((row) => {
        const target = row.querySelector('[data-reserve-assignment]');
        const assignment = assignments.get(String(row.dataset.reserveId));
        row.classList.toggle('is-assigned', Boolean(assignment));
        if (!target) return;
        target.replaceChildren();
        const state = document.createElement('span'); state.textContent = assignment ? 'EINGETEILT' : 'FREI';
        const detail = document.createElement('small'); detail.textContent = assignment ? `Ersatz für ${assignment.driver}` : 'Noch keinem Cockpit zugeordnet';
        target.append(state, detail);
      });
    }

    function updateRegularRow(row) {
      const status = row.querySelector('[data-regular-status]');
      const field = row.querySelector('[data-replacement-field]');
      const replacement = row.querySelector('[data-replacement-select]');
      if (!status || !field || !replacement || status.disabled) return;
      status.dataset.status = status.value;
      const allowed = replacementStatuses.has(status.value);
      field.hidden = !allowed;
      replacement.disabled = !allowed;
      if (!allowed) {
        replacement.value = '';
        replacement.dataset.currentReplacement = '';
      } else {
        rebuildReplacementSelect(replacement);
      }
    }

    function refresh() {
      regularRows.forEach(updateRegularRow);
      regularRows.forEach((row) => rebuildReplacementSelect(row.querySelector('[data-replacement-select]')));
      updateAssignments();
    }

    reserveRows.forEach((row) => {
      const visible = row.querySelector('[data-reserve-status-select]');
      const hidden = row.querySelector('[data-reserve-status-input]');
      visible?.addEventListener('change', () => {
        hidden.value = visible.value;
        row.dataset.status = visible.value;
        refresh();
      });
    });

    regularRows.forEach((row) => {
      row.querySelector('[data-regular-status]')?.addEventListener('change', refresh);
      row.querySelector('[data-replacement-select]')?.addEventListener('change', (event) => {
        event.currentTarget.dataset.currentReplacement = event.currentTarget.value;
        refresh();
      });
    });

    form.addEventListener('submit', (event) => {
      if (event.submitter?.matches('[data-remove-saved-reserve]')) {
        if (!window.confirm('Ersatzfahrer entfernen? Anwesenheit und Haupt-/Sprintergebnisse werden zurückgesetzt. Nicht gespeicherte Formularänderungen werden verworfen.')) event.preventDefault();
        return;
      }
      const selected = [...form.querySelectorAll('[data-replacement-select]')]
        .filter((select) => !select.disabled && select.value)
        .map((select) => String(select.value));
      const duplicate = selected.find((value, index) => selected.indexOf(value) !== index);
      const invalid = selected.find((id) => {
        const reserve = reserveRows.find((row) => String(row.dataset.reserveId) === id);
        return reserve && !allowedReserveStatuses.has(reserve.querySelector('[data-reserve-status-input]')?.value);
      });
      if (!duplicate && !invalid) return;
      event.preventDefault();
      feedback.classList.add('is-error');
      feedback.textContent = duplicate
        ? 'Ein Ersatzfahrer darf nur einem Cockpit zugeordnet werden.'
        : 'Nur anwesende oder unsichere Ersatzfahrer dürfen eingeteilt werden.';
      feedback.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const addReserve = form.querySelector('[data-add-reserve]');
    const picker = form.querySelector('[data-reserve-picker]');
    form.querySelector('[data-open-reserve-picker]')?.addEventListener('click', (event) => {
      picker.hidden = !picker.hidden; event.currentTarget.setAttribute('aria-expanded', String(!picker.hidden));
      if (!picker.hidden) addReserve.focus();
    });
    reserveRows.forEach((row) => row.querySelector('[data-remove-reserve]')?.addEventListener('click', () => {
      const id = row.dataset.reserveId;
      regularRows.forEach((regular) => {
        const select = regular.querySelector('[data-replacement-select]');
        if (select?.value === id && !select.disabled) { select.value = ''; select.dataset.currentReplacement = ''; }
      });
      row.hidden = true; row.dataset.reserveSelected = 'false';
      row.querySelectorAll('input, select').forEach((input) => { input.disabled = true; });
      if (![...addReserve.options].some((option) => option.value === id)) addReserve.add(new Option(row.dataset.reserveName, id));
      refresh();
    }));
    reserveRows.forEach((row) => {
      if (row.dataset.reserveSelected === 'false') {
        row.querySelectorAll('input, select').forEach((input) => { input.disabled = true; });
      }
    });
    addReserve?.addEventListener('change', () => {
      const row = reserveRows.find((candidate) => candidate.dataset.reserveId === addReserve.value);
      if (!row) return;
      row.hidden = false;
      row.dataset.reserveSelected = 'true';
      row.querySelectorAll('input, select').forEach((input) => { input.disabled = false; });
      addReserve.selectedOptions[0].remove();
      addReserve.value = '';
      picker.hidden = true;
      form.querySelector('[data-open-reserve-picker]')?.setAttribute('aria-expanded', 'false');
      refresh();
    });
    refresh();
  });
});
