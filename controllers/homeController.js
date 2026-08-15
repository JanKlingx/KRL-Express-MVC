const {
  SiteStatistic, League, RaceEvent, KrlTeam, KrlIcon
} = require('../models');
const { Op, col } = require('sequelize');

exports.index = async (req, res) => {
  const [statistics, krlTeams, krlIcons, leagues, nextRace] = await Promise.all([
    SiteStatistic.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    KrlTeam.findAll({ include: [{ association: 'assignments', include: [{ association: 'driver' }] }], order: [[col('KrlTeam.sort_order'), 'ASC'], [col('assignments.sort_order'), 'ASC']] }),
    KrlIcon.findAll({ include: [{ association: 'driver' }], order: [[col('KrlIcon.sort_order'), 'ASC'], [col('KrlIcon.id'), 'ASC']] }),
    League.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    RaceEvent.findOne({
      where: { startsAt: { [Op.gte]: new Date() }, isPublished: true },
      include: [{ model: League, as: 'league', where: { type: { [Op.in]: ['f1', 'lmu'] } } }],
      order: [['startsAt', 'ASC']]
    })
  ]);
  const nextRaceView = nextRace && {
    ...nextRace.toJSON(),
    iso: nextRace.startsAt.toISOString(),
    date: new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' }).format(nextRace.startsAt),
    time: new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(nextRace.startsAt)
  };
  res.render('home', { title: 'Katzes Racing League', statistics, krlTeams, krlIcons, leagues, nextRace: nextRaceView });
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
