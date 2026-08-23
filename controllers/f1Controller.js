const { Op } = require("sequelize");

const {
  League,
  TeamRoster,
  TeamRosterDriver,
  Season,
  GrandPrixResult,
  GrandPrixResultEntry,
  RaceEvent,
  SeasonF1CarAssignment,
  F1RaceLineupEntry,
} = require("../models");

const { buildSeasonData } = require("../services/standings");

const { sendCsv } = require("../services/csv");

const { loadSeasonStructure } = require("../services/f1Season");

async function loadLeagueData(slug, requestedSeasonId) {
  /*
   * =====================================================
   * LIGA
   * =====================================================
   */

  const league = await League.findOne({
    where: {
      slug,
      type: "f1",
    },
  });

  if (!league) {
    return null;
  }

  /*
   * =====================================================
   * SAISONS
   * =====================================================
   */

  const seasons = await Season.findAll({
    where: {
      leagueType: "f1",

      scopeSlug: slug,

      isPublished: true,
    },

    include: [
      {
        association: "category",
      },
    ],

    order: [
      ["status", "ASC"],
      ["sortOrder", "DESC"],
      ["id", "DESC"],
    ],
  });

  const selectedSeason =
    seasons.find((season) => Number(season.id) === Number(requestedSeasonId)) ||
    seasons.find((season) => season.status === "active") ||
    seasons[0] ||
    null;

  /*
   * =====================================================
   * GP RESULT WHERE
   * =====================================================
   */

  const where = selectedSeason
    ? {
        LeagueId: league.id,

        SeasonId: selectedSeason.id,

        discipline: "f1",
      }
    : {
        LeagueId: league.id,

        season: league.currentSeason,
      };

  /*
   * =====================================================
   * GRUNDDATEN LADEN
   * =====================================================
   */

  const [
    rosters,
    gpResults,
    activeCalendar,
    seasonCarAssignments,
    seasonStructure,
  ] = await Promise.all([
    /*
     * Legacy Team-Roster
     */
    TeamRoster.findAll({
      where: {
        LeagueId: league.id,

        discipline: "f1",
      },

      include: [
        {
          association: "team",
        },

        {
          association: "assignments",

          include: [
            {
              association: "driver",

              include: [
                {
                  association: "aliases",
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
            model: TeamRosterDriver,

            as: "assignments",
          },

          "sortOrder",

          "ASC",
        ],
      ],
    }),

    /*
     * GP-Ergebnisse
     */
    GrandPrixResult.findAll({
      where,

      include: [
        {
          model: GrandPrixResultEntry,

          as: "entries",
        },
      ],

      order: [
        ["sortOrder", "ASC"],

        ["raceType", "DESC"],

        ["raceDate", "ASC"],

        [
          {
            model: GrandPrixResultEntry,

            as: "entries",
          },

          "sortOrder",

          "ASC",
        ],

        [
          {
            model: GrandPrixResultEntry,

            as: "entries",
          },

          "position",

          "ASC",
        ],
      ],
    }),

    /*
     * Rennkalender
     */
    selectedSeason
      ? RaceEvent.findAll({
          where: {
            LeagueId: league.id,

            SeasonId: selectedSeason.id,
          },

          include: [
            {
              association: "track",

              include: [
                {
                  association: "countryRecord",
                },
              ],
            },
          ],

          order: [
            ["sortOrder", "ASC"],

            ["startsAt", "ASC"],
          ],
        })
      : [],

    /*
     * Saison-Autoprofile
     */
    selectedSeason
      ? SeasonF1CarAssignment.findAll({
          where: {
            SeasonId: selectedSeason.id,
          },

          include: [
            {
              association: "carProfile",
            },
          ],
        })
      : [],

    /*
     * Saison-Line-up
     */
    loadSeasonStructure(selectedSeason?.id),
  ]);

  /*
   * =====================================================
   * RENN-LINE-UPS
   * =====================================================
   *
   * Wichtig:
   * Keine nicht existierende Association
   * "grandPrixResult" benutzen.
   *
   * Stattdessen über GrandPrixResultId filtern.
   */

  const raceIds = gpResults
    .filter((race) => race.raceType === "main")
    .map((race) => Number(race.id));

  const raceLineupEntries = raceIds.length
    ? await F1RaceLineupEntry.findAll({
        where: {
          GrandPrixResultId: {
            [Op.in]: raceIds,
          },
        },

        include: [
          {
            association: "driver",
          },

          {
            association: "replacementFor",
          },

          {
            association: "team",
          },
        ],

        order: [
          ["GrandPrixResultId", "ASC"],

          ["sortOrder", "ASC"],

          ["id", "ASC"],
        ],
      })
    : [];

  /*
   * =====================================================
   * AUTOPROFILE -> TEAM
   * =====================================================
   */

  const carProfileByTeam = new Map(
    seasonCarAssignments.map((assignment) => [
      Number(assignment.TeamId),

      assignment.carProfile,
    ]),
  );

  /*
   * =====================================================
   * LEGACY TEAMS
   * =====================================================
   */

  const driverMap = new Map();

  const legacyTeams = rosters
    .map((roster) => {
      const carProfile = carProfileByTeam.get(Number(roster.team.id));

      return {
        id: roster.team.id,

        name: roster.team.name,

        accentColor: carProfile?.accentColor || roster.team.accentColor,

        logoPath: carProfile?.logoPath || roster.team.logoPath,

        carProfileName: carProfile?.name || null,

        rosterId: roster.id,

        drivers: roster.assignments

          .filter((assignment) => assignment.roleName !== "Ersatzfahrer")

          .map((assignment) => ({
            ...assignment.driver.toJSON(),

            rosterRole: assignment.roleName,
          })),
      };
    })

    .filter((team) => team.drivers.length >= 2);

  /*
   * =====================================================
   * SAISONTEAMS
   * =====================================================
   */

  const teams = seasonStructure.teams.length
    ? seasonStructure.teams.map((team) => ({
        id: team.id,

        name: team.name,

        accentColor: team.accentColor,

        logoPath: team.logoPath,

        /*
         * Hier ausschließlich Stammfahrer.
         */
        drivers: team.drivers.filter((driver) => driver.roleType === "regular"),
      }))
    : legacyTeams;

  /*
   * =====================================================
   * STAMMFAHRER AUFBAUEN
   * =====================================================
   */

  teams.forEach((team) => {
    team.drivers.forEach((driver) => {
      const driverId = Number(driver.id);

      if (!driverMap.has(driverId)) {
        driverMap.set(driverId, {
          ...driver,

          id: driverId,

          team: {
            id: team.id,

            name: team.name,

            logoPath: team.logoPath,
          },
        });
      }
    });
  });

  const drivers = [...driverMap.values()];

  /*
   * =====================================================
   * KALENDER
   * =====================================================
   */

  const sprintKeys = new Set(
    gpResults
      .filter((race) => race.raceType === "sprint")
      .map((race) => `${race.circuit}::${race.sortOrder}`),
  );

  const calendar = activeCalendar.length
    ? activeCalendar.map((event) => ({
        ...event.toJSON(),

        hasSprint: sprintKeys.has(`${event.circuit}::${event.sortOrder}`),
      }))
    : gpResults
        .filter((race) => race.raceType === "main" && race.raceDate)
        .map((race) => ({
          id: `result-${race.id}`,
          title: race.title,
          circuit: race.circuit,
          startsAt: new Date(`${race.raceDate}T12:00:00Z`),
          sortOrder: race.sortOrder,

          hasSprint: sprintKeys.has(`${race.circuit}::${race.sortOrder}`),
        }));

  /*
   * =====================================================
   * LIGA FÜR AUSGEWÄHLTE SAISON
   * =====================================================
   */

  const leagueForSeason = {
    ...league.toJSON(),

    currentSeason: selectedSeason?.name || league.currentSeason,

    accentColor: selectedSeason?.accentColor || league.accentColor,
  };

  /*
   * =====================================================
   * RETURN
   * =====================================================
   */

  return {
    league: leagueForSeason,

    teams,

    drivers,

    gpResults,

    calendar,

    seasons,

    selectedSeason,

    /*
     * Stammfahrer-WM +
     * Ersatzfahrerwertung +
     * Saisonentwicklung
     */
    ...buildSeasonData(
      leagueForSeason,
      gpResults,
      drivers,
      raceLineupEntries,
      selectedSeason,
    ),
  };
}

/*
 * =====================================================
 * ÖFFENTLICHE F1-SEITE
 * =====================================================
 */

exports.show = async (req, res) => {
  const data = await loadLeagueData(req.params.slug, req.query.season);

  if (!data) {
    return res.status(404).render("errors/404", {
      title: "Liga nicht gefunden",
    });
  }

  res.render("f1", {
    title: data.league.name,

    ...data,
  });
};

/*
 * =====================================================
 * FAHRER-WM CSV
 * =====================================================
 */

exports.downloadDriverStandings = async (req, res) => {
  const data = await loadLeagueData(req.params.slug, req.query.season);

  if (!data) {
    return res.status(404).end();
  }

  const rows = [["Position", "Fahrer", "Team", "Punkte", "Siege", "Rückstand"]];

  data.driverStandings.forEach((row) => {
    rows.push([
      row.position,

      row.driver.name,

      row.driver.team?.name || "",

      row.points,

      row.wins,

      row.gap,
    ]);
  });

  sendCsv(
    res,

    `${data.league.slug}-${
      data.selectedSeason?.name || data.league.currentSeason
    }-fahrer-wm.csv`,

    rows,
  );
};

/*
 * =====================================================
 * TEAM-WM CSV
 * =====================================================
 */

exports.downloadTeamStandings = async (req, res) => {
  const data = await loadLeagueData(req.params.slug, req.query.season);

  if (!data) {
    return res.status(404).end();
  }

  const rows = [["Position", "Team", "Punkte", "Siege", "Rückstand"]];

  data.teamStandings.forEach((row) => {
    rows.push([row.position, row.team.name, row.points, row.wins, row.gap]);
  });

  sendCsv(
    res,

    `${data.league.slug}-${
      data.selectedSeason?.name || data.league.currentSeason
    }-team-wm.csv`,

    rows,
  );
};

/*
 * =====================================================
 * GP RESULTS CSV
 * =====================================================
 */

exports.downloadGpResults = async (req, res) => {
  const data = await loadLeagueData(req.params.slug, req.query.season);

  if (!data) {
    return res.status(404).end();
  }

  const rows = [
    [
      "Runde",
      "Grand Prix",
      "Datum",
      "Position",
      "Status",
      "Fahrer",
      "Team",
      "Punkte",
      "Schnellste Runde",
    ],
  ];

  data.gpResults.forEach((race, raceIndex) => {
    race.entries.forEach((entry) => {
      rows.push([
        race.sortOrder || raceIndex + 1,

        race.title,

        race.raceDate || "",

        entry.position || "",

        entry.status || "",

        entry.driverName,

        entry.teamName || "",

        Number(entry.points),

        entry.fastestLap ? "Ja" : "Nein",
      ]);
    });
  });

  sendCsv(
    res,

    `${data.league.slug}-${
      data.selectedSeason?.name || data.league.currentSeason
    }-gp-results.csv`,

    rows,
  );
};

/*
 * Für andere Controller/Tests verfügbar.
 */
module.exports.loadLeagueData = loadLeagueData;
