const { Op } = require("sequelize");

const {
  sequelize,
  League,
  Season,
  RaceEvent,
  GrandPrixResult,
  GrandPrixResultEntry,
  F1RaceLineupEntry,
  Driver,
  PenaltyRule,
  PenaltyEntry,
} = require("../models");

const {
  ATTENDANCE_STATUSES,
  REGULAR_STATUSES,
  RESERVE_STATUSES,
  normalizeAttendanceStatus,
} = require("../services/raceLineup");

const {
  loadSeasonStructure,
} = require("../services/f1Season");

const f1RaceLineupController =
  require("./f1RaceLineupController");


/*
 * =========================================================
 * ANWESENHEITS- / STRAFLOGIK
 * =========================================================
 */

const attendanceReason = {
  unabgemeldet: "Unabgemeldet",
  zu_spaet_abgemeldet: "Zu spät abgemeldet",
  zu_spaet_vorbesprechung: "Zu spät Vorbesprechung",
};

const ruleStatus = {
  unabgemeldet: "unabgemeldet",
  zu_spaet_abgemeldet: "late-cancellation",
  zu_spaet_vorbesprechung: "late-briefing",
};


/*
 * =========================================================
 * AUTOMATISCHE ANWESENHEITSSTRAFE
 * =========================================================
 */

async function syncAutomaticAttendancePenalty({
  race,
  entry,
  attendanceStatus,
  ruleByStatus,
  transaction,
}) {
  const automaticReason =
    attendanceReason[attendanceStatus];

  const rule =
    ruleByStatus.get(
      ruleStatus[attendanceStatus],
    );

  const existingAutomatic =
    await PenaltyEntry.findOne({
      where: {
        GrandPrixResultId: race.id,
        DriverId: entry.DriverId,
        isAutomatic: true,
      },

      transaction,
    });


  if (
    automaticReason &&
    rule &&
    Number(rule.points) > 0
  ) {
    const date =
      race.raceDate ||
      new Date()
        .toISOString()
        .slice(0, 10);

    const expiry =
      new Date(
        `${date}T12:00:00Z`,
      );

    expiry.setUTCFullYear(
      expiry.getUTCFullYear() + 1,
    );

    const values = {
      LeagueId: race.LeagueId,
      DriverId: entry.DriverId,
      GrandPrixResultId: race.id,

      points: rule.points,

      reason:
        automaticReason,

      comment:
        `${race.title} · automatisch aus Anwesenheitskontrolle`,

      awardedOn:
        date,

      expiresOn:
        expiry
          .toISOString()
          .slice(0, 10),

      isAutomatic: true,
      isRaceBan: false,
    };


    if (existingAutomatic) {
      await existingAutomatic.update(
        values,
        {
          transaction,
        },
      );
    } else {
      await PenaltyEntry.create(
        values,
        {
          transaction,
        },
      );
    }

    return;
  }


  /*
   * Keine automatische Strafe mehr nötig.
   */
  if (existingAutomatic) {
    await existingAutomatic.destroy({
      transaction,
    });
  }
}


/*
 * =========================================================
 * F1-DATEN LADEN
 * =========================================================
 */

async function loadF1Data(
  query = {},
) {
  /*
   * LIGEN
   */

  const leagues =
    await League.findAll({
      where: {
        type: "f1",

        slug: {
          [Op.in]: [
            "freitag",
            "samstag",
            "sonntag",
          ],
        },
      },

      order: [
        ["sortOrder", "ASC"],
        ["id", "ASC"],
      ],
    });


  const league =
    leagues.find(
      (item) =>
        Number(item.id) ===
        Number(query.league),
    ) ||
    leagues[0] ||
    null;


  /*
   * SAISON
   */

  const seasons =
    league
      ? await Season.findAll({
          where: {
            scopeSlug:
              league.slug,

            leagueType:
              "f1",

            status:
              "active",

            isPublished:
              true,
          },

          order: [
            ["id", "DESC"],
          ],
        })
      : [];


  const season =
    seasons.find(
      (item) =>
        Number(item.id) ===
        Number(query.season),
    ) ||
    seasons[0] ||
    null;


  /*
   * RENNEN
   */

  const events =
    season
      ? await RaceEvent.findAll({
          where: {
            LeagueId:
              league.id,

            SeasonId:
              season.id,
          },

          include: [
            {
              association:
                "grandPrixResult",
            },
          ],

          order: [
            ["sortOrder", "ASC"],
            ["startsAt", "ASC"],
          ],
        })
      : [];


  const event =
    events.find(
      (item) =>
        Number(item.id) ===
        Number(query.event),
    ) ||
    events.find(
      (item) =>
        Number(
          item.GrandPrixResultId,
        ) ===
        Number(query.race),
    ) ||
    events[0] ||
    null;


  const race =
    event?.grandPrixResult ||
    (
      event?.GrandPrixResultId
        ? await GrandPrixResult.findByPk(
            event.GrandPrixResultId,
          )
        : null
    );


  /*
   * LINE-UP + SAISONSTRUKTUR
   */

  const [
    entries,
    structure,
  ] = await Promise.all([
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
            ["roleType", "ASC"],
            ["sortOrder", "ASC"],
            ["id", "ASC"],
          ],
        })
      : [],

    season
      ? loadSeasonStructure(
          season.id,
        )
      : {
          teams: [],
          unassignedDrivers: [],
        },
  ]);


  /*
   * SAISONTEAM JE STAMMFAHRER
   */

  const seasonTeamByDriver =
    new Map();


  structure.teams?.forEach(
    (team) => {
      team.drivers.forEach(
        (driver) => {
          seasonTeamByDriver.set(
            Number(driver.id),
            team,
          );
        },
      );
    },
  );


  /*
   * STAMMFAHRER LOOKUP
   */

  const regularById =
    new Map(
      entries
        .filter(
          (entry) =>
            entry.roleType ===
            "regular",
        )
        .map(
          (entry) => [
            Number(entry.DriverId),
            entry,
          ],
        ),
    );


  /*
   * VORGEMERKTER ERSATZ PRO STAMMFAHRER
   */

  const replacementByRegular =
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
              entry
                .ReplacementForDriverId,
            ),
            entry,
          ],
        ),
    );


  /*
   * =====================================================
   * NORMALE ANWESENHEITSKONTROLLE
   * =====================================================
   *
   * WICHTIG:
   *
   * abgemeldet
   * -> wurde bereits in Schritt 1 entschieden
   * -> nicht hier anzeigen
   *
   * rennsperre
   * -> kein Teilnehmer
   *
   * unsicher
   * -> bleibt sichtbar
   * -> "Fehlende Rückmeldung"
   *
   * unabgemeldet / zu spät abgemeldet
   * -> nach Speicherung aus Hauptansicht entfernen
   */

  const attendanceRows =
    entries
      .filter(
        (entry) => {
          /*
           * STAMMFAHRER
           */

          if (
            entry.roleType ===
            "regular"
          ) {
            if (
              entry.status ===
              "unsicher"
            ) {
              return true;
            }

            if (
              [
                "abgemeldet",
                "rennsperre",
              ].includes(
                entry.status,
              )
            ) {
              return false;
            }

            const effectiveStatus =
              entry.attendanceStatus ||
              entry.status;

            return [
              "anwesend",
              "zu_spaet_vorbesprechung",
            ].includes(
              effectiveStatus,
            );
          }


          /*
           * ERSATZFAHRER
           */

          if (
            entry.roleType ===
              "reserve" &&
            entry.ReplacementForDriverId
          ) {
            const regular =
              regularById.get(
                Number(
                  entry
                    .ReplacementForDriverId,
                ),
              );


            /*
             * Bei unsicherem Stammfahrer
             * wird der vorgemerkte Ersatz
             * innerhalb desselben Unsicher-Falls behandelt.
             */
            if (
              regular?.status ===
              "unsicher"
            ) {
              return false;
            }


            const effectiveStatus =
              entry.attendanceStatus ||
              entry.status;


            return [
              "anwesend",
              "zu_spaet_vorbesprechung",
            ].includes(
              effectiveStatus,
            );
          }


          return false;
        },
      )
      .map(
        (entry) => {
          const regularDriverId =
            entry.roleType ===
            "regular"
              ? Number(
                  entry.DriverId,
                )
              : Number(
                  entry
                    .ReplacementForDriverId,
                );


          const plannedReplacement =
            entry.roleType ===
              "regular" &&
            entry.status ===
              "unsicher"
              ? replacementByRegular.get(
                  Number(
                    entry.DriverId,
                  ),
                ) || null
              : null;


          return {
            entry,

            displayTeam:
              seasonTeamByDriver.get(
                regularDriverId,
              ) ||
              entry.team,

            plannedReplacement,
          };
        },
      );


  /*
   * =====================================================
   * AUSGESCHIEDENE FAHRER / KORREKTUR
   * =====================================================
   */

  const excludedAttendanceRows =
    entries
      .filter(
        (entry) =>
          [
            "unabgemeldet",
            "zu_spaet_abgemeldet",
          ].includes(
            entry.attendanceStatus,
          ),
      )
      .map(
        (entry) => {
          const regularDriverId =
            entry.roleType ===
            "regular"
              ? Number(
                  entry.DriverId,
                )
              : Number(
                  entry
                    .ReplacementForDriverId,
                );


          const currentReplacement =
            entries.find(
              (candidate) =>
                candidate.roleType ===
                  "reserve" &&
                Number(
                  candidate
                    .ReplacementForDriverId,
                ) ===
                  Number(
                    entry.DriverId,
                  ),
            ) || null;


          return {
            entry,

            displayTeam:
              seasonTeamByDriver.get(
                regularDriverId,
              ) ||
              entry.team,

            currentReplacement,
          };
        },
      );


  /*
   * =====================================================
   * VERFÜGBARE ERSATZFAHRER
   * =====================================================
   *
   * Wichtig:
   *
   * Ein nur VORGEMERKTER Ersatz eines unsicheren
   * Stammfahrers gilt zunächst weiterhin als verfügbar.
   *
   * Erst wenn in Schritt 2 tatsächlich:
   *
   * "Ersatz übernimmt"
   *
   * entschieden wird, wird dieser Fahrer gebunden.
   */

  const availableReplacements =
    entries
      .filter(
        (entry) => {
          if (
            entry.roleType !==
              "reserve" ||
            ![
              "anwesend",
              "unsicher",
              "auf_abruf",
            ].includes(
              entry.status,
            )
          ) {
            return false;
          }


          /*
           * Komplett frei.
           */
          if (
            !entry
              .ReplacementForDriverId
          ) {
            return true;
          }


          /*
           * Nur vorgemerkt für unsicheren Stammfahrer.
           */
          const regular =
            regularById.get(
              Number(
                entry
                  .ReplacementForDriverId,
              ),
            );


          return (
            regular?.status ===
            "unsicher"
          );
        },
      )
      .map(
        (entry) => ({
          id:
            entry.driver.id,

          name:
            entry.driver.name,

          plannedForDriverId:
            entry
              .ReplacementForDriverId
              ? Number(
                  entry
                    .ReplacementForDriverId,
                )
              : null,

          entryId:
            Number(entry.id),
        }),
      );


  return {
    leagues,
    league,
    seasons,
    season,
    events,
    event,
    race,
    entries,
    attendanceRows,
    excludedAttendanceRows,
    availableReplacements,
  };
}


/*
 * =========================================================
 * SEITE ANZEIGEN
 * =========================================================
 */

exports.show = async (
  req,
  res,
) => {
  if (
    req.params.discipline !==
    "f1"
  ) {
    req.session.flash = {
      type:
        "error",

      message:
        "Der neue Rennwochenenden-Assistent ist zunächst für Formel 1 verfügbar.",
    };


    return res.redirect(
      "/admin",
    );
  }


  const data =
    await loadF1Data(
      req.query,
    );


  const planning =
    data.league &&
    data.race
      ? await f1RaceLineupController.loadPlanningRows(
          data.league,
          data.race,
        )
      : {
          teamCards: [],
          reserveRows: [],
          hasSavedPlan: false,
        };


  const resultCount =
    data.race
      ? await GrandPrixResultEntry.count({
          where: {
            GrandPrixResultId:
              data.race.id,
          },
        })
      : 0;


  const lineupHref =
    `/admin/f1-race-lineup?league=${data.league?.id || ""}&race=${data.race?.id || ""}`;


  const resultsHref =
    `/admin/current-season-progress?league=${data.league?.id || ""}&race=${data.race?.id || ""}`;


  return res.render(
    "admin/race-weekend",
    {
      title:
        "Rennwochenende Formel 1",

      requested:
        "f1",

      ...data,

      attendanceStatuses:
        ATTENDANCE_STATUSES,

      regularStatuses:
        REGULAR_STATUSES,

      reserveStatuses:
        RESERVE_STATUSES,

      selectedRace:
        data.race,

      resultCount,

      ...planning,

      lineupHref,
      resultsHref,
    },
  );
};


/*
 * =========================================================
 * ANWESENHEIT SPEICHERN
 * =========================================================
 */

exports.saveAttendance = async (
  req,
  res,
) => {
  /*
   * RENNEN LADEN
   */

  const race =
    await GrandPrixResult.findByPk(
      Number(
        req.params.raceId,
      ),
      {
        include: [
          {
            association:
              "seasonRecord",
          },
          {
            association:
              "league",
          },
        ],
      },
    );


  if (
    !race ||
    race.discipline !==
      "f1" ||
    race.seasonRecord?.status !==
      "active"
  ) {
    throw new Error(
      "Aktuelles Formel-1-Rennen wurde nicht gefunden.",
    );
  }


  /*
   * LINE-UP LADEN
   */

  const entries =
    await F1RaceLineupEntry.findAll({
      where: {
        GrandPrixResultId:
          race.id,
      },
    });


  /*
   * FORMULARDATEN
   */

  const input =
    req.body.attendance ||
    {};

  const correctionInput =
    req.body.correction ||
    {};

  const uncertainPresentInput =
    req.body
      .uncertainPresent ||
    {};

  const uncertainDecisionInput =
    req.body
      .uncertainDecision ||
    {};


  /*
   * =====================================================
   * UNSICHER-ENTSCHEIDUNG
   * =====================================================
   *
   * Werte:
   *
   * unresolved
   * regular
   * replacement
   */

  const uncertainDecisionFor =
    (entry) => {
      const posted =
        uncertainDecisionInput[
          `d${entry.id}`
        ];


      if (
        [
          "regular",
          "replacement",
          "unresolved",
        ].includes(
          posted,
        )
      ) {
        return posted;
      }


      /*
       * Legacy-Fallback.
       */
      if (
        uncertainPresentInput[
          `d${entry.id}`
        ] === "on"
      ) {
        return "regular";
      }


      return "unresolved";
    };


  /*
   * STRAFREGELN
   */

  const rules =
    await PenaltyRule.findAll({
      where: {
        discipline:
          "f1",
      },
    });


  const ruleByStatus =
    new Map(
      rules.map(
        (rule) => [
          rule.status,
          rule,
        ],
      ),
    );


  /*
   * STAMMFAHRER LOOKUP
   */

  const regularEntriesByDriverId =
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


  /*
   * UNSICHERE STAMMFAHRER
   */

  const regularUncertainEntries =
    entries.filter(
      (entry) =>
        entry.roleType ===
          "regular" &&
        entry.status ===
          "unsicher",
    );


  /*
   * =====================================================
   * ALLE UNSICHEREN MÜSSEN GEKLÄRT SEIN
   * =====================================================
   */

  const unresolvedEntries =
    regularUncertainEntries.filter(
      (entry) =>
        uncertainDecisionFor(
          entry,
        ) ===
        "unresolved",
    );


  if (
    unresolvedEntries.length
  ) {
    req.session.flash = {
      type: "error",

      message:
        `${unresolvedEntries.length} unsichere Teilnahme(n) besitzen noch eine fehlende Rückmeldung.`,
    };


    return res.redirect(
      `/admin/race-weekend/f1?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}#anwesenheit`,
    );
  }


  /*
   * =====================================================
   * ERSATZFAHRER VERFÜGBARKEIT
   * =====================================================
   */

  const allowedReplacementIds =
    new Set();


  const releasedPlannedReplacementIds =
    new Set();


  for (
    const reserveEntry
    of entries
  ) {
    if (
      reserveEntry.roleType !==
        "reserve" ||
      ![
        "anwesend",
        "unsicher",
        "auf_abruf",
      ].includes(
        reserveEntry.status,
      )
    ) {
      continue;
    }


    /*
     * Komplett frei.
     */
    if (
      !reserveEntry
        .ReplacementForDriverId
    ) {
      allowedReplacementIds.add(
        Number(
          reserveEntry.DriverId,
        ),
      );

      continue;
    }


    /*
     * Vorgemerkt für unsicheren Stammfahrer.
     */
    const regularEntry =
      regularEntriesByDriverId.get(
        Number(
          reserveEntry
            .ReplacementForDriverId,
        ),
      );


    if (
      !regularEntry ||
      regularEntry.status !==
        "unsicher"
    ) {
      continue;
    }


    const decision =
      uncertainDecisionFor(
        regularEntry,
      );


    /*
     * Solange nur vorgemerkt:
     * weiterhin frei.
     */
    if (
      decision ===
      "unresolved"
    ) {
      allowedReplacementIds.add(
        Number(
          reserveEntry.DriverId,
        ),
      );

      continue;
    }


    /*
     * Stammfahrer fährt:
     * Ersatz komplett freigeben.
     */
    if (
      decision ===
      "regular"
    ) {
      allowedReplacementIds.add(
        Number(
          reserveEntry.DriverId,
        ),
      );


      releasedPlannedReplacementIds.add(
        Number(
          reserveEntry.DriverId,
        ),
      );
    }


    /*
     * decision === replacement
     *
     * Nicht in allowedReplacementIds aufnehmen.
     * Er ist jetzt fest für dieses Cockpit vorgesehen.
     */
  }


  const usedReplacementIds =
    new Set();


  const inactiveUncertainEntryIds =
    new Set();


  /*
   * =====================================================
   * TRANSACTION
   * =====================================================
   */

  await sequelize.transaction(
    async (transaction) => {
      /*
       * =================================================
       * 0. KORREKTUREN
       * =================================================
       */

      for (
        const entry
        of entries
      ) {
        const correction =
          correctionInput[
            `d${entry.id}`
          ];


        if (!correction) {
          continue;
        }


        const newAttendanceStatus =
          normalizeAttendanceStatus(
            correction.status,
          );


        const mayStartAgain =
          [
            "anwesend",
            "zu_spaet_vorbesprechung",
          ].includes(
            newAttendanceStatus,
          );


        await entry.update(
          {
            attendanceStatus:
              newAttendanceStatus,

            includeInResults:
              mayStartAgain,
          },
          {
            transaction,
          },
        );


        /*
         * Fahrer wird wieder aktiv.
         */
        if (mayStartAgain) {
          const replacements =
            entries.filter(
              (candidate) =>
                candidate.roleType ===
                  "reserve" &&
                Number(
                  candidate
                    .ReplacementForDriverId,
                ) ===
                  Number(
                    entry.DriverId,
                  ),
            );


          for (
            const replacement
            of replacements
          ) {
            await replacement.update(
              {
                ReplacementForDriverId:
                  null,

                TeamId:
                  null,

                attendanceStatus:
                  null,

                includeInResults:
                  false,
              },
              {
                transaction,
              },
            );
          }
        }


        await syncAutomaticAttendancePenalty({
          race,
          entry,

          attendanceStatus:
            newAttendanceStatus,

          ruleByStatus,
          transaction,
        });
      }


      /*
       * =================================================
       * 1. UNSICHERE STAMMFAHRER AUFLÖSEN
       * =================================================
       */

      for (
        const regularEntry
        of regularUncertainEntries
      ) {
        const decision =
          uncertainDecisionFor(
            regularEntry,
          );


        if (
          decision ===
          "unresolved"
        ) {
          throw new Error(
            "Eine fehlende Rückmeldung wurde noch nicht geklärt.",
          );
        }


        const plannedReplacement =
          entries.find(
            (candidate) =>
              candidate.roleType ===
                "reserve" &&
              Number(
                candidate
                  .ReplacementForDriverId,
              ) ===
                Number(
                  regularEntry.DriverId,
                ),
          );


        /*
         * Kein vorgemerkter Ersatz.
         * Der Stammfahrer wird normal über
         * attendance[...] verarbeitet.
         */
        if (
          !plannedReplacement
        ) {
          continue;
        }


        const regularTakesSeat =
          decision ===
          "regular";


        const inactiveEntry =
          regularTakesSeat
            ? plannedReplacement
            : regularEntry;


        inactiveUncertainEntryIds.add(
          Number(
            inactiveEntry.id,
          ),
        );


        /*
         * Nicht eingesetzter Fahrer
         * kommt nicht ins Ergebnis.
         */
        await inactiveEntry.update(
          {
            attendanceStatus:
              null,

            includeInResults:
              false,
          },
          {
            transaction,
          },
        );


        await PenaltyEntry.destroy({
          where: {
            GrandPrixResultId:
              race.id,

            DriverId:
              inactiveEntry.DriverId,

            isAutomatic:
              true,
          },

          transaction,
        });


        /*
         * Wenn Stammfahrer selbst fährt,
         * vorgemerkte Reserve-Zuordnung lösen.
         *
         * Dadurch kann der Ersatz spontan
         * ein anderes Cockpit übernehmen.
         */
        if (
          regularTakesSeat
        ) {
          await plannedReplacement.update(
            {
              ReplacementForDriverId:
                null,

              TeamId:
                null,

              attendanceStatus:
                null,

              includeInResults:
                false,
            },
            {
              transaction,
            },
          );
        }
      }


      /*
       * =================================================
       * 2. NORMALE ANWESENHEIT
       * =================================================
       */

      for (
        const entry
        of entries
      ) {
        if (
          inactiveUncertainEntryIds.has(
            Number(entry.id),
          )
        ) {
          continue;
        }


        const row =
          input[
            `d${entry.id}`
          ];


        if (!row) {
          continue;
        }


        const attendanceStatus =
          normalizeAttendanceStatus(
            row.status,
          );


        /*
         * Schritt 2 akzeptiert hier nur:
         *
         * anwesend
         * zu spät Vorbesprechung
         * unabgemeldet / nicht erschienen
         * zu spät abgemeldet
         */

        if (
          ![
            "anwesend",
            "zu_spaet_vorbesprechung",
            "unabgemeldet",
            "zu_spaet_abgemeldet",
          ].includes(
            attendanceStatus,
          )
        ) {
          throw new Error(
            "Ungültiger Status in der Anwesenheitskontrolle.",
          );
        }


        const mayStart =
          [
            "anwesend",
            "zu_spaet_vorbesprechung",
          ].includes(
            attendanceStatus,
          );


        await entry.update(
          {
            attendanceStatus,

            includeInResults:
              mayStart,
          },
          {
            transaction,
          },
        );


        await syncAutomaticAttendancePenalty({
          race,
          entry,
          attendanceStatus,
          ruleByStatus,
          transaction,
        });


        /*
         * =================================================
         * 3. SPONTANER ERSATZ
         * =================================================
         */

        const replacementId =
          Number(
            row
              .ReplacementDriverId ||
              0,
          );


        if (!replacementId) {
          continue;
        }


        /*
         * Nur:
         *
         * nicht erschienen
         * zu spät abgemeldet
         */
        if (
          ![
            "unabgemeldet",
            "zu_spaet_abgemeldet",
          ].includes(
            attendanceStatus,
          )
        ) {
          throw new Error(
            "Ein spontaner Ersatz ist nur bei „Nicht erschienen“ oder „Zu spät abgemeldet“ möglich.",
          );
        }


        if (
          !allowedReplacementIds.has(
            replacementId,
          ) ||
          usedReplacementIds.has(
            replacementId,
          )
        ) {
          throw new Error(
            "Der gewählte Ersatzfahrer ist nicht verfügbar oder bereits zugeteilt.",
          );
        }


        const replacement =
          await Driver.findByPk(
            replacementId,
            {
              transaction,
            },
          );


        if (!replacement) {
          throw new Error(
            "Ersatzfahrer wurde nicht gefunden.",
          );
        }


        usedReplacementIds.add(
          replacementId,
        );


        /*
         * Bereits vorhandener Ersatz
         * für dieses Cockpit?
         */

        const existingTargetReplacement =
          entries.find(
            (candidate) =>
              candidate.roleType ===
                "reserve" &&
              Number(
                candidate
                  .ReplacementForDriverId,
              ) ===
                Number(
                  entry.DriverId,
                ) &&
              Number(
                candidate.DriverId,
              ) !==
                replacementId,
          );


        if (
          existingTargetReplacement
        ) {
          throw new Error(
            "Für dieses Cockpit ist bereits ein anderer Ersatzfahrer eingeteilt.",
          );
        }


        const existingReserve =
          entries.find(
            (candidate) =>
              Number(
                candidate.DriverId,
              ) ===
              replacementId,
          );


        const replacementValues = {
          ReplacementForDriverId:
            entry.DriverId,

          TeamId:
            entry.TeamId,

          roleType:
            "reserve",

          status:
            "anwesend",

          attendanceStatus:
            "anwesend",

          includeInResults:
            true,

          sortOrder:
            entries.length +
            usedReplacementIds.size,
        };


        if (existingReserve) {
          /*
           * Ist der Ersatz noch einem anderen
           * Cockpit zugeordnet?
           */

          if (
            existingReserve
              .ReplacementForDriverId &&
            Number(
              existingReserve
                .ReplacementForDriverId,
            ) !==
              Number(
                entry.DriverId,
              )
          ) {
            const mayBeReassigned =
              releasedPlannedReplacementIds.has(
                Number(
                  existingReserve.DriverId,
                ),
              );


            if (!mayBeReassigned) {
              throw new Error(
                "Der Ersatzfahrer ist bereits einem anderen Cockpit zugeteilt.",
              );
            }
          }


          await existingReserve.update(
            replacementValues,
            {
              transaction,
            },
          );
        } else {
          await F1RaceLineupEntry.create(
            {
              GrandPrixResultId:
                race.id,

              DriverId:
                replacement.id,

              ...replacementValues,
            },
            {
              transaction,
            },
          );
        }
      }
    },
  );


  /*
   * ERFOLG
   */

  req.session.flash = {
    type:
      "success",

    message:
      Object.keys(
        correctionInput,
      ).length
        ? "Anwesenheitskorrekturen wurden gespeichert."
        : "Anwesenheitskontrolle wurde gespeichert. Die tatsächlichen Starter wurden automatisch für die Ergebnisse übernommen.",
  };


  return res.redirect(
    `/admin/race-weekend/f1?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}#anwesenheit`,
  );
};


module.exports.loadF1Data =
  loadF1Data;