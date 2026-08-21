const { League, TeamRoster, TeamRosterDriver, Season, GrandPrixResult, GrandPrixResultEntry, RaceEvent, SeasonF1CarAssignment } = require('../models');
const { buildSeasonData } = require('../services/standings');
const { sendCsv } = require('../services/csv');
const { loadSeasonStructure } = require('../services/f1Season');

async function loadLeagueData(slug, requestedSeasonId) {
  const league = await League.findOne({ where: { slug, type: 'f1' } });
  if (!league) return null;
  const seasons = await Season.findAll({ where: { leagueType: 'f1', scopeSlug: slug, isPublished: true }, include: [{ association: 'category' }], order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']] });
  const selectedSeason = seasons.find((season) => season.id === Number(requestedSeasonId)) || seasons.find((season) => season.status === 'active') || seasons[0] || null;
  const where = selectedSeason ? { LeagueId: league.id, SeasonId: selectedSeason.id, discipline: 'f1' } : { LeagueId: league.id, season: league.currentSeason };
  const [rosters, gpResults, activeCalendar, seasonCarAssignments, seasonStructure] = await Promise.all([
    TeamRoster.findAll({
      where: { LeagueId: league.id, discipline: 'f1' },
      include: [{ association: 'team' }, { association: 'assignments', include: [{ association: 'driver', include: [{ association: 'aliases' }] }] }],
      order: [['sortOrder', 'ASC'], ['id', 'ASC'], [{ model: TeamRosterDriver, as: 'assignments' }, 'sortOrder', 'ASC']]
    }),
    GrandPrixResult.findAll({
      where,
      include: [{ model: GrandPrixResultEntry, as: 'entries' }],
      order: [['sortOrder', 'ASC'], ['raceType', 'DESC'], ['raceDate', 'ASC'], [{ model: GrandPrixResultEntry, as: 'entries' }, 'sortOrder', 'ASC'], [{ model: GrandPrixResultEntry, as: 'entries' }, 'position', 'ASC']]
    }),
    selectedSeason ? RaceEvent.findAll({ where: { LeagueId: league.id, SeasonId: selectedSeason.id }, include: [{ association: 'track', include: [{ association: 'countryRecord' }] }], order: [['sortOrder', 'ASC'], ['startsAt', 'ASC']] }) : [],
    selectedSeason ? SeasonF1CarAssignment.findAll({ where: { SeasonId: selectedSeason.id }, include: [{ association: 'carProfile' }] }) : [],
    loadSeasonStructure(selectedSeason?.id)
  ]);
  const carProfileByTeam = new Map(seasonCarAssignments.map((assignment) => [assignment.TeamId, assignment.carProfile]));
  const driverMap = new Map();
  const legacyTeams = rosters.map((roster) => {
    const carProfile = carProfileByTeam.get(roster.team.id);
    return {
      id: roster.team.id,
      name: roster.team.name,
      accentColor: carProfile?.accentColor || roster.team.accentColor,
      logoPath: carProfile?.logoPath || roster.team.logoPath,
      carProfileName: carProfile?.name || null,
      rosterId: roster.id,
      drivers: roster.assignments
      .filter((assignment) => assignment.roleName !== 'Ersatzfahrer')
      .map((assignment) => ({ ...assignment.driver.toJSON(), rosterRole: assignment.roleName }))
    };
  }).filter((team) => team.drivers.length >= 2);
  const teams = seasonStructure.teams.length ? seasonStructure.teams.map((team) => ({
    id: team.id, name: team.name, accentColor: team.accentColor, logoPath: team.logoPath,
    drivers: team.drivers.filter((driver) => driver.roleType === 'regular')
  })) : legacyTeams;
  teams.forEach((team) => team.drivers.forEach((driver) => {
    if (!driverMap.has(driver.id)) driverMap.set(driver.id, { ...driver, team: { id: team.id, name: team.name, logoPath: team.logoPath } });
  }));
  const drivers = [...driverMap.values()];
  const calendar = activeCalendar.length ? activeCalendar : gpResults
    .filter((race) => race.raceDate)
    .map((race) => ({ id: `result-${race.id}`, title: race.title, circuit: race.circuit, startsAt: new Date(`${race.raceDate}T12:00:00Z`) }));
  const leagueForSeason = { ...league.toJSON(), currentSeason: selectedSeason?.name || league.currentSeason, accentColor: selectedSeason?.accentColor || league.accentColor };
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
