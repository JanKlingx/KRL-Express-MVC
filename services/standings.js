function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function plain(value) {
  return value && typeof value.toJSON === "function" ? value.toJSON() : value;
}

function raceCode(race, index) {
  const words = String(race?.title || race?.circuit || "")
    .replace(/gro(?:ss|ß)er preis (?:von|der)/i, "")
    .match(/[A-Za-zÄÖÜäöü]+/g) || [];

  return (words.at(-1) || `R${index + 1}`)
    .slice(0, 3)
    .toUpperCase();
}

function buildSeasonData(
  leagueValue,
  resultValues,
  driverValues = [],
  lineupValues = [],
  seasonValue = null,
) {
  const league = plain(leagueValue);

  const seasonSettings =
    plain(seasonValue) || {};

  const reservePointsForConstructors =
    seasonSettings.reservePointsForConstructors !== false;

  const races = resultValues
    .map(plain)
    .sort(
      (a, b) =>
        number(a.sortOrder) -
          number(b.sortOrder) ||

        (a.raceType === "sprint" ? -1 : 1) -
          (b.raceType === "sprint" ? -1 : 1) ||

        String(a.raceDate || "")
          .localeCompare(
            String(b.raceDate || ""),
          ),
    );

  /*
   * =====================================================
   * RENNWOCHENENDEN
   * Sprint + Hauptrennen = eine Runde
   * =====================================================
   */

  const weekendMap = new Map();

  races.forEach((race, index) => {
    const round =
      number(race.sortOrder) ||
      index + 1;

    const key =
      `${race.SeasonId || ""}::` +
      `${race.LeagueId || ""}::` +
      `${round}`;

    if (!weekendMap.has(key)) {
      weekendMap.set(key, {
        key,
        round,
        main: null,
        sprint: null,
      });
    }

    const weekend =
      weekendMap.get(key);

    if (race.raceType === "sprint") {
      weekend.sprint = race;
    } else {
      weekend.main = race;
    }
  });

  const weekends =
    [...weekendMap.values()]
      .sort(
        (a, b) =>
          a.round - b.round,
      );

  const raceIndexById =
    new Map(
      races.map(
        (race, index) => [
          Number(race.id),
          index,
        ],
      ),
    );

  /*
   * =====================================================
   * LINE-UP
   * =====================================================
   */

  const lineups =
    lineupValues.map(plain);

  const mainRaceByRound =
    new Map(
      races
        .filter(
          (race) =>
            race.raceType === "main",
        )
        .map(
          (race) => [
            `${race.SeasonId || ""}::${race.LeagueId || ""}::${race.sortOrder || ""}`,
            race,
          ],
        ),
    );

  const mainRaceForSprint =
    (race) => {
      if (
        !race ||
        race.raceType !== "sprint"
      ) {
        return race;
      }

      return (
        mainRaceByRound.get(
          `${race.SeasonId || ""}::${race.LeagueId || ""}::${race.sortOrder || ""}`,
        ) ||
        null
      );
    };

  function lineupEntryForResult(
    race,
    entry,
  ) {
    const directRaceId =
      Number(
        entry.GrandPrixResultId ||
          race.id,
      );

    const direct =
      lineups.find(
        (row) =>
          Number(
            row.GrandPrixResultId,
          ) ===
            directRaceId &&

          Number(
            row.DriverId,
          ) ===
            Number(
              entry.DriverId,
            ),
      );

    if (
      direct ||
      race.raceType !== "sprint"
    ) {
      return direct || null;
    }

    const main =
      mainRaceForSprint(race);

    if (!main) {
      return null;
    }

    return (
      lineups.find(
        (row) =>
          Number(
            row.GrandPrixResultId,
          ) ===
            Number(main.id) &&

          Number(
            row.DriverId,
          ) ===
            Number(
              entry.DriverId,
            ),
      ) ||
      null
    );
  }

  /*
   * =====================================================
   * ERSATZFAHRER / ERSETZTE STAMMFAHRER
   * =====================================================
   */

  const usedReserveEntries =
    lineups.filter(
      (entry) =>
        entry.roleType ===
          "reserve" &&

        entry.ReplacementForDriverId &&

        entry.includeInResults ===
          true,
    );

  const replacedRegularsByRace =
    new Map();

  usedReserveEntries.forEach(
    (entry) => {
      const raceId =
        Number(
          entry.GrandPrixResultId,
        );

      if (
        !replacedRegularsByRace.has(
          raceId,
        )
      ) {
        replacedRegularsByRace.set(
          raceId,
          new Set(),
        );
      }

      replacedRegularsByRace
        .get(raceId)
        .add(
          Number(
            entry.ReplacementForDriverId,
          ),
        );
    },
  );

  /*
   * =====================================================
   * TEAM-LOGOS
   * =====================================================
   */

  const teamLogoByName =
    new Map();

  driverValues
    .map(plain)
    .forEach(
      (driver) => {
        const team =
          plain(driver.team) ||
          null;

        if (
          team?.name &&
          team?.logoPath
        ) {
          teamLogoByName.set(
            team.name,
            team.logoPath,
          );
        }
      },
    );

  /*
   * =====================================================
   * STAMMFAHRER
   * =====================================================
   */

  const drivers =
    new Map();

  const namesToKeys =
    new Map();

  driverValues
    .map(plain)
    .forEach(
      (driver) => {
        const team =
          plain(driver.team) ||
          null;

        const key =
          driver.id
            ? `id:${driver.id}`
            : `name:${driver.name}`;

        drivers.set(
          key,
          {
            id:
              driver.id ||
              null,

            name:
              driver.name,

            team:
              team?.name ||
              "Privatteam",

            teamLogoPath:
              team?.logoPath ||
              null,

            results:
              [],

            total:
              0,

            wins:
              0,
          },
        );

        namesToKeys.set(
          driver.name,
          key,
        );

        (
          driver.aliases ||
          []
        )
          .map(plain)
          .forEach(
            (alias) =>
              namesToKeys.set(
                alias.alias,
                key,
              ),
          );
      },
    );

  const keyForEntry =
    (entry) =>
      entry.DriverId
        ? `id:${entry.DriverId}`
        : namesToKeys.get(
            entry.driverName,
          ) ||
          `name:${entry.driverName}`;

  /*
   * =====================================================
   * STAMMFAHRER-ERGEBNISSE
   * =====================================================
   */

  for (
    const [
      driverKey,
      driver,
    ] of drivers.entries()
  ) {
    let cumulative = 0;

    driver.results =
      races.map(
        (race) => {
          const lineupRace =
            race.raceType ===
            "sprint"
              ? mainRaceForSprint(
                  race,
                )
              : race;

          const wasReplaced =
            lineupRace &&
            replacedRegularsByRace
              .get(
                Number(
                  lineupRace.id,
                ),
              )
              ?.has(
                Number(
                  driver.id,
                ),
              );

          if (wasReplaced) {
            return {
              value: "DNS",
              points: 0,
              cumulative,
              status: "DNS",
              position: null,
              fastestLap: false,
              replaced: true,
            };
          }

          const entry =
            (
              race.entries ||
              []
            )
              .map(plain)
              .find(
                (candidate) =>
                  keyForEntry(
                    candidate,
                  ) ===
                  driverKey,
              );

          if (!entry) {
            return {
              value: "–",
              points: 0,
              cumulative,
              status: null,
              position: null,
              fastestLap: false,
            };
          }

          const points =
            number(
              entry.points,
            );

          const position =
            number(
              entry.position,
            ) ||
            null;

          const status =
            String(
              entry.status ||
              "",
            )
              .trim()
              .toUpperCase() ||
            null;

          cumulative +=
            points;

          driver.total +=
            points;

          if (
            position === 1 &&
            race.raceType !==
              "sprint"
          ) {
            driver.wins += 1;
          }

          if (
            entry.teamName
          ) {
            driver.team =
              entry.teamName;

            driver.teamLogoPath =
              teamLogoByName.get(
                entry.teamName,
              ) ||
              driver.teamLogoPath;
          }

          return {
            value:
              status ||
              (
                position
                  ? `P${position}`
                  : "–"
              ),

            points,

            cumulative,

            status,

            position,

            fastestLap:
              Boolean(
                entry.fastestLap,
              ),
          };
        },
      );
  }

  /*
   * =====================================================
   * FAHRER SORTIEREN
   * =====================================================
   */

  const rankedDrivers =
    [...drivers.values()]
      .sort(
        (a, b) =>
          b.total -
            a.total ||

          b.wins -
            a.wins ||

          a.name.localeCompare(
            b.name,
            "de",
          ),
      );

  const leaderPoints =
    rankedDrivers[0]
      ?.total ||
    0;

  rankedDrivers.forEach(
    (driver, index) => {
      driver.position =
        index + 1;

      driver.gap =
        driver.total -
        leaderPoints;

      driver.average =
        races.length
          ? driver.total /
            races.length
          : 0;
    },
  );

  /*
   * =====================================================
   * ERSATZFAHRER
   * =====================================================
   */

  const reserveDrivers =
    new Map();

  usedReserveEntries.forEach(
    (lineupEntry) => {
      const driverId =
        Number(
          lineupEntry.DriverId,
        );

      if (
        reserveDrivers.has(
          driverId,
        )
      ) {
        return;
      }

      const lineupDriver =
        plain(
          lineupEntry.driver,
        );

      reserveDrivers.set(
        driverId,
        {
          id:
            driverId,

          name:
            lineupDriver?.name ||
            `Fahrer ${driverId}`,

          team:
            null,

          teamLogoPath:
            null,

          results:
            [],

          total:
            0,

          wins:
            0,
        },
      );
    },
  );

  /*
   * =====================================================
   * ERSATZFAHRER-ERGEBNISSE
   * =====================================================
   */

  for (
    const [
      reserveDriverId,
      reserveDriver,
    ] of reserveDrivers.entries()
  ) {
    let cumulative = 0;

    reserveDriver.results =
      races.map(
        (race) => {
          const lineupEntry =
            lineupEntryForResult(
              race,
              {
                DriverId:
                  reserveDriverId,

                GrandPrixResultId:
                  race.id,
              },
            );

          const usedHere =
            lineupEntry
              ?.roleType ===
              "reserve" &&

            lineupEntry
              ?.includeInResults ===
              true;

          if (!usedHere) {
            return {
              value: "DNS",
              points: 0,
              cumulative,
              status: "DNS",
              position: null,
              fastestLap: false,
            };
          }

          const entry =
            (
              race.entries ||
              []
            )
              .map(plain)
              .find(
                (row) =>
                  Number(
                    row.DriverId,
                  ) ===
                  reserveDriverId,
              );

          if (!entry) {
            return {
              value: "DNS",
              points: 0,
              cumulative,
              status: "DNS",
              position: null,
              fastestLap: false,
            };
          }

          const points =
            number(
              entry.points,
            );

          const position =
            number(
              entry.position,
            ) ||
            null;

          const status =
            String(
              entry.status ||
              "",
            )
              .trim()
              .toUpperCase() ||
            null;

          cumulative +=
            points;

          reserveDriver.total +=
            points;

          if (
            position === 1 &&
            race.raceType !==
              "sprint"
          ) {
            reserveDriver.wins += 1;
          }

          if (
            entry.teamName
          ) {
            reserveDriver.team =
              entry.teamName;

            reserveDriver.teamLogoPath =
              teamLogoByName.get(
                entry.teamName,
              ) ||
              null;
          }

          return {
            value:
              status ||
              (
                position
                  ? `P${position}`
                  : "–"
              ),

            points,

            cumulative,

            status,

            position,

            fastestLap:
              Boolean(
                entry.fastestLap,
              ),
          };
        },
      );
  }

  const rankedReserveDrivers =
    [...reserveDrivers.values()]
      .sort(
        (a, b) =>
          b.total -
            a.total ||

          b.wins -
            a.wins ||

          a.name.localeCompare(
            b.name,
            "de",
          ),
      );

  const reserveLeaderPoints =
    rankedReserveDrivers[0]
      ?.total ||
    0;

  rankedReserveDrivers.forEach(
    (driver, index) => {
      driver.position =
        index + 1;

      driver.gap =
        driver.total -
        reserveLeaderPoints;

      driver.starts =
        driver.results.filter(
          (result) =>
            result.status !==
              "DNS" &&
            result.value !==
              "–",
        ).length;

      driver.average =
        driver.starts
          ? driver.total /
            driver.starts
          : 0;
    },
  );

  /*
   * =====================================================
   * TEAM-WM
   * =====================================================
   */

  const regularDriverTeamMap =
    new Map();

  driverValues
    .map(plain)
    .forEach(
      (driver) => {
        const teamName =
          plain(
            driver.team,
          )?.name ||
          null;

        if (
          driver.id &&
          teamName
        ) {
          regularDriverTeamMap.set(
            Number(
              driver.id,
            ),
            teamName,
          );
        }
      },
    );

  function seedTeamMap() {
    const map =
      new Map();

    driverValues
      .map(plain)
      .forEach(
        (driver) => {
          const teamName =
            plain(
              driver.team,
            )?.name ||
            null;

          if (
            teamName &&
            !map.has(
              teamName,
            )
          ) {
            map.set(
              teamName,
              {
                name:
                  teamName,

                points:
                  0,

                wins:
                  0,
              },
            );
          }
        },
      );

    return map;
  }

  function addRaceToTeamMap(
    teamMap,
    race,
  ) {
    (
      race.entries ||
      []
    )
      .map(plain)
      .forEach(
        (entry) => {
          const driverId =
            Number(
              entry.DriverId ||
              0,
            );

          const lineupEntry =
            lineupEntryForResult(
              race,
              entry,
            );

          const isReserve =
            lineupEntry
              ?.roleType ===
            "reserve";

          const isRegular =
            regularDriverTeamMap.has(
              driverId,
            );

          if (
            !isRegular &&
            !isReserve
          ) {
            return;
          }

          if (
            isReserve &&
            !reservePointsForConstructors
          ) {
            return;
          }

          let teamName =
            entry.teamName ||
            regularDriverTeamMap.get(
              driverId,
            ) ||
            null;

          if (
            !teamName &&
            isReserve &&
            lineupEntry
              ?.ReplacementForDriverId
          ) {
            teamName =
              regularDriverTeamMap.get(
                Number(
                  lineupEntry
                    .ReplacementForDriverId,
                ),
              ) ||
              null;
          }

          if (!teamName) {
            return;
          }

          if (
            !teamMap.has(
              teamName,
            )
          ) {
            teamMap.set(
              teamName,
              {
                name:
                  teamName,

                points:
                  0,

                wins:
                  0,
              },
            );
          }

          const team =
            teamMap.get(
              teamName,
            );

          team.points +=
            number(
              entry.points,
            );

          if (
            race.raceType !==
              "sprint" &&
            number(
              entry.position,
            ) === 1
          ) {
            team.wins += 1;
          }
        },
      );
  }

  const teamMap =
    seedTeamMap();

  races.forEach(
    (race) =>
      addRaceToTeamMap(
        teamMap,
        race,
      ),
  );

  const rankedTeams =
    [...teamMap.values()]
      .sort(
        (a, b) =>
          b.points -
            a.points ||

          b.wins -
            a.wins ||

          a.name.localeCompare(
            b.name,
            "de",
          ),
      );

  const leaderTeamPoints =
    rankedTeams[0]
      ?.points ||
    0;

  rankedTeams.forEach(
    (team, index) => {
      team.position =
        index + 1;

      team.gap =
        index === 0
          ? "Leader"
          : `+${leaderTeamPoints - team.points}`;
    },
  );

  /*
   * =====================================================
   * SAISONVERLAUF
   * =====================================================
   */

  function resultForRace(
    driver,
    race,
  ) {
    if (!race) {
      return null;
    }

    const index =
      raceIndexById.get(
        Number(
          race.id,
        ),
      );

    return index === undefined
      ? null
      : driver.results[index] ||
          null;
  }

  function weekendResult(
    driver,
    weekend,
  ) {
    const sprint =
      resultForRace(
        driver,
        weekend.sprint,
      );

    const main =
      resultForRace(
        driver,
        weekend.main,
      );

    return {
      hasSprint:
        Boolean(
          weekend.sprint,
        ),

      sprint,

      main,

      cumulative:
        main?.cumulative ??
        sprint?.cumulative ??
        0,

      value:
        main?.value ||
        sprint?.value ||
        "–",

      points:
        number(
          main?.points,
        ) +
        number(
          sprint?.points,
        ),

      position:
        main?.position ||
        null,

      status:
        main?.status ||
        null,

      fastestLap:
        Boolean(
          main?.fastestLap ||
          sprint?.fastestLap,
        ),
    };
  }

  const historyRaces =
    weekends.map(
      (weekend, index) => {
        const displayRace =
          weekend.main ||
          weekend.sprint;

        return {
          round:
            weekend.round,

          code:
            raceCode(
              displayRace,
              index,
            ),

          title:
            displayRace?.title ||
            "",

          circuit:
            displayRace?.circuit ||
            "",

          hasSprint:
            Boolean(
              weekend.sprint,
            ),

          mainTitle:
            weekend.main?.title ||
            null,

          sprintTitle:
            weekend.sprint?.title ||
            null,
        };
      },
    );

  const historyDrivers =
    rankedDrivers.map(
      (driver) => ({
        ...driver,

        results:
          weekends.map(
            (weekend) =>
              weekendResult(
                driver,
                weekend,
              ),
          ),
      }),
    );

  const historyReserveDrivers =
    rankedReserveDrivers.map(
      (driver) => ({
        ...driver,

        results:
          weekends.map(
            (weekend) =>
              weekendResult(
                driver,
                weekend,
              ),
          ),
      }),
    );

  /*
   * =====================================================
   * WM-ZWISCHENSTÄNDE NACH JEDEM GEFAHRENEN GP
   * =====================================================
   */

  const completedWeekends =
    weekends.filter(
      (weekend) =>
        weekend.main &&

        Array.isArray(
          weekend.main.entries,
        ) &&

        weekend.main.entries.length >
          0,
    );

  function driverStandingsAfterWeekend(
    targetWeekend,
  ) {
    const fullWeekendIndex =
      weekends.findIndex(
        (weekend) =>
          weekend.key ===
          targetWeekend.key,
      );

    return rankedDrivers
      .map(
        (driver) => {
          const result =
            fullWeekendIndex >= 0
              ? weekendResult(
                  driver,
                  weekends[
                    fullWeekendIndex
                  ],
                )
              : null;

          let wins = 0;

          for (
            let i = 0;
            i <= fullWeekendIndex;
            i += 1
          ) {
            if (
              Number(
                resultForRace(
                  driver,
                  weekends[i]
                    ?.main,
                )?.position,
              ) === 1
            ) {
              wins += 1;
            }
          }

          return {
            name:
              driver.name,

            team:
              driver.team,

            teamLogoPath:
              driver.teamLogoPath,

            points:
              number(
                result?.cumulative,
              ),

            wins,
          };
        },
      )
      .sort(
        (a, b) =>
          b.points -
            a.points ||

          b.wins -
            a.wins ||

          a.name.localeCompare(
            b.name,
            "de",
          ),
      )
      .map(
        (driver, index) => ({
          ...driver,

          position:
            index + 1,
        }),
      );
  }

  function teamStandingsAfterRound(
    targetRound,
  ) {
    const snapshotMap =
      seedTeamMap();

    races
      .filter(
        (race) =>
          number(
            race.sortOrder,
          ) <=
          number(
            targetRound,
          ),
      )
      .forEach(
        (race) =>
          addRaceToTeamMap(
            snapshotMap,
            race,
          ),
      );

    return [
      ...snapshotMap.values(),
    ]
      .sort(
        (a, b) =>
          b.points -
            a.points ||

          b.wins -
            a.wins ||

          a.name.localeCompare(
            b.name,
            "de",
          ),
      )
      .map(
        (team, index) => ({
          ...team,

          position:
            index + 1,
        }),
      );
  }

  const standingsHistory =
    completedWeekends.map(
      (weekend) => {
        const displayRace =
          weekend.main ||
          weekend.sprint;

        return {
          round:
            weekend.round,

          title:
            displayRace?.title ||
            "",

          circuit:
            displayRace?.circuit ||
            "",

          raceDate:
            displayRace?.raceDate ||
            null,

          hasSprint:
            Boolean(
              weekend.sprint,
            ),

          driverStandings:
            driverStandingsAfterWeekend(
              weekend,
            ),

          teamStandings:
            teamStandingsAfterRound(
              weekend.round,
            ),
        };
      },
    );

  /*
   * =====================================================
   * RETURN
   * =====================================================
   */

  const season = {
    name:
      league.currentSeason,

    races:
      historyRaces,

    drivers:
      historyDrivers,

    reserveDrivers:
      historyReserveDrivers,
  };

  return {
    history: {
      seasons:
        races.length
          ? [season]
          : [],

      sourceLabel:
        races.length
          ? "Admin-Saisonverlauf"
          : null,

      warning:
        null,
    },

    selectedHistory:
      races.length
        ? season
        : null,

    driverStandings:
      rankedDrivers.map(
        (driver) => ({
          position:
            driver.position,

          points:
            driver.total,

          wins:
            driver.wins,

          gap:
            driver.position === 1
              ? "Leader"
              : `+${leaderPoints - driver.total}`,

          driver: {
            name:
              driver.name,

            team: {
              name:
                driver.team,

              logoPath:
                driver.teamLogoPath,
            },
          },
        }),
      ),

    reserveStandings:
      rankedReserveDrivers.map(
        (driver) => ({
          position:
            driver.position,

          points:
            driver.total,

          wins:
            driver.wins,

          starts:
            driver.starts,

          average:
            driver.average,

          gap:
            driver.position === 1
              ? "Leader"
              : `+${reserveLeaderPoints - driver.total}`,

          driver: {
            id:
              driver.id,

            name:
              driver.name,

            team:
              driver.team
                ? {
                    name:
                      driver.team,

                    logoPath:
                      driver.teamLogoPath,
                  }
                : null,
          },
        }),
      ),

    teamStandings:
      rankedTeams.map(
        (team) => ({
          ...team,

          team: {
            name:
              team.name,
          },
        }),
      ),

    standingsHistory,

    races,
  };
}

module.exports = {
  buildSeasonData,
  raceCode,
};