const { Op } = require('sequelize');
const { GrandPrixResult, GrandPrixResultEntry } = require('../models');

function emptyStats() {
  return { points: 0, starts: 0, wins: 0, podium1: 0, podium2: 0, podium3: 0, poles: 0, fastestLaps: 0, driverOfTheDays: 0, winRate: 0, classifiedFinishes: 0, positionSum: 0, mainRacePoints: 0, averagePosition: null, averagePoints: null };
}

async function getDriverStatistics(driverId) {
  const entries = await GrandPrixResultEntry.findAll({
    where: { DriverId: driverId },
    include: [{
      model: GrandPrixResult,
      as: 'grandPrixResult',
      required: true,
      include: [{ association: 'calendarEvent', required: false }],
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
    if (!stats || race.isTestDay || race.calendarEvent?.isTestDay || /^testtag\b/i.test(race.title || "")) continue;
    stats.points += Number(entry.points || 0);
    if (race.raceType === 'sprint') continue;
    if (entry.polePosition) stats.poles += 1;
    if (entry.fastestLap) stats.fastestLaps += 1;
    if (entry.driverOfTheDay) stats.driverOfTheDays += 1;
    const position = Number(entry.position || 0);
    const status = String(entry.status || '').toUpperCase();
    const started = !['DNS', 'DNA', 'S'].includes(status) && (position > 0 || ['DNF', 'DSQ'].includes(status) || race.isHistorical && !status);
    if (started) { stats.starts += 1; stats.mainRacePoints += Number(entry.points || 0); }
    if (position > 0 && !status) { stats.classifiedFinishes += 1; stats.positionSum += position; }
    if (position === 1 && !status) { stats.wins += 1; stats.podium1 += 1; }
    if (position === 2 && !status) stats.podium2 += 1;
    if (position === 3 && !status) stats.podium3 += 1;
  }
  for (const stats of Object.values(result)) {
    stats.averagePosition = stats.classifiedFinishes ? stats.positionSum / stats.classifiedFinishes : null;
    stats.averagePoints = stats.starts ? stats.mainRacePoints / stats.starts : null;
    stats.winRate = stats.starts ? Math.round((stats.wins / stats.starts) * 1000) / 10 : 0;
  }
  return result;
}

module.exports = { getDriverStatistics, summarizeDriverEntries };
