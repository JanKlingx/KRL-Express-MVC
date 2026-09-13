const { Driver, GrandPrixResult, GrandPrixResultEntry } = require('../models');
const { buildCareerStatistics } = require('../services/careerStatistics');
exports.show = async (req, res) => {
  const [drivers, entries] = await Promise.all([
    Driver.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] }),
    GrandPrixResultEntry.findAll({ include: [{ model: GrandPrixResult, as: 'grandPrixResult', required: true,
      include: [{ association: 'league' }, { association: 'seasonRecord' }, { association: 'calendarEvent' }] }] })
  ]);
  res.render('statistics', { title: 'KRL-Statistik', statistics: buildCareerStatistics(drivers, entries) });
};
