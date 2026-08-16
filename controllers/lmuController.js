const { League, Driver, TeamRoster, TeamRosterDriver, Season, GrandPrixResult, GrandPrixResultEntry, RaceEvent } = require('../models');
const { buildSeasonData } = require('../services/standings');
const { sendCsv } = require('../services/csv');

async function loadData(requestedSeasonId) {
  const league = await League.findOne({ where: { slug: 'lmu', type: 'lmu' } });
  if (!league) return null;
  const seasons = await Season.findAll({ where: { leagueType: 'lmu', scopeSlug: 'lmu' }, include: [{ association: 'category' }], order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']] });
  const selectedSeason = seasons.find((season) => season.id === Number(requestedSeasonId)) || seasons.find((season) => season.status === 'active') || seasons[0] || null;
  const [rosters, historicalDrivers, gpResults, activeCalendar] = await Promise.all([
    TeamRoster.findAll({
      where: { LeagueId: league.id, discipline: 'lmu' },
      include: [{ association: 'team', include: [{ association: 'lmuCar' }] }, { association: 'assignments', include: [{ association: 'driver', include: [{ association: 'aliases' }, { association: 'lmuCar' }] }] }],
      order: [['sortOrder', 'ASC'], ['id', 'ASC'], [{ model: TeamRosterDriver, as: 'assignments' }, 'sortOrder', 'ASC']]
    }),
    selectedSeason?.status === 'historical' ? Driver.findAll({ include: [{ association: 'aliases' }], order: [['name', 'ASC']] }) : [],
    selectedSeason ? GrandPrixResult.findAll({ where: { LeagueId: league.id, SeasonId: selectedSeason.id, discipline: 'lmu' }, include: [{ model: GrandPrixResultEntry, as: 'entries' }], order: [['sortOrder', 'ASC'], ['raceDate', 'ASC']] }) : [],
    selectedSeason ? RaceEvent.findAll({ where: { LeagueId: league.id, SeasonId: selectedSeason.id, isPublished: true }, order: [['startsAt', 'ASC']] }) : []
  ]);
  const driverMap = new Map();
  rosters.filter((roster) => roster.assignments.filter((assignment) => assignment.roleName !== 'Ersatzfahrer').length >= 3).forEach((roster) => roster.assignments.filter((assignment) => assignment.roleName !== 'Ersatzfahrer').forEach((assignment) => {
    if (!driverMap.has(assignment.DriverId)) driverMap.set(assignment.DriverId, {
      ...assignment.driver.toJSON(), rosterRole: assignment.roleName,
      team: { id: roster.team.id, name: roster.team.name, logoPath: roster.team.logoPath, lmuCar: roster.team.lmuCar }
    });
  }));
  const drivers = selectedSeason?.status === 'historical' ? historicalDrivers : [...driverMap.values()];
  const cockpits = rosters.filter((roster) => roster.assignments.filter((assignment) => assignment.roleName !== 'Ersatzfahrer').length >= 3).map((roster) => ({
    ...roster.toJSON(), team: roster.team,
    drivers: roster.assignments.filter((assignment) => assignment.roleName !== 'Ersatzfahrer').map((assignment) => ({ ...assignment.driver.toJSON(), rosterRole: assignment.roleName }))
  }));
  const teams = rosters.map((roster) => roster.team);
  const calendar = activeCalendar.length ? activeCalendar : gpResults
    .filter((race) => race.raceDate)
    .map((race) => ({ id: `result-${race.id}`, title: race.title, circuit: race.circuit, startsAt: new Date(`${race.raceDate}T12:00:00Z`) }));
  const leagueForSeason = { ...league.toJSON(), currentSeason: selectedSeason?.name || league.currentSeason, accentColor: selectedSeason?.accentColor || league.accentColor };
  return { league: leagueForSeason, seasons, selectedSeason, cockpits, teams, drivers, gpResults, calendar, ...buildSeasonData(leagueForSeason, gpResults, drivers) };
}

exports.show = async (req, res) => {
  const data = await loadData(req.query.season);
  if (!data) return res.status(404).render('errors/404', { title: 'LMU-Liga nicht gefunden' });
  res.render('lmu', { title: data.league.name, ...data });
};

exports.downloadStandings = async (req, res) => {
  const data = await loadData(req.query.season);
  if (!data) return res.status(404).end();
  const rows = [['Position', 'Fahrer', 'Team', 'Punkte', 'Siege']];
  data.driverStandings.forEach((row) => rows.push([row.position, row.driver.lmuDisplayName || row.driver.name, row.driver.team.name, row.points, row.wins]));
  sendCsv(res, `lmu-${data.selectedSeason?.name || data.league.currentSeason}-wm.csv`, rows);
};

exports.downloadResults = async (req, res) => {
  const data = await loadData(req.query.season);
  if (!data) return res.status(404).end();
  const rows = [['Rennen', 'Platz', 'Status', 'Fahrer', 'Team', 'Punkte']];
  data.gpResults.forEach((race) => race.entries.forEach((entry) => rows.push([race.title, entry.position || '', entry.status || '', entry.driverName, entry.teamName || '', Number(entry.points)])));
  sendCsv(res, `lmu-${data.selectedSeason?.name || data.league.currentSeason}-results.csv`, rows);
};

module.exports.loadData = loadData;
