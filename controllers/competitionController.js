const { ParticipatingLeague, LeagueCompetitionStanding } = require('../models');

exports.show = async (req, res) => {
  const [leagues, standings] = await Promise.all([
    ParticipatingLeague.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    LeagueCompetitionStanding.findAll({ include: [{ model: ParticipatingLeague, as: 'participatingLeague' }], order: [['position', 'ASC']] })
  ]);
  res.render('competition', { title: 'Wettkampf der Ligen', leagues, standings });
};
