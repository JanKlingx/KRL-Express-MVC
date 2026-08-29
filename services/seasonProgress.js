const { Op } = require('sequelize');
const {
  League, Season, RaceEvent, GrandPrixResult
} = require('../models');
const {
  activateSeason, ensureLmuEntries, ensureWdlEntries, recalculateDriverRaceCounts
} = require('./championship');

const disciplineConfig = {
  f1: { leagueType: 'f1', publicType: 'f1' },
  lmu: { leagueType: 'lmu', publicType: 'lmu' },
  wdl: { leagueType: 'wdl', publicType: 'competition' }
};

function normalizePointsMode(value) {
  return value === 'manual' ? 'manual' : 'database';
}

async function resolveLeague(discipline, leagueId) {
  const config = disciplineConfig[discipline];
  if (!config) return null;
  const where = { type: config.publicType };
  if (leagueId) where.id = Number(leagueId);
  return League.findOne({ where, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
}

async function createSeason(discipline, body) {
  const config = disciplineConfig[discipline];
  const league = await resolveLeague(discipline, body.LeagueId);
  const name = String(body.name || '').trim();
  if (!config || !league || !name) throw new Error('Liga und Saisonname sind erforderlich.');
  const status = body.status === 'active' ? 'active' : 'historical';
  const [season, created] = await Season.findOrCreate({
    where: { name, leagueType: config.leagueType, scopeSlug: league.slug },
    defaults: {
      name, leagueType: config.leagueType, scopeSlug: league.slug, status,
      calendarMode: 'manual', sortOrder: Number(body.sortOrder || 0)
    }
  });
  if (!created) await season.update({ status, calendarMode: 'manual' });
  await activateSeason(season);
  return { season, league };
}

async function nextRound(seasonId, leagueId) {
  const maximum = await GrandPrixResult.max('sortOrder', {
    where: { SeasonId: seasonId, LeagueId: leagueId, raceType: 'main' }
  });
  return Number(maximum || 0) + 1;
}

async function upsertRace({ season, league, discipline, title, circuit, raceDate, sortOrder, pointsMode, hasSprint }) {
  const cleanCircuit = String(circuit || title || '').trim();
  const cleanTitle = String(title || cleanCircuit || '').trim();
  if (!cleanTitle || !cleanCircuit) throw new Error('Rennen und Strecke sind erforderlich.');
  const round = Number(sortOrder || await nextRound(season.id, league.id));
  const shared = {
    SeasonId: season.id, LeagueId: league.id, season: season.name,
    circuit: cleanCircuit, raceDate: raceDate || null, discipline,
    isHistorical: season.status === 'historical', sortOrder: round,
    pointsMode: normalizePointsMode(pointsMode)
  };
  const [main] = await GrandPrixResult.findOrCreate({
    where: { SeasonId: season.id, LeagueId: league.id, circuit: cleanCircuit, raceType: 'main' },
    defaults: { ...shared, title: cleanTitle, raceType: 'main' }
  });
  await main.update({ ...shared, title: cleanTitle, raceType: 'main' });
  let sprint = await GrandPrixResult.findOne({
    where: { SeasonId: season.id, LeagueId: league.id, circuit: cleanCircuit, raceType: 'sprint' }
  });
  if (discipline === 'f1' && hasSprint) {
    if (!sprint) sprint = await GrandPrixResult.create({ ...shared, title: `Sprint · ${cleanCircuit}`, raceType: 'sprint' });
    else await sprint.update({ ...shared, title: `Sprint · ${cleanCircuit}`, raceType: 'sprint' });
  } else if (sprint) {
    await sprint.destroy();
    sprint = null;
  }
  if (discipline === 'lmu') await ensureLmuEntries(main);
  if (discipline === 'wdl') await ensureWdlEntries(main);
  return { main, sprint };
}

async function createManualRace(discipline, body) {
  const season = await Season.findByPk(body.SeasonId);
  const league = await resolveLeague(discipline, body.LeagueId);
  if (!season || !league || season.leagueType !== discipline || season.scopeSlug !== league.slug) {
    throw new Error('Die ausgewählte Saison passt nicht zur Liga.');
  }
  return upsertRace({
    season, league, discipline, title: body.title, circuit: body.circuit,
    raceDate: body.raceDate, sortOrder: body.sortOrder, pointsMode: body.pointsMode,
    hasSprint: body.hasSprint === 'on'
  });
}

async function updateRaceSettings(discipline, raceId, body) {
  const main = await GrandPrixResult.findByPk(raceId, { include: [{ association: 'seasonRecord' }, { association: 'league' }] });
  if (!main || main.discipline !== discipline || main.raceType !== 'main') throw new Error('Rennen wurde nicht gefunden.');
  return upsertRace({
    season: main.seasonRecord, league: main.league, discipline,
    title: main.title, circuit: main.circuit, raceDate: main.raceDate,
    sortOrder: main.sortOrder, pointsMode: body.pointsMode,
    hasSprint: body.hasSprint === 'on'
  });
}

async function importCalendar(discipline, body) {
  const season = await Season.findByPk(body.SeasonId);
  const league = await resolveLeague(discipline, body.LeagueId);
  if (!season || !league || season.leagueType !== discipline || season.scopeSlug !== league.slug) {
    throw new Error('Die ausgewählte Saison passt nicht zur Liga.');
  }
  let imported = 0;
  if (discipline === 'f1') {
    throw new Error('F1-Kalender werden im Saison-Assistenten aus einem zentralen F1Calendar übernommen.');
  } else {
    const activeSeason = await Season.findOne({
      where: { leagueType: discipline, scopeSlug: league.slug, status: 'active' }
    });
    const events = await RaceEvent.findAll({
      where: {
        LeagueId: league.id,
        [Op.or]: [{ SeasonId: null }, ...(activeSeason ? [{ SeasonId: activeSeason.id }] : [])]
      },
      order: [['sortOrder', 'ASC'], ['startsAt', 'ASC'], ['id', 'ASC']]
    });
    for (const event of events) {
      await upsertRace({
        season, league, discipline, title: event.title, circuit: event.circuit || event.title,
        raceDate: event.startsAt, sortOrder: event.sortOrder,
        pointsMode: body.pointsMode, hasSprint: false
      });
      imported += 1;
    }
  }
  if (!imported) throw new Error('Im Rennkalender wurden keine importierbaren Rennen gefunden.');
  return { season, league, imported };
}

async function removeRaceEvent(discipline, raceId) {
  const race = await GrandPrixResult.findByPk(raceId);
  if (!race || race.discipline !== discipline) throw new Error('Rennen wurde nicht gefunden.');
  await GrandPrixResult.destroy({
    where: {
      SeasonId: race.SeasonId, LeagueId: race.LeagueId,
      circuit: race.circuit, sortOrder: race.sortOrder,
      raceType: { [Op.in]: ['main', 'sprint'] }
    }
  });
  await recalculateDriverRaceCounts();
}

module.exports = {
  createManualRace,
  createSeason,
  importCalendar,
  normalizePointsMode,
  removeRaceEvent,
  updateRaceSettings
};
