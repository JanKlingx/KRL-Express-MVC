const { Op } = require('sequelize');
const { Driver, ParticipatingLeague, LeagueCompetitionStanding } = require('../models');

exports.show = async (req, res) => {
  const [leagues, standings, drivers] = await Promise.all([
    ParticipatingLeague.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    LeagueCompetitionStanding.findAll({ include: [{ model: ParticipatingLeague, as: 'participatingLeague' }, { association: 'driverOne' }, { association: 'driverTwo' }], order: [['position', 'ASC']] }),
    Driver.findAll({ where: { ParticipatingLeagueId: { [Op.ne]: null } }, include: [{ model: ParticipatingLeague, as: 'participatingLeague' }, { association: 'aliases' }], order: [['sortOrder', 'ASC']] })
  ]);
  res.render('competition', { title: 'Wettkampf der Ligen', leagues, standings, drivers });
};
