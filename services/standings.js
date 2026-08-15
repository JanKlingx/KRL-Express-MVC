function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function plain(value) {
  return value && typeof value.toJSON === 'function' ? value.toJSON() : value;
}

function raceCode(race, index) {
  const words = String(race.title || race.circuit || '')
    .replace(/gro(?:ss|ß)er preis (?:von|der)/i, '')
    .match(/[A-Za-zÄÖÜäöü]+/g) || [];
  const source = words.at(-1) || `R${index + 1}`;
  return source.slice(0, 3).toUpperCase();
}

function buildSeasonData(leagueValue, resultValues, driverValues = []) {
  const league = plain(leagueValue);
  const races = resultValues.map(plain).sort((left, right) =>
    number(left.sortOrder) - number(right.sortOrder) || String(left.raceDate || '').localeCompare(String(right.raceDate || ''))
  );
  const drivers = new Map();

  driverValues.map(plain).forEach((driver) => {
    drivers.set(driver.name, {
      name: driver.name,
      team: plain(driver.team)?.name || 'Privatteam',
      results: [],
      total: 0,
      wins: 0
    });
  });

  races.forEach((race) => {
    (race.entries || []).map(plain).forEach((entry) => {
      if (!drivers.has(entry.driverName)) {
        drivers.set(entry.driverName, {
          name: entry.driverName,
          team: entry.teamName || 'Privatteam',
          results: [],
          total: 0,
          wins: 0
        });
      }
    });
  });

  for (const driver of drivers.values()) {
    let cumulative = 0;
    driver.results = races.map((race) => {
      const entry = (race.entries || []).map(plain).find((candidate) => candidate.driverName === driver.name);
      if (!entry) return { value: '–', points: 0, cumulative, status: null, position: null, fastestLap: false };
      const points = number(entry.points);
      const position = number(entry.position) || null;
      const status = String(entry.status || '').trim().toUpperCase() || null;
      cumulative += points;
      driver.total += points;
      if (position === 1) driver.wins += 1;
      if (entry.teamName) driver.team = entry.teamName;
      return {
        value: status || (position ? `P${position}` : '–'),
        points,
        cumulative,
        status,
        position,
        fastestLap: Boolean(entry.fastestLap)
      };
    });
  }

  const rankedDrivers = [...drivers.values()].sort((left, right) =>
    right.total - left.total || right.wins - left.wins || left.name.localeCompare(right.name, 'de')
  );
  const leaderPoints = rankedDrivers[0]?.total || 0;
  rankedDrivers.forEach((driver, index) => {
    driver.position = index + 1;
    driver.gap = driver.total - leaderPoints;
    driver.average = races.length ? driver.total / races.length : 0;
  });

  const teamMap = new Map();
  races.forEach((race) => {
    (race.entries || []).map(plain).forEach((entry) => {
      const teamName = entry.teamName || 'Privatteam';
      const team = teamMap.get(teamName) || { name: teamName, points: 0, wins: 0 };
      team.points += number(entry.points);
      if (number(entry.position) === 1) team.wins += 1;
      teamMap.set(teamName, team);
    });
  });
  const rankedTeams = [...teamMap.values()].sort((left, right) =>
    right.points - left.points || right.wins - left.wins || left.name.localeCompare(right.name, 'de')
  );
  const leaderTeamPoints = rankedTeams[0]?.points || 0;
  rankedTeams.forEach((team, index) => {
    team.position = index + 1;
    team.gap = index === 0 ? 'Leader' : `+${leaderTeamPoints - team.points}`;
  });

  const season = {
    name: league.currentSeason,
    races: races.map((race, index) => ({ round: race.sortOrder || index + 1, code: raceCode(race, index), title: race.title })),
    drivers: rankedDrivers
  };

  return {
    history: { seasons: races.length ? [season] : [], sourceLabel: races.length ? 'Admin-Saisonverlauf' : null, warning: null },
    selectedHistory: races.length ? season : null,
    driverStandings: rankedDrivers.map((driver) => ({
      position: driver.position,
      points: driver.total,
      wins: driver.wins,
      gap: driver.position === 1 ? 'Leader' : `+${leaderPoints - driver.total}`,
      driver: { name: driver.name, team: { name: driver.team } }
    })),
    teamStandings: rankedTeams.map((team) => ({ ...team, team: { name: team.name } })),
    races
  };
}

module.exports = { buildSeasonData, raceCode };
