const { Op } = require('sequelize');
const {
  League, Season, Driver, PenaltyRule, PenaltyEntry, GrandPrixResult, F1PenaltySetting
} = require('../models');
const { loadSeasonStructure } = require('../services/f1Season');
const { regularRoleField, reserveRoleField } = require('../services/raceLineup');

const today = () => new Date().toISOString().slice(0, 10);

async function buildLeagueLedger(league) {
  const activeSeason = await Season.findOne({ where: { leagueType: 'f1', scopeSlug: league.slug, status: 'active', isPublished: true } });
  const [setting, rules, races, structure] = await Promise.all([
    F1PenaltySetting.findOne({ where: { LeagueId: league.id } }),
    PenaltyRule.findAll({ where: { discipline: 'f1' }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    activeSeason ? GrandPrixResult.findAll({ where: { LeagueId: league.id, SeasonId: activeSeason.id, raceType: 'main' }, order: [['sortOrder', 'ASC']] }) : [],
    activeSeason ? loadSeasonStructure(activeSeason.id) : { teams: [] }
  ]);
  const regularField = regularRoleField(league.slug);
  const reserveField = reserveRoleField(league.slug);
  const drivers = await Driver.findAll({
    where: { [Op.or]: [{ [regularField]: true }, { [reserveField]: true }, { roleFormerF1: true }] },
    include: [{ association: 'penalties', required: false, where: { LeagueId: league.id, expiresOn: { [Op.gte]: today() } } }],
    order: [['name', 'ASC'], ['id', 'ASC']]
  });
  const teamByDriver = new Map();
  structure.teams.forEach((team) => team.drivers.forEach((driver) => teamByDriver.set(driver.id, team)));
  const threshold = Number(setting?.pointsLimit || rules[0]?.suspensionThreshold || 12);
  const groups = { regular: [], reserve: [], former: [] };
  drivers.forEach((driver) => {
    const penalties = driver.penalties || [];
    const points = penalties.reduce((sum, entry) => sum + Number(entry.points || 0), 0);
    const hasBan = penalties.some((entry) => entry.isRaceBan);
    const row = {
      ...driver.toJSON(), team: teamByDriver.get(driver.id) || null, penalties, points,
      remaining: Math.max(threshold - points, 0), suspended: hasBan || points >= threshold
    };
    if (driver[regularField]) groups.regular.push(row);
    else if (driver[reserveField]) groups.reserve.push(row);
    else if (points || hasBan) groups.former.push(row);
  });
  return { league, activeSeason, races, rules, threshold, groups };
}

exports.show = async (req, res) => {
  const leagues = await League.findAll({ where: { type: 'f1', slug: { [Op.in]: ['freitag', 'samstag', 'sonntag'] } }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  const ledgers = await Promise.all(leagues.map(buildLeagueLedger));
  res.render('admin/penalty-ledger', { title: 'Formel 1 Strafkartei', ledgers });
};

exports.create = async (req, res) => {
  const [league, driver, race] = await Promise.all([
    League.findOne({ where: { id: Number(req.body.LeagueId), type: 'f1' } }),
    Driver.findByPk(Number(req.body.DriverId)),
    req.body.GrandPrixResultId ? GrandPrixResult.findByPk(Number(req.body.GrandPrixResultId)) : null
  ]);
  if (!league || !driver || (req.body.GrandPrixResultId && (!race || race.LeagueId !== league.id))) throw new Error('Liga, Fahrer oder Rennen ist ungültig.');
  const awardedOn = req.body.awardedOn || race?.raceDate || today();
  const expires = new Date(`${awardedOn}T12:00:00Z`); expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const isRaceBan = req.body.isRaceBan === 'on';
  const points = Number(req.body.points || 0);
  if (!isRaceBan && (!Number.isInteger(points) || points < 1)) throw new Error('Bitte mindestens einen Strafpunkt oder eine Rennsperre eintragen.');
  if (isRaceBan && !race) throw new Error('Für eine Rennsperre muss das gesperrte Rennen ausgewählt werden.');
  await PenaltyEntry.create({
    LeagueId: league.id, DriverId: driver.id, GrandPrixResultId: race?.id || null,
    points, reason: String(req.body.reason || (isRaceBan ? 'Rennsperre' : 'Manuelle Strafe')).trim(),
    comment: String(req.body.comment || ''), awardedOn, expiresOn: expires.toISOString().slice(0, 10),
    isAutomatic: false, isRaceBan
  });
  req.session.flash = { type: 'success', message: isRaceBan ? 'Rennsperre wurde eingetragen; der Fahrer ist in der Aufstellung blockiert.' : 'Strafpunkte wurden für ein Jahr eingetragen.' };
  res.redirect(`/admin/penalty-ledger#liga-${league.id}`);
};

exports.remove = async (req, res) => {
  const entry = await PenaltyEntry.findByPk(Number(req.params.id));
  const leagueId = entry?.LeagueId;
  if (entry) await entry.destroy();
  req.session.flash = { type: 'success', message: 'Strafe wurde aus der Kartei entfernt.' };
  res.redirect(`/admin/penalty-ledger${leagueId ? `#liga-${leagueId}` : ''}`);
};

module.exports.buildLeagueLedger = buildLeagueLedger;
