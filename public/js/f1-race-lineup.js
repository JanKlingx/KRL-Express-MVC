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

  let draggedReserveId = null;

  /*
   * =====================================================
   * STATUS-KLASSE AKTUALISIEREN
   * =====================================================
   */

  function updateStatusClass(select) {
    if (!select) return;

    [...select.classList]
      .filter((className) =>
        className.startsWith("status-"),
      )
      .forEach((className) =>
        select.classList.remove(className),
      );

    select.classList.add(
      `status-${select.value}`,
    );
  }


  /*
   * =====================================================
   * VERFÜGBARE ERSATZFAHRER
   * =====================================================
   */

  function getAvailableReserves() {
    return reserveStatusSelects
      .map((select) => ({
        id: String(
          select.dataset.reserveId,
        ),

        name:
          select.dataset.reserveName,

        status:
          select.value,

        select,
      }))
      .filter((reserve) =>
        allowedReserveStatuses.has(
          reserve.status,
        ),
      );
  }


  /*
   * =====================================================
   * BEREITS VERWENDETE ERSATZFAHRER
   * =====================================================
   */

  function getUsedReserveIds(
    exceptSelect = null,
  ) {
    const used =
      new Set();

    document
      .querySelectorAll(
        "[data-replacement-select]",
      )
      .forEach((select) => {
        if (
          select === exceptSelect ||
          !select.value
        ) {
          return;
        }

        used.add(
          String(select.value),
        );
      });

    return used;
  }


  /*
   * =====================================================
   * ERSATZ-DROPDOWN NEU AUFBAUEN
   * =====================================================
   */

  function rebuildReplacementSelect(
    select,
  ) {
    if (!select) return;

    const previousValue =
      select.value ||
      select.dataset.currentReplacement ||
      "";

    const availableReserves =
      getAvailableReserves();

    const used =
      getUsedReserveIds(select);

    select.innerHTML = "";

    const emptyOption =
      document.createElement("option");

    emptyOption.value = "";
    emptyOption.textContent =
      "Kein Ersatz";

    select.appendChild(
      emptyOption,
    );

    availableReserves.forEach(
      (reserve) => {
        /*
         * Bereits in anderem Cockpit verwendet.
         */
        if (
          used.has(reserve.id) &&
          String(previousValue) !==
            reserve.id
        ) {
          return;
        }

        const option =
          document.createElement(
            "option",
          );

        option.value =
          reserve.id;

        option.textContent =
          reserve.name;

        if (
          String(previousValue) ===
          reserve.id
        ) {
          option.selected = true;
        }

        select.appendChild(
          option,
        );
      },
    );

    const stillAvailable =
      [...select.options].some(
        (option) =>
          String(option.value) ===
          String(previousValue),
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


  /*
   * =====================================================
   * EINEN STAMMFAHRER AKTUALISIEREN
   * =====================================================
   */

  function updateRegularRow(row) {
    const statusSelect =
      row.querySelector(
        "[data-regular-status]",
      );

    const replacementField =
      row.querySelector(
        "[data-replacement-field]",
      );

    const replacementSelect =
      row.querySelector(
        "[data-replacement-select]",
      );

    /*
     * Rennsperre:
     * kein normaler Status-Select,
     * kein Ersatz.
     */
    if (!statusSelect) {
      if (replacementField) {
        replacementField.hidden =
          true;
      }

      if (replacementSelect) {
        replacementSelect.disabled =
          true;

        replacementSelect.value =
          "";
      }

      row.classList.remove(
        "can-receive-reserve",
      );

      return;
    }

    updateStatusClass(
      statusSelect,
    );

    const canUseReplacement =
      replacementAllowedForRegular.has(
        statusSelect.value,
      );

    row.classList.toggle(
      "can-receive-reserve",
      canUseReplacement,
    );

    if (!replacementField) {
      return;
    }

    replacementField.hidden =
      !canUseReplacement;

    if (!replacementSelect) {
      return;
    }

    replacementSelect.disabled =
      !canUseReplacement;

    if (!canUseReplacement) {
      replacementSelect.value =
        "";

      replacementSelect.dataset.currentReplacement =
        "";

      refreshAllReplacementSelects(
        row,
      );

      return;
    }

    rebuildReplacementSelect(
      replacementSelect,
    );
  }


  /*
   * =====================================================
   * ALLE ERSATZFELDER AKTUALISIEREN
   * =====================================================
   */

  function refreshAllReplacementSelects(
    skipRow = null,
  ) {
    regularRows.forEach((row) => {
      const replacementSelect =
        row.querySelector(
          "[data-replacement-select]",
        );

      const statusSelect =
        row.querySelector(
          "[data-regular-status]",
        );

      if (
        !replacementSelect ||
        !statusSelect
      ) {
        return;
      }

      const allowed =
        replacementAllowedForRegular.has(
          statusSelect.value,
        );

      if (!allowed) {
        return;
      }

      if (row !== skipRow) {
        rebuildReplacementSelect(
          replacementSelect,
        );
      }
    });
  }


  /*
   * =====================================================
   * ERSATZKARTEN DRAGGABLE MACHEN
   * =====================================================
   */

  reserveStatusSelects.forEach(
    (statusSelect) => {
      const card =
        statusSelect.closest(
          ".reserve-driver-card",
        );

      if (!card) {
        return;
      }

      function updateDragState() {
        const allowed =
          allowedReserveStatuses.has(
            statusSelect.value,
          );

        card.draggable =
          allowed;

        card.classList.toggle(
          "is-draggable",
          allowed,
        );

        card.classList.toggle(
          "is-unavailable",
          !allowed,
        );

        updateStatusClass(
          statusSelect,
        );
      }

      updateDragState();

      statusSelect.addEventListener(
        "change",
        () => {
          updateDragState();

          refreshAllReplacementSelects();
        },
      );

      card.addEventListener(
        "dragstart",
        (event) => {
          if (
            !allowedReserveStatuses.has(
              statusSelect.value,
            )
          ) {
            event.preventDefault();
            return;
          }

          draggedReserveId =
            String(
              statusSelect.dataset.reserveId,
            );

          event.dataTransfer.effectAllowed =
            "move";

          event.dataTransfer.setData(
            "text/plain",
            draggedReserveId,
          );

          card.classList.add(
            "is-dragging",
          );

          document.body.classList.add(
            "is-dragging-reserve",
          );
        },
      );

      card.addEventListener(
        "dragend",
        () => {
          draggedReserveId = null;

          card.classList.remove(
            "is-dragging",
          );

          document.body.classList.remove(
            "is-dragging-reserve",
          );

          regularRows.forEach(
            (row) =>
              row.classList.remove(
                "is-drop-target",
              ),
          );
        },
      );
    },
  );


  /*
   * =====================================================
   * STAMMFAHRER ALS DROP-ZIEL
   * =====================================================
   */

  regularRows.forEach((row) => {
    const statusSelect =
      row.querySelector(
        "[data-regular-status]",
      );

    const replacementSelect =
      row.querySelector(
        "[data-replacement-select]",
      );

    if (statusSelect) {
      statusSelect.addEventListener(
        "change",
        () => {
          updateRegularRow(row);

          refreshAllReplacementSelects(
            row,
          );
        },
      );
    }

    if (replacementSelect) {
      replacementSelect.addEventListener(
        "change",
        () => {
          replacementSelect.dataset.currentReplacement =
            replacementSelect.value;

          refreshAllReplacementSelects(
            row,
          );
        },
      );
    }

    row.addEventListener(
      "dragover",
      (event) => {
        if (
          !statusSelect ||
          !replacementSelect
        ) {
          return;
        }

        if (
          !replacementAllowedForRegular.has(
            statusSelect.value,
          )
        ) {
          return;
        }

        const reserveId =
          draggedReserveId ||
          event.dataTransfer.getData(
            "text/plain",
          );

        if (!reserveId) {
          return;
        }

        const reserve =
          getAvailableReserves().find(
            (item) =>
              item.id ===
              String(reserveId),
          );

        if (!reserve) {
          return;
        }

        const used =
          getUsedReserveIds(
            replacementSelect,
          );

        if (
          used.has(
            String(reserveId),
          )
        ) {
          return;
        }

        event.preventDefault();

        event.dataTransfer.dropEffect =
          "move";

        row.classList.add(
          "is-drop-target",
        );
      },
    );

    row.addEventListener(
      "dragleave",
      (event) => {
        if (
          row.contains(
            event.relatedTarget,
          )
        ) {
          return;
        }

        row.classList.remove(
          "is-drop-target",
        );
      },
    );

    row.addEventListener(
      "drop",
      (event) => {
        row.classList.remove(
          "is-drop-target",
        );

        if (
          !statusSelect ||
          !replacementSelect
        ) {
          return;
        }

        /*
         * Ersatz nur bei:
         *
         * UNSICHER
         * ABGEMELDET
         */
        if (
          !replacementAllowedForRegular.has(
            statusSelect.value,
          )
        ) {
          return;
        }

        const reserveId =
          String(
            event.dataTransfer.getData(
              "text/plain",
            ) ||
            draggedReserveId ||
            "",
          );

        if (!reserveId) {
          return;
        }

        const reserve =
          getAvailableReserves().find(
            (item) =>
              item.id === reserveId,
          );

        if (!reserve) {
          return;
        }

        const used =
          getUsedReserveIds(
            replacementSelect,
          );

        if (
          used.has(
            reserveId,
          )
        ) {
          return;
        }

        event.preventDefault();

        rebuildReplacementSelect(
          replacementSelect,
        );

        replacementSelect.value =
          reserveId;

        replacementSelect.dataset.currentReplacement =
          reserveId;

        refreshAllReplacementSelects(
          row,
        );

        row.classList.add(
          "has-replacement",
        );

        setTimeout(
          () => {
            row.classList.remove(
              "has-replacement",
            );
          },
          700,
        );
      },
    );
  });


  /*
   * =====================================================
   * INITIAL
   * =====================================================
   */

  reserveStatusSelects.forEach(
    updateStatusClass,
  );

  regularRows.forEach(
    updateRegularRow,
  );

  refreshAllReplacementSelects();
});