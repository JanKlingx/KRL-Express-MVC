const { Op } = require('sequelize');
const {
  sequelize,
  Driver,
  F1CalendarRound,
  GrandPrixResult,
  GrandPrixResultEntry,
  League,
  ParticipatingLeague,
  PointsRule,
  RaceEvent,
  Season,
  WdlResultEntry
} = require('../models');

async function pointsForPosition(position) {
  const numericPosition = Number(position);
  if (!Number.isInteger(numericPosition) || numericPosition < 1) return 0;
  const rule = await PointsRule.findOne({ where: { position: numericPosition } });
  return rule ? Number(rule.points) : 0;
}

async function activateSeason(season) {
  if (season.status === 'active') {
    await Season.update({ status: 'historical' }, {
      where: { id: { [Op.ne]: season.id }, leagueType: season.leagueType, scopeSlug: season.scopeSlug, status: 'active' }
    });
    const leagueType = season.leagueType === 'wdl' ? 'competition' : season.leagueType;
    const league = await League.findOne({ where: { slug: season.scopeSlug, type: leagueType } });
    if (league) await league.update({ currentSeason: season.name });
  }
  const relatedSeasons = await Season.findAll({ where: { leagueType: season.leagueType, scopeSlug: season.scopeSlug } });
  for (const related of relatedSeasons) {
    const active = related.status === 'active';
    await GrandPrixResult.update({ isHistorical: !active }, { where: { SeasonId: related.id } });
    await RaceEvent.update({ isPublished: active }, { where: { SeasonId: related.id } });
  }
  if (season.status === 'active' && season.leagueType === 'f1' && season.calendarMode === 'automatic') {
    const rounds = await F1CalendarRound.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
    for (const round of rounds) await syncF1CalendarRound(round);
  }
}

async function assignPointsToRace(raceId, transaction) {
  const entries = await GrandPrixResultEntry.findAll({ where: { GrandPrixResultId: raceId }, transaction });
  for (const entry of entries) {
    await entry.update({ points: await pointsForPosition(entry.position) }, { transaction });
  }
}

async function assignWdlPoints(entry, transaction) {
  const pointsOne = await pointsForPosition(entry.positionOne);
  const pointsTwo = await pointsForPosition(entry.positionTwo);
  await entry.update({ pointsOne, pointsTwo, totalPoints: pointsOne + pointsTwo }, { transaction });
}

async function recalculateDriverRaceCounts() {
  const drivers = await Driver.findAll({ attributes: ['id'] });
  const entries = await GrandPrixResultEntry.findAll({
    where: { DriverId: { [Op.ne]: null } },
    include: [{
      model: GrandPrixResult,
      as: 'grandPrixResult',
      include: [{ model: Season, as: 'seasonRecord', required: false }]
    }]
  });
  const counts = new Map(drivers.map((driver) => [driver.id, { f1: new Set(), lmu: new Set() }]));
  for (const entry of entries) {
    const race = entry.grandPrixResult;
    if (!race || race.isHistorical || race.seasonRecord?.status === 'historical') continue;
    const status = String(entry.status || '').toUpperCase();
    if (!entry.position && !['DNF', 'DSQ'].includes(status)) continue;
    const discipline = race.discipline === 'lmu' ? 'lmu' : race.discipline === 'f1' ? 'f1' : null;
    if (discipline && counts.has(entry.DriverId)) counts.get(entry.DriverId)[discipline].add(race.id);
  }
  await sequelize.transaction(async (transaction) => {
    for (const [driverId, values] of counts) {
      await Driver.update({ racesF1: values.f1.size, racesLmu: values.lmu.size }, { where: { id: driverId }, transaction });
    }
  });
}

async function recalculateAllPoints() {
  const [entries, wdlEntries] = await Promise.all([GrandPrixResultEntry.findAll(), WdlResultEntry.findAll()]);
  await sequelize.transaction(async (transaction) => {
    for (const entry of entries) await entry.update({ points: await pointsForPosition(entry.position) }, { transaction });
    for (const entry of wdlEntries) await assignWdlPoints(entry, transaction);
  });
}

function roleForLeague(league) {
  return league.slug === 'freitag' ? 'roleF1Friday' : 'roleF1Sunday';
}

function combineDateAndTime(date, time, fallback = '20:00') {
  if (!date) return null;
  const normalized = /^\d{2}:\d{2}$/.test(String(time || '')) ? time : fallback;
  return new Date(`${date}T${normalized}:00`);
}

async function syncF1CalendarRound(round) {
  const leagues = await League.findAll({ where: { slug: { [Op.in]: ['freitag', 'sonntag'] }, type: 'f1' } });
  for (const league of leagues) {
    const season = await Season.findOne({ where: { leagueType: 'f1', scopeSlug: league.slug, status: 'active' } });
    if (!season) continue;
    const isFriday = league.slug === 'freitag';
    const date = isFriday ? round.fridayDate : round.sundayDate;
    if (!date) continue;
    const time = isFriday ? round.fridayTime : round.sundayTime;
    const startsAt = combineDateAndTime(date, time, league.raceTime?.match(/\d{2}:\d{2}/)?.[0]);
    const [race] = await GrandPrixResult.findOrCreate({
      where: { SeasonId: season.id, LeagueId: league.id, circuit: round.circuit },
      defaults: {
        SeasonId: season.id,
        LeagueId: league.id,
        season: season.name,
        title: `Großer Preis von ${round.circuit}`,
        circuit: round.circuit,
        raceDate: date,
        discipline: 'f1',
        isHistorical: season.status === 'historical',
        sortOrder: round.sortOrder
      }
    });
    await race.update({ season: season.name, raceDate: date, sortOrder: round.sortOrder, isHistorical: season.status === 'historical' });
    const [event] = await RaceEvent.findOrCreate({
      where: { SeasonId: season.id, LeagueId: league.id, circuit: round.circuit },
      defaults: {
        SeasonId: season.id,
        LeagueId: league.id,
        GrandPrixResultId: race.id,
        title: race.title,
        circuit: round.circuit,
        startsAt,
        durationMinutes: 120,
        isPublished: season.status === 'active',
        sortOrder: round.sortOrder
      }
    });
    await event.update({ GrandPrixResultId: race.id, title: race.title, startsAt, isPublished: season.status === 'active', sortOrder: round.sortOrder });
  }
}

async function removeF1CalendarRound(round) {
  const events = await RaceEvent.findAll({ where: { circuit: round.circuit }, include: [{ model: Season, as: 'seasonRecord', where: { leagueType: 'f1', status: 'active' } }] });
  const raceIds = events.map((event) => event.GrandPrixResultId).filter(Boolean);
  await RaceEvent.destroy({ where: { id: { [Op.in]: events.map((event) => event.id) } } });
  if (raceIds.length) await GrandPrixResult.destroy({ where: { id: { [Op.in]: raceIds } } });
  await recalculateDriverRaceCounts();
}

async function removeSeriesCalendarEvent(event) {
  const raceId = event.GrandPrixResultId;
  if (raceId) await GrandPrixResult.destroy({ where: { id: raceId } });
  await recalculateDriverRaceCounts();
}

async function syncSeriesCalendarEvent(event) {
  const [season, league] = await Promise.all([Season.findByPk(event.SeasonId), League.findByPk(event.LeagueId)]);
  if (!season || !league) throw new Error('Rennkalender benötigt Saison und Liga.');
  const discipline = season.leagueType === 'wdl' ? 'wdl' : season.leagueType;
  const [race] = await GrandPrixResult.findOrCreate({
    where: { SeasonId: season.id, LeagueId: league.id, circuit: event.circuit || event.title },
    defaults: {
      SeasonId: season.id,
      LeagueId: league.id,
      season: season.name,
      title: event.title,
      circuit: event.circuit,
      raceDate: event.startsAt,
      discipline,
      isHistorical: season.status === 'historical',
      sortOrder: event.sortOrder
    }
  });
  await race.update({ title: event.title, raceDate: event.startsAt, discipline, isHistorical: season.status === 'historical', sortOrder: event.sortOrder });
  await event.update({ GrandPrixResultId: race.id, isPublished: season.status === 'active' });
  if (discipline === 'wdl') await ensureWdlEntries(race);
  if (discipline === 'lmu') await ensureLmuEntries(race);
}

function buildWdlStandings(races) {
  const standings = new Map();
  races.forEach((race) => (race.wdlEntries || []).forEach((entry) => {
    const league = entry.participatingLeague;
    if (!league) return;
    const row = standings.get(league.id) || { league, points: 0, wins: 0, results: [] };
    const points = Number(entry.totalPoints || 0);
    row.points += points;
    if (Number(entry.positionOne) === 1 || Number(entry.positionTwo) === 1) row.wins += 1;
    row.results.push({ race: race.title, points, positionOne: entry.positionOne, positionTwo: entry.positionTwo });
    standings.set(league.id, row);
  }));
  const ranked = [...standings.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.league.name.localeCompare(b.league.name, 'de'));
  ranked.forEach((row, index) => { row.position = index + 1; });
  return ranked;
}

async function ensureWdlEntries(race) {
  const season = await Season.findByPk(race.SeasonId);
  const where = season?.status === 'historical' ? {} : { isActive: true };
  const leagues = await ParticipatingLeague.findAll({ where, include: [{ association: 'f1Team' }], order: [['sortOrder', 'ASC'], ['id', 'ASC']], limit: season?.status === 'historical' ? undefined : 11 });
  for (const league of leagues) {
    await WdlResultEntry.findOrCreate({
      where: { GrandPrixResultId: race.id, ParticipatingLeagueId: league.id },
      defaults: { GrandPrixResultId: race.id, ParticipatingLeagueId: league.id, Driver1Id: league.f1Team?.Driver1Id || null, Driver2Id: league.f1Team?.Driver2Id || null, sortOrder: league.sortOrder }
    });
  }
}

async function ensureLmuEntries(race) {
  const season = await Season.findByPk(race.SeasonId);
  if (!season || season.status === 'historical') return;
  const drivers = await Driver.findAll({ where: { roleLmuRegular: true }, include: [{ association: 'team' }] });
  for (const driver of drivers) {
    await GrandPrixResultEntry.findOrCreate({
      where: { GrandPrixResultId: race.id, DriverId: driver.id },
      defaults: {
        GrandPrixResultId: race.id,
        DriverId: driver.id,
        driverName: driver.name,
        teamName: driver.team?.name || 'LMU-Team offen',
        points: 0,
        sortOrder: driver.sortOrder
      }
    });
  }
}

module.exports = {
  activateSeason,
  assignPointsToRace,
  assignWdlPoints,
  buildWdlStandings,
  ensureLmuEntries,
  ensureWdlEntries,
  pointsForPosition,
  recalculateAllPoints,
  recalculateDriverRaceCounts,
  removeF1CalendarRound,
  removeSeriesCalendarEvent,
  roleForLeague,
  syncF1CalendarRound,
  syncSeriesCalendarEvent
};
