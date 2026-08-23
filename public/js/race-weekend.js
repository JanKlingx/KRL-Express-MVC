document.addEventListener("DOMContentLoaded", () => {
  /*
   * =====================================================
   * WEITERER ERSATZ JE NACH ANWESENHEITSSTATUS
   * =====================================================
   */

  function updateReplacementPanel(container) {
    const status = container.querySelector("[data-attendance-status]");

    const panel = container.querySelector("[data-replacement-panel]");

    if (!status || !panel) {
      return;
    }

    const replacementAllowed = ["unabgemeldet", "zu_spaet_abgemeldet"].includes(
      status.value,
    );

    panel.hidden = !replacementAllowed;

    const replacementSelect = panel.querySelector("select");

    if (!replacementAllowed && replacementSelect) {
      replacementSelect.value = "";
    }
  }

  /*
   * =====================================================
   * VORGEMERKTE ERSATZFAHRER GLOBAL SPERREN / FREIGEBEN
   * =====================================================
   *
   * Beispiel:
   *
   * Lemi unsicher
   * Marcel = vorgemerkter Ersatz
   *
   * Lemi fährt NICHT
   * -> Marcel übernimmt Aston Martin
   * -> Marcel darf nirgendwo anders auswählbar sein
   *
   * Lemi fährt
   * -> Marcel ist frei
   * -> Marcel darf bei anderem Team gewählt werden
   */

  function updatePlannedReplacementAvailability() {
    const blockedReplacementDriverIds = new Set();

    /*
     * Alle Unsicher-Checkboxen prüfen.
     */
    document
      .querySelectorAll("[data-uncertain-present]")
      .forEach((checkbox) => {
        /*
         * Der konkrete vorgemerkte
         * Ersatzfahrer dieser Checkbox.
         *
         * Beispiel:
         * Marcel = DriverId 77
         */
        const replacementDriverId = checkbox.dataset.plannedReplacementDriverId;

        if (!replacementDriverId) {
          return;
        }

        /*
         * Haken NICHT gesetzt:
         *
         * Stammfahrer fährt nicht,
         * also wird der vorgemerkte
         * Ersatz benötigt.
         */
        if (!checkbox.checked) {
          blockedReplacementDriverIds.add(String(replacementDriverId));
        }
      });

    /*
     * Alle "Weiterer Ersatz"-Dropdowns
     * der Seite aktualisieren.
     */
    document
      .querySelectorAll(".attendance-replacement-panel select")
      .forEach((select) => {
        Array.from(select.options).forEach((option) => {
          /*
           * Leerer Default-Eintrag.
           */
          if (!option.value) {
            option.disabled = false;
            option.hidden = false;
            return;
          }

          /*
           * option.value ist direkt
           * die DriverId.
           */
          const blocked = blockedReplacementDriverIds.has(String(option.value));

          option.disabled = blocked;
          option.hidden = blocked;
        });

        /*
         * Falls gerade ein Fahrer gewählt
         * war, der jetzt gesperrt wurde,
         * Auswahl zurücksetzen.
         */
        const selectedOption = select.options[select.selectedIndex];

        if (selectedOption && selectedOption.disabled) {
          select.value = "";
        }
      });
  }

  /*
   * =====================================================
   * ANWESENHEITS-DROPDOWNS
   * =====================================================
   */

  document.querySelectorAll("[data-attendance-status]").forEach((status) => {
    const container = status.closest(
      ".attendance-active-driver, .attendance-team-row",
    );

    if (!container) {
      return;
    }

    status.addEventListener("change", () => {
      updateReplacementPanel(container);
    });

    updateReplacementPanel(container);
  });

  /*
   * =====================================================
   * UNSICHER:
   * STAMMFAHRER ODER GEPLANTER ERSATZ
   * =====================================================
   */

  document.querySelectorAll("[data-uncertain-present]").forEach((checkbox) => {
    const row = checkbox.closest("[data-attendance-row]");

    if (!row) {
      return;
    }

    const regular = row.querySelector("[data-regular-attendance]");

    const replacement = row.querySelector("[data-replacement-attendance]");

    function updateDriverChoice() {
      /*
       * Checkbox gesetzt:
       * Stammfahrer fährt.
       *
       * Checkbox nicht gesetzt:
       * vorgemerkter Ersatz fährt.
       */
      const regularActive = checkbox.checked;

      /*
       * =========================================
       * STAMMFAHRER
       * =========================================
       */

      if (regular) {
        regular.hidden = !regularActive;

        regular.querySelectorAll("select, input").forEach((control) => {
          control.disabled = !regularActive;
        });

        if (regularActive) {
          updateReplacementPanel(regular);
        }
      }

      /*
       * =========================================
       * VORGEMERKTER ERSATZ
       * =========================================
       */

      if (replacement) {
        replacement.hidden = regularActive;

        replacement.querySelectorAll("select, input").forEach((control) => {
          control.disabled = regularActive;
        });

        if (!regularActive) {
          updateReplacementPanel(replacement);
        }
      }

      /*
       * Danach alle Ersatz-Dropdowns
       * neu berechnen.
       */
      updatePlannedReplacementAvailability();
    }

    checkbox.addEventListener("change", updateDriverChoice);

    updateDriverChoice();
  });

  /*
   * =====================================================
   * INITIALER STATUS
   * =====================================================
   */

  updatePlannedReplacementAvailability();


/*
 * =====================================================
 * AUSGESCHIEDENE FAHRER BEARBEITEN
 * =====================================================
 */

const correctionToggle =
  document.querySelector(
    "[data-toggle-attendance-corrections]",
  );

const corrections =
  document.querySelector(
    "[data-attendance-corrections]",
  );

if (
  correctionToggle &&
  corrections
) {
  correctionToggle.addEventListener(
    "click",
    () => {

      const shouldOpen =
        corrections.hidden;

      corrections.hidden =
        !shouldOpen;

      correctionToggle.textContent =
        shouldOpen
          ? "Korrekturen schließen"
          : "Ausgeschiedene Fahrer bearbeiten";

      if (shouldOpen) {
        corrections.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    },
  );
}

});
