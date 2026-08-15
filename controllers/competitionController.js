const { League, Season, ParticipatingLeague, GrandPrixResult, RaceEvent } = require('../models');
const { buildWdlStandings } = require('../services/championship');
const { sendCsv } = require('../services/csv');

async function loadData(requestedSeasonId) {
  const pageLeague = await League.findOne({ where: { slug: 'wettkampf', type: 'competition' } });
  if (!pageLeague) return null;
  const seasons = await Season.findAll({ where: { leagueType: 'wdl', scopeSlug: 'wettkampf' }, include: [{ association: 'category' }], order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']] });
  const selectedSeason = seasons.find((season) => season.id === Number(requestedSeasonId)) || seasons.find((season) => season.status === 'active') || seasons[0] || null;
  const leagueWhere = selectedSeason?.status === 'historical' ? {} : { isActive: true };
  const leagues = await ParticipatingLeague.findAll({
    where: leagueWhere,
    include: [{ association: 'f1Team' }],
    order: [['sortOrder', 'ASC'], ['id', 'ASC']],
    limit: selectedSeason?.status === 'historical' ? undefined : 11
  });
  const participantIds = leagues.map((league) => league.id);
  const [races, publishedCalendar] = await Promise.all([
    selectedSeason ? GrandPrixResult.findAll({
      where: { SeasonId: selectedSeason.id, discipline: 'wdl' },
      include: [{
        association: 'wdlEntries',
        required: false,
        where: { ParticipatingLeagueId: participantIds },
        include: [{ association: 'participatingLeague' }, { association: 'driverOne' }, { association: 'driverTwo' }]
      }],
      order: [['sortOrder', 'ASC'], ['raceDate', 'ASC']]
    }) : [],
    selectedSeason ? RaceEvent.findAll({ where: { SeasonId: selectedSeason.id, LeagueId: pageLeague.id, isPublished: true }, order: [['startsAt', 'ASC']] }) : []
  ]);
  const calendar = publishedCalendar.length ? publishedCalendar : races
    .filter((race) => race.raceDate)
    .map((race) => ({ id: `result-${race.id}`, title: race.title, circuit: race.circuit, startsAt: new Date(`${race.raceDate}T12:00:00Z`) }));
  return { pageLeague, seasons, selectedSeason, leagues, races, calendar, standings: buildWdlStandings(races) };
}

exports.show = async (req, res) => {
  const data = await loadData(req.query.season);
  if (!data) return res.status(404).render('errors/404', { title: 'WDL-Seite nicht gefunden' });
  res.render('competition', { title: 'Wettkampf der Ligen', ...data });
};

exports.downloadStandings = async (req, res) => {
  const data = await loadData(req.query.season);
  if (!data) return res.status(404).end();
  const rows = [['Position', 'Liga', 'Punkte', 'Siege']];
  data.standings.forEach((row) => rows.push([row.position, row.league.name, row.points, row.wins]));
  sendCsv(res, `wdl-${data.selectedSeason?.name || 'saison'}-standings.csv`, rows);
};

exports.downloadResults = async (req, res) => {
  const data = await loadData(req.query.season);
  if (!data) return res.status(404).end();
  const rows = [['Rennen', 'Liga', 'Fahrer 1', 'Platz 1', 'Fahrer 2', 'Platz 2', 'Punkte']];
  data.races.forEach((race) => race.wdlEntries.forEach((entry) => rows.push([
    race.title, entry.participatingLeague?.name || '', entry.driverOne?.name || '', entry.positionOne || '',
    entry.driverTwo?.name || '', entry.positionTwo || '', Number(entry.totalPoints)
  ])));
  sendCsv(res, `wdl-${data.selectedSeason?.name || 'saison'}-results.csv`, rows);
};

module.exports.loadData = loadData;
