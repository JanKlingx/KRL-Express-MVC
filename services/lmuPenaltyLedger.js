const m = require('../models');
const { plain, nextRound } = require('./lmuSeason');
const { isRoundInStint } = require('./seasonDriverStints');
const trackInclude = { association: 'lmuTrack', include: [{ association: 'countryRecord' }] };

async function loadStructure(seasonId) {
  const season = await m.Season.findByPk(seasonId);
  if (!season) return { teams: [] };
  if (!season.lmuManaged) {
    const league = await m.League.findOne({ where: { type: 'lmu', slug: season.scopeSlug } });
    const rosters = league ? await m.TeamRoster.findAll({ where: { LeagueId: league.id, discipline: 'lmu' }, include: [{ association: 'team' }, { association: 'assignments', include: [{ association: 'driver' }] }] }) : [];
    return { teams: rosters.filter(row => row.team).map(row => ({ ...plain(row.team), drivers: row.assignments.filter(a => a.driver && a.roleName !== 'Ersatzfahrer').map(a => plain(a.driver)) })) };
  }
  const [teams, stints, round] = await Promise.all([
    m.SeasonTeam.findAll({ where: { SeasonId: seasonId } }),
    m.SeasonDriverStint.findAll({ where: { SeasonId: seasonId, roleType: 'regular' }, include: [{ association: 'driver' }] }),
    nextRound(seasonId),
  ]);
  return { teams: teams.map(team => ({ ...plain(team), drivers: stints.filter(stint => stint.driver && stint.SeasonTeamId === team.id && isRoundInStint(stint, round)).map(stint => plain(stint.driver)) })) };
}
async function loadRounds(league, season) {
  if (!season) return [];
  const events = await m.RaceEvent.findAll({ where: { LeagueId: league.id, SeasonId: season.id, isTestDay: false }, include: [trackInclude, { association: 'grandPrixResult' }], order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  return events.map((event, index) => ({
    roundNumber: Number(event.grandPrixResult?.sortOrder || index + 1), eventId: event.id,
    title: event.title, circuit: event.lmuTrack?.name || event.circuit,
    startsAt: event.startsAt, countryCode: event.lmuTrack?.countryRecord?.abbreviation || null,
    flagPath: event.lmuTrack?.countryRecord?.flagPath || null,
    country: event.lmuTrack?.countryRecord?.name || event.lmuTrack?.country || null,
  }));
}
async function loadCalendars() {
  const [calendars, tracks] = await Promise.all([
    m.LmuCalendar.findAll({ order: [['isActive', 'DESC'], ['sortOrder', 'ASC'], ['id', 'DESC']] }),
    m.LmuTrack.findAll({ include: [{ association: 'countryRecord' }] }),
  ]);
  return calendars.map(calendar => ({ ...plain(calendar), rounds: [...(calendar.rounds || [])].sort((a, b) => a.sortOrder - b.sortOrder).map(round => ({ ...round, track: tracks.find(track => track.id === Number(round.LmuTrackId)) })) }));
}
async function findRaceEvent(leagueId, seasonId, roundNumber) {
  const rounds = await loadRounds({ id: leagueId }, { id: seasonId });
  return rounds.find(round => round.roundNumber === roundNumber) || null;
}
module.exports = { loadStructure, loadRounds, loadCalendars, findRaceEvent };
