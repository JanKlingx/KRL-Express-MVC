const {
  sequelize, League, Season, TeamRoster, TeamRosterDriver, Driver,
  GrandPrixResult, F1RaceLineupEntry
} = require('../models');
const {
  REGULAR_STATUSES, RESERVE_STATUSES,
  normalizeRegularStatus, normalizeReserveStatus, reserveRoleField
} = require('../services/raceLineup');

async function loadRosterTeams(league) {
  const roleField = require('../services/raceLineup').regularRoleField(league.slug);
  const rosters = await TeamRoster.findAll({
    where: { LeagueId: league.id, discipline: 'f1' },
    include: [
      { association: 'team' },
      { association: 'assignments', include: [{ association: 'driver', include: [{ association: 'aliases' }] }] }
    ],
    order: [['sortOrder', 'ASC'], ['id', 'ASC'], [{ model: TeamRosterDriver, as: 'assignments' }, 'sortOrder', 'ASC']]
  });
  return rosters.map((roster) => ({
    roster,
    team: roster.team,
    drivers: roster.assignments
      .filter((assignment) => assignment.roleName !== 'Ersatzfahrer' && assignment.driver?.[roleField])
      .map((assignment) => assignment.driver)
  })).filter((team) => team.drivers.length);
}

async function loadPlanningRows(league, race) {
  const [teams, reserves, entries] = await Promise.all([
    loadRosterTeams(league),
    Driver.findAll({
      where: { [reserveRoleField(league.slug)]: true },
      include: [{ association: 'aliases' }],
      order: [['name', 'ASC'], ['id', 'ASC']]
    }),
    race ? F1RaceLineupEntry.findAll({
      where: { GrandPrixResultId: race.id },
      include: [{ association: 'driver' }, { association: 'replacementFor' }, { association: 'team' }],
      order: [['roleType', 'ASC'], ['sortOrder', 'ASC'], ['id', 'ASC']]
    }) : []
  ]);
  const regularEntries = new Map(entries.filter((entry) => entry.roleType === 'regular').map((entry) => [entry.DriverId, entry]));
  const reserveEntries = new Map(entries.filter((entry) => entry.roleType === 'reserve').map((entry) => [entry.DriverId, entry]));
  const reserveByRegular = new Map(entries
    .filter((entry) => entry.roleType === 'reserve' && entry.ReplacementForDriverId)
    .map((entry) => [entry.ReplacementForDriverId, entry]));
  const regularById = new Map();
  const teamCards = teams.map(({ roster, team, drivers }) => ({
    roster,
    team,
    rows: drivers.map((driver) => {
      regularById.set(driver.id, { driver, team });
      const saved = regularEntries.get(driver.id);
      return {
        driver, team,
        status: normalizeRegularStatus(saved?.status),
        replacementDriverId: reserveByRegular.get(driver.id)?.DriverId || null
      };
    })
  }));
  const reserveRows = reserves.map((driver) => {
    const saved = reserveEntries.get(driver.id);
    return {
      driver,
      status: normalizeReserveStatus(saved?.status),
      assignedTo: saved?.ReplacementForDriverId ? regularById.get(saved.ReplacementForDriverId) || null : null
    };
  });
  return { teamCards, reserves, reserveRows, hasSavedPlan: entries.length > 0 };
}

exports.show = async (req, res) => {
  const leagues = await League.findAll({ where: { type: 'f1' }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  const selectedLeague = leagues.find((league) => league.id === Number(req.query.league)) || leagues[0] || null;
  const activeSeason = selectedLeague ? await Season.findOne({
    where: { leagueType: 'f1', scopeSlug: selectedLeague.slug, status: 'active' }
  }) : null;
  const races = activeSeason ? await GrandPrixResult.findAll({
    where: { SeasonId: activeSeason.id, LeagueId: selectedLeague.id, discipline: 'f1', raceType: 'main' },
    order: [['sortOrder', 'ASC'], ['raceDate', 'ASC'], ['id', 'ASC']]
  }) : [];
  const today = new Date().toISOString().slice(0, 10);
  const selectedRace = races.find((race) => race.id === Number(req.query.race))
    || races.find((race) => !race.raceDate || race.raceDate >= today)
    || races[races.length - 1]
    || null;
  const planning = selectedLeague ? await loadPlanningRows(selectedLeague, selectedRace) : { teamCards: [], reserves: [], reserveRows: [], hasSavedPlan: false };
  res.render('admin/f1-race-lineup', {
    title: 'Fahrereinteilung nächstes Rennen', leagues, selectedLeague, activeSeason,
    races, selectedRace, regularStatuses: REGULAR_STATUSES, reserveStatuses: RESERVE_STATUSES,
    ...planning
  });
};

exports.save = async (req, res) => {
  const race = await GrandPrixResult.findByPk(req.params.raceId, {
    include: [{ association: 'league' }, { association: 'seasonRecord' }]
  });
  if (!race || race.discipline !== 'f1' || race.raceType !== 'main' || race.seasonRecord?.status !== 'active') {
    return res.status(404).render('errors/404', { title: 'Aktuelles Formel-1-Rennen nicht gefunden' });
  }
  const { teamCards, reserves } = await loadPlanningRows(race.league, null);
  const regularRows = teamCards.flatMap((card) => card.rows);
  const reserveById = new Map(reserves.map((driver) => [driver.id, driver]));
  const regularInput = req.body.regular || {};
  const reserveInput = req.body.reserve || {};
  const usedReserves = new Set();
  const replacementByReserve = new Map();

  try {
    for (const row of regularRows) {
      const input = regularInput[String(row.driver.id)] || {};
      const replacementId = Number(input.ReplacementDriverId || 0) || null;
      if (!replacementId) continue;
      if (!reserveById.has(replacementId)) throw new Error(`${row.driver.name}: Der gewählte Ersatzfahrer besitzt nicht den passenden Liga-Rang.`);
      if (usedReserves.has(replacementId)) throw new Error(`${reserveById.get(replacementId).name} kann nur einen Stammfahrer ersetzen.`);
      usedReserves.add(replacementId);
      replacementByReserve.set(replacementId, row);
    }

    const records = [];
    regularRows.forEach((row, index) => {
      const input = regularInput[String(row.driver.id)] || {};
      records.push({
        GrandPrixResultId: race.id, DriverId: row.driver.id, TeamId: row.team.id,
        roleType: 'regular', status: normalizeRegularStatus(input.status), sortOrder: index
      });
    });
    reserves.forEach((driver, index) => {
      const input = reserveInput[String(driver.id)] || {};
      const replacement = replacementByReserve.get(driver.id);
      records.push({
        GrandPrixResultId: race.id, DriverId: driver.id,
        ReplacementForDriverId: replacement?.driver.id || null,
        TeamId: replacement?.team.id || null,
        roleType: 'reserve', status: normalizeReserveStatus(input.status), sortOrder: index
      });
    });

    await sequelize.transaction(async (transaction) => {
      await F1RaceLineupEntry.destroy({ where: { GrandPrixResultId: race.id }, transaction });
      if (records.length) await F1RaceLineupEntry.bulkCreate(records, { transaction });
    });
    req.session.flash = { type: 'success', message: `${race.title}: Stamm- und Ersatzfahrer wurden gespeichert und in den aktuellen Saisonverlauf übernommen.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(`/admin/f1-race-lineup?league=${race.LeagueId}&race=${race.id}`);
};

module.exports.loadPlanningRows = loadPlanningRows;
