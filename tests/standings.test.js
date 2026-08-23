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
