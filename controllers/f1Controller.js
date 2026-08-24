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

function plain(value) {
  return value && typeof value.toJSON === "function" ? value.toJSON() : value;
}

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
   * GRUNDDATEN
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
     * GP Ergebnisse
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
     * F1 Autoprofile
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
     * Saisonstruktur
     */
    loadSeasonStructure(selectedSeason?.id),
  ]);

  /*
   * =====================================================
   * RENN-LINE-UP
   * =====================================================
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
   * AUTOPROFIL -> TEAM
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

        drivers: team.drivers.filter((driver) => driver.roleType === "regular"),
      }))
    : legacyTeams;

  /*
   * =====================================================
   * STAMMFAHRER
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

            accentColor: team.accentColor,
          },
        });
      }
    });
  });

  /*
   * SeasonLineupEntry bleibt der aktuelle Kader. Für die historische
   * Fahrer-WM werden zusätzlich alle Fahrer mit einem Stammfahrer-Stint
   * aufgenommen, damit ausgeschiedene Fahrer nicht verschwinden.
   */
  seasonStructure.stints
    .filter((stint) => stint.roleType === "regular" && stint.driver)
    .sort((left, right) => Number(left.fromRound) - Number(right.fromRound))
    .forEach((stint) => {
      const driver = plain(stint.driver);
      const stintTeam = plain(stint.seasonTeam);
      const driverId = Number(stint.DriverId || driver.id);
      if (!driverMap.has(driverId)) {
        driverMap.set(driverId, {
          ...driver,
          id: driverId,
          team: {
            id: stintTeam?.id || null,
            name: stintTeam?.name || "Privatteam",
            logoPath: stintTeam?.logoPath || null,
            accentColor: stintTeam?.accentColor || league.accentColor,
          },
        });
      }
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
   * LIGA DER AUSGEWÄHLTEN SAISON
   * =====================================================
   */

  const leagueForSeason = {
    ...league.toJSON(),

    currentSeason: selectedSeason?.name || league.currentSeason,

    accentColor: selectedSeason?.accentColor || league.accentColor,
  };

  /*
   * =====================================================
   * GP RESULT DISPLAY DATEN
   * =====================================================
   *
   * Hier werden nur zusätzliche View-Daten aufgebaut.
   * Die eigentlichen GP Ergebnisse werden NICHT verändert.
   */

  const plainLineups = raceLineupEntries.map(plain);

  const plainCalendar = activeCalendar.map(plain);

  /*
   * Sprint verwendet das Line-up
   * des Hauptrennens.
   */
  const mainRaceByWeekend = new Map(
    gpResults
      .filter((race) => race.raceType === "main")
      .map((race) => [
        `${race.SeasonId || ""}::${race.LeagueId || ""}::${race.circuit || ""}::${race.sortOrder || ""}`,

        race,
      ]),
  );

  function lineupForEntry(race, entry) {
    const direct = plainLineups.find(
      (lineup) =>
        Number(lineup.GrandPrixResultId) === Number(race.id) &&
        Number(lineup.DriverId) === Number(entry.DriverId),
    );

    if (direct) {
      return direct;
    }

    if (race.raceType !== "sprint") {
      return null;
    }

    const mainRace = mainRaceByWeekend.get(
      `${race.SeasonId || ""}::${race.LeagueId || ""}::${race.circuit || ""}::${race.sortOrder || ""}`,
    );

    if (!mainRace) {
      return null;
    }

    return (
      plainLineups.find(
        (lineup) =>
          Number(lineup.GrandPrixResultId) === Number(mainRace.id) &&
          Number(lineup.DriverId) === Number(entry.DriverId),
      ) || null
    );
  }

  function calendarForRace(race) {
    /*
     * Zuerst eindeutig über Strecke + Runde suchen.
     */
    const exactMatch = plainCalendar.find(
      (event) =>
        Number(event.sortOrder) === Number(race.sortOrder) &&
        String(event.circuit || "")
          .trim()
          .toLowerCase() ===
          String(race.circuit || "")
            .trim()
            .toLowerCase(),
    );

    if (exactMatch) {
      return exactMatch;
    }

    /*
     * Falls sich der Streckenname leicht unterscheidet:
     * nur über die Strecke versuchen.
     */
    const circuitMatch = plainCalendar.find(
      (event) =>
        String(event.circuit || "")
          .trim()
          .toLowerCase() ===
        String(race.circuit || "")
          .trim()
          .toLowerCase(),
    );

    if (circuitMatch) {
      return circuitMatch;
    }

    /*
     * SortOrder nur als allerletzten Fallback.
     */
    return (
      plainCalendar.find(
        (event) => Number(event.sortOrder) === Number(race.sortOrder),
      ) || null
    );
  }

  const decoratedGpResults = gpResults.map((raceValue) => {
    const race = plain(raceValue);

    const calendarEvent = calendarForRace(race);

    const track = plain(calendarEvent?.track) || null;

    const country = plain(track?.countryRecord) || null;

    return {
      ...race,

      /*
       * Titel aus dem Rennkalender.
       */
      displayTitle: calendarEvent?.title || race.title,

      /*
       * Streckenname aus Stammdaten.
       */
      displayCircuit: track?.name || calendarEvent?.circuit || race.circuit,

      /*
       * Land
       */
      countryName: country?.name || track?.country || null,

      countryFlagPath: country?.flagPath || null,

      /*
       * Rechts oben:
       *
       * Wenn irgendwann ein eigenes
       * Streckenlogo im Track vorhanden ist,
       * wird dieses verwendet.
       *
       * Aktuell Fallback auf Länderflagge.
       */
      trackLogoPath: track?.logoPath || country?.flagPath || null,

      entries: (race.entries || []).map(plain).map((entry) => {
        const lineup = lineupForEntry(race, entry);

        return {
          ...entry,

          /*
           * Nur tatsächlich eingesetzter
           * Ersatzfahrer.
           */
          isReserve:
            lineup?.roleType === "reserve" && lineup?.includeInResults === true,

          replacementForDriverId: lineup?.ReplacementForDriverId || null,
        };
      }),
    };
  });

  /*
   * =====================================================
   * STANDINGS
   * =====================================================
   */

  const standingsData = buildSeasonData(
    leagueForSeason,
    gpResults,
    drivers,
    raceLineupEntries,
    selectedSeason,
    seasonStructure.stints,
  );

  /*
   * =====================================================
   * RETURN
   * =====================================================
   */

  return {
    league: leagueForSeason,

    teams,

    drivers,

    gpResults: decoratedGpResults,

    calendar,

    seasons,

    selectedSeason,

    ...standingsData,
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

    `${data.league.slug}-${data.selectedSeason?.name || data.league.currentSeason}-fahrer-wm.csv`,

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

    `${data.league.slug}-${data.selectedSeason?.name || data.league.currentSeason}-team-wm.csv`,

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

        race.displayTitle || race.title,

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

    `${data.league.slug}-${data.selectedSeason?.name || data.league.currentSeason}-gp-results.csv`,

    rows,
  );
};

/*
 * Für andere Controller / Tests verfügbar.
 */
module.exports.loadLeagueData = loadLeagueData;
