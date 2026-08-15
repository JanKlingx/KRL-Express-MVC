const { Op } = require('sequelize');
const {
  sequelize, League, Team, Driver, Season, GrandPrixResult, GrandPrixResultEntry
} = require('../models');
const { pointsForPosition, recalculateDriverRaceCounts } = require('../services/championship');

const statuses = ['', 'DNF', 'DNS', 'DNQ', 'DSQ', 'DNA'];

async function getRaces(leagueId, seasonId) {
  return GrandPrixResult.findAll({
    where: { LeagueId: leagueId, SeasonId: seasonId, discipline: 'f1' },
    include: [{ model: League, as: 'league', where: { type: 'f1' } }],
    order: [['sortOrder', 'ASC'], ['raceType', 'DESC'], ['raceDate', 'ASC']]
  });
}

function findDriverEntry(driver, entries) {
  const names = new Set([driver.name, ...(driver.aliases || []).map((alias) => alias.alias)]);
  return entries.find((entry) => entry.DriverId === driver.id || (!entry.DriverId && names.has(entry.driverName)));
}

async function loadEligibleDrivers(season, teams) {
  if (season.status === 'historical') {
    return Driver.findAll({ include: [{ association: 'aliases' }], order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  }
  const assigned = new Map();
  teams.forEach((team) => [team.driverOne, team.driverTwo].filter(Boolean).forEach((driver) => {
    if (!assigned.has(driver.id)) assigned.set(driver.id, { driver, assignedTeam: team, isReserve: false });
  }));
  const reserves = await Driver.findAll({ where: { roleF1Reserve: true }, include: [{ association: 'aliases' }], order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  reserves.forEach((driver) => { if (!assigned.has(driver.id)) assigned.set(driver.id, { driver, assignedTeam: null, isReserve: true }); });
  return [...assigned.values()];
}

exports.show = async (req, res) => {
  const leagues = await League.findAll({ where: { type: 'f1' }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  const selectedLeague = leagues.find((league) => league.id === Number(req.query.league)) || leagues[0] || null;
  const seasons = selectedLeague ? await Season.findAll({
    where: { leagueType: 'f1', scopeSlug: selectedLeague.slug },
    include: [{ association: 'category' }],
    order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']]
  }) : [];
  const selectedSeason = seasons.find((season) => season.id === Number(req.query.season)) || seasons.find((season) => season.status === 'active') || seasons[0] || null;
  const races = selectedLeague && selectedSeason ? await getRaces(selectedLeague.id, selectedSeason.id) : [];
  const selectedRace = races.find((race) => race.id === Number(req.query.race)) || races[0] || null;
  const teams = selectedLeague ? await Team.findAll({
    where: { LeagueId: selectedLeague.id },
    include: [{ association: 'driverOne', include: [{ association: 'aliases' }] }, { association: 'driverTwo', include: [{ association: 'aliases' }] }],
    order: [['sortOrder', 'ASC'], ['name', 'ASC']]
  }) : [];
  let rows = [];
  if (selectedRace && selectedSeason) {
    const [eligible, entries] = await Promise.all([
      loadEligibleDrivers(selectedSeason, teams),
      GrandPrixResultEntry.findAll({ where: { GrandPrixResultId: selectedRace.id }, order: [['sortOrder', 'ASC'], ['position', 'ASC']] })
    ]);
    rows = eligible.map((value) => {
      const wrapper = value.driver ? value : { driver: value, assignedTeam: null, isReserve: false };
      return { ...wrapper, entry: findDriverEntry(wrapper.driver, entries) || null };
    });
  }
  res.render('admin/race-editor', {
    title: 'Tabellarischer Saisonverlauf', leagues, selectedLeague, seasons, selectedSeason,
    races, selectedRace, teams, rows, statuses
  });
};

exports.save = async (req, res) => {
  const race = await GrandPrixResult.findByPk(req.params.raceId, { include: [{ model: League, as: 'league' }, { model: Season, as: 'seasonRecord' }] });
  if (!race || race.discipline !== 'f1' || !race.seasonRecord) return res.status(404).render('errors/404', { title: 'Formel-1-Rennen nicht gefunden' });
  const teams = await Team.findAll({
    where: { LeagueId: race.LeagueId },
    include: [{ association: 'driverOne', include: [{ association: 'aliases' }] }, { association: 'driverTwo', include: [{ association: 'aliases' }] }]
  });
  const eligible = await loadEligibleDrivers(race.seasonRecord, teams);
  const driverRows = eligible.map((value) => value.driver ? value : { driver: value, assignedTeam: null, isReserve: false });
  const driverIds = driverRows.map(({ driver }) => driver.id);
  const existingEntries = await GrandPrixResultEntry.findAll({
    where: { GrandPrixResultId: race.id, [Op.or]: [{ DriverId: { [Op.in]: driverIds } }, { DriverId: null }] }
  });
  const submittedRows = req.body.rows || {};
  const usedPositions = new Map();
  for (const { driver } of driverRows) {
    const submitted = submittedRows[String(driver.id)] || {};
    if (submitted.included !== 'on' || !submitted.position) continue;
    const position = Number(submitted.position);
    if (usedPositions.has(position)) {
      req.session.flash = { type: 'error', message: `Platz ${position} wurde doppelt vergeben (${usedPositions.get(position)} und ${driver.name}).` };
      return res.redirect(`/admin/race-editor?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`);
    }
    usedPositions.set(position, driver.name);
  }

  await sequelize.transaction(async (transaction) => {
    for (const { driver, assignedTeam, isReserve } of driverRows) {
      const submitted = submittedRows[String(driver.id)] || {};
      const existing = findDriverEntry(driver, existingEntries);
      if (submitted.included !== 'on') {
        if (existing) await existing.destroy({ transaction });
        continue;
      }
      const selectedTeam = submitted.TeamId && await Team.findOne({ where: { id: submitted.TeamId, LeagueId: race.LeagueId }, transaction });
      const team = race.seasonRecord.status === 'historical' || isReserve ? selectedTeam : assignedTeam;
      if (!team) throw new Error(`${driver.name}: Bitte ein Team für dieses Rennen auswählen.`);
      const position = submitted.position ? Number(submitted.position) : null;
      const status = statuses.includes(submitted.status) ? submitted.status : '';
      const values = {
        GrandPrixResultId: race.id, DriverId: driver.id, driverName: driver.name, teamName: team.name,
        position, status: status || null,
        points: await pointsForPosition(position, { ...race.toJSON(), fastestLap: submitted.fastestLap === 'on' }),
        fastestLap: submitted.fastestLap === 'on', sortOrder: position || driver.sortOrder || 999
      };
      if (existing) await existing.update(values, { transaction });
      else await GrandPrixResultEntry.create(values, { transaction });
    }
  });
  await recalculateDriverRaceCounts();
  req.session.flash = { type: 'success', message: `${race.title}: Ergebnis, Punkte und WM wurden automatisch aktualisiert.` };
  res.redirect(`/admin/race-editor?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`);
};
