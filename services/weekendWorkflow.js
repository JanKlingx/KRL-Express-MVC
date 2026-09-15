function weekendProgress(entries = []) {
  const regulars = entries.filter((entry) => entry.roleType === 'regular');
  const relevant = entries.filter((entry) => entry.roleType === 'regular' || entry.ReplacementForDriverId || entry.vacantSeat);
  const lineupComplete = regulars.length > 0 || entries.some(entry => entry.vacantSeat);
  const attendanceComplete = lineupComplete && relevant.every((entry) => {
    if (entry.roleType === 'regular' && entry.status === 'rennsperre') return !entry.includeInResults;
    if (!['anwesend', 'zu_spaet_vorbesprechung', 'abgemeldet', 'unabgemeldet', 'zu_spaet_abgemeldet', 'rueckmeldung_unsicher', 'fehlende_rueckmeldung_unsicher'].includes(entry.attendanceStatus)) return false;
    if (!entry.vacantSeat && entry.status === 'unsicher' && (entry.uncertainPresent == null || entry.respondedInTime == null)) return false;
    const starts = ['anwesend', 'zu_spaet_vorbesprechung'].includes(entry.attendanceStatus);
    return starts === Boolean(entry.includeInResults);
  });
  const occupied = new Set();
  const validSeats = entries.filter((entry) => entry.includeInResults).every((entry) => {
    if (entry.vacantSeat) {
      if (entry.roleType !== 'reserve' || entry.ReplacementForDriverId || !entry.TeamId || (!entry.SeasonTeamId && !entry.vacantSeat.startsWith(`team-${entry.TeamId}:`)) || occupied.has(entry.vacantSeat)) return false;
      occupied.add(entry.vacantSeat); return true;
    }
    const seat = Number(entry.ReplacementForDriverId || entry.DriverId);
    const root = regulars.find((row) => Number(row.DriverId) === seat);
    if (!root || root.status === 'rennsperre' || occupied.has(seat)) return false;
    occupied.add(seat); return true;
  });
  return { lineupComplete, attendanceComplete: attendanceComplete && validSeats, validSeats };
}
async function resetWeekendStep(race, step, transaction) {
  const { Op } = require('sequelize');
  const { GrandPrixResult, GrandPrixResultEntry, F1RaceLineupEntry } = require('../models');
  if (![1, 2, 3].includes(step)) throw new Error('Ungültiger Schritt.');
  const races = await GrandPrixResult.findAll({ where: {
    SeasonId: race.SeasonId, LeagueId: race.LeagueId, sortOrder: race.sortOrder,
    discipline: 'f1', raceType: 'sprint'
  }, transaction });
  await GrandPrixResultEntry.destroy({ where: { GrandPrixResultId: { [Op.in]: [...new Set([race.id, ...races.map((row) => row.id)])] } }, transaction });
  if (step === 1) {
    await F1RaceLineupEntry.destroy({ where: { GrandPrixResultId: race.id }, transaction });
  } else if (step === 2) {
    await F1RaceLineupEntry.update({ attendanceStatus: null, includeInResults: false, uncertainPresent: null, respondedInTime: null }, {
      where: { GrandPrixResultId: race.id }, transaction
    });
  }
}
function lineupFingerprint(entries) {
  return JSON.stringify(entries.map((entry) => [Number(entry.DriverId), entry.roleType, entry.status, Number(entry.TeamId) || null, Number(entry.ReplacementForDriverId) || null, entry.attendanceStatus ?? null, Boolean(entry.includeInResults), entry.uncertainPresent ?? null, entry.respondedInTime ?? null, entry.vacantSeat || null, entry.SeasonTeamId || null]).sort((a, b) => a[0] - b[0]));
}
async function lockLineup(race, entries, transaction) {
  const { GrandPrixResult, F1RaceLineupEntry } = require('../models');
  await GrandPrixResult.findByPk(race.id, { transaction, lock: transaction.LOCK.UPDATE });
  const current = await F1RaceLineupEntry.findAll({ where: { GrandPrixResultId: race.id }, transaction, lock: transaction.LOCK.UPDATE });
  if (lineupFingerprint(current) !== lineupFingerprint(entries)) throw new Error('Das Rennwochenende wurde zwischenzeitlich geändert. Bitte neu laden.');
}
module.exports = { weekendProgress, resetWeekendStep, lineupFingerprint, lockLineup };
