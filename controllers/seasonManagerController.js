const { Op } = require('sequelize');
const { sequelize, League, Season, PointsScheme, RaceEvent, GrandPrixResult } = require('../models');
const { activateSeason } = require('../services/championship');

const disciplineFor = (league) => league.type === 'competition' ? 'wdl' : league.type;

async function data(query) {
  const leagues = await League.findAll({ where: { type: 'f1', slug: { [Op.in]: ['freitag', 'samstag', 'sonntag'] } }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  const league = leagues.find((row) => row.id === Number(query.league)) || leagues[0] || null;
  const discipline = 'f1';
  const seasons = league ? await Season.findAll({
    where: { leagueType: discipline, scopeSlug: league.slug },
    include: [{ association: 'pointsScheme' }], order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']]
  }) : [];
  const schemes = await PointsScheme.findAll({ where: { discipline }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  return { leagues, league, discipline, seasons, schemes };
}

exports.show = async (req, res) => res.render('admin/season-manager', { title: 'Saisons verwalten', ...(await data(req.query)) });

exports.update = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  if (!season) return res.redirect('/admin/season-manager');
  const league = await League.findOne({ where: { slug: season.scopeSlug } });
  const fields = {
    name: String(req.body.name || '').trim(), gameName: String(req.body.gameName || '').trim() || null,
    status: req.body.status === 'historical' ? 'historical' : 'active',
    isPublished: req.body.isPublished === 'on', accentColor: req.body.accentColor || null,
    PointsSchemeId: req.body.PointsSchemeId ? Number(req.body.PointsSchemeId) : null,
    reservePointsForConstructors: req.body.reservePointsForConstructors === 'on'
  };
  if (!fields.name) {
    req.session.flash = { type: 'error', message: 'Ein Saisonname ist erforderlich.' };
    return res.redirect(`/admin/season-manager?league=${league?.id || ''}`);
  }
  if (!/^#[0-9a-f]{6}$/i.test(fields.accentColor || '')) {
    req.session.flash = { type: 'error', message: 'Bitte eine gültige Saisonfarbe auswählen.' };
    return res.redirect(`/admin/season-manager?league=${league?.id || ''}`);
  }
  const [duplicate, scheme] = await Promise.all([
    Season.findOne({ where: { id: { [Op.ne]: season.id }, leagueType: 'f1', scopeSlug: season.scopeSlug, name: fields.name } }),
    PointsScheme.findOne({ where: { id: fields.PointsSchemeId || 0, discipline: 'f1' } })
  ]);
  if (duplicate) {
    req.session.flash = { type: 'error', message: `Die Saison „${fields.name}“ existiert in dieser Liga bereits.` };
    return res.redirect(`/admin/season-manager?league=${league?.id || ''}`);
  }
  if (!scheme) {
    req.session.flash = { type: 'error', message: 'Bitte ein Formel-1-Punktesystem auswählen.' };
    return res.redirect(`/admin/season-manager?league=${league?.id || ''}`);
  }
  await sequelize.transaction(async (transaction) => {
    if (fields.status === 'active') await Season.update({ status: 'historical' }, { where: { leagueType: season.leagueType, scopeSlug: season.scopeSlug, id: { [Op.ne]: season.id }, status: 'active' }, transaction });
    await season.update(fields, { transaction });
  });
  await activateSeason(season);
  req.session.flash = { type: 'success', message: 'Saisonattribute wurden gespeichert.' };
  res.redirect(`/admin/season-manager?league=${league?.id || ''}`);
};

exports.remove = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  if (!season) return res.redirect('/admin/season-manager');
  const league = await League.findOne({ where: { slug: season.scopeSlug } });
  await sequelize.transaction(async (transaction) => {
    const races = await GrandPrixResult.findAll({ where: { SeasonId: season.id }, attributes: ['id'], transaction });
    await RaceEvent.destroy({ where: { SeasonId: season.id }, transaction });
    if (races.length) await GrandPrixResult.destroy({ where: { id: races.map((race) => race.id) }, transaction });
    await season.destroy({ transaction });
  });
  req.session.flash = { type: 'success', message: 'Saison, Kalender und zugehörige Ergebnisse wurden gelöscht.' };
  res.redirect(`/admin/season-manager?league=${league?.id || ''}`);
};
