document.addEventListener('DOMContentLoaded', () => {
  const shell = document.querySelector('[data-season-wizard]');
  if (!shell) return;
  let current = Number(shell.dataset.currentStep);
  const available = Number(shell.dataset.availableStep);
  const panels = [...shell.querySelectorAll('[data-setup-step]')];
  function show(step) {
    if (step < 1 || step > available || !panels.some((panel) => Number(panel.dataset.setupStep) === step)) return;
    current = step;
    panels.forEach((panel) => { panel.hidden = Number(panel.dataset.setupStep) !== current; });
    shell.querySelectorAll('[data-step-link]').forEach((link) => {
      if (Number(link.dataset.stepLink) === current) link.setAttribute('aria-current', 'step'); else link.removeAttribute('aria-current');
    });
    const url = new URL(window.location.href); url.searchParams.set('step', current); url.hash = ''; window.history.replaceState(null, '', url);
  }
  shell.querySelectorAll('[data-step-link]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); show(Number(link.dataset.stepLink)); }));
  panels.forEach((panel) => {
    const step = Number(panel.dataset.setupStep);
    const actions = document.createElement('div'); actions.className = 'form-actions setup-step-navigation';
    if (step > 1) { const back = document.createElement('button'); back.type = 'button'; back.className = 'button button-ghost'; back.textContent = '← Zurück'; back.addEventListener('click', () => show([...panels].reverse().find(p => Number(p.dataset.setupStep) < step)?.dataset.setupStep * 1)); actions.append(back); }
    if (step < available) { const next = document.createElement('button'); next.type = 'button'; next.className = 'button'; next.textContent = 'Weiter →'; next.addEventListener('click', () => show(panels.find(p => Number(p.dataset.setupStep) > step)?.dataset.setupStep * 1)); actions.append(next); }
    panel.querySelector('.setup-panel-content')?.append(actions);
  });
  const search = shell.querySelector('[data-driver-search]');
  search?.addEventListener('input', () => {
    const query = search.value.trim().toLocaleLowerCase('de-DE');
    shell.querySelectorAll('.setup-driver-card').forEach((card) => { card.hidden = !card.textContent.toLocaleLowerCase('de-DE').includes(query); });
  });
  shell.querySelectorAll('[data-selection-count]').forEach((counter) => {
    const name = counter.dataset.selectionCount;
    const choices = [...counter.closest('form').querySelectorAll(`input[name="${name}"]`)];
    const refresh = () => { counter.textContent = `${choices.filter((input) => input.checked).length} ${counter.dataset.selectionLabel || (name === 'driverIds' ? 'Stammfahrer' : 'Teams')} ausgewählt`; };
    choices.forEach((input) => input.addEventListener('change', refresh));
    refresh();
  });
  show(current);
});
