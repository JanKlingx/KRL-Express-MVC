document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-driver-change-form]');
  if (!form) return;
  const operation = form.querySelector('[data-change-operation]');
  const team = form.querySelector('[data-change-team]');
  const round = form.querySelector('[data-change-round]');
  const oldField = form.querySelector('[data-old-driver-field]');
  const newField = form.querySelector('[data-new-driver-field]');
  const oldDriver = form.querySelector('[data-old-driver]');

  function updateOldDrivers() {
    const targetRound = Number(round.value);
    let first = '';
    [...oldDriver.options].forEach((option, index) => {
      if (!index) return;
      const from = Number(option.dataset.fromRound);
      const to = option.dataset.toRound ? Number(option.dataset.toRound) : Number.POSITIVE_INFINITY;
      const visible = option.dataset.teamId === team.value && targetRound >= from && targetRound <= to;
      option.hidden = !visible;
      option.disabled = !visible;
      if (visible && !first) first = option.value;
    });
    if (oldDriver.selectedOptions[0]?.disabled || !oldDriver.value) oldDriver.value = first;
  }

  function refresh() {
    const value = operation.value;
    oldField.hidden = value === 'fill';
    newField.hidden = value === 'release';
    oldDriver.required = value !== 'fill';
    newField.querySelector('select').required = value !== 'release';
    updateOldDrivers();
    [...team.options].forEach((option) => {
      if (!option.value) return;
      option.disabled = value === 'fill' && Number(option.dataset.freeSeats) < 1;
    });
    if (team.selectedOptions[0]?.disabled) team.value = '';
  }
  operation.addEventListener('change', refresh);
  team.addEventListener('change', updateOldDrivers);
  round.addEventListener('change', updateOldDrivers);
  refresh();
});

