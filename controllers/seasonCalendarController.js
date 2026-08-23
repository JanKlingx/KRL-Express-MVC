const { Op } = require("sequelize");

const {
  League,
  Season,
  RaceEvent,
  GrandPrixResult,
  F1Track,
} = require("../models");

const seasonProgress =
  require("../services/seasonProgress");


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
  req = null
) => {
  if (
    req?.originalUrl?.includes(
      "/season-setup/"
    )
  ) {
    return `/admin/season-setup?league=${leagueId || ""}&season=${seasonId || ""}#setup-calendar`;
  }

  return `/admin/season-calendar?league=${leagueId || ""}&season=${seasonId || ""}`;
};


const timeFromLeague = (league) =>
  String(
    league?.raceTime || ""
  ).match(
    /\b([01]\d|2[0-3]):[0-5]\d\b/
  )?.[0] || "20:00";


/*
 * =====================================================
 * DATEN LADEN
 * =====================================================
 */

async function loadData(query = {}) {

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


  const selectedLeague =
    leagues.find(
      (league) =>
        league.id ===
        Number(query.league)
    ) ||
    leagues[0] ||
    null;


  const discipline =
    disciplineFor(selectedLeague);


  const seasons =
    selectedLeague
      ? await Season.findAll({
          where: {
            leagueType: discipline,
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
        Number(query.season)
    ) ||
    seasons.find(
      (season) =>
        season.status === "active"
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
              association: "track",

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

            raceType: "sprint",
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
          `${race.circuit}::${race.sortOrder}`
      )
    );


  const events =
    rawEvents.map((event) => ({
      ...event.toJSON(),

      hasSprint:
        sprintKeys.has(
          `${event.circuit}::${event.sortOrder}`
        ),
    }));


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
        selectedLeague
      ),
  };
}


/*
 * =====================================================
 * KALENDERSEITE
 * =====================================================
 */

exports.show = async (req, res) => {

  res.render(
    "admin/season-calendar",
    {
      title:
        "Rennkalender bearbeiten",

      ...(await loadData(
        req.query
      )),
    }
  );
};


/*
 * =====================================================
 * TERMIN ANLEGEN
 * =====================================================
 */

exports.create = async (
  req,
  res
) => {

  let league;
  let season;

  try {

    season =
      await Season.findByPk(
        req.body.SeasonId
      );


    league =
      await League.findByPk(
        req.body.LeagueId
      );


    if (
      !season ||
      !league ||
      season.scopeSlug !==
        league.slug ||
      season.leagueType !==
        disciplineFor(league)
    ) {
      throw new Error(
        "Saison und Liga passen nicht zusammen."
      );
    }


    const date =
      String(
        req.body.date || ""
      );


    const time =
      timeFromLeague(league);


    const startsAt =
      new Date(
        `${date}T${time}:00`
      );


    if (
      Number.isNaN(
        startsAt.getTime()
      )
    ) {
      throw new Error(
        "Datum oder Startzeit ist ungültig."
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
        }
      );


    if (!track) {
      throw new Error(
        "Bitte eine Strecke aus dem Formel-1-Streckenstamm auswählen."
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


    const sortOrder =
      Number(
        req.body.sortOrder
      );


    if (
      !Number.isInteger(
        sortOrder
      ) ||
      sortOrder < 1
    ) {
      throw new Error(
        "Die Rennen-Nummer muss größer als 0 sein."
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
        },
      });


    if (duplicateRound) {
      throw new Error(
        `Rennen Nr. ${sortOrder} ist in dieser Saison bereits belegt.`
      );
    }


    const { main } =
      await seasonProgress
        .createManualRace(
          season.leagueType,
          {
            ...req.body,

            sortOrder,
            title,
            circuit,
            raceDate: date,

            pointsMode:
              "database",

            hasSprint:
              req.body.hasSprint,
          }
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
        req.body.isTestDay ===
        "on",

      sortOrder:
        main.sortOrder,
    });


    req.session.flash = {
      type: "success",
      message:
        "Kalendereintrag wurde gespeichert.",
    };


    return res.redirect(
      redirectTo(
        league.id,
        season.id,
        req
      )
    );

  } catch (error) {

    req.session.flash = {
      type: "error",
      message:
        error.message,
    };


    return res.redirect(
      redirectTo(
        league?.id ||
          req.body.LeagueId,

        season?.id ||
          req.body.SeasonId,

        req
      )
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
  next
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
      }
    );


  if (!event) {
    return next();
  }


  try {

    const date =
      String(
        req.body.date || ""
      );


    const time =
      timeFromLeague(
        event.league
      );


    const startsAt =
      new Date(
        `${date}T${time}:00`
      );


    if (
      Number.isNaN(
        startsAt.getTime()
      )
    ) {
      throw new Error(
        "Datum oder Startzeit ist ungültig."
      );
    }


    const sortOrder =
      Number(
        req.body.sortOrder ||
        event.sortOrder ||
        0
      );


    if (
      !Number.isInteger(
        sortOrder
      ) ||
      sortOrder < 1
    ) {
      throw new Error(
        "Die Rennen-Nummer muss größer als 0 sein."
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
        }
      );


    if (!track) {
      throw new Error(
        "Bitte eine Strecke aus dem Formel-1-Streckenstamm auswählen."
      );
    }


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
        },
      });


    if (duplicateRound) {
      throw new Error(
        `Rennen Nr. ${sortOrder} ist bereits belegt.`
      );
    }


    const nextTitle =
      `Großer Preis von ${
        track.countryRecord
          ?.name ||
        track.country
      }`;


    const nextCircuit =
      track.name;


    const changed =
      new Date(
        event.startsAt
      ).getTime() !==
        startsAt.getTime() ||

      Number(
        event.sortOrder
      ) !== sortOrder ||

      Number(
        event.F1TrackId
      ) !==
        Number(track.id);


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

      isTestDay:
        req.body.isTestDay ===
        "on",

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
     * Hauptrennen + Sprint synchronisieren
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


      await seasonProgress
        .updateRaceSettings(
          main.discipline,
          main.id,
          {
            pointsMode:
              main.pointsMode,

            hasSprint:
              req.body.hasSprint,
          }
        );


      const sprint =
        await GrandPrixResult
          .findOne({
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

        sortOrder,
      });


      if (sprint) {

        await sprint.update({
          title:
            `Sprint · ${nextCircuit}`,

          circuit:
            nextCircuit,

          raceDate:
            date,

          sortOrder,
        });
      }
    }


    req.session.flash = {
      type: "success",
      message:
        "Kalender wurde gespeichert.",
    };

  } catch (error) {

    req.session.flash = {
      type: "error",
      message:
        error.message,
    };
  }


  return res.redirect(
    redirectTo(
      event.LeagueId,
      event.SeasonId,
      req
    )
  );
};


/*
 * =====================================================
 * REIHENFOLGE SPEICHERN
 * =====================================================
 */

exports.reorder = async (
  req,
  res
) => {

  /*
   * Im Saison-Assistenten steckt die SeasonId
   * zusätzlich in der URL.
   */

  const seasonId =
    Number(
      req.body.SeasonId ||
      req.params.seasonId
    );


  const leagueId =
    Number(
      req.body.LeagueId
    );


  if (
    !Number.isInteger(
      seasonId
    ) ||
    !Number.isInteger(
      leagueId
    )
  ) {
    throw new Error(
      "Liga und Saison wurden nicht korrekt übergeben."
    );
  }


  const ids = [
    ...new Set(
      []
        .concat(
          req.body.eventIds ||
          []
        )
        .map(Number)
        .filter(
          Number.isInteger
        )
    ),
  ];


  const season =
    await Season.findByPk(
      seasonId
    );


  const league =
    await League.findByPk(
      leagueId
    );


  if (
    !season ||
    !league ||
    !ids.length
  ) {
    throw new Error(
      "Liga, Saison und Kalenderreihenfolge sind erforderlich."
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
      "Die Kalenderreihenfolge enthält ungültige Termine."
    );
  }


  /*
   * Nacheinander speichern.
   *
   * Dadurch vermeiden wir unnötige Race Conditions.
   */

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
          Number(entry.id) ===
          Number(id)
      );


    if (!event) {
      continue;
    }


    const nextOrder =
      index + 1;


    const changed =
      Number(
        event.sortOrder
      ) !== nextOrder;


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
      }
    );
  }


  req.session.flash = {
    type: "success",
    message:
      "Kalenderreihenfolge wurde gespeichert.",
  };


  return res.redirect(
    redirectTo(
      league.id,
      season.id,
      req
    )
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
  next
) => {

  const event =
    await RaceEvent.findByPk(
      req.params.eventId
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
        ? await GrandPrixResult
            .findByPk(
              GrandPrixResultId
            )
        : null;


    await event.destroy();


    if (main) {

      await seasonProgress
        .removeRaceEvent(
          main.discipline,
          GrandPrixResultId
        );
    }


    req.session.flash = {
      type: "success",
      message:
        "Kalendereintrag wurde gelöscht.",
    };

  } catch (error) {

    req.session.flash = {
      type: "error",
      message:
        error.message,
    };
  }


  return res.redirect(
    redirectTo(
      LeagueId,
      SeasonId,
      req
    )
  );
};