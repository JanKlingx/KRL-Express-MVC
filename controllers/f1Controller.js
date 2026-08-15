const {
  League,
  Team,
  Driver,
  DriverStanding,
  TeamStanding,
  GrandPrixResult,
  GrandPrixResultEntry,
  LeagueHistorySource
} = require('../models');
const { getLeagueHistory } = require('../services/seasonHistory');

exports.show = async (req, res) => {
  const league = await League.findOne({ where: { slug: req.params.slug, type: 'f1' } });
  if (!league) return res.status(404).render('errors/404', { title: 'Liga nicht gefunden' });

  const [drivers, driverStandings, teamStandings, gpResults, historySource] = await Promise.all([
    Driver.findAll({ where: { LeagueId: league.id }, include: [{ model: Team, as: 'team' }], order: [['sortOrder', 'ASC'], ['number', 'ASC']] }),
    DriverStanding.findAll({ where: { LeagueId: league.id, season: league.currentSeason }, include: [{ model: Driver, as: 'driver', include: [{ model: Team, as: 'team' }] }], order: [['position', 'ASC']] }),
    TeamStanding.findAll({ where: { LeagueId: league.id, season: league.currentSeason }, include: [{ model: Team, as: 'team' }], order: [['position', 'ASC']] }),
    GrandPrixResult.findAll({
      where: { LeagueId: league.id, season: league.currentSeason },
      include: [{ model: GrandPrixResultEntry, as: 'entries' }],
      order: [['sortOrder', 'ASC'], ['raceDate', 'DESC'], [{ model: GrandPrixResultEntry, as: 'entries' }, 'sortOrder', 'ASC'], [{ model: GrandPrixResultEntry, as: 'entries' }, 'position', 'ASC']]
    }),
    LeagueHistorySource.findOne({ where: { LeagueId: league.id } })
  ]);

  const history = await getLeagueHistory(league, historySource);
  const requestedSeason = typeof req.query.season === 'string' ? req.query.season : '';
  const selectedHistory = history.seasons.find((season) => season.name === requestedSeason) || history.seasons[0] || null;

  res.render('f1', {
    title: league.name,
    league,
    drivers,
    driverStandings,
    teamStandings,
    gpResults,
    history,
    selectedHistory
  });
};
