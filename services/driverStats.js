const { Op } = require('sequelize');
const { GrandPrixResult, GrandPrixResultEntry } = require('../models');

function emptyStats() {
  return { points: 0, starts: 0, wins: 0, podium1: 0, podium2: 0, podium3: 0, winRate: 0 };
}

async function getDriverStatistics(driverId) {
  const entries = await GrandPrixResultEntry.findAll({
    where: { DriverId: driverId },
    include: [{
      model: GrandPrixResult,
      as: 'grandPrixResult',
      required: true,
      where: { discipline: { [Op.in]: ['f1', 'lmu'] } }
    }]
  });
  return summarizeDriverEntries(entries);
}

function summarizeDriverEntries(entries) {
  const result = { f1: emptyStats(), lmu: emptyStats() };
  for (const entry of entries) {
    const race = entry.grandPrixResult;
    const stats = result[race.discipline];
    if (!stats) continue;
    stats.points += Number(entry.points || 0);
    if (race.raceType === 'sprint') continue;
    const position = Number(entry.position || 0);
    const status = String(entry.status || '').toUpperCase();
    if (position || ['DNF', 'DSQ'].includes(status)) stats.starts += 1;
    if (position === 1) { stats.wins += 1; stats.podium1 += 1; }
    if (position === 2) stats.podium2 += 1;
    if (position === 3) stats.podium3 += 1;
  }
  for (const stats of Object.values(result)) {
    stats.winRate = stats.starts ? Math.round((stats.wins / stats.starts) * 1000) / 10 : 0;
  }
  return result;
}

module.exports = { getDriverStatistics, summarizeDriverEntries };
