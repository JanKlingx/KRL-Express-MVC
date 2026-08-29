// =========================================================
// DATENBANK IMPORT
// =========================================================

const { Op } = require("sequelize");

const {
  sequelize,
  League,
  Season,
  RaceEvent,
  GrandPrixResult,
  GrandPrixResultEntry,
  F1RaceLineupEntry,
} = require("../models");


// =========================================================
// SERVICES
// =========================================================

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


// =========================================================
// STATUSLOGIK
// =========================================================

// Diese Anwesenheitsstatus bedeuten:
// Fahrer startet tatsächlich.
const STARTING_ATTENDANCE = new Set([
  "anwesend",
  "zu_spaet_vorbesprechung",
]);


// Diese Anwesenheitsstatus bedeuten:
// Fahrer startet nicht.
const ABSENT_ATTENDANCE = new Set([
  "abgemeldet",
  "unabgemeldet",
  "zu_spaet_abgemeldet",
  "rueckmeldung_unsicher",
  "fehlende_rueckmeldung_unsicher",
]);


// Diese Ersatzfahrer dürfen grundsätzlich
// für ein Cockpit verwendet werden.
const ELIGIBLE_RESERVE_STATUS = new Set([
  "anwesend",
  "unsicher",
  "auf_abruf",
]);


// Diese Status stehen bereits in Schritt 1
// als Nichtteilnahme fest.
const PLANNED_ABSENT_STATUS = new Set([
  "abgemeldet",
  "zu_spaet_abgemeldet",
]);


// =========================================================
// DATUM / AKTUELLES RENNEN
// =========================================================

function berlinDateKey(value) {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "";
  }

  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Europe/Berlin",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      },
    ).formatToParts(
      date,
    );

  const values =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );

  return (
    `${values.year}-` +
    `${values.month}-` +
    `${values.day}`
  );
}


// =========================================================
// AKTUELLES RENNEN AUTOMATISCH AUSWÄHLEN
// =========================================================

function selectCurrentEvent(
  events,
  now = new Date(),
) {
  /*
   * Testtage gehören nicht zum
   * normalen Rennwochenende.
   */
  const normalEvents =
    events.filter(
      (event) =>
        !event.isTestDay,
    );

  if (
    !normalEvents.length
  ) {
    return null;
  }


  /*
   * Zuerst prüfen:
   * Findet heute ein Rennen statt?
   */
  const today =
    berlinDateKey(now);

  const todayEvent =
    normalEvents.find(
      (event) =>
        berlinDateKey(
          event.startsAt,
        ) === today,
    );

  if (todayEvent) {
    return todayEvent;
  }


  /*
   * Kein Rennen heute:
   * nächstes zukünftiges Rennen.
   */
  const future =
    normalEvents
      .filter(
        (event) =>
          new Date(
            event.startsAt,
          ).getTime() >
          now.getTime(),
      )
      .sort(
        (
          left,
          right,
        ) =>
          new Date(
            left.startsAt,
          ) -
          new Date(
            right.startsAt,
          ),
      );

  if (
    future.length
  ) {
    return future[0];
  }


  /*
   * Saison bereits weiter:
   * zuletzt gefahrenes Rennen.
   */
  return normalEvents
    .slice()
    .sort(
      (
        left,
        right,
      ) =>
        new Date(
          right.startsAt,
        ) -
        new Date(
          left.startsAt,
        ),
    )[0];
}


// =========================================================
// TEAM-MAPPING
// =========================================================

function displayTeamMap(
  structure,
) {
  const result =
    new Map();

  structure.teams
    ?.forEach(
      (team) => {

        team.drivers
          .forEach(
            (driver) => {

              result.set(
                Number(
                  driver.id,
                ),
                team,
              );

            },
          );

      },
    );

  return result;
}


// =========================================================
// DATEN FÜR DAS F1-RENNWOCHENENDE LADEN
// =========================================================

async function loadF1Data(
  query = {},
) {
  /*
   * =====================================================
   * LIGEN
   * =====================================================
   */

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
   * Gewählte Liga.
   *
   * Falls nichts gewählt:
   * erste F1-Liga.
   */

  const league =
    leagues.find(
      (item) =>
        Number(
          item.id,
        ) ===
        Number(
          query.league,
        ),
    ) ||
    leagues[0] ||
    null;


  /*
   * =====================================================
   * AKTIVE SAISON
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
            [
              "id",
              "DESC",
            ],
          ],
        })
      : [];


  const season =
    seasons.find(
      (item) =>
        Number(
          item.id,
        ) ===
        Number(
          query.season,
        ),
    ) ||
    seasons[0] ||
    null;


  /*
   * =====================================================
   * RENNKALENDER
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
          ],
        })
      : [];


  /*
   * =====================================================
   * RENNEN AUSWÄHLEN
   * =====================================================
   */

  const manuallySelected =
    events.find(
      (item) =>
        Number(
          item.id,
        ) ===
        Number(
          query.event,
        ),
    ) ||
    events.find(
      (item) =>
        Number(
          item.GrandPrixResultId,
        ) ===
        Number(
          query.race,
        ),
    );


  const event =
    manuallySelected ||
    selectCurrentEvent(
      events,
    ) ||
    events[0] ||
    null;


  /*
   * Das GrandPrixResult ist das
   * eigentliche Rennen für:
   *
   * - Aufstellung
   * - Anwesenheit
   * - Ergebnis
   */
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
   * AUFSTELLUNG + SAISONSTRUKTUR
   * =====================================================
   */

  const [
    entries,
    structure,
  ] =
    await Promise.all([

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


      season
        ? loadSeasonStructure(
            season.id,
            race?.sortOrder ||
            event?.sortOrder,
          )
        : {
            teams: [],
            unassignedDrivers: [],
          },

    ]);


  /*
   * =====================================================
   * TEAM-ZUORDNUNG
   * =====================================================
   */

  const teamsByDriver =
    displayTeamMap(
      structure,
    );


  /*
   * =====================================================
   * STAMMFAHRER
   * =====================================================
   */

  const regularEntries =
    entries.filter(
      (entry) =>
        entry.roleType ===
        "regular",
    );


  const regularById =
    new Map(
      regularEntries.map(
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
   * GEPLANTE ERSATZFAHRER
   * =====================================================
   */

  const replacementByRegular =
    new Map(
      entries
        .filter(
          (entry) =>
            entry.roleType ===
              "reserve" &&
            entry
              .ReplacementForDriverId,
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
   * ANWESENHEITSZEILEN
   * =====================================================
   */

  const attendanceRows =
    regularEntries.map(
      (entry) => ({
        entry,

        displayTeam:
          teamsByDriver.get(
            Number(
              entry.DriverId,
            ),
          ) ||
          entry.team,

        plannedReplacement:
          replacementByRegular.get(
            Number(
              entry.DriverId,
            ),
          ) ||
          null,
      }),
    );


  /*
   * =====================================================
   * BEREITS AUSGESCHIEDENE FAHRER
   *
   * Diese können über die
   * Korrektur-Funktion noch einmal
   * ausdrücklich bearbeitet werden.
   * =====================================================
   */

  const excludedAttendanceRows =
    entries
      .filter(
        (entry) =>
          ABSENT_ATTENDANCE.has(
            entry.attendanceStatus,
          ),
      )
      .map(
        (entry) => ({
          entry,

          displayTeam:
            teamsByDriver.get(
              Number(
                entry.roleType ===
                  "regular"
                  ? entry.DriverId
                  : entry
                      .ReplacementForDriverId,
              ),
            ) ||
            entry.team,

          currentReplacement:
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
            ) ||
            null,
        }),
      );


  /*
   * =====================================================
   * VERFÜGBARE ERSATZFAHRER
   * =====================================================
   */

  const availableReplacements =
    entries
      .filter(
        (entry) => {

          /*
           * Nur Ersatzfahrer.
           */
          if (
            entry.roleType !==
            "reserve"
          ) {
            return false;
          }


          /*
           * Status muss verwendbar sein.
           */
          if (
            !ELIGIBLE_RESERVE_STATUS
              .has(
                entry.status,
              )
          ) {
            return false;
          }


          /*
           * Bereits bestätigter Starter
           * darf nicht noch einmal
           * eingesetzt werden.
           */
          if (
            entry.includeInResults
          ) {
            return false;
          }


          /*
           * Noch keinem Cockpit zugeordnet:
           * sofort verfügbar.
           */
          if (
            !entry
              .ReplacementForDriverId
          ) {
            return true;
          }


          /*
           * Fahrer war für einen
           * UNSICHER-Fahrer eingeplant,
           * aber der Stammfahrer ist
           * inzwischen bestätigt.
           *
           * Dann darf der Ersatzfahrer
           * wieder verwendet werden.
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
              "unsicher" &&
            regular
              .uncertainPresent ===
              true
          );

        },
      )
      .map(
        (entry) => ({
          id:
            Number(
              entry.DriverId,
            ),

          entryId:
            Number(
              entry.id,
            ),

          name:
            entry.driver?.name ||
            `Fahrer ${entry.DriverId}`,

          status:
            entry.status,
        }),
      )
      .sort(
        (
          left,
          right,
        ) => {

          const rank =
            (status) =>
              status ===
                "auf_abruf"
                ? 0
                : status ===
                    "anwesend"
                  ? 1
                  : 2;


          return (
            rank(
              left.status,
            ) -
              rank(
                right.status,
              ) ||
            left.name.localeCompare(
              right.name,
              "de",
            )
          );

        },
      );


  /*
   * =====================================================
   * RÜCKGABE
   * =====================================================
   */

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

    selectionMode:
      manuallySelected
        ? "manual"
        : "automatic",
  };
}


// =========================================================
// RENNWOCHENENDE ANZEIGEN
// =========================================================

exports.show =
  async (
    req,
    res,
  ) => {

    /*
     * Aktuell nur F1.
     */
    if (
      req.params
        .discipline !==
      "f1"
    ) {
      req.session.flash = {
        type:
          "error",

        message:
          "Der Rennwochenenden-Assistent ist aktuell für Formel 1 verfügbar.",
      };

      return res.redirect(
        "/admin",
      );
    }


    /*
     * Daten laden.
     */
    const data =
      await loadF1Data(
        req.query,
      );


    /*
     * Schritt 1 über den
     * bestehenden Aufstellungscontroller.
     */
    const planning =
      data.league &&
      data.race
        ? await f1RaceLineupController
            .loadPlanningRows(
              data.league,
              data.race,
            )
        : {
            teamCards: [],
            reserveRows: [],
            hasSavedPlan: false,
          };


    /*
     * Prüfen, ob bereits ein Ergebnis
     * gespeichert wurde.
     */
    const resultCount =
      data.race
        ? await GrandPrixResultEntry.count({
            where: {
              GrandPrixResultId:
                data.race.id,
            },
          })
        : 0;


    /*
     * Seite rendern.
     */
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

        resultsHref:
          `/admin/current-season-progress` +
          `?league=${data.league?.id || ""}` +
          `&season=${data.season?.id || ""}` +
          `&race=${data.race?.id || ""}`,
      },
    );
  };


// =========================================================
// FORMULARZEILE AUSLESEN
// =========================================================

function formRow(
  collection,
  entryId,
) {
  return (
    collection?.[
      `d${entryId}`
    ] ||
    collection?.[
      String(entryId)
    ] ||
    {}
  );
}


// =========================================================
// UNSICHER: IST FAHRER DA?
// =========================================================

function parseUncertainDecision(
  uncertainInput,
  entry,
) {
  const value =
    formRow(
      uncertainInput,
      entry.id,
    ).present;

  if (
    value === "yes"
  ) {
    return true;
  }

  if (
    value === "no"
  ) {
    return false;
  }

  return null;
}


// =========================================================
// UNSICHER: RECHTZEITIGE RÜCKMELDUNG?
// =========================================================

function parseRespondedInTime(
  uncertainInput,
  entry,
) {
  const value =
    formRow(
      uncertainInput,
      entry.id,
    ).respondedInTime;

  if (
    value === "yes"
  ) {
    return true;
  }

  if (
    value === "no"
  ) {
    return false;
  }

  return null;
}


// =========================================================
// UNSICHER-FALL AUFLÖSEN
// =========================================================

function absenceStatusFromResponse(
  respondedInTime,
) {
  /*
   * WICHTIG:
   *
   * Diese beiden Werte dienen nur zur
   * Dokumentation der tatsächlichen
   * Anwesenheit.
   *
   * Es werden daraus KEINE automatischen
   * Strafpunkte mehr erzeugt.
   */

  return respondedInTime
    ? "rueckmeldung_unsicher"
    : "fehlende_rueckmeldung_unsicher";
}


// =========================================================
// ANWESENHEIT SPEICHERN
// =========================================================

exports.saveAttendance =
  async (
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
      race.seasonRecord
        ?.status !==
        "active"
    ) {
      throw new Error(
        "Aktuelles Formel-1-Rennen wurde nicht gefunden.",
      );
    }


    /*
     * =====================================================
     * AUFSTELLUNG LADEN
     * =====================================================
     */

    const entries =
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
      });


    /*
     * =====================================================
     * FORMULARDATEN
     * =====================================================
     */

    const attendanceInput =
      req.body.attendance ||
      {};

    const correctionInput =
      req.body.correction ||
      {};

    const uncertainInput =
      req.body.uncertain ||
      {};


    try {

      /*
       * Die Transaction bleibt.
       *
       * Grund:
       * Stammfahrer + Ersatzfahrer +
       * Zuordnung + Starterstatus müssen
       * gemeinsam erfolgreich gespeichert
       * werden.
       */

      await sequelize.transaction(
        async (
          transaction,
        ) => {


          /*
           * =================================================
           * AUSDRÜCKLICHE KORREKTUREN
           * =================================================
           */

          if (
            Object.keys(
              correctionInput,
            ).length
          ) {

            for (
              const entry
              of entries
            ) {

              const correction =
                formRow(
                  correctionInput,
                  entry.id,
                );


              if (
                !correction.status
              ) {
                continue;
              }


              const status =
                normalizeAttendanceStatus(
                  correction.status,
                );


              if (
                ![
                  ...STARTING_ATTENDANCE,
                  ...ABSENT_ATTENDANCE,
                ].includes(
                  status,
                )
              ) {
                throw new Error(
                  "Ungültiger Korrekturstatus.",
                );
              }


              /*
               * Korrigierten Status speichern.
               */
              await entry.update(
                {
                  attendanceStatus:
                    status,

                  includeInResults:
                    STARTING_ATTENDANCE
                      .has(
                        status,
                      ),
                },
                {
                  transaction,
                },
              );


              /*
               * Wenn der ursprüngliche Fahrer
               * wieder als Starter bestätigt wird,
               * dürfen bisherige Ersatzzuordnungen
               * nicht gleichzeitig bestehen bleiben.
               */
              if (
                STARTING_ATTENDANCE
                  .has(
                    status,
                  )
              ) {

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
            }


            /*
             * Korrekturformular beendet.
             */
            return;
          }


          /*
           * =================================================
           * STAMM- UND ERSATZFAHRER
           * =================================================
           */

          const regularEntries =
            entries.filter(
              (entry) =>
                entry.roleType ===
                "regular",
            );


          const reserveEntries =
            entries.filter(
              (entry) =>
                entry.roleType ===
                "reserve",
            );


          const reserveByDriver =
            new Map(
              reserveEntries.map(
                (entry) => [
                  Number(
                    entry.DriverId,
                  ),
                  entry,
                ],
              ),
            );


          const plannedByRegular =
            new Map(
              reserveEntries
                .filter(
                  (entry) =>
                    entry
                      .ReplacementForDriverId,
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
           * =================================================
           * UNSICHER-FÄLLE VORAB PRÜFEN
           * =================================================
           */

          const regularDecision =
            new Map();

          const regularResponse =
            new Map();

          const releasedReserveIds =
            new Set();


          for (
            const regular
            of regularEntries.filter(
              (entry) =>
                entry.status ===
                "unsicher",
            )
          ) {

            const present =
              parseUncertainDecision(
                uncertainInput,
                regular,
              );


            const respondedInTime =
              parseRespondedInTime(
                uncertainInput,
                regular,
              );


            if (
              present === null
            ) {
              throw new Error(
                `${
                  regular.driver
                    ?.name ||
                  "Ein Stammfahrer"
                }: Bitte „Ist der Fahrer da?“ mit Ja oder Nein beantworten.`,
              );
            }


            if (
              respondedInTime ===
              null
            ) {
              throw new Error(
                `${
                  regular.driver
                    ?.name ||
                  "Ein Stammfahrer"
                }: Bitte „Rechtzeitig zurückgemeldet?“ mit Ja oder Nein beantworten.`,
              );
            }


            regularDecision.set(
              Number(
                regular.id,
              ),
              present,
            );


            regularResponse.set(
              Number(
                regular.id,
              ),
              respondedInTime,
            );


            /*
             * Geplanter Ersatz.
             */
            const planned =
              plannedByRegular.get(
                Number(
                  regular.DriverId,
                ),
              );


            /*
             * Stammfahrer ist doch da.
             *
             * Ein bereits endgültig bestätigter
             * Ersatzfahrer darf nicht einfach
             * überschrieben werden.
             */
            if (
              present &&
              planned
            ) {

              if (
                planned
                  .includeInResults &&
                STARTING_ATTENDANCE
                  .has(
                    planned
                      .attendanceStatus,
                  )
              ) {
                throw new Error(
                  `${
                    planned.driver
                      ?.name ||
                    "Der Ersatzfahrer"
                  } ist bereits als Starter bestätigt. Bitte zuerst eine ausdrückliche Anwesenheitskorrektur durchführen.`,
                );
              }


              releasedReserveIds.add(
                Number(
                  planned.DriverId,
                ),
              );
            }
          }


          /*
           * =================================================
           * ERSATZFAHRER-VERWALTUNG
           * =================================================
           */

          const usedReserveIds =
            new Set();

          const finalReserveDrivers =
            new Set();

          let followUpRequired =
            false;


          /*
           * =================================================
           * ANWESENHEIT EINES FAHRERS SPEICHERN
           * =================================================
           */

          async function storeAttendance(
            entry,
            status,
          ) {
            const normalized =
              normalizeAttendanceStatus(
                status,
              );


            if (
              ![
                ...STARTING_ATTENDANCE,
                ...ABSENT_ATTENDANCE,
              ].includes(
                normalized,
              )
            ) {
              throw new Error(
                `${
                  entry.driver
                    ?.name ||
                  "Fahrer"
                }: Ungültiger Anwesenheitsstatus.`,
              );
            }


            await entry.update(
              {
                attendanceStatus:
                  normalized,

                includeInResults:
                  STARTING_ATTENDANCE
                    .has(
                      normalized,
                    ),
              },
              {
                transaction,
              },
            );


            /*
             * KEINE Strafpunkte-Automatik.
             *
             * Die Strafkartei wird vollständig
             * manuell gepflegt.
             */

            return normalized;
          }


          /*
           * =================================================
           * AUS FORMULAR GEWÄHLTEN ERSATZ LESEN
           * =================================================
           */

          function requestedReplacement(
            entry,
          ) {
            return (
              Number(
                formRow(
                  attendanceInput,
                  entry.id,
                )
                  .ReplacementDriverId ||
                  0,
              ) ||
              null
            );
          }


          /*
           * =================================================
           * ERSATZFAHRER PRÜFEN
           * =================================================
           */

          function ensureReserveAvailable(
            reserve,
            rootRegular,
          ) {
            /*
             * Fahrer muss existieren und
             * Ersatzfahrer sein.
             */
            if (
              !reserve ||
              reserve.roleType !==
                "reserve" ||
              !ELIGIBLE_RESERVE_STATUS
                .has(
                  reserve.status,
                )
            ) {
              throw new Error(
                "Der gewählte Ersatzfahrer ist nicht verfügbar.",
              );
            }


            /*
             * Ersatzfahrer darf nur ein
             * einziges Cockpit übernehmen.
             */
            if (
              usedReserveIds.has(
                Number(
                  reserve.DriverId,
                ),
              )
            ) {
              throw new Error(
                `${
                  reserve.driver
                    ?.name ||
                  "Der Ersatzfahrer"
                } ist in diesem Rennwochenende bereits eingesetzt.`,
              );
            }


            const currentTarget =
              Number(
                reserve
                  .ReplacementForDriverId ||
                0,
              );


            /*
             * Fahrer ist bereits endgültiger
             * Starter für ein anderes Cockpit.
             */
            if (
              reserve
                .includeInResults &&
              currentTarget &&
              currentTarget !==
                Number(
                  rootRegular
                    .DriverId,
                )
            ) {
              throw new Error(
                `${
                  reserve.driver
                    ?.name ||
                  "Der Ersatzfahrer"
                } ist bereits als Starter für ein anderes Cockpit bestätigt.`,
              );
            }


            /*
             * Fahrer ist bereits für einen
             * anderen Unsicher-Fahrer vorgemerkt.
             */
            if (
              currentTarget &&
              currentTarget !==
                Number(
                  rootRegular
                    .DriverId,
                ) &&
              !releasedReserveIds
                .has(
                  Number(
                    reserve
                      .DriverId,
                  ),
                )
            ) {
              throw new Error(
                `${
                  reserve.driver
                    ?.name ||
                  "Der Ersatzfahrer"
                } ist für einen anderen unsicheren Fahrer reserviert.`,
              );
            }
          }


          /*
           * =================================================
           * ERSATZFAHRER / ERSATZKETTE AUFLÖSEN
           * =================================================
           */

          async function resolveReserve(
            startReserve,
            rootRegular,
            freshlySelected = false,
          ) {
            let reserve =
              startReserve;

            let isFresh =
              freshlySelected;

            const chain =
              new Set();


            while (reserve) {

              ensureReserveAvailable(
                reserve,
                rootRegular,
              );


              /*
               * Schutz gegen Schleifen.
               */
              if (
                chain.has(
                  Number(
                    reserve.DriverId,
                  ),
                )
              ) {
                throw new Error(
                  "Die Ersatzfahrerkette enthält eine ungültige Schleife.",
                );
              }


              chain.add(
                Number(
                  reserve.DriverId,
                ),
              );


              usedReserveIds.add(
                Number(
                  reserve.DriverId,
                ),
              );


              finalReserveDrivers.add(
                Number(
                  reserve.DriverId,
                ),
              );


              /*
               * Ersatzfahrer dem Cockpit
               * zuweisen.
               */
              await reserve.update(
                {
                  ReplacementForDriverId:
                    rootRegular
                      .DriverId,

                  TeamId:
                    rootRegular
                      .TeamId,

                  /*
                   * "Auf Abruf" wird bei
                   * tatsächlichem Einsatz
                   * zu "anwesend".
                   */
                  ...(
                    reserve.status ===
                    "auf_abruf"
                      ? {
                          status:
                            "anwesend",
                        }
                      : {}
                  ),
                },
                {
                  transaction,
                },
              );


              /*
               * =================================================
               * ERSATZFAHRER WAR UNSICHER
               * =================================================
               */

              if (
                reserve.status ===
                "unsicher"
              ) {

                const present =
                  parseUncertainDecision(
                    uncertainInput,
                    reserve,
                  );


                const respondedInTime =
                  parseRespondedInTime(
                    uncertainInput,
                    reserve,
                  );


                /*
                 * Neu spontan gewählter,
                 * unsicherer Ersatzfahrer:
                 *
                 * zunächst speichern und
                 * erneute Prüfung verlangen.
                 */
                if (
                  present === null ||
                  respondedInTime ===
                    null
                ) {

                  if (
                    !isFresh
                  ) {

                    const missing =
                      present === null
                        ? "„Ist der Fahrer da?“"
                        : "„Rechtzeitig zurückgemeldet?“";


                    throw new Error(
                      `${
                        reserve.driver
                          ?.name ||
                        "Der Ersatzfahrer"
                      }: Bitte ${missing} beantworten.`,
                    );
                  }


                  await reserve.update(
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


                  followUpRequired =
                    true;


                  return null;
                }


                /*
                 * Unsicher-Auflösung speichern.
                 */
                await reserve.update(
                  {
                    uncertainPresent:
                      present,

                    respondedInTime,
                  },
                  {
                    transaction,
                  },
                );


                /*
                 * Ersatzfahrer fährt nicht.
                 */
                if (
                  !present
                ) {

                  const absentStatus =
                    absenceStatusFromResponse(
                      respondedInTime,
                    );


                  await storeAttendance(
                    reserve,
                    absentStatus,
                  );


                  await reserve.update(
                    {
                      includeInResults:
                        false,
                    },
                    {
                      transaction,
                    },
                  );


                  /*
                   * Gibt es einen nächsten
                   * Ersatzfahrer?
                   */
                  const nextId =
                    requestedReplacement(
                      reserve,
                    );


                  if (
                    !nextId
                  ) {
                    return null;
                  }


                  /*
                   * Dieser Fahrer übernimmt
                   * das Cockpit nicht.
                   */
                  finalReserveDrivers.delete(
                    Number(
                      reserve.DriverId,
                    ),
                  );


                  await reserve.update(
                    {
                      ReplacementForDriverId:
                        null,

                      TeamId:
                        null,
                    },
                    {
                      transaction,
                    },
                  );


                  /*
                   * Nächsten Ersatzfahrer
                   * prüfen.
                   */
                  reserve =
                    reserveByDriver.get(
                      nextId,
                    );


                  isFresh =
                    true;


                  continue;
                }
              }


              /*
               * =================================================
               * ERSATZFAHRER IST DA
               * =================================================
               */

              const submittedStatus =
                formRow(
                  attendanceInput,
                  reserve.id,
                ).status ||
                "anwesend";


              if (
                !STARTING_ATTENDANCE
                  .has(
                    submittedStatus,
                  )
              ) {
                throw new Error(
                  `${
                    reserve.driver
                      ?.name ||
                    "Ersatzfahrer"
                  }: Wenn der Fahrer da ist, ist nur „Anwesend“ oder „Zu spät Vorbesprechung“ zulässig.`,
                );
              }


              const status =
                await storeAttendance(
                  reserve,
                  submittedStatus,
                );


              if (
                STARTING_ATTENDANCE
                  .has(
                    status,
                  )
              ) {
                return reserve;
              }
            }


            return null;
          }


          /*
           * =================================================
           * ALLE STAMMFAHRER VERARBEITEN
           * =================================================
           */

          for (
            const regular
            of regularEntries
          ) {

            const planned =
              plannedByRegular.get(
                Number(
                  regular.DriverId,
                ),
              ) ||
              null;


            /*
             * =================================================
             * RENNSPERRE
             * =================================================
             *
             * Fahrer startet nicht.
             * Kein Ersatz.
             */

            if (
              regular.status ===
              "rennsperre"
            ) {

              await regular.update(
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


              continue;
            }


            /*
             * =================================================
             * SCHRITT 1:
             * ABGEMELDET / ZU SPÄT ABGEMELDET
             * =================================================
             *
             * Beide starten nicht.
             *
             * Ersatz ist möglich.
             *
             * KEINE automatische Strafpunktevergabe.
             */

            if (
              PLANNED_ABSENT_STATUS
                .has(
                  regular.status,
                )
            ) {

              const absentStatus =
                regular.status;


              await regular.update(
                {
                  attendanceStatus:
                    absentStatus,

                  includeInResults:
                    false,

                  uncertainPresent:
                    false,

                  respondedInTime:
                    null,
                },
                {
                  transaction,
                },
              );


              /*
               * Geplanter Ersatz vorhanden.
               */
              if (planned) {

                await resolveReserve(
                  planned,
                  regular,
                  false,
                );

              } else {

                /*
                 * Kein Ersatz geplant:
                 * spontanen Ersatz aus
                 * Schritt 2 verwenden.
                 */

                const spontaneousId =
                  requestedReplacement(
                    regular,
                  );


                if (
                  spontaneousId
                ) {

                  await resolveReserve(
                    reserveByDriver.get(
                      spontaneousId,
                    ),
                    regular,
                    true,
                  );
                }
              }


              continue;
            }


            /*
             * =================================================
             * SCHRITT 1:
             * ANWESEND
             * =================================================
             */

            if (
              regular.status ===
              "anwesend"
            ) {

              const submittedStatus =
                formRow(
                  attendanceInput,
                  regular.id,
                ).status ||
                "anwesend";


              if (
                !STARTING_ATTENDANCE
                  .has(
                    submittedStatus,
                  ) &&
                !ABSENT_ATTENDANCE
                  .has(
                    submittedStatus,
                  )
              ) {
                throw new Error(
                  `${
                    regular.driver
                      ?.name ||
                    "Stammfahrer"
                  }: Ungültiger Anwesenheitsstatus.`,
                );
              }


              const storedStatus =
                await storeAttendance(
                  regular,
                  submittedStatus,
                );


              /*
               * Fahrer wurde zwar in Schritt 1
               * als anwesend geplant,
               * ist tatsächlich aber nicht da.
               */
              if (
                ABSENT_ATTENDANCE
                  .has(
                    storedStatus,
                  )
              ) {

                const spontaneousId =
                  requestedReplacement(
                    regular,
                  );


                if (
                  spontaneousId
                ) {

                  await resolveReserve(
                    reserveByDriver.get(
                      spontaneousId,
                    ),
                    regular,
                    true,
                  );
                }
              }


              continue;
            }


            /*
             * =================================================
             * NUR NOCH "UNSICHER" DARF ÜBRIG SEIN
             * =================================================
             */

            if (
              regular.status !==
              "unsicher"
            ) {
              throw new Error(
                `${
                  regular.driver
                    ?.name ||
                  "Stammfahrer"
                }: Unbekannter Planungsstatus „${regular.status}“.`,
              );
            }


            /*
             * =================================================
             * UNSICHER-FALL
             * =================================================
             */

            const regularTakesSeat =
              regularDecision.get(
                Number(
                  regular.id,
                ),
              );


            const respondedInTime =
              regularResponse.get(
                Number(
                  regular.id,
                ),
              );


            await regular.update(
              {
                uncertainPresent:
                  regularTakesSeat,

                respondedInTime,
              },
              {
                transaction,
              },
            );


            /*
             * =================================================
             * UNSICHER → FAHRER IST DA
             * =================================================
             */

            if (
              regularTakesSeat
            ) {

              const submittedStatus =
                formRow(
                  attendanceInput,
                  regular.id,
                ).status ||
                "anwesend";


              if (
                !STARTING_ATTENDANCE
                  .has(
                    submittedStatus,
                  )
              ) {
                throw new Error(
                  `${
                    regular.driver
                      ?.name ||
                    "Stammfahrer"
                  }: Wenn der Fahrer da ist, ist nur „Anwesend“ oder „Zu spät Vorbesprechung“ zulässig.`,
                );
              }


              await storeAttendance(
                regular,
                submittedStatus,
              );


              /*
               * Geplanter Ersatz wird
               * wieder freigegeben.
               */
              if (
                planned &&
                !planned
                  .includeInResults
              ) {
                releasedReserveIds.add(
                  Number(
                    planned.DriverId,
                  ),
                );
              }


              continue;
            }


            /*
             * =================================================
             * UNSICHER → FAHRER IST NICHT DA
             * =================================================
             */

            const absentStatus =
              absenceStatusFromResponse(
                respondedInTime,
              );


            await storeAttendance(
              regular,
              absentStatus,
            );


            await regular.update(
              {
                includeInResults:
                  false,
              },
              {
                transaction,
              },
            );


            /*
             * Geplanter Ersatz.
             */
            if (planned) {

              await resolveReserve(
                planned,
                regular,
                false,
              );

            } else {

              /*
               * Spontaner Ersatz.
               */
              const spontaneousId =
                requestedReplacement(
                  regular,
                );


              if (
                spontaneousId
              ) {

                await resolveReserve(
                  reserveByDriver.get(
                    spontaneousId,
                  ),
                  regular,
                  true,
                );
              }
            }
          }


          /*
           * =================================================
           * FREIGEGEBENE ERSATZFAHRER AUFRÄUMEN
           * =================================================
           */

          for (
            const reserve
            of reserveEntries
          ) {

            if (
              !releasedReserveIds
                .has(
                  Number(
                    reserve.DriverId,
                  ),
                ) ||
              finalReserveDrivers
                .has(
                  Number(
                    reserve.DriverId,
                  ),
                )
            ) {
              continue;
            }


            /*
             * Bereits bestätigter Starter
             * darf nicht stillschweigend
             * entfernt werden.
             */
            if (
              reserve
                .includeInResults &&
              STARTING_ATTENDANCE
                .has(
                  reserve
                    .attendanceStatus,
                )
            ) {
              throw new Error(
                `${
                  reserve.driver
                    ?.name ||
                  "Ein Ersatzfahrer"
                } ist bereits bestätigt und kann nicht stillschweigend freigegeben werden.`,
              );
            }


            await reserve.update(
              {
                ReplacementForDriverId:
                  null,

                TeamId:
                  null,

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


          /*
           * =================================================
           * NEUER UNSICHERER ERSATZ
           * =================================================
           */

          if (
            followUpRequired
          ) {
            req.session.flash = {
              type:
                "warning",

              message:
                "Ein neu gewählter Ersatzfahrer ist unsicher. Bitte seine Anwesenheit und Rückmeldung jetzt vollständig prüfen.",
            };
          }

        },
      );


      /*
       * =====================================================
       * ERFOLG
       * =====================================================
       */

      if (
        !req.session.flash
      ) {
        req.session.flash = {
          type:
            "success",

          message:
            Object.keys(
              correctionInput,
            ).length
              ? "Anwesenheitskorrekturen wurden gespeichert."
              : "Anwesenheitskontrolle gespeichert. Nur bestätigte Starter werden in Schritt 3 übernommen.",
        };
      }

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
     * ZURÜCK ZUM RENNWOCHENENDE
     * =====================================================
     */

    return res.redirect(
      `/admin/race-weekend/f1` +
      `?league=${race.LeagueId}` +
      `&season=${race.SeasonId}` +
      `&race=${race.id}` +
      `#anwesenheit`,
    );
  };


// =========================================================
// RESET: RENNEN LADEN
// =========================================================

async function loadResetRace(
  raceId,
) {
  const race =
    await GrandPrixResult.findByPk(
      Number(
        raceId,
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
      "f1"
  ) {
    throw new Error(
      "Formel-1-Rennen wurde nicht gefunden.",
    );
  }


  return race;
}


// =========================================================
// RESET REDIRECT
// =========================================================

function raceWeekendRedirect(
  race,
  hash = "",
) {
  return (
    `/admin/race-weekend/f1` +
    `?league=${race.LeagueId}` +
    `&season=${race.SeasonId}` +
    `&race=${race.id}` +
    hash
  );
}


// =========================================================
// SCHRITT 3 RESETTEN
//
// Aufstellung bleibt.
// Anwesenheit bleibt.
// Ergebnis wird gelöscht.
//
// STRAFKARTEI BLEIBT IMMER UNBERÜHRT.
// =========================================================

exports.resetResults =
  async (
    req,
    res,
  ) => {

    const race =
      await loadResetRace(
        req.params.raceId,
      );


    try {

      /*
       * Hier wird nur eine Tabelle geändert.
       * Deshalb ist keine Transaction notwendig.
       */
      await GrandPrixResultEntry.destroy({
        where: {
          GrandPrixResultId:
            race.id,
        },
      });


      req.session.flash = {
        type:
          "success",

        message:
          "Schritt 3 wurde zurückgesetzt. Das Rennergebnis wurde gelöscht.",
      };

    } catch (error) {

      req.session.flash = {
        type:
          "error",

        message:
          `Ergebnis konnte nicht zurückgesetzt werden: ${error.message}`,
      };
    }


    return res.redirect(
      raceWeekendRedirect(
        race,
        "#ergebnisse",
      ),
    );
  };


// =========================================================
// SCHRITT 2 RESETTEN
//
// Aufstellung bleibt.
// Anwesenheit wird zurückgesetzt.
// Ergebnis wird zurückgesetzt.
//
// STRAFKARTEI BLEIBT IMMER UNBERÜHRT.
// =========================================================

exports.resetAttendance =
  async (
    req,
    res,
  ) => {

    const race =
      await loadResetRace(
        req.params.raceId,
      );


    try {

      await sequelize.transaction(
        async (
          transaction,
        ) => {

          /*
           * Aufstellung laden.
           */
          const entries =
            await F1RaceLineupEntry.findAll({
              where: {
                GrandPrixResultId:
                  race.id,
              },

              transaction,
            });


          /*
           * Anwesenheitsdaten vollständig
           * zurücksetzen.
           */
          for (
            const entry
            of entries
          ) {

            await entry.update(
              {
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


          /*
           * Ergebnis hängt von der
           * Anwesenheit ab.
           *
           * Deshalb ebenfalls löschen.
           */
          await GrandPrixResultEntry.destroy({
            where: {
              GrandPrixResultId:
                race.id,
            },

            transaction,
          });


          /*
           * WICHTIG:
           *
           * Keine PenaltyEntry wird gelöscht.
           *
           * Die Strafkartei ist vollständig
           * unabhängig vom Rennwochenende.
           */
        },
      );


      req.session.flash = {
        type:
          "success",

        message:
          "Schritt 2 wurde zurückgesetzt. Aufstellung bleibt erhalten; Anwesenheit und Ergebnis wurden zurückgesetzt. Die Strafkartei bleibt unverändert.",
      };

    } catch (error) {

      req.session.flash = {
        type:
          "error",

        message:
          `Anwesenheit konnte nicht zurückgesetzt werden: ${error.message}`,
      };
    }


    return res.redirect(
      raceWeekendRedirect(
        race,
        "#anwesenheit",
      ),
    );
  };


// =========================================================
// SCHRITT 1 RESETTEN
//
// Aufstellung wird gelöscht.
// Anwesenheit wird dadurch ebenfalls gelöscht.
// Ergebnis wird gelöscht.
//
// STRAFKARTEI BLEIBT IMMER UNBERÜHRT.
// =========================================================

exports.resetLineup =
  async (
    req,
    res,
  ) => {

    const race =
      await loadResetRace(
        req.params.raceId,
      );


    try {

      await sequelize.transaction(
        async (
          transaction,
        ) => {

          /*
           * =================================================
           * 1. ERGEBNIS
           * =================================================
           */

          await GrandPrixResultEntry.destroy({
            where: {
              GrandPrixResultId:
                race.id,
            },

            transaction,
          });


          /*
           * =================================================
           * 2. OPERATIVE AUFSTELLUNG
           * =================================================
           *
           * attendanceStatus usw. liegen direkt
           * in F1RaceLineupEntry.
           *
           * Deshalb verschwinden sie zusammen
           * mit der Aufstellung.
           */

          await F1RaceLineupEntry.destroy({
            where: {
              GrandPrixResultId:
                race.id,
            },

            transaction,
          });


          /*
           * WICHTIG:
           *
           * Keine Strafpunkte löschen.
           */
        },
      );


      req.session.flash = {
        type:
          "success",

        message:
          "Schritt 1 wurde zurückgesetzt. Aufstellung, Anwesenheit und Ergebnis sind wieder offen. Die Strafkartei bleibt unverändert.",
      };

    } catch (error) {

      req.session.flash = {
        type:
          "error",

        message:
          `Aufstellung konnte nicht zurückgesetzt werden: ${error.message}`,
      };
    }


    return res.redirect(
      raceWeekendRedirect(
        race,
        "#aufstellung",
      ),
    );
  };


// =========================================================
// KOMPLETTES OPERATIVES RENNWOCHENENDE RESETTEN
//
// Wird gelöscht:
// - Aufstellung
// - Anwesenheit
// - Ergebnis
//
// Bleibt bestehen:
// - Strafkartei
// - Rennkalender
// - RaceEvent
// - Saison
// - Stammdaten
// =========================================================

exports.resetAll =
  async (
    req,
    res,
  ) => {

    const race =
      await loadResetRace(
        req.params.raceId,
      );


    try {

      await sequelize.transaction(
        async (
          transaction,
        ) => {

          /*
           * =================================================
           * 1. ERGEBNIS
           * =================================================
           */

          await GrandPrixResultEntry.destroy({
            where: {
              GrandPrixResultId:
                race.id,
            },

            transaction,
          });


          /*
           * =================================================
           * 2. AUFSTELLUNG + ANWESENHEIT
           * =================================================
           */

          await F1RaceLineupEntry.destroy({
            where: {
              GrandPrixResultId:
                race.id,
            },

            transaction,
          });


          /*
           * =================================================
           * STRAFKARTEI
           * =================================================
           *
           * Absichtlich NICHT anfassen.
           */
        },
      );


      req.session.flash = {
        type:
          "success",

        message:
          "Das operative Rennwochenende wurde vollständig zurückgesetzt. Die Strafkartei bleibt unverändert.",
      };

    } catch (error) {

      req.session.flash = {
        type:
          "error",

        message:
          `Rennwochenende konnte nicht zurückgesetzt werden: ${error.message}`,
      };
    }


    return res.redirect(
      raceWeekendRedirect(
        race,
        "#aufstellung",
      ),
    );
  };


// =========================================================
// EXPORTS FÜR ANDERE CONTROLLER / TESTS
// =========================================================

module.exports.loadF1Data =
  loadF1Data;

module.exports.selectCurrentEvent =
  selectCurrentEvent;