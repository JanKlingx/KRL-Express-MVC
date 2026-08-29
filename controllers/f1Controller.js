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
  PenaltyEntry,
  F1PenaltySetting,
} = require("../models");

const { buildSeasonData } = require("../services/standings");
const { sendCsv } = require("../services/csv");
const { loadSeasonStructure } = require("../services/f1Season");

const {
  buildLeagueLedger,
  buildGlobalLedgers,
} = require("./penaltyLedgerController");

function plain(value) {
  return value && typeof value.toJSON === "function"
    ? value.toJSON()
    : value;
}

async function loadLeagueData(slug, requestedSeasonId) {
  const league = await League.findOne({
    where: {
      slug,
      type: "f1",
    },
  });

  if (!league) {
    return null;
  }

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
      {
        association: "f1Game",
        required: false,
      },
    ],

    order: [
      ["status", "ASC"],
      ["sortOrder", "DESC"],
      ["id", "DESC"],
    ],
  });

  const selectedSeason =
    seasons.find(
      (season) =>
        Number(season.id) ===
        Number(requestedSeasonId),
    ) ||
    seasons.find(
      (season) =>
        season.status === "active",
    ) ||
    seasons[0] ||
    null;

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

  const [
    rosters,
    gpResults,
    activeCalendar,
    seasonCarAssignments,
    storedSeasonStructure,
    penaltyEntries,
    penaltySetting,
  ] = await Promise.all([
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
                  association:
                    "countryRecord",
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

    loadSeasonStructure(
      selectedSeason?.id,
    ),

    selectedSeason
      ? PenaltyEntry.findAll({
          where: {
            LeagueId: league.id,
            SeasonId: selectedSeason.id,
          },

          order: [
            ["roundNumber", "ASC"],
            ["id", "ASC"],
          ],
        })
      : [],

    F1PenaltySetting.findOne({
      where: {
        LeagueId: league.id,
      },
    }),
  ]);

  const completedMainRound =
    gpResults
      .filter(
        (race) =>
          race.raceType === "main" &&
          race.entries?.length,
      )
      .reduce(
        (maximum, race) =>
          Math.max(
            maximum,
            Number(race.sortOrder) || 0,
          ),
        0,
      );

  const structureRound =
    selectedSeason?.status ===
    "historical"
      ? Math.max(
          1,
          completedMainRound,
        )
      : completedMainRound + 1;

  const seasonStructure =
    selectedSeason
      ? await loadSeasonStructure(
          selectedSeason.id,
          structureRound,
        )
      : storedSeasonStructure;

  const raceIds =
    gpResults
      .filter(
        (race) =>
          race.raceType === "main",
      )
      .map(
        (race) =>
          Number(race.id),
      );

  const raceLineupEntries =
    raceIds.length
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
              association:
                "replacementFor",
            },

            {
              association: "team",
            },
          ],

          order: [
            [
              "GrandPrixResultId",
              "ASC",
            ],
            ["sortOrder", "ASC"],
            ["id", "ASC"],
          ],
        })
      : [];

  const carProfileByTeam =
    new Map(
      seasonCarAssignments.map(
        (assignment) => [
          Number(
            assignment.TeamId,
          ),
          assignment.carProfile,
        ],
      ),
    );

  const driverMap =
    new Map();

  const legacyTeams =
    rosters
      .map((roster) => {
        const carProfile =
          carProfileByTeam.get(
            Number(
              roster.team.id,
            ),
          );

        return {
          id:
            roster.team.id,

          name:
            roster.team.name,

          accentColor:
            carProfile
              ?.accentColor ||
            roster.team
              .accentColor,

          logoPath:
            carProfile
              ?.logoPath ||
            roster.team
              .logoPath,

          carProfileName:
            carProfile?.name ||
            null,

          rosterId:
            roster.id,

          drivers:
            roster.assignments
              .filter(
                (assignment) =>
                  assignment
                    .roleName !==
                  "Ersatzfahrer",
              )
              .map(
                (assignment) => ({
                  ...assignment
                    .driver
                    .toJSON(),

                  rosterRole:
                    assignment
                      .roleName,
                }),
              ),
        };
      })
      .filter(
        (team) =>
          team.drivers.length >=
          2,
      );

  const teams =
    seasonStructure.teams.length
      ? seasonStructure.teams.map(
          (team) => ({
            id:
              team.id,

            name:
              team.name,

            accentColor:
              team.accentColor,

            logoPath:
              team.logoPath,

            drivers:
              team.drivers.filter(
                (driver) =>
                  driver.roleType ===
                  "regular",
              ),
          }),
        )
      : legacyTeams;

  teams.forEach((team) => {
    team.drivers.forEach(
      (driver) => {
        const driverId =
          Number(driver.id);

        if (
          !driverMap.has(
            driverId,
          )
        ) {
          driverMap.set(
            driverId,
            {
              ...driver,

              id:
                driverId,

              team: {
                id:
                  team.id,

                name:
                  team.name,

                logoPath:
                  team.logoPath,

                accentColor:
                  team.accentColor,
              },
            },
          );
        }
      },
    );
  });

  seasonStructure.stints
    .filter(
      (stint) =>
        stint.roleType ===
          "regular" &&
        stint.driver,
    )
    .sort(
      (left, right) =>
        Number(
          left.fromRound,
        ) -
        Number(
          right.fromRound,
        ),
    )
    .forEach((stint) => {
      const driver =
        plain(stint.driver);

      const stintTeam =
        plain(
          stint.seasonTeam,
        );

      const driverId =
        Number(
          stint.DriverId ||
            driver.id,
        );

      if (
        !driverMap.has(
          driverId,
        )
      ) {
        driverMap.set(
          driverId,
          {
            ...driver,

            id:
              driverId,

            team: {
              id:
                stintTeam?.id ||
                null,

              name:
                stintTeam?.name ||
                "Privatteam",

              logoPath:
                stintTeam
                  ?.logoPath ||
                null,

              accentColor:
                stintTeam
                  ?.accentColor ||
                league.accentColor,
            },
          },
        );
      }
    });

  const drivers =
    [...driverMap.values()];

  const sprintKeys =
    new Set(
      gpResults
        .filter(
          (race) =>
            race.raceType ===
            "sprint",
        )
        .map(
          (race) =>
            `${race.circuit}::${race.sortOrder}`,
        ),
    );

  const calendar =
    activeCalendar.length
      ? activeCalendar.map(
          (event) => ({
            ...event.toJSON(),

            hasSprint:
              sprintKeys.has(
                `${event.circuit}::${event.sortOrder}`,
              ),
          }),
        )
      : gpResults
          .filter(
            (race) =>
              race.raceType ===
                "main" &&
              race.raceDate,
          )
          .map((race) => ({
            id:
              `result-${race.id}`,

            title:
              race.title,

            circuit:
              race.circuit,

            startsAt:
              new Date(
                `${race.raceDate}T12:00:00Z`,
              ),

            sortOrder:
              race.sortOrder,

            hasSprint:
              sprintKeys.has(
                `${race.circuit}::${race.sortOrder}`,
              ),
          }));

  const leagueForSeason = {
    ...league.toJSON(),

    currentSeason:
      selectedSeason?.name ||
      league.currentSeason,

    accentColor:
      selectedSeason
        ?.accentColor ||
      league.accentColor,
  };

  const plainLineups =
    raceLineupEntries.map(
      plain,
    );

  const plainCalendar =
    activeCalendar.map(
      plain,
    );

  const mainRaceByWeekend =
    new Map(
      gpResults
        .filter(
          (race) =>
            race.raceType ===
            "main",
        )
        .map((race) => [
          `${race.SeasonId || ""}::${race.LeagueId || ""}::${race.circuit || ""}::${race.sortOrder || ""}`,
          race,
        ]),
    );

  function lineupForEntry(
    race,
    entry,
  ) {
    const direct =
      plainLineups.find(
        (lineup) =>
          Number(
            lineup
              .GrandPrixResultId,
          ) ===
            Number(race.id) &&
          Number(
            lineup.DriverId,
          ) ===
            Number(
              entry.DriverId,
            ),
      );

    if (direct) {
      return direct;
    }

    if (
      race.raceType !==
      "sprint"
    ) {
      return null;
    }

    const mainRace =
      mainRaceByWeekend.get(
        `${race.SeasonId || ""}::${race.LeagueId || ""}::${race.circuit || ""}::${race.sortOrder || ""}`,
      );

    if (!mainRace) {
      return null;
    }

    return (
      plainLineups.find(
        (lineup) =>
          Number(
            lineup
              .GrandPrixResultId,
          ) ===
            Number(
              mainRace.id,
            ) &&
          Number(
            lineup.DriverId,
          ) ===
            Number(
              entry.DriverId,
            ),
      ) || null
    );
  }

  function calendarForRace(
    race,
  ) {
    const exactMatch =
      plainCalendar.find(
        (event) =>
          Number(
            event.sortOrder,
          ) ===
            Number(
              race.sortOrder,
            ) &&
          String(
            event.circuit || "",
          )
            .trim()
            .toLowerCase() ===
            String(
              race.circuit || "",
            )
              .trim()
              .toLowerCase(),
      );

    if (exactMatch) {
      return exactMatch;
    }

    const circuitMatch =
      plainCalendar.find(
        (event) =>
          String(
            event.circuit || "",
          )
            .trim()
            .toLowerCase() ===
          String(
            race.circuit || "",
          )
            .trim()
            .toLowerCase(),
      );

    if (circuitMatch) {
      return circuitMatch;
    }

    return (
      plainCalendar.find(
        (event) =>
          Number(
            event.sortOrder,
          ) ===
          Number(
            race.sortOrder,
          ),
      ) || null
    );
  }

  const decoratedGpResults =
    gpResults.map(
      (raceValue) => {
        const race =
          plain(raceValue);

        const calendarEvent =
          calendarForRace(
            race,
          );

        const track =
          plain(
            calendarEvent?.track,
          ) || null;

        const country =
          plain(
            track?.countryRecord,
          ) || null;

        return {
          ...race,

          displayTitle:
            calendarEvent?.title ||
            race.title,

          displayCircuit:
            track?.name ||
            calendarEvent
              ?.circuit ||
            race.circuit,

          countryName:
            country?.name ||
            track?.country ||
            null,

          countryFlagPath:
            country?.flagPath ||
            null,

          trackLogoPath:
            track?.logoPath ||
            country?.flagPath ||
            null,

          isTestDay:
            Boolean(
              calendarEvent
                ?.isTestDay,
            ),

          entries:
            (
              race.entries || []
            )
              .map(plain)
              .map((entry) => {
                const lineup =
                  lineupForEntry(
                    race,
                    entry,
                  );

                return {
                  ...entry,

                  isReserve:
                    lineup
                      ?.roleType ===
                      "reserve" &&
                    lineup
                      ?.includeInResults ===
                      true,

                  replacementForDriverId:
                    lineup
                      ?.ReplacementForDriverId ||
                    null,
                };
              }),
        };
      },
    );

  const raceStatistics =
    decoratedGpResults
      .filter(
        (race) =>
          race.raceType ===
            "main" &&
          !race.isTestDay,
      )
      .map((race) => {
        const ordered = [
          ...(race.entries || []),
        ].sort(
          (left, right) =>
            Number(
              left.position ||
                999,
            ) -
            Number(
              right.position ||
                999,
            ),
        );

        return {
          round:
            race.sortOrder,

          circuit:
            race.displayCircuit ||
            race.circuit ||
            race.displayTitle,

          flagPath:
            race.countryFlagPath,

          countryName:
            race.countryName,

          date:
            race.raceDate,

          driverOfTheDay:
            ordered.find(
              (entry) =>
                entry.driverOfTheDay,
            )?.driverName ||
            null,

          first:
            ordered.find(
              (entry) =>
                Number(
                  entry.position,
                ) === 1,
            )?.driverName ||
            null,

          second:
            ordered.find(
              (entry) =>
                Number(
                  entry.position,
                ) === 2,
            )?.driverName ||
            null,

          third:
            ordered.find(
              (entry) =>
                Number(
                  entry.position,
                ) === 3,
            )?.driverName ||
            null,

          pole:
            ordered.find(
              (entry) =>
                entry.polePosition,
            )?.driverName ||
            null,

          fastestLap:
            ordered.find(
              (entry) =>
                entry.fastestLap,
            )?.driverName ||
            null,
        };
      });

  const standingsData =
    buildSeasonData(
      leagueForSeason,
      gpResults,
      drivers,
      raceLineupEntries,
      selectedSeason,
      seasonStructure.stints,
    );

  if (
    standingsData
      .selectedHistory
      ?.races
  ) {
    standingsData
      .selectedHistory
      .races
      .forEach(
        (historyRace) => {
          const round =
            Number(
              historyRace.round,
            );

          const calendarEvent =
            activeCalendar.find(
              (event) =>
                Number(
                  event.sortOrder,
                ) === round,
            );

          const calendarPlain =
            plain(
              calendarEvent,
            );

          const track =
            plain(
              calendarPlain?.track,
            );

          const country =
            plain(
              track?.countryRecord,
            );

          const mainResult =
            gpResults.find(
              (race) =>
                race.raceType ===
                  "main" &&
                Number(
                  race.sortOrder,
                ) === round,
            );

          const completed =
            Boolean(
              mainResult &&
                Array.isArray(
                  mainResult.entries,
                ) &&
                mainResult
                  .entries
                  .length > 0,
            );

          historyRace.countryFlagPath =
            country?.flagPath ||
            null;

          historyRace.countryName =
            country?.name ||
            track?.country ||
            null;

          historyRace.trackName =
            track?.name ||
            calendarPlain
              ?.circuit ||
            historyRace.circuit ||
            null;

          historyRace.isCompleted =
            completed;
        },
      );
  }

  const penaltyThreshold =
    Number(
      penaltySetting
        ?.pointsLimit ||
        12,
    );

  const penaltyRoundMap =
    new Map();

  activeCalendar
    .filter(
      (event) =>
        !event.isTestDay,
    )
    .forEach((event) => {
      const roundNumber =
        Number(
          event.sortOrder ||
            0,
        );

      if (
        !Number.isInteger(
          roundNumber,
        ) ||
        roundNumber < 1 ||
        penaltyRoundMap.has(
          roundNumber,
        )
      ) {
        return;
      }

      const eventPlain =
        plain(event);

      const track =
        plain(
          eventPlain?.track,
        );

      const country =
        plain(
          track?.countryRecord,
        );

      penaltyRoundMap.set(
        roundNumber,
        {
          roundNumber,

          title:
            event.title,

          circuit:
            track?.name ||
            event.circuit ||
            null,

          country:
            country?.name ||
            track?.country ||
            null,

          flagPath:
            country?.flagPath ||
            null,
        },
      );
    });

  const penaltyRounds = [
    ...penaltyRoundMap.values(),
  ].sort(
    (left, right) =>
      left.roundNumber -
      right.roundNumber,
  );

  const penaltyTeamByDriver =
    new Map();

  for (
    const team of
    seasonStructure.teams ||
    []
  ) {
    for (
      const driver of
      team.drivers ||
      []
    ) {
      const driverId =
        Number(
          driver.id ||
            driver.DriverId,
        );

      if (!driverId) {
        continue;
      }

      penaltyTeamByDriver.set(
        driverId,
        {
          id:
            team.id,

          name:
            team.name,

          logoPath:
            team.logoPath ||
            null,

          accentColor:
            team.accentColor ||
            leagueForSeason
              .accentColor,
        },
      );
    }
  }

  const penaltyEntriesByDriver =
    new Map();

  for (
    const entry of
    penaltyEntries || []
  ) {
    const driverId =
      Number(
        entry.DriverId,
      );

    if (!driverId) {
      continue;
    }

    if (
      !penaltyEntriesByDriver.has(
        driverId,
      )
    ) {
      penaltyEntriesByDriver.set(
        driverId,
        [],
      );
    }

    penaltyEntriesByDriver
      .get(driverId)
      .push(entry);
  }

  const penaltyDriverMap =
    new Map();

  for (
    const driverValue of
    seasonStructure.allDrivers ||
    []
  ) {
    const driver =
      plain(
        driverValue,
      );

    const driverId =
      Number(driver?.id);

    if (!driverId) {
      continue;
    }

    penaltyDriverMap.set(
      driverId,
      driver,
    );
  }

  for (
    const driverValue of
    drivers || []
  ) {
    const driver =
      plain(
        driverValue,
      );

    const driverId =
      Number(driver?.id);

    if (
      driverId &&
      penaltyEntriesByDriver.has(
        driverId,
      ) &&
      !penaltyDriverMap.has(
        driverId,
      )
    ) {
      penaltyDriverMap.set(
        driverId,
        driver,
      );
    }
  }

  const penaltyRows = [];

  for (
    const driver of
    penaltyDriverMap.values()
  ) {
    const driverId =
      Number(driver.id);

    const entries =
      penaltyEntriesByDriver.get(
        driverId,
      ) || [];

    const cells = {};

    let totalPoints = 0;

    let hasRaceBan = false;

    for (
      const entry of
      entries
    ) {
      const roundNumber =
        Number(
          entry.roundNumber ||
            0,
        );

      if (
        !Number.isInteger(
          roundNumber,
        ) ||
        roundNumber < 1
      ) {
        continue;
      }

      if (
        !cells[
          roundNumber
        ]
      ) {
        cells[
          roundNumber
        ] = {
          points: 0,
          isRaceBan: false,
          cellColor: null,
          value: "",
        };
      }

      const cell =
        cells[
          roundNumber
        ];

      cell.points +=
        Number(
          entry.points ||
            0,
        );

      if (
        !cell.cellColor &&
        entry.cellColor
      ) {
        cell.cellColor =
          String(
            entry.cellColor,
          );
      }

      if (
        entry.isRaceBan
      ) {
        cell.isRaceBan =
          true;

        hasRaceBan =
          true;
      }

      totalPoints +=
        Number(
          entry.points ||
            0,
        );
    }

    Object.values(
      cells,
    ).forEach((cell) => {
      if (
        cell.isRaceBan
      ) {
        cell.value =
          "S";
      } else if (
        cell.points > 0
      ) {
        cell.value =
          String(
            cell.points,
          );
      } else {
        cell.value =
          "";
      }
    });

    const lineupEntry =
      (
        seasonStructure.lineup ||
        []
      ).find(
        (entry) =>
          Number(
            entry.DriverId,
          ) === driverId,
      );

    penaltyRows.push({
      id:
        driverId,

      name:
        driver.name,

      team:
        penaltyTeamByDriver.get(
          driverId,
        ) ||
        driver.team ||
        null,

      roleType:
        lineupEntry
          ?.roleType ||
        "former",

      cells,

      points:
        totalPoints,

      remaining:
        Math.max(
          penaltyThreshold -
            totalPoints,
          0,
        ),

      suspended:
        hasRaceBan ||
        totalPoints >=
          penaltyThreshold,
    });
  }

  const penaltyRoleOrder = {
    regular: 0,
    reserve: 1,
    former: 2,
  };

  penaltyRows.sort(
    (left, right) => {
      const roleDifference =
        (
          penaltyRoleOrder[
            left.roleType
          ] ?? 9
        ) -
        (
          penaltyRoleOrder[
            right.roleType
          ] ?? 9
        );

      if (
        roleDifference
      ) {
        return roleDifference;
      }

      return String(
        left.name || "",
      ).localeCompare(
        String(
          right.name ||
            "",
        ),
        "de",
      );
    },
  );

  const publicPenaltyLedger = {
    threshold:
      penaltyThreshold,

    rounds:
      penaltyRounds,

    rows:
      penaltyRows,
  };

  return {
    league:
      leagueForSeason,

    teams,

    drivers,

    gpResults:
      decoratedGpResults,

    raceStatistics,

    calendar,

    seasons,

    selectedSeason,

    publicPenaltyLedger,

    ...standingsData,
  };
}

exports.show = async (
  req,
  res,
) => {
  const data =
    await loadLeagueData(
      req.params.slug,
      req.query.season,
    );

  if (!data) {
    return res
      .status(404)
      .render(
        "errors/404",
        {
          title:
            "Liga nicht gefunden",
        },
      );
  }

  res.render(
    "f1",
    {
      title:
        data.league.name,

      ...data,
    },
  );
};

exports.downloadDriverStandings =
  async (
    req,
    res,
  ) => {
    const data =
      await loadLeagueData(
        req.params.slug,
        req.query.season,
      );

    if (!data) {
      return res
        .status(404)
        .end();
    }

    const rows = [
      [
        "Position",
        "Fahrer",
        "Team",
        "Punkte",
        "Siege",
        "Rückstand",
      ],
    ];

    data.driverStandings.forEach(
      (row) => {
        rows.push([
          row.position,

          row.driver.name,

          row.driver.team
            ?.name || "",

          row.points,

          row.wins,

          row.gap,
        ]);
      },
    );

    sendCsv(
      res,

      `${data.league.slug}-${data.selectedSeason?.name || data.league.currentSeason}-fahrer-wm.csv`,

      rows,
    );
  };

exports.downloadTeamStandings =
  async (
    req,
    res,
  ) => {
    const data =
      await loadLeagueData(
        req.params.slug,
        req.query.season,
      );

    if (!data) {
      return res
        .status(404)
        .end();
    }

    const rows = [
      [
        "Position",
        "Team",
        "Punkte",
        "Siege",
        "Rückstand",
      ],
    ];

    data.teamStandings.forEach(
      (row) => {
        rows.push([
          row.position,

          row.team.name,

          row.points,

          row.wins,

          row.gap,
        ]);
      },
    );

    sendCsv(
      res,

      `${data.league.slug}-${data.selectedSeason?.name || data.league.currentSeason}-team-wm.csv`,

      rows,
    );
  };

exports.downloadGpResults =
  async (
    req,
    res,
  ) => {
    const data =
      await loadLeagueData(
        req.params.slug,
        req.query.season,
      );

    if (!data) {
      return res
        .status(404)
        .end();
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

    data.gpResults.forEach(
      (
        race,
        raceIndex,
      ) => {
        race.entries.forEach(
          (entry) => {
            rows.push([
              race.sortOrder ||
                raceIndex +
                  1,

              race.displayTitle ||
                race.title,

              race.raceDate ||
                "",

              entry.position ||
                "",

              entry.status ||
                "",

              entry.driverName,

              entry.teamName ||
                "",

              Number(
                entry.points,
              ),

              entry.fastestLap
                ? "Ja"
                : "Nein",
            ]);
          },
        );
      },
    );

    sendCsv(
      res,

      `${data.league.slug}-${data.selectedSeason?.name || data.league.currentSeason}-gp-results.csv`,

      rows,
    );
  };

exports.publicPenaltyLedger =
  async (
    req,
    res,
  ) => {
    const allowedLeagues = [
      "freitag",
      "samstag",
      "sonntag",
    ];

    /*
     * =====================================================
     * ANSICHT
     * =====================================================
     */

    const requestedView =
      String(
        req.query.ansicht ||
          "liga",
      )
        .trim()
        .toLowerCase();

    const viewMode =
      requestedView ===
      "ersatzfahrer"
        ? "ersatzfahrer"
        : requestedView ===
            "ehemalige"
          ? "ehemalige"
          : "liga";

    /*
     * =====================================================
     * LIGA
     * =====================================================
     */

    const requestedLeague =
      String(
        req.query.liga ||
          "freitag",
      )
        .trim()
        .toLowerCase();

    const selectedLeagueSlug =
      allowedLeagues.includes(
        requestedLeague,
      )
        ? requestedLeague
        : "freitag";

    const data =
      await loadLeagueData(
        selectedLeagueSlug,
        req.query.season,
      );

    if (!data) {
      return res
        .status(404)
        .render(
          "errors/404",
          {
            title:
              "Liga nicht gefunden",
          },
        );
    }

    /*
     * =====================================================
     * ALLE F1-LIGEN FÜR COMMUNITY-TABS
     * =====================================================
     */

    const leagues =
      await League.findAll({
        where: {
          type: "f1",

          slug: {
            [Op.in]:
              allowedLeagues,
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

    const ledgers =
      await Promise.all(
        leagues.map(
          buildLeagueLedger,
        ),
      );

    const globalLedgers =
      await buildGlobalLedgers(
        ledgers,
      );

    return res.render(
      "penalty-ledger-public",
      {
        title:
          "Strafkartei",

        discipline:
          "f1",

        /*
         * Aktive Ansicht:
         *
         * liga
         * ersatzfahrer
         * ehemalige
         */
        viewMode,

        league:
          data.league,

        seasons:
          data.seasons,

        selectedSeason:
          data.selectedSeason,

        selectedLeagueSlug,

        leagueTabs: [
          {
            slug:
              "freitag",

            label:
              "Freitagsliga",
          },

          {
            slug:
              "samstag",

            label:
              "Samstagsliga",
          },

          {
            slug:
              "sonntag",

            label:
              "Sonntagsliga",
          },
        ],

        ledger:
          data.publicPenaltyLedger,

        reserveLedger:
          globalLedgers.reserve,

        formerLedger:
          globalLedgers.former,

        /*
         * Community-Design
         */
        communityAccent:
          "#6ef2f2",

        /*
         * Hier später einfach
         * den echten Logo-Pfad
         * eintragen.
         */
        communityLogoPath:
          "/images/krl-placeholder.svg",
      },
    );
  };

module.exports.loadLeagueData =
  loadLeagueData;