const { Op } = require('sequelize');
const { League, Team, Driver, TeamRoster, TeamRosterDriver } = require('../models');

const configs = {
  f1: {
    title: 'F1-Fahrerfelder', leagueType: 'f1', minimum: 2,
    description: 'Zentrale Teams einer F1-Liga zuordnen und anschließend mindestens zwei Fahrer hinzufügen.'
  },
  lmu: {
    title: 'LMU-Cockpits', leagueType: 'lmu', minimum: 3,
    description: 'Zentrale Teams als LMU-Cockpit verwenden und anschließend mindestens drei Fahrer hinzufügen.'
  }
};

function redirectPath(discipline, leagueId) {
  return `/admin/team-rosters/${discipline}${leagueId ? `?league=${Number(leagueId)}` : ''}`;
}

async function loadRoster(id) {
  return TeamRoster.findByPk(id, { include: [{ association: 'league' }, { association: 'team' }] });
}

function driverWhere(discipline) {
  return discipline === 'f1'
    ? { [Op.or]: [{ roleF1Friday: true }, { roleF1Sunday: true }] }
    : { [Op.or]: [{ roleLmuRegular: true }, { roleLmuReserve: true }] };
}

function driverFitsRoster(driver, roster) {
  if (roster.discipline === 'lmu') return driver.roleLmuRegular || driver.roleLmuReserve;
  return roster.league.slug === 'freitag' ? driver.roleF1Friday : driver.roleF1Sunday;
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
    Driver.findAll({ where: driverWhere(discipline), include: [{ association: 'aliases' }], order: [['name', 'ASC'], ['id', 'ASC']] }),
    selectedLeague ? TeamRoster.findAll({
      where: { discipline, LeagueId: selectedLeague.id },
      include: [
        { association: 'team' }, { association: 'league' },
        { association: 'assignments', include: [{ association: 'driver', include: [{ association: 'aliases' }] }] }
      ],
      order: [['sortOrder', 'ASC'], ['id', 'ASC'], [{ model: TeamRosterDriver, as: 'assignments' }, 'sortOrder', 'ASC']]
    }) : []
  ]);
  res.render('admin/team-rosters', { title: config.title, discipline, config, leagues, selectedLeague, teams, drivers, rosters });
};

exports.create = async (req, res, next) => {
  const discipline = req.params.discipline;
  const config = configs[discipline];
  if (!config) return next();
  try {
    const [league, team] = await Promise.all([
      League.findByPk(req.body.LeagueId), Team.findByPk(req.body.TeamId)
    ]);
    if (!league || league.type !== config.leagueType || !team || team.LeagueId !== null || team.discipline !== discipline) throw new Error('Liga und passendes zentrales Team müssen ausgewählt werden.');
    const duplicate = await TeamRoster.findOne({ where: { discipline, LeagueId: league.id, TeamId: team.id } });
    if (duplicate) throw new Error(`${team.name} ist in ${league.name} bereits vorhanden.`);
    await TeamRoster.create({
      discipline, LeagueId: league.id, TeamId: team.id,
      vehicleClass: req.body.vehicleClass?.trim() || null,
      carNumber: req.body.carNumber?.trim() || null,
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
    const driver = await resolveDriver(req.body);
    if (!roster || roster.discipline !== discipline || !driver) throw new Error('Aufstellung oder Fahrer wurde nicht gefunden.');
    if (!driverFitsRoster(driver, roster)) throw new Error(`${driver.name} besitzt nicht die passende Fahrerrolle für ${roster.league.name}.`);
    const otherRoster = await TeamRosterDriver.findOne({
      where: { DriverId: driver.id },
      include: [{ association: 'roster', where: { LeagueId: roster.LeagueId, discipline } }]
    });
    if (otherRoster && otherRoster.TeamRosterId !== roster.id) throw new Error(`${driver.name} ist in dieser Liga bereits einem anderen Team zugeordnet.`);
    const count = await TeamRosterDriver.count({ where: { TeamRosterId: roster.id } });
    const isF1Regular = roster.league.slug === 'freitag' ? driver.roleF1Friday : driver.roleF1Sunday;
    const roleName = discipline === 'f1'
      ? (isF1Regular ? 'Stammfahrer' : 'Ersatzfahrer')
      : (driver.roleLmuReserve && !driver.roleLmuRegular ? 'Ersatzfahrer' : 'Stammfahrer');
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
  if (assignment?.roster?.discipline === discipline) await assignment.destroy();
  req.session.flash = { type: 'success', message: 'Fahrer wurde aus der Aufstellung entfernt.' };
  res.redirect(redirectPath(discipline, leagueId));
};

exports.removeRoster = async (req, res, next) => {
  const discipline = req.params.discipline;
  if (!configs[discipline]) return next();
  const roster = await TeamRoster.findOne({ where: { id: req.params.rosterId, discipline } });
  const leagueId = roster?.LeagueId;
  if (roster) await roster.destroy();
  req.session.flash = { type: 'success', message: 'Aufstellung wurde entfernt. Das zentrale Team bleibt erhalten.' };
  res.redirect(redirectPath(discipline, leagueId));
};

module.exports.configs = configs;
