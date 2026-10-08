const m = require('../models');
const s = require('./lmuSeason');
const { createHash } = require('node:crypto');
const version = events => createHash('sha256').update(JSON.stringify(events.map(s.plain))).digest('hex');
async function eventsFor(seasonId, transaction) {
  return m.RaceEvent.findAll({ where: { SeasonId: seasonId }, order: [['sortOrder', 'ASC'], ['id', 'ASC']], transaction });
}
async function save(seasonId, body) {
  return m.sequelize.transaction(async transaction => {
    const season = await s.seasonById(seasonId, transaction, true);
    const league = await m.League.findOne({ where: { type: 'lmu', slug: season.scopeSlug }, transaction });
    const events = await eventsFor(season.id, transaction);
    if (version(events) !== body.version) throw new Error('Der Kalender wurde inzwischen geändert. Bitte neu laden.');
    const inputs = Object.values(body.rounds || {});
    const rounds = s.roundsFrom(body.rounds);
    if (inputs.length !== rounds.length) throw new Error('Bitte leere Termine entfernen oder ausfüllen.');
    const ids = inputs.map(row => Number(row.id) || null);
    const retained = ids.filter(Boolean);
    if (new Set(retained).size !== retained.length || retained.some(id => !events.some(e => e.id === id))) throw new Error('Ein Termin gehört nicht zu dieser Saison oder ist doppelt vorhanden.');
    const races = await m.GrandPrixResult.findAll({ where: { SeasonId: season.id, discipline: 'lmu' }, include: [{ association: 'entries' }, { association: 'lineupEntries' }], transaction });
    const stints = await m.SeasonDriverStint.findAll({ where: { SeasonId: season.id }, transaction });
    const protectedOrder = races.some(r => r.entries.length || r.lineupEntries.length) || stints.some(stint => stint.fromRound > 1 || stint.toRound != null);
    let round = 0;
    const proposed = rounds.map((row, index) => ({ ...row, id: ids[index], round: row.isTestDay ? null : ++round }));
    if (protectedOrder) {
      for (const event of events.filter(e => !e.isTestDay)) {
        const next = proposed.find(r => r.id === event.id);
        const race = races.find(r => r.id === event.GrandPrixResultId);
        if (!next || next.isTestDay || next.round !== Number(race?.sortOrder)) throw new Error('Nach Aufstellungen, Ergebnissen oder Fahrerwechseln bleiben bestehende Runden erhalten. Neue Rennen bitte am Ende ergänzen.');
      }
    }
    for (const event of events.filter(e => !retained.includes(e.id))) {
      if (event.GrandPrixResultId) {
        const raceId = event.GrandPrixResultId;
        await m.GrandPrixResultEntry.destroy({ where: { GrandPrixResultId: event.GrandPrixResultId }, transaction });
        await m.F1RaceLineupEntry.destroy({ where: { GrandPrixResultId: event.GrandPrixResultId }, transaction });
        await event.update({ GrandPrixResultId: null }, { transaction });
        await m.GrandPrixResult.destroy({ where: { id: raceId, SeasonId: season.id }, transaction });
      }
      await event.destroy({ transaction });
    }
    for (const row of proposed) {
      const event = events.find(e => e.id === row.id);
      let race = races.find(r => r.id === event?.GrandPrixResultId);
      if (row.isTestDay && race) {
        await event.update({ GrandPrixResultId: null }, { transaction });
        await race.destroy({ transaction }); race = null;
      }
      if (!row.isTestDay) {
        const values = { SeasonId: season.id, LeagueId: league.id, discipline: 'lmu', raceType: 'main', title: row.title, circuit: row.circuit, raceDate: require('./raceWeekend').berlinDate(new Date(row.startsAt)), season: season.name, sortOrder: row.round, isHistorical: season.status === 'historical' };
        if (race) await race.update(values, { transaction });
        else race = await m.GrandPrixResult.create({ ...values, pointsMode: 'database' }, { transaction });
      }
      const values = { SeasonId: season.id, LeagueId: league.id, GrandPrixResultId: race?.id || null, title: row.title, circuit: row.circuit, startsAt: row.startsAt, isTestDay: row.isTestDay, sortOrder: row.sortOrder, isPublished: season.status === 'active' && season.isPublished };
      if (event) await event.update(values, { transaction });
      else await m.RaceEvent.create(values, { transaction });
    }
  });
}
module.exports = { eventsFor, version, save };
