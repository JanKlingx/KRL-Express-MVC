document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector(
    "[data-result-race-control]"
  );

  const mount = form?.querySelector(
    "[data-result-control-mount]"
  );

  const dataNode = form?.querySelector(
    "[data-result-control-points]"
  );

  if (!form || !mount || !dataNode) {
    return;
  }


  const config = JSON.parse(
    dataNode.textContent || "{}"
  );


  if (config.pointsMode === "manual") {
    mount.innerHTML = `
      <div class="result-manual-notice">
        <strong>MANUELLE PUNKTE</strong>

        <span>
          Positionen bleiben eindeutig;
          Punktwerte werden wie bisher manuell gepflegt.
        </span>
      </div>
    `;

    return;
  }


  const sourceRows = [
    ...form.querySelectorAll(
      "[data-result-driver]"
    ),
  ];


  if (!sourceRows.length) {
    return;
  }


  form.classList.add(
    "has-visual-result-control"
  );


  const sourceGrid =
    sourceRows[0].closest(
      ".lineup-team-grid"
    );


  sourceGrid?.setAttribute(
    "aria-hidden",
    "true"
  );


  const driverData =
    sourceRows.map((row) => ({
      id:
        row.dataset.resultDriver,

      name:
        row.dataset.driverName,

      team:
        row.dataset.teamName,

      logo:
        row.dataset.teamLogo,

      reserve:
        row.dataset.isReserve ===
        "true",

      row,

      status:
        row.querySelector(
          "[data-result-status]"
        ),
    }));


  let activeDriver = null;


  /*
   * =====================================================
   * HTML ESCAPE
   * =====================================================
   */

  const escapeHtml = (value) =>
    String(value || "").replace(
      /[&<>'"]/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[character]
    );


  /*
   * =====================================================
   * NAME FÜR VERSTECKTE BONUS-FELDER
   * =====================================================
   */

  function bonusInputName(
    driver,
    raceType,
    kind
  ) {
    const prefix =
      `rows[d${driver.id}]`;


    if (kind === "fastest") {
      return raceType === "sprint"
        ? `${prefix}[sprintFastestLap]`
        : `${prefix}[fastestLap]`;
    }


    if (kind === "pole") {
      return raceType === "sprint"
        ? `${prefix}[sprintPolePosition]`
        : `${prefix}[polePosition]`;
    }


    if (kind === "dotd") {
      return `${prefix}[driverOfTheDay]`;
    }


    return "";
  }


  /*
   * =====================================================
   * BONUS-FELD AUTOMATISCH ERZEUGEN
   * =====================================================
   */

  function ensureBonusInput(
    driver,
    raceType,
    kind
  ) {
    let selector;


    if (kind === "fastest") {
      selector =
        `[data-result-fastest="${raceType}"]`;
    } else if (kind === "pole") {
      selector =
        `[data-result-pole="${raceType}"]`;
    } else if (kind === "dotd") {
      selector =
        `[data-result-dotd="${raceType}"]`;
    } else {
      return null;
    }


    let input =
      driver.row.querySelector(
        selector
      );


    if (input) {
      return input;
    }


    /*
     * Falls EJS das Feld noch nicht besitzt:
     * Checkbox dynamisch erzeugen.
     */

    input =
      document.createElement(
        "input"
      );


    input.type =
      "checkbox";


    input.hidden =
      true;


    input.name =
      bonusInputName(
        driver,
        raceType,
        kind
      );


    if (kind === "fastest") {
      input.dataset.resultFastest =
        raceType;
    }


    if (kind === "pole") {
      input.dataset.resultPole =
        raceType;
    }


    if (kind === "dotd") {
      input.dataset.resultDotd =
        raceType;
    }


    driver.row.appendChild(
      input
    );


    return input;
  }


  /*
   * =====================================================
   * INPUT FINDEN
   * =====================================================
   */

  function inputFor(
    driver,
    raceType,
    kind
  ) {
    if (!driver) {
      return null;
    }


    if (kind === "position") {
      return driver.row.querySelector(
        `[data-result-position="${raceType}"]`
      );
    }


    if (
      kind === "fastest" ||
      kind === "pole" ||
      kind === "dotd"
    ) {
      return ensureBonusInput(
        driver,
        raceType,
        kind
      );
    }


    return null;
  }


  /*
   * =====================================================
   * BONUS-FELDER DIREKT VORBEREITEN
   * =====================================================
   */

  driverData.forEach((driver) => {
    ensureBonusInput(
      driver,
      "main",
      "fastest"
    );

    ensureBonusInput(
      driver,
      "main",
      "pole"
    );

    ensureBonusInput(
      driver,
      "main",
      "dotd"
    );


    if (config.hasSprint) {
      ensureBonusInput(
        driver,
        "sprint",
        "fastest"
      );

      ensureBonusInput(
        driver,
        "sprint",
        "pole"
      );
    }
  });


  /*
   * =====================================================
   * FAHRERKARTE
   * =====================================================
   */

  function buildDriverCard(
    driver,
    raceType,
    setBonus
  ) {
    const card =
      document.createElement(
        "button"
      );


    card.type =
      "button";


    card.className =
      `result-control-driver ${
        driver.reserve
          ? "is-reserve"
          : ""
      }`;


    card.dataset.driverId =
      driver.id;


    card.draggable =
      true;


    const status =
      driver.status?.value ||
      "";


    const visualLogo =
      driver.reserve
        ? config.leagueLogo
        : driver.logo;


    const bonuses = [
      inputFor(
        driver,
        raceType,
        "pole"
      )?.checked
        ? "POLE POSITION"
        : "",

      inputFor(
        driver,
        raceType,
        "fastest"
      )?.checked
        ? "SCHNELLSTE RUNDE"
        : "",

      (
        raceType === "main" &&
        inputFor(
          driver,
          raceType,
          "dotd"
        )?.checked
      )
        ? "DRIVER OF THE DAY"
        : "",
    ].filter(Boolean);


    card.innerHTML = `
      ${
        visualLogo
          ? `
            <img
              src="${escapeHtml(visualLogo)}"
              alt=""
            >
          `
          : `
            <span class="result-control-logo">
              KRL
            </span>
          `
      }

      <span>

        <strong>
          ${escapeHtml(driver.name)}
        </strong>

        <small>
          ${
            driver.reserve
              ? "ERSATZ · "
              : ""
          }

          ${escapeHtml(
            driver.team ||
            "Team"
          )}
        </small>

        <em>
          ${
            bonuses
              .map(escapeHtml)
              .join(" · ")
          }
        </em>

      </span>

      <b data-result-card-status>
        ${escapeHtml(
          status ||
          "GEWERTET"
        )}
      </b>
    `;


    /*
     * ===================================================
     * DNF / DSQ
     * ===================================================
     */

    const statusBadge =
      card.querySelector(
        "[data-result-card-status]"
      );


    statusBadge.title =
      "Status wechseln: Gewertet → DNF → DSQ";


    statusBadge.addEventListener(
      "click",
      (event) => {
        event.stopPropagation();


        const values = [
          "",
          "DNF",
          "DSQ",
        ];


        const currentIndex =
          values.indexOf(
            driver.status.value
          );


        driver.status.value =
          values[
            (
              currentIndex + 1
            ) %
            values.length
          ];


        driver.status.dispatchEvent(
          new Event(
            "change",
            {
              bubbles: true,
            }
          )
        );
      }
    );


    /*
     * ===================================================
     * FAHRER DRAG
     * ===================================================
     */

    card.addEventListener(
      "dragstart",
      (event) => {
        /*
         * Nur Fahrer-ID setzen.
         */

        event.dataTransfer.setData(
          "text/plain",
          driver.id
        );


        event.dataTransfer.effectAllowed =
          "move";
      }
    );


    /*
     * ===================================================
     * BONUS DROP DIREKT AUF KARTE
     * ===================================================
     */

    card.addEventListener(
      "dragover",
      (event) => {
        const types =
          Array.from(
            event.dataTransfer
              ?.types ||
            []
          );


        if (
          types.includes(
            "application/x-result-bonus"
          )
        ) {
          event.preventDefault();

          event.dataTransfer.dropEffect =
            "copy";


          card.classList.add(
            "is-bonus-drop-target"
          );
        }
      }
    );


    card.addEventListener(
      "dragleave",
      () => {
        card.classList.remove(
          "is-bonus-drop-target"
        );
      }
    );


    card.addEventListener(
      "drop",
      (event) => {
        const kind =
          event.dataTransfer
            ?.getData(
              "application/x-result-bonus"
            );


        if (!kind) {
          return;
        }


        event.preventDefault();

        event.stopPropagation();


        card.classList.remove(
          "is-bonus-drop-target"
        );


        /*
         * HIER wird Pole / Fastest / DOTD
         * tatsächlich gesetzt.
         */

        setBonus(
          kind,
          driver.id
        );
      }
    );


    /*
     * ===================================================
     * FAHRER AUSWÄHLEN
     * ===================================================
     */

    card.addEventListener(
      "click",
      () => {
        activeDriver =
          activeDriver ===
          driver.id
            ? null
            : driver.id;


        mount
          .querySelectorAll(
            ".result-control-driver"
          )
          .forEach((item) => {
            item.classList.toggle(
              "is-selected",
              item.dataset.driverId ===
                activeDriver
            );
          });
      }
    );


    return card;
  }


  /*
   * =====================================================
   * SUCHE
   * =====================================================
   */

  function normalizeSearch(
    value
  ) {
    return String(value || "")
      .toLocaleLowerCase("de")
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      )
      .trim();
  }


  function matchesSearch(
    driver,
    query
  ) {
    if (!query) {
      return true;
    }


    const searchable =
      normalizeSearch(
        [
          driver.name,
          driver.team,

          driver.reserve
            ? "ersatz ersatzfahrer"
            : "stammfahrer",
        ].join(" ")
      );


    return searchable.includes(
      query
    );
  }


  /*
   * =====================================================
   * RACE BOARD
   * =====================================================
   */

  function createRaceBoard(
    raceType
  ) {
    const points =
      new Map(
        (
          config[raceType] ||
          []
        ).map((row) => [
          Number(row.position),
          Number(row.points),
        ])
      );


    const section =
      document.createElement(
        "section"
      );


    section.className =
      `result-control-board result-control-${raceType}`;


    section.dataset.resultBoard =
      raceType;


    /*
     * ===================================================
     * HTML
     * ===================================================
     */

    section.innerHTML = `
      <header>

        <div>
          <span>
            ${
              raceType === "sprint"
                ? "SPRINT"
                : "HAUPTRENNEN"
            }
          </span>

          <strong>
            Positionsturm
          </strong>
        </div>


        <div class="result-control-badges">

          <button
            type="button"
            draggable="true"
            data-bonus="fastest"
          >
            SCHNELLSTE RUNDE
          </button>


          ${
            raceType === "main"
              ? `
                <button
                  type="button"
                  draggable="true"
                  data-bonus="dotd"
                >
                  DRIVER OF THE DAY
                </button>
              `
              : ""
          }


          <button
            type="button"
            draggable="true"
            data-bonus="pole"
          >
            POLE POSITION
          </button>

        </div>

      </header>


      <div class="result-control-workspace">

        <div
          class="result-position-tower"
          data-position-tower
        ></div>


        <aside
          class="result-driver-pool"
          data-driver-pool
        >

          <header>

            <div>
              <strong>
                FAHRERPOOL
              </strong>

              <small>
                Fahrer suchen oder auf eine Position ziehen
              </small>
            </div>


            <span
              class="result-driver-search-count"
              data-driver-search-count
            ></span>

          </header>


          <div class="result-driver-search">

            <span
              class="result-driver-search__icon"
            >
              ⌕
            </span>


            <input
              type="search"
              data-driver-search
              placeholder="Fahrer oder Team suchen ..."
              autocomplete="off"
            >


            <button
              type="button"
              data-driver-search-clear
              hidden
            >
              ×
            </button>

          </div>


          <div
            data-pool-cards
          ></div>


          <div
            class="result-driver-search-empty"
            data-driver-search-empty
            hidden
          >
            Kein Fahrer gefunden.
          </div>

        </aside>

      </div>


      <div
        class="result-control-summary"
        data-result-summary
      ></div>
    `;


    const tower =
      section.querySelector(
        "[data-position-tower]"
      );


    const pool =
      section.querySelector(
        "[data-pool-cards]"
      );


    const searchInput =
      section.querySelector(
        "[data-driver-search]"
      );


    const searchClear =
      section.querySelector(
        "[data-driver-search-clear]"
      );


    const searchCount =
      section.querySelector(
        "[data-driver-search-count]"
      );


    const searchEmpty =
      section.querySelector(
        "[data-driver-search-empty]"
      );


    /*
     * ===================================================
     * POSITIONEN ERZEUGEN
     * ===================================================
     */

    for (
      let position = 1;
      position <=
        driverData.length;
      position += 1
    ) {
      const slot =
        document.createElement(
          "div"
        );


      slot.className =
        "result-position-slot";


      slot.dataset.position =
        String(position);


      slot.tabIndex =
        0;


      slot.innerHTML = `
        <header>

          <strong>
            P${position}
          </strong>

          <span>
            ${
              points.get(
                position
              ) ||
              0
            } PKT
          </span>

        </header>

        <div
          data-position-card
        ></div>
      `;


      tower.append(
        slot
      );
    }


    /*
     * ===================================================
     * POSITION
     * ===================================================
     */

    function positionOf(
      driverId
    ) {
      const driver =
        driverData.find(
          (driver) =>
            driver.id ===
            String(driverId)
        );


      return Number(
        inputFor(
          driver,
          raceType,
          "position"
        )?.value ||
        0
      );
    }


    /*
     * ===================================================
     * BONUS VERGEBEN?
     * ===================================================
     */

    function bonusIsAssigned(
      kind
    ) {
      return driverData.some(
        (driver) =>
          Boolean(
            inputFor(
              driver,
              raceType,
              kind
            )?.checked
          )
      );
    }


    /*
     * ===================================================
     * BUTTON-ZUSTAND
     * ===================================================
     */

    function updateBonusButtons() {
      section
        .querySelectorAll(
          "[data-bonus]"
        )
        .forEach(
          (badge) => {
            const assigned =
              bonusIsAssigned(
                badge.dataset.bonus
              );


            badge.hidden =
              false;


            badge.classList.toggle(
              "is-assigned",
              assigned
            );


            badge.setAttribute(
              "aria-pressed",
              assigned
                ? "true"
                : "false"
            );


            badge.title =
              assigned
                ? "Bereits vergeben · erneut auswählen möglich"
                : "Auf einen Fahrer ziehen oder anklicken";
          }
        );
    }


    /*
     * ===================================================
     * BONUS SETZEN
     * ===================================================
     */

    function setExclusive(
      kind,
      driverId
    ) {
      let found =
        false;


      driverData.forEach(
        (driver) => {
          const input =
            inputFor(
              driver,
              raceType,
              kind
            );


          if (!input) {
            return;
          }


          const selected =
            driver.id ===
            String(driverId);


          input.checked =
            selected;


          if (selected) {
            found =
              true;
          }
        }
      );


      /*
       * Falls gar kein Feld vorhanden wäre:
       * deutliche Ausgabe in Console.
       */

      if (!found) {
        console.error(
          `Bonus "${kind}" konnte Fahrer ${driverId} nicht zugewiesen werden.`
        );
      }


      render();
    }


    /*
     * ===================================================
     * RENDER
     * ===================================================
     */

    function render() {
      tower
        .querySelectorAll(
          "[data-position-card]"
        )
        .forEach(
          (container) => {
            container.innerHTML =
              "";
          }
        );


      pool.innerHTML =
        "";


      const query =
        normalizeSearch(
          searchInput?.value
        );


      let freeCount =
        0;


      let visibleCount =
        0;


      driverData.forEach(
        (driver) => {
          const card =
            buildDriverCard(
              driver,
              raceType,
              setExclusive
            );


          const position =
            positionOf(
              driver.id
            );


          if (position) {
            const target =
              tower.querySelector(
                `[data-position="${position}"] [data-position-card]`
              );


            (
              target ||
              pool
            ).append(
              card
            );


            return;
          }


          freeCount +=
            1;


          if (
            !matchesSearch(
              driver,
              query
            )
          ) {
            return;
          }


          visibleCount +=
            1;


          pool.append(
            card
          );
        }
      );


      if (searchCount) {
        searchCount.textContent =
          query
            ? `${visibleCount} / ${freeCount}`
            : `${freeCount} Fahrer`;
      }


      if (searchClear) {
        searchClear.hidden =
          !query;
      }


      if (searchEmpty) {
        searchEmpty.hidden =
          !(
            query &&
            visibleCount ===
              0
          );
      }


      updateSummary();

      updateBonusButtons();
    }


    /*
     * ===================================================
     * POSITION ZUWEISEN
     * ===================================================
     */

    function assign(
      driverId,
      targetPosition
    ) {
      const driver =
        driverData.find(
          (item) =>
            item.id ===
            String(driverId)
        );


      if (!driver) {
        return;
      }


      const input =
        inputFor(
          driver,
          raceType,
          "position"
        );


      if (!input) {
        return;
      }


      const oldPosition =
        Number(
          input.value ||
          0
        );


      const occupant =
        driverData.find(
          (item) =>
            positionOf(
              item.id
            ) ===
              Number(
                targetPosition
              ) &&
            item.id !==
              driver.id
        );


      if (occupant) {
        const occupantInput =
          inputFor(
            occupant,
            raceType,
            "position"
          );


        if (occupantInput) {
          occupantInput.value =
            oldPosition ||
            "";
        }
      }


      input.value =
        String(
          targetPosition
        );


      activeDriver =
        null;


      render();
    }


    /*
     * ===================================================
     * POSITION ENTFERNEN
     * ===================================================
     */

    function unassign(
      driverId
    ) {
      const driver =
        driverData.find(
          (item) =>
            item.id ===
            String(driverId)
        );


      if (driver) {
        const input =
          inputFor(
            driver,
            raceType,
            "position"
          );


        if (input) {
          input.value =
            "";
        }
      }


      activeDriver =
        null;


      render();
    }


    /*
     * ===================================================
     * PUNKTE
     * ===================================================
     */

    function updateSummary() {
      const theoretical =
        Array.from(
          {
            length:
              driverData.length,
          },

          (_, index) =>
            points.get(
              index + 1
            ) ||
            0
        ).reduce(
          (sum, value) =>
            sum +
            value,

          0
        );


      let actual =
        0;


      let bonuses =
        0;


      let deductions =
        0;


      driverData.forEach(
        (driver) => {
          const position =
            positionOf(
              driver.id
            );


          if (!position) {
            return;
          }


          const base =
            points.get(
              position
            ) ||
            0;


          const fastest =
            Boolean(
              inputFor(
                driver,
                raceType,
                "fastest"
              )?.checked &&
              config.fastestLapEnabled
            );


          const pole =
            Boolean(
              inputFor(
                driver,
                raceType,
                "pole"
              )?.checked &&
              config.polePositionEnabled
            );


          const bonus =
            (
              fastest
                ? Number(
                    config.fastestLapPoints ||
                    0
                  )
                : 0
            ) +
            (
              pole
                ? Number(
                    config.polePositionPoints ||
                    0
                  )
                : 0
            );


          bonuses +=
            bonus;


          if (
            driver.status?.value ===
            "DSQ"
          ) {
            deductions +=
              base +
              bonus;
          } else {
            actual +=
              base +
              bonus;
          }
        }
      );


      const expected =
        theoretical +
        bonuses -
        deductions;


      const matches =
        actual ===
        expected;


      section.querySelector(
        "[data-result-summary]"
      ).innerHTML = `
        <span>
          SCHEMA-BASIS
          <strong>
            ${theoretical}
          </strong>
        </span>

        <span>
          BONI
          <strong>
            +${bonuses}
          </strong>
        </span>

        <span>
          STATUS-ABZÜGE
          <strong>
            -${deductions}
          </strong>
        </span>

        <span>
          ERWARTET
          <strong>
            ${expected}
          </strong>
        </span>

        <span
          class="${
            matches
              ? "is-valid"
              : "is-open"
          }"
        >
          AKTUELL
          <strong>
            ${actual}
            ${
              matches
                ? "✓"
                : ""
            }
          </strong>
        </span>
      `;
    }


    /*
     * ===================================================
     * SUCHE
     * ===================================================
     */

    searchInput?.addEventListener(
      "input",
      render
    );


    searchClear?.addEventListener(
      "click",
      () => {
        searchInput.value =
          "";

        render();

        searchInput.focus();
      }
    );


    searchInput?.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key !==
          "Escape"
        ) {
          return;
        }


        searchInput.value =
          "";

        render();

        searchInput.focus();
      }
    );


    /*
     * ===================================================
     * POSITIONS-SLOTS
     * ===================================================
     */

    tower
      .querySelectorAll(
        "[data-position]"
      )
      .forEach(
        (slot) => {
          slot.addEventListener(
            "dragover",
            (event) => {
              /*
               * Bonus darf auf der Fahrerkarte
               * innerhalb des Slots landen.
               */

              event.preventDefault();


              slot.classList.add(
                "is-drop-target"
              );
            }
          );


          slot.addEventListener(
            "dragleave",
            () => {
              slot.classList.remove(
                "is-drop-target"
              );
            }
          );


          slot.addEventListener(
            "drop",
            (event) => {
              const bonus =
                event.dataTransfer
                  ?.getData(
                    "application/x-result-bonus"
                  );


              /*
               * Bonus wird von der Fahrerkarte behandelt.
               */

              if (bonus) {
                return;
              }


              event.preventDefault();


              slot.classList.remove(
                "is-drop-target"
              );


              assign(
                event.dataTransfer.getData(
                  "text/plain"
                ),

                slot.dataset.position
              );
            }
          );


          slot.addEventListener(
            "click",
            () => {
              if (activeDriver) {
                assign(
                  activeDriver,
                  slot.dataset.position
                );
              }
            }
          );
        }
      );


    /*
     * ===================================================
     * FAHRERPOOL
     * ===================================================
     */

    const driverPool =
      section.querySelector(
        "[data-driver-pool]"
      );


    driverPool.addEventListener(
      "dragover",
      (event) => {
        event.preventDefault();
      }
    );


    driverPool.addEventListener(
      "drop",
      (event) => {
        const bonus =
          event.dataTransfer
            ?.getData(
              "application/x-result-bonus"
            );


        if (bonus) {
          return;
        }


        event.preventDefault();


        unassign(
          event.dataTransfer.getData(
            "text/plain"
          )
        );
      }
    );


    /*
     * ===================================================
     * BONUS BUTTONS
     * ===================================================
     */

    section
      .querySelectorAll(
        "[data-bonus]"
      )
      .forEach(
        (badge) => {
          const kind =
            badge.dataset.bonus;


          /*
           * ALLE bleiben sichtbar.
           */

          badge.hidden =
            false;


          /*
           * Drag starten.
           */

          badge.addEventListener(
            "dragstart",
            (event) => {
              event.dataTransfer.clearData();


              event.dataTransfer.setData(
                "application/x-result-bonus",
                kind
              );


              event.dataTransfer.effectAllowed =
                "copy";
            }
          );


          /*
           * Klicken:
           * danach Fahrer anklicken.
           */

          badge.addEventListener(
            "click",
            () => {
              section
                .querySelectorAll(
                  "[data-bonus]"
                )
                .forEach(
                  (otherBadge) => {
                    if (
                      otherBadge !==
                      badge
                    ) {
                      otherBadge.classList.remove(
                        "is-active"
                      );
                    }
                  }
                );


              badge.classList.toggle(
                "is-active"
              );


              section.dataset.activeBonus =
                badge.classList.contains(
                  "is-active"
                )
                  ? kind
                  : "";
            }
          );
        }
      );


    /*
     * ===================================================
     * BONUS PER KLICK AUF FAHRER
     * ===================================================
     */

    section.addEventListener(
      "click",
      (event) => {
        const kind =
          section.dataset.activeBonus;


        if (!kind) {
          return;
        }


        const card =
          event.target.closest(
            ".result-control-driver"
          );


        if (!card) {
          return;
        }


        /*
         * Verhindert gleichzeitig normale
         * Fahrer-Auswahl.
         */

        event.preventDefault();

        event.stopPropagation();


        setExclusive(
          kind,
          card.dataset.driverId
        );


        section.dataset.activeBonus =
          "";


        section
          .querySelectorAll(
            "[data-bonus]"
          )
          .forEach(
            (badge) => {
              badge.classList.remove(
                "is-active"
              );
            }
          );
      },

      true
    );


    /*
     * ===================================================
     * STATUS
     * ===================================================
     */

    driverData.forEach(
      (driver) => {
        driver.status
          ?.addEventListener(
            "change",
            render
          );
      }
    );


    /*
     * INITIAL
     */

    render();


    return section;
  }


  /*
   * =====================================================
   * TABS
   * =====================================================
   */

  const tabs =
    document.createElement(
      "div"
    );


  tabs.className =
    "result-control-tabs";


  const mainBoard =
    createRaceBoard(
      "main"
    );


  mount.append(
    tabs,
    mainBoard
  );


  const boards = [
    mainBoard,
  ];


  if (config.hasSprint) {
    const sprintBoard =
      createRaceBoard(
        "sprint"
      );


    sprintBoard.hidden =
      true;


    mount.append(
      sprintBoard
    );


    boards.push(
      sprintBoard
    );
  }


  boards.forEach(
    (
      board,
      index
    ) => {
      const button =
        document.createElement(
          "button"
        );


      button.type =
        "button";


      button.textContent =
        index
          ? "SPRINT"
          : "HAUPTRENNEN";


      button.className =
        index
          ? ""
          : "is-active";


      button.addEventListener(
        "click",
        () => {
          boards.forEach(
            (
              item,
              itemIndex
            ) => {
              item.hidden =
                itemIndex !==
                index;
            }
          );


          [
            ...tabs.children,
          ].forEach(
            (
              item,
              itemIndex
            ) => {
              item.classList.toggle(
                "is-active",
                itemIndex ===
                  index
              );
            }
          );
        }
      );


      tabs.append(
        button
      );
    }
  );


  /*
   * =====================================================
   * SPEICHERN
   * =====================================================
   */

  form.addEventListener(
    "submit",
    (event) => {
      const missing =
        driverData.filter(
          (driver) => {
            const missingMain =
              !inputFor(
                driver,
                "main",
                "position"
              )?.value;


            const missingSprint =
              config.hasSprint &&
              !inputFor(
                driver,
                "sprint",
                "position"
              )?.value;


            return (
              missingMain ||
              missingSprint
            );
          }
        );


      if (!missing.length) {
        return;
      }


      event.preventDefault();


      mount.classList.add(
        "has-error"
      );


      mount.scrollIntoView({
        behavior:
          "smooth",

        block:
          "start",
      });


      const message =
        mount.querySelector(
          ".result-control-error"
        ) ||
        document.createElement(
          "div"
        );


      message.className =
        "result-control-error";


      message.textContent =
        `${missing.length} Fahrer besitzen noch keine vollständige Platzierung.`;


      mount.prepend(
        message
      );
    }
  );
});