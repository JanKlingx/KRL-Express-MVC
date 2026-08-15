const { League, Team, Season, GrandPrixResult, GrandPrixResultEntry, RaceEvent } = require('../models');
const { buildSeasonData } = require('../services/standings');
const { sendCsv } = require('../services/csv');

async function loadLeagueData(slug, requestedSeasonId) {
  const league = await League.findOne({ where: { slug, type: 'f1' } });
  if (!league) return null;
  const seasons = await Season.findAll({ where: { leagueType: 'f1', scopeSlug: slug }, order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']] });
  const selectedSeason = seasons.find((season) => season.id === Number(requestedSeasonId)) || seasons.find((season) => season.status === 'active') || seasons[0] || null;
  const where = selectedSeason ? { LeagueId: league.id, SeasonId: selectedSeason.id, discipline: 'f1' } : { LeagueId: league.id, season: league.currentSeason };
  const [teams, gpResults, activeCalendar] = await Promise.all([
    Team.findAll({
      where: { LeagueId: league.id },
      include: [{ association: 'driverOne', include: [{ association: 'aliases' }] }, { association: 'driverTwo', include: [{ association: 'aliases' }] }],
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    }),
    GrandPrixResult.findAll({
      where,
      include: [{ model: GrandPrixResultEntry, as: 'entries' }],
      order: [['sortOrder', 'ASC'], ['raceDate', 'ASC'], [{ model: GrandPrixResultEntry, as: 'entries' }, 'sortOrder', 'ASC'], [{ model: GrandPrixResultEntry, as: 'entries' }, 'position', 'ASC']]
    }),
    selectedSeason ? RaceEvent.findAll({ where: { LeagueId: league.id, SeasonId: selectedSeason.id, isPublished: true }, order: [['startsAt', 'ASC']] }) : []
  ]);
  const driverMap = new Map();
  teams.forEach((team) => [team.driverOne, team.driverTwo].filter(Boolean).forEach((driver) => {
    if (!driverMap.has(driver.id)) driverMap.set(driver.id, { ...driver.toJSON(), team: { id: team.id, name: team.name, logoPath: team.logoPath } });
  }));
  const drivers = [...driverMap.values()];
  const calendar = activeCalendar.length ? activeCalendar : gpResults
    .filter((race) => race.raceDate)
    .map((race) => ({ id: `result-${race.id}`, title: race.title, circuit: race.circuit, startsAt: new Date(`${race.raceDate}T12:00:00Z`) }));
  const leagueForSeason = { ...league.toJSON(), currentSeason: selectedSeason?.name || league.currentSeason };
  return { league: leagueForSeason, teams, drivers, gpResults, calendar, seasons, selectedSeason, ...buildSeasonData(leagueForSeason, gpResults, drivers) };
}

exports.show = async (req, res) => {
  const data = await loadLeagueData(req.params.slug, req.query.season);
  if (!data) return res.status(404).render('errors/404', { title: 'Liga nicht gefunden' });
  res.render('f1', { title: data.league.name, ...data });
};

exports.downloadDriverStandings = async (req, res) => {
  const data = await loadLeagueData(req.params.slug, req.query.season);
  if (!data) return res.status(404).end();
  const rows = [['Position', 'Fahrer', 'Team', 'Punkte', 'Siege', 'Rückstand']];
  data.driverStandings.forEach((row) => rows.push([row.position, row.driver.name, row.driver.team.name, row.points, row.wins, row.gap]));
  sendCsv(res, `${data.league.slug}-${data.selectedSeason?.name || data.league.currentSeason}-fahrer-wm.csv`, rows);
};

exports.downloadTeamStandings = async (req, res) => {
  const data = await loadLeagueData(req.params.slug, req.query.season);
  if (!data) return res.status(404).end();
  const rows = [['Position', 'Team', 'Punkte', 'Siege', 'Rückstand']];
  data.teamStandings.forEach((row) => rows.push([row.position, row.team.name, row.points, row.wins, row.gap]));
  sendCsv(res, `${data.league.slug}-${data.selectedSeason?.name || data.league.currentSeason}-team-wm.csv`, rows);
};

exports.downloadGpResults = async (req, res) => {
  const data = await loadLeagueData(req.params.slug, req.query.season);
  if (!data) return res.status(404).end();
  const rows = [['Runde', 'Grand Prix', 'Datum', 'Position', 'Status', 'Fahrer', 'Team', 'Punkte', 'Schnellste Runde']];
  data.gpResults.forEach((race, raceIndex) => race.entries.forEach((entry) => rows.push([
    race.sortOrder || raceIndex + 1, race.title, race.raceDate || '', entry.position || '', entry.status || '',
    entry.driverName, entry.teamName || '', Number(entry.points), entry.fastestLap ? 'Ja' : 'Nein'
  ])));
  sendCsv(res, `${data.league.slug}-${data.selectedSeason?.name || data.league.currentSeason}-gp-results.csv`, rows);
};

module.exports.loadLeagueData = loadLeagueData;
