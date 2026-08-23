const { Op } = require("sequelize");
const {
  sequelize,
  League,
  Season,
  Team,
  TeamRoster,
  TeamRosterDriver,
  Driver,
  GrandPrixResult,
  F1RaceLineupEntry,
  PenaltyEntry,
  F1PenaltySetting,
  F1CarProfile,
} = require("../models");
const {
  REGULAR_STATUSES,
  RESERVE_STATUSES,
  normalizeRegularStatus,
  normalizeReserveStatus,
  reserveRoleField,
} = require("../services/raceLineup");
const { loadSeasonStructure } = require("../services/f1Season");

async function loadRosterTeams(league, race) {
  if (race?.SeasonId) {
    const structure = await loadSeasonStructure(race.SeasonId);
    if (structure.teams.length) {
      return Promise.all(
        structure.teams
          .filter((seasonTeam) => seasonTeam.drivers.length)
          .map(async (seasonTeam) => {
            let actualTeam = null;
            if (seasonTeam.sourceType === "current")
              actualTeam = await Team.findByPk(seasonTeam.sourceId);
            else {
              const profile = await F1CarProfile.findByPk(seasonTeam.sourceId);
              if (profile?.BaseTeamId)
                actualTeam = await Team.findByPk(profile.BaseTeamId);
            }
            return {
              roster: null,
              team: {
                id: actualTeam?.id || null,
                name: seasonTeam.name,
                accentColor: seasonTeam.accentColor,
                logoPath: seasonTeam.logoPath,
                seasonTeamId: seasonTeam.id,
              },
              drivers: seasonTeam.drivers,
            };
          }),
      );
    }
  }
  const roleField = require("../services/raceLineup").regularRoleField(
    league.slug,
  );
  const rosters = await TeamRoster.findAll({
    where: { LeagueId: league.id, discipline: "f1" },
    include: [
      { association: "team" },
      {
        association: "assignments",
        include: [
          { association: "driver", include: [{ association: "aliases" }] },
        ],
      },
    ],
    order: [
      ["sortOrder", "ASC"],
      ["id", "ASC"],
      [{ model: TeamRosterDriver, as: "assignments" }, "sortOrder", "ASC"],
    ],
  });
  return rosters
    .map((roster) => ({
      roster,
      team: roster.team,
      drivers: roster.assignments
        .filter(
          (assignment) =>
            assignment.roleName !== "Ersatzfahrer" &&
            assignment.driver?.[roleField],
        )
        .map((assignment) => assignment.driver),
    }))
    .filter((team) => team.drivers.length);
}

async function loadPlanningRows(league, race) {
  const structure = race?.SeasonId
    ? await loadSeasonStructure(race.SeasonId)
    : null;
  const today = new Date().toISOString().slice(0, 10);
  const [teams, fallbackReserves, entries, penalties, penaltySetting] =
    await Promise.all([
      loadRosterTeams(league, race),
      Driver.findAll({
        where: { [reserveRoleField(league.slug)]: true },
        include: [{ association: "aliases" }],
        order: [
          ["name", "ASC"],
          ["id", "ASC"],
        ],
      }),
      race
        ? F1RaceLineupEntry.findAll({
            where: { GrandPrixResultId: race.id },
            include: [
              { association: "driver" },
              { association: "replacementFor" },
              { association: "team" },
            ],
            order: [
              ["roleType", "ASC"],
              ["sortOrder", "ASC"],
              ["id", "ASC"],
            ],
          })
        : [],
      PenaltyEntry.findAll({
        where: { LeagueId: league.id, expiresOn: { [Op.gte]: today } },
      }),
      F1PenaltySetting.findOne({ where: { LeagueId: league.id } }),
    ]);
  const reserves = structure?.unassignedDrivers?.length
    ? structure.unassignedDrivers
    : fallbackReserves;
  const threshold = Number(penaltySetting?.pointsLimit || 12);
  const pointsByDriver = new Map();
  penalties.forEach((entry) =>
    pointsByDriver.set(
      entry.DriverId,
      Number(pointsByDriver.get(entry.DriverId) || 0) +
        Number(entry.points || 0),
    ),
  );
  const bannedDriverIds = new Set(
    penalties
      .filter(
        (entry) =>
          (entry.isRaceBan && entry.GrandPrixResultId === race?.id) ||
          Number(pointsByDriver.get(entry.DriverId) || 0) >= threshold,
      )
      .map((entry) => entry.DriverId),
  );

  const regularEntries = new Map(
    entries
      .filter((entry) => entry.roleType === "regular")
      .map((entry) => [Number(entry.DriverId), entry]),
  );

  const reserveEntries = new Map(
    entries
      .filter((entry) => entry.roleType === "reserve")
      .map((entry) => [Number(entry.DriverId), entry]),
  );

  const reserveByRegular = new Map(
    entries
      .filter(
        (entry) => entry.roleType === "reserve" && entry.ReplacementForDriverId,
      )
      .map((entry) => [Number(entry.ReplacementForDriverId), entry]),
  );

  const regularById = new Map();
  const teamCards = teams.map(({ roster, team, drivers }) => ({
    roster,
    team,
    rows: drivers.map((driver) => {
      const driverId = Number(driver.id);

      regularById.set(driverId, {
        driver,
        team,
      });

      const saved = regularEntries.get(driverId);

      return {
        driver,
        team,
        status: bannedDriverIds.has(driver.id)
          ? "rennsperre"
          : normalizeRegularStatus(saved?.status),
        isBanned: bannedDriverIds.has(driver.id),
        replacementDriverId: bannedDriverIds.has(driver.id)
          ? null
          : Number(reserveByRegular.get(driverId)?.DriverId || 0) || null,
      };
    }),
  }));

  const reserveRows = reserves.map((driver) => {
    const driverId = Number(driver.id);

    const saved = reserveEntries.get(driverId);

    const replacementForDriverId =
      Number(saved?.ReplacementForDriverId || 0) || null;

    return {
      driver,

      status: normalizeReserveStatus(saved?.status),

      assignedTo: replacementForDriverId
        ? regularById.get(replacementForDriverId) || null
        : null,
    };
  });

  return {
    teamCards,
    reserves,
    reserveRows,
    hasSavedPlan: entries.length > 0,
    bannedDriverIds,
  };
}

exports.show = async (req, res) => {
  const leagues = await League.findAll({
    where: { type: "f1" },
    order: [
      ["sortOrder", "ASC"],
      ["name", "ASC"],
    ],
  });
  const selectedLeague =
    leagues.find((league) => league.id === Number(req.query.league)) ||
    leagues[0] ||
    null;
  const activeSeason = selectedLeague
    ? await Season.findOne({
        where: {
          leagueType: "f1",
          scopeSlug: selectedLeague.slug,
          status: "active",
          isPublished: true,
        },
      })
    : null;
  const races = activeSeason
    ? await GrandPrixResult.findAll({
        where: {
          SeasonId: activeSeason.id,
          LeagueId: selectedLeague.id,
          discipline: "f1",
          raceType: "main",
        },
        order: [
          ["sortOrder", "ASC"],
          ["raceDate", "ASC"],
          ["id", "ASC"],
        ],
      })
    : [];
  const today = new Date().toISOString().slice(0, 10);
  const selectedRace =
    races.find((race) => race.id === Number(req.query.race)) ||
    races.find((race) => !race.raceDate || race.raceDate >= today) ||
    races[races.length - 1] ||
    null;
  const planning = selectedLeague
    ? await loadPlanningRows(selectedLeague, selectedRace)
    : { teamCards: [], reserves: [], reserveRows: [], hasSavedPlan: false };
  res.render("admin/f1-race-lineup", {
    title: "Fahrereinteilung nächstes Rennen",
    leagues,
    selectedLeague,
    activeSeason,
    races,
    selectedRace,
    regularStatuses: REGULAR_STATUSES,
    reserveStatuses: RESERVE_STATUSES,
    ...planning,
  });
};

exports.save = async (req, res) => {
  const race = await GrandPrixResult.findByPk(req.params.raceId, {
    include: [{ association: "league" }, { association: "seasonRecord" }],
  });

  if (
    !race ||
    race.discipline !== "f1" ||
    race.raceType !== "main" ||
    race.seasonRecord?.status !== "active"
  ) {
    return res.status(404).render("errors/404", {
      title: "Aktuelles Formel-1-Rennen nicht gefunden",
    });
  }

  const { teamCards, reserves, bannedDriverIds } = await loadPlanningRows(
    race.league,
    race,
  );

  const regularRows = teamCards.flatMap((card) => card.rows);

  const reserveById = new Map(
    reserves.map((driver) => [Number(driver.id), driver]),
  );

  const regularInput = req.body.regular || {};

  const reserveInput = req.body.reserve || {};

  console.log("=== REGULAR INPUT ===", JSON.stringify(regularInput, null, 2));

  console.log("=== RESERVE INPUT ===", JSON.stringify(reserveInput, null, 2));

  const usedReserves = new Set();

  const replacementByReserve = new Map();

  try {
    /*
     * =====================================================
     * ERSATZ-ZUORDNUNGEN PRÜFEN
     * =====================================================
     */

    for (const row of regularRows) {
      const driverId = Number(row.driver.id);

      const input = regularInput[`d${driverId}`] || {};

      const regularStatus = bannedDriverIds.has(driverId)
        ? "rennsperre"
        : normalizeRegularStatus(input.status);

      const replacementId = Number(input.ReplacementDriverId || 0) || null;

      /*
       * Ersatz nur bei:
       * - abgemeldet
       * - unsicher
       */
      if (
        replacementId &&
        !["abgemeldet", "unsicher"].includes(regularStatus)
      ) {
        throw new Error(
          `${row.driver.name}: Ersatzfahrer sind nur bei „abgemeldet“ oder „unsicher“ zulässig.`,
        );
      }

      /*
       * Rennsperre darf niemals
       * durch Ersatzfahrer ersetzt werden.
       */
      if (regularStatus === "rennsperre" && replacementId) {
        throw new Error(
          `${row.driver.name} hat für dieses Rennen eine Rennsperre und darf nicht ersetzt werden.`,
        );
      }

      /*
       * Kein Ersatz ausgewählt.
       */
      if (!replacementId) {
        continue;
      }

      /*
       * Ersatzfahrer muss zum
       * passenden Liga-Rang gehören.
       */
      const reserve = reserveById.get(replacementId);

      if (!reserve) {
        throw new Error(
          `${row.driver.name}: Der gewählte Ersatzfahrer besitzt nicht den passenden Liga-Rang.`,
        );
      }

      /*
       * Aktuellen Status des
       * Ersatzfahrers aus dem Formular lesen.
       */
      const reserveStatus = normalizeReserveStatus(
        reserveInput[`d${replacementId}`]?.status,
      );

      /*
       * Nur diese Ersatzfahrer
       * dürfen tatsächlich eingesetzt werden:
       *
       * anwesend
       * unsicher
       * auf Abruf
       */
      if (!["anwesend", "unsicher", "auf_abruf"].includes(reserveStatus)) {
        throw new Error(
          `${reserve.name} kann mit dem Status „${reserveStatus}“ nicht als Ersatzfahrer eingesetzt werden.`,
        );
      }

      /*
       * Ein Ersatzfahrer darf innerhalb
       * eines Rennens nur einen
       * Stammfahrer ersetzen.
       */
      if (usedReserves.has(replacementId)) {
        throw new Error(`${reserve.name} kann nur einen Stammfahrer ersetzen.`);
      }

      usedReserves.add(replacementId);

      replacementByReserve.set(replacementId, row);
    }

    /*
     * =====================================================
     * DATENSÄTZE AUFBAUEN
     * =====================================================
     */

    const records = [];

    /*
     * Stammfahrer
     */
    regularRows.forEach((row, index) => {
      const driverId = Number(row.driver.id);

      const input = regularInput[`d${driverId}`] || {};

      records.push({
        GrandPrixResultId: race.id,

        DriverId: driverId,

        TeamId: row.team.id,

        roleType: "regular",

        status: bannedDriverIds.has(driverId)
          ? "rennsperre"
          : normalizeRegularStatus(input.status),

        sortOrder: index,
      });
    });

    /*
     * Ersatzfahrer
     */
    reserves.forEach((driver, index) => {
      const driverId = Number(driver.id);

      const input = reserveInput[`d${driverId}`] || {};

      const replacement = replacementByReserve.get(driverId);

      records.push({
        GrandPrixResultId: race.id,

        DriverId: driverId,

        ReplacementForDriverId: replacement
          ? Number(replacement.driver.id)
          : null,

        TeamId: replacement ? replacement.team.id : null,

        roleType: "reserve",

        status: normalizeReserveStatus(input.status),

        sortOrder: index,
      });
    });

    /*
     * =====================================================
     * SPEICHERN
     * =====================================================
     */

    console.log(
      "=== RECORDS DIE GESPEICHERT WERDEN ===",
      JSON.stringify(records, null, 2),
    );

    await sequelize.transaction(async (transaction) => {
      await F1RaceLineupEntry.destroy({
        where: {
          GrandPrixResultId: race.id,
        },

        transaction,
      });

      if (records.length) {
        await F1RaceLineupEntry.bulkCreate(records, {
          transaction,
        });
      }
    });

    req.session.flash = {
      type: "success",

      message: `${race.title}: Stamm- und Ersatzfahrer wurden gespeichert und in den aktuellen Saisonverlauf übernommen.`,
    };
  } catch (error) {
    req.session.flash = {
      type: "error",

      message: error.message,
    };
  }

  return res.redirect(
    `/admin/f1-race-lineup?league=${race.LeagueId}&race=${race.id}`,
  );
};

module.exports.loadPlanningRows = loadPlanningRows;
