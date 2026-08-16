const { Op } = require('sequelize');
const { League, Season, RaceEvent, GrandPrixResult } = require('../models');
const seasonProgress = require('../services/seasonProgress');

const disciplineFor = (league) => league?.type === 'competition' ? 'wdl' : league?.type;
const redirectTo = (leagueId, seasonId) => `/admin/season-calendar?league=${leagueId || ''}&season=${seasonId || ''}`;
const timeFromLeague = (league) => String(league?.raceTime || '').match(/\b([01]\d|2[0-3]):[0-5]\d\b/)?.[0] || '20:00';

async function loadData(query = {}) {
  const leagues = await League.findAll({ where: { type: { [Op.in]: ['f1', 'lmu', 'competition'] } }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  const selectedLeague = leagues.find((league) => league.id === Number(query.league)) || leagues[0] || null;
  const discipline = disciplineFor(selectedLeague);
  const seasons = selectedLeague ? await Season.findAll({ where: { leagueType: discipline, scopeSlug: selectedLeague.slug }, order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']] }) : [];
  const selectedSeason = seasons.find((season) => season.id === Number(query.season)) || seasons.find((season) => season.status === 'active') || seasons[0] || null;
  const rawEvents = selectedSeason ? await RaceEvent.findAll({ where: { LeagueId: selectedLeague.id, SeasonId: selectedSeason.id }, order: [['sortOrder', 'ASC'], ['startsAt', 'ASC'], ['id', 'ASC']] }) : [];
  const sprints = selectedSeason?.leagueType === 'f1' ? await GrandPrixResult.findAll({
    where: { LeagueId: selectedLeague.id, SeasonId: selectedSeason.id, raceType: 'sprint' },
    attributes: ['circuit', 'sortOrder']
  }) : [];
  const sprintKeys = new Set(sprints.map((race) => `${race.circuit}::${race.sortOrder}`));
  const events = rawEvents.map((event) => ({
    ...event.toJSON(), hasSprint: sprintKeys.has(`${event.circuit}::${event.sortOrder}`)
  }));
  return { leagues, selectedLeague, discipline, seasons, selectedSeason, events, defaultTime: timeFromLeague(selectedLeague) };
}

exports.show = async (req, res) => res.render('admin/season-calendar', { title: 'Rennkalender bearbeiten', ...(await loadData(req.query)) });

exports.create = async (req, res) => {
  let league;
  try {
    const season = await Season.findByPk(req.body.SeasonId);
    league = await League.findByPk(req.body.LeagueId);
    if (!season || !league || season.scopeSlug !== league.slug || season.leagueType !== disciplineFor(league)) throw new Error('Saison und Liga passen nicht zusammen.');
    const date = String(req.body.date || '');
    const time = String(req.body.time || timeFromLeague(league));
    const startsAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startsAt.getTime())) throw new Error('Datum oder Startzeit ist ungültig.');
    const { main } = await seasonProgress.createManualRace(season.leagueType, {
      ...req.body, raceDate: date, pointsMode: 'database', hasSprint: req.body.hasSprint
    });
    await RaceEvent.create({
      LeagueId: league.id, SeasonId: season.id, GrandPrixResultId: main.id,
      title: main.title, circuit: main.circuit, startsAt,
      durationMinutes: Number(req.body.durationMinutes || 120), isPublished: true,
      isTestDay: req.body.isTestDay === 'on', sortOrder: main.sortOrder
    });
    req.session.flash = { type: 'success', message: `${main.title} wurde im Saisonkalender angelegt.` };
    return res.redirect(redirectTo(league.id, season.id));
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    return res.redirect(redirectTo(league?.id || req.body.LeagueId, req.body.SeasonId));
  }
};

exports.update = async (req, res, next) => {
  const event = await RaceEvent.findByPk(req.params.eventId, { include: [{ association: 'seasonRecord' }, { association: 'league' }, { association: 'grandPrixResult' }] });
  if (!event) return next();
  try {
    const date = String(req.body.date || '');
    const time = String(req.body.time || timeFromLeague(event.league));
    const startsAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startsAt.getTime())) throw new Error('Datum oder Startzeit ist ungültig.');
    const title = String(req.body.title || '').trim();
    const circuit = String(req.body.circuit || title).trim();
    if (!title || !circuit) throw new Error('Rennen und Strecke sind erforderlich.');
    const sortOrder = Number(req.body.sortOrder || event.sortOrder || 0);
    await event.update({ title, circuit, startsAt, sortOrder, durationMinutes: Number(req.body.durationMinutes || 120), isTestDay: req.body.isTestDay === 'on' });
    if (event.grandPrixResult) {
      const main = event.grandPrixResult;
      const oldCircuit = main.circuit;
      const oldSortOrder = main.sortOrder;
      await seasonProgress.updateRaceSettings(main.discipline, main.id, { pointsMode: main.pointsMode, hasSprint: req.body.hasSprint });
      const sprint = await GrandPrixResult.findOne({
        where: { SeasonId: main.SeasonId, LeagueId: main.LeagueId, circuit: oldCircuit, sortOrder: oldSortOrder, raceType: 'sprint' }
      });
      await main.update({ title, circuit, raceDate: date, sortOrder });
      if (sprint) await sprint.update({ title: `Sprint · ${circuit}`, circuit, raceDate: date, sortOrder });
    }
    req.session.flash = { type: 'success', message: `${title} wurde aktualisiert.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(redirectTo(event.LeagueId, event.SeasonId));
};

exports.remove = async (req, res, next) => {
  const event = await RaceEvent.findByPk(req.params.eventId);
  if (!event) return next();
  const { LeagueId, SeasonId, GrandPrixResultId } = event;
  const main = GrandPrixResultId ? await GrandPrixResult.findByPk(GrandPrixResultId) : null;
  await event.destroy();
  if (main) await seasonProgress.removeRaceEvent(main.discipline, GrandPrixResultId);
  req.session.flash = { type: 'success', message: 'Kalendereintrag wurde entfernt.' };
  res.redirect(redirectTo(LeagueId, SeasonId));
};
