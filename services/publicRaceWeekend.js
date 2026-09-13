const plain = (value) => value?.toJSON ? value.toJSON() : value;
const key = (value) => String(value || '').trim().toLocaleLowerCase('de-DE');
function calendarEventForRace(raceValue, events, races = []) {
  const race = plain(raceValue);
  const candidates = races.map(plain).filter((row) => row.raceType === 'main' && Number(row.sortOrder) === Number(race.sortOrder) && row.SeasonId === race.SeasonId);
  const main = race.raceType === 'sprint'
    ? candidates.find((row) => !isTestDayResult(row, events)) || candidates[0]
    : race;
  const rows = events.map(plain);
  const linked = rows.filter((event) => main?.id && Number(event.GrandPrixResultId) === Number(main.id));
  if (linked.length) return linked.find((event) => !event.isTestDay) || linked[0];
  if (race.isTestDay || /^testtag\b/i.test(race.title || '')) {
    return rows.find((event) => event.isTestDay && key(event.circuit) === key(race.circuit)) || { isTestDay: true };
  }
  const regular = rows.filter((event) => !event.isTestDay);
  return regular.find((event) => Number(event.sortOrder) === Number(race.sortOrder) && key(event.circuit) === key(race.circuit))
    || regular.find((event) => Number(event.sortOrder) === Number(race.sortOrder))
    || regular.find((event) => key(race.circuit) && key(event.circuit) === key(race.circuit)) || null;
}
function isTestDayResult(race, events, races = []) {
  return Boolean(plain(race).isTestDay || calendarEventForRace(race, events, races)?.isTestDay);
}
const statusLabels = {
  angefragt: 'Angefragt', abgemeldet: 'Abgemeldet', unsicher: 'Unsicher', anwesend: 'Anwesend',
  auf_abruf: 'Auf Abruf', rennsperre: 'Rennsperre', unabgemeldet: 'Unabgemeldet',
  zu_spaet_abgemeldet: 'Zu spät abgemeldet', zu_spaet_vorbesprechung: 'Zu spät Vorbesprechung',
  rueckmeldung_unsicher: 'Nicht dabei · zurückgemeldet', fehlende_rueckmeldung_unsicher: 'Nicht dabei · keine Rückmeldung',
  offen: 'Noch nicht bestätigt'
};
function publicDriver(entry) {
  const driver = plain(entry.driver) || {};
  const rawStatus = entry.attendanceStatus || entry.status || 'offen';
  const status = ({ rueckmeldung_unsicher: 'abgemeldet', fehlende_rueckmeldung_unsicher: 'unabgemeldet' })[rawStatus] || rawStatus;
  return { id: Number(entry.DriverId || driver.id), name: driver.name || 'Fahrer',
    status: statusLabels[status] ? status : 'offen', statusLabel: statusLabels[status] || statusLabels.offen,
    confirmed: Boolean(entry.includeInResults), replacementFor: Number(entry.ReplacementForDriverId) || null };
}
function berlinDay(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function buildPublicWeekends({ races = [], entries = [], teams = [], stints = [], calendar = [], now = new Date() }) {
  const rows = entries.map(plain), allTeams = teams.map(plain), periods = stints.map(plain);
  const snapshots = races.map(plain).filter((race) => race.raceType === 'main' && !isTestDayResult(race, calendar, races))
    .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)).map((race) => {
      const event = calendarEventForRace(race, calendar, races);
      const saved = rows.filter((entry) => Number(entry.GrandPrixResultId) === Number(race.id));
      const activePeriods = periods.filter((stint) => stint.roleType === 'regular' && Number(stint.fromRound) <= Number(race.sortOrder) && (stint.toRound == null || Number(stint.toRound) >= Number(race.sortOrder)));
      const planned = activePeriods.map((stint) => ({ DriverId: stint.DriverId, driver: stint.driver, SeasonTeamId: stint.SeasonTeamId, roleType: 'regular' }));
      const regulars = saved.some((entry) => entry.roleType === 'regular') ? saved.filter((entry) => entry.roleType === 'regular')
        : periods.length ? planned : allTeams.flatMap((team) => (team.drivers || []).map((driver) => ({ DriverId: driver.id, driver, SeasonTeamId: team.id, roleType: 'regular' })));
      const reserves = saved.filter((entry) => entry.roleType === 'reserve');
      const groups = allTeams.map((team) => ({ id: team.id, sourceType: team.sourceType, sourceId: team.sourceId, name: team.name, logoPath: team.logoPath, regulars: [], reserves: [] }));
      function groupFor(entry) {
        let group = groups.find((team) => entry.SeasonTeamId && Number(team.id) === Number(entry.SeasonTeamId));
        group ||= groups.find((team) => entry.TeamId && (team.sourceType === 'current' ? Number(team.sourceId) === Number(entry.TeamId) : !team.sourceType && Number(team.id) === Number(entry.TeamId)));
        group ||= groups.find((team) => entry.team?.name && key(team.name) === key(entry.team.name));
        if (!group) {
          const team = plain(entry.team) || {};
          const id = entry.TeamId ? 'base-' + entry.TeamId : 'unassigned';
          group = groups.find((row) => row.id === id);
          if (!group) { group = { id, name: team.name || 'Ohne Teamzuordnung', logoPath: team.logoPath, regulars: [], reserves: [] }; groups.push(group); }
        }
        return group;
      }
      regulars.forEach((entry) => {
        const period = activePeriods.find((stint) => Number(stint.DriverId) === Number(entry.DriverId));
        groupFor({ ...entry, SeasonTeamId: entry.SeasonTeamId || period?.SeasonTeamId }).regulars.push(publicDriver(entry));
      });
      reserves.forEach((entry) => {
        let root = entry; const seen = new Set();
        while (root.ReplacementForDriverId && !seen.has(Number(root.DriverId))) {
          seen.add(Number(root.DriverId));
          const next = saved.find((candidate) => Number(candidate.DriverId) === Number(root.ReplacementForDriverId));
          if (!next) break;
          root = next;
        }
        if (root.roleType !== 'regular') return;
        const group = groups.find((team) => team.regulars.some((driver) => driver.id === Number(root.DriverId)));
        if (group) group.reserves.push({ ...publicDriver(entry), replacesName: root.driver?.name || 'Stammfahrer' });
      });
      const track = plain(event?.track);
      return { id: race.id, round: Number(race.sortOrder), title: track?.countryRecord?.name || track?.country || race.title,
        date: event?.startsAt || race.raceDate || null, saved: saved.length > 0, teams: groups, reserves: reserves.map(publicDriver) };
    });
  const today = berlinDay(now);
  let currentIndex = snapshots.findIndex((snapshot) => berlinDay(snapshot.date) >= today);
  if (currentIndex < 0) currentIndex = Math.max(0, snapshots.length - 1);
  return { snapshots, currentIndex };
}
module.exports = { calendarEventForRace, isTestDayResult, buildPublicWeekends, statusLabels };
