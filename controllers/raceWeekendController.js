const { Op } = require('sequelize');
const { League, Season, RaceEvent } = require('../models');
const disciplineFor = (league) => league.type === 'competition' ? 'wdl' : league.type;

exports.show = async (req, res) => {
  const requested = req.params.discipline;
  const type = requested === 'wdl' ? 'competition' : requested;
  const leagues = await League.findAll({ where: { type }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  const league = leagues.find((item) => item.id === Number(req.query.league)) || leagues[0] || null;
  const discipline = league ? disciplineFor(league) : requested;
  const seasons = league ? await Season.findAll({ where: { scopeSlug: league.slug, leagueType: discipline }, order: [['status', 'ASC'], ['id', 'DESC']] }) : [];
  const season = seasons.find((item) => item.id === Number(req.query.season)) || seasons.find((item) => item.status === 'active') || seasons[0] || null;
  const events = season ? await RaceEvent.findAll({ where: { LeagueId: league.id, SeasonId: season.id }, order: [['startsAt', 'ASC'], ['sortOrder', 'ASC']] }) : [];
  const event = events.find((item) => item.id === Number(req.query.event)) || events[0] || null;
  const lineupHref = discipline === 'f1' ? `/admin/f1-race-lineup?league=${league?.id || ''}&race=${event?.GrandPrixResultId || ''}` : discipline === 'lmu' ? `/admin/lmu-race-lineup?league=${league?.id || ''}&race=${event?.GrandPrixResultId || ''}` : `/admin/season-progress/wdl?league=${league?.id || ''}&season=${season?.id || ''}`;
  const resultsHref = discipline === 'f1' ? `/admin/current-season-progress?league=${league?.id || ''}&race=${event?.GrandPrixResultId || ''}` : `/admin/season-progress/${discipline}?league=${league?.id || ''}&season=${season?.id || ''}`;
  res.render('admin/race-weekend', { title: 'Rennwochenende', requested, leagues, league, seasons, season, events, event, lineupHref, resultsHref });
};
