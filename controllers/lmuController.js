const { Op } = require('sequelize');
const { League, Team, Driver, Season, GrandPrixResult, GrandPrixResultEntry, RaceEvent, LmuCockpit } = require('../models');
const { buildSeasonData } = require('../services/standings');
const { sendCsv } = require('../services/csv');

async function loadData(requestedSeasonId) {
  const league = await League.findOne({ where: { slug: 'lmu', type: 'lmu' } });
  if (!league) return null;
  const seasons = await Season.findAll({ where: { leagueType: 'lmu', scopeSlug: 'lmu' }, include: [{ association: 'category' }], order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']] });
  const selectedSeason = seasons.find((season) => season.id === Number(requestedSeasonId)) || seasons.find((season) => season.status === 'active') || seasons[0] || null;
  const driverWhere = selectedSeason?.status === 'historical' ? {} : { [Op.or]: [{ roleLmuRegular: true }, { roleLmuReserve: true }] };
  const [cockpits, teams, drivers, gpResults, activeCalendar] = await Promise.all([
    LmuCockpit.findAll({ where: { LeagueId: league.id }, include: [{ association: 'driverOne' }, { association: 'driverTwo' }, { association: 'driverThree' }, { association: 'reserve' }], order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    Team.findAll({ where: { LeagueId: league.id }, order: [['sortOrder', 'ASC']] }),
    Driver.findAll({ where: driverWhere, include: [{ model: Team, as: 'team' }, { association: 'aliases' }], order: [['sortOrder', 'ASC']] }),
    selectedSeason ? GrandPrixResult.findAll({ where: { LeagueId: league.id, SeasonId: selectedSeason.id, discipline: 'lmu' }, include: [{ model: GrandPrixResultEntry, as: 'entries' }], order: [['sortOrder', 'ASC'], ['raceDate', 'ASC']] }) : [],
    selectedSeason ? RaceEvent.findAll({ where: { LeagueId: league.id, SeasonId: selectedSeason.id, isPublished: true }, order: [['startsAt', 'ASC']] }) : []
  ]);
  const calendar = activeCalendar.length ? activeCalendar : gpResults
    .filter((race) => race.raceDate)
    .map((race) => ({ id: `result-${race.id}`, title: race.title, circuit: race.circuit, startsAt: new Date(`${race.raceDate}T12:00:00Z`) }));
  const leagueForSeason = { ...league.toJSON(), currentSeason: selectedSeason?.name || league.currentSeason };
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
  data.driverStandings.forEach((row) => rows.push([row.position, row.driver.name, row.driver.team.name, row.points, row.wins]));
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
