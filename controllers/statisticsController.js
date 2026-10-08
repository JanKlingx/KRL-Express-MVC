const { Op } = require('sequelize');
const { Driver, GrandPrixResult, GrandPrixResultEntry, Season, League } = require('../models');
const { buildCareerStatistics } = require('../services/careerStatistics');
exports.show = async (req, res) => {
  const [drivers, entries] = await Promise.all([
    Driver.findAll({ attributes: ['id', 'name', 'viewF1', 'roleFormerF1', 'viewLmu', 'roleFormerLmu'], include:[{association:'aliases',attributes:['alias','sortOrder']}], order: [['name', 'ASC']] }),
    GrandPrixResultEntry.findAll({ include: [{ model: GrandPrixResult, as: 'grandPrixResult', required: true, where: {discipline:{[Op.in]:['f1','lmu']}},
      include: [{ association: 'league' }, { association: 'seasonRecord' }, { association: 'calendarEvent' }] }] })
  ]);
  const scopes = await Season.findAll({where:{leagueType:{[Op.in]:['f1','lmu']},...(req.session?.userId?{}:{isPublished:true})},attributes:['name','scopeSlug','leagueType']});
  const leagues = await League.findAll({where:{type:{[Op.in]:['f1','lmu']}},attributes:['name','slug']});
  const scopeCatalog=scopes.map(season=>({discipline:season.leagueType,season:season.name,league:leagues.find(league=>league.slug===season.scopeSlug)?.name||season.scopeSlug}));
  res.render('statistics', { title: 'KRL Fahrerstatistik', scopeCatalog, statistics: buildCareerStatistics(drivers.filter(driver=>driver.viewF1 || driver.roleFormerF1 || driver.viewLmu || driver.roleFormerLmu || entries.some(entry=>Number(entry.DriverId)===Number(driver.id))), entries.filter(entry=>req.session?.userId||entry.grandPrixResult?.seasonRecord?.isPublished!==false)) });
};

// Reuse the championship calculation so carryovers and reserve rules stay identical.
exports.team = async (req, res) => {
  const slug = String(req.query.league || '');
  const teamName = String(req.query.team || '');
  const data = await require('./f1Controller').loadLeagueData(slug, req.query.season);
  if (!data || (req.query.season && Number(req.query.season) !== Number(data.selectedSeason?.id)) || !data.teamStandings.some(team => team.name === teamName)) return res.status(404).send('Team nicht gefunden.');
  const team = data.teamStandings.find(team => team.name === teamName);
  const rounds = data.standingsHistory.map(weekend => {
    const standing = weekend.teamStandings.find(row => row.name === teamName);
    return { ...weekend, standing };
  }).filter(row => row.standing);
  res.render('team-statistics', { title: `${teamName} · Teamstatistik`, league: data.league, season: data.selectedSeason, team, rounds });
};

exports.teams = async (req, res) => {
  const { Team } = require('../models');
  const [teams, entries] = await Promise.all([
    Team.findAll({ where: { LeagueId: null, discipline: 'f1' }, attributes: ['id', 'name', 'logoPath', 'AggregationTeamId'], order: [['name', 'ASC']] }),
    GrandPrixResultEntry.findAll({ include: [{ model: GrandPrixResult, as: 'grandPrixResult', required: true, where: { discipline: 'f1' },
      include: [{ association: 'league' }, { association: 'seasonRecord' }, { association: 'calendarEvent' }] }] }),
  ]);
  res.render('team-career-statistics', { title: 'F1-Teamstatistiken', statistics: require('../services/teamCareerStatistics').buildTeamCareerStatistics(teams, entries) });
};
