document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-driver-wizard]');
  if (!form) return;
  const labels = [...form.children].filter((node) => node.tagName === 'LABEL');
  const steps = ['1 · Name und Identität', '2 · Ränge auswählen', '3 · Profil und Angaben'];
  const groups = steps.map((title) => {
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = title;
    fieldset.append(legend);
    form.insertBefore(fieldset, form.querySelector('.form-actions'));
    return fieldset;
  });
  labels.forEach((label) => {
    const name = label.querySelector('input, select, textarea')?.name || '';
    const step = ['name', 'confirmDuplicateName', 'aliasesText'].includes(name) ? 0 : name.startsWith('role') ? 1 : 2;
    groups[step].append(label);
  });
  let current = 0;
  const actions = form.querySelector('.form-actions');
  const submit = actions.querySelector('[type="submit"]');
  const back = document.createElement('button');
  const next = document.createElement('button');
  back.type = next.type = 'button';
  back.className = 'button button-ghost'; next.className = 'button';
  back.textContent = 'Zurück'; next.textContent = 'Weiter';
  actions.prepend(back, next);
  const refresh = () => {
    groups.forEach((group, index) => { group.hidden = index !== current; });
    back.hidden = current === 0; next.hidden = current === 2; submit.hidden = current !== 2;
  };
  back.addEventListener('click', () => { current--; refresh(); });
  next.addEventListener('click', () => {
    const inputs = [...groups[current].querySelectorAll('input, select, textarea')];
    const name = form.elements.name;
    if (current === 0) name.value = name.value.trim();
    if (!inputs.every((input) => input.reportValidity())) return;
    current++; refresh();
  });
  form.addEventListener('submit', (event) => {
    if (current < 2) { event.preventDefault(); next.click(); }
  });
  form.addEventListener('invalid', (event) => {
    const index = groups.findIndex((group) => group.contains(event.target));
    if (index >= 0) { current = index; refresh(); }
  }, true);
  refresh();
});
