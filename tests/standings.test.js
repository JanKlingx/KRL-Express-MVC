const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSeasonData } = require('../services/standings');
const { createCsv } = require('../services/csv');

const league = { slug: 'freitag', currentSeason: 'Saison 12' };
const drivers = [
  { name: 'Fahrer A', team: { name: 'Team Rot' } },
  { name: 'Fahrer B', team: { name: 'Team Blau' } },
  { name: 'Fahrer C', team: { name: 'Team Rot' } }
];
const races = [
  { title: 'Großer Preis von Bahrain', sortOrder: 1, entries: [
    { driverName: 'Fahrer A', teamName: 'Team Rot', position: 1, points: 25 },
    { driverName: 'Fahrer B', teamName: 'Team Blau', position: 2, points: 18 },
    { driverName: 'Fahrer C', teamName: 'Team Rot', position: 3, points: 15 }
  ] },
  { title: 'Großer Preis von Australien', sortOrder: 2, entries: [
    { driverName: 'Fahrer B', teamName: 'Team Blau', position: 1, points: 25 },
    { driverName: 'Fahrer A', teamName: 'Team Rot', position: null, status: 'DNF', points: 0 }
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
