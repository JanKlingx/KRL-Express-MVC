(() => {
  const form = document.querySelector('[data-lmu-wizard]'); if (!form) return;
  const steps = [...form.querySelectorAll('[data-lmu-step]')], links = [...document.querySelectorAll('[data-lmu-step-link]')];
  const status = form.querySelector('[data-wizard-status]'), back = form.querySelector('[data-wizard-back]'), next = form.querySelector('[data-wizard-next]'), submit = form.querySelector('[data-wizard-submit]');
  let current = Math.max(0, Math.min(7, Number(form.dataset.savedStep || 1) - 1)), busy = false;
  const checked = name => [...form.querySelectorAll(`[name="${name}"]:checked`)].map(input => input.value);
  function choices() {
    const drivers = checked('driverIds'), teams = checked('teamIds');
    form.querySelector('[data-driver-count]').textContent = drivers.length + ' Fahrer ausgewählt';
    form.querySelectorAll('[data-cockpit-team]').forEach(card => {
      const enabled = teams.includes(card.dataset.cockpitTeam); card.hidden = !enabled;
      card.querySelectorAll('select').forEach(select => {
        select.disabled = !enabled; if (!enabled || !drivers.includes(select.value)) select.value = '';
        [...select.options].forEach(option => { option.hidden = option.disabled = Boolean(option.value && !drivers.includes(option.value)); });
      });
    });
    const seats = [...form.querySelectorAll('[data-cockpit-driver]')].filter(select => !select.disabled && select.value);
    form.querySelector('[data-reserve-summary]').textContent = (drivers.length - new Set(seats.map(s => s.value)).size) + ' Ersatzfahrer ohne Stammcockpit';
    form.querySelectorAll('[data-calendar-preview]').forEach(preview => preview.hidden = preview.dataset.calendarPreview !== form.elements.LmuCalendarId.value);
    const review = form.querySelector('[data-setup-review]'); review.replaceChildren();
    for (const [label, value] of [['Liga', form.elements.LeagueId.selectedOptions[0]?.textContent], ['Saison', form.elements.name.value], ['Kalender', form.elements.LmuCalendarId.selectedOptions[0]?.textContent], ['Punktesystem', form.elements.PointsSchemeId.selectedOptions[0]?.textContent], ['Fahrer', drivers.length], ['Teams', teams.length], ['Stammfahrer', seats.length], ['Ersatzfahrer', drivers.length - new Set(seats.map(s => s.value)).size]]) {
      const p = document.createElement('p'); p.textContent = label + ': ' + (value ?? '–'); review.append(p);
    }
  }
  function show() {
    steps.forEach((step, i) => step.hidden = i !== current); links.forEach((link, i) => link.setAttribute('aria-current', i === current ? 'step' : 'false'));
    back.hidden = current === 0; next.hidden = current === 7; submit.hidden = current !== 7; choices();
  }
  function valid(index) {
    const invalid = [...steps[index].querySelectorAll('input,select')].find(input => !input.disabled && !input.checkValidity());
    if (invalid) { current = index; show(); invalid.reportValidity(); return false; }
    let error = '';
    if (index === 4 && !checked('driverIds').length) error = 'Bitte mindestens einen Fahrer auswählen.';
    if (index === 5 && !checked('teamIds').length) error = 'Bitte mindestens ein LMU-Team auswählen.';
    if (index === 6) { const ids = [...form.querySelectorAll('[data-cockpit-driver]')].filter(s => !s.disabled && s.value).map(s => s.value); if (new Set(ids).size !== ids.length) error = 'Ein Fahrer kann nur ein Cockpit belegen.'; }
    if (error) { current = index; show(); status.textContent = error; return false; } return true;
  }
  async function navigate(target) {
    if (busy) return; choices();
    if (target > current) for (let i = 0; i < target; i++) if (!valid(i)) return;
    busy = true; status.textContent = 'Entwurf wird gespeichert …';
    try {
      const data = new URLSearchParams(new FormData(form)); data.set('step', String(target + 1));
      const response = await fetch('/admin/lmu-season-setup/draft', { method:'POST', headers:{Accept:'application/json'}, body:data });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Entwurf konnte nicht gespeichert werden. Bitte erneut versuchen.');
      current = target; show(); status.textContent = 'Entwurf gespeichert.';
    } catch (error) { status.textContent = error.message; } finally { busy = false; }
  }
  next.addEventListener('click', () => navigate(current + 1)); back.addEventListener('click', () => navigate(current - 1)); links.forEach((link,i) => link.addEventListener('click', () => navigate(i)));
  form.addEventListener('change', choices);
  form.addEventListener('invalid', event => { current = steps.findIndex(step => step.contains(event.target)); show(); }, true);
  form.addEventListener('submit', event => { choices(); for (let i=0;i<8;i++) if (!valid(i)) { event.preventDefault(); break; } });
  form.querySelector('[data-wizard-driver-search]').addEventListener('input', event => form.querySelectorAll('[data-wizard-driver-name]').forEach(row => row.hidden = !row.dataset.wizardDriverName.includes(event.target.value.trim().toLowerCase())));
  for (const [selector, value] of [['[data-driver-all]',true],['[data-driver-none]',false]]) form.querySelector(selector).addEventListener('click', () => { form.querySelectorAll('[name="driverIds"]').forEach(input => input.checked = value); choices(); });
  show();
})();
