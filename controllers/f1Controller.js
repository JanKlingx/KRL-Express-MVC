const {
  League,
  Team,
  Driver,
  GrandPrixResult,
  GrandPrixResultEntry
} = require('../models');
const { buildSeasonData } = require('../services/standings');
const { sendCsv } = require('../services/csv');

async function loadLeagueData(slug) {
  const league = await League.findOne({ where: { slug, type: 'f1' } });
  if (!league) return null;
  const [drivers, gpResults] = await Promise.all([
    Driver.findAll({ where: { LeagueId: league.id }, include: [{ model: Team, as: 'team' }], order: [['sortOrder', 'ASC'], ['number', 'ASC']] }),
    GrandPrixResult.findAll({
      where: { LeagueId: league.id, season: league.currentSeason },
      include: [{ model: GrandPrixResultEntry, as: 'entries' }],
      order: [['sortOrder', 'ASC'], ['raceDate', 'ASC'], [{ model: GrandPrixResultEntry, as: 'entries' }, 'sortOrder', 'ASC'], [{ model: GrandPrixResultEntry, as: 'entries' }, 'position', 'ASC']]
    })
  ]);
  return { league, drivers, gpResults, ...buildSeasonData(league, gpResults, drivers) };
}

exports.show = async (req, res) => {
  const data = await loadLeagueData(req.params.slug);
  if (!data) return res.status(404).render('errors/404', { title: 'Liga nicht gefunden' });

  res.render('f1', {
    title: data.league.name,
    ...data
  });
};

exports.downloadDriverStandings = async (req, res) => {
  const data = await loadLeagueData(req.params.slug);
  if (!data) return res.status(404).end();
  const rows = [['Position', 'Fahrer', 'Team', 'Punkte', 'Siege', 'Rückstand']];
  data.driverStandings.forEach((row) => rows.push([row.position, row.driver.name, row.driver.team.name, row.points, row.wins, row.gap]));
  sendCsv(res, `${data.league.slug}-${data.league.currentSeason}-fahrer-wm.csv`, rows);
};

exports.downloadTeamStandings = async (req, res) => {
  const data = await loadLeagueData(req.params.slug);
  if (!data) return res.status(404).end();
  const rows = [['Position', 'Team', 'Punkte', 'Siege', 'Rückstand']];
  data.teamStandings.forEach((row) => rows.push([row.position, row.team.name, row.points, row.wins, row.gap]));
  sendCsv(res, `${data.league.slug}-${data.league.currentSeason}-team-wm.csv`, rows);
};

exports.downloadGpResults = async (req, res) => {
  const data = await loadLeagueData(req.params.slug);
  if (!data) return res.status(404).end();
  const rows = [['Runde', 'Grand Prix', 'Datum', 'Position', 'Status', 'Fahrer', 'Team', 'Punkte', 'Schnellste Runde']];
  data.gpResults.forEach((race, raceIndex) => {
    race.entries.forEach((entry) => rows.push([
      race.sortOrder || raceIndex + 1, race.title, race.raceDate || '', entry.position || '', entry.status || '',
      entry.driverName, entry.teamName || '', Number(entry.points), entry.fastestLap ? 'Ja' : 'Nein'
    ]));
  });
  sendCsv(res, `${data.league.slug}-${data.league.currentSeason}-gp-results.csv`, rows);
};
