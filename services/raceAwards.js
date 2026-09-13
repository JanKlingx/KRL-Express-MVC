function submittedRaceAwards(race, submitted, prefix = '') {
  const main = !prefix && race.raceType !== 'sprint';
  return {
    fastestLap: main && race.pointsMode === 'database' && submitted.fastestLap === 'on',
    polePosition: main && submitted.polePosition === 'on',
    driverOfTheDay: main && submitted.driverOfTheDay === 'on'
  };
}
module.exports = { submittedRaceAwards };
