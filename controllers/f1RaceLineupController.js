const { Op } = require("sequelize");

const {
  sequelize,
  League,
  Season,
  Team,
  TeamRoster,
  TeamRosterDriver,
  Driver,
  GrandPrixResult,
  F1RaceLineupEntry,
  PenaltyEntry,
  F1PenaltySetting,
  F1CarProfile,
} = require("../models");

const {
  REGULAR_STATUSES,
  RESERVE_STATUSES,
  normalizeRegularStatus,
  normalizeReserveStatus,
  reserveRoleField,
  regularRoleField,
} = require("../services/raceLineup");

const {
  loadSeasonStructure,
} = require("../services/f1Season");


/*
 * =========================================================
 * TEAMS / FAHRER LADEN
 * =========================================================
 */

async function loadRosterTeams(
  league,
  race,
) {
  /*
   * Wenn das Rennen zu einer Saison gehört,
   * hat die Saisonstruktur Vorrang.
   */
  if (race?.SeasonId) {
    const structure =
      await loadSeasonStructure(
        race.SeasonId,
        race.sortOrder,
      );

    if (structure.teams.length) {
      return Promise.all(
        structure.teams
          .filter(
            (seasonTeam) =>
              seasonTeam.drivers.length,
          )
          .map(
            async (seasonTeam) => {
              let actualTeam = null;

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
                roster: null,

                team: {
                  id:
                    actualTeam?.id ||
                    null,

                  name:
                    seasonTeam.name,

                  accentColor:
                    seasonTeam.accentColor,

                  logoPath:
                    seasonTeam.logoPath,

                  seasonTeamId:
                    seasonTeam.id,
                },

                drivers:
                  seasonTeam.drivers,
              };
            },
          ),
      );
    }
  }


  /*
   * Fallback:
   * aktuelles TeamRoster.
   */

  const roleField =
    regularRoleField(
      league.slug,
    );

  const rosters =
    await TeamRoster.findAll({
      where: {
        LeagueId: league.id,
        discipline: "f1",
      },

      include: [
        {
          association: "team",
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
        roster,

        team:
          roster.team,

        drivers:
          roster.assignments
            .filter(
              (assignment) =>
                assignment.roleName !==
                  "Ersatzfahrer" &&
                assignment.driver?.[
                  roleField
                ],
            )
            .map(
              (assignment) =>
                assignment.driver,
            ),
      }),
    )
    .filter(
      (team) =>
        team.drivers.length,
    );
}


/*
 * =========================================================
 * AUFSTELLUNG LADEN
 * =========================================================
 */

async function loadPlanningRows(
  league,
  race,
) {
  const structure =
    race?.SeasonId
      ? await loadSeasonStructure(
          race.SeasonId,
          race.sortOrder,
        )
      : null;


  const today =
    new Date()
      .toISOString()
      .slice(0, 10);


  const [
    teams,
    fallbackReserves,
    entries,
    penalties,
    penaltySetting,
  ] = await Promise.all([
    loadRosterTeams(
      league,
      race,
    ),

    Driver.findAll({
      where: {
        [reserveRoleField(
          league.slug,
        )]: true,
      },

      include: [
        {
          association:
            "aliases",
        },
      ],

      order: [
        ["name", "ASC"],
        ["id", "ASC"],
      ],
    }),

    race
      ? F1RaceLineupEntry.findAll({
          where: {
            GrandPrixResultId:
              race.id,
          },

          include: [
            {
              association:
                "driver",
            },

            {
              association:
                "replacementFor",
            },

            {
              association:
                "team",
            },
          ],

          order: [
            [
              "roleType",
              "ASC",
            ],

            [
              "sortOrder",
              "ASC",
            ],

            [
              "id",
              "ASC",
            ],
          ],
        })
      : [],

    PenaltyEntry.findAll({
      where: {
        LeagueId:
          league.id,

        expiresOn: {
          [Op.gte]:
            today,
        },
      },
    }),

    F1PenaltySetting.findOne({
      where: {
        LeagueId:
          league.id,
      },
    }),
  ]);


  /*
   * Saison-Ersatzfahrer verwenden.
   * Falls keine gepflegt sind:
   * Fahrer-Rang als Fallback.
   */

  const reserves =
    structure?.unassignedDrivers
      ?.length
      ? structure.unassignedDrivers
      : fallbackReserves;


  /*
   * =====================================================
   * RENNSPERREN
   * =====================================================
   */

  const threshold =
    Number(
      penaltySetting
        ?.pointsLimit ||
        12,
    );


  const pointsByDriver =
    new Map();


  penalties.forEach(
    (entry) => {
      pointsByDriver.set(
        Number(
          entry.DriverId,
        ),

        Number(
          pointsByDriver.get(
            Number(
              entry.DriverId,
            ),
          ) || 0,
        ) +
          Number(
            entry.points ||
              0,
          ),
      );
    },
  );


  const bannedDriverIds =
    new Set(
      penalties
        .filter(
          (entry) =>
            (
              entry.isRaceBan &&
              Number(
                entry.GrandPrixResultId,
              ) ===
                Number(
                  race?.id,
                )
            ) ||
            Number(
              pointsByDriver.get(
                Number(
                  entry.DriverId,
                ),
              ) || 0,
            ) >=
              threshold,
        )
        .map(
          (entry) =>
            Number(
              entry.DriverId,
            ),
        ),
    );


  /*
   * =====================================================
   * BEREITS GESPEICHERTE EINTRÄGE
   * =====================================================
   */

  const regularEntries =
    new Map(
      entries
        .filter(
          (entry) =>
            entry.roleType ===
            "regular",
        )
        .map(
          (entry) => [
            Number(
              entry.DriverId,
            ),

            entry,
          ],
        ),
    );


  const reserveEntries =
    new Map(
      entries
        .filter(
          (entry) =>
            entry.roleType ===
            "reserve",
        )
        .map(
          (entry) => [
            Number(
              entry.DriverId,
            ),

            entry,
          ],
        ),
    );


  const reserveByRegular =
    new Map(
      entries
        .filter(
          (entry) =>
            entry.roleType ===
              "reserve" &&
            entry.ReplacementForDriverId,
        )
        .map(
          (entry) => [
            Number(
              entry.ReplacementForDriverId,
            ),

            entry,
          ],
        ),
    );


  /*
   * =====================================================
   * STAMMFAHRER
   * =====================================================
   */

  const regularById =
    new Map();


  const teamCards =
    teams.map(
      ({
        roster,
        team,
        drivers,
      }) => ({
        roster,

        team,

        rows:
          drivers.map(
            (driver) => {
              const driverId =
                Number(
                  driver.id,
                );


              regularById.set(
                driverId,
                {
                  driver,
                  team,
                },
              );


              const saved =
                regularEntries.get(
                  driverId,
                );


              return {
                driver,

                team,

                entry:
                  saved ||
                  null,

                /*
                 * WICHTIG:
                 * gespeicherter Status bleibt erhalten.
                 * Nur bei ganz neuem Eintrag greift der
                 * normale Default.
                 */
                status:
                  bannedDriverIds.has(
                    driverId,
                  )
                    ? "rennsperre"
                    : saved
                      ? normalizeRegularStatus(
                          saved.status,
                        )
                      : "anwesend",

                isBanned:
                  bannedDriverIds.has(
                    driverId,
                  ),

                replacementDriverId:
                  bannedDriverIds.has(
                    driverId,
                  )
                    ? null
                    : Number(
                        reserveByRegular.get(
                          driverId,
                        )
                          ?.DriverId ||
                          0,
                      ) ||
                      null,

                replacementEntry:
                  reserveByRegular.get(
                    driverId,
                  ) ||
                  null,
              };
            },
          ),
      }),
    );


  /*
   * =====================================================
   * ERSATZFAHRER
   * =====================================================
   */

  const reserveRows =
    reserves.map(
      (driver) => {
        const driverId =
          Number(
            driver.id,
          );


        const saved =
          reserveEntries.get(
            driverId,
          );


        const replacementForDriverId =
          Number(
            saved
              ?.ReplacementForDriverId ||
              0,
          ) ||
          null;


        return {
          driver,

          entry:
            saved ||
            null,


          /*
           * Neu:
           * noch nie gespeichert
           * => anwesend
           *
           * bereits gespeichert
           * => exakt DB-Status verwenden
           */

          status:
            saved
              ? normalizeReserveStatus(
                  saved.status,
                )
              : "anwesend",


          assignedTo:
            replacementForDriverId
              ? regularById.get(
                  replacementForDriverId,
                ) ||
                null
              : null,


          isAssigned:
            Boolean(
              replacementForDriverId,
            ),


          /*
           * Bereits in Schritt 2 bestätigte
           * Ersatzfahrer dürfen nicht
           * versehentlich neu zugeordnet werden.
           */

          isAttendanceLocked:
            Boolean(
              replacementForDriverId &&
                saved
                  ?.includeInResults ===
                  true &&
                [
                  "anwesend",
                  "zu_spaet_vorbesprechung",
                ].includes(
                  saved
                    ?.attendanceStatus,
                ),
            ),
        };
      },
    );


  return {
    teamCards,

    reserves,

    reserveRows,

    hasSavedPlan:
      entries.length > 0,

    bannedDriverIds,
  };
}


/*
 * =========================================================
 * AUFSTELLUNGSSEITE
 * =========================================================
 */

exports.show = async (
  req,
  res,
) => {
  const leagues =
    await League.findAll({
      where: {
        type: "f1",
      },

      order: [
        [
          "sortOrder",
          "ASC",
        ],

        [
          "name",
          "ASC",
        ],
      ],
    });


  const selectedLeague =
    leagues.find(
      (league) =>
        Number(
          league.id,
        ) ===
        Number(
          req.query.league,
        ),
    ) ||
    leagues[0] ||
    null;


  const activeSeason =
    selectedLeague
      ? await Season.findOne({
          where: {
            leagueType:
              "f1",

            scopeSlug:
              selectedLeague.slug,

            status:
              "active",

            isPublished:
              true,
          },

          order: [
            ["id", "DESC"],
          ],
        })
      : null;


  const races =
    activeSeason
      ? await GrandPrixResult.findAll({
          where: {
            SeasonId:
              activeSeason.id,

            LeagueId:
              selectedLeague.id,

            discipline:
              "f1",

            raceType:
              "main",
          },

          order: [
            [
              "sortOrder",
              "ASC",
            ],

            [
              "raceDate",
              "ASC",
            ],

            [
              "id",
              "ASC",
            ],
          ],
        })
      : [];


  const today =
    new Date()
      .toISOString()
      .slice(0, 10);


  const selectedRace =
    races.find(
      (race) =>
        Number(
          race.id,
        ) ===
        Number(
          req.query.race,
        ),
    ) ||
    races.find(
      (race) =>
        !race.raceDate ||
        race.raceDate >=
          today,
    ) ||
    races[
      races.length - 1
    ] ||
    null;


  const planning =
    selectedLeague
      ? await loadPlanningRows(
          selectedLeague,
          selectedRace,
        )
      : {
          teamCards: [],
          reserves: [],
          reserveRows: [],
          hasSavedPlan: false,
        };


  return res.render(
    "admin/f1-race-lineup",
    {
      title:
        "Fahrereinteilung nächstes Rennen",

      leagues,

      selectedLeague,

      activeSeason,

      races,

      selectedRace,

      regularStatuses:
        REGULAR_STATUSES,

      reserveStatuses:
        RESERVE_STATUSES,

      ...planning,
    },
  );
};


/*
 * =========================================================
 * AUFSTELLUNG SPEICHERN
 * =========================================================
 */

exports.save = async (
  req,
  res,
) => {
  const race =
    await GrandPrixResult.findByPk(
      Number(
        req.params.raceId,
      ),

      {
        include: [
          {
            association:
              "league",
          },

          {
            association:
              "seasonRecord",
          },
        ],
      },
    );


  if (
    !race ||
    race.discipline !==
      "f1" ||
    race.raceType !==
      "main" ||
    race.seasonRecord
      ?.status !==
      "active"
  ) {
    return res
      .status(404)
      .render(
        "errors/404",
        {
          title:
            "Aktuelles Formel-1-Rennen nicht gefunden",
        },
      );
  }


  /*
   * =====================================================
   * FORMULARDATEN
   * =====================================================
   */

  const regularInput =
    req.body.regular ||
    {};

  const reserveInput =
    req.body.reserve ||
    {};


  /*
   * Unterstützt gleichzeitig:
   *
   * regular[12]
   * regular[d12]
   *
   * Dadurch können ältere und neue EJS-Stände
   * problemlos verarbeitet werden.
   */

  function regularInputFor(
    driverId,
  ) {
    return {
      ...(
        regularInput[
          String(
            driverId,
          )
        ] ||
        {}
      ),

      ...(
        regularInput[
          `d${driverId}`
        ] ||
        {}
      ),
    };
  }


  function reserveInputFor(
    driverId,
  ) {
    return {
      ...(
        reserveInput[
          String(
            driverId,
          )
        ] ||
        {}
      ),

      ...(
        reserveInput[
          `d${driverId}`
        ] ||
        {}
      ),
    };
  }


  try {
    /*
     * Planung inklusive aktuellem DB-Stand
     * laden.
     */

    const {
      teamCards,
      reserves,
      bannedDriverIds,
    } =
      await loadPlanningRows(
        race.league,
        race,
      );


    const regularRows =
      teamCards.flatMap(
        (card) =>
          card.rows,
      );


    const reserveById =
      new Map(
        reserves.map(
          (driver) => [
            Number(
              driver.id,
            ),

            driver,
          ],
        ),
      );


    /*
     * Aktuelle DB-Einträge zusätzlich laden.
     *
     * Wichtig zum Erhalt von:
     *
     * - Status
     * - Anwesenheit
     * - bestätigter Zuordnung
     */

    const existingEntries =
      await F1RaceLineupEntry.findAll({
        where: {
          GrandPrixResultId:
            race.id,
        },

        include: [
          {
            association:
              "driver",
          },
        ],
      });


    const existingByDriver =
      new Map(
        existingEntries.map(
          (entry) => [
            Number(
              entry.DriverId,
            ),

            entry,
          ],
        ),
      );


    const existingReserveByDriver =
      new Map(
        existingEntries
          .filter(
            (entry) =>
              entry.roleType ===
              "reserve",
          )
          .map(
            (entry) => [
              Number(
                entry.DriverId,
              ),

              entry,
            ],
          ),
      );


    /*
     * =====================================================
     * BESTÄTIGTE ERSATZ-ZUORDNUNGEN
     * =====================================================
     */

    const lockedAssignments =
      new Map(
        existingEntries
          .filter(
            (entry) =>
              entry.roleType ===
                "reserve" &&
              entry
                .ReplacementForDriverId &&
              entry
                .includeInResults ===
                true &&
              [
                "anwesend",
                "zu_spaet_vorbesprechung",
              ].includes(
                entry
                  .attendanceStatus,
              ),
          )
          .map(
            (entry) => [
              Number(
                entry.DriverId,
              ),

              entry,
            ],
          ),
      );


    /*
     * =====================================================
     * ERSATZ-ZUORDNUNGEN AUS FORMULAR
     * =====================================================
     */

    const usedReserves =
      new Set();


    const replacementByReserve =
      new Map();


    for (
      const row of
      regularRows
    ) {
      const driverId =
        Number(
          row.driver.id,
        );


      const input =
        regularInputFor(
          driverId,
        );


      const existing =
        existingByDriver.get(
          driverId,
        );


      /*
       * STATUS
       *
       * Priorität:
       *
       * 1. Rennsperre
       * 2. Formular
       * 3. bestehende DB
       * 4. anwesend
       */

      const regularStatus =
        bannedDriverIds.has(
          driverId,
        )
          ? "rennsperre"

          : input.status
            ? normalizeRegularStatus(
                input.status,
              )

            : existing?.status
              ? normalizeRegularStatus(
                  existing.status,
                )

              : "anwesend";


      const replacementId =
        Number(
          input
            .ReplacementDriverId ||
            0,
        ) ||
        null;


      /*
       * Nur ABGEMELDET / UNSICHER
       * dürfen einen Ersatz haben.
       */

      if (
        replacementId &&
        ![
          "abgemeldet",
          "unsicher",
        ].includes(
          regularStatus,
        )
      ) {
        throw new Error(
          `${row.driver.name}: Ersatzfahrer sind nur bei „abgemeldet“ oder „unsicher“ zulässig.`,
        );
      }


      /*
       * Rennsperre niemals ersetzen.
       */

      if (
        regularStatus ===
          "rennsperre" &&
        replacementId
      ) {
        throw new Error(
          `${row.driver.name} hat für dieses Rennen eine Rennsperre und darf nicht ersetzt werden.`,
        );
      }


      if (
        !replacementId
      ) {
        continue;
      }


      /*
       * Existiert als Ersatzfahrer?
       */

      const reserve =
        reserveById.get(
          replacementId,
        );


      if (!reserve) {
        throw new Error(
          `${row.driver.name}: Der gewählte Ersatzfahrer besitzt nicht den passenden Liga-Rang.`,
        );
      }


      /*
       * STATUS DES ERSATZFAHRERS
       *
       * Priorität:
       *
       * 1. Formular
       * 2. bestehende DB
       * 3. anwesend
       */

      const reserveForm =
        reserveInputFor(
          replacementId,
        );


      const existingReserve =
        existingReserveByDriver.get(
          replacementId,
        );


      const reserveStatus =
        reserveForm.status
          ? normalizeReserveStatus(
              reserveForm.status,
            )

          : existingReserve
              ?.status
            ? normalizeReserveStatus(
                existingReserve.status,
              )

            : "anwesend";


      /*
       * Diese Ersatzfahrer dürfen
       * eingeplant werden.
       *
       * AUF ABRUF ist ausdrücklich erlaubt.
       */

      if (
        ![
          "anwesend",
          "unsicher",
          "auf_abruf",
        ].includes(
          reserveStatus,
        )
      ) {
        throw new Error(
          `${reserve.name} kann mit dem Status „${reserveStatus}“ nicht als Ersatzfahrer eingesetzt werden.`,
        );
      }


      /*
       * Ein Ersatzfahrer = maximal ein Cockpit.
       */

      if (
        usedReserves.has(
          replacementId,
        )
      ) {
        throw new Error(
          `${reserve.name} kann nur einen Stammfahrer ersetzen.`,
        );
      }


      usedReserves.add(
        replacementId,
      );


      replacementByReserve.set(
        replacementId,
        row,
      );
    }


    /*
     * =====================================================
     * BEREITS BESTÄTIGTEN ERSATZ SCHÜTZEN
     * =====================================================
     */

    for (
      const [
        driverId,
        locked,
      ] of
      lockedAssignments
    ) {
      const postedTarget =
        replacementByReserve.get(
          driverId,
        );


      if (
        !postedTarget ||
        Number(
          postedTarget
            .driver.id,
        ) !==
          Number(
            locked
              .ReplacementForDriverId,
          )
      ) {
        throw new Error(
          `Ersatzfahrer ${
            locked.driver
              ?.name ||
            driverId
          } ist bereits in der Anwesenheit bestätigt. Die Zuordnung muss zuerst über eine ausdrückliche Anwesenheitskorrektur zurückgesetzt werden.`,
        );
      }
    }


    /*
     * =====================================================
     * DATENSÄTZE AUFBAUEN
     * =====================================================
     */

    const records = [];


    /*
     * -----------------------------------------------------
     * STAMMFAHRER
     * -----------------------------------------------------
     */

    regularRows.forEach(
      (
        row,
        index,
      ) => {
        const driverId =
          Number(
            row.driver.id,
          );


        const input =
          regularInputFor(
            driverId,
          );


        const existing =
          existingByDriver.get(
            driverId,
          );


        const status =
          bannedDriverIds.has(
            driverId,
          )
            ? "rennsperre"

            : input.status
              ? normalizeRegularStatus(
                  input.status,
                )

              : existing
                  ?.status
                ? normalizeRegularStatus(
                    existing.status,
                  )

                : "anwesend";


        records.push({
          GrandPrixResultId:
            race.id,

          DriverId:
            driverId,

          TeamId:
            row.team.id,

          ReplacementForDriverId:
            null,

          roleType:
            "regular",

          status,

          sortOrder:
            index,
        });
      },
    );


    /*
     * -----------------------------------------------------
     * ERSATZFAHRER
     * -----------------------------------------------------
     */

    reserves.forEach(
      (
        driver,
        index,
      ) => {
        const driverId =
          Number(
            driver.id,
          );


        const input =
          reserveInputFor(
            driverId,
          );


        const existing =
          existingReserveByDriver.get(
            driverId,
          );


        const replacement =
          replacementByReserve.get(
            driverId,
          );


        /*
         * Status darf NICHT bei fehlendem
         * POST-Wert auf Default springen.
         */

        let submittedStatus;

        if (
          input.status
        ) {
          submittedStatus =
            normalizeReserveStatus(
              input.status,
            );
        } else if (
          existing?.status
        ) {
          submittedStatus =
            normalizeReserveStatus(
              existing.status,
            );
        } else {
          submittedStatus =
            "anwesend";
        }


        /*
         * Regel:
         *
         * Ersatzfahrer = ANWESEND
         * aber ohne Cockpit
         *
         * => nach Speichern AUF ABRUF.
         *
         * Alle anderen expliziten Status
         * bleiben exakt erhalten.
         */

        const finalStatus =
          !replacement &&
          submittedStatus ===
            "anwesend"
            ? "auf_abruf"
            : submittedStatus;


        records.push({
          GrandPrixResultId:
            race.id,

          DriverId:
            driverId,

          ReplacementForDriverId:
            replacement
              ? Number(
                  replacement
                    .driver.id,
                )
              : null,

          TeamId:
            replacement
              ? replacement
                  .team.id
              : null,

          roleType:
            "reserve",

          status:
            finalStatus,

          sortOrder:
            index,
        });
      },
    );


    /*
     * =====================================================
     * SICHERHEITSPRÜFUNGEN
     * =====================================================
     */

    const driverIds =
      records.map(
        (record) =>
          Number(
            record.DriverId,
          ),
      );


    if (
      new Set(
        driverIds,
      ).size !==
      driverIds.length
    ) {
      throw new Error(
        "Ein Fahrer darf in diesem Rennwochenende nur einmal eingeplant werden.",
      );
    }


    const targetIds =
      records
        .map(
          (record) =>
            Number(
              record
                .ReplacementForDriverId ||
                0,
            ),
        )
        .filter(Boolean);


    if (
      new Set(
        targetIds,
      ).size !==
      targetIds.length
    ) {
      throw new Error(
        "Ein Stammfahrerplatz darf in diesem Rennwochenende nur einmal ersetzt werden.",
      );
    }


    /*
     * =====================================================
     * TRANSAKTION
     * =====================================================
     */

    await sequelize.transaction(
      async (
        transaction,
      ) => {
        const currentByDriver =
          new Map(
            existingEntries.map(
              (entry) => [
                Number(
                  entry.DriverId,
                ),

                entry,
              ],
            ),
          );


        for (
          const record of
          records
        ) {
          const existing =
            currentByDriver.get(
              Number(
                record.DriverId,
              ),
            );


          if (existing) {
            /*
             * Anwesenheit nur behalten,
             * wenn die operative Planung
             * wirklich unverändert ist.
             */

            const assignmentUnchanged =
              existing.roleType ===
                record.roleType &&
              Number(
                existing.TeamId ||
                  0,
              ) ===
                Number(
                  record.TeamId ||
                    0,
                ) &&
              Number(
                existing
                  .ReplacementForDriverId ||
                  0,
              ) ===
                Number(
                  record
                    .ReplacementForDriverId ||
                    0,
                ) &&
              existing.status ===
                record.status;


            await existing.update(
              {
                ...record,


                /*
                 * Keine relevante Änderung:
                 * Schritt 2 bleibt erhalten.
                 */

                ...(assignmentUnchanged
                  ? {
                      attendanceStatus:
                        existing
                          .attendanceStatus,

                      includeInResults:
                        existing
                          .includeInResults,

                      uncertainPresent:
                        existing
                          .uncertainPresent,

                      respondedInTime:
                        existing
                          .respondedInTime,
                    }


                  /*
                   * Planung geändert:
                   * Anwesenheit für genau diesen
                   * Fahrer erneut prüfen.
                   */

                  : {
                      attendanceStatus:
                        null,

                      includeInResults:
                        false,

                      uncertainPresent:
                        null,

                      respondedInTime:
                        null,
                    }),
              },

              {
                transaction,
              },
            );
          } else {
            /*
             * Komplett neuer Eintrag.
             */

            await F1RaceLineupEntry.create(
              {
                ...record,

                attendanceStatus:
                  null,

                includeInResults:
                  false,

                uncertainPresent:
                  null,

                respondedInTime:
                  null,
              },

              {
                transaction,
              },
            );
          }
        }


        /*
         * Alte Einträge entfernen, die nicht
         * mehr Bestandteil der aktuellen
         * Saison-Aufstellung sind.
         *
         * Das verhindert Geisterfahrer nach
         * Fahrer-/Roster-Änderungen.
         */

        const expectedDriverIds =
          new Set(
            records.map(
              (record) =>
                Number(
                  record.DriverId,
                ),
            ),
          );


        for (
          const existing of
          existingEntries
        ) {
          if (
            expectedDriverIds.has(
              Number(
                existing.DriverId,
              ),
            )
          ) {
            continue;
          }


          /*
           * Bereits bestätigten Starter nicht
           * stillschweigend löschen.
           */

          if (
            existing
              .includeInResults ===
              true &&
            [
              "anwesend",
              "zu_spaet_vorbesprechung",
            ].includes(
              existing
                .attendanceStatus,
            )
          ) {
            throw new Error(
              `${
                existing.driver
                  ?.name ||
                "Ein Fahrer"
              } wurde bereits in der Anwesenheit bestätigt und kann nicht durch Speichern der Aufstellung entfernt werden.`,
            );
          }


          await existing.destroy({
            transaction,
          });
        }
      },
    );


    /*
     * =====================================================
     * ERFOLG
     * =====================================================
     */

    req.session.flash = {
      type:
        "success",

      message:
        `${race.title}: Stamm- und Ersatzfahrer wurden gespeichert.`,
    };
  } catch (error) {
    req.session.flash = {
      type:
        "error",

      message:
        error.message,
    };
  }


  /*
   * =====================================================
   * ZURÜCK ZUR RICHTIGEN ANSICHT
   * =====================================================
   */

  return res.redirect(
    req.body._return ===
      "race-control"

      ? (
          `/admin/race-weekend/f1` +
          `?league=${race.LeagueId}` +
          `&season=${race.SeasonId}` +
          `&race=${race.id}` +
          `#aufstellung`
        )

      : (
          `/admin/f1-race-lineup` +
          `?league=${race.LeagueId}` +
          `&race=${race.id}`
        ),
  );
};


/*
 * Wird vom raceWeekendController verwendet.
 */

module.exports.loadPlanningRows =
  loadPlanningRows;

