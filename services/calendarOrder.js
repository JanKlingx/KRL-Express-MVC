const { Op } = require('sequelize');
const { F1Calendar, F1CalendarRound, RaceEvent, GrandPrixResult, GrandPrixResultEntry } = require('../models');
const { syncCalendarSequence } = require('./f1Calendar');

async function lockCalendar(id, transaction) {
  const calendar = await F1Calendar.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!calendar) throw new Error('Der Kalender wurde nicht gefunden.');
  return F1CalendarRound.findAll({ where: { F1CalendarId: id }, order: [['sortOrder', 'ASC'], ['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
}

function orderedRounds(rounds, submittedIds) {
  const ids = [].concat(submittedIds || []).map(Number);
  if (ids.length !== rounds.length || new Set(ids).size !== rounds.length || rounds.some((round) => !ids.includes(Number(round.id)))) {
    throw new Error('Die Reihenfolge ist unvollständig oder veraltet. Bitte den Kalender neu laden.');
  }
  return ids.map((id) => rounds.find((round) => Number(round.id) === id));
}

async function protectCompleted(rounds, transaction) {
  if (!rounds.length) return;
  const events = await RaceEvent.findAll({ where: { F1CalendarRoundId: { [Op.in]: rounds.map((round) => round.id) } }, transaction });
  if (!events.length) return;
  const results = await GrandPrixResult.findAll({ where: { [Op.or]: events.map((event) => ({ SeasonId: event.SeasonId, LeagueId: event.LeagueId, sortOrder: event.sortOrder, discipline: 'f1' })) }, attributes: ['id'], transaction });
  const ids = [...new Set([...results.map((row) => row.id), ...events.map((event) => event.GrandPrixResultId).filter(Boolean)])];
  if (ids.length && await GrandPrixResultEntry.count({ where: { GrandPrixResultId: { [Op.in]: ids } }, transaction })) {
    throw new Error('Dieser Kalender enthält bereits gewertete Rennen. Deren Rennnummern bleiben geschützt; bitte für eine andere Reihenfolge einen neuen Kalender erstellen.');
  }
}

async function numberRounds(rounds, transaction) {
  // Clear all numbers before swapping them, then synchronize only after the complete order is stored.
  for (const round of rounds) await round.update({ roundNumber: null }, { transaction });
  let number = 0;
  for (const [index, round] of rounds.entries()) {
    await round.update({ sortOrder: index + 1, roundNumber: round.isTestDay ? null : ++number }, { transaction });
  }
  await syncCalendarSequence(rounds, transaction);
}
module.exports = { lockCalendar, orderedRounds, protectCompleted, numberRounds };
