const { Driver, GrandPrixResult, GrandPrixResultEntry, Season, League } = require('../models');
const { buildCareerStatistics } = require('../services/careerStatistics');
exports.show = async (req, res) => {
  const [drivers, entries] = await Promise.all([
    Driver.findAll({ attributes: ['id', 'name', 'viewF1', 'roleFormerF1'], order: [['name', 'ASC']] }),
    GrandPrixResultEntry.findAll({ include: [{ model: GrandPrixResult, as: 'grandPrixResult', required: true, where: {discipline:'f1'},
      include: [{ association: 'league' }, { association: 'seasonRecord' }, { association: 'calendarEvent' }] }] })
  ]);
  const scopes = await Season.findAll({where:{leagueType:'f1'},attributes:['name','scopeSlug']});
  const leagues = await League.findAll({where:{type:'f1'},attributes:['name','slug']});
  const scopeCatalog=scopes.map(season=>({season:season.name,league:leagues.find(league=>league.slug===season.scopeSlug)?.name||season.scopeSlug}));
  res.render('statistics', { title: 'KRL F1-Statistik', scopeCatalog, statistics: buildCareerStatistics(drivers.filter(driver=>driver.viewF1 || driver.roleFormerF1 || entries.some(entry=>Number(entry.DriverId)===Number(driver.id))), entries) });
};
