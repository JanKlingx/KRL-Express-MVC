document.addEventListener("DOMContentLoaded", () => {
  const form =
    document.querySelector(
      "form.attendance-board",
    );

  if (!form) {
    return;
  }


  /*
   * =====================================================
   * NORMALE STATUS IN SCHRITT 2
   * =====================================================
   *
   * UNSICHER ist KEIN Drop-Ziel.
   * ABGEMELDET ist KEIN Drop-Ziel.
   */

  const attendanceTargets = [
    {
      value: "anwesend",
      label: "ANWESEND",
      short: "ANWESEND",
      description: "Teilnahme bestätigt",
    },

    {
      value:
        "zu_spaet_vorbesprechung",

      label:
        "ZU SPÄT VORBESPRECHUNG",

      short:
        "ZU SPÄT",

      description:
        "Teilnahme bestätigt",
    },

    {
      value:
        "unabgemeldet",

      label:
        "NICHT ERSCHIENEN",

      short:
        "NICHT ERSCHIENEN",

      description:
        "Keine Teilnahme",
    },

    {
      value:
        "zu_spaet_abgemeldet",

      label:
        "ZU SPÄT ABGEMELDET",

      short:
        "ZU SPÄT ABGEMELDET",

      description:
        "Keine Teilnahme",
    },
  ];


  let selectedAttendanceSelect =
    null;


  /*
   * =====================================================
   * HELPERS
   * =====================================================
   */

  function decisionInputFor(row) {
    return row?.querySelector(
      "[data-uncertain-decision]",
    );
  }


  function teamInfo(select) {
    const card =
      select.closest(
        ".lineup-team-card",
      );

    return {
      name:
        card
          ?.querySelector(
            "header h3",
          )
          ?.textContent
          ?.trim() ||
        "",

      logo:
        card
          ?.querySelector(
            "header img",
          )
          ?.getAttribute(
            "src",
          ) ||
        "",
    };
  }


  function driverName(select) {
    const host =
      select.closest(
        ".attendance-active-driver, .attendance-team-row",
      );

    return (
      host
        ?.querySelector(
          ".lineup-driver-name strong",
        )
        ?.textContent
        ?.replace(
          /^\s*#\d+\s*·\s*/,
          "",
        )
        ?.trim() ||
      "Fahrer"
    );
  }


  function statusMeta(value) {
    return (
      attendanceTargets.find(
        (item) =>
          item.value === value,
      ) ||
      {
        value,
        label: value,
        short: value,
        description: "",
      }
    );
  }


  /*
   * =====================================================
   * SELECT-FARBE
   * =====================================================
   */

  function paintAttendanceSelect(
    select,
  ) {
    if (!select) return;

    [
      "attendance-select-anwesend",
      "attendance-select-zu_spaet_vorbesprechung",
      "attendance-select-unabgemeldet",
      "attendance-select-zu_spaet_abgemeldet",
    ].forEach(
      (className) =>
        select.classList.remove(
          className,
        ),
    );

    select.classList.add(
      `attendance-select-${select.value}`,
    );
  }


  /*
   * =====================================================
   * SPONTANER ERSATZ
   * =====================================================
   */

  function updateReplacementPanel(
    container,
  ) {
    if (!container) {
      return;
    }

    const status =
      container.querySelector(
        "[data-attendance-status]",
      );

    const panel =
      container.querySelector(
        "[data-replacement-panel]",
      );

    if (!status) {
      return;
    }

    paintAttendanceSelect(status);

    if (!panel) {
      return;
    }

    const allowed =
      [
        "unabgemeldet",
        "zu_spaet_abgemeldet",
      ].includes(
        status.value,
      );

    panel.hidden =
      !allowed;

    const replacementSelect =
      panel.querySelector(
        "select",
      );

    replacementSelect &&
      (replacementSelect.disabled =
        !allowed);

    if (
      !allowed &&
      replacementSelect
    ) {
      replacementSelect.value = "";
    }
  }


  /*
   * =====================================================
   * VERWENDETE ERSATZFAHRER
   * =====================================================
   */

  function updateReplacementAvailability() {
    const blocked =
      new Set();

    /*
     * Vorgemerkter Ersatz ist NUR blockiert,
     * wenn er wirklich übernimmt.
     */

    form
      .querySelectorAll(
        "[data-uncertain-decision]",
      )
      .forEach((decision) => {
        if (
          decision.value !==
          "replacement"
        ) {
          return;
        }

        const row =
          decision.closest(
            "[data-attendance-row]",
          );

        const checkbox =
          row?.querySelector(
            "[data-uncertain-present]",
          );

        const driverId =
          checkbox?.dataset
            .plannedReplacementDriverId;

        if (driverId) {
          blocked.add(
            String(driverId),
          );
        }
      });


    /*
     * Spontan ausgewählte Ersatzfahrer.
     */

    const replacementSelects =
      Array.from(
        form.querySelectorAll(
          ".attendance-replacement-panel select",
        ),
      );

    replacementSelects.forEach(
      (select) => {
        if (
          !select.disabled &&
          select.value
        ) {
          blocked.add(
            String(select.value),
          );
        }
      },
    );


    replacementSelects.forEach(
      (select) => {
        const ownValue =
          String(
            select.value || "",
          );

        Array.from(
          select.options,
        ).forEach((option) => {
          if (!option.value) {
            option.disabled = false;
            option.hidden = false;
            return;
          }

          const isBlocked =
            blocked.has(
              String(option.value),
            ) &&
            String(option.value) !==
              ownValue;

          option.disabled =
            isBlocked;

          option.hidden =
            isBlocked;
        });
      },
    );
  }


  /*
   * =====================================================
   * UNSICHER ENTSCHEIDUNG
   * =====================================================
   */

  function applyUncertainDecision(
    row,
    decision,
  ) {
    if (!row) return;

    const decisionInput =
      decisionInputFor(row);

    const checkbox =
      row.querySelector(
        "[data-uncertain-present]",
      );

    const regular =
      row.querySelector(
        "[data-regular-attendance]",
      );

    const replacement =
      row.querySelector(
        "[data-replacement-attendance]",
      );


    if (decisionInput) {
      decisionInput.value =
        decision;
    }


    /*
     * Legacy Checkbox für Backend-Kompatibilität.
     */

    if (checkbox) {
      checkbox.indeterminate =
        decision === "unresolved";

      checkbox.checked =
        decision === "regular";
    }


    const regularActive =
      decision === "regular";

    const replacementActive =
      decision === "replacement";


    /*
     * STAMMFAHRER
     */

    if (regular) {
      regular.hidden =
        !regularActive;

      regular
        .querySelectorAll(
          "select, input",
        )
        .forEach((control) => {
          control.disabled =
            !regularActive;
        });

      if (regularActive) {
        updateReplacementPanel(
          regular,
        );
      }
    }


    /*
     * VORGEMERKTER ERSATZ
     */

    if (replacement) {
      replacement.hidden =
        !replacementActive;

      replacement
        .querySelectorAll(
          "select, input",
        )
        .forEach((control) => {
          control.disabled =
            !replacementActive;
        });

      if (replacementActive) {
        const status =
          replacement.querySelector(
            "[data-attendance-status]",
          );

        if (status) {
          status.value =
            "anwesend";

          paintAttendanceSelect(
            status,
          );
        }

        updateReplacementPanel(
          replacement,
        );
      }
    }


    updateReplacementAvailability();

    rebuild();
  }


  /*
   * =====================================================
   * BESTEHENDE SELECTS
   * =====================================================
   */

  form
    .querySelectorAll(
      "[data-attendance-status]",
    )
    .forEach((status) => {
      const container =
        status.closest(
          ".attendance-active-driver, .attendance-team-row",
        );

      if (!container) {
        return;
      }

      status.addEventListener(
        "change",
        () => {
          updateReplacementPanel(
            container,
          );

          updateReplacementAvailability();

          rebuild();
        },
      );

      updateReplacementPanel(
        container,
      );
    });


  /*
   * =====================================================
   * BOARD ERZEUGEN
   * =====================================================
   */

  const originalGrid =
    form.querySelector(
      ".lineup-team-grid",
    );

  const board =
    document.createElement(
      "section",
    );

  board.className =
    "attendance-race-control attendance-race-control-v2";

  board.innerHTML = `
    <header>

      <div>
        <span>RACE CONTROL</span>

        <strong>
          Anwesenheit festlegen
        </strong>

        <small>
          Fahrer ziehen oder antippen und Status festlegen.
        </small>
      </div>

      <button
        type="button"
        class="button button-ghost"
        data-attendance-details
      >
        DETAILANSICHT
      </button>

    </header>


    <div
      class="attendance-summary"
      data-attendance-summary
    ></div>


    <section
      class="attendance-unresolved"
      data-attendance-unresolved
      hidden
    >

      <header>
        <div>
          <span>
            UNSICHER
          </span>

          <strong>
            Rückmeldung prüfen
          </strong>
        </div>
      </header>

      <div
        class="attendance-unresolved-list"
        data-attendance-unresolved-list
      ></div>

    </section>


    <div class="attendance-workspace">

      <section
        class="attendance-driver-panel"
      >

        <header>

          <div>
            <span>FAHRER</span>
            <strong>Teilnehmer</strong>
          </div>

          <span
            data-attendance-driver-count
          >
            0
          </span>

        </header>


        <div
          class="attendance-driver-list"
          data-attendance-driver-list
        ></div>

      </section>


      <section
        class="attendance-target-panel"
      >

        <header>

          <div>
            <span>STATUS</span>
            <strong>Ziel auswählen</strong>
          </div>

          <small>
            Drag & Drop
          </small>

        </header>


        <div
          class="attendance-target-grid"
          data-attendance-target-grid
        ></div>

      </section>

    </div>
  `;


  form.insertBefore(
    board,
    originalGrid,
  );

  form.classList.add(
    "has-race-control-attendance",
  );


  const summary =
    board.querySelector(
      "[data-attendance-summary]",
    );

  const driverList =
    board.querySelector(
      "[data-attendance-driver-list]",
    );

  const driverCount =
    board.querySelector(
      "[data-attendance-driver-count]",
    );

  const targetGrid =
    board.querySelector(
      "[data-attendance-target-grid]",
    );

  const unresolvedPanel =
    board.querySelector(
      "[data-attendance-unresolved]",
    );

  const unresolvedList =
    board.querySelector(
      "[data-attendance-unresolved-list]",
    );


  /*
   * =====================================================
   * UNSICHER INITIALISIEREN
   * =====================================================
   */

  form
    .querySelectorAll(
      "[data-uncertain-present]",
    )
    .forEach((checkbox) => {
      const row =
        checkbox.closest(
          "[data-attendance-row]",
        );

      if (!row) return;

      const decision =
        decisionInputFor(row);

      const value =
        decision?.value ||
        "unresolved";

      checkbox.indeterminate =
        value === "unresolved";

      checkbox.checked =
        value === "regular";


      const regular =
        row.querySelector(
          "[data-regular-attendance]",
        );

      const replacement =
        row.querySelector(
          "[data-replacement-attendance]",
        );


      if (regular) {
        const active =
          value === "regular";

        regular.hidden =
          !active;

        regular
          .querySelectorAll(
            "select, input",
          )
          .forEach((control) => {
            control.disabled =
              !active;
          });
      }


      if (replacement) {
        const active =
          value ===
          "replacement";

        replacement.hidden =
          !active;

        replacement
          .querySelectorAll(
            "select, input",
          )
          .forEach((control) => {
            control.disabled =
              !active;
          });
      }
    });


  /*
   * =====================================================
   * SUMMARY
   * =====================================================
   */

  function buildSummary(
    selects,
    unresolvedCount,
  ) {
    const ready =
      selects.filter((select) =>
        [
          "anwesend",
          "zu_spaet_vorbesprechung",
        ].includes(
          select.value,
        ),
      ).length;

    const absent =
      selects.filter((select) =>
        [
          "unabgemeldet",
          "zu_spaet_abgemeldet",
        ].includes(
          select.value,
        ),
      ).length;


    summary.innerHTML = `
      <div>
        <span>STARTKLAR</span>
        <strong>${ready}</strong>
      </div>

      <div
        class="${
          unresolvedCount
            ? "has-warning"
            : ""
        }"
      >
        <span>
          FEHLENDE RÜCKMELDUNG
        </span>

        <strong>
          ${unresolvedCount}
        </strong>
      </div>

      <div>
        <span>NICHT DABEI</span>
        <strong>${absent}</strong>
      </div>
    `;
  }


  /*
   * =====================================================
   * UNSICHER / FEHLENDE RÜCKMELDUNG
   * =====================================================
   */

  function buildUnresolved() {
    const rows =
      Array.from(
        form.querySelectorAll(
          "[data-attendance-row]",
        ),
      ).filter((row) => {
        const decision =
          decisionInputFor(row);

        return (
          decision &&
          decision.value ===
            "unresolved"
        );
      });


    unresolvedPanel.hidden =
      rows.length === 0;

    unresolvedList.innerHTML =
      "";


    rows.forEach((row) => {
      const regular =
        row.querySelector(
          "[data-regular-attendance]",
        );

      const replacement =
        row.querySelector(
          "[data-replacement-attendance]",
        );


      const regularSelect =
        regular?.querySelector(
          "[data-attendance-status]",
        );

      const replacementSelect =
        replacement?.querySelector(
          "[data-attendance-status]",
        );


      const spontaneousSelect =
        regular?.querySelector(
          "[data-replacement-panel] select",
        );


      const regularName =
        regularSelect
          ? driverName(
              regularSelect,
            )
          : "Stammfahrer";


      const replacementName =
        replacementSelect
          ? driverName(
              replacementSelect,
            )
          : "";


      const team =
        regularSelect
          ? teamInfo(
              regularSelect,
            )
          : {
              name: "",
              logo: "",
            };


      const card =
        document.createElement(
          "article",
        );

      card.className =
        "attendance-unresolved-card";


      /*
       * Kein vorgemerkter Ersatz:
       * freien Reservefahrer direkt auswählbar machen.
       */

      let freeReplacementHtml = "";

      if (
        !replacementName &&
        spontaneousSelect
      ) {
        const options =
          Array.from(
            spontaneousSelect.options,
          )
            .map(
              (option) => `
                <option
                  value="${option.value}"
                >
                  ${option.textContent}
                </option>
              `,
            )
            .join("");

        freeReplacementHtml = `
          <label
            class="attendance-unresolved-free-replacement"
          >
            <span>
              ERSATZ BEI FEHLENDER RÜCKMELDUNG
            </span>

            <select
              data-unresolved-replacement
            >
              ${options}
            </select>
          </label>
        `;
      }


      card.innerHTML = `
        <div
          class="attendance-unresolved-driver"
        >
          <span>
            UNSICHER
          </span>

          <strong>
            ${regularName}
          </strong>

          <small>
            ${team.name || "Stammfahrer"}
          </small>
        </div>


        ${
          replacementName
            ? `
              <div
                class="attendance-unresolved-replacement"
              >
                <span>
                  VORGEMERKTER ERSATZ
                </span>

                <strong>
                  ${replacementName}
                </strong>

                <small>
                  Übernimmt automatisch bei fehlender Rückmeldung.
                </small>
              </div>
            `
            : `
              <div
                class="attendance-unresolved-replacement"
              >
                <span>
                  KEIN ERSATZ VORGEMERKT
                </span>

                <strong>
                  Cockpit derzeit ohne Ersatz
                </strong>

                <small>
                  Bei Bedarf jetzt freien Ersatz auswählen.
                </small>
              </div>
            `
        }


        ${freeReplacementHtml}


        <div
          class="attendance-unresolved-actions"
        >

          <button
            type="button"
            data-uncertain-present-action
          >
            ANWESEND
            <small>
              Stammfahrer fährt · Ersatz bleibt frei
            </small>
          </button>


          <button
            type="button"
            data-uncertain-missing-action
          >
            FEHLENDE RÜCKMELDUNG
            <small>
              ${
                replacementName
                  ? `${replacementName} übernimmt`
                  : "Stammfahrer fährt nicht"
              }
            </small>
          </button>

        </div>
      `;


      /*
       * ANWESEND:
       *
       * Stammfahrer fährt.
       * Vorgemerkter Ersatz wird nicht verwendet.
       */

      card
        .querySelector(
          "[data-uncertain-present-action]",
        )
        ?.addEventListener(
          "click",
          () => {
            if (regularSelect) {
              regularSelect.value =
                "anwesend";

              paintAttendanceSelect(
                regularSelect,
              );
            }

            applyUncertainDecision(
              row,
              "regular",
            );
          },
        );


      /*
       * FEHLENDE RÜCKMELDUNG
       */

      card
        .querySelector(
          "[data-uncertain-missing-action]",
        )
        ?.addEventListener(
          "click",
          () => {
            /*
             * Vorgemerkter Ersatz vorhanden:
             * er übernimmt automatisch.
             */

            if (replacementName) {
              if (replacementSelect) {
                replacementSelect.value =
                  "anwesend";
              }

              applyUncertainDecision(
                row,
                "replacement",
              );

              return;
            }


            /*
             * Kein vorgemerkter Ersatz.
             *
             * Stammfahrer = nicht erschienen.
             * Optional ausgewählten freien Ersatz übernehmen.
             */

            if (!regularSelect) {
              return;
            }

            regularSelect.value =
              "unabgemeldet";

            regularSelect.disabled =
              false;


            const visualReplacement =
              card.querySelector(
                "[data-unresolved-replacement]",
              );


            if (
              spontaneousSelect &&
              visualReplacement
            ) {
              spontaneousSelect.disabled =
                false;

              spontaneousSelect.value =
                visualReplacement.value;
            }


            applyUncertainDecision(
              row,
              "regular",
            );
          },
        );


      /*
       * Freien Ersatz im Popup auswählen.
       */

      const visualReplacement =
        card.querySelector(
          "[data-unresolved-replacement]",
        );

      if (
        visualReplacement &&
        spontaneousSelect
      ) {
        visualReplacement.value =
          spontaneousSelect.value;

        visualReplacement.addEventListener(
          "change",
          () => {
            spontaneousSelect.value =
              visualReplacement.value;

            updateReplacementAvailability();
          },
        );
      }


      unresolvedList.appendChild(
        card,
      );
    });


    return rows.length;
  }


  /*
   * =====================================================
   * FAHRERLISTE
   * =====================================================
   */

  function buildDrivers(selects) {
    driverList.innerHTML = "";

    driverCount.textContent =
      String(selects.length);


    selects.forEach((select) => {
      const meta =
        statusMeta(
          select.value,
        );

      const team =
        teamInfo(
          select,
        );

      const container =
        select.closest(
          ".attendance-active-driver, .attendance-team-row",
        );

      const replacementPanel =
        container?.querySelector(
          "[data-replacement-panel]",
        );

      const realReplacementSelect =
        replacementPanel?.querySelector(
          "select",
        );


      const card =
        document.createElement(
          "article",
        );

      card.className =
        `attendance-driver-card attendance-status-${select.value}`;

      card.draggable = true;

      card.dataset.selectName =
        select.name;


      card.innerHTML = `
        ${
          team.logo
            ? `
              <span
                class="attendance-driver-team"
              >
                <img
                  src="${team.logo}"
                  alt=""
                >
              </span>
            `
            : `
              <span
                class="attendance-driver-team"
              ></span>
            `
        }

        <span
          class="attendance-driver-copy"
        >
          <strong>
            ${driverName(select)}
          </strong>

          <small>
            ${team.name}
          </small>
        </span>

        <span
          class="attendance-driver-state"
        >
          ${meta.short}
        </span>
      `;


      /*
       * NICHT ERSCHIENEN /
       * ZU SPÄT ABGEMELDET
       *
       * → spontaner Ersatz.
       */

      if (
        [
          "unabgemeldet",
          "zu_spaet_abgemeldet",
        ].includes(
          select.value,
        ) &&
        realReplacementSelect
      ) {
        const wrapper =
          document.createElement(
            "div",
          );

        wrapper.className =
          "attendance-inline-replacement";


        const label =
          document.createElement(
            "span",
          );

        label.textContent =
          "Ersatz einsetzen";


        const visualSelect =
          realReplacementSelect.cloneNode(
            true,
          );

        visualSelect.removeAttribute(
          "name",
        );

        visualSelect.disabled =
          false;

        visualSelect.value =
          realReplacementSelect.value;


        visualSelect.addEventListener(
          "click",
          (event) => {
            event.stopPropagation();
          },
        );


        visualSelect.addEventListener(
          "change",
          () => {
            realReplacementSelect.disabled =
              false;

            realReplacementSelect.value =
              visualSelect.value;

            updateReplacementAvailability();

            rebuild();
          },
        );


        wrapper.append(
          label,
          visualSelect,
        );

        card.appendChild(
          wrapper,
        );
      }


      card.addEventListener(
        "dragstart",
        (event) => {
          event.dataTransfer.setData(
            "text/plain",
            select.name,
          );

          event.dataTransfer.effectAllowed =
            "move";

          card.classList.add(
            "is-dragging",
          );
        },
      );


      card.addEventListener(
        "dragend",
        () => {
          card.classList.remove(
            "is-dragging",
          );
        },
      );


      card.addEventListener(
        "click",
        () => {
          selectedAttendanceSelect =
            selectedAttendanceSelect ===
            select
              ? null
              : select;

          rebuild();
        },
      );


      if (
        selectedAttendanceSelect ===
        select
      ) {
        card.classList.add(
          "is-selected",
        );
      }


      driverList.appendChild(
        card,
      );
    });
  }


  /*
   * =====================================================
   * DROP-ZIELE
   * =====================================================
   */

  function buildTargets(selects) {
    targetGrid.innerHTML = "";


    attendanceTargets.forEach(
      (status) => {
        const count =
          selects.filter(
            (select) =>
              select.value ===
              status.value,
          ).length;


        const target =
          document.createElement(
            "button",
          );

        target.type = "button";

        target.className =
          `attendance-target attendance-status-${status.value}`;

        target.innerHTML = `
          <span
            class="attendance-target-icon"
          ></span>

          <span
            class="attendance-target-copy"
          >
            <strong>
              ${status.label}
            </strong>

            <small>
              ${status.description}
            </small>
          </span>

          <b>
            ${count}
          </b>
        `;


        function apply(select) {
          if (
            !select ||
            select.disabled
          ) {
            return;
          }

          select.value =
            status.value;

          select.dispatchEvent(
            new Event(
              "change",
              {
                bubbles: true,
              },
            ),
          );

          selectedAttendanceSelect =
            null;
        }


        target.addEventListener(
          "dragover",
          (event) => {
            event.preventDefault();

            target.classList.add(
              "is-drop-target",
            );
          },
        );


        target.addEventListener(
          "dragleave",
          () => {
            target.classList.remove(
              "is-drop-target",
            );
          },
        );


        target.addEventListener(
          "drop",
          (event) => {
            event.preventDefault();

            target.classList.remove(
              "is-drop-target",
            );

            const name =
              event.dataTransfer.getData(
                "text/plain",
              );

            const select =
              selects.find(
                (candidate) =>
                  candidate.name ===
                  name,
              );

            apply(select);
          },
        );


        target.addEventListener(
          "click",
          () => {
            apply(
              selectedAttendanceSelect,
            );
          },
        );


        targetGrid.appendChild(
          target,
        );
      },
    );
  }


  /*
   * =====================================================
   * REBUILD
   * =====================================================
   */

  function rebuild() {
    updateReplacementAvailability();

    const unresolvedCount =
      buildUnresolved();


    const activeSelects =
      Array.from(
        form.querySelectorAll(
          "[data-attendance-status]",
        ),
      ).filter(
        (select) =>
          !select.disabled &&
          attendanceTargets.some(
            (target) =>
              target.value ===
              select.value,
          ),
      );


    buildSummary(
      activeSelects,
      unresolvedCount,
    );

    buildDrivers(
      activeSelects,
    );

    buildTargets(
      activeSelects,
    );
  }


  /*
   * =====================================================
   * DETAILANSICHT
   * =====================================================
   */

  board
    .querySelector(
      "[data-attendance-details]",
    )
    ?.addEventListener(
      "click",
      (event) => {
        const open =
          form.classList.toggle(
            "show-attendance-details",
          );

        event.currentTarget.textContent =
          open
            ? "DETAILS SCHLIESSEN"
            : "DETAILANSICHT";
      },
    );


  /*
   * =====================================================
   * SUBMIT
   * =====================================================
   */

  form.addEventListener(
    "submit",
    (event) => {
      const unresolved =
        Array.from(
          form.querySelectorAll(
            "[data-uncertain-decision]",
          ),
        ).filter(
          (input) =>
            input.value ===
            "unresolved",
        );


      if (!unresolved.length) {
        return;
      }

      event.preventDefault();

      unresolvedPanel.classList.add(
        "has-error",
      );

      unresolvedPanel.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    },
  );


  /*
   * =====================================================
   * KORREKTUREN
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
        const open =
          corrections.hidden;

        corrections.hidden =
          !open;

        correctionToggle.textContent =
          open
            ? "Korrekturen schließen"
            : "Ausgeschiedene Fahrer bearbeiten";

        if (open) {
          corrections.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      },
    );
  }


  /*
   * =====================================================
   * INITIAL
   * =====================================================
   */

  updateReplacementAvailability();

  rebuild();
});