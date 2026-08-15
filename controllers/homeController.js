const {
  SiteStatistic, TeamCategory, TeamMember, League
} = require('../models');

exports.index = async (req, res) => {
  const [statistics, categories, leagues] = await Promise.all([
    SiteStatistic.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    TeamCategory.findAll({
      include: [{ model: TeamMember, as: 'members' }],
      order: [['sortOrder', 'ASC'], [{ model: TeamMember, as: 'members' }, 'sortOrder', 'ASC']]
    }),
    League.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] })
  ]);
  res.render('home', { title: 'Katzes Racing League', statistics, categories, leagues });
};

exports.endurance = (req, res) => res.render('placeholder', {
  title: 'KRL Endurance',
  heading: 'KRL Endurance',
  text: 'Langstreckenrennen, Teamwork und Strategie – weitere Informationen folgen.'
});

exports.legal = (req, res) => res.render('placeholder', {
  title: req.path === '/datenschutz' ? 'Datenschutz' : req.path === '/kontakt' ? 'Kontakt' : 'Impressum',
  heading: req.path === '/datenschutz' ? 'Datenschutz' : req.path === '/kontakt' ? 'Kontakt' : 'Impressum',
  text: 'Bitte vor der Veröffentlichung durch die rechtlich erforderlichen Angaben des Betreibers ersetzen.'
});
