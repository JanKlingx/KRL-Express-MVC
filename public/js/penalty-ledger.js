(() => {
  /*
   * =====================================================
   * GRUNDELEMENTE
   * =====================================================
   */

  const colorMenu =
    document.querySelector(
      "[data-color-menu]",
    );

  const colorPicker =
    document.querySelector(
      "[data-color-picker]",
    );

  const clearColorButton =
    document.querySelector(
      "[data-color-clear]",
    );

  let activeColorInput = null;


  /*
   * Inputs immer live laden.
   *
   * Wichtig, weil bei ehemaligen Fahrern
   * eine komplette Zeile aus dem DOM
   * verschwinden kann.
   */
  function getInputs() {
    return [
      ...document.querySelectorAll(
        ".penalty-cell-input",
      ),
    ];
  }


  /*
   * =====================================================
   * STATUSMELDUNG
   * =====================================================
   */

  function showStatus(
    input,
    message,
    type = "success",
  ) {
    const ledger =
      input.closest(
        "[data-penalty-ledger]",
      );

    const status =
      ledger?.querySelector(
        "[data-save-status]",
      );

    if (!status) {
      return;
    }


    status.textContent =
      message;


    status.classList.remove(
      "is-success",
      "is-error",
    );


    status.classList.add(
      "is-visible",
      type === "error"
        ? "is-error"
        : "is-success",
    );


    clearTimeout(
      status._timer,
    );


    status._timer =
      setTimeout(
        () => {
          status.classList.remove(
            "is-visible",
          );
        },
        1800,
      );
  }


  /*
   * =====================================================
   * AUTOMATISCHE SCHRIFTFARBE
   * =====================================================
   */

  function contrastColor(hex) {
    const value =
      String(
        hex || "",
      ).replace(
        "#",
        "",
      );


    if (
      value.length !== 6
    ) {
      return "#ffffff";
    }


    const r =
      parseInt(
        value.substring(
          0,
          2,
        ),
        16,
      );


    const g =
      parseInt(
        value.substring(
          2,
          4,
        ),
        16,
      );


    const b =
      parseInt(
        value.substring(
          4,
          6,
        ),
        16,
      );


    const brightness =
      (
        r * 299 +
        g * 587 +
        b * 114
      ) / 1000;


    return brightness > 155
      ? "#071016"
      : "#ffffff";
  }


  /*
   * =====================================================
   * ZELLEN-DESIGN
   * =====================================================
   */

  function refreshInputStyle(
    input,
  ) {
    const value =
      String(
        input.value || "",
      )
        .trim()
        .toUpperCase();


    const cell =
      input.closest(
        "[data-penalty-cell]",
      );


    const color =
      String(
        input.dataset.savedColor ||
        cell?.dataset.savedColor ||
        "",
      );


    const isBan =
      value === "S";


    const valid =
      value === "" ||
      value === "S" ||
      /^[1-9]\d*$/.test(
        value,
      );


    input.classList.toggle(
      "is-invalid",
      !valid,
    );


    if (!cell) {
      return valid;
    }


    cell.classList.toggle(
      "is-ban-cell",
      isBan,
    );


    /*
     * =================================================
     * S = IMMER ROT
     * =================================================
     */

    if (isBan) {
      cell.style.setProperty(
        "background-color",
        "#c62828",
        "important",
      );


      input.style.setProperty(
        "background-color",
        "transparent",
        "important",
      );


      input.style.setProperty(
        "color",
        "#ffffff",
        "important",
      );


      return valid;
    }


    /*
     * =================================================
     * FREIE ZELLFARBE
     * =================================================
     */

    if (color) {
      cell.style.setProperty(
        "background-color",
        color,
        "important",
      );


      input.style.setProperty(
        "background-color",
        "transparent",
        "important",
      );


      input.style.setProperty(
        "color",
        contrastColor(
          color,
        ),
        "important",
      );


      return valid;
    }


    /*
     * =================================================
     * KEINE SONDERFARBE
     * =================================================
     */

    cell.style.removeProperty(
      "background-color",
    );


    input.style.setProperty(
      "background-color",
      "transparent",
      "important",
    );


    input.style.removeProperty(
      "color",
    );


    return valid;
  }


  /*
   * =====================================================
   * WERT NORMALISIEREN
   * =====================================================
   */

  function normalizeValue(
    input,
  ) {
    let value =
      String(
        input.value || "",
      )
        .trim()
        .toUpperCase();


    /*
     * S bleibt S.
     */
    if (
      value === "S"
    ) {
      input.value =
        "S";


      refreshInputStyle(
        input,
      );


      return "S";
    }


    /*
     * Sonst ausschließlich Zahlen.
     */
    value =
      value.replace(
        /[^0-9]/g,
        "",
      );


    /*
     * Führende Nullen entfernen.
     */
    value =
      value.replace(
        /^0+/,
        "",
      );


    input.value =
      value;


    refreshInputStyle(
      input,
    );


    return value;
  }


  /*
   * =====================================================
   * NORMALE LIGA-ZEILE AKTUALISIEREN
   * =====================================================
   */

  function updateLeagueRow(
    row,
    result,
  ) {
    const total =
      row.querySelector(
        "[data-row-total]",
      );


    const remaining =
      row.querySelector(
        "[data-row-remaining]",
      );


    const status =
      row.querySelector(
        "[data-row-status]",
      );


    if (total) {
      total.textContent =
        result.totalPoints;
    }


    if (remaining) {
      remaining.textContent =
        result.remaining;
    }


    row.classList.toggle(
      "row-danger",
      Boolean(
        result.suspended,
      ),
    );


    if (status) {
      status.textContent =
        result.suspended
          ? "GESPERRT"
          : "FREI";


      status.classList.toggle(
        "is-banned",
        Boolean(
          result.suspended,
        ),
      );


      status.classList.toggle(
        "is-free",
        !result.suspended,
      );
    }
  }


  /*
   * =====================================================
   * GLOBALE ZEILE AKTUALISIEREN
   * =====================================================
   *
   * Ersatzfahrer + ehemalige Fahrer.
   */

  function updateGlobalRow(
    row,
    result,
  ) {
    const type =
      row.dataset.globalRow ||
      "";


    const total =
      row.querySelector(
        "[data-global-row-total]",
      );


    const status =
      row.querySelector(
        "[data-global-row-status]",
      );


    if (total) {
      total.textContent =
        result.globalPoints ??
        0;
    }


    row.classList.toggle(
      "row-danger",
      Boolean(
        result.globalHasBan,
      ),
    );


    if (!status) {
      return;
    }


    if (
      type === "former"
    ) {
      status.textContent =
        result.globalHasBan
          ? "SPERRE"
          : "REST-SP";
    } else {
      status.textContent =
        result.globalHasBan
          ? "SPERRE"
          : "AKTIV";
    }


    status.classList.toggle(
      "is-banned",
      Boolean(
        result.globalHasBan,
      ),
    );


    status.classList.toggle(
      "is-free",
      !result.globalHasBan,
    );
  }


  /*
   * =====================================================
   * ZEILE AKTUALISIEREN
   * =====================================================
   */

  function updateRow(
    input,
    result,
  ) {
    const row =
      input.closest(
        "[data-penalty-row]",
      );


    if (!row) {
      return;
    }


    if (
      row.dataset.globalRow
    ) {
      updateGlobalRow(
        row,
        result,
      );

      return;
    }


    updateLeagueRow(
      row,
      result,
    );
  }


  /*
   * =====================================================
   * EHEMALIGEN-ZEILE ENTFERNEN
   * =====================================================
   *
   * Sobald:
   *
   * globalPoints = 0
   * globalHasBan = false
   *
   * verschwindet der Fahrer.
   */

  function removeFormerRow(
    row,
  ) {
    if (
      !row ||
      row.dataset.globalRow !==
        "former"
    ) {
      return;
    }


    const section =
      row.closest(
        "#ehemalige-fahrer",
      );


    row.remove();


    if (!section) {
      return;
    }


    const remainingRows =
      section.querySelectorAll(
        "[data-former-row]",
      );


    /*
     * Fahreranzahl im Header aktualisieren.
     */
    const countElement =
      section.querySelector(
        ".penalty-global-header .penalty-limit",
      );


    if (countElement) {
      countElement.textContent =
        `${remainingRows.length} Fahrer`;
    }


    /*
     * Letzter ehemaliger Fahrer wurde entfernt.
     */
    if (
      remainingRows.length === 0
    ) {
      const matrixWrap =
        section.querySelector(
          ".penalty-global-matrix-wrap",
        );


      if (matrixWrap) {
        const empty =
          document.createElement(
            "div",
          );


        empty.className =
          "empty-state";


        empty.textContent =
          "Keine ehemaligen Fahrer mit Reststrafen.";


        matrixWrap.replaceWith(
          empty,
        );
      }
    }
  }


  /*
   * =====================================================
   * ZELLE SPEICHERN
   * =====================================================
   */

  async function saveCell(
    input,
    options = {},
  ) {
    /*
     * Wird für die Tab-Navigation benötigt.
     */
    input._rowRemoved =
      false;


    if (
      input.dataset.saving ===
      "1"
    ) {
      return true;
    }


    const value =
      normalizeValue(
        input,
      );


    const previousValue =
      String(
        input.dataset.savedValue ||
        "",
      );


    const previousColor =
      String(
        input.dataset.savedColor ||
        "",
      );


    let requestedColor =
      Object.prototype
        .hasOwnProperty
        .call(
          options,
          "cellColor",
        )
        ? String(
            options.cellColor ||
            "",
          )
        : previousColor;


    /*
     * =================================================
     * S HAT KEINE EIGENE FREIE FARBE
     * =================================================
     */

    if (
      value === "S"
    ) {
      requestedColor = "";
    }


    /*
     * =================================================
     * VALIDIERUNG
     * =================================================
     */

    if (
      value !== "" &&
      value !== "S" &&
      !/^[1-9]\d*$/.test(
        value,
      )
    ) {
      input.value =
        previousValue;


      refreshInputStyle(
        input,
      );


      showStatus(
        input,
        'Nur Strafpunkte oder "S" erlaubt.',
        "error",
      );


      return false;
    }


    const valueChanged =
      value !==
      previousValue;


    const colorChanged =
      requestedColor !==
      previousColor;


    if (
      !valueChanged &&
      !colorChanged
    ) {
      return true;
    }


    input.dataset.saving =
      "1";


    const cell =
      input.closest(
        "[data-penalty-cell]",
      );


    const row =
      input.closest(
        "[data-penalty-row]",
      );


    cell?.classList.add(
      "is-saving",
    );


    cell?.classList.remove(
      "is-error",
      "is-saved",
    );


    try {
      /*
       * =================================================
       * REQUEST
       * =================================================
       */

      const body =
        new URLSearchParams();


      body.set(
        "LeagueId",
        input.dataset.leagueId,
      );


      body.set(
        "SeasonId",
        input.dataset.seasonId,
      );


      body.set(
        "DriverId",
        input.dataset.driverId,
      );


      body.set(
        "roundNumber",
        input.dataset.roundNumber,
      );


      body.set(
        "cellValue",
        value,
      );


      body.set(
        "cellColor",
        requestedColor,
      );


      const response =
        await fetch(
          "/admin/penalty-ledger",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded;charset=UTF-8",

              "Accept":
                "application/json",

              "X-Requested-With":
                "XMLHttpRequest",
            },

            body:
              body.toString(),
          },
        );


      let result;


      try {
        result =
          await response.json();
      } catch {
        throw new Error(
          "Serverantwort konnte nicht gelesen werden.",
        );
      }


      if (
        !response.ok ||
        !result?.ok
      ) {
        throw new Error(
          result?.message ||
          "Speichern fehlgeschlagen.",
        );
      }


      /*
       * =================================================
       * GESPEICHERTE WERTE
       * =================================================
       */

      const savedValue =
        String(
          result.value ||
          "",
        );


      const savedColor =
        String(
          result.cellColor ||
          "",
        );


      input.value =
        savedValue;


      input.dataset.savedValue =
        savedValue;


      input.dataset.savedColor =
        savedColor;


      if (cell) {
        cell.dataset.savedColor =
          savedColor;
      }


      refreshInputStyle(
        input,
      );


      /*
       * =================================================
       * SUMMEN / STATUS
       * =================================================
       */

      updateRow(
        input,
        result,
      );


      /*
       * =================================================
       * VISUELLES SPEICHER-FEEDBACK
       * =================================================
       */

      cell?.classList.add(
        "is-saved",
      );


      setTimeout(
        () => {
          cell?.classList.remove(
            "is-saved",
          );
        },
        500,
      );


      /*
       * =================================================
       * MELDUNG
       * =================================================
       */

      if (
        savedValue === "S"
      ) {
        showStatus(
          input,
          `R${input.dataset.roundNumber}: Rennsperre gespeichert.`,
        );
      } else if (
        savedValue
      ) {
        showStatus(
          input,
          `R${input.dataset.roundNumber}: ${savedValue} SP gespeichert.`,
        );
      } else if (
        savedColor
      ) {
        showStatus(
          input,
          `R${input.dataset.roundNumber}: Markierung gespeichert.`,
        );
      } else {
        showStatus(
          input,
          `R${input.dataset.roundNumber}: Eintrag entfernt.`,
        );
      }


      /*
       * =================================================
       * EHEMALIGER FAHRER OHNE RESTSTRAFE
       * =================================================
       *
       * Farbe allein hält den Fahrer NICHT
       * in der Ehemaligen-Tabelle.
       */

      if (
        row?.dataset.globalRow ===
          "former" &&
        result.hasGlobalPenalty ===
          false
      ) {
        input._rowRemoved =
          true;


        removeFormerRow(
          row,
        );
      }


      return true;
    } catch (error) {
      /*
       * =================================================
       * FEHLER -> ALTEN STAND WIEDERHERSTELLEN
       * =================================================
       */

      input.value =
        previousValue;


      input.dataset.savedValue =
        previousValue;


      input.dataset.savedColor =
        previousColor;


      if (cell) {
        cell.dataset.savedColor =
          previousColor;
      }


      refreshInputStyle(
        input,
      );


      cell?.classList.add(
        "is-error",
      );


      showStatus(
        input,
        error.message ||
        "Speichern fehlgeschlagen.",
        "error",
      );


      setTimeout(
        () => {
          cell?.classList.remove(
            "is-error",
          );
        },
        1000,
      );


      return false;
    } finally {
      delete input.dataset.saving;


      cell?.classList.remove(
        "is-saving",
      );
    }
  }


  /*
   * =====================================================
   * TAB-NAVIGATION
   * =====================================================
   */

  function focusRelativeCell(
    input,
    direction,
    originalIndex = null,
  ) {
    const inputs =
      getInputs();


    /*
     * Zeile existiert noch.
     */
    const liveIndex =
      inputs.indexOf(
        input,
      );


    if (
      liveIndex >= 0
    ) {
      const next =
        inputs[
          liveIndex +
          direction
        ];


      if (!next) {
        return;
      }


      next.focus();
      next.select();

      return;
    }


    /*
     * Die aktuelle Ehemaligen-Zeile wurde
     * beim Speichern gelöscht.
     *
     * Dann anhand der vorherigen Position
     * weiterspringen.
     */
    if (
      !Number.isInteger(
        originalIndex,
      )
    ) {
      return;
    }


    const targetIndex =
      direction > 0
        ? originalIndex
        : originalIndex - 1;


    const next =
      inputs[
        targetIndex
      ];


    if (!next) {
      return;
    }


    next.focus();
    next.select();
  }


  /*
   * =====================================================
   * FARB-MENÜ
   * =====================================================
   */

  function closeColorMenu() {
    colorMenu?.classList.remove(
      "is-open",
    );


    activeColorInput =
      null;
  }


  function openColorMenu(
    event,
    input,
  ) {
    event.preventDefault();


    /*
     * S ist immer rot.
     */
    if (
      String(
        input.value ||
        "",
      )
        .trim()
        .toUpperCase() ===
      "S"
    ) {
      showStatus(
        input,
        "Eine Rennsperre bleibt immer rot.",
      );


      return;
    }


    activeColorInput =
      input;


    const currentColor =
      input.dataset.savedColor ||
      "#4a90e2";


    if (
      colorPicker &&
      /^#[0-9a-f]{6}$/i.test(
        currentColor,
      )
    ) {
      colorPicker.value =
        currentColor;
    }


    if (!colorMenu) {
      return;
    }


    colorMenu.classList.add(
      "is-open",
    );


    const menuWidth =
      200;


    const menuHeight =
      135;


    let left =
      event.clientX;


    let top =
      event.clientY;


    if (
      left + menuWidth >
      window.innerWidth
    ) {
      left =
        window.innerWidth -
        menuWidth -
        10;
    }


    if (
      top + menuHeight >
      window.innerHeight
    ) {
      top =
        window.innerHeight -
        menuHeight -
        10;
    }


    colorMenu.style.left =
      `${Math.max(
        8,
        left,
      )}px`;


    colorMenu.style.top =
      `${Math.max(
        8,
        top,
      )}px`;
  }


  /*
   * =====================================================
   * FARBE SPEICHERN
   * =====================================================
   */

  async function applyColor(
    color,
  ) {
    if (
      !activeColorInput
    ) {
      return;
    }


    const input =
      activeColorInput;


    closeColorMenu();


    const success =
      await saveCell(
        input,
        {
          cellColor:
            color,
        },
      );


    if (success) {
      /*
       * saveCell zeigt bereits den
       * eigentlichen Speicherstatus.
       */
      return;
    }
  }


  colorPicker?.addEventListener(
    "change",
    () => {
      applyColor(
        colorPicker.value,
      );
    },
  );


  clearColorButton?.addEventListener(
    "click",
    () => {
      applyColor(
        "",
      );
    },
  );


  document.addEventListener(
    "mousedown",
    (event) => {
      if (
        colorMenu?.classList.contains(
          "is-open",
        ) &&
        !colorMenu.contains(
          event.target,
        )
      ) {
        closeColorMenu();
      }
    },
  );


  window.addEventListener(
    "scroll",
    closeColorMenu,
    true,
  );


  /*
   * =====================================================
   * EINZELNES INPUT INITIALISIEREN
   * =====================================================
   */

  function initializeInput(
    input,
  ) {
    if (
      input.dataset.penaltyInitialized ===
      "1"
    ) {
      return;
    }


    input.dataset.penaltyInitialized =
      "1";


    const cell =
      input.closest(
        "[data-penalty-cell]",
      );


    if (cell) {
      cell.dataset.savedColor =
        input.dataset.savedColor ||
        "";
    }


    refreshInputStyle(
      input,
    );


    /*
     * =================================================
     * FOCUS
     * =================================================
     */

    input.addEventListener(
      "focus",
      () => {
        input.select();
      },
    );


    /*
     * =================================================
     * TASTATURFILTER
     * =================================================
     */

    input.addEventListener(
      "keydown",
      (event) => {
        if (
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        ) {
          return;
        }


        const controlKeys = [
          "Backspace",
          "Delete",
          "Enter",
          "Escape",
          "Tab",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ];


        if (
          controlKeys.includes(
            event.key,
          )
        ) {
          return;
        }


        /*
         * Zahlen.
         */
        if (
          /^[0-9]$/.test(
            event.key,
          )
        ) {
          return;
        }


        /*
         * Einziger erlaubter Buchstabe:
         * S = Rennsperre.
         */
        if (
          event.key === "s" ||
          event.key === "S"
        ) {
          return;
        }


        /*
         * Alles andere verhindern.
         */
        event.preventDefault();
      },
    );


    /*
     * =================================================
     * COPY / PASTE
     * =================================================
     */

    input.addEventListener(
      "paste",
      (event) => {
        const pasted =
          String(
            event.clipboardData
              ?.getData(
                "text",
              ) ||
            "",
          )
            .trim()
            .toUpperCase();


        if (
          pasted === "S" ||
          /^[1-9]\d*$/.test(
            pasted,
          )
        ) {
          return;
        }


        event.preventDefault();


        showStatus(
          input,
          'Nur Strafpunkte oder "S" erlaubt.',
          "error",
        );
      },
    );


    /*
     * =================================================
     * LIVE-EINGABE
     * =================================================
     */

    input.addEventListener(
      "input",
      () => {
        let value =
          String(
            input.value ||
            "",
          )
            .trim()
            .toUpperCase();


        if (
          value === "S"
        ) {
          input.value =
            "S";


          refreshInputStyle(
            input,
          );


          return;
        }


        value =
          value.replace(
            /[^0-9]/g,
            "",
          );


        value =
          value.replace(
            /^0+/,
            "",
          );


        input.value =
          value;


        refreshInputStyle(
          input,
        );
      },
    );


    /*
     * =================================================
     * RECHTSKLICK = FARBE
     * =================================================
     */

    input.addEventListener(
      "contextmenu",
      (event) => {
        openColorMenu(
          event,
          input,
        );
      },
    );


    /*
     * =================================================
     * ENTER / ESCAPE / TAB
     * =================================================
     */

    input.addEventListener(
      "keydown",
      async (event) => {
        /*
         * ENTER
         */
        if (
          event.key ===
          "Enter"
        ) {
          event.preventDefault();


          const success =
            await saveCell(
              input,
            );


          if (
            success &&
            document.body.contains(
              input,
            )
          ) {
            input.blur();
          }


          return;
        }


        /*
         * ESCAPE
         */
        if (
          event.key ===
          "Escape"
        ) {
          event.preventDefault();


          input.value =
            input.dataset.savedValue ||
            "";


          refreshInputStyle(
            input,
          );


          input.blur();


          return;
        }


        /*
         * TAB
         */
        if (
          event.key ===
          "Tab"
        ) {
          event.preventDefault();


          const direction =
            event.shiftKey
              ? -1
              : 1;


          const beforeInputs =
            getInputs();


          const originalIndex =
            beforeInputs.indexOf(
              input,
            );


          const success =
            await saveCell(
              input,
            );


          if (success) {
            focusRelativeCell(
              input,
              direction,
              originalIndex,
            );
          }


          return;
        }
      },
    );


    /*
     * =================================================
     * BLUR = SPEICHERN
     * =================================================
     */

    input.addEventListener(
      "blur",
      () => {
        /*
         * Falls die Zeile bereits gelöscht wurde,
         * nichts mehr speichern.
         */
        if (
          !document.body.contains(
            input,
          )
        ) {
          return;
        }


        saveCell(
          input,
        );
      },
    );
  }


  /*
   * =====================================================
   * ALLE ZELLEN INITIALISIEREN
   * =====================================================
   */

  getInputs().forEach(
    initializeInput,
  );
})();