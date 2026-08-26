document.addEventListener("DOMContentLoaded", () => {
  const allowedReserveStatuses = new Set([
    "anwesend",
    "unsicher",
    "auf_abruf",
  ]);

  const replacementStatuses = new Set([
    "abgemeldet",
    "unsicher",
  ]);

  document
    .querySelectorAll("[data-f1-lineup-matrix]")
    .forEach((form) => {
      const reserveRows = [
        ...form.querySelectorAll(
          "[data-reserve-row]"
        ),
      ];

      const regularRows = [
        ...form.querySelectorAll(
          "[data-regular-row]"
        ),
      ];

      const feedback =
        form.querySelector(
          "[data-lineup-feedback]"
        );

      let draggedReserveId = null;


      /*
       * =====================================================
       * STATUS-KLASSE
       * =====================================================
       */

      function applyStatusClass(
        element,
        status
      ) {
        if (!element) {
          return;
        }

        [
          ...element.classList,
        ]
          .filter((className) =>
            className.startsWith(
              "status-"
            )
          )
          .forEach((className) => {
            element.classList.remove(
              className
            );
          });

        if (status) {
          element.classList.add(
            `status-${status}`
          );
        }

        element.dataset.status =
          status || "";
      }


      /*
       * =====================================================
       * ERSATZFAHRERSTATUS
       * =====================================================
       */

      function reserveStatusSelect(
        row
      ) {
        return row.querySelector(
          "[data-reserve-status]"
        );
      }


      function reserveState(row) {
        const select =
          reserveStatusSelect(row);

        return {
          id: String(
            row.dataset.reserveId
          ),

          name:
            row.dataset.reserveName ||
            "Ersatzfahrer",

          status:
            select?.value ||
            row.dataset.status ||
            "anwesend",

          locked:
            row.dataset.locked ===
            "true",
        };
      }


      /*
       * =====================================================
       * ERSATZFELDER STAMMFAHRER
       * =====================================================
       */

      function replacementSelectFor(
        row
      ) {
        return row.querySelector(
          "[data-replacement-select]"
        );
      }


      function replacementInputFor(
        row
      ) {
        return row.querySelector(
          "[data-replacement-input]"
        );
      }


      function getReplacementValue(
        row
      ) {
        const hidden =
          replacementInputFor(row);

        const select =
          replacementSelectFor(row);

        return String(
          hidden?.value ||
          select?.value ||
          select?.dataset
            .currentReplacement ||
          ""
        );
      }


      function setReplacement(
        row,
        value
      ) {
        const replacementId =
          String(value || "");

        const hidden =
          replacementInputFor(row);

        const select =
          replacementSelectFor(row);

        if (hidden) {
          hidden.value =
            replacementId;
        }

        if (select) {
          select.value =
            replacementId;

          select.dataset.currentReplacement =
            replacementId;
        }
      }


      /*
       * =====================================================
       * BEREITS VERWENDETE ERSATZFAHRER
       * =====================================================
       */

      function usedReserveIds(
        exceptRow = null
      ) {
        const used =
          new Set();

        regularRows.forEach(
          (row) => {
            if (
              row === exceptRow
            ) {
              return;
            }

            const value =
              getReplacementValue(row);

            if (value) {
              used.add(value);
            }
          }
        );

        return used;
      }


      /*
       * =====================================================
       * VERFÜGBARE ERSATZFAHRER
       * =====================================================
       */

      function availableReserves(
        row
      ) {
        const previous =
          getReplacementValue(row);

        const used =
          usedReserveIds(row);

        return reserveRows
          .map(reserveState)
          .filter((reserve) => {
            /*
             * Bereits für genau dieses
             * Cockpit gewählter Fahrer
             * bleibt immer sichtbar.
             */
            if (
              reserve.id ===
              previous
            ) {
              return true;
            }

            /*
             * Bereits in Schritt 2
             * bestätigte Fahrer dürfen
             * nicht neu angeboten werden.
             */
            if (reserve.locked) {
              return false;
            }

            return (
              allowedReserveStatuses.has(
                reserve.status
              ) &&
              !used.has(
                reserve.id
              )
            );
          })
          .sort(
            (left, right) => {
              const rank = (
                status
              ) => {
                if (
                  status ===
                  "anwesend"
                ) {
                  return 0;
                }

                if (
                  status ===
                  "auf_abruf"
                ) {
                  return 1;
                }

                if (
                  status ===
                  "unsicher"
                ) {
                  return 2;
                }

                return 3;
              };

              return (
                rank(left.status) -
                  rank(
                    right.status
                  ) ||
                left.name.localeCompare(
                  right.name,
                  "de"
                )
              );
            }
          );
      }


      /*
       * =====================================================
       * ERSATZSELECT AUFBAUEN
       * =====================================================
       */

    function rebuildReplacementSelect(row) {
  const select =
    replacementSelectFor(row);

  if (!select) {
    return;
  }


  /*
   * Gespeicherte Zuordnung.
   *
   * Hidden Input hat Vorrang.
   */

  const previous =
    getReplacementValue(row);


  const storedId =
    String(
      row.dataset
        .currentReplacement ||
      ""
    );


  const storedName =
    row.dataset
      .currentReplacementName ||
    "";


  const storedStatus =
    row.dataset
      .currentReplacementStatus ||
    "";


  const reserves =
    availableReserves(row);


  /*
   * Select komplett neu aufbauen.
   */

  select.replaceChildren();


  select.add(
    new Option(
      "Kein Ersatz",
      ""
    )
  );


  let previousWasAdded =
    false;


  reserves.forEach(
    (reserve) => {
      let label =
        reserve.status
          .replaceAll(
            "_",
            " "
          )
          .toUpperCase();


      const option =
        new Option(
          `${reserve.name} · ${label}`,
          reserve.id
        );


      if (
        String(
          reserve.id
        ) ===
        String(
          previous
        )
      ) {
        option.selected =
          true;

        previousWasAdded =
          true;
      }


      select.add(
        option
      );
    }
  );


  /*
   * ===================================================
   * WICHTIG:
   *
   * Gespeicherter Ersatzfahrer muss IMMER angezeigt
   * werden, selbst wenn er aktuell nicht mehr im
   * "freien" Ersatzfahrer-Pool vorkommt.
   * ===================================================
   */

  if (
    previous &&
    !previousWasAdded
  ) {
    const matchingReserve =
      reserveRows.find(
        (reserveRow) =>
          String(
            reserveRow.dataset
              .reserveId
          ) ===
          String(
            previous
          )
      );


    const name =
      matchingReserve
        ?.dataset
        .reserveName ||
      (
        String(storedId) ===
        String(previous)
          ? storedName
          : ""
      ) ||
      `Ersatzfahrer ${previous}`;


    const status =
      matchingReserve
        ?.dataset
        .status ||
      (
        String(storedId) ===
        String(previous)
          ? storedStatus
          : ""
      ) ||
      "anwesend";


    const label =
      status
        .replaceAll(
          "_",
          " "
        )
        .toUpperCase();


    const option =
      new Option(
        `${name} · ${label}`,
        previous
      );


    option.selected =
      true;


    select.add(
      option
    );
  }


  /*
   * Gespeicherten Wert explizit wieder setzen.
   */

  select.value =
    previous;


  select.dataset
    .currentReplacement =
    previous;


  const hidden =
    replacementInputFor(
      row
    );


  if (hidden) {
    hidden.value =
      previous;
  }


  /*
   * Optische Statusklasse des
   * Ersatzfeldes.
   */

  [
    ...select.classList
  ]
    .filter(
      (className) =>
        className.startsWith(
          "replacement-status-"
        )
    )
    .forEach(
      (className) =>
        select.classList.remove(
          className
        )
    );


  if (previous) {
    const selectedReserve =
      reserveRows.find(
        (reserveRow) =>
          String(
            reserveRow.dataset
              .reserveId
          ) ===
          String(
            previous
          )
      );


    const selectedStatus =
      selectedReserve
        ?.dataset
        .status ||
      storedStatus ||
      "anwesend";


    select.classList.add(
      `replacement-status-${selectedStatus}`
    );
  }
}

      /*
       * =====================================================
       * ERSATZFAHRER-KARTEN AKTUALISIEREN
       * =====================================================
       */

      function updateReserveRows() {
        const assignments =
          new Map();

        regularRows.forEach(
          (row) => {
            const reserveId =
              getReplacementValue(
                row
              );

            if (!reserveId) {
              return;
            }

            assignments.set(
              reserveId,
              {
                team:
                  row.dataset
                    .teamName ||
                  "Team",

                driver:
                  row
                    .querySelector(
                      ".f1-lineup-driver__name strong"
                    )
                    ?.textContent
                    ?.trim() ||
                  "Stammfahrer",
              }
            );
          }
        );


        reserveRows.forEach(
          (row) => {
            const state =
              reserveState(row);

            const assignment =
              assignments.get(
                state.id
              );

            const target =
              row.querySelector(
                "[data-reserve-assignment]"
              );

            row.dataset.status =
              state.status;

            row.classList.toggle(
              "is-assigned",
              Boolean(assignment)
            );

            /*
             * Statusfarbe der
             * Ersatzfahrer korrigieren.
             */
            const statusSelect =
              reserveStatusSelect(row);

            applyStatusClass(
              statusSelect,
              state.status
            );


            if (target) {
              if (assignment) {
                target.innerHTML = `
                  <span>EINGETEILT</span>
                  <strong>${assignment.team}</strong>
                  <small>
                    Ersatz für ${assignment.driver}
                  </small>
                `;
              } else {
                target.innerHTML = `
                  <span>FREI</span>
                  <small>
                    Noch keinem Cockpit zugeordnet
                  </small>
                `;
              }
            }


            /*
             * Drag & Drop
             */
            const draggable =
              !state.locked &&
              allowedReserveStatuses.has(
                state.status
              );

            row.draggable =
              draggable;

            row.classList.toggle(
              "is-draggable",
              draggable
            );
          }
        );
      }


      /*
       * =====================================================
       * STAMMFAHRER-ZEILE
       * =====================================================
       */

      function updateRegularRow(
        row
      ) {
        const status =
          row.querySelector(
            "[data-regular-status]"
          );

        const field =
          row.querySelector(
            "[data-replacement-field]"
          );

        const replacement =
          replacementSelectFor(row);


        /*
         * Rennsperre / kein Select.
         */
        if (!status) {
          if (field) {
            field.hidden =
              true;
          }

          if (replacement) {
            replacement.disabled =
              true;
          }

          return;
        }


        /*
         * ENTSCHEIDENDER FIX:
         *
         * Alte Klasse
         * status-anwesend entfernen
         *
         * und beispielsweise
         * status-abgemeldet setzen.
         */

        applyStatusClass(
          status,
          status.value
        );


        const allowed =
          replacementStatuses.has(
            status.value
          );


        if (field) {
          field.hidden =
            !allowed;
        }


        if (replacement) {
          replacement.disabled =
            !allowed;
        }


        /*
         * Fahrer wieder anwesend:
         * Ersatz-Zuordnung freigeben.
         */

        if (!allowed) {
          setReplacement(
            row,
            ""
          );

          return;
        }


        rebuildReplacementSelect(
          row
        );
      }


      /*
       * =====================================================
       * GESAMTREFRESH
       * =====================================================
       */

      function refresh() {
        regularRows.forEach(
          updateRegularRow
        );

        regularRows.forEach(
          (row) => {
            const status =
              row.querySelector(
                "[data-regular-status]"
              );

            if (
              status &&
              replacementStatuses.has(
                status.value
              )
            ) {
              rebuildReplacementSelect(
                row
              );
            }
          }
        );

        updateReserveRows();
      }


      /*
       * =====================================================
       * STAMMFAHRER EVENTS
       * =====================================================
       */

      regularRows.forEach(
        (row) => {
          const status =
            row.querySelector(
              "[data-regular-status]"
            );

          const replacement =
            replacementSelectFor(
              row
            );


          status?.addEventListener(
            "change",
            () => {
              /*
               * Sofort Farbe ändern.
               */

              applyStatusClass(
                status,
                status.value
              );

              updateRegularRow(
                row
              );

              refresh();
            }
          );


          replacement
            ?.addEventListener(
              "change",
              () => {
                const newValue =
                  replacement.value;

                /*
                 * Keine Doppelbelegung.
                 */

                if (
                  newValue &&
                  usedReserveIds(
                    row
                  ).has(
                    String(
                      newValue
                    )
                  )
                ) {
                  replacement.value =
                    getReplacementValue(
                      row
                    );

                  return;
                }


                setReplacement(
                  row,
                  newValue
                );

                refresh();
              }
            );
        }
      );


      /*
       * =====================================================
       * ERSATZFAHRER STATUS
       * =====================================================
       */

      reserveRows.forEach(
        (row) => {
          const statusSelect =
            reserveStatusSelect(
              row
            );

          if (!statusSelect) {
            return;
          }


          applyStatusClass(
            statusSelect,
            statusSelect.value
          );


          statusSelect.addEventListener(
            "change",
            () => {
              row.dataset.status =
                statusSelect.value;

              applyStatusClass(
                statusSelect,
                statusSelect.value
              );

              /*
               * Wird ein bereits zugeordneter
               * Ersatzfahrer unzulässig,
               * Zuordnung entfernen.
               */

              if (
                !allowedReserveStatuses.has(
                  statusSelect.value
                )
              ) {
                regularRows.forEach(
                  (
                    regularRow
                  ) => {
                    if (
                      getReplacementValue(
                        regularRow
                      ) ===
                      String(
                        row.dataset
                          .reserveId
                      )
                    ) {
                      setReplacement(
                        regularRow,
                        ""
                      );
                    }
                  }
                );
              }


              refresh();
            }
          );


          /*
           * DRAG START
           */

          row.addEventListener(
            "dragstart",
            (event) => {
              const state =
                reserveState(row);

              if (
                state.locked ||
                !allowedReserveStatuses.has(
                  state.status
                )
              ) {
                event.preventDefault();

                return;
              }

              draggedReserveId =
                state.id;

              event.dataTransfer.setData(
                "text/plain",
                state.id
              );

              event.dataTransfer.effectAllowed =
                "move";

              row.classList.add(
                "is-dragging"
              );
            }
          );


          row.addEventListener(
            "dragend",
            () => {
              draggedReserveId =
                null;

              row.classList.remove(
                "is-dragging"
              );

              regularRows.forEach(
                (
                  regularRow
                ) =>
                  regularRow.classList.remove(
                    "is-drop-target"
                  )
              );
            }
          );
        }
      );


      /*
       * =====================================================
       * DRAG & DROP AUF STAMMFAHRER
       * =====================================================
       */

      regularRows.forEach(
        (row) => {
          row.addEventListener(
            "dragover",
            (event) => {
              const status =
                row.querySelector(
                  "[data-regular-status]"
                );

              if (
                !status ||
                !replacementStatuses.has(
                  status.value
                )
              ) {
                return;
              }

              if (
                !draggedReserveId
              ) {
                return;
              }

              const reserveRow =
                reserveRows.find(
                  (
                    candidate
                  ) =>
                    String(
                      candidate.dataset
                        .reserveId
                    ) ===
                    String(
                      draggedReserveId
                    )
                );

              if (!reserveRow) {
                return;
              }

              const reserve =
                reserveState(
                  reserveRow
                );

              if (
                reserve.locked ||
                !allowedReserveStatuses.has(
                  reserve.status
                )
              ) {
                return;
              }

              if (
                usedReserveIds(
                  row
                ).has(
                  reserve.id
                )
              ) {
                return;
              }

              event.preventDefault();

              event.dataTransfer.dropEffect =
                "move";

              row.classList.add(
                "is-drop-target"
              );
            }
          );


          row.addEventListener(
            "dragleave",
            () => {
              row.classList.remove(
                "is-drop-target"
              );
            }
          );


          row.addEventListener(
            "drop",
            (event) => {
              event.preventDefault();

              row.classList.remove(
                "is-drop-target"
              );

              const status =
                row.querySelector(
                  "[data-regular-status]"
                );

              if (
                !status ||
                !replacementStatuses.has(
                  status.value
                )
              ) {
                return;
              }


              const reserveId =
                String(
                  event.dataTransfer.getData(
                    "text/plain"
                  ) ||
                  draggedReserveId ||
                  ""
                );


              if (!reserveId) {
                return;
              }


              if (
                usedReserveIds(
                  row
                ).has(
                  reserveId
                )
              ) {
                return;
              }


              const reserveRow =
                reserveRows.find(
                  (
                    candidate
                  ) =>
                    String(
                      candidate.dataset
                        .reserveId
                    ) ===
                    reserveId
                );


              if (!reserveRow) {
                return;
              }


              const reserve =
                reserveState(
                  reserveRow
                );


              if (
                reserve.locked ||
                !allowedReserveStatuses.has(
                  reserve.status
                )
              ) {
                return;
              }


              /*
               * Cockpitzuordnung speichern.
               */

              setReplacement(
                row,
                reserveId
              );


              refresh();
            }
          );
        }
      );


      /*
       * =====================================================
       * SUBMIT
       * =====================================================
       */

      form.addEventListener(
        "submit",
        (event) => {
          const selected =
            new Set();


          for (
            const row of
            regularRows
          ) {
            const status =
              row.querySelector(
                "[data-regular-status]"
              );

            const hidden =
              replacementInputFor(
                row
              );

            const select =
              replacementSelectFor(
                row
              );


            /*
             * Kein Ersatz zulässig.
             */

            if (
              !status ||
              !replacementStatuses.has(
                status.value
              )
            ) {
              if (hidden) {
                hidden.value =
                  "";
              }

              continue;
            }


            /*
             * Sichtbaren Select final
             * ins Hidden Input schreiben.
             */

            if (
              hidden &&
              select &&
              !select.disabled
            ) {
              hidden.value =
                select.value;
            }


            const reserveId =
              String(
                hidden?.value ||
                ""
              );


            if (!reserveId) {
              continue;
            }


            if (
              selected.has(
                reserveId
              )
            ) {
              event.preventDefault();

              if (feedback) {
                feedback.classList.add(
                  "is-error"
                );

                feedback.textContent =
                  "Ein Ersatzfahrer darf nur einem Cockpit zugeordnet werden.";

                feedback.scrollIntoView({
                  behavior:
                    "smooth",

                  block:
                    "center",
                });
              }

              return;
            }


            selected.add(
              reserveId
            );


            const reserveRow =
              reserveRows.find(
                (
                  candidate
                ) =>
                  String(
                    candidate.dataset
                      .reserveId
                  ) ===
                  reserveId
              );


            const reserve =
              reserveRow
                ? reserveState(
                    reserveRow
                  )
                : null;


            if (
              !reserve ||
              !allowedReserveStatuses.has(
                reserve.status
              )
            ) {
              event.preventDefault();

              if (feedback) {
                feedback.classList.add(
                  "is-error"
                );

                feedback.textContent =
                  "Der ausgewählte Ersatzfahrer ist nicht verfügbar.";
              }

              return;
            }
          }
        }
      );


      /*
       * =====================================================
       * INITIAL
       * =====================================================
       */

      refresh();
    });
});