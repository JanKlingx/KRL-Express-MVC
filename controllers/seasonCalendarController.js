const { Op } = require("sequelize");

const {
  League,
  Season,
  RaceEvent,
  GrandPrixResult,
  F1Track,
} = require("../models");

const seasonProgress = require("../services/seasonProgress");


const disciplineFor = (league) =>
  league?.type === "competition"
    ? "wdl"
    : league?.type;


/*
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
    return `/admin/season-setup?league=${leagueId || ""}&season=${seasonId || ""}#setup-calendar`;
  }

  return `/admin/season-calendar?league=${leagueId || ""}&season=${seasonId || ""}`;
};


const timeFromLeague = (league) =>
  String(
    league?.raceTime || "",
  ).match(
    /\b([01]\d|2[0-3]):[0-5]\d\b/,
  )?.[0] ||
  "20:00";


/*
 * =====================================================
 * GP-TITEL AUS STRECKENSTAMM
 * =====================================================
 *
 * Beispiel:
 *
 * track.country = Miami
 * track.name = Miami International Autodrome
 *
 * => Großer Preis von Miami
 *
 * Die Flagge kann unabhängig davon weiterhin
 * über countryRecord kommen.
 */
function titleFromTrack(track) {
  const raceLocation =
    String(
      track?.country ||
      track?.countryRecord?.name ||
      "",
    ).trim();

  if (!raceLocation) {
    return "Großer Preis";
  }

  return `Großer Preis von ${raceLocation}`;
}


/*
 * =====================================================
 * RUNDEN AUTOMATISCH NORMALISIEREN
 * =====================================================
 *
 * Testtage:
 * sortOrder = 0
 *
 * Echte Rennen:
 * 1, 2, 3, 4 ...
 *
 * Dadurch entstehen nach dem Löschen keine Lücken.
 */
async function normalizeRaceOrders(
  leagueId,
  seasonId,
) {
  const events =
    await RaceEvent.findAll({
      where: {
        LeagueId:
          leagueId,

        SeasonId:
          seasonId,
      },

      order: [
        ["startsAt", "ASC"],
        ["id", "ASC"],
      ],
    });


  let raceNumber = 0;


  for (const event of events) {
    let nextOrder;


    /*
     * Testtage zählen nicht als Rennrunde.
     */
    if (event.isTestDay) {
      nextOrder = 0;
    } else {
      raceNumber += 1;

      nextOrder =
        raceNumber;
    }


    const changed =
      Number(
        event.sortOrder,
      ) !==
      Number(
        nextOrder,
      );


    if (changed) {
      await event.update({
        previousSortOrder:
          event.sortOrder,

        sortOrder:
          nextOrder,

        calendarChanged:
          true,
      });
    }


    /*
     * Zugehörige GP-Ergebnisse ebenfalls
     * auf dieselbe Rundennummer setzen.
     *
     * Sprint + Hauptrennen derselben Strecke
     * werden gemeinsam aktualisiert.
     */
    if (!event.isTestDay) {
      await GrandPrixResult.update(
        {
          sortOrder:
            nextOrder,
        },
        {
          where: {
            SeasonId:
              seasonId,

            LeagueId:
              leagueId,

            circuit:
              event.circuit,
          },
        },
      );
    }
  }
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
        ["sortOrder", "ASC"],
        ["id", "ASC"],
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
            ["status", "ASC"],
            ["sortOrder", "DESC"],
            ["id", "DESC"],
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
    selectedSeason
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
            ["sortOrder", "ASC"],
            ["startsAt", "ASC"],
            ["id", "ASC"],
          ],
        })
      : [];


  /*
   * Sprint wird über GrandPrixResult ermittelt.
   */
  const sprints =
    selectedSeason?.leagueType ===
    "f1"
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
            ["country", "ASC"],
            ["name", "ASC"],
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

exports.show =
  async (
    req,
    res,
  ) => {
    res.render(
      "admin/season-calendar",
      {
        title:
          "Rennkalender bearbeiten",

        ...(
          await loadData(
            req.query,
          )
        ),
      },
    );
  };


/*
 * =====================================================
 * TERMIN ANLEGEN
 * =====================================================
 */

exports.create =
  async (
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
        titleFromTrack(
          track,
        );


      const isTestDay =
        req.body.isTestDay ===
        "on";


      /*
       * Testtag:
       * immer Runde 0.
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
      }


      /*
       * Nur echte Rennen dürfen dieselbe
       * Rennnummer nicht doppelt verwenden.
       */
      if (!isTestDay) {
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


      const { main } =
        await seasonProgress.createManualRace(
          season.leagueType,
          {
            ...req.body,

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

        isTestDay,

        sortOrder:
          isTestDay
            ? 0
            : main.sortOrder,
      });


      /*
       * Nach dem Anlegen die Rennrunden
       * sicherheitshalber normalisieren.
       */
      await normalizeRaceOrders(
        league.id,
        season.id,
      );


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

exports.update =
  async (
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


      const isTestDay =
        req.body.isTestDay ===
        "on";


      let sortOrder;


      if (isTestDay) {
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
       * Doppelte Rennnummer nur bei
       * echten Rennen verhindern.
       */
      if (!isTestDay) {
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
        titleFromTrack(
          track,
        );


      const nextCircuit =
        track.name;


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
          ) ||

        Boolean(
          event.isTestDay,
        ) !==
          Boolean(
            isTestDay,
          );


      /*
       * Werte VOR dem Update merken.
       */
      const previousStartsAt =
        event.startsAt;


      const previousSortOrder =
        event.sortOrder;


      await event.update({
        title:
          nextTitle,

        circuit:
          nextCircuit,

        F1TrackId:
          track.id,

        startsAt,

        sortOrder,

        isTestDay,

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
      });


      /*
       * =================================================
       * HAUPTRENNEN + SPRINT SYNCHRONISIEREN
       * =================================================
       */

      if (
        event.grandPrixResult
      ) {
        const main =
          event.grandPrixResult;


        const oldCircuit =
          main.circuit;


        const oldSortOrder =
          main.sortOrder;


        await seasonProgress.updateRaceSettings(
          main.discipline,
          main.id,
          {
            pointsMode:
              main.pointsMode,

            hasSprint:
              req.body.hasSprint,
          },
        );


        /*
         * Sprint mit alter Strecke/Runde suchen,
         * bevor das Hauptrennen geändert wird.
         */
        const sprint =
          await GrandPrixResult.findOne({
            where: {
              SeasonId:
                main.SeasonId,

              LeagueId:
                main.LeagueId,

              circuit:
                oldCircuit,

              sortOrder:
                oldSortOrder,

              raceType:
                "sprint",
            },
          });


        await main.update({
          title:
            nextTitle,

          circuit:
            nextCircuit,

          raceDate:
            date,

          sortOrder:
            isTestDay
              ? 0
              : sortOrder,
        });


        if (sprint) {
          await sprint.update({
            title:
              `Sprint · ${nextCircuit}`,

            circuit:
              nextCircuit,

            raceDate:
              date,

            sortOrder:
              isTestDay
                ? 0
                : sortOrder,
          });
        }
      }


      /*
       * Nach Datum/Testtag-Änderungen
       * alle Rennrunden neu ordnen.
       */
      await normalizeRaceOrders(
        event.LeagueId,
        event.SeasonId,
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

exports.reorder =
  async (
    req,
    res,
  ) => {
    /*
     * Im Saison-Assistenten steckt die SeasonId
     * zusätzlich in der URL.
     */
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
          .map(Number)
          .filter(
            Number.isInteger,
          ),
      ),
    ];


    const season =
      await Season.findByPk(
        seasonId,
      );


    const league =
      await League.findByPk(
        leagueId,
      );


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
     * =================================================
     * TESTTAGE NICHT MITZÄHLEN
     * =================================================
     */

    let raceNumber = 0;


    for (
      let index = 0;
      index < ids.length;
      index++
    ) {
      const id =
        ids[index];


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


      let nextOrder;


      /*
       * Testtage immer 0.
       */
      if (event.isTestDay) {
        nextOrder = 0;
      } else {
        raceNumber += 1;

        nextOrder =
          raceNumber;
      }


      const changed =
        Number(
          event.sortOrder,
        ) !==
        Number(
          nextOrder,
        );


      await event.update({
        previousSortOrder:
          changed
            ? event.sortOrder
            : event.previousSortOrder,

        sortOrder:
          nextOrder,

        calendarChanged:
          changed ||
          event.calendarChanged,
      });


      /*
       * Haupt- und Sprintrennen auf dieselbe
       * Rundennummer setzen.
       */
      if (!event.isTestDay) {
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
            },
          },
        );
      }
    }


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

exports.remove =
  async (
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
    } = event;


    try {
      const main =
        GrandPrixResultId
          ? await GrandPrixResult.findByPk(
              GrandPrixResultId,
            )
          : null;


      /*
       * Kalendereintrag löschen.
       */
      await event.destroy();


      /*
       * Zugehöriges GP-Ergebnis
       * inkl. Sprint entfernen.
       */
      if (main) {
        await seasonProgress.removeRaceEvent(
          main.discipline,
          GrandPrixResultId,
        );
      }


      /*
       * =================================================
       * WICHTIG:
       * RENNEN DANACH LÜCKENLOS NEU NUMMERIEREN
       * =================================================
       */

      await normalizeRaceOrders(
        LeagueId,
        SeasonId,
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