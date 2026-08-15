const { League, LmuCockpit, LmuStandingImage } = require('../models');

exports.show = async (req, res) => {
  const league = await League.findOne({ where: { slug: 'lmu' } });
  if (!league) return res.status(404).render('errors/404', { title: 'LMU-Liga nicht gefunden' });
  const [cockpits, standingImages] = await Promise.all([
    LmuCockpit.findAll({ where: { LeagueId: league.id }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    LmuStandingImage.findAll({ where: { LeagueId: league.id, season: league.currentSeason }, order: [['sortOrder', 'ASC'], ['id', 'DESC']] })
  ]);
  res.render('lmu', { title: league.name, league, cockpits, standingImages });
};
