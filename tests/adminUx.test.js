const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

process.env.DB_HOST ||= 'localhost';
process.env.DB_NAME ||= 'krl';
process.env.DB_USER ||= 'krl';
process.env.DB_PASSWORD ||= 'krl';

const resourceConfig = require('../services/resourceConfig');
const models = require('../models');
const { F1RaceLineupEntry } = models;

const layout = { currentPath: '/admin', isAdmin: true, flash: null };

test('Fahrerpflege nutzt feste Nationalitäten und Rangfilter', () => {
  const nationality = resourceConfig.drivers.fields.find((field) => field.name === 'nationality');
  assert.equal(nationality.type, 'select');
  assert.deepEqual(nationality.choices.find(([value]) => value === 'DE'), ['DE', 'Deutschland (DE)']);
  assert.deepEqual(nationality.choices.find(([value]) => value === 'CH'), ['CH', 'Schweiz (CH)']);
  assert.deepEqual(nationality.choices.find(([value]) => value === 'AU'), ['AU', 'Australien (AU)']);
  assert.equal(resourceConfig.drivers.groupByRanks, true);
  assert.equal(resourceConfig.drivers.rankFilters.some((rank) => rank.value === 'f1-friday'), true);
});

test('Fahrerpflege blockiert doppelte Namen unabhängig von Großschreibung', async () => {
  const originalFindOne = models.Driver.findOne;
  models.Driver.findOne = async () => ({ id: 4, name: 'Max Beispiel' });
  try {
    await assert.rejects(
      resourceConfig.drivers.prepareValues({ name: '  MAX BEISPIEL  ' }, {}, null),
      /Fahrername „MAX BEISPIEL“ ist bereits vergeben/
    );
  } finally {
    models.Driver.findOne = originalFindOne;
  }
});

test('Fahrerübersicht gruppiert Stammdaten automatisch nach Rang', async () => {
  const driver = { id: 7, name: 'Max Beispiel', aliasesText: 'Alter Name', platform: 'PC', nationality: 'CH', roleF1Friday: true };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'resource-list.ejs'), {
    ...layout, title: 'Fahrer-Pflege', adminBasePath: '/admin', resource: 'drivers',
    config: resourceConfig.drivers, entries: [driver],
    fieldOptions: { nationality: [{ value: 'CH', label: 'Schweiz (CH)' }] },
    selectedLeague: '', leagueOptions: [], selectedRank: '',
    rankGroups: [{ value: 'f1-friday', label: 'Stamm Freitag', entries: [driver] }]
  });
  assert.match(html, /Fahrer nach Rang filtern/);
  assert.match(html, /Stamm Freitag/);
  assert.match(html, /Max Beispiel/);
  assert.match(html, /Schweiz \(CH\)/);
});

test('Punkte je Platz erscheinen direkt im zugehörigen Punktesystem', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'resource-list.ejs'), {
    ...layout, title: 'Punktesysteme', adminBasePath: '/admin', resource: 'pointsSchemes',
    config: resourceConfig.pointsSchemes,
    entries: [{ id: 2, name: 'F1 2026', discipline: 'f1', validFrom: '2026-01-01', validUntil: null, fastestLapEnabled: true, fastestLapPoints: 1, allocations: [
      { id: 11, raceType: 'main', position: 1, points: 25 },
      { id: 12, raceType: 'sprint', position: 1, points: 8 }
    ] }],
    fieldOptions: {}, selectedLeague: '', leagueOptions: [], selectedRank: '', rankGroups: []
  });
  assert.match(html, /Hauptrennen/);
  assert.match(html, /Sprintrennen/);
  assert.match(html, /Platz 1/);
  assert.match(html, /pointAllocations\/new\?scheme=2/);
});

test('Vorhandene F1-Teams erhalten einen verpflichtenden Farbcode', () => {
  const accentColor = resourceConfig.teams.fields.find((field) => field.name === 'accentColor');
  assert.equal(accentColor.type, 'color');
  assert.equal(accentColor.required, true);
  assert.equal(models.Team.rawAttributes.accentColor.field, 'accent_color');
  assert.equal(models.Team.rawAttributes.accentColor.defaultValue, '#6ef2f2');
});

test('MariaDB-kompatibler Ersatzfahrerindex hat einen kurzen Namen', () => {
  const index = F1RaceLineupEntry.options.indexes.find((candidate) => candidate.fields.includes('replacement_for_driver_id'));
  assert.equal(index.name, 'uq_f1_lineup_replacement');
  assert.ok(index.name.length <= 64);
});
