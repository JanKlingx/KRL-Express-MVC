document.addEventListener("DOMContentLoaded", () => {
  const allowedReserveStatuses = new Set([
    "anwesend",
    "unsicher",
    "auf_abruf",
  ]);

  const replacementAllowedForRegular = new Set([
    "abgemeldet",
    "unsicher",
  ]);

  const reserveStatusSelects = [
    ...document.querySelectorAll("[data-reserve-status]"),
  ];

  const regularRows = [
    ...document.querySelectorAll(".lineup-regular-row"),
  ];

  function getAvailableReserves() {
    return reserveStatusSelects
      .map((select) => ({
        id: String(select.dataset.reserveId),
        name: select.dataset.reserveName,
        status: select.value,
      }))
      .filter((reserve) =>
        allowedReserveStatuses.has(reserve.status)
      );
  }

  function rebuildReplacementSelect(select) {
    const previousValue =
      select.value ||
      select.dataset.currentReplacement ||
      "";

    const availableReserves =
      getAvailableReserves();

    select.innerHTML = "";

    const emptyOption =
      document.createElement("option");

    emptyOption.value = "";
    emptyOption.textContent = "Kein Ersatz";

    select.appendChild(emptyOption);

    availableReserves.forEach((reserve) => {
      const option =
        document.createElement("option");

      option.value =
        reserve.id;

      option.textContent =
        reserve.name;

      if (
        String(previousValue) ===
        String(reserve.id)
      ) {
        option.selected = true;
      }

      select.appendChild(option);
    });

    /*
     * Falls der vorher ausgewählte Ersatzfahrer
     * inzwischen nicht mehr zulässig ist,
     * Auswahl zurücksetzen.
     */
    const stillAvailable =
      availableReserves.some(
        (reserve) =>
          String(reserve.id) ===
          String(previousValue)
      );

    if (
      previousValue &&
      !stillAvailable
    ) {
      select.value = "";
    }

    select.dataset.currentReplacement =
      select.value;
  }

  function updateRegularRow(row) {
    const statusSelect =
      row.querySelector(
        "[data-regular-status]"
      );

    const replacementField =
      row.querySelector(
        "[data-replacement-field]"
      );

    const replacementSelect =
      row.querySelector(
        "[data-replacement-select]"
      );

    /*
     * Rennsperre hat keinen normalen
     * Status-Select.
     */
    if (
      !statusSelect ||
      !replacementField ||
      !replacementSelect
    ) {
      return;
    }

    const canUseReplacement =
      replacementAllowedForRegular.has(
        statusSelect.value
      );

    replacementField.hidden =
      !canUseReplacement;

    replacementSelect.disabled =
      !canUseReplacement;

    if (!canUseReplacement) {
      replacementSelect.value = "";
      replacementSelect.dataset.currentReplacement =
        "";
      return;
    }

    rebuildReplacementSelect(
      replacementSelect
    );
  }

  function refreshAllReplacementSelects() {
    regularRows.forEach((row) => {
      updateRegularRow(row);
    });
  }

  /*
   * Stammfahrerstatus geändert.
   */
  regularRows.forEach((row) => {
    const statusSelect =
      row.querySelector(
        "[data-regular-status]"
      );

    if (!statusSelect) {
      return;
    }

    statusSelect.addEventListener(
      "change",
      () => updateRegularRow(row)
    );
  });

  /*
   * Ersatzfahrerstatus geändert.
   *
   * Beispiel:
   * angefragt -> anwesend
   * => Fahrer wird sofort in den
   * Ersatz-Auswahllisten verfügbar.
   */
  reserveStatusSelects.forEach(
    (select) => {
      select.addEventListener(
        "change",
        refreshAllReplacementSelects
      );
    }
  );

  refreshAllReplacementSelects();
});


