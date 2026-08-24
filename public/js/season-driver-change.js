document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-driver-change-form]');
  if (!form) return;

  const teamSelect = form.querySelector('[data-change-team]');
  const oldSelect = form.querySelector('[data-old-driver]');
  const newSelect = form.querySelector('[data-new-driver]');
  const carryOption = form.querySelector('[data-carry-option]');
  const carryCheckbox = carryOption?.querySelector('input');
  const preview = form.querySelector('[data-change-preview]');
  const roundInput = form.querySelector('[name="effectiveRound"]');

  function updateOldDrivers() {
    const teamId = teamSelect.value;
    let firstVisible = '';
    [...oldSelect.options].forEach((option, index) => {
      if (index === 0) return;
      const visible = option.dataset.teamId === teamId;
      option.hidden = !visible;
      option.disabled = !visible;
      if (visible && !firstVisible) firstVisible = option.value;
    });
    if (!oldSelect.selectedOptions[0]?.disabled && oldSelect.value) return;
    oldSelect.value = firstVisible;
  }

  function updateCarryOption() {
    const option = newSelect.selectedOptions[0];
    const isReserve = option?.dataset.isReserve === 'true';
    const assignedTeam = option?.dataset.reserveTeamId;
    const canRequestCarry = Boolean(
      teamSelect.value && isReserve && (!assignedTeam || assignedTeam === teamSelect.value)
    );
    carryOption.hidden = !canRequestCarry;
    carryCheckbox.disabled = !canRequestCarry;
    if (!canRequestCarry) carryCheckbox.checked = false;
  }

  function updatePreview() {
    const team = teamSelect.selectedOptions[0]?.textContent?.trim();
    const oldDriver = oldSelect.selectedOptions[0]?.textContent?.trim();
    const newDriver = newSelect.selectedOptions[0]?.textContent?.trim();
    const round = roundInput.value;
    const ready = teamSelect.value && oldSelect.value && newSelect.value && round;
    preview.querySelector('strong').textContent = ready
      ? `${team}: ${oldDriver} → ${newDriver} ab R${round}`
      : 'Team, alter und neuer Fahrer auswählen';
    preview.querySelector('small').textContent = ready
      ? 'Der bisherige Stint endet eine Runde davor. Alte Ergebnisse und Teampunkte bleiben bestehen.'
      : 'Danach wird der historische Zeitraum vor dem Speichern zusammengefasst.';
  }

  function refresh() {
    updateOldDrivers();
    updateCarryOption();
    updatePreview();
  }

  teamSelect.addEventListener('change', refresh);
  oldSelect.addEventListener('change', updatePreview);
  newSelect.addEventListener('change', () => {
    updateCarryOption();
    updatePreview();
  });
  roundInput.addEventListener('input', updatePreview);
  refresh();
});
