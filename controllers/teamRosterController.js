const { Op } = require('sequelize');
const { League, Season, Team, Driver, TeamRoster, TeamRosterDriver } = require('../models');
const { regularRoleField } = require('../services/raceLineup');
const { seasonLineupIsProtected } = require('../services/seasonDriverStints');

const configs = {
  f1: {
    title: 'F1-Fahrerfelder', leagueType: 'f1', minimum: 2,
    description: 'Zentrale Teams einer F1-Liga zuordnen und anschließend mindestens zwei Fahrer hinzufügen.'
  },
  lmu: {
    title: 'LMU-Fahrerfeld', leagueType: 'lmu', minimum: 1,
    description: '1. LMU-Team auswählen, 2. LMU-Stammfahrer hinzufügen, fertig. Das persönliche Auto wird direkt beim Fahrer gepflegt.'
  }
};

function redirectPath(discipline, leagueId) {
  return `/admin/team-rosters/${discipline}${leagueId ? `?league=${Number(leagueId)}` : ''}`;
}

async function loadRoster(id) {
  return TeamRoster.findByPk(id, { include: [{ association: 'league' }, { association: 'team' }] });
}

async function protectedSeasonForLeague(leagueId) {
  const league = await League.findByPk(leagueId);
  if (!league || league.type !== 'f1') return null;
  const seasons = await Season.findAll({
    where: { leagueType: 'f1', scopeSlug: league.slug, status: 'active' },
    order: [['status', 'ASC'], ['id', 'DESC']]
  });
  for (const season of seasons) {
    if (await seasonLineupIsProtected(season)) return season;
  }
  return null;
}

async function assertRosterWritable(discipline, leagueId) {
  if (discipline !== 'f1') return;
  if (await protectedSeasonForLeague(leagueId)) {
    throw new Error('Stammfahrer einer laufenden Saison können nur über Fahrerwechsel geändert werden.');
  }
}

function driverWhere(discipline) {
  return discipline === 'f1'
    ? { [Op.or]: [{ roleF1Friday: true }, { roleF1Saturday: true }, { roleF1Sunday: true }] }
    : { roleLmuRegular: true };
}

function driverFitsRoster(driver, roster) {
  if (roster.discipline === 'lmu') return driver.roleLmuRegular;
  return Boolean(driver[regularRoleField(roster.league.slug)]);
}

async function resolveDriver(body) {
  if (Number(body.DriverId) > 0) return Driver.findByPk(body.DriverId);
  const search = String(body.driverSearch || '').trim().toLocaleLowerCase('de-DE');
  if (!search) return null;
  const drivers = await Driver.findAll({ include: [{ association: 'aliases' }] });
  return drivers.find((driver) => driver.name.toLocaleLowerCase('de-DE') === search
    || driver.aliases.some((alias) => alias.alias.toLocaleLowerCase('de-DE') === search)) || null;
}

exports.show = async (req, res, next) => {
  const discipline = req.params.discipline;
  const config = configs[discipline];
  if (!config) return next();
  const leagues = await League.findAll({ where: { type: config.leagueType }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  const selectedLeague = leagues.find((league) => league.id === Number(req.query.league)) || leagues[0] || null;
  const [teams, drivers, rosters] = await Promise.all([
    Team.findAll({ where: { LeagueId: null, discipline }, order: [['sortOrder', 'ASC'], ['name', 'ASC'], ['id', 'ASC']] }),
    Driver.findAll({ where: driverWhere(discipline), include: [{ association: 'aliases' }, ...(discipline === 'lmu' ? [{ association: 'lmuCar' }] : [])], order: [['name', 'ASC'], ['id', 'ASC']] }),
    selectedLeague ? TeamRoster.findAll({
      where: { discipline, LeagueId: selectedLeague.id },
      include: [
        { association: 'team' }, { association: 'league' },
        { association: 'assignments', include: [{ association: 'driver', include: [{ association: 'aliases' }, ...(discipline === 'lmu' ? [{ association: 'lmuCar' }] : [])] }] }
      ],
      order: [['sortOrder', 'ASC'], ['id', 'ASC'], [{ model: TeamRosterDriver, as: 'assignments' }, 'sortOrder', 'ASC']]
    }) : []
  ]);
  const protectedSeason = discipline === 'f1' && selectedLeague ? await protectedSeasonForLeague(selectedLeague.id) : null;
  res.render('admin/team-rosters', { title: config.title, discipline, config, leagues, selectedLeague, teams, drivers, rosters, driverFitsRoster, protectedSeason });
};

exports.create = async (req, res, next) => {
  const discipline = req.params.discipline;
  const config = configs[discipline];
  if (!config) return next();
  try {
    await assertRosterWritable(discipline, req.body.LeagueId);
    const [league, team] = await Promise.all([
      League.findByPk(req.body.LeagueId), Team.findByPk(req.body.TeamId)
    ]);
    if (!league || league.type !== config.leagueType || !team || team.LeagueId !== null || team.discipline !== discipline) throw new Error('Liga und passendes zentrales Team müssen ausgewählt werden.');
    const duplicate = await TeamRoster.findOne({ where: { discipline, LeagueId: league.id, TeamId: team.id } });
    if (duplicate) throw new Error(`${team.name} ist in ${league.name} bereits vorhanden.`);
    await TeamRoster.create({
      discipline, LeagueId: league.id, TeamId: team.id,
      vehicleClass: discipline === 'f1' ? req.body.vehicleClass?.trim() || null : null,
      carNumber: discipline === 'f1' ? req.body.carNumber?.trim() || null : null,
      sortOrder: Number(req.body.sortOrder || 0)
    });
    req.session.flash = { type: 'success', message: `${team.name} wurde hinzugefügt. Jetzt Fahrer zuordnen.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(redirectPath(discipline, req.body.LeagueId));
};

exports.addDriver = async (req, res, next) => {
  const discipline = req.params.discipline;
  if (!configs[discipline]) return next();
  let roster;
  try {
    roster = await loadRoster(req.params.rosterId);
    await assertRosterWritable(discipline, roster?.LeagueId);
    const driver = await resolveDriver(req.body);
    if (!roster || roster.discipline !== discipline || !driver) throw new Error('Aufstellung oder Fahrer wurde nicht gefunden.');
    if (!driverFitsRoster(driver, roster)) throw new Error(`${driver.name} besitzt nicht die passende Fahrerrolle für ${roster.league.name}.`);
    const otherRoster = await TeamRosterDriver.findOne({
      where: { DriverId: driver.id },
      include: [{ association: 'roster', where: { LeagueId: roster.LeagueId, discipline } }]
    });
    if (otherRoster && otherRoster.TeamRosterId !== roster.id) throw new Error(`${driver.name} ist in dieser Liga bereits einem anderen Team zugeordnet.`);
    const count = await TeamRosterDriver.count({ where: { TeamRosterId: roster.id } });
    const isF1Regular = Boolean(driver[regularRoleField(roster.league.slug)]);
    const roleName = discipline === 'f1'
      ? (isF1Regular ? 'Stammfahrer' : 'Ersatzfahrer')
      : 'Stammfahrer';
    await TeamRosterDriver.findOrCreate({
      where: { TeamRosterId: roster.id, DriverId: driver.id },
      defaults: { TeamRosterId: roster.id, DriverId: driver.id, roleName, sortOrder: count }
    });
    req.session.flash = { type: 'success', message: `${driver.name} wurde ${roster.team.name} zugeordnet.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(redirectPath(discipline, roster?.LeagueId));
};

exports.removeDriver = async (req, res, next) => {
  const discipline = req.params.discipline;
  if (!configs[discipline]) return next();
  const assignment = await TeamRosterDriver.findByPk(req.params.assignmentId, { include: [{ association: 'roster' }] });
  const leagueId = assignment?.roster?.LeagueId;
  try {
    await assertRosterWritable(discipline, leagueId);
    if (assignment?.roster?.discipline === discipline) await assignment.destroy();
    req.session.flash = { type: 'success', message: 'Fahrer wurde aus der Aufstellung entfernt.' };
  } catch (error) { req.session.flash = { type: 'error', message: error.message }; }
  res.redirect(redirectPath(discipline, leagueId));
};

exports.removeRoster = async (req, res, next) => {
  const discipline = req.params.discipline;
  if (!configs[discipline]) return next();
  const roster = await TeamRoster.findOne({ where: { id: req.params.rosterId, discipline } });
  const leagueId = roster?.LeagueId;
  try {
    await assertRosterWritable(discipline, leagueId);
    if (roster) await roster.destroy();
    req.session.flash = { type: 'success', message: 'Aufstellung wurde entfernt. Das zentrale Team bleibt erhalten.' };
  } catch (error) { req.session.flash = { type: 'error', message: error.message }; }
  res.redirect(redirectPath(discipline, leagueId));
};

module.exports.configs = configs;

