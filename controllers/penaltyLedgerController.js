const { Op } = require('sequelize');
const { League, Driver, PenaltyRule, PenaltyEntry, GrandPrixResult } = require('../models');

const disciplineFor = (league) => league.type === 'competition' ? 'wdl' : league.type;
const rolesFor = (discipline) => discipline === 'lmu'
  ? ['roleLmuRegular', 'roleLmuReserve', 'roleFormerLmu']
  : ['roleF1Friday', 'roleF1Saturday', 'roleF1Sunday', 'roleF1ReserveFriday', 'roleF1ReserveSaturday', 'roleF1ReserveSunday', 'roleFormerF1'];

exports.show = async (req, res) => {
  const leagues = await League.findAll({ where: { type: { [Op.in]: ['f1', 'lmu', 'competition'] } }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  const league = leagues.find((row) => row.id === Number(req.query.league)) || leagues[0] || null;
  const discipline = league ? disciplineFor(league) : 'f1';
  const roles = rolesFor(discipline);
  const drivers = await Driver.findAll({ where: { [Op.or]: roles.map((role) => ({ [role]: true })) }, include: [{ association: 'penalties', required: false, where: { LeagueId: league?.id || 0, expiresOn: { [Op.gte]: new Date().toISOString().slice(0, 10) } } }], order: [['name', 'ASC']] });
  const rules = await PenaltyRule.findAll({ where: { discipline }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  const race = league ? await GrandPrixResult.findOne({ where: { LeagueId: league.id }, order: [['raceDate', 'DESC'], ['sortOrder', 'DESC']] }) : null;
  const rows = drivers.map((driver) => {
    const penalties = driver.penalties || [];
    const points = penalties.reduce((sum, entry) => sum + Number(entry.points || 0), 0);
    const threshold = rules[0]?.suspensionThreshold || 12;
    const role = roles.slice(0, 3).some((field) => driver[field]) ? 'Stammfahrer' : roles.slice(3, 6).some((field) => driver[field]) ? 'Ersatzfahrer' : 'Ehemalig';
    return { ...driver.toJSON(), penalties, points, remaining: Math.max(threshold - points, 0), suspended: points >= threshold, role };
  });
  res.render('admin/penalty-ledger', { title: 'Strafkartei', leagues, league, discipline, rows, rules, race });
};

exports.create = async (req, res) => {
  const league = await League.findByPk(req.body.LeagueId);
  const driver = await Driver.findByPk(req.body.DriverId);
  if (!league || !driver) {
    req.session.flash = { type: 'error', message: 'Liga oder Fahrer wurde nicht gefunden.' };
    return res.redirect('/admin/penalty-ledger');
  }
  const awardedOn = req.body.awardedOn || new Date().toISOString().slice(0, 10);
  const expires = new Date(`${awardedOn}T12:00:00`); expires.setFullYear(expires.getFullYear() + 1);
  await PenaltyEntry.create({ LeagueId: league.id, DriverId: driver.id, GrandPrixResultId: req.body.GrandPrixResultId || null, points: Number(req.body.points || 0), reason: String(req.body.reason || 'Manuelle Strafe'), comment: String(req.body.comment || ''), awardedOn, expiresOn: expires.toISOString().slice(0, 10), isAutomatic: false });
  req.session.flash = { type: 'success', message: 'Strafpunkte wurden mit einer Gültigkeit von einem Jahr eingetragen.' };
  res.redirect(`/admin/penalty-ledger?league=${league.id}`);
};
