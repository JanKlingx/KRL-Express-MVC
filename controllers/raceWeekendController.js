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
const f1RaceLineupController = require("./f1RaceLineupController");


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
 * AUTOMATISCHE ANWESENHEITSSTRAFE AKTUALISIEREN
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
        GrandPrixResultId:
          race.id,

        DriverId:
          entry.DriverId,

        isAutomatic:
          true,
      },

      transaction,
    });


  /*
   * Strafstatus mit Punkte-Regel
   */
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
      LeagueId:
        race.LeagueId,

      DriverId:
        entry.DriverId,

      GrandPrixResultId:
        race.id,

      points:
        rule.points,

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

      isAutomatic:
        true,

      isRaceBan:
        false,
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
   * Keine automatische Strafe mehr nötig
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

async function loadF1Data(query = {}) {

  /*
   * =====================================================
   * LIGEN
   * =====================================================
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
   * =====================================================
   * SAISON
   * =====================================================
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
   * =====================================================
   * RENNEN
   * =====================================================
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
   * =====================================================
   * FAHREREINTEILUNG + SAISONSTRUKTUR
   * =====================================================
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
   * =====================================================
   * SAISONTEAM JE STAMMFAHRER
   * =====================================================
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
   * =====================================================
   * STAMMFAHRER NACH DRIVER-ID
   * =====================================================
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
   * =====================================================
   * VORGEMERKTER ERSATZ JE STAMMFAHRER
   * =====================================================
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
   * REGEL:
   *
   * anwesend
   * -> anzeigen
   *
   * zu spät Vorbesprechung
   * -> anzeigen
   *
   * unabgemeldet
   * -> nach Speichern ausblenden
   *
   * zu spät abgemeldet
   * -> nach Speichern ausblenden
   *
   * unsicher
   * -> Stammfahrer bleibt sichtbar
   * -> geplanter Ersatz wird innerhalb
   *    derselben Karte behandelt
   */

  const attendanceRows =
    entries
      .filter(
        (entry) => {

          /*
           * =========================================
           * STAMMFAHRER
           * =========================================
           */

          if (
            entry.roleType ===
            "regular"
          ) {

            /*
             * Unsicher bleibt sichtbar,
             * damit Stammfahrer / Ersatz
             * gewählt werden kann.
             */
            if (
              entry.status ===
              "unsicher"
            ) {
              return true;
            }


            /*
             * Sobald Anwesenheit gespeichert
             * wurde, zählt attendanceStatus.
             */
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
           * =========================================
           * ERSATZFAHRER
           * =========================================
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
             * nicht separat anzeigen.
             *
             * Der Ersatz wird direkt
             * innerhalb der Unsicher-Karte
             * dargestellt.
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


          /*
           * Nur bei unsicherem
           * Stammfahrer den vorgemerkten
           * Ersatz an die View geben.
           */
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
   * AUSGESCHIEDENE FAHRER FÜR KORREKTUREN
   * =====================================================
   *
   * Diese Fahrer verschwinden aus der
   * normalen Kontrolle, bleiben aber
   * über "Ausgeschiedene Fahrer bearbeiten"
   * erreichbar.
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


          /*
           * Prüfen, ob dieser Fahrer
           * aktuell durch jemanden
           * ersetzt wird.
           */
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
   * Freie Ersatzfahrer:
   *
   * - anwesend
   * - unsicher
   * - auf Abruf
   *
   * Außerdem:
   * Ersatzfahrer, die nur vorsorglich einem
   * unsicheren Stammfahrer zugeteilt sind.
   *
   * Ob sie tatsächlich frei sind,
   * entscheidet die Checkbox in Schritt 2.
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
           * Komplett freier Ersatzfahrer.
           */
          if (
            !entry
              .ReplacementForDriverId
          ) {
            return true;
          }


          /*
           * Vorsorglich eingeteilter
           * Ersatz eines unsicheren
           * Stammfahrers.
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

  const planning = data.league && data.race
    ? await f1RaceLineupController.loadPlanningRows(data.league, data.race)
    : { teamCards: [], reserveRows: [], hasSavedPlan: false };
  const resultCount = data.race
    ? await GrandPrixResultEntry.count({ where: { GrandPrixResultId: data.race.id } })
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

      regularStatuses: REGULAR_STATUSES,
      reserveStatuses: RESERVE_STATUSES,
      selectedRace: data.race,
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
   * =====================================================
   * RENNEN LADEN
   * =====================================================
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
   * =====================================================
   * LINEUP LADEN
   * =====================================================
   */

  const entries =
    await F1RaceLineupEntry.findAll({
      where: {
        GrandPrixResultId:
          race.id,
      },
    });


  /*
   * =====================================================
   * FORMULARDATEN
   * =====================================================
   *
   * Normale Anwesenheit:
   *
   * attendance[d123][status]
   *
   * Korrektur:
   *
   * correction[d123][status]
   *
   * Unsicher:
   *
   * uncertainPresent[d123] = on
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

  const unresolvedAttendance = Object.values(input)
    .filter((row) => row && normalizeAttendanceStatus(row.status) === "unsicher").length;
  if (unresolvedAttendance) {
    req.session.flash = {
      type: "error",
      message: `${unresolvedAttendance} Fahrer besitzen noch den Status Unsicher. Bitte vor dem Abschluss auflösen.`,
    };
    return res.redirect(
      `/admin/race-weekend/f1?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}#anwesenheit`,
    );
  }


  /*
   * =====================================================
   * STRAFREGELN
   * =====================================================
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
   * =====================================================
   * STAMMFAHRER LOOKUP
   * =====================================================
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
   * =====================================================
   * ERSATZFAHRER, DIE IN SCHRITT 2 VERFÜGBAR SIND
   * =====================================================
   */

  const allowedReplacementIds =
    new Set();


  /*
   * Ersatzfahrer, die ursprünglich
   * nur vorsorglich für einen
   * unsicheren Stammfahrer reserviert
   * waren, jetzt aber frei sind.
   */

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
     * Komplett freier Ersatzfahrer.
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
     * Vorsorgliche Zuordnung zu
     * unsicherem Stammfahrer prüfen.
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


    /*
     * Stammfahrer fährt selbst:
     * vorgemerkter Ersatz wird frei.
     */
    const regularTakesSeat =
      uncertainPresentInput[
        `d${regularEntry.id}`
      ] === "on";


    if (regularTakesSeat) {

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
  }


  /*
   * Ersatzfahrer darf nicht mehrfach
   * in derselben Speicherung
   * vergeben werden.
   */

  const usedReplacementIds =
    new Set();


  /*
   * Bei Unsicher-Auswahl wird einer
   * von beiden Teilnehmern inaktiv.
   */

  const inactiveUncertainEntryIds =
    new Set();


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
   * TRANSACTION
   * =====================================================
   */

  await sequelize.transaction(
    async (transaction) => {


      /*
       * =================================================
       * 0. KORREKTUREN AUSGESCHIEDENER FAHRER
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


        /*
         * Fahrerstatus aktualisieren.
         */
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
         * =============================================
         * FAHRER WIRD WIEDER AKTIV
         * =============================================
         *
         * Beispiel:
         *
         * V3GA war zu spät abgemeldet
         * Tobi_fro war Ersatz
         *
         * V3GA wird auf Anwesend korrigiert
         *
         * -> V3GA wieder aktiv
         * -> Tobi_fro wird wieder freigegeben
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


        /*
         * Automatische Strafpunkte
         * anhand des korrigierten
         * Status aktualisieren.
         */

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
         * Kein Ersatz vorbereitet:
         * normale Anwesenheitskontrolle.
         */
        if (!plannedReplacement) {
          continue;
        }


        /*
         * Checkbox gesetzt:
         * Stammfahrer fährt.
         *
         * Checkbox nicht gesetzt:
         * vorgemerkter Ersatz fährt.
         */
        const regularTakesSeat =
          uncertainPresentInput[
            `d${regularEntry.id}`
          ] === "on";


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


        /*
         * Eventuelle automatische
         * Anwesenheitsstrafe entfernen.
         */
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
      }


      /*
       * =================================================
       * 2. NORMALE ANWESENHEITSKONTROLLE
       * =================================================
       */

      for (
        const entry
        of entries
      ) {

        /*
         * Fahrer aus Unsicher-Fall,
         * der aktuell nicht fährt.
         */
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


        /*
         * Nicht Bestandteil dieses
         * Formulars.
         */
        if (!row) {
          continue;
        }


        const attendanceStatus =
          normalizeAttendanceStatus(
            row.status,
          );


        /*
         * Automatische Ergebnisübernahme.
         */
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


        /*
         * Automatische Strafpunkte
         */
        await syncAutomaticAttendancePenalty({
          race,
          entry,
          attendanceStatus,
          ruleByStatus,
          transaction,
        });


        /*
         * =================================================
         * 3. WEITERER ERSATZ IN SCHRITT 2
         * =================================================
         */

        const replacementId =
          Number(
            row
              .ReplacementDriverId ||
              0,
          );


        /*
         * Kein weiterer Ersatz.
         */
        if (!replacementId) {
          continue;
        }


        /*
         * Weiterer Ersatz ausschließlich:
         *
         * - unabgemeldet
         * - zu spät abgemeldet
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
            "Ein weiterer Ersatz ist nur bei „unabgemeldet“ oder „zu spät abgemeldet“ möglich.",
          );
        }


        /*
         * Verfügbarkeit prüfen.
         */
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
         * Prüfen, ob für den ausgefallenen
         * Fahrer bereits ein anderer
         * Ersatz existiert.
         */
        const existingTargetReplacement =
          entries.find(
            (candidate) =>
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
                Number(
                  replacement.id,
                ),
          );


        if (
          existingTargetReplacement
        ) {
          throw new Error(
            "Für diesen Fahrer ist bereits ein anderer Ersatz eingeteilt.",
          );
        }


        /*
         * Reserve-Entry des ausgewählten
         * Ersatzfahrers suchen.
         */
        const existingReserve =
          entries.find(
            (candidate) =>
              Number(
                candidate.DriverId,
              ) ===
              Number(
                replacement.id,
              ),
          );


        /*
         * Werte für neue Zuordnung.
         */
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


        /*
         * Vorhandener Reserve-Eintrag.
         */
        if (existingReserve) {

          /*
           * Bereits jemand anderem zugeordnet?
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

            /*
             * Nur erlaubt, wenn der Fahrer
             * vorher lediglich vorsorglicher
             * Ersatz eines unsicheren
             * Stammfahrers war und dieser
             * Stammfahrer selbst fährt.
             */
            const mayBeReassigned =
              releasedPlannedReplacementIds.has(
                Number(
                  existingReserve.DriverId,
                ),
              );


            if (!mayBeReassigned) {
              throw new Error(
                "Der Ersatzfahrer ist bereits einem anderen Fahrer zugeteilt.",
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

          /*
           * Falls kein Reserve-Eintrag
           * existiert, neu erstellen.
           */
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
   * =====================================================
   * ERFOLG
   * =====================================================
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
