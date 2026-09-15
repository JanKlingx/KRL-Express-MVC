const { summarizeDriverEntries } = require('./driverStats');

// Only expose sporting data, never the driver master record itself.
function buildCareerStatistics(drivers, entries) {
  const byDriver = new Map(drivers.map(driver => [Number(driver.id), { id: Number(driver.id), name: driver.name, seasons: [] }]));
  const grouped = new Map();
  for (const entry of entries) {
    const race = entry.grandPrixResult;
    if (!race || !byDriver.has(Number(entry.DriverId)) || race.discipline !== 'f1') continue;
    if (race.isTestDay || race.calendarEvent?.isTestDay || /^testtag\b/i.test(race.title || '')) continue;
    const seasonKey = `${race.discipline}:${race.LeagueId || 0}:${race.SeasonId || race.season}`;
    const key = `${entry.DriverId}:${seasonKey}`;
    if (!grouped.has(key)) grouped.set(key, { driverId: Number(entry.DriverId), key: seasonKey, discipline: race.discipline,
      league: race.league?.name || (race.discipline === 'f1' ? 'Formel 1' : 'LMU'),
      season: race.seasonRecord?.name || race.season || 'Ohne Saison', entries: [] });
    grouped.get(key).entries.push(entry);
  }
  for (const group of grouped.values()) {
    const { entries: rows, driverId, ...season } = group;
    byDriver.get(driverId).seasons.push({ ...season, ...summarizeDriverEntries(rows)[group.discipline] });
  }
  return [...byDriver.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
module.exports = { buildCareerStatistics };
