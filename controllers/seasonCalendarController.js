const { Op } = require('sequelize');
const { League, Season, RaceEvent, GrandPrixResult, F1Track } = require('../models');
const seasonProgress = require('../services/seasonProgress');

const disciplineFor = (league) => league?.type === 'competition' ? 'wdl' : league?.type;
const redirectTo = (leagueId, seasonId) => `/admin/season-calendar?league=${leagueId || ''}&season=${seasonId || ''}`;
const timeFromLeague = (league) => String(league?.raceTime || '').match(/\b([01]\d|2[0-3]):[0-5]\d\b/)?.[0] || '20:00';

async function loadData(query = {}) {
  const leagues = await League.findAll({ where: { type: 'f1', slug: { [Op.in]: ['freitag', 'samstag', 'sonntag'] } }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  const selectedLeague = leagues.find((league) => league.id === Number(query.league)) || leagues[0] || null;
  const discipline = disciplineFor(selectedLeague);
  const seasons = selectedLeague ? await Season.findAll({ where: { leagueType: discipline, scopeSlug: selectedLeague.slug }, order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']] }) : [];
  const selectedSeason = seasons.find((season) => season.id === Number(query.season)) || seasons.find((season) => season.status === 'active') || seasons[0] || null;
  const rawEvents = selectedSeason ? await RaceEvent.findAll({ where: { LeagueId: selectedLeague.id, SeasonId: selectedSeason.id }, include: [{ association: 'track', include: [{ association: 'countryRecord' }] }], order: [['sortOrder', 'ASC'], ['startsAt', 'ASC'], ['id', 'ASC']] }) : [];
  const sprints = selectedSeason?.leagueType === 'f1' ? await GrandPrixResult.findAll({
    where: { LeagueId: selectedLeague.id, SeasonId: selectedSeason.id, raceType: 'sprint' },
    attributes: ['circuit', 'sortOrder']
  }) : [];
  const sprintKeys = new Set(sprints.map((race) => `${race.circuit}::${race.sortOrder}`));
  const events = rawEvents.map((event) => ({
    ...event.toJSON(), hasSprint: sprintKeys.has(`${event.circuit}::${event.sortOrder}`)
  }));
  const tracks = discipline === 'f1' ? await F1Track.findAll({ include: [{ association: 'countryRecord' }], order: [['country', 'ASC'], ['name', 'ASC']] }) : [];
  return { leagues, selectedLeague, discipline, seasons, selectedSeason, events, tracks, defaultTime: timeFromLeague(selectedLeague) };
}

exports.show = async (req, res) => res.render('admin/season-calendar', { title: 'Rennkalender bearbeiten', ...(await loadData(req.query)) });

exports.create = async (req, res) => {
  let league;
  try {
    const season = await Season.findByPk(req.body.SeasonId);
    league = await League.findByPk(req.body.LeagueId);
    if (!season || !league || season.scopeSlug !== league.slug || season.leagueType !== disciplineFor(league)) throw new Error('Saison und Liga passen nicht zusammen.');
    const date = String(req.body.date || '');
    const time = timeFromLeague(league);
    const startsAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startsAt.getTime())) throw new Error('Datum oder Startzeit ist ungültig.');
    const track = await F1Track.findByPk(req.body.F1TrackId, { include: [{ association: 'countryRecord' }] });
    if (!track) throw new Error('Bitte eine Strecke aus dem Formel-1-Streckenstamm auswählen.');
    const circuit = track.name;
    const title = `Großer Preis von ${track.countryRecord?.name || track.country}`;
    const sortOrder = Number(req.body.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 1) throw new Error('Die Rennen-Nummer muss größer als 0 sein.');
    const duplicateRound = await RaceEvent.findOne({ where: { LeagueId: league.id, SeasonId: season.id, sortOrder } });
    if (duplicateRound) throw new Error(`Rennen Nr. ${sortOrder} ist in dieser Saison bereits belegt.`);
    const { main } = await seasonProgress.createManualRace(season.leagueType, {
      ...req.body, sortOrder, title, circuit, raceDate: date, pointsMode: 'database', hasSprint: req.body.hasSprint
    });
    await RaceEvent.create({
      LeagueId: league.id, SeasonId: season.id, GrandPrixResultId: main.id,
      title: main.title, circuit: main.circuit, startsAt,
      F1TrackId: track.id, durationMinutes: null, isPublished: season.status === 'active' && season.isPublished,
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
    const time = timeFromLeague(event.league);
    const startsAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startsAt.getTime())) throw new Error('Datum oder Startzeit ist ungültig.');
    const sortOrder = Number(req.body.sortOrder || event.sortOrder || 0);
    if (!Number.isInteger(sortOrder) || sortOrder < 1) throw new Error('Die Rennen-Nummer muss größer als 0 sein.');
    const track = await F1Track.findByPk(req.body.F1TrackId, { include: [{ association: 'countryRecord' }] });
    if (!track) throw new Error('Bitte eine Strecke aus dem Formel-1-Streckenstamm auswählen.');
    const duplicateRound = await RaceEvent.findOne({ where: { id: { [Op.ne]: event.id }, LeagueId: event.LeagueId, SeasonId: event.SeasonId, sortOrder } });
    if (duplicateRound) throw new Error(`Rennen Nr. ${sortOrder} ist bereits belegt.`);
    const nextTitle = `Großer Preis von ${track.countryRecord?.name || track.country}`;
    const nextCircuit = track.name;
    const changed = new Date(event.startsAt).getTime() !== startsAt.getTime() || Number(event.sortOrder) !== sortOrder || Number(event.F1TrackId) !== Number(track.id);
    await event.update({
      title: nextTitle, circuit: nextCircuit, F1TrackId: track.id, startsAt, sortOrder,
      isTestDay: req.body.isTestDay === 'on', durationMinutes: null,
      isPublished: event.seasonRecord?.status === 'active' && event.seasonRecord?.isPublished,
      previousStartsAt: changed ? event.startsAt : event.previousStartsAt,
      previousSortOrder: changed ? event.sortOrder : event.previousSortOrder,
      calendarChanged: changed || event.calendarChanged
    });
    if (event.grandPrixResult) {
      const main = event.grandPrixResult;
      const oldCircuit = main.circuit;
      const oldSortOrder = main.sortOrder;
      await seasonProgress.updateRaceSettings(main.discipline, main.id, { pointsMode: main.pointsMode, hasSprint: req.body.hasSprint });
      const sprint = await GrandPrixResult.findOne({
        where: { SeasonId: main.SeasonId, LeagueId: main.LeagueId, circuit: oldCircuit, sortOrder: oldSortOrder, raceType: 'sprint' }
      });
      await main.update({ title: nextTitle, circuit: nextCircuit, raceDate: date, sortOrder });
      if (sprint) await sprint.update({ title: `Sprint · ${nextCircuit}`, circuit: nextCircuit, raceDate: date, sortOrder });
    }
    req.session.flash = { type: 'success', message: `${nextTitle} wurde aktualisiert.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(redirectTo(event.LeagueId, event.SeasonId));
};

exports.reorder = async (req, res) => {
  const ids = [...new Set([].concat(req.body.eventIds || []).map(Number).filter(Number.isInteger))];
  const season = await Season.findByPk(Number(req.body.SeasonId));
  const league = await League.findByPk(Number(req.body.LeagueId));
  if (!season || !league || !ids.length) throw new Error('Liga, Saison und Kalenderreihenfolge sind erforderlich.');
  const events = await RaceEvent.findAll({ where: { id: { [Op.in]: ids }, SeasonId: season.id, LeagueId: league.id } });
  if (events.length !== ids.length) throw new Error('Die Kalenderreihenfolge enthält ungültige Termine.');
  await Promise.all(ids.map(async (id, index) => {
    const event = events.find((entry) => entry.id === id);
    const nextOrder = index + 1;
    await event.update({ previousSortOrder: event.sortOrder, sortOrder: nextOrder, calendarChanged: event.calendarChanged || Number(event.sortOrder) !== nextOrder });
    await GrandPrixResult.update({ sortOrder: nextOrder }, { where: { SeasonId: season.id, LeagueId: league.id, circuit: event.circuit } });
  }));
  req.session.flash = { type: 'success', message: 'Rennkalender wurde grafisch neu sortiert.' };
  res.redirect(redirectTo(league.id, season.id));
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
