const { summarizeDriverEntries } = require('./driverStats');
const { descendantIds } = require('./f1Teams');

function summarizeSeasons(entries) {
  const seasons = new Map();
  for (const entry of entries) {
    const race = entry.grandPrixResult;
    const key = `f1:${race.LeagueId || 0}:${race.SeasonId || race.season || ''}`;
    if (!seasons.has(key)) seasons.set(key, { key, discipline: 'f1', league: race.league?.name || 'Formel 1', season: race.seasonRecord?.name || race.season || 'Ohne Saison', entries: [] });
    seasons.get(key).entries.push(entry);
  }
  return [...seasons.values()].map(({ entries: rows, ...season }) => ({ ...season, ...summarizeDriverEntries(rows).f1 }));
}

function buildTeamCareerStatistics(teams, entries) {
  const byId = new Map(teams.map(team => [Number(team.id), team]));
  const byName = new Map(teams.map(team => [team.name.trim().toLocaleLowerCase('de'), team]));
  const ownEntries = new Map(teams.map(team => [Number(team.id), []]));
  const seen = new Set();
  for (const entry of entries) {
    const race = entry.grandPrixResult;
    if (!race || race.discipline !== 'f1' || race.isTestDay || race.calendarEvent?.isTestDay || /^testtag\b/i.test(race.title || '')) continue;
    // Unpublished seasons are not public statistics. Legacy results without a season record remain supported.
    if (race.seasonRecord?.isPublished === false || (race.SeasonId && !race.seasonRecord)) continue;
    if (entry.id != null && seen.has(Number(entry.id))) continue;
    if (entry.id != null) seen.add(Number(entry.id));
    const team = entry.TeamId ? byId.get(Number(entry.TeamId)) : byName.get(String(entry.teamName || '').trim().toLocaleLowerCase('de'));
    if (team) ownEntries.get(Number(team.id)).push(entry);
  }
  return teams.map(team => {
    const ids = descendantIds(teams, team.id);
    return {
      id: Number(team.id), name: team.name, logoPath: team.logoPath || null,
      includedTeamIds: ids.filter(id => id !== Number(team.id)),
      includedTeams: teams.filter(member => Number(member.id) !== Number(team.id) && ids.includes(Number(member.id))).map(member => member.name),
      seasons: summarizeSeasons(ownEntries.get(Number(team.id))),
      aggregatedSeasons: summarizeSeasons(ids.flatMap(id => ownEntries.get(id) || [])),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
module.exports = { buildTeamCareerStatistics };
