const { Op } = require("sequelize");

const {
  sequelize,
  League,
  Season,
  Driver,
  PenaltyEntry,
  RaceEvent,
  F1PenaltySetting,
  F1Calendar,
  F1CalendarRound,
} = require("../models");

const {
  loadSeasonStructure,
} = require("../services/f1Season");

const {
  regularRoleField,
  reserveRoleField,
} = require("../services/raceLineup");


/*
 * =====================================================
 * HILFSFUNKTIONEN
 * =====================================================
 */

function wantsJson(req) {
  return (
    req.xhr ||
    String(
      req.get("accept") || "",
    ).includes(
      "application/json",
    )
  );
}


/*
 * Für globale Tabellen:
 *
 * Globale Tabellen aggregieren alle Ligen auf derselben
 * zentralen Rundennummer. Freitag R4 und Sonntag R4 landen
 * deshalb bewusst in derselben Zelle.
 */
function globalCellKey(roundNumber) {
  return String(Number(roundNumber));
}


/*
 * =====================================================
 * ZELLENWERT
 * =====================================================
 *
 * ""  = leer
 * "1" = 1 SP
 * "2" = 2 SP
 * ...
 * "S" = Rennsperre
 */

function parseCellValue(rawValue) {
  const value =
    String(
      rawValue ?? "",
    )
      .trim()
      .toUpperCase();


  if (!value) {
    return {
      value: "",
      points: 0,
      isRaceBan: false,
      isEmpty: true,
    };
  }


  if (value === "S") {
    return {
      value: "S",
      points: 0,
      isRaceBan: true,
      isEmpty: false,
    };
  }


  if (!/^\d+$/.test(value)) {
    throw new Error(
      'Erlaubt sind nur Strafpunkte als ganze Zahl oder "S" für Rennsperre.',
    );
  }


  const points =
    Number(value);


  if (
    !Number.isSafeInteger(points) ||
    points < 1
  ) {
    throw new Error(
      "Bitte mindestens 1 Strafpunkt eintragen. Zum Leeren den Wert entfernen.",
    );
  }


  return {
    value:
      String(points),

    points,

    isRaceBan:
      false,

    isEmpty:
      false,
  };
}


/*
 * =====================================================
 * ZELLENFARBE
 * =====================================================
 */

function parseCellColor(rawColor) {
  const color =
    String(
      rawColor ?? "",
    )
      .trim()
      .toUpperCase();


  if (!color) {
    return null;
  }


  if (
    !/^#[0-9A-F]{6}$/.test(
      color,
    )
  ) {
    throw new Error(
      "Die ausgewählte Zellfarbe ist ungültig.",
    );
  }


  return color;
}


/*
 * =====================================================
 * RUNDEN EINER LIGA
 * =====================================================
 *
 * Strafpunkte bleiben an:
 *
 * LeagueId
 * SeasonId
 * DriverId
 * roundNumber
 *
 * Flagge / Strecke kommen live aus RaceEvent.
 */

async function loadRounds(
  league,
  activeSeason,
) {
  if (!activeSeason) {
    return [];
  }


  const events =
    await RaceEvent.findAll({
      where: {
        LeagueId:
          league.id,

        SeasonId:
          activeSeason.id,

        isTestDay:
          false,
      },

      include: [
        {
          association:
            "track",

          required:
            false,

          include: [
            {
              association:
                "countryRecord",

              required:
                false,
            },
          ],
        },
      ],

      order: [
        [
          "sortOrder",
          "ASC",
        ],

        [
          "startsAt",
          "ASC",
        ],

        [
          "id",
          "ASC",
        ],
      ],
    });


  const byRound =
    new Map();


  for (
    const event of
    events
  ) {
    const roundNumber =
      Number(
        event.sortOrder ||
        0,
      );


    if (
      !Number.isInteger(
        roundNumber,
      ) ||
      roundNumber < 1
    ) {
      continue;
    }


    /*
     * Pro Rundennummer nur eine Spalte.
     */
    if (
      byRound.has(
        roundNumber,
      )
    ) {
      continue;
    }


    byRound.set(
      roundNumber,
      {
        roundNumber,

        eventId:
          event.id,

        title:
          event.title,

        circuit:
          event.track?.name ||
          event.circuit ||
          null,

        startsAt:
          event.startsAt,

        flagPath:
          event.track
            ?.countryRecord
            ?.flagPath ||
          null,

        country:
          event.track
            ?.countryRecord
            ?.name ||
          event.track
            ?.country ||
          null,
      },
    );
  }


  return [
    ...byRound.values(),
  ].sort(
    (
      left,
      right,
    ) =>
      left.roundNumber -
      right.roundNumber,
  );
}


/*
 * =====================================================
 * NORMALE ZELLEN EINER LIGA AUFBAUEN
 * =====================================================
 */

function buildLeagueCells(
  entries,
) {
  const cells = {};

  let points = 0;
  let hasBan = false;


  for (
    const entry of
    entries || []
  ) {
    const roundNumber =
      Number(
        entry.roundNumber ||
        0,
      );


    if (
      !Number.isInteger(
        roundNumber,
      ) ||
      roundNumber < 1
    ) {
      continue;
    }


    if (
      !cells[
        roundNumber
      ]
    ) {
      cells[
        roundNumber
      ] = {
        points: 0,

        isRaceBan:
          false,

        entries: [],

        value: "",

        cellColor:
          null,
      };
    }


    const cell =
      cells[
        roundNumber
      ];


    cell.entries.push(
      entry,
    );


    cell.points +=
      Number(
        entry.points ||
        0,
      );


    /*
     * Bei Alt-Duplikaten erste Farbe übernehmen.
     */
    if (
      !cell.cellColor &&
      entry.cellColor
    ) {
      cell.cellColor =
        String(
          entry.cellColor,
        );
    }


    if (
      entry.isRaceBan
    ) {
      cell.isRaceBan =
        true;

      hasBan =
        true;
    }


    points +=
      Number(
        entry.points ||
        0,
      );
  }


  for (
    const cell of
    Object.values(cells)
  ) {
    if (
      cell.isRaceBan
    ) {
      cell.value = "S";
    } else if (
      cell.points > 0
    ) {
      cell.value =
        String(
          cell.points,
        );
    } else {
      /*
       * Nur farbige Zelle = leerer Wert.
       */
      cell.value = "";
    }
  }


  return {
    cells,
    points,
    hasBan,
  };
}


/*
 * =====================================================
 * GLOBALE ZELLEN AUFBAUEN
 * =====================================================
 *
 * Die gemeinsame Ersatz-/Ehemaligen-Tabelle verwendet
 * roundNumber als einzigen Zellenschlüssel.
 */

function buildGlobalCells(
  entries,
) {
  const cells = {};

  let points = 0;
  let hasBan = false;


  for (
    const entry of
    entries || []
  ) {
    const roundNumber =
      Number(
        entry.roundNumber ||
        0,
      );


    if (
      !Number.isInteger(
        roundNumber,
      ) ||
      roundNumber < 1
    ) {
      continue;
    }


    const key =
      globalCellKey(roundNumber);


    if (!cells[key]) {
      cells[key] = {
        key,

        LeagueId:
          Number(entry.LeagueId),

        SeasonId:
          Number(
            entry.SeasonId,
          ),

        roundNumber,

        points: 0,

        isRaceBan:
          false,

        entries: [],

        value: "",

        cellColor:
          null,
      };
    }


    const cell =
      cells[key];


    cell.entries.push(
      entry,
    );


    cell.points +=
      Number(
        entry.points ||
        0,
      );


    if (
      !cell.cellColor &&
      entry.cellColor
    ) {
      cell.cellColor =
        String(
          entry.cellColor,
        );
    }


    if (
      entry.isRaceBan
    ) {
      cell.isRaceBan =
        true;

      hasBan =
        true;
    }


    points +=
      Number(
        entry.points ||
        0,
      );
  }


  for (
    const cell of
    Object.values(cells)
  ) {
    if (
      cell.isRaceBan
    ) {
      cell.value = "S";
    } else if (
      cell.points > 0
    ) {
      cell.value =
        String(
          cell.points,
        );
    } else {
      cell.value = "";
    }
  }


  return {
    cells,
    points,
    hasBan,
  };
}


/*
 * =====================================================
 * STRAFKARTEI EINER F1-LIGA
 * =====================================================
 *
 * WICHTIG:
 *
 * Hier werden nur noch die STAMMFAHRER dieser Liga
 * als Liga-Tabelle aufgebaut.
 *
 * Ersatzfahrer und ehemalige Fahrer kommen später
 * in die beiden globalen Tabellen.
 */

async function buildLeagueLedger(
  league,
) {
  const activeSeason =
    await Season.findOne({
      where: {
        leagueType:
          "f1",

        scopeSlug:
          league.slug,

        status:
          "active",

        isPublished:
          true,
      },
    });


  const [
    setting,
    structure,
    rounds,
    penalties,
  ] =
    await Promise.all([
      F1PenaltySetting.findOne({
        where: {
          LeagueId:
            league.id,
        },
      }),

      activeSeason
        ? loadSeasonStructure(
            activeSeason.id,
          )
        : Promise.resolve({
            teams: [],
          }),

      loadRounds(
        league,
        activeSeason,
      ),

      activeSeason
        ? PenaltyEntry.findAll({
            where: {
              LeagueId:
                league.id,

              SeasonId:
                activeSeason.id,
            },

            order: [
              [
                "roundNumber",
                "ASC",
              ],

              [
                "id",
                "ASC",
              ],
            ],
          })
        : Promise.resolve([]),
    ]);


  const regularField =
    regularRoleField(
      league.slug,
    );


  /*
   * =====================================================
   * STAMMFAHRER LADEN
   * =====================================================
   */

  const drivers =
    await Driver.findAll({
      where: {
        [regularField]:
          true,
      },

      order: [
        [
          "name",
          "ASC",
        ],

        [
          "id",
          "ASC",
        ],
      ],
    });


  /*
   * =====================================================
   * FAHRER -> TEAM
   * =====================================================
   */

  const teamByDriver =
    new Map();


  for (
    const team of
    structure.teams || []
  ) {
    for (
      const driver of
      team.drivers || []
    ) {
      teamByDriver.set(
        Number(
          driver.id,
        ),
        team,
      );
    }
  }


  /*
   * =====================================================
   * STRAFEN -> FAHRER
   * =====================================================
   */

  const penaltiesByDriver =
    new Map();


  for (
    const entry of
    penalties
  ) {
    const driverId =
      Number(
        entry.DriverId,
      );


    if (
      !penaltiesByDriver.has(
        driverId,
      )
    ) {
      penaltiesByDriver.set(
        driverId,
        [],
      );
    }


    penaltiesByDriver
      .get(driverId)
      .push(entry);
  }


  const threshold =
    Number(
      setting?.pointsLimit ||
      12,
    );


  const regularRows = [];


  /*
   * =====================================================
   * STAMMFAHRER-MATRIX
   * =====================================================
   */

  for (
    const driver of
    drivers
  ) {
    const driverPenalties =
      penaltiesByDriver.get(
        Number(
          driver.id,
        ),
      ) || [];


    const matrix =
      buildLeagueCells(
        driverPenalties,
      );


    regularRows.push({
      ...driver.toJSON(),

      team:
        teamByDriver.get(
          Number(
            driver.id,
          ),
        ) ||
        null,

      cells:
        matrix.cells,

      penalties:
        driverPenalties,

      points:
        matrix.points,

      remaining:
        Math.max(
          threshold -
          matrix.points,
          0,
        ),

      suspended:
        matrix.hasBan ||
        matrix.points >=
          threshold,

      hasBan:
        matrix.hasBan,
    });
  }


  return {
    league,

    activeSeason,

    rounds,

    threshold,

    setting,

    /*
     * Nur noch Stammfahrer pro Liga.
     *
     * reserve / former bleiben absichtlich leer,
     * damit alte EJS-Versionen nichts doppelt anzeigen.
     */
    groups: {
      regular:
        regularRows,

      reserve: [],

      former: [],
    },

    /*
     * Für globale Tabellen intern benötigt.
     */
    penalties,
  };
}


/*
 * =====================================================
 * GLOBALE ERSATZFAHRER + EHEMALIGE
 * =====================================================
 */

async function buildGlobalLedgers(
  ledgers,
  requestedCalendarId = null,
) {
  /*
   * Nur Ligen mit aktiver Saison können
   * Strafpunkte der aktuellen Saison enthalten.
   */
  const activeLedgers =
    ledgers.filter(
      (ledger) =>
        ledger.activeSeason,
    );


  /*
   * =====================================================
   * SPALTEN
   * =====================================================
   *
   * Eine gemeinsame Rundenachse aus dem zentralen F1-Kalender.
   */

  const masterLedger = activeLedgers[0] || null;
  const seasonCalendarIds = [...new Set(activeLedgers
    .map((ledger) => Number(ledger.activeSeason?.F1CalendarId || 0))
    .filter(Boolean))];
  const calendars = await F1Calendar.findAll({
    include: [{
      association: "rounds",
      required: false,
      include: [{ association: "track", include: [{ association: "countryRecord" }] }],
    }],
    order: [
      ["isActive", "DESC"],
      ["sortOrder", "ASC"],
      ["id", "DESC"],
      [{ model: F1CalendarRound, as: "rounds" }, "sortOrder", "ASC"],
    ],
  });
  const requestedId = Number(requestedCalendarId || 0);
  const selectedCalendar =
    calendars.find((calendar) => Number(calendar.id) === requestedId) ||
    calendars.find((calendar) => seasonCalendarIds.includes(Number(calendar.id))) ||
    calendars[0] ||
    null;
  let calendarWarning = null;

  if (requestedId && !calendars.some((calendar) => Number(calendar.id) === requestedId)) {
    calendarWarning = "Der angeforderte Rennkalender wurde nicht gefunden. Es wird die Standardauswahl angezeigt.";
  } else if (!requestedId && seasonCalendarIds.length > 1) {
    calendarWarning = "Die aktiven F1-Saisons verwenden unterschiedliche Kalender. Bitte den gewünschten Rennkalender auswählen.";
  }

  const sourceRounds = selectedCalendar
    ? selectedCalendar.rounds.filter((round) => !round.isTestDay).map((round) => ({
        roundNumber: Number(round.roundNumber || round.sortOrder),
        title: round.track?.countryRecord?.name || round.track?.country || round.track?.name,
        circuit: round.track?.name || round.circuit,
        flagPath: round.track?.countryRecord?.flagPath || null,
        country: round.track?.countryRecord?.name || round.track?.country || null,
      }))
    : (masterLedger?.rounds || []);
  if (!selectedCalendar && activeLedgers.length) {
    calendarWarning = "Es wurde noch kein zentraler F1-Rennkalender angelegt; als Übergang wird die erste aktive Liga verwendet.";
  }

  const columns = sourceRounds.map((round) => ({
    ...round,
    key: globalCellKey(round.roundNumber),
    LeagueId: Number(masterLedger?.league?.id || 0),
    SeasonId: Number(masterLedger?.activeSeason?.id || 0),
    leagueSlug: null,
    leagueName: selectedCalendar?.name || "Gemeinsamer F1-Kalender",
    leagueColor: "#6ef2f2",
  }));
  const columnGroups = columns.length ? [{
    league: { name: selectedCalendar?.name || "Gemeinsamer F1-Kalender", accentColor: "#6ef2f2" },
    activeSeason: masterLedger?.activeSeason || null,
    threshold: masterLedger?.threshold || 12,
    columns,
  }] : [];


  /*
   * =====================================================
   * ALLE STRAFEINTRÄGE AKTIVER F1-SAISONEN
   * =====================================================
   */

  const allPenalties =
    activeLedgers.flatMap(
      (ledger) =>
        ledger.penalties ||
        [],
    );


  const penaltiesByDriver =
    new Map();


  for (
    const entry of
    allPenalties
  ) {
    const driverId =
      Number(
        entry.DriverId,
      );


    if (
      !Number.isInteger(
        driverId,
      ) ||
      driverId < 1
    ) {
      continue;
    }


    if (
      !penaltiesByDriver.has(
        driverId,
      )
    ) {
      penaltiesByDriver.set(
        driverId,
        [],
      );
    }


    penaltiesByDriver
      .get(driverId)
      .push(entry);
  }


  /*
   * =====================================================
   * ROLLENFELDER ALLER F1-LIGEN
   * =====================================================
   */

  const regularFields =
    activeLedgers.map(
      (ledger) =>
        regularRoleField(
          ledger.league.slug,
        ),
    );


  const reserveFields =
    activeLedgers.map(
      (ledger) =>
        reserveRoleField(
          ledger.league.slug,
        ),
    );


  /*
   * Alle aktuellen Ersatzfahrer laden.
   */
  const reserveConditions =
    reserveFields.map(
      (field) => ({
        [field]:
          true,
      }),
    );


  /*
   * Dazu alle Fahrer mit bestehenden SP laden.
   *
   * Nur so können ehemalige Fahrer gefunden werden,
   * nachdem ihre Stamm-/Ersatzrolle entfernt wurde.
   */
  const penaltyDriverIds = [
    ...penaltiesByDriver.keys(),
  ];


  const driverConditions = [
    ...reserveConditions,
  ];


  if (
    penaltyDriverIds.length
  ) {
    driverConditions.push({
      id: {
        [Op.in]:
          penaltyDriverIds,
      },
    });
  }


  if (
    !driverConditions.length
  ) {
    return {
      calendars: calendars.map((calendar) => ({
        id: calendar.id,
        name: calendar.name,
        isActive: calendar.isActive,
        roundCount: (calendar.rounds || []).filter((round) => !round.isTestDay).length,
      })),
      selectedCalendar: selectedCalendar
        ? { id: selectedCalendar.id, name: selectedCalendar.name }
        : null,
      reserve: {
        columnGroups,
        columns,
        rows: [],
        calendarWarning,
      },

      former: {
        columnGroups,
        columns,
        rows: [],
        calendarWarning,
      },
    };
  }


  const drivers =
    await Driver.findAll({
      where: {
        [Op.or]:
          driverConditions,
      },

      order: [
        [
          "name",
          "ASC",
        ],

        [
          "id",
          "ASC",
        ],
      ],
    });


  /*
   * =====================================================
   * GLOBALE TABELLEN
   * =====================================================
   */

  const reserveRows = [];

  const formerRows = [];


  for (
    const driver of
    drivers
  ) {
    const driverId =
      Number(
        driver.id,
      );


    const driverPenalties =
      penaltiesByDriver.get(
        driverId,
      ) ||
      [];


    const matrix =
      buildGlobalCells(
        driverPenalties,
      );


    /*
     * Fahrer kann theoretisch z. B.
     *
     * Freitag Stammfahrer
     * Samstag Ersatzfahrer
     *
     * sein.
     *
     * Dann erscheint er:
     *
     * - in Freitag bei Stammfahrer
     * - zusätzlich in der globalen Ersatzfahrertabelle
     */
    const isRegularSomewhere =
      regularFields.some(
        (field) =>
          Boolean(
            driver[field],
          ),
      );


    const isReserveSomewhere =
      reserveFields.some(
        (field) =>
          Boolean(
            driver[field],
          ),
      );


    const commonRow = {
      ...driver.toJSON(),

      cells:
        matrix.cells,

      penalties:
        driverPenalties,

      points:
        matrix.points,

      hasBan:
        matrix.hasBan,

      /*
       * Bei globalen Tabellen gibt es kein einziges
       * ligaweites Limit.
       *
       * Der Status kann bei Bedarf später
       * ligaweise berechnet werden.
       */
      suspended:
        matrix.hasBan || matrix.points >= Number(masterLedger?.threshold || 12),

      isRegularSomewhere,

      isReserveSomewhere,
    };


    /*
     * =================================================
     * ERSATZFAHRER
     * =================================================
     *
     * Alle aktuellen F1-Ersatzfahrer,
     * auch mit 0 SP.
     */
    if (
      isReserveSomewhere
    ) {
      reserveRows.push(
        commonRow,
      );
    }


    /*
     * =================================================
     * EHEMALIGE FAHRER
     * =================================================
     *
     * Ehemalig bedeutet hier:
     *
     * - aktuell nirgendwo Stammfahrer
     * - aktuell nirgendwo Ersatzfahrer
     * - aber noch SP oder S vorhanden
     *
     * Die Tabelle bleibt editierbar.
     *
     * Sobald Punkte = 0 UND kein S mehr existiert,
     * erfüllt der Fahrer diese Bedingung nicht mehr
     * und verschwindet nach Neuladen automatisch.
     *
     * Reine Zellfarbe ohne SP hält einen ehemaligen
     * Fahrer NICHT in der Tabelle.
     */
    if (
      !isRegularSomewhere &&
      !isReserveSomewhere &&
      (
        matrix.points > 0 ||
        matrix.hasBan
      )
    ) {
      formerRows.push(
        commonRow,
      );
    }
  }


  return {
    calendars: calendars.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      isActive: calendar.isActive,
      roundCount: (calendar.rounds || []).filter((round) => !round.isTestDay).length,
    })),
    selectedCalendar: selectedCalendar
      ? { id: selectedCalendar.id, name: selectedCalendar.name }
      : null,
    reserve: {
      columnGroups,
      columns,
      rows:
        reserveRows,
      calendarWarning,
    },

    former: {
      columnGroups,
      columns,
      rows:
        formerRows,
      calendarWarning,
    },
  };
}


/*
 * =====================================================
 * STRAFKARTEI ANZEIGEN
 * =====================================================
 */

exports.show = async (
  req,
  res,
) => {
  const leagues =
    await League.findAll({
      where: {
        type:
          "f1",

        slug: {
          [Op.in]: [
            "freitag",
            "samstag",
            "sonntag",
          ],
        },
      },

      order: [
        [
          "sortOrder",
          "ASC",
        ],

        [
          "id",
          "ASC",
        ],
      ],
    });


  /*
   * Pro Liga nur Stammfahrer.
   */
  const ledgers =
    await Promise.all(
      leagues.map(
        buildLeagueLedger,
      ),
    );


  /*
   * Einmal global:
   *
   * - Ersatzfahrer
   * - ehemalige Fahrer
   */
  const globalLedgers =
    await buildGlobalLedgers(
      ledgers,
      req.query.calendar,
    );


  res.render(
    "admin/penalty-ledger",
    {
      title:
        "Formel 1 Strafkartei",

      ledgers,

      reserveLedger:
        globalLedgers.reserve,

      formerLedger:
        globalLedgers.former,

      globalCalendars:
        globalLedgers.calendars,

      selectedGlobalCalendar:
        globalLedgers.selectedCalendar,
    },
  );
};


/*
 * =====================================================
 * ZELLE SPEICHERN
 * =====================================================
 *
 * Funktioniert für:
 *
 * - Stammfahrer
 * - Ersatzfahrer
 * - ehemalige Fahrer
 *
 * Auch die ehemaligen Fahrer bleiben also
 * vollständig editierbar.
 *
 * cellValue:
 *
 * "" = leer
 * 1  = 1 SP
 * 2  = 2 SP
 * S  = Rennsperre
 *
 * cellColor:
 *
 * ""      = keine Farbe
 * #8FD3FF = frei gewählte Farbe
 */

/*
 * =====================================================
 * ÖFFENTLICHE SICHTBARKEIT EINER F1-STRAFKARTEI
 * =====================================================
 *
 * Die Einstellung beeinflusst ausschließlich
 * die öffentliche Website.
 *
 * Im Admin bleibt die Liga immer vorhanden.
 */

exports.updateSettings = async (
  req,
  res,
) => {
  try {
    const leagueId =
      Number(
        req.body.LeagueId,
      );


    if (
      !Number.isInteger(
        leagueId,
      ) ||
      leagueId < 1
    ) {
      throw new Error(
        "Ungültige Liga.",
      );
    }


    const league =
      await League.findOne({
        where: {
          id:
            leagueId,

          type:
            "f1",

          slug: {
            [Op.in]: [
              "freitag",
              "samstag",
              "sonntag",
            ],
          },
        },
      });


    if (!league) {
      throw new Error(
        "Die F1-Liga wurde nicht gefunden.",
      );
    }


    /*
     * Checkbox:
     *
     * angehakt   -> "1"
     * nicht an   -> Feld fehlt
     */
    const publicVisible =
      [
        "1",
        "true",
        "on",
        "yes",
      ].includes(
        String(
          req.body.publicVisible ||
          "",
        ).toLowerCase(),
      );


    const [
      setting,
    ] =
      await F1PenaltySetting.findOrCreate({
        where: {
          LeagueId:
            league.id,
        },

        defaults: {
          LeagueId:
            league.id,

          pointsLimit:
            12,

          publicVisible,
        },
      });


    await setting.update({
      publicVisible,
    });


    if (
      wantsJson(req)
    ) {
      return res.json({
        ok:
          true,

        LeagueId:
          league.id,

        publicVisible:
          Boolean(
            setting.publicVisible,
          ),
      });
    }


    req.session.flash = {
      type:
        "success",

      message:
        publicVisible
          ? `${league.name}: Strafkartei wird öffentlich angezeigt.`
          : `${league.name}: Strafkartei wurde im Frontend ausgeblendet.`,
    };


    return res.redirect(
      `/admin/penalty-ledger#liga-${league.id}`,
    );
  } catch (error) {
    if (
      wantsJson(req)
    ) {
      return res
        .status(400)
        .json({
          ok:
            false,

          message:
            error.message ||
            "Die Einstellung konnte nicht gespeichert werden.",
        });
    }


    throw error;
  }
};

exports.create = async (
  req,
  res,
) => {
  try {
    const leagueId =
      Number(
        req.body.LeagueId,
      );

    const seasonId =
      Number(
        req.body.SeasonId,
      );

    const driverId =
      Number(
        req.body.DriverId,
      );

    const roundNumber =
      Number(
        req.body.roundNumber,
      );


    const parsed =
      parseCellValue(
        req.body.cellValue,
      );


    /*
     * Alte EJS-Versionen senden eventuell
     * noch kein cellColor.
     */
    const hasColorField =
      Object.prototype
        .hasOwnProperty
        .call(
          req.body,
          "cellColor",
        );


    const requestedColor =
      hasColorField
        ? parseCellColor(
            req.body.cellColor,
          )
        : undefined;


    if (
      !Number.isInteger(
        roundNumber,
      ) ||
      roundNumber < 1
    ) {
      throw new Error(
        "Ungültige Rennrunde.",
      );
    }


    const [
      league,
      season,
      driver,
      raceEvent,
      setting,
    ] =
      await Promise.all([
        League.findOne({
          where: {
            id:
              leagueId,

            type:
              "f1",
          },
        }),

        Season.findOne({
          where: {
            id:
              seasonId,

            leagueType:
              "f1",

            status:
              "active",
          },
        }),

        Driver.findByPk(
          driverId,
        ),

        RaceEvent.findOne({
          where: {
            LeagueId:
              leagueId,

            SeasonId:
              seasonId,

            sortOrder:
              roundNumber,

            isTestDay:
              false,
          },
        }),

        F1PenaltySetting.findOne({
          where: {
            LeagueId:
              leagueId,
          },
        }),
      ]);


    if (
      !league ||
      !season ||
      !driver
    ) {
      throw new Error(
        "Liga, Saison oder Fahrer ist ungültig.",
      );
    }


    if (
      season.scopeSlug !==
      league.slug
    ) {
      throw new Error(
        "Die Saison gehört nicht zu dieser Liga.",
      );
    }


    if (!raceEvent) {
      throw new Error(
        "Diese Rennrunde existiert nicht im aktuellen Rennkalender.",
      );
    }


    const threshold =
      Number(
        setting?.pointsLimit ||
        12,
      );


    const result =
      await sequelize.transaction(
        async (
          transaction,
        ) => {
          const where = {
            LeagueId:
              league.id,

            SeasonId:
              season.id,

            DriverId:
              driver.id,

            roundNumber,
          };


          const existingEntries =
            await PenaltyEntry.findAll({
              where,

              order: [
                [
                  "id",
                  "ASC",
                ],
              ],

              transaction,
            });


          const primary =
            existingEntries[0] ||
            null;


          /*
           * Wenn keine Farbe mitgesendet wird:
           * bisherige Farbe erhalten.
           */
          const cellColor =
            hasColorField
              ? requestedColor
              : primary
                  ?.cellColor ||
                null;


          /*
           * =================================================
           * LEER + KEINE FARBE
           * =================================================
           */

          if (
            parsed.isEmpty &&
            !cellColor
          ) {
            if (
              existingEntries.length
            ) {
              await PenaltyEntry.destroy({
                where: {
                  id: {
                    [Op.in]:
                      existingEntries.map(
                        (entry) =>
                          entry.id,
                      ),
                  },
                },

                transaction,
              });
            }
          } else {
            /*
             * =================================================
             * ZAHL / S / NUR FARBE
             * =================================================
             */

            const values = {
              LeagueId:
                league.id,

              SeasonId:
                season.id,

              DriverId:
                driver.id,

              roundNumber,

              points:
                parsed.points,

              isRaceBan:
                parsed.isRaceBan,

              cellColor,

              reason:
                parsed.isRaceBan
                  ? "Rennsperre"
                  : null,

              comment:
                null,

              /*
               * Übergangsfeld im derzeitigen Model.
               */
              isAutomatic:
                false,
            };


            if (primary) {
              await primary.update(
                values,
                {
                  transaction,
                },
              );


              /*
               * Alte Doppelungen derselben Zelle entfernen.
               */
              if (
                existingEntries.length >
                1
              ) {
                await PenaltyEntry.destroy({
                  where: {
                    id: {
                      [Op.in]:
                        existingEntries
                          .slice(1)
                          .map(
                            (entry) =>
                              entry.id,
                          ),
                    },
                  },

                  transaction,
                });
              }
            } else {
              await PenaltyEntry.create(
                values,
                {
                  transaction,
                },
              );
            }
          }


          /*
           * =================================================
           * PUNKTE DIESES FAHRERS IN DIESER LIGA
           * =================================================
           */

          const driverEntries =
            await PenaltyEntry.findAll({
              where: {
                LeagueId:
                  league.id,

                SeasonId:
                  season.id,

                DriverId:
                  driver.id,
              },

              transaction,
            });


          const totalPoints =
            driverEntries.reduce(
              (
                sum,
                entry,
              ) =>
                sum +
                Number(
                  entry.points ||
                  0,
                ),
              0,
            );


          const hasBan =
            driverEntries.some(
              (entry) =>
                Boolean(
                  entry.isRaceBan,
                ),
            );


          /*
           * =================================================
           * GLOBALE RESTSTRAFE
           * =================================================
           *
           * Wichtig für ehemalige Fahrer.
           *
           * Nach einer Bearbeitung muss das Frontend wissen,
           * ob der Fahrer noch irgendwo SP oder S besitzt.
           */

          const activeF1Seasons =
            await Season.findAll({
              where: {
                leagueType:
                  "f1",

                status:
                  "active",

                isPublished:
                  true,
              },

              attributes: [
                "id",
              ],

              transaction,
            });


          const activeSeasonIds =
            activeF1Seasons.map(
              (item) =>
                Number(
                  item.id,
                ),
            );


          const globalDriverEntries =
            activeSeasonIds.length
              ? await PenaltyEntry.findAll({
                  where: {
                    DriverId:
                      driver.id,

                    SeasonId: {
                      [Op.in]:
                        activeSeasonIds,
                    },
                  },

                  transaction,
                })
              : [];


          const globalPoints =
            globalDriverEntries.reduce(
              (
                sum,
                entry,
              ) =>
                sum +
                Number(
                  entry.points ||
                  0,
                ),
              0,
            );


          const globalHasBan =
            globalDriverEntries.some(
              (entry) =>
                Boolean(
                  entry.isRaceBan,
                ),
            );


          return {
            value:
              parsed.value,

            points:
              parsed.points,

            isRaceBan:
              parsed.isRaceBan,

            cellColor:
              cellColor ||
              "",

            totalPoints,

            remaining:
              Math.max(
                threshold -
                totalPoints,
                0,
              ),

            suspended:
              hasBan ||
              totalPoints >=
                threshold,

            hasBan,

            /*
             * Für globale Ersatz-/Ehemaligen-Tabelle.
             */
            globalPoints,

            globalHasBan,

            hasGlobalPenalty:
              globalPoints > 0 ||
              globalHasBan,
          };
        },
      );


    /*
     * =====================================================
     * AJAX
     * =====================================================
     */

    if (
      wantsJson(req)
    ) {
      return res.json({
        ok: true,

        ...result,
      });
    }


    req.session.flash = {
      type:
        "success",

      message:
        parsed.isEmpty &&
        !result.cellColor
          ? `Runde ${roundNumber}: Eintrag entfernt.`
          : parsed.isRaceBan
            ? `Runde ${roundNumber}: Rennsperre gespeichert.`
            : parsed.points > 0
              ? `Runde ${roundNumber}: ${parsed.points} SP gespeichert.`
              : `Runde ${roundNumber}: Markierung gespeichert.`,
    };


    return res.redirect(
      `/admin/penalty-ledger#liga-${league.id}`,
    );
  } catch (error) {
    if (
      wantsJson(req)
    ) {
      return res
        .status(400)
        .json({
          ok:
            false,

          message:
            error.message ||
            "Die Zelle konnte nicht gespeichert werden.",
        });
    }


    throw error;
  }
};


/*
 * =====================================================
 * ALTER DELETE-ENDPOINT
 * =====================================================
 *
 * Vorerst weiterhin vorhanden.
 */

exports.remove = async (
  req,
  res,
) => {
  const entry =
    await PenaltyEntry.findByPk(
      Number(
        req.params.id,
      ),
    );


  const leagueId =
    entry?.LeagueId;


  if (entry) {
    await entry.destroy();
  }


  req.session.flash = {
    type:
      "success",

    message:
      "Eintrag wurde aus der Strafkartei entfernt.",
  };


  res.redirect(
    `/admin/penalty-ledger${
      leagueId
        ? `#liga-${leagueId}`
        : ""
    }`,
  );
};


/*
 * =====================================================
 * EXPORTS FÜR TESTS / WEITERE CONTROLLER
 * =====================================================
 */

module.exports.buildLeagueLedger =
  buildLeagueLedger;

module.exports.buildGlobalLedgers =
  buildGlobalLedgers;
