document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-calendar-structure]');
  const list = form?.querySelector('[data-round-list]');
  let dragged = null;
  let dirty = false;
  function syncTest(scope) {
    const test = scope.querySelector('[data-test-toggle]').checked;
    const sprint = scope.querySelector('[data-sprint-toggle]');
    sprint.disabled = test;
    if (test) sprint.checked = false;
    scope.querySelector('[data-round-number-field]')?.toggleAttribute('hidden', test);
    scope.querySelector('[data-test-label]')?.toggleAttribute('hidden', !test);
    scope.classList.toggle('is-test', test);
    return test;
  }
  function refresh(changed = false) {
    let number = 0;
    const rows = [...(list?.children || [])];
    rows.forEach((row, index) => {
      const test = syncTest(row);
      row.querySelector('[data-round-number-field]').textContent = test ? '' : `R${++number}`;
      row.querySelector('[data-move="up"]').disabled = index === 0;
      row.querySelector('[data-move="down"]').disabled = index === rows.length - 1;
    });
    if (changed) dirty = true;
    const status = form?.querySelector('[data-order-status]');
    if (status) status.textContent = dirty ? 'Geändert – bitte speichern.' : '';
  }
  list?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-move]');
    if (!button) return;
    const row = button.closest('[data-round-row]');
    if (button.dataset.move === 'up' && row.previousElementSibling) list.insertBefore(row, row.previousElementSibling);
    if (button.dataset.move === 'down' && row.nextElementSibling) list.insertBefore(row.nextElementSibling, row);
    refresh(true); button.focus();
  });
  list?.addEventListener('change', () => refresh(true));
  list?.addEventListener('dragstart', (event) => {
    const handle = event.target.closest('[data-drag-handle]');
    if (!handle) { event.preventDefault(); return; }
    dragged = handle.closest('[data-round-row]');
    event.dataTransfer?.setData('text/plain', dragged.dataset.roundId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    dragged.classList.add('is-dragging');
  });
  list?.addEventListener('dragover', (event) => {
    if (!dragged) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const target = event.target.closest('[data-round-row]');
    if (!target || target === dragged) return;
    const box = target.getBoundingClientRect();
    list.insertBefore(dragged, event.clientY < box.top + box.height / 2 ? target : target.nextSibling);
    refresh(true);
  });
  list?.addEventListener('drop', (event) => { if (dragged) event.preventDefault(); refresh(true); });
  list?.addEventListener('dragend', () => { dragged?.classList.remove('is-dragging'); dragged = null; refresh(); });
  form?.addEventListener('submit', () => { dirty = false; });
  document.querySelectorAll('[data-calendar-entry-form]').forEach((entry) => {
    syncTest(entry);
    entry.querySelector('[data-test-toggle]').addEventListener('change', () => syncTest(entry));
    entry.addEventListener('submit', (event) => { if (dirty && !window.confirm('Ungespeicherte Strukturänderungen verwerfen und einen Eintrag hinzufügen?')) event.preventDefault(); });
  });
  refresh();
});
