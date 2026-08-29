const { Op } = require('sequelize');
const {
  sequelize,
  Driver,
  GrandPrixResult,
  GrandPrixResultEntry,
  League,
  ParticipatingLeague,
  PointAllocation,
  PointsScheme,
  PointsRule,
  RaceEvent,
  Season,
  SeasonCategory,
  TeamRoster,
  WdlResultEntry
} = require('../models');
const { centralTeamDriverIds } = require('./teamRosters');
const { syncLinkedRaceEvents } = require('./f1Calendar');

function dateOnly(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

async function pointsForPosition(position, context = {}) {
  const numericPosition = Number(position);
  if (!Number.isInteger(numericPosition) || numericPosition < 1) return 0;
  const discipline = context.discipline || 'f1';
  const effectiveDate = dateOnly(context.raceDate);
  let selectedSchemeId = context.PointsSchemeId || null;
  if (!selectedSchemeId && context.SeasonId) {
    const season = await Season.findByPk(context.SeasonId, { attributes: ['PointsSchemeId'] });
    selectedSchemeId = season?.PointsSchemeId || null;
  }
  const scheme = selectedSchemeId
    ? await PointsScheme.findOne({ where: { id: selectedSchemeId, discipline } })
    : await PointsScheme.findOne({
      where: {
        discipline,
        [Op.and]: [
          { [Op.or]: [{ validFrom: null }, { validFrom: { [Op.lte]: effectiveDate } }] },
          { [Op.or]: [{ validUntil: null }, { validUntil: { [Op.gte]: effectiveDate } }] }
        ]
      },
      order: [['validFrom', 'DESC'], ['sortOrder', 'DESC'], ['id', 'DESC']]
    });
  if (scheme) {
    const allocation = await PointAllocation.findOne({
      where: { PointsSchemeId: scheme.id, raceType: context.raceType || 'main', position: numericPosition }
    });
    const fastestLapBonus = context.fastestLap && scheme.fastestLapEnabled ? Number(scheme.fastestLapPoints || 0) : 0;
    const polePositionBonus = context.polePosition && scheme.polePositionEnabled ? Number(scheme.polePositionPoints || 0) : 0;
    return Number(allocation?.points || 0) + fastestLapBonus + polePositionBonus;
  }
  const rule = await PointsRule.findOne({ where: { position: numericPosition } });
  return rule ? Number(rule.points) : 0;
}

async function activateSeason(season) {
  if (season.status === 'active') {
    const [currentCategory, historicalCategory] = await Promise.all([
      SeasonCategory.findOne({ where: { name: 'Aktuelle Saison', leagueType: season.leagueType, scopeSlug: season.scopeSlug } }),
      SeasonCategory.findOne({ where: { name: 'Ältere Saisons', leagueType: season.leagueType, scopeSlug: season.scopeSlug } })
    ]);
    const previouslyActive = await Season.findAll({
      where: { id: { [Op.ne]: season.id }, leagueType: season.leagueType, scopeSlug: season.scopeSlug, status: 'active' },
      attributes: ['id']
    });
    await Season.update({ status: 'historical' }, {
      where: { id: { [Op.ne]: season.id }, leagueType: season.leagueType, scopeSlug: season.scopeSlug, status: 'active' }
    });
    if (historicalCategory && previouslyActive.length) await Season.update({ SeasonCategoryId: historicalCategory.id }, {
      where: { id: { [Op.in]: previouslyActive.map((entry) => entry.id) } }
    });
    if (currentCategory && season.SeasonCategoryId !== currentCategory.id) await season.update({ SeasonCategoryId: currentCategory.id });
    const leagueType = season.leagueType === 'wdl' ? 'competition' : season.leagueType;
    const league = await League.findOne({ where: { slug: season.scopeSlug, type: leagueType } });
    if (league) await league.update({ currentSeason: season.name });
  }
  const relatedSeasons = await Season.findAll({ where: { leagueType: season.leagueType, scopeSlug: season.scopeSlug } });
  for (const related of relatedSeasons) {
    const active = related.status === 'active';
    await GrandPrixResult.update({ isHistorical: !active }, { where: { SeasonId: related.id } });
    await RaceEvent.update({ isPublished: active && related.isPublished !== false }, { where: { SeasonId: related.id } });
  }
}

async function assignPointsToRace(raceId, transaction) {
  const race = await GrandPrixResult.findByPk(raceId, { transaction });
  if (race?.pointsMode === 'manual') return;
  const entries = await GrandPrixResultEntry.findAll({ where: { GrandPrixResultId: raceId }, transaction });
  for (const entry of entries) {
    await entry.update({ points: await pointsForPosition(entry.position, { ...race?.toJSON(), fastestLap: entry.fastestLap, polePosition: entry.polePosition }) }, { transaction });
  }
}

async function assignWdlPoints(entry, transaction, raceValue) {
  const race = raceValue || await GrandPrixResult.findByPk(entry.GrandPrixResultId, { transaction });
  if (race?.pointsMode === 'manual') return;
  const context = race?.toJSON() || { discipline: 'wdl', raceType: 'main' };
  const pointsOne = await pointsForPosition(entry.positionOne, { ...context, fastestLap: entry.fastestLapOne });
  const pointsTwo = await pointsForPosition(entry.positionTwo, { ...context, fastestLap: entry.fastestLapTwo });
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
    if (race.pointsMode !== 'manual' && !entry.position && !['DNF', 'DSQ'].includes(status)) continue;
    const discipline = race.discipline === 'lmu' ? 'lmu' : race.discipline === 'f1' ? 'f1' : null;
    if (discipline && counts.has(entry.DriverId) && race.raceType !== 'sprint') counts.get(entry.DriverId)[discipline].add(race.id);
  }
  await sequelize.transaction(async (transaction) => {
    for (const [driverId, values] of counts) {
      await Driver.update({ racesF1: values.f1.size, racesLmu: values.lmu.size }, { where: { id: driverId }, transaction });
    }
  });
}

async function recalculateAllPoints() {
  const [entries, wdlEntries] = await Promise.all([
    GrandPrixResultEntry.findAll({ include: [{ model: GrandPrixResult, as: 'grandPrixResult' }] }),
    WdlResultEntry.findAll({ include: [{ association: 'race' }] })
  ]);
  await sequelize.transaction(async (transaction) => {
    for (const entry of entries) {
      const race = entry.grandPrixResult?.toJSON() || {};
      if (race.pointsMode === 'manual') continue;
      await entry.update({ points: await pointsForPosition(entry.position, { ...race, fastestLap: entry.fastestLap, polePosition: entry.polePosition }) }, { transaction });
    }
    for (const entry of wdlEntries) await assignWdlPoints(entry, transaction, entry.race);
  });
}

function roleForLeague(league) {
  return require('./raceLineup').regularRoleField(league.slug);
}

function combineDateAndTime(date, time, fallback = '20:00') {
  if (!date) return null;
  const normalized = /^\d{2}:\d{2}$/.test(String(time || '')) ? time : fallback;
  return new Date(`${date}T${normalized}:00`);
}

async function syncF1CalendarRound(round) {
  if (!round.F1CalendarId) return { updated: 0, skippedCompleted: 0 };
  return sequelize.transaction((transaction) => syncLinkedRaceEvents(round, transaction));
}

async function removeF1CalendarRound(round) {
  if (await RaceEvent.count({ where: { F1CalendarRoundId: round.id } })) {
    throw new Error('Eine verwendete zentrale Kalenderrunde kann nicht gelöscht werden.');
  }
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
    where: { SeasonId: season.id, LeagueId: league.id, circuit: event.circuit || event.title, raceType: 'main' },
    defaults: {
      SeasonId: season.id,
      LeagueId: league.id,
      season: season.name,
      title: event.title,
      circuit: event.circuit,
      raceDate: event.startsAt,
      discipline,
      raceType: 'main',
      isHistorical: season.status === 'historical',
      sortOrder: event.sortOrder
    }
  });
  await race.update({ title: event.title, raceDate: event.startsAt, discipline, raceType: 'main', isHistorical: season.status === 'historical', sortOrder: event.sortOrder });
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
    const driverIds = await centralTeamDriverIds(league.F1TeamId);
    await WdlResultEntry.findOrCreate({
      where: { GrandPrixResultId: race.id, ParticipatingLeagueId: league.id },
      defaults: { GrandPrixResultId: race.id, ParticipatingLeagueId: league.id, Driver1Id: driverIds[0] || null, Driver2Id: driverIds[1] || null, sortOrder: league.sortOrder }
    });
  }
}

async function ensureLmuEntries(race) {
  const season = await Season.findByPk(race.SeasonId);
  if (!season || season.status === 'historical') return;
  const rosters = await TeamRoster.findAll({
    where: { LeagueId: race.LeagueId, discipline: 'lmu' },
    include: [{ association: 'team' }, { association: 'assignments', where: { roleName: { [Op.ne]: 'Ersatzfahrer' } }, required: false, include: [{ association: 'driver' }] }]
  });
  for (const roster of rosters.filter((entry) => entry.assignments.length >= 3)) for (const assignment of roster.assignments) {
    const driver = assignment.driver;
    await GrandPrixResultEntry.findOrCreate({
      where: { GrandPrixResultId: race.id, DriverId: driver.id },
      defaults: {
        GrandPrixResultId: race.id,
        DriverId: driver.id,
        TeamId: roster.team.id,
        driverName: driver.name,
        teamName: roster.team.name,
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
