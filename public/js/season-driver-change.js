document.addEventListener('DOMContentLoaded', () => {
  const contextForm = document.querySelector('.driver-change-context');
  const leagueSelect = contextForm?.querySelector('select[name="league"]');
  leagueSelect?.addEventListener('change', () => {
    const query = new URLSearchParams();
    if (leagueSelect.value) query.set('league', leagueSelect.value);
    window.location.assign(`/admin/season-driver-change${query.size ? `?${query}` : ''}`);
  });

  const form = document.querySelector('[data-driver-change-form]');
  if (!form) return;

  const round = form.querySelector('[data-change-round]');
  const operation = form.querySelector('[data-change-operation]');
  const operationStage = form.querySelector('[data-stage="operation"]');
  const team = form.querySelector('[data-change-team]');
  const teamStage = form.querySelector('[data-stage="team"]');
  const oldField = form.querySelector('[data-old-driver-field]');
  const newField = form.querySelector('[data-new-driver-field]');
  const oldDriver = form.querySelector('[data-old-driver]');
  const newDriver = form.querySelector('[data-new-driver]');
  const reserveChoice = form.querySelector('[data-reserve-choice]');
  const reserveDays = form.querySelector('[data-reserve-days]');
  const reserveRadios = [...form.querySelectorAll('input[name="staysReserve"]')];
  const reserveChecks = [...form.querySelectorAll('input[name="reserveLeagues"]')];
  const reviewButton = form.querySelector('[data-review-button]');

  function activeRegularOptions() {
    const targetRound = Number(round.value);
    return [...oldDriver.options].filter((option, index) => {
      if (!index || !targetRound) return false;
      const from = Number(option.dataset.fromRound);
      const to = option.dataset.toRound ? Number(option.dataset.toRound) : Number.POSITIVE_INFINITY;
      return targetRound >= from && targetRound <= to;
    });
  }

  function updateTeams() {
    const mode = operation.value;
    const active = activeRegularOptions();
    [...team.options].forEach((option, index) => {
      if (!index) return;
      const occupied = active.filter((driverOption) => driverOption.dataset.teamId === option.value).length;
      const free = Math.max(0, 2 - occupied);
      option.disabled = mode === 'fill' ? free < 1 : mode === 'release' ? occupied < 1 : true;
      option.hidden = option.disabled;
      option.textContent = mode === 'fill'
        ? `${option.textContent.split(' · ')[0]} · ${free} Stammplatz${free === 1 ? '' : 'e'} frei`
        : `${option.textContent.split(' · ')[0]} · ${occupied} Stammfahrer`;
    });
    if (team.selectedOptions[0]?.disabled) team.value = '';
  }

  function updateDrivers() {
    const targetTeam = team.value;
    const active = activeRegularOptions();
    const activeIds = new Set(active.map((option) => option.value));

    [...oldDriver.options].forEach((option, index) => {
      if (!index) return;
      const visible = active.includes(option) && option.dataset.teamId === targetTeam;
      option.hidden = !visible;
      option.disabled = !visible;
    });
    if (oldDriver.selectedOptions[0]?.disabled) oldDriver.value = '';

    [...newDriver.options].forEach((option, index) => {
      if (!index) return;
      const visible = !activeIds.has(option.value);
      option.hidden = !visible;
      option.disabled = !visible;
    });
    if (newDriver.selectedOptions[0]?.disabled) newDriver.value = '';
  }

  function refresh() {
    const hasRound = Boolean(round.value);
    const mode = operation.value;
    const hasOperation = hasRound && ['fill', 'release'].includes(mode);
    operationStage.hidden = !hasRound;
    teamStage.hidden = !hasOperation;

    if (hasOperation) updateTeams();
    const hasTeam = hasOperation && Boolean(team.value);
    oldField.hidden = !(hasTeam && mode === 'release');
    newField.hidden = !(hasTeam && mode === 'fill');
    oldDriver.required = hasTeam && mode === 'release';
    newDriver.required = hasTeam && mode === 'fill';
    if (hasTeam) updateDrivers();

    const hasDriver = mode === 'release' ? Boolean(oldDriver.value) : Boolean(newDriver.value);
    reserveChoice.hidden = !(hasTeam && mode === 'release' && hasDriver);
    const reserveAnswer = reserveRadios.find((input) => input.checked)?.value;
    reserveDays.hidden = reserveChoice.hidden || reserveAnswer !== '1';

    const reserveValid = mode !== 'release' || (
      reserveAnswer === '0' ||
      (reserveAnswer === '1' && reserveChecks.some((input) => input.checked))
    );
    reviewButton.hidden = !(hasTeam && hasDriver && reserveValid);
  }

  round.addEventListener('change', refresh);
  operation.addEventListener('change', () => {
    team.value = '';
    oldDriver.value = '';
    newDriver.value = '';
    refresh();
  });
  team.addEventListener('change', refresh);
  oldDriver.addEventListener('change', refresh);
  newDriver.addEventListener('change', refresh);
  reserveRadios.forEach((input) => input.addEventListener('change', refresh));
  reserveChecks.forEach((input) => input.addEventListener('change', refresh));
  refresh();
});
