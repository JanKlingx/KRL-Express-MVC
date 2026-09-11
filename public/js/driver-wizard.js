document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-driver-wizard]');
  if (!form) return;
  const actions = form.querySelector('.form-actions');
  const labels = [...form.children].filter((node) => node.tagName === 'LABEL');
  const titles = ['1 · Name und Identität', '2 · Sichten auswählen', '3 · Ränge', '4 · Weitere Angaben'];
  const groups = titles.map((title, index) => {
    if (index === 1) return form.querySelector('[data-driver-view-picker]');
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend'); legend.textContent = title;
    group.append(legend); return group;
  });
  groups.forEach((group) => form.insertBefore(group, actions));
  labels.forEach((label) => {
    const name = label.querySelector('input, select, textarea')?.name || '';
    groups[['name', 'confirmDuplicateName', 'aliasesText'].includes(name) ? 0 : name.startsWith('role') ? 2 : 3].append(label);
  });
  const submit = actions.querySelector('[type="submit"]');
  const back = document.createElement('button'), next = document.createElement('button');
  back.type = next.type = 'button'; back.className = 'button button-ghost'; next.className = 'button';
  back.textContent = 'Zurück'; next.textContent = 'Weiter'; actions.prepend(back, next);
  let current = 0;
  function refresh() {
    const views = [...form.querySelectorAll('[name="driverViews"]:checked')].map((input) => input.value);
    labels.forEach((label) => {
      const view = label.dataset.driverView;
      const enabled = !view || view === 'common' || views.includes(view) || (view === 'f1' && views.includes('formerF1') && !label.querySelector('[name^="role"]'));
      label.hidden = !enabled;
      label.querySelectorAll('input, select, textarea').forEach((input) => { input.disabled = !enabled; });
    });
    groups.forEach((group, index) => { group.hidden = index !== current; });
    back.hidden = current === 0; next.hidden = current === 3; submit.hidden = current !== 3;
  }
  function hasRanks() { return [...groups[2].querySelectorAll('input')].some((input) => !input.disabled); }
  back.addEventListener('click', () => { current--; if (current === 2 && !hasRanks()) current--; refresh(); });
  next.addEventListener('click', () => {
    if (current === 0) form.elements.namedItem('name').value = form.elements.namedItem('name').value.trim();
    if (current === 1) {
      const missing = !form.querySelector('[name="driverViews"]:checked');
      form.querySelector('[data-view-error]').hidden = !missing;
      if (missing) return;
    }
    if (![...groups[current].querySelectorAll('input, select, textarea')].every((input) => input.disabled || input.reportValidity())) return;
    current++; if (current === 2 && !hasRanks()) current++; refresh();
  });
  form.querySelectorAll('[name="driverViews"]').forEach((input) => input.addEventListener('change', refresh));
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA' && current < 3) { event.preventDefault(); next.click(); }
  });
  form.addEventListener('submit', (event) => { if (current < 3) { event.preventDefault(); next.click(); } });
  form.addEventListener('invalid', (event) => {
    const index = groups.findIndex((group) => group.contains(event.target));
    if (index >= 0) { current = index; refresh(); }
  }, true);
  refresh();
});
