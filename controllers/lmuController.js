const { League, Team, Driver, RaceEvent, LmuCockpit, LmuStandingImage } = require('../models');

exports.show = async (req, res) => {
  const league = await League.findOne({ where: { slug: 'lmu' } });
  if (!league) return res.status(404).render('errors/404', { title: 'LMU-Liga nicht gefunden' });
  const [cockpits, standingImages, teams, drivers, calendar] = await Promise.all([
    LmuCockpit.findAll({ where: { LeagueId: league.id }, include: [{ association: 'driverOne' }, { association: 'driverTwo' }, { association: 'driverThree' }, { association: 'reserve' }], order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    LmuStandingImage.findAll({ where: { LeagueId: league.id, season: league.currentSeason }, order: [['sortOrder', 'ASC'], ['id', 'DESC']] }),
    Team.findAll({ where: { LeagueId: league.id }, order: [['sortOrder', 'ASC']] }),
    Driver.findAll({ where: { LeagueId: league.id }, include: [{ model: Team, as: 'team' }, { association: 'aliases' }], order: [['sortOrder', 'ASC']] }),
    RaceEvent.findAll({ where: { LeagueId: league.id, isPublished: true }, order: [['startsAt', 'ASC']] })
  ]);
  res.render('lmu', { title: league.name, league, cockpits, standingImages, teams, drivers, calendar });
};
