const { League, Team, Driver, DriverStanding, TeamStanding, GrandPrixResult } = require('../models');

exports.show = async (req, res) => {
  const league = await League.findOne({ where: { slug: req.params.slug, type: 'f1' } });
  if (!league) return res.status(404).render('errors/404', { title: 'Liga nicht gefunden' });

  const [drivers, driverStandings, teamStandings, gpResults] = await Promise.all([
    Driver.findAll({ where: { LeagueId: league.id }, include: [{ model: Team, as: 'team' }], order: [['sortOrder', 'ASC'], ['number', 'ASC']] }),
    DriverStanding.findAll({ where: { LeagueId: league.id, season: league.currentSeason }, include: [{ model: Driver, as: 'driver', include: [{ model: Team, as: 'team' }] }], order: [['position', 'ASC']] }),
    TeamStanding.findAll({ where: { LeagueId: league.id, season: league.currentSeason }, include: [{ model: Team, as: 'team' }], order: [['position', 'ASC']] }),
    GrandPrixResult.findAll({ where: { LeagueId: league.id, season: league.currentSeason }, order: [['sortOrder', 'ASC'], ['raceDate', 'DESC']] })
  ]);

  res.render('f1', { title: league.name, league, drivers, driverStandings, teamStandings, gpResults });
};
