const { Op } = require("sequelize");

const {
  sequelize,
  League,
  Team,
  TeamRoster,
  TeamRosterDriver,
  Driver,
  Season,
  GrandPrixResult,
  GrandPrixResultEntry,
  F1RaceLineupEntry,
  F1CarProfile,
  PenaltyEntry,
  PointsScheme,
} = require("../models");

const {
  pointsForPosition,
  recalculateDriverRaceCounts,
} = require("../services/championship");

const seasonProgress =
  require("../services/seasonProgress");

const {
  regularStarts,
  reserveRoleField,
  reserveStarts,
} = require("../services/raceLineup");

const {
  loadSeasonStructure,
} = require("../services/f1Season");


/*
 * =========================================================
 * ERGEBNISSTATUS
 * =========================================================
 *
 * Aktuelle Saison:
 * EJS zeigt nur Gewertet / DNF / DSQ.
 *
 * Historische Saison:
 * diese komplette Liste bleibt weiterhin verfügbar.
 */

const statuses = [
  "",
  "DNF",
  "DNS",
  "DNQ",
  "DSQ",
  "DNA",
];


/*
 * =========================================================
 * FORMULAR-HELPER
 * =========================================================
 *
 * Neue aktuelle Ergebniseingabe:
 *
 * rows[d31][position]
 *
 * Historische alte Ergebniseingabe:
 *
 * rows[31][position]
 *
 * Diese Helper unterstützen BEIDE Varianten.
 */

function parseSubmittedDriverId(key) {
  const id =
    Number(
      String(key || "")
        .replace(/^d/, ""),
    );

  return Number.isInteger(id) && id > 0
    ? id
    : null;
}


function getSubmittedRow(
  submittedRows,
  driverId,
) {
  return (
    submittedRows[`d${driverId}`] ||
    submittedRows[String(driverId)] ||
    {}
  );
}


/*
 * =========================================================
 * RENNEN LADEN
 * =========================================================
 */

async function getRaces(
  leagueId,
  seasonId,
) {
  return GrandPrixResult.findAll({
    where: {
      LeagueId:
        leagueId,

      SeasonId:
        seasonId,

      discipline:
        "f1",

      raceType:
        "main",
    },

    include: [
      {
        model:
          League,

        as:
          "league",

        where: {
          type:
            "f1",
        },
      },
    ],

    order: [
      ["sortOrder", "ASC"],
      ["raceType", "DESC"],
      ["raceDate", "ASC"],
    ],
  });
}


/*
 * =========================================================
 * FAHRER-ERGEBNIS SUCHEN
 * =========================================================
 */

function findDriverEntry(
  driver,
  entries,
) {
  const names =
    new Set([
      driver.name,

      ...(driver.aliases || [])
        .map(
          (alias) =>
            alias.alias,
        ),
    ]);


  return entries.find(
    (entry) =>
      Number(entry.DriverId) ===
        Number(driver.id) ||
      (
        !entry.DriverId &&
        names.has(
          entry.driverName,
        )
      ),
  );
}


/*
 * =========================================================
 * TEAMS LADEN
 * =========================================================
 */

async function loadTeams(
  leagueId,
  seasonId,
) {
  const structure =
    await loadSeasonStructure(
      seasonId,
    );


  /*
   * Neue Saisonstruktur vorhanden
   */
  if (
    structure.teams.length
  ) {
    return Promise.all(
      structure.teams.map(
        async (
          seasonTeam,
        ) => {

          let actualTeam =
            null;


          if (
            seasonTeam.sourceType ===
            "current"
          ) {
            actualTeam =
              await Team.findByPk(
                seasonTeam.sourceId,
              );

          } else {

            const profile =
              await F1CarProfile.findByPk(
                seasonTeam.sourceId,
              );


            if (
              profile?.BaseTeamId
            ) {
              actualTeam =
                await Team.findByPk(
                  profile.BaseTeamId,
                );
            }
          }


          return {
            id:
              actualTeam?.id ||
              null,

            seasonTeamId:
              seasonTeam.id,

            name:
              seasonTeam.name,

            accentColor:
              seasonTeam.accentColor,

            logoPath:
              seasonTeam.logoPath,

            drivers:
              seasonTeam.drivers.map(
                (driver) => ({
                  driver,
                  roleName:
                    "Stammfahrer",
                }),
              ),
          };
        },
      ),
    );
  }


  /*
   * Legacy Roster
   */
  const rosters =
    await TeamRoster.findAll({
      where: {
        LeagueId:
          leagueId,

        discipline:
          "f1",
      },

      include: [
        {
          association:
            "team",
        },

        {
          association:
            "assignments",

          include: [
            {
              association:
                "driver",

              include: [
                {
                  association:
                    "aliases",
                },
              ],
            },
          ],
        },
      ],

      order: [
        ["sortOrder", "ASC"],
        ["id", "ASC"],

        [
          {
            model:
              TeamRosterDriver,

            as:
              "assignments",
          },

          "sortOrder",
          "ASC",
        ],
      ],
    });


  return rosters
    .map(
      (roster) => ({
        ...roster.team.toJSON(),

        rosterId:
          roster.id,

        drivers:
          roster.assignments
            .filter(
              (assignment) =>
                assignment.roleName !==
                "Ersatzfahrer",
            )
            .map(
              (assignment) => ({
                driver:
                  assignment.driver,

                roleName:
                  assignment.roleName,
              }),
            ),
      }),
    )
    .filter(
      (team) =>
        team.drivers.length >= 2,
    );
}


/*
 * =========================================================
 * STARTBERECHTIGTE FAHRER LADEN
 * =========================================================
 */

async function loadEligibleDrivers(
  teams,
  league,
  race,
) {
  const assigned =
    new Map();


  teams.forEach(
    (team) => {

      team.drivers.forEach(
        ({
          driver,
          roleName,
        }) => {

          if (
            !assigned.has(
              driver.id,
            )
          ) {
            assigned.set(
              driver.id,
              {
                driver,

                assignedTeam:
                  team,

                isReserve:
                  roleName ===
                  "Ersatzfahrer",
              },
            );
          }

        },
      );

    },
  );


  /*
   * Fahrereinteilung des Rennens
   */
  const planEntries =
    race
      ? await F1RaceLineupEntry.findAll({
          where: {
            GrandPrixResultId:
              race.id,
          },

          include: [
            {
              association:
                "driver",

              include: [
                {
                  association:
                    "aliases",
                },
              ],
            },
          ],
        })
      : [];


  /*
   * =====================================================
   * LINEUP EXISTIERT
   * =====================================================
   */

  if (
    planEntries.length
  ) {

    /*
     * Wurde Schritt 2 bereits benutzt?
     */
    const attendanceManaged =
      planEntries.some(
        (entry) =>
          entry.attendanceStatus,
      );


    /*
     * ===================================================
     * ANWESENHEIT WURDE BESTÄTIGT
     * ===================================================
     *
     * Nur Fahrer mit includeInResults=true
     * gelangen in Schritt 3.
     */

    if (
      attendanceManaged
    ) {
      const rows =
        [];


      planEntries
        .filter(
          (entry) =>
            entry.includeInResults &&
            entry.driver,
        )
        .forEach(
          (entry) => {

            /*
             * Beim Ersatzfahrer brauchen wir
             * das Team des ersetzten Fahrers.
             */
            const direct =
              entry.roleType ===
                "regular"
                ? assigned.get(
                    entry.DriverId,
                  )
                : assigned.get(
                    entry
                      .ReplacementForDriverId,
                  );


            const targetEntry =
              entry.roleType ===
                "reserve"
                ? planEntries.find(
                    (candidate) =>
                      Number(
                        candidate.DriverId,
                      ) ===
                      Number(
                        entry
                          .ReplacementForDriverId,
                      ),
                  )
                : null;


            const assignedTeam =
              teams.find(
                (team) =>
                  Number(team.id) ===
                  Number(
                    entry.TeamId,
                  ),
              ) ||
              direct?.assignedTeam ||
              null;


            if (
              !assignedTeam
            ) {
              return;
            }


            rows.push({
              driver:
                entry.driver,

              assignedTeam,

              isReserve:
                entry.roleType ===
                "reserve",

              planned:
                true,

              replacesDriver:
                entry.roleType ===
                  "reserve"
                  ? (
                      direct?.driver ||
                      targetEntry?.driver ||
                      null
                    )
                  : null,
            });
          },
        );


      return {
        rows,

        managed:
          true,

        attendanceManaged:
          true,
      };
    }


    /*
     * ===================================================
     * NUR SCHRITT 1 WURDE GESPEICHERT
     * ===================================================
     */

    const regularPlan =
      new Map(
        planEntries
          .filter(
            (entry) =>
              entry.roleType ===
              "regular",
          )
          .map(
            (entry) => [
              entry.DriverId,
              entry,
            ],
          ),
      );


    const reserveField =
      reserveRoleField(
        league?.slug,
      );


    const reservePlan =
      planEntries.filter(
        (entry) =>
          entry.roleType ===
            "reserve" &&
          entry
            .ReplacementForDriverId &&
          entry.driver?.[
            reserveField
          ],
      );


    const rows =
      [];


    assigned.forEach(
      (
        row,
        driverId,
      ) => {

        const replacement =
          reservePlan.find(
            (entry) =>
              Number(
                entry
                  .ReplacementForDriverId,
              ) ===
              Number(driverId),
          );


        if (
          !replacement &&
          regularStarts(
            regularPlan.get(
              driverId,
            )?.status,
          )
        ) {
          rows.push({
            ...row,
            planned:
              true,
          });
        }

      },
    );


    reservePlan.forEach(
      (entry) => {

        const replaced =
          assigned.get(
            entry
              .ReplacementForDriverId,
          );


        if (
          replaced &&
          reserveStarts(
            entry.status,
          )
        ) {
          rows.push({
            driver:
              entry.driver,

            assignedTeam:
              replaced.assignedTeam,

            isReserve:
              true,

            planned:
              true,

            replacesDriver:
              replaced.driver,
          });
        }

      },
    );


    return {
      rows,

      managed:
        true,
    };
  }


  /*
   * =====================================================
   * KEIN LINEUP
   * =====================================================
   */

  const reserveField =
    reserveRoleField(
      league?.slug,
    );


  const reserves =
    await Driver.findAll({
      where: {
        [reserveField]:
          true,
      },

      include: [
        {
          association:
            "aliases",
        },
      ],

      order: [
        ["sortOrder", "ASC"],
        ["name", "ASC"],
      ],
    });


  reserves.forEach(
    (driver) => {

      if (
        !assigned.has(
          driver.id,
        )
      ) {
        assigned.set(
          driver.id,
          {
            driver,

            assignedTeam:
              null,

            isReserve:
              true,
          },
        );
      }

    },
  );


  return {
    rows:
      [...assigned.values()],

    managed:
      false,
  };
}


/*
 * =========================================================
 * HISTORISCHE FAHRERWAHL
 * =========================================================
 */

function requestedDriverIds(
  query,
  entries,
  sprintEntries,
) {
  const hasExplicitSelection =
    Object.prototype
      .hasOwnProperty
      .call(
        query,
        "drivers",
      );


  const raw =
    Array.isArray(
      query.drivers,
    )
      ? query.drivers
      : query.drivers !==
          undefined
        ? [
            query.drivers,
          ]
        : [];


  const storedIds =
    hasExplicitSelection
      ? []
      : [
          ...entries.map(
            (entry) =>
              entry.DriverId,
          ),

          ...sprintEntries.map(
            (entry) =>
              entry.DriverId,
          ),
        ];


  const ids = [
    ...raw,
    query.addDriver,
    ...storedIds,
  ]
    .flatMap(
      (value) =>
        String(
          value || "",
        ).split(","),
    )
    .map(Number)
    .filter(
      (value) =>
        Number.isInteger(
          value,
        ) &&
        value > 0,
    );


  return [
    ...new Set(ids),
  ].slice(
    0,
    20,
  );
}


/*
 * =========================================================
 * EDITOR ANZEIGEN
 * =========================================================
 */

async function showEditor(
  req,
  res,
  currentOnly = false,
) {
  const leagues =
    await League.findAll({
      where: {
        type:
          "f1",
      },

      order: [
        ["sortOrder", "ASC"],
        ["name", "ASC"],
      ],
    });


  const selectedLeague =
    leagues.find(
      (league) =>
        league.id ===
        Number(
          req.query.league,
        ),
    ) ||
    leagues[0] ||
    null;


  const seasons =
    selectedLeague
      ? await Season.findAll({
          where: {
            leagueType:
              "f1",

            scopeSlug:
              selectedLeague.slug,

            ...(currentOnly
              ? {
                  status:
                    "active",

                  isPublished:
                    true,
                }
              : {
                  status:
                    "historical",
                }),
          },

          include: [
            {
              association:
                "category",
            },
          ],

          order: [
            ["status", "ASC"],
            ["sortOrder", "DESC"],
            ["id", "DESC"],
          ],
        })
      : [];


  const selectedSeason =
    currentOnly
      ? seasons.find(
          (season) =>
            season.status ===
            "active",
        ) ||
        null
      : seasons.find(
          (season) =>
            season.id ===
            Number(
              req.query.season,
            ),
        ) ||
        seasons[0] ||
        null;


  const races =
    selectedLeague &&
    selectedSeason
      ? await getRaces(
          selectedLeague.id,
          selectedSeason.id,
        )
      : [];


  const selectedRace =
    races.find(
      (race) =>
        race.id ===
        Number(
          req.query.race,
        ),
    ) ||
    races[0] ||
    null;


  /*
   * Sprint desselben Rennwochenendes
   */
  const sprintRace =
    selectedRace
      ? await GrandPrixResult.findOne({
          where: {
            SeasonId:
              selectedRace.SeasonId,

            LeagueId:
              selectedRace.LeagueId,

            circuit:
              selectedRace.circuit,

            sortOrder:
              selectedRace.sortOrder,

            raceType:
              "sprint",
          },
        })
      : null;


  const teams =
    selectedLeague &&
    selectedSeason
      ? await loadTeams(
          selectedLeague.id,
          selectedSeason.id,
        )
      : [];


  let rows =
    [];

  let availableDrivers =
    [];

  let historicalDriverIds =
    [];

  let lineupManaged =
    false;

  let attendanceManaged =
    false;


  if (
    selectedRace &&
    selectedSeason
  ) {
    const [
      entries,
      sprintEntries,
      raceBans,
    ] =
      await Promise.all([
        GrandPrixResultEntry.findAll({
          where: {
            GrandPrixResultId:
              selectedRace.id,
          },

          order: [
            ["sortOrder", "ASC"],
            ["position", "ASC"],
          ],
        }),


        sprintRace
          ? GrandPrixResultEntry.findAll({
              where: {
                GrandPrixResultId:
                  sprintRace.id,
              },

              order: [
                ["sortOrder", "ASC"],
                ["position", "ASC"],
              ],
            })
          : [],


        PenaltyEntry.findAll({
          where: {
            GrandPrixResultId:
              selectedRace.id,

            isRaceBan:
              true,
          },
        }),
      ]);


    const bannedDriverIds =
      new Set(
        raceBans.map(
          (entry) =>
            entry.DriverId,
        ),
      );


    let eligible;


    /*
     * =====================================================
     * HISTORISCHE SAISON
     * =====================================================
     */

    if (
      selectedSeason.status ===
      "historical"
    ) {
      const structure =
        await loadSeasonStructure(
          selectedSeason.id,
        );


      availableDrivers =
        structure.allDrivers;


      historicalDriverIds =
        requestedDriverIds(
          req.query,
          entries,
          sprintEntries,
        );


      if (
        !Object.prototype
          .hasOwnProperty
          .call(
            req.query,
            "drivers",
          ) &&
        !historicalDriverIds.length
      ) {
        historicalDriverIds =
          structure.allDrivers
            .map(
              (driver) =>
                driver.id,
            )
            .slice(
              0,
              20,
            );
      }


      eligible =
        availableDrivers.filter(
          (driver) =>
            historicalDriverIds.includes(
              driver.id,
            ),
        );

    } else {

      /*
       * ===================================================
       * AKTUELLE SAISON
       * ===================================================
       */

      const lineup =
        await loadEligibleDrivers(
          teams,
          selectedLeague,
          selectedRace,
        );


      eligible =
        lineup.attendanceManaged
          ? lineup.rows
          : [];


      lineupManaged =
        lineup.managed;

      attendanceManaged =
        lineup.attendanceManaged;
    }


    /*
     * Ergebnisse mit Fahrern verbinden
     */
    rows =
      eligible.map(
        (value) => {

          const wrapper =
            value.driver
              ? value
              : {
                  driver:
                    value,

                  assignedTeam:
                    null,

                  isReserve:
                    false,
                };


          return {
            ...wrapper,

            entry:
              findDriverEntry(
                wrapper.driver,
                entries,
              ) ||
              null,

            sprintEntry:
              findDriverEntry(
                wrapper.driver,
                sprintEntries,
              ) ||
              null,

            raceBan:
              bannedDriverIds.has(
                wrapper.driver.id,
              ),
          };
        },
      );


    /*
     * Gespeicherte Ergebnisse zuerst
     */
    rows.sort(
      (
        left,
        right,
      ) => {

        const leftPosition =
          Number(
            left.entry?.position ||
            left.sprintEntry
              ?.position ||
            Number
              .MAX_SAFE_INTEGER,
          );


        const rightPosition =
          Number(
            right.entry?.position ||
            right.sprintEntry
              ?.position ||
            Number
              .MAX_SAFE_INTEGER,
          );


        return (
          leftPosition -
            rightPosition ||
          left.driver.name.localeCompare(
            right.driver.name,
            "de",
          )
        );
      },
    );
  }


  return res.render(
    "admin/race-editor",
    {
      title:
        "Tabellarischer Saisonverlauf",

      leagues,
      selectedLeague,
      seasons,
      selectedSeason,
      races,
      selectedRace,
      sprintRace,
      teams,
      rows,
      statuses,
      availableDrivers,
      historicalDriverIds,
      lineupManaged,
      attendanceManaged,
      currentOnly,
      resultPointsScheme: selectedSeason?.PointsSchemeId
        ? await PointsScheme.findByPk(selectedSeason.PointsSchemeId, {
            include: [{ association: "allocations", required: false }],
          })
        : null,
    },
  );
}


/*
 * =========================================================
 * ROUTEN
 * =========================================================
 */

exports.show =
  (
    req,
    res,
  ) =>
    showEditor(
      req,
      res,
      false,
    );


exports.showCurrent =
  (
    req,
    res,
  ) =>
    showEditor(
      req,
      res,
      true,
    );


/*
 * =========================================================
 * ERGEBNIS SPEICHERN
 * =========================================================
 */

exports.save = async (
  req,
  res,
) => {

  /*
   * =====================================================
   * RENNEN LADEN
   * =====================================================
   */

  const race =
    await GrandPrixResult.findByPk(
      req.params.raceId,
      {
        include: [
          {
            model:
              League,

            as:
              "league",
          },

          {
            model:
              Season,

            as:
              "seasonRecord",
          },
        ],
      },
    );


  if (
    !race ||
    race.discipline !==
      "f1" ||
    !race.seasonRecord
  ) {
    return res
      .status(404)
      .render(
        "errors/404",
        {
          title:
            "Formel-1-Rennen nicht gefunden",
        },
      );
  }


  /*
   * =====================================================
   * POST-DATEN
   * =====================================================
   */

  const submittedRows =
    req.body.rows ||
    {};


  /*
   * Unterstützt:
   *
   * d31
   * d22
   * d80
   *
   * UND alte historische:
   *
   * 31
   * 22
   * 80
   */
  const submittedDriverIds =
    Object.keys(
      submittedRows,
    )
      .map(
        parseSubmittedDriverId,
      )
      .filter(
        (value) =>
          value !== null,
      )
      .slice(
        0,
        20,
      );


  /*
   * Optional zum Debuggen:
   *
   * console.log(
   *   "=== RESULT INPUT ===",
   *   JSON.stringify(
   *     submittedRows,
   *     null,
   *     2,
   *   ),
   * );
   */


  /*
   * =====================================================
   * TEAMS / FAHRER
   * =====================================================
   */

  const teams =
    await loadTeams(
      race.LeagueId,
      race.SeasonId,
    );


  let lineupManaged =
    false;

  let attendanceManaged =
    false;


  let eligible;


  /*
   * Historische Saison:
   * Fahrer kommen direkt aus
   * dem Formular.
   */
  if (
    race.seasonRecord.status ===
    "historical"
  ) {
    eligible =
      await Driver.findAll({
        where: {
          id: {
            [Op.in]:
              submittedDriverIds,
          },
        },

        include: [
          {
            association:
              "aliases",
          },
        ],

        order: [
          ["name", "ASC"],
        ],
      });

  } else {

    /*
     * Aktuelle Saison:
     * Fahrer kommen ausschließlich
     * aus Lineup + Anwesenheit.
     */
    const lineup =
      await loadEligibleDrivers(
        teams,
        race.league,
        race,
      );


    eligible =
      lineup.rows;


    lineupManaged =
      lineup.managed;

    attendanceManaged =
      lineup.attendanceManaged;
  }

  if (race.seasonRecord.status === "active" && (!lineupManaged || !attendanceManaged)) {
    req.session.flash = {
      type: "error",
      message: "Bitte zuerst Aufstellung und Anwesenheitskontrolle vollständig abschließen.",
    };
    return res.redirect(`/admin/race-weekend/f1?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}#anwesenheit`);
  }


  const driverRows =
    eligible.map(
      (value) =>
        value.driver
          ? value
          : {
              driver:
                value,

              assignedTeam:
                null,

              isReserve:
                false,
            },
    );


  /*
   * =====================================================
   * SPRINT SUCHEN
   * =====================================================
   */

  const sprintRace =
    await GrandPrixResult.findOne({
      where: {
        SeasonId:
          race.SeasonId,

        LeagueId:
          race.LeagueId,

        circuit:
          race.circuit,

        sortOrder:
          race.sortOrder,

        raceType:
          "sprint",
      },
    });


  /*
   * =====================================================
   * BISHERIGE ERGEBNISSE
   * =====================================================
   */

  const [
    existingEntries,
    existingSprintEntries,
  ] =
    await Promise.all([

      GrandPrixResultEntry.findAll({
        where: {
          GrandPrixResultId:
            race.id,
        },
      }),


      sprintRace
        ? GrandPrixResultEntry.findAll({
            where: {
              GrandPrixResultId:
                sprintRace.id,
            },
          })
        : [],

    ]);


  const requestedEditorPath =
    req.body._return ===
      "current"
      ? "/admin/current-season-progress"
      : "/admin/race-editor";


  /*
   * =====================================================
   * PLATZIERUNGEN VALIDIEREN
   * =====================================================
   *
   * Sehr wichtig:
   * jetzt über getSubmittedRow().
   */

  for (
    const event
    of [
      {
        race,
        field:
          "position",
      },

      ...(sprintRace
        ? [
            {
              race:
                sprintRace,

              field:
                "sprintPosition",
            },
          ]
        : []),
    ]
  ) {

    if (
      event.race.pointsMode ===
      "manual"
    ) {
      continue;
    }


    const usedPositions =
      new Map();


    for (
      const {
        driver,
      }
      of driverRows
    ) {

      const submitted =
        getSubmittedRow(
          submittedRows,
          driver.id,
        );


      if (
        submitted.included !==
          "on"
      ) {
        if (race.seasonRecord.status === "active" && lineupManaged) {
          req.session.flash = { type: "error", message: `${driver.name} fehlt im vollständigen Rennergebnis.` };
          return res.redirect(`${requestedEditorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`);
        }
        continue;
      }

      if (!submitted[event.field]) {
        req.session.flash = {
          type: "error",
          message: `${event.race.raceType === "sprint" ? "Sprint: " : ""}${driver.name} besitzt noch keine Platzierung.`,
        };
        return res.redirect(`${requestedEditorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`);
      }


      const position =
        Number(
          submitted[
            event.field
          ],
        );


      if (
        !Number.isInteger(
          position,
        ) ||
        position < 1
      ) {
        req.session.flash = {
          type:
            "error",

          message:
            `${
              event.race.raceType ===
              "sprint"
                ? "Sprint: "
                : ""
            }${driver.name} benötigt einen gültigen Platz größer 0.`,
        };


        return res.redirect(
          `${requestedEditorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`,
        );
      }


      if (
        usedPositions.has(
          position,
        )
      ) {
        req.session.flash = {
          type:
            "error",

          message:
            `${
              event.race.raceType ===
              "sprint"
                ? "Sprint: "
                : ""
            }Platz ${position} wurde doppelt vergeben (${usedPositions.get(position)} und ${driver.name}).`,
        };


        return res.redirect(
          `${requestedEditorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`,
        );
      }


      usedPositions.set(
        position,
        driver.name,
      );
    }
  }

  for (const event of [
    { race, prefix: "" },
    ...(sprintRace ? [{ race: sprintRace, prefix: "sprint" }] : []),
  ]) {
    const fastestField = event.prefix ? "sprintFastestLap" : "fastestLap";
    const poleField = event.prefix ? "sprintPolePosition" : "polePosition";
    const fastestCount = driverRows.filter(({ driver }) => getSubmittedRow(submittedRows, driver.id)[fastestField] === "on").length;
    const poleCount = driverRows.filter(({ driver }) => getSubmittedRow(submittedRows, driver.id)[poleField] === "on").length;
    if (fastestCount > 1 || poleCount > 1) {
      req.session.flash = {
        type: "error",
        message: `${event.race.raceType === "sprint" ? "Sprint: " : ""}${fastestCount > 1 ? "Die schnellste Runde" : "Die Pole Position"} darf nur einmal vergeben werden.`,
      };
      return res.redirect(`${requestedEditorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`);
    }
  }

  const driverOfTheDayCount = driverRows.filter(({ driver }) =>
    getSubmittedRow(submittedRows, driver.id).driverOfTheDay === "on",
  ).length;
  if (driverOfTheDayCount > 1) {
    req.session.flash = {
      type: "error",
      message: "Der Driver of the Day darf im Hauptrennen nur einmal vergeben werden.",
    };
    return res.redirect(`${requestedEditorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`);
  }


  /*
   * =====================================================
   * SPEICHERN
   * =====================================================
   */

  try {

    await sequelize.transaction(
      async (
        transaction,
      ) => {


        /*
         * =================================================
         * FAHRER SPEICHERN
         * =================================================
         */

        for (
          const {
            driver,
            assignedTeam,
          }
          of driverRows
        ) {

          /*
           * WICHTIG:
           *
           * d31 ODER 31
           */
          const submitted =
            getSubmittedRow(
              submittedRows,
              driver.id,
            );


          const existing =
            findDriverEntry(
              driver,
              existingEntries,
            );


          const existingSprint =
            findDriverEntry(
              driver,
              existingSprintEntries,
            );


          /*
           * Fahrer wurde nicht übertragen.
           */
          if (
            submitted.included !==
            "on"
          ) {
            // Nicht übertragene Zeilen werden bewusst nicht gelöscht. Dadurch
            // bleiben bereits gespeicherte Rennhistorien bei einer späteren
            // Kader- oder Anwesenheitsänderung unangetastet.
            continue;
          }


          /*
           * =================================================
           * TEAM BESTIMMEN
           * =================================================
           */

          const selectedTeam =
            teams.find(
              (candidate) =>
                Number(
                  candidate.id,
                ) ===
                Number(
                  submitted.TeamId,
                ),
            ) ||
            null;


          /*
           * Historisch: Team aus dem bewusst gepflegten Formular.
           * Aktuell: immer das Team der tatsächlichen Rennaufstellung.
           * Insbesondere bei Ersatzfahrern darf ein manipulierter Formularwert
           * vergangene oder aktuelle Konstrukteurspunkte nicht verschieben.
           */
          const team =
            race.seasonRecord.status ===
              "historical"
              ? selectedTeam
              : assignedTeam;


          if (
            !team
          ) {
            throw new Error(
              `${driver.name}: Bitte ein Team für dieses Rennen auswählen.`,
            );
          }


          /*
           * =================================================
           * STATUS
           * =================================================
           */

          const status =
            statuses.includes(
              submitted.status,
            )
              ? submitted.status
              : "";


          /*
           * =================================================
           * EIN RENNEN SPEICHERN
           * =================================================
           */

          const saveEvent =
            async (
              eventRace,
              current,
              prefix = "",
            ) => {

              if (
                !eventRace
              ) {
                return;
              }


              const positionField =
                prefix
                  ? `${prefix}Position`
                  : "position";


              const pointsField =
                prefix
                  ? `${prefix}Points`
                  : "points";


              const fastestField =
                prefix
                  ? `${prefix}FastestLap`
                  : "fastestLap";


              /*
               * Position
               */
              const position =
                eventRace.pointsMode ===
                  "manual"
                  ? null
                  : (
                      submitted[
                        positionField
                      ]
                        ? Number(
                            submitted[
                              positionField
                            ],
                          )
                        : null
                    );


              /*
               * Schnellste Runde
               */
              const fastestLap =
                eventRace.pointsMode ===
                  "database" &&
                submitted[
                  fastestField
                ] ===
                  "on";

              const poleField = prefix ? `${prefix}PolePosition` : "polePosition";
              const polePosition =
                eventRace.pointsMode === "database" && submitted[poleField] === "on";

              // Driver of the Day ist eine reine Auszeichnung des
              // Hauptrennens und verändert die bestehende Punkteberechnung nie.
              const driverOfTheDay = !prefix && submitted.driverOfTheDay === "on";


              /*
               * Punkte zuerst regulär berechnen.
               */
              const calculatedPoints =
                eventRace.pointsMode ===
                  "manual"
                  ? Number(
                      submitted[
                        pointsField
                      ] ||
                      0,
                    )
                  : await pointsForPosition(
                      position,
                      {
                        ...eventRace.toJSON(),

                        fastestLap,
                        polePosition,
                      },
                    );


              /*
               * =================================================
               * DSQ = IMMER 0 PUNKTE
               * =================================================
               *
               * DNF darf dagegen weiterhin
               * klassifiziert sein.
               */
              const points =
                status ===
                  "DSQ"
                  ? 0
                  : calculatedPoints;


              /*
               * Datenbankwerte
               */
              const values = {
                GrandPrixResultId:
                  eventRace.id,

                DriverId:
                  driver.id,

                TeamId:
                  team.id,

                driverName:
                  driver.name,

                teamName:
                  team.name,

                position,

                status:
                  status ||
                  null,

                points,

                fastestLap,

                polePosition,

                driverOfTheDay,

                sortOrder:
                  position ||
                  driver.sortOrder ||
                  999,
              };


              if (
                current
              ) {
                await current.update(
                  values,
                  {
                    transaction,
                  },
                );

              } else {

                await GrandPrixResultEntry.create(
                  values,
                  {
                    transaction,
                  },
                );
              }
            };


          /*
           * Hauptrennen
           */
          await saveEvent(
            race,
            existing,
          );


          /*
           * Sprint
           */
          await saveEvent(
            sprintRace,
            existingSprint,
            "sprint",
          );


          /*
           * =================================================
           * HISTORISCHE RENNSPERRE
           * =================================================
           *
           * Aktuelle UI zeigt dieses Feld nicht,
           * aber historische Pflege bleibt kompatibel.
           */

          const editorBan =
            await PenaltyEntry.findOne({
              where: {
                GrandPrixResultId:
                  race.id,

                DriverId:
                  driver.id,

                isRaceBan:
                  true,

                reason:
                  "Rennsperre (Ergebnispflege)",
              },

              transaction,
            });


          if (
            submitted.raceBan ===
            "on"
          ) {

            if (
              !editorBan
            ) {

              const awardedOn =
                race.raceDate ||
                new Date()
                  .toISOString()
                  .slice(
                    0,
                    10,
                  );


              const expires =
                new Date(
                  `${awardedOn}T12:00:00Z`,
                );


              expires.setUTCFullYear(
                expires.getUTCFullYear() +
                  1,
              );


              await PenaltyEntry.create(
                {
                  LeagueId:
                    race.LeagueId,

                  DriverId:
                    driver.id,

                  GrandPrixResultId:
                    race.id,

                  points:
                    0,

                  reason:
                    "Rennsperre (Ergebnispflege)",

                  comment:
                    race.title,

                  awardedOn,

                  expiresOn:
                    expires
                      .toISOString()
                      .slice(
                        0,
                        10,
                      ),

                  isAutomatic:
                    false,

                  isRaceBan:
                    true,
                },
                {
                  transaction,
                },
              );
            }

          } else if (
            editorBan
          ) {

            await editorBan.destroy({
              transaction,
            });
          }
        }
      },
    );

  } catch (
    error
  ) {

    console.error(
      "Race editor save error:",
      error,
    );


    req.session.flash = {
      type:
        "error",

      message:
        error.message,
    };


    const editorPath =
      req.body._return ===
        "current"
        ? "/admin/current-season-progress"
        : "/admin/race-editor";


    return res.redirect(
      `${editorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`,
    );
  }


  /*
   * =====================================================
   * WM / RENNANZAHL NEU BERECHNEN
   * =====================================================
   */

  await recalculateDriverRaceCounts();


  req.session.flash = {
    type:
      "success",

    message:
      `${race.title}: Ergebnis, Punkte und WM wurden automatisch aktualisiert.`,
  };


  const editorPath =
    req.body._return ===
      "current"
      ? "/admin/current-season-progress"
      : "/admin/race-editor";


  return res.redirect(
    `${editorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`,
  );
};


/*
 * =========================================================
 * EDITOR REDIRECT
 * =========================================================
 */

function editorRedirect(
  values = {},
) {
  const query =
    new URLSearchParams(
      Object.entries(
        values,
      ).filter(
        (
          [
            ,
            value,
          ],
        ) =>
          value,
      ),
    );


  return `/admin/race-editor${
    query.size
      ? `?${query}`
      : ""
  }`;
}


/*
 * =========================================================
 * HISTORISCHE SAISON ANLEGEN
 * =========================================================
 */

exports.createSeason =
  async (
    req,
    res,
  ) => {

    try {

      const {
        season,
        league,
      } =
        await seasonProgress.createSeason(
          "f1",
          req.body,
        );


      req.session.flash = {
        type:
          "success",

        message:
          `${season.name} wurde direkt in der Formel-1-Saisonpflege angelegt.`,
      };


      return res.redirect(
        editorRedirect({
          league:
            league.id,

          season:
            season.id,
        }),
      );

    } catch (
      error
    ) {

      req.session.flash = {
        type:
          "error",

        message:
          error.message,
      };


      return res.redirect(
        editorRedirect({
          league:
            req.body.LeagueId,
        }),
      );
    }
  };


/*
 * =========================================================
 * HISTORISCHES RENNEN ANLEGEN
 * =========================================================
 */

exports.createRace =
  async (
    req,
    res,
  ) => {

    try {

      const {
        main,
      } =
        await seasonProgress.createManualRace(
          "f1",
          req.body,
        );


      req.session.flash = {
        type:
          "success",

        message:
          `${main.title} wurde angelegt. Die Renntabelle ist sofort bereit.`,
      };


      return res.redirect(
        editorRedirect({
          league:
            main.LeagueId,

          season:
            main.SeasonId,

          race:
            main.id,
        }),
      );

    } catch (
      error
    ) {

      req.session.flash = {
        type:
          "error",

        message:
          error.message,
      };


      return res.redirect(
        editorRedirect({
          league:
            req.body.LeagueId,

          season:
            req.body.SeasonId,
        }),
      );
    }
  };


/*
 * =========================================================
 * KALENDER IMPORTIEREN
 * =========================================================
 */

exports.importCalendar =
  async (
    req,
    res,
  ) => {

    try {

      const result =
        await seasonProgress.importCalendar(
          "f1",
          req.body,
        );


      req.session.flash = {
        type:
          "success",

        message:
          `${result.imported} Rennen wurden aus dem F1-Rennkalender übernommen.`,
      };

    } catch (
      error
    ) {

      req.session.flash = {
        type:
          "error",

        message:
          error.message,
      };
    }


    return res.redirect(
      editorRedirect({
        league:
          req.body.LeagueId,

        season:
          req.body.SeasonId,
      }),
    );
  };


/*
 * =========================================================
 * RENNEINSTELLUNGEN
 * =========================================================
 */

exports.updateRace =
  async (
    req,
    res,
  ) => {

    try {

      const {
        main,
      } =
        await seasonProgress.updateRaceSettings(
          "f1",
          req.params.raceId,
          req.body,
        );


      req.session.flash = {
        type:
          "success",

        message:
          "Rennmodus wurde aktualisiert.",
      };


      return res.redirect(
        editorRedirect({
          league:
            main.LeagueId,

          season:
            main.SeasonId,

          race:
            main.id,
        }),
      );

    } catch (
      error
    ) {

      req.session.flash = {
        type:
          "error",

        message:
          error.message,
      };


      return res.redirect(
        editorRedirect(),
      );
    }
  };


/*
 * =========================================================
 * RENNEN LÖSCHEN
 * =========================================================
 */

exports.removeRace =
  async (
    req,
    res,
  ) => {

    try {

      const race =
        await GrandPrixResult.findByPk(
          req.params.raceId,
        );


      const redirect =
        editorRedirect({
          league:
            race?.LeagueId,

          season:
            race?.SeasonId,
        });


      await seasonProgress.removeRaceEvent(
        "f1",
        req.params.raceId,
      );


      req.session.flash = {
        type:
          "success",

        message:
          "Rennen und zugehöriger Sprint wurden entfernt.",
      };


      return res.redirect(
        redirect,
      );

    } catch (
      error
    ) {

      req.session.flash = {
        type:
          "error",

        message:
          error.message,
      };


      return res.redirect(
        editorRedirect(),
      );
    }
  };
