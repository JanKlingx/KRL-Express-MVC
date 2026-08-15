const { Op } = require('sequelize');
const {
  sequelize, League, Team, Driver, GrandPrixResult, GrandPrixResultEntry
} = require('../models');

const statuses = ['', 'DNF', 'DNS', 'DNQ', 'DSQ', 'DNA'];
const standardPoints = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

async function getRaces(leagueId) {
  return GrandPrixResult.findAll({
    where: leagueId ? { LeagueId: leagueId } : undefined,
    include: [
      { model: League, as: 'league', where: { type: 'f1' } },
      { association: 'calendarEvent', required: true }
    ],
    order: [[{ model: League, as: 'league' }, 'sortOrder', 'ASC'], ['season', 'DESC'], ['sortOrder', 'ASC']]
  });
}

function findDriverEntry(driver, entries) {
  const names = new Set([driver.name, ...(driver.aliases || []).map((alias) => alias.alias)]);
  return entries.find((entry) => entry.DriverId === driver.id || (!entry.DriverId && names.has(entry.driverName)));
}

exports.show = async (req, res) => {
  const leagues = await League.findAll({ where: { type: 'f1' }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  const requestedLeagueId = Number(req.query.league);
  const selectedLeague = leagues.find((league) => league.id === requestedLeagueId) || leagues[0] || null;
  const races = await getRaces(selectedLeague?.id);
  const selectedId = Number(req.query.race) || races[0]?.id;
  const selectedRace = races.find((race) => race.id === selectedId) || null;
  let rows = [];
  if (selectedRace) {
    const selectedRole = selectedRace.league.slug === 'freitag' ? 'friday' : 'sunday';
    const [drivers, entries] = await Promise.all([
      Driver.findAll({
        where: { f1Role: selectedRole, TeamId: { [Op.ne]: null } },
        include: [{ model: Team, as: 'team' }, { association: 'aliases' }],
        order: [['sortOrder', 'ASC'], ['name', 'ASC']]
      }),
      GrandPrixResultEntry.findAll({ where: { GrandPrixResultId: selectedRace.id }, order: [['sortOrder', 'ASC'], ['position', 'ASC']] })
    ]);
    rows = drivers.map((driver) => ({ driver, entry: findDriverEntry(driver, entries) || null }));
  }
  res.render('admin/race-editor', { title: 'Tabellarischer Saisonverlauf', leagues, selectedLeague, races, selectedRace, rows, statuses, standardPoints });
};

exports.save = async (req, res) => {
  const race = await GrandPrixResult.findByPk(req.params.raceId);
  if (!race) return res.status(404).render('errors/404', { title: 'Grand Prix nicht gefunden' });
  const league = await League.findByPk(race.LeagueId);
  const selectedRole = league?.slug === 'freitag' ? 'friday' : 'sunday';
  const drivers = await Driver.findAll({
    where: { f1Role: selectedRole, TeamId: { [Op.ne]: null } }, include: [{ model: Team, as: 'team' }, { association: 'aliases' }]
  });
  const driverIds = drivers.map((driver) => driver.id);
  const existingEntries = await GrandPrixResultEntry.findAll({
    where: { GrandPrixResultId: race.id, [Op.or]: [{ DriverId: { [Op.in]: driverIds } }, { DriverId: null }] }
  });
  const submittedRows = req.body.rows || {};
  const usedPositions = new Map();
  for (const driver of drivers) {
    const submitted = submittedRows[String(driver.id)] || {};
    if (submitted.included !== 'on' || !submitted.position) continue;
    const position = Number(submitted.position);
    if (usedPositions.has(position)) {
      req.session.flash = { type: 'error', message: `Platz ${position} wurde doppelt vergeben (${usedPositions.get(position)} und ${driver.name}).` };
      return res.redirect(`/admin/race-editor?league=${race.LeagueId}&race=${race.id}`);
    }
    usedPositions.set(position, driver.name);
  }

  await sequelize.transaction(async (transaction) => {
    for (const driver of drivers) {
      const submitted = submittedRows[String(driver.id)] || {};
      const existing = findDriverEntry(driver, existingEntries);
      if (submitted.included !== 'on') {
        if (existing) await existing.destroy({ transaction });
        continue;
      }
      const position = submitted.position ? Number(submitted.position) : null;
      const status = statuses.includes(submitted.status) ? submitted.status : '';
      const points = submitted.points === '' || submitted.points === undefined
        ? (position && standardPoints[position - 1]) || 0
        : Number(submitted.points);
      const values = {
        GrandPrixResultId: race.id,
        DriverId: driver.id,
        driverName: driver.name,
        teamName: driver.team?.name || 'Privatteam',
        position,
        status: status || null,
        points: Number.isFinite(points) ? points : 0,
        fastestLap: submitted.fastestLap === 'on',
        sortOrder: position || driver.sortOrder || 999
      };
      if (existing) await existing.update(values, { transaction });
      else await GrandPrixResultEntry.create(values, { transaction });
    }
  });

  req.session.flash = { type: 'success', message: `${race.title}: Saisonverlauf wurde tabellarisch gespeichert.` };
  res.redirect(`/admin/race-editor?league=${race.LeagueId}&race=${race.id}`);
};
