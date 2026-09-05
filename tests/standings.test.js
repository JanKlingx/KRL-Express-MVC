const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSeasonData } = require('../services/standings');
const { createCsv } = require('../services/csv');
const { pointsForPosition } = require('../services/championship');
const { Season, PointsScheme, PointAllocation } = require('../models');

const league = { slug: 'freitag', currentSeason: 'Saison 12' };
const drivers = [
  { id: 1, name: 'Fahrer A', team: { name: 'Team Rot' } },
  { id: 2, name: 'Fahrer B', team: { name: 'Team Blau' } },
  { id: 3, name: 'Fahrer C', team: { name: 'Team Rot' } }
];
const races = [
  { title: 'Großer Preis von Bahrain', sortOrder: 1, entries: [
    { DriverId: 1, driverName: 'Fahrer A', teamName: 'Team Rot', position: 1, points: 25 },
    { DriverId: 2, driverName: 'Fahrer B', teamName: 'Team Blau', position: 2, points: 18 },
    { DriverId: 3, driverName: 'Fahrer C', teamName: 'Team Rot', position: 3, points: 15 }
  ] },
  { title: 'Großer Preis von Australien', sortOrder: 2, entries: [
    { DriverId: 2, driverName: 'Fahrer B', teamName: 'Team Blau', position: 1, points: 25 },
    { DriverId: 1, driverName: 'Fahrer A', teamName: 'Team Rot', position: null, status: 'DNF', points: 0 }
  ] }
];

test('Saisonverlauf erzeugt automatisch Fahrer- und Team-WM', () => {
  const data = buildSeasonData(league, races, drivers);
  assert.equal(data.driverStandings[0].driver.name, 'Fahrer B');
  assert.equal(data.driverStandings[0].points, 43);
  assert.equal(data.teamStandings[0].team.name, 'Team Blau');
  assert.equal(data.teamStandings[0].points, 43);
  assert.equal(data.selectedHistory.drivers.find((driver) => driver.name === 'Fahrer A').results[0].position, 1);
  assert.equal(data.selectedHistory.drivers.find((driver) => driver.name === 'Fahrer A').results[1].status, 'DNF');
});

test('CSV-Downloads sind Excel-kompatibel und maskieren Trennzeichen', () => {
  const csv = createCsv([['Fahrer', 'Team'], ['Fahrer A', 'Rot;Blau']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"Rot;Blau"/);
});

test('Fahrer-ID hält Wertungen trotz Namenswechsel und Alias zusammen', () => {
  const data = buildSeasonData(league, [{
    title: 'Test GP', sortOrder: 1, entries: [{ DriverId: 77, driverName: 'Alter Name', teamName: 'Team Rot', position: 1, points: 25 }]
  }], [{ id: 77, name: 'Neuer Name', team: { name: 'Team Rot' }, aliases: [{ alias: 'Alter Name' }] }]);
  assert.equal(data.driverStandings.length, 1);
  assert.equal(data.driverStandings[0].driver.name, 'Neuer Name');
  assert.equal(data.driverStandings[0].wins, 1);
  assert.equal(data.driverStandings[0].points, 25);
});

test('Sprintpunkte zählen zur WM, aber ein Sprintsieg nicht als Grand-Prix-Sieg', () => {
  const data = buildSeasonData(league, [
    { title: 'Sprint · Spa', raceType: 'sprint', sortOrder: 1, entries: [{ driverName: 'Fahrer A', teamName: 'Team Rot', position: 1, points: 8 }] },
    { title: 'Großer Preis von Spa', raceType: 'main', sortOrder: 1, entries: [{ driverName: 'Fahrer A', teamName: 'Team Rot', position: 2, points: 18 }] }
  ], drivers);
  assert.equal(data.driverStandings[0].points, 26);
  assert.equal(data.driverStandings[0].wins, 0);
  assert.equal(data.teamStandings[0].wins, 0);
  assert.equal(data.selectedHistory.races[0].title, 'Sprint · Spa');
});

test('Ersatzfahrer-Punkte bleiben im Ergebnis, zählen aber konfigurierbar zur Team-WM', () => {
  const seasonDrivers = [
    { id: 1, name: 'Fahrer A', team: { name: 'Mercedes' } }
  ];
  const weekend = [
    {
      id: 10, SeasonId: 5, LeagueId: 1, title: 'Großer Preis von Spa', circuit: 'Spa',
      raceType: 'main', sortOrder: 1, entries: [
        { GrandPrixResultId: 10, DriverId: 1, TeamId: 44, driverName: 'Fahrer A', teamName: 'Mercedes', position: 5, points: 10 },
        { GrandPrixResultId: 10, DriverId: 99, TeamId: 44, driverName: 'Tobi', teamName: 'Mercedes', position: 3, points: 15 }
      ]
    },
    {
      id: 11, SeasonId: 5, LeagueId: 1, title: 'Sprint · Spa', circuit: 'Spa',
      raceType: 'sprint', sortOrder: 1, entries: [
        { GrandPrixResultId: 11, DriverId: 99, TeamId: 44, driverName: 'Tobi', teamName: 'Mercedes', position: 1, points: 8 }
      ]
    }
  ];
  const lineups = [
    { GrandPrixResultId: 10, DriverId: 1, roleType: 'regular' },
    { GrandPrixResultId: 10, DriverId: 99, ReplacementForDriverId: 1, roleType: 'reserve', driver: { id: 99, name: 'Tobi' } }
  ];

  const excluded = buildSeasonData(league, weekend, seasonDrivers, lineups, { reservePointsForConstructors: false });
  const included = buildSeasonData(league, weekend, seasonDrivers, lineups, { reservePointsForConstructors: true });
  const legacyDefault = buildSeasonData(league, weekend, seasonDrivers, lineups, {});

  assert.equal(excluded.teamStandings.find((row) => row.team.name === 'Mercedes').points, 10);
  assert.equal(included.teamStandings.find((row) => row.team.name === 'Mercedes').points, 33);
  assert.equal(legacyDefault.teamStandings.find((row) => row.team.name === 'Mercedes').points, 33);
  assert.equal(weekend[0].entries[1].TeamId, 44);
  assert.equal(weekend[0].entries[1].teamName, 'Mercedes');
  assert.equal(weekend[0].entries[1].points, 15);
});

function driverChangeScenario(reservePoints = [6, 10]) {
  const mercedes = { id: 10, name: 'Mercedes', sourceType: 'current', sourceId: 100, logoPath: '/mercedes.png' };
  const drivers = [
    { id: 1, name: 'Marcel', team: mercedes },
    { id: 2, name: 'Tobi', team: mercedes }
  ];
  const positions = [4, 8, 5, 7];
  const points = [12, 4, 10, 6];
  const races = Array.from({ length: 6 }, (_, index) => ({
    id: 101 + index,
    SeasonId: 7,
    LeagueId: 1,
    title: `GP ${index + 1}`,
    circuit: `Strecke ${index + 1}`,
    raceType: 'main',
    sortOrder: index + 1,
    entries: index < 4
      ? [
          { GrandPrixResultId: 101 + index, DriverId: 1, TeamId: 100, driverName: 'Marcel', teamName: 'Mercedes', position: positions[index], points: points[index] },
          ...([1, 3].includes(index) ? [{ GrandPrixResultId: 101 + index, DriverId: 2, TeamId: 100, driverName: 'Tobi', teamName: 'Mercedes', position: index === 1 ? 7 : 5, points: reservePoints[index === 1 ? 0 : 1] }] : [])
        ]
      : [{ GrandPrixResultId: 101 + index, DriverId: 2, TeamId: 100, driverName: 'Tobi', teamName: 'Mercedes', position: index === 4 ? 5 : 3, points: index === 4 ? 10 : 15 }]
  }));
  const lineups = races.flatMap((race, index) => {
    if (index < 4) {
      return [
        { GrandPrixResultId: race.id, DriverId: 1, roleType: 'regular', includeInResults: true },
        ...([1, 3].includes(index) ? [{ GrandPrixResultId: race.id, DriverId: 2, ReplacementForDriverId: 9, roleType: 'reserve', includeInResults: true, driver: { id: 2, name: 'Tobi' } }] : [])
      ];
    }
    return [{ GrandPrixResultId: race.id, DriverId: 2, roleType: 'regular', includeInResults: true }];
  });
  const stints = [
    { id: 11, SeasonId: 7, DriverId: 1, SeasonTeamId: 10, roleType: 'regular', fromRound: 1, toRound: 4, endReason: 'left', carryReservePoints: false, driver: drivers[0], seasonTeam: mercedes },
    { id: 20, SeasonId: 7, DriverId: 2, SeasonTeamId: 10, roleType: 'reserve', fromRound: 1, toRound: 4, endReason: 'promoted', carryReservePoints: false, driver: drivers[1], seasonTeam: mercedes },
    { id: 21, SeasonId: 7, DriverId: 2, SeasonTeamId: 10, roleType: 'regular', fromRound: 5, toRound: null, endReason: null, carryReservePoints: true, previousStintId: 20, driver: drivers[1], seasonTeam: mercedes }
  ];
  return { drivers, races, lineups, stints };
}

test('Fahrerwechsel historisiert ausgeschiedene und neue Stammfahrer mit DNA', () => {
  const scenario = driverChangeScenario();
  const data = buildSeasonData(league, scenario.races, scenario.drivers, scenario.lineups, {}, scenario.stints);
  const marcel = data.selectedHistory.drivers.find((driver) => driver.name === 'Marcel');
  const tobi = data.selectedHistory.drivers.find((driver) => driver.name === 'Tobi');

  assert.equal(marcel.isFormerDriver, true);
  assert.equal(marcel.regularToRound, 4);
  assert.deepEqual(marcel.results.map((row) => row.main.value), ['P4', 'P8', 'P5', 'P7', 'DNA', 'DNA']);
  assert.equal(tobi.regularFromRound, 5);
  assert.deepEqual(tobi.results.map((row) => row.main.value), ['DNA', 'DNA', 'DNA', 'DNA', 'P5', 'P3']);
});

test('Beförderter Ersatzfahrer trennt Ersatz- und Stammfahrerwertung am Wechseltermin', () => {
  const scenario = driverChangeScenario();
  const data = buildSeasonData(league, scenario.races, scenario.drivers, scenario.lineups, {}, scenario.stints);
  const regular = data.driverStandings.find((row) => row.driver.name === 'Tobi');
  const reserve = data.selectedHistory.reserveDrivers.find((driver) => driver.name === 'Tobi');

  assert.equal(regular.points, 25);
  assert.equal(reserve.total, 16);
  assert.equal(reserve.promotedToRegular, true);
  assert.equal(reserve.promotedFromRound, 5);
  assert.deepEqual(reserve.results.map((row) => row.main.value), ['DNS', 'P7', 'DNS', 'P5', 'DNA', 'DNA']);

  scenario.races[1].entries.find((entry) => entry.DriverId === 2).points = 8;
  const corrected = buildSeasonData(league, scenario.races, scenario.drivers, scenario.lineups, {}, scenario.stints);
  assert.equal(corrected.driverStandings.find((row) => row.driver.name === 'Tobi').points, 25);
  assert.equal(corrected.reserveStandings.find((row) => row.driver.name === 'Tobi').points, 18);
});

test('Fahrer-WM übernimmt keine Ersatzpunkte vor einem späteren Stammcockpit', () => {
  const mercedes = { id: 10, name: 'Mercedes', sourceType: 'current', sourceId: 100 };
  const williams = { id: 20, name: 'Williams', sourceType: 'current', sourceId: 200 };
  const driver = { id: 3, name: 'Alex', team: mercedes };
  const races = [
    { id: 201, SeasonId: 8, LeagueId: 1, title: 'GP 2', raceType: 'main', sortOrder: 2, entries: [{ GrandPrixResultId: 201, DriverId: 3, TeamId: 200, driverName: 'Alex', teamName: 'Williams', position: 5, points: 10 }] },
    { id: 202, SeasonId: 8, LeagueId: 1, title: 'GP 5', raceType: 'main', sortOrder: 5, entries: [{ GrandPrixResultId: 202, DriverId: 3, TeamId: 100, driverName: 'Alex', teamName: 'Mercedes', position: 3, points: 15 }] }
  ];
  const lineups = [
    { GrandPrixResultId: 201, DriverId: 3, ReplacementForDriverId: 8, roleType: 'reserve', includeInResults: true, driver },
    { GrandPrixResultId: 202, DriverId: 3, roleType: 'regular', includeInResults: true }
  ];
  const stints = [
    { id: 30, DriverId: 3, SeasonTeamId: 20, roleType: 'reserve', fromRound: 1, toRound: 4, endReason: 'promoted', driver, seasonTeam: williams },
    { id: 31, DriverId: 3, SeasonTeamId: 10, roleType: 'regular', fromRound: 5, toRound: null, carryReservePoints: false, previousStintId: 30, driver, seasonTeam: mercedes }
  ];
  const data = buildSeasonData(league, races, [driver], lineups, {}, stints);

  assert.equal(data.driverStandings.find((row) => row.driver.name === 'Alex').points, 15);
  assert.equal(data.reserveStandings.find((row) => row.driver.name === 'Alex').points, 10);
  assert.equal(data.teamStandings.find((row) => row.team.name === 'Williams').points, 10);
  assert.equal(data.teamStandings.find((row) => row.team.name === 'Mercedes').points, 15);
  assert.equal(races[0].entries[0].TeamId, 200);
  assert.equal(races[0].entries[0].teamName, 'Williams');
});

test('Cockpitabgabe trennt spätere Ersatzeinsätze von der Stammfahrer-WM', () => {
  const driver = { id: 4, name: 'Chris', team: { id: 10, name: 'Mercedes' } };
  const races = [
    { id: 301, SeasonId: 9, LeagueId: 1, title: 'GP 1', raceType: 'main', sortOrder: 1, entries: [{ GrandPrixResultId: 301, DriverId: 4, driverName: 'Chris', teamName: 'Mercedes', position: 4, points: 12 }] },
    { id: 302, SeasonId: 9, LeagueId: 1, title: 'GP 2', raceType: 'main', sortOrder: 2, entries: [] },
    { id: 303, SeasonId: 9, LeagueId: 1, title: 'GP 3', raceType: 'main', sortOrder: 3, entries: [{ GrandPrixResultId: 303, DriverId: 4, driverName: 'Chris', teamName: 'Ferrari', position: 6, points: 8 }] }
  ];
  const lineups = [{
    GrandPrixResultId: 303, DriverId: 4, ReplacementForDriverId: 8,
    roleType: 'reserve', includeInResults: true, driver
  }];
  const stints = [
    { id: 40, DriverId: 4, SeasonTeamId: 10, roleType: 'regular', fromRound: 1, toRound: 1, endReason: 'demoted', driver, seasonTeam: driver.team },
    { id: 41, DriverId: 4, SeasonTeamId: null, roleType: 'reserve', fromRound: 2, toRound: null, previousStintId: 40, driver, seasonTeam: null }
  ];
  const data = buildSeasonData(league, races, [driver], lineups, {}, stints);
  const regular = data.selectedHistory.drivers.find((row) => row.name === 'Chris');
  const reserve = data.selectedHistory.reserveDrivers.find((row) => row.name === 'Chris');

  assert.equal(data.driverStandings.find((row) => row.driver.name === 'Chris').points, 12);
  assert.deepEqual(regular.results.map((row) => row.main.value), ['P4', 'DNA', 'DNA']);
  assert.deepEqual(reserve.results.map((row) => row.main.value), ['DNA', 'DNS', 'P6']);
  assert.equal(data.reserveStandings.find((row) => row.driver.name === 'Chris').points, 8);
});

test('Ehemaliger Fahrer mit ausschließlich DNS/DNA bleibt nicht in der Fahrer-WM', () => {
  const driver = { id: 5, name: 'Ohne Start', team: { id: 10, name: 'Mercedes' } };
  const races = [{ id: 401, SeasonId: 10, LeagueId: 1, title: 'GP 1', raceType: 'main', sortOrder: 1, entries: [] }];
  const stints = [{ id: 50, DriverId: 5, SeasonTeamId: 10, roleType: 'regular', fromRound: 1, toRound: 1, endReason: 'left', driver, seasonTeam: driver.team }];
  const data = buildSeasonData(league, races, [driver], [], {}, stints);
  assert.equal(data.driverStandings.some((row) => row.driver.name === 'Ohne Start'), false);
  assert.equal(data.selectedHistory.drivers.some((row) => row.name === 'Ohne Start'), false);
});

test('LMU-Punktesystem addiert schnellste Runde und Poleposition saisonbezogen', async () => {
  const originals = { season: Season.findByPk, scheme: PointsScheme.findOne, allocation: PointAllocation.findOne };
  Season.findByPk = async () => ({ PointsSchemeId: 9 });
  PointsScheme.findOne = async () => ({ id: 9, discipline: 'lmu', fastestLapEnabled: true, fastestLapPoints: 1, polePositionEnabled: true, polePositionPoints: 2 });
  PointAllocation.findOne = async () => ({ points: 25 });
  try {
    const points = await pointsForPosition(1, { SeasonId: 3, discipline: 'lmu', fastestLap: true, polePosition: true });
    assert.equal(points, 28);
  } finally {
    Season.findByPk = originals.season;
    PointsScheme.findOne = originals.scheme;
    PointAllocation.findOne = originals.allocation;
  }
});

