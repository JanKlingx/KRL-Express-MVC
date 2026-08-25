const { Op } = require("sequelize");

const {
  sequelize,
  League,
  Season,
  RaceEvent,
  GrandPrixResult,
  F1Track,
} = require("../models");

const seasonProgress =
  require("../services/seasonProgress");

const {
  syncSeriesCalendarEvent,
} = require("../services/championship");


const disciplineFor = (league) =>
  league?.type === "competition"
    ? "wdl"
    : league?.type;


/*
 * =====================================================
 * REDIRECT
 * =====================================================
 *
 * Erkennt, ob die Aktion aus dem Saison-Assistenten
 * oder aus der separaten Kalenderpflege kommt.
 */

const redirectTo = (
  leagueId,
  seasonId,
  req = null,
) => {

  if (
    req?.originalUrl?.includes(
      "/season-setup/",
    )
  ) {

    return (
      `/admin/season-setup` +
      `?league=${leagueId || ""}` +
      `&season=${seasonId || ""}` +
      `#setup-calendar`
    );

  }


  return (
    `/admin/season-calendar` +
    `?league=${leagueId || ""}` +
    `&season=${seasonId || ""}`
  );
};


/*
 * =====================================================
 * STARTZEIT AUS LIGA
 * =====================================================
 */

const timeFromLeague = (league) =>
  String(
    league?.raceTime || "",
  ).match(
    /\b([01]\d|2[0-3]):[0-5]\d\b/,
  )?.[0] ||
  "20:00";


/*
 * =====================================================
 * MAIN-RENNEN FÜR RACE EVENT SICHERSTELLEN
 * =====================================================
 *
 * Ein normales RaceEvent muss immer ein zugehöriges
 * GrandPrixResult vom Typ "main" besitzen.
 *
 * Diese Funktion repariert auch alte/inkonsistente
 * Kalendertermine, bei denen:
 *
 * - GrandPrixResultId NULL ist
 * - GrandPrixResultId auf keinen Datensatz mehr zeigt
 * - RaceEvent existiert, GrandPrixResult aber fehlt
 *
 * Testtage erhalten bewusst KEIN Main-Result.
 */

async function ensureMainRaceForEvent(
  event,
  transaction = null,
) {

  if (!event || event.isTestDay) {
    return null;
  }


  /*
   * ---------------------------------------------------
   * 1. Direkte Verknüpfung prüfen
   * ---------------------------------------------------
   */

  if (event.GrandPrixResultId) {

    const linkedRace =
      await GrandPrixResult.findOne({
        where: {
          id:
            event.GrandPrixResultId,

          SeasonId:
            event.SeasonId,

          LeagueId:
            event.LeagueId,

          raceType:
            "main",
        },

        transaction,
      });


    if (linkedRace) {
      return linkedRace;
    }

  }


  /*
   * ---------------------------------------------------
   * 2. Vielleicht existiert das Result bereits,
   *    nur die Event-Verknüpfung fehlt.
   * ---------------------------------------------------
   */

  const existingRace =
    await GrandPrixResult.findOne({
      where: {
        SeasonId:
          event.SeasonId,

        LeagueId:
          event.LeagueId,

        circuit:
          event.circuit,

        raceType:
          "main",
      },

      order: [
        ["id", "ASC"],
      ],

      transaction,
    });


  if (existingRace) {

    await event.update(
      {
        GrandPrixResultId:
          existingRace.id,
      },
      {
        transaction,
      },
    );


    return existingRace;
  }


  /*
   * ---------------------------------------------------
   * 3. Result fehlt vollständig.
   *
   * Bestehenden zentralen Sync-Service verwenden.
   * ---------------------------------------------------
   *
   * syncSeriesCalendarEvent besitzt aktuell keinen
   * Transaction-Parameter.
   *
   * Daher nur außerhalb einer fremden Transaction
   * verwenden.
   */

  if (transaction) {

    const [
      season,
      league,
    ] =
      await Promise.all([

        Season.findByPk(
          event.SeasonId,
          {
            transaction,
          },
        ),

        League.findByPk(
          event.LeagueId,
          {
            transaction,
          },
        ),

      ]);


    if (!season || !league) {
      throw new Error(
        "Zum Kalendereintrag wurden Saison oder Liga nicht gefunden.",
      );
    }


    const [race] =
      await GrandPrixResult.findOrCreate({
        where: {
          SeasonId:
            season.id,

          LeagueId:
            league.id,

          circuit:
            event.circuit ||
            event.title,

          raceType:
            "main",
        },

        defaults: {
          SeasonId:
            season.id,

          LeagueId:
            league.id,

          season:
            season.name,

          title:
            event.title,

          circuit:
            event.circuit,

          raceDate:
            event.startsAt,

          discipline:
            season.leagueType ===
            "wdl"
              ? "wdl"
              : season.leagueType,

          raceType:
            "main",

          pointsMode:
            "database",

          isHistorical:
            season.status ===
            "historical",

          sortOrder:
            event.sortOrder,
        },

        transaction,
      });


    await race.update(
      {
        season:
          season.name,

        title:
          event.title,

        circuit:
          event.circuit,

        raceDate:
          event.startsAt,

        discipline:
          season.leagueType ===
          "wdl"
            ? "wdl"
            : season.leagueType,

        raceType:
          "main",

        isHistorical:
          season.status ===
          "historical",

        sortOrder:
          event.sortOrder,
      },
      {
        transaction,
      },
    );


    await event.update(
      {
        GrandPrixResultId:
          race.id,

        isPublished:
          season.status ===
          "active" &&
          season.isPublished !==
            false,
      },
      {
        transaction,
      },
    );


    return race;
  }


  /*
   * Normaler bestehender Projekt-Service.
   */

  await syncSeriesCalendarEvent(
    event,
  );


  await event.reload();


  if (!event.GrandPrixResultId) {

    throw new Error(
      `Für ${event.title} konnte kein Hauptrennen angelegt werden.`,
    );

  }


  return GrandPrixResult.findByPk(
    event.GrandPrixResultId,
  );
}


/*
 * =====================================================
 * DATEN LADEN
 * =====================================================
 */

async function loadData(
  query = {},
) {

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


  const selectedLeague =
    leagues.find(
      (league) =>
        league.id ===
        Number(
          query.league,
        ),
    ) ||
    leagues[0] ||
    null;


  const discipline =
    disciplineFor(
      selectedLeague,
    );


  const seasons =
    selectedLeague
      ? await Season.findAll({
          where: {
            leagueType:
              discipline,

            scopeSlug:
              selectedLeague.slug,
          },

          order: [
            [
              "status",
              "ASC",
            ],

            [
              "sortOrder",
              "DESC",
            ],

            [
              "id",
              "DESC",
            ],
          ],
        })
      : [];


  const selectedSeason =
    seasons.find(
      (season) =>
        season.id ===
        Number(
          query.season,
        ),
    ) ||
    seasons.find(
      (season) =>
        season.status ===
        "active",
    ) ||
    seasons[0] ||
    null;


  const rawEvents =
    selectedSeason &&
    selectedLeague
      ? await RaceEvent.findAll({
          where: {
            LeagueId:
              selectedLeague.id,

            SeasonId:
              selectedSeason.id,
          },

          include: [
            {
              association:
                "track",

              include: [
                {
                  association:
                    "countryRecord",
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
        })
      : [];


  /*
   * Sprint wird weiterhin über GrandPrixResult
   * raceType=sprint ermittelt.
   */

  const sprints =
    selectedSeason?.leagueType ===
      "f1" &&
    selectedLeague
      ? await GrandPrixResult.findAll({
          where: {
            LeagueId:
              selectedLeague.id,

            SeasonId:
              selectedSeason.id,

            raceType:
              "sprint",
          },

          attributes: [
            "circuit",
            "sortOrder",
          ],
        })
      : [];


  const sprintKeys =
    new Set(
      sprints.map(
        (race) =>
          `${race.circuit}::${race.sortOrder}`,
      ),
    );


  const events =
    rawEvents.map(
      (event) => ({
        ...event.toJSON(),

        hasSprint:
          sprintKeys.has(
            `${event.circuit}::${event.sortOrder}`,
          ),
      }),
    );


  const tracks =
    discipline === "f1"
      ? await F1Track.findAll({
          include: [
            {
              association:
                "countryRecord",
            },
          ],

          order: [
            [
              "country",
              "ASC",
            ],

            [
              "name",
              "ASC",
            ],
          ],
        })
      : [];


  return {
    leagues,
    selectedLeague,
    discipline,
    seasons,
    selectedSeason,
    events,
    tracks,

    defaultTime:
      timeFromLeague(
        selectedLeague,
      ),
  };
}


/*
 * =====================================================
 * KALENDERSEITE
 * =====================================================
 */

exports.show = async (
  req,
  res,
) => {

  res.render(
    "admin/season-calendar",
    {
      title:
        "Rennkalender bearbeiten",

      ...(await loadData(
        req.query,
      )),
    },
  );

};


/*
 * =====================================================
 * TERMIN ANLEGEN
 * =====================================================
 */

exports.create = async (
  req,
  res,
) => {

  let league;
  let season;


  try {

    season =
      await Season.findByPk(
        req.body.SeasonId,
      );


    league =
      await League.findByPk(
        req.body.LeagueId,
      );


    if (
      !season ||
      !league ||
      season.scopeSlug !==
        league.slug ||
      season.leagueType !==
        disciplineFor(
          league,
        )
    ) {

      throw new Error(
        "Saison und Liga passen nicht zusammen.",
      );

    }


    const date =
      String(
        req.body.date ||
        "",
      );


    const time =
      timeFromLeague(
        league,
      );


    const startsAt =
      new Date(
        `${date}T${time}:00`,
      );


    if (
      Number.isNaN(
        startsAt.getTime(),
      )
    ) {

      throw new Error(
        "Datum oder Startzeit ist ungültig.",
      );

    }


    const track =
      await F1Track.findByPk(
        req.body.F1TrackId,
        {
          include: [
            {
              association:
                "countryRecord",
            },
          ],
        },
      );


    if (!track) {

      throw new Error(
        "Bitte eine Strecke aus dem Formel-1-Streckenstamm auswählen.",
      );

    }


    const circuit =
      track.name;


    const title =
      `Großer Preis von ${
        track.countryRecord
          ?.name ||
        track.country
      }`;


    const isTestDay =
      req.body.isTestDay ===
      "on";


    /*
     * Testtage haben keine normale Runde.
     */

    let sortOrder;


    if (isTestDay) {

      sortOrder = 0;

    } else {

      sortOrder =
        Number(
          req.body.sortOrder,
        );


      if (
        !Number.isInteger(
          sortOrder,
        ) ||
        sortOrder < 1
      ) {

        throw new Error(
          "Die Rennen-Nummer muss größer als 0 sein.",
        );

      }


      const duplicateRound =
        await RaceEvent.findOne({
          where: {
            LeagueId:
              league.id,

            SeasonId:
              season.id,

            sortOrder,

            isTestDay:
              false,
          },
        });


      if (duplicateRound) {

        throw new Error(
          `Rennen Nr. ${sortOrder} ist in dieser Saison bereits belegt.`,
        );

      }

    }


    /*
     * ---------------------------------------------------
     * TESTTAG
     * ---------------------------------------------------
     */

    if (isTestDay) {

      await RaceEvent.create({
        LeagueId:
          league.id,

        SeasonId:
          season.id,

        GrandPrixResultId:
          null,

        title,

        circuit,

        startsAt,

        F1TrackId:
          track.id,

        durationMinutes:
          null,

        isPublished:
          season.status ===
            "active" &&
          season.isPublished,

        isTestDay:
          true,

        sortOrder:
          0,
      });


      req.session.flash = {
        type:
          "success",

        message:
          "Testtag wurde gespeichert.",
      };


      return res.redirect(
        redirectTo(
          league.id,
          season.id,
          req,
        ),
      );

    }


    /*
     * ---------------------------------------------------
     * NORMALES RENNEN
     * ---------------------------------------------------
     *
     * Bestehende createManualRace-Logik weiterverwenden.
     */

    const {
      main,
    } =
      await seasonProgress
        .createManualRace(
          season.leagueType,
          {
            ...req.body,

            SeasonId:
              season.id,

            LeagueId:
              league.id,

            sortOrder,

            title,

            circuit,

            raceDate:
              date,

            pointsMode:
              "database",

            hasSprint:
              req.body.hasSprint,
          },
        );


    await RaceEvent.create({
      LeagueId:
        league.id,

      SeasonId:
        season.id,

      GrandPrixResultId:
        main.id,

      title:
        main.title,

      circuit:
        main.circuit,

      startsAt,

      F1TrackId:
        track.id,

      durationMinutes:
        null,

      isPublished:
        season.status ===
          "active" &&
        season.isPublished,

      isTestDay:
        false,

      sortOrder:
        main.sortOrder,
    });


    req.session.flash = {
      type:
        "success",

      message:
        "Kalendereintrag wurde gespeichert.",
    };


    return res.redirect(
      redirectTo(
        league.id,
        season.id,
        req,
      ),
    );

  } catch (error) {

    req.session.flash = {
      type:
        "error",

      message:
        error.message,
    };


    return res.redirect(
      redirectTo(
        league?.id ||
          req.body.LeagueId,

        season?.id ||
          req.body.SeasonId,

        req,
      ),
    );

  }

};


/*
 * =====================================================
 * TERMIN BEARBEITEN
 * =====================================================
 */

exports.update = async (
  req,
  res,
  next,
) => {

  const event =
    await RaceEvent.findByPk(
      req.params.eventId,
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

          {
            association:
              "grandPrixResult",
          },
        ],
      },
    );


  if (!event) {
    return next();
  }


  try {

    const date =
      String(
        req.body.date ||
        "",
      );


    const time =
      timeFromLeague(
        event.league,
      );


    const startsAt =
      new Date(
        `${date}T${time}:00`,
      );


    if (
      Number.isNaN(
        startsAt.getTime(),
      )
    ) {

      throw new Error(
        "Datum oder Startzeit ist ungültig.",
      );

    }


    const nextIsTestDay =
      req.body.isTestDay ===
      "on";


    let sortOrder;


    if (nextIsTestDay) {

      sortOrder = 0;

    } else {

      sortOrder =
        Number(
          req.body.sortOrder ||
          event.sortOrder ||
          0,
        );


      if (
        !Number.isInteger(
          sortOrder,
        ) ||
        sortOrder < 1
      ) {

        throw new Error(
          "Die Rennen-Nummer muss größer als 0 sein.",
        );

      }

    }


    const track =
      await F1Track.findByPk(
        req.body.F1TrackId,
        {
          include: [
            {
              association:
                "countryRecord",
            },
          ],
        },
      );


    if (!track) {

      throw new Error(
        "Bitte eine Strecke aus dem Formel-1-Streckenstamm auswählen.",
      );

    }


    /*
     * Runde nur bei normalen Rennen prüfen.
     */

    if (!nextIsTestDay) {

      const duplicateRound =
        await RaceEvent.findOne({
          where: {
            id: {
              [Op.ne]:
                event.id,
            },

            LeagueId:
              event.LeagueId,

            SeasonId:
              event.SeasonId,

            sortOrder,

            isTestDay:
              false,
          },
        });


      if (duplicateRound) {

        throw new Error(
          `Rennen Nr. ${sortOrder} ist bereits belegt.`,
        );

      }

    }


    const nextTitle =
      `Großer Preis von ${
        track.countryRecord
          ?.name ||
        track.country
      }`;


    const nextCircuit =
      track.name;


    /*
     * Werte vor Update sichern.
     */

    const previousStartsAt =
      event.startsAt;


    const previousSortOrder =
      event.sortOrder;


    const previousCircuit =
      event.circuit;


    const wasTestDay =
      Boolean(
        event.isTestDay,
      );


    const changed =
      new Date(
        event.startsAt,
      ).getTime() !==
        startsAt.getTime() ||

      Number(
        event.sortOrder,
      ) !==
        Number(
          sortOrder,
        ) ||

      Number(
        event.F1TrackId,
      ) !==
        Number(
          track.id,
        );


    /*
     * ===================================================
     * TRANSAKTION
     * ===================================================
     */

    await sequelize.transaction(
      async (
        transaction,
      ) => {

        /*
         * -------------------------------------------------
         * EVENT AKTUALISIEREN
         * -------------------------------------------------
         */

        await event.update(
          {
            title:
              nextTitle,

            circuit:
              nextCircuit,

            F1TrackId:
              track.id,

            startsAt,

            sortOrder,

            isTestDay:
              nextIsTestDay,

            durationMinutes:
              null,

            isPublished:
              event.seasonRecord
                ?.status ===
                "active" &&
              event.seasonRecord
                ?.isPublished,

            previousStartsAt:
              changed
                ? previousStartsAt
                : event.previousStartsAt,

            previousSortOrder:
              changed
                ? previousSortOrder
                : event.previousSortOrder,

            calendarChanged:
              changed ||
              event.calendarChanged,
          },
          {
            transaction,
          },
        );


        /*
         * -------------------------------------------------
         * TESTTAG
         * -------------------------------------------------
         *
         * Ein Testtag soll kein normales Result besitzen.
         */

        if (nextIsTestDay) {

          if (
            event.GrandPrixResultId
          ) {

            const oldMain =
              await GrandPrixResult
                .findByPk(
                  event
                    .GrandPrixResultId,
                  {
                    transaction,
                  },
                );


            if (oldMain) {

              /*
               * Nur löschen, wenn noch keine Ergebnisse
               * vorhanden sind.
               *
               * Keine gefahrene Historie zerstören.
               */

              const entryCount =
                await oldMain.countEntries({
                  transaction,
                });


              if (entryCount) {

                throw new Error(
                  "Dieser Termin besitzt bereits Ergebnisse und kann deshalb nicht in einen Testtag umgewandelt werden.",
                );

              }


              await GrandPrixResult.destroy({
                where: {
                  SeasonId:
                    event.SeasonId,

                  LeagueId:
                    event.LeagueId,

                  circuit:
                    previousCircuit,
                },

                transaction,
              });

            }


            await event.update(
              {
                GrandPrixResultId:
                  null,
              },
              {
                transaction,
              },
            );

          }


          return;
        }


        /*
         * -------------------------------------------------
         * NORMALES RENNEN
         *
         * Das Main-Result MUSS existieren.
         * -------------------------------------------------
         */

        let main =
          await ensureMainRaceForEvent(
            event,
            transaction,
          );


        if (!main) {

          throw new Error(
            "Das Hauptrennen konnte nicht angelegt oder geladen werden.",
          );

        }


        /*
         * Falls das Event vorher Testtag war,
         * wurde gerade ein komplett neues Main-Result
         * angelegt.
         */

        const oldCircuit =
          main.circuit;


        const oldSortOrder =
          main.sortOrder;


        /*
         * Hauptrennen aktualisieren.
         */

        await main.update(
          {
            season:
              event.seasonRecord
                ?.name ||
              main.season,

            title:
              nextTitle,

            circuit:
              nextCircuit,

            raceDate:
              startsAt,

            discipline:
              event.seasonRecord
                ?.leagueType ||
              "f1",

            raceType:
              "main",

            isHistorical:
              event.seasonRecord
                ?.status ===
              "historical",

            sortOrder,
          },
          {
            transaction,
          },
        );


        /*
         * -------------------------------------------------
         * SPRINT
         * -------------------------------------------------
         *
         * Bestehenden Sprint anhand altem Circuit /
         * alter Runde suchen.
         */

        let sprint =
          await GrandPrixResult.findOne({
            where: {
              SeasonId:
                event.SeasonId,

              LeagueId:
                event.LeagueId,

              raceType:
                "sprint",

              [Op.or]: [
                {
                  circuit:
                    oldCircuit,

                  sortOrder:
                    oldSortOrder,
                },

                {
                  circuit:
                    nextCircuit,

                  sortOrder,
                },
              ],
            },

            transaction,
          });


        const hasSprint =
          req.body.hasSprint ===
            "on" ||
          req.body.hasSprint ===
            "true" ||
          req.body.hasSprint ===
            true;


        if (hasSprint) {

          if (!sprint) {

            sprint =
              await GrandPrixResult.create(
                {
                  SeasonId:
                    event.SeasonId,

                  LeagueId:
                    event.LeagueId,

                  season:
                    event.seasonRecord
                      ?.name ||
                    main.season,

                  title:
                    `Sprint · ${nextCircuit}`,

                  circuit:
                    nextCircuit,

                  raceDate:
                    startsAt,

                  discipline:
                    "f1",

                  raceType:
                    "sprint",

                  pointsMode:
                    "database",

                  isHistorical:
                    event.seasonRecord
                      ?.status ===
                    "historical",

                  sortOrder,
                },
                {
                  transaction,
                },
              );

          } else {

            await sprint.update(
              {
                title:
                  `Sprint · ${nextCircuit}`,

                circuit:
                  nextCircuit,

                raceDate:
                  startsAt,

                sortOrder,

                isHistorical:
                  event.seasonRecord
                    ?.status ===
                  "historical",
              },
              {
                transaction,
              },
            );

          }

        } else if (sprint) {

          /*
           * Sprint nur löschen, wenn noch keine
           * Sprint-Ergebnisse vorhanden sind.
           */

          const sprintEntryCount =
            await sprint.countEntries({
              transaction,
            });


          if (sprintEntryCount) {

            throw new Error(
              "Der Sprint besitzt bereits Ergebnisse und kann deshalb nicht deaktiviert werden.",
            );

          }


          await sprint.destroy({
            transaction,
          });

        }


        /*
         * Event sicher mit dem Main verknüpfen.
         */

        if (
          Number(
            event
              .GrandPrixResultId,
          ) !==
          Number(
            main.id,
          )
        ) {

          await event.update(
            {
              GrandPrixResultId:
                main.id,
            },
            {
              transaction,
            },
          );

        }

      },
    );


    req.session.flash = {
      type:
        "success",

      message:
        "Kalender wurde gespeichert.",
    };

  } catch (error) {

    req.session.flash = {
      type:
        "error",

      message:
        error.message,
    };

  }


  return res.redirect(
    redirectTo(
      event.LeagueId,
      event.SeasonId,
      req,
    ),
  );

};


/*
 * =====================================================
 * REIHENFOLGE SPEICHERN
 * =====================================================
 */

exports.reorder = async (
  req,
  res,
) => {

  const seasonId =
    Number(
      req.body.SeasonId ||
      req.params.seasonId,
    );


  const leagueId =
    Number(
      req.body.LeagueId,
    );


  if (
    !Number.isInteger(
      seasonId,
    ) ||
    !Number.isInteger(
      leagueId,
    )
  ) {

    throw new Error(
      "Liga und Saison wurden nicht korrekt übergeben.",
    );

  }


  const ids = [
    ...new Set(
      []
        .concat(
          req.body.eventIds ||
          [],
        )
        .map(
          Number,
        )
        .filter(
          Number.isInteger,
        ),
    ),
  ];


  const [
    season,
    league,
  ] =
    await Promise.all([

      Season.findByPk(
        seasonId,
      ),

      League.findByPk(
        leagueId,
      ),

    ]);


  if (
    !season ||
    !league ||
    !ids.length
  ) {

    throw new Error(
      "Liga, Saison und Kalenderreihenfolge sind erforderlich.",
    );

  }


  const events =
    await RaceEvent.findAll({
      where: {
        id: {
          [Op.in]:
            ids,
        },

        SeasonId:
          season.id,

        LeagueId:
          league.id,
      },
    });


  if (
    events.length !==
    ids.length
  ) {

    throw new Error(
      "Die Kalenderreihenfolge enthält ungültige Termine.",
    );

  }


  /*
   * ===================================================
   * TRANSAKTION
   * ===================================================
   *
   * Testtage zählen NICHT als Rennrunde.
   *
   * Beispiel:
   *
   * Testtag = 0
   * erstes Rennen = 1
   * zweites Rennen = 2
   * ...
   */

  await sequelize.transaction(
    async (
      transaction,
    ) => {

      let raceRound =
        0;


      for (
        const id of ids
      ) {

        const event =
          events.find(
            (entry) =>
              Number(
                entry.id,
              ) ===
              Number(
                id,
              ),
          );


        if (!event) {
          continue;
        }


        const nextOrder =
          event.isTestDay
            ? 0
            : ++raceRound;


        const changed =
          Number(
            event.sortOrder,
          ) !==
          Number(
            nextOrder,
          );


        await event.update(
          {
            previousSortOrder:
              changed
                ? event.sortOrder
                : event.previousSortOrder,

            sortOrder:
              nextOrder,

            calendarChanged:
              changed ||
              event.calendarChanged,
          },
          {
            transaction,
          },
        );


        /*
         * Testtage haben kein GrandPrixResult.
         */

        if (
          event.isTestDay
        ) {
          continue;
        }


        /*
         * WICHTIG:
         *
         * Nicht mehr nur UPDATE ausführen.
         *
         * Falls das GrandPrixResult fehlt, wird es
         * jetzt automatisch repariert/angelegt.
         */

        const main =
          await ensureMainRaceForEvent(
            event,
            transaction,
          );


        if (!main) {

          throw new Error(
            `Für ${event.title} konnte kein Hauptrennen synchronisiert werden.`,
          );

        }


        /*
         * Main aktualisieren.
         */

        await main.update(
          {
            title:
              event.title,

            circuit:
              event.circuit,

            raceDate:
              event.startsAt,

            sortOrder:
              nextOrder,

            isHistorical:
              season.status ===
              "historical",
          },
          {
            transaction,
          },
        );


        /*
         * Sprint derselben Strecke ebenfalls
         * auf neue Runde setzen.
         */

        await GrandPrixResult.update(
          {
            sortOrder:
              nextOrder,
          },
          {
            where: {
              SeasonId:
                season.id,

              LeagueId:
                league.id,

              circuit:
                event.circuit,

              raceType:
                "sprint",
            },

            transaction,
          },
        );

      }

    },
  );


  req.session.flash = {
    type:
      "success",

    message:
      "Kalenderreihenfolge wurde gespeichert.",
  };


  return res.redirect(
    redirectTo(
      league.id,
      season.id,
      req,
    ),
  );

};


/*
 * =====================================================
 * TERMIN LÖSCHEN
 * =====================================================
 */

exports.remove = async (
  req,
  res,
  next,
) => {

  const event =
    await RaceEvent.findByPk(
      req.params.eventId,
    );


  if (!event) {
    return next();
  }


  const {
    LeagueId,
    SeasonId,
    GrandPrixResultId,
  } =
    event;


  try {

    await sequelize.transaction(
      async (
        transaction,
      ) => {

        /*
         * Testtag:
         * nur RaceEvent entfernen.
         */

        if (
          event.isTestDay
        ) {

          await event.destroy({
            transaction,
          });

          return;
        }


        /*
         * Main über direkte ID oder Fallback suchen.
         */

        let main =
          GrandPrixResultId
            ? await GrandPrixResult
                .findByPk(
                  GrandPrixResultId,
                  {
                    transaction,
                  },
                )
            : null;


        if (!main) {

          main =
            await GrandPrixResult
              .findOne({
                where: {
                  SeasonId,

                  LeagueId,

                  circuit:
                    event.circuit,

                  raceType:
                    "main",
                },

                transaction,
              });

        }


        /*
         * Erst Event entfernen.
         */

        await event.destroy({
          transaction,
        });


        /*
         * Main + Sprint nur kontrolliert entfernen.
         */

        if (main) {

          const entryCount =
            await main.countEntries({
              transaction,
            });


          if (entryCount) {

            throw new Error(
              "Dieses Rennen besitzt bereits Ergebnisse und kann nicht über den Kalender gelöscht werden.",
            );

          }


          const sprint =
            await GrandPrixResult
              .findOne({
                where: {
                  SeasonId,

                  LeagueId,

                  circuit:
                    main.circuit,

                  raceType:
                    "sprint",
                },

                transaction,
              });


          if (sprint) {

            const sprintEntryCount =
              await sprint.countEntries({
                transaction,
              });


            if (
              sprintEntryCount
            ) {

              throw new Error(
                "Der zugehörige Sprint besitzt bereits Ergebnisse und verhindert das Löschen des Kalendereintrags.",
              );

            }


            await sprint.destroy({
              transaction,
            });

          }


          await main.destroy({
            transaction,
          });

        }

      },
    );


    req.session.flash = {
      type:
        "success",

      message:
        "Kalendereintrag wurde gelöscht.",
    };

  } catch (error) {

    req.session.flash = {
      type:
        "error",

      message:
        error.message,
    };

  }


  return res.redirect(
    redirectTo(
      LeagueId,
      SeasonId,
      req,
    ),
  );

};