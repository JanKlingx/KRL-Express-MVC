const { Op } = require('sequelize');
const { GrandPrixResult, SeasonDriverStint } = require('../models');

function rolloverIds(previousEntries, candidates, stints, round) {
  const eligible = new Set(candidates.map(driver => Number(driver.id)));
  return new Set(previousEntries.filter(entry => {
    if (entry.roleType !== 'reserve' || !eligible.has(Number(entry.DriverId))) return false;
    const periods = stints.filter(stint => Number(stint.DriverId) === Number(entry.DriverId));
    return !periods.length || periods.some(stint => Number(stint.fromRound) <= round && (stint.toRound == null || Number(stint.toRound) >= round));
  }).map(entry => Number(entry.DriverId)));
}
async function suggestedReserves(race, entries, candidates) {
  if (!race?.SeasonId || entries.length || Number(race.sortOrder) <= 1) return new Set();
  // The last saved plan is authoritative, including a plan with no reserves.
  const previous = await GrandPrixResult.findOne({
    where: { SeasonId: race.SeasonId, LeagueId: race.LeagueId, discipline: 'f1', raceType: 'main', sortOrder: { [Op.lt]: race.sortOrder } },
    include: [{ association: 'lineupEntries', required: true }],
    order: [['sortOrder', 'DESC'], ['id', 'DESC']]
  });
  if (!previous) return new Set();
  const stints = await SeasonDriverStint.findAll({ where: { SeasonId: race.SeasonId, roleType: 'reserve' } });
  return rolloverIds(previous.lineupEntries, candidates, stints, Number(race.sortOrder));
}
module.exports = { suggestedReserves, rolloverIds };
