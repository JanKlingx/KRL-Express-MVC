const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const policy = require('../services/f1DriverPolicy');
const { wizardState } = require('../services/seasonWizard');
const { selectWeekendReserves } = require('../services/raceLineup');
const { seasonLineupIsProtected } = require('../services/seasonDriverStints');
const root = path.join(__dirname, '..');

test('Aktuelle Ersatzfahrer brauchen Ersatzrang; historische Einsätze akzeptieren F1-Stammränge anderer Ligen', () => {
  const regular = { id: 1, roleF1Sunday: true };
  assert.equal(policy.hasF1View({ viewF1: true }), true);
  assert.equal(policy.reserveEligible(regular, false), false);
  assert.equal(policy.reserveEligible(regular, true), true);
  assert.throws(() => selectWeekendReserves([regular], [], { d1: {} }), /F1 Ersatz/);
  assert.deepEqual(selectWeekendReserves([regular], [], { d1: {} }, true), [regular]);
  assert.throws(() => selectWeekendReserves([{ id: 2, viewLmu: true }], [], { d2: {} }, true), /F1-Rang/);
  assert.equal(policy.reserveEligible({ roleF1Sunday: true, roleF1Reserve: true }, false), true);
});

test('Neue historische Saison bleibt bearbeitbar, veröffentlichte oder operative Saison ist geschützt', async (t) => {
  t.mock.method(models.SeasonDriverStint, 'findAll', async () => []);
  t.mock.method(models.GrandPrixResult, 'findAll', async () => []);
  assert.equal(await seasonLineupIsProtected({ id: 1, status: 'historical', isPublished: false }), false);
  assert.equal(await seasonLineupIsProtected({ id: 1, status: 'historical', isPublished: true }), true);
});

test('Saison-Assistent gibt nur erreichte Schritte und Abschluss nach vollständiger Aufstellung frei', () => {
  assert.equal(wizardState({}, 8).current, 1);
  const data = { selectedLeague: {}, selectedSeason: { PointsSchemeId: 1 }, calendar: [{ startsAt: '2026-09-11' }], structure: { allDrivers: [{ id: 1 }, { id: 2 }], teams: [{}], lineup: [{ DriverId: 1, roleType: 'regular' }] } };
  assert.equal(wizardState(data, 8).current, 7);
  assert.equal(wizardState(data, 2).current, 2);
  data.structure.lineup.push({ DriverId: 2, roleType: 'regular' });
  assert.equal(wizardState(data).current, 8);
});

test('Aktivierung vergibt nur eigenen Ligastammrang und bewahrt weitere Stamm- und Ersatzränge', async (t) => {
  const transaction = { LOCK: { UPDATE: 'update' } };
  const rows = [
    { id: 1, roleF1Sunday: false, roleF1Friday: true, roleF1Reserve: true },
    { id: 2, roleF1Sunday: true, roleF1Friday: false, roleF1Reserve: false }
  ].map((row) => ({ ...row, toJSON() { return { ...this }; }, async update(values) { Object.assign(this, values); } }));
  t.mock.method(models.sequelize, 'transaction', async (callback) => callback(transaction));
  t.mock.method(models.SeasonDriverStint, 'findAll', async () => [{ DriverId: 1 }]);
  t.mock.method(models.Driver, 'findAll', async () => rows);
  await policy.syncActivatedSeasonRanks({ id: 10, leagueType: 'f1', scopeSlug: 'sonntag', status: 'historical', isPublished: true });
  assert.equal(rows[0].roleF1Sunday, false);
  await policy.syncActivatedSeasonRanks({ id: 10, leagueType: 'f1', scopeSlug: 'sonntag', status: 'active', isPublished: true });
  assert.equal(rows[0].roleF1Sunday, true); assert.equal(rows[0].roleF1Friday, true); assert.equal(rows[0].roleF1Reserve, true);
  assert.equal(rows[1].roleF1Sunday, false); assert.equal(rows[1].roleFormerF1, true);
  assert.equal(policy.seasonRankLabel({ name: 'Saison 10', status: 'historical', scopeSlug: 'sonntag' }), 'Stamm Sonntag · Saison 10 (historisch)');
});

test('Assistent zeigt gespeicherte Angaben und erlaubt Zurück ohne vorzeitigen Abschluss', async () => {
  const league = { id: 1, name: 'Sonntag', slug: 'sonntag', accentColor: '#00aaff' };
  const season = { id: 2, name: 'Saison 10', status: 'historical', accentColor: '#00aaff', isPublished: false };
  const html = await ejs.renderFile(path.join(root, 'views/admin/season-setup.ejs'), {
    title: 'Assistent', currentPath: '/admin', isAdmin: true, flash: null,
    leagues: [league], selectedLeague: league, discipline: 'f1', seasons: [season], selectedSeason: season,
    pointsSchemes: [], calendar: [], f1Teams: [], carProfiles: [], defaultTime: '20:00', tracks: [], eligibleDrivers: [],
    structure: { allDrivers: [], teams: [], unassignedDrivers: [], lineup: [] }, finishReady: false,
    wizard: { current: 3, available: 3 }, f1Games: [], centralCalendars: []
  });
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/admin/season-setup?league=1&season=2' });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  try {
    dom.window.eval(fs.readFileSync(path.join(root, 'public/js/season-wizard.js'), 'utf8'));
    const d = dom.window.document; d.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    assert.equal(d.querySelector('#setup-finish').hidden, true);
    assert.equal(d.querySelector('#setup-calendar').hidden, false);
    d.querySelector('[data-step-link="2"]').click();
    assert.equal(d.querySelector('#setup-season').hidden, false);
    assert.equal(d.querySelector('[name="name"]').value, 'Saison 10');
    assert.equal(d.querySelector('form[action="/admin/season-setup/seasons"]'), null);
    d.querySelector('[data-step-link="8"]').click();
    assert.equal(d.querySelector('#setup-finish').hidden, true);
  } finally { dom.window.close(); }
});

test('Stammfahrer einer anderen Liga erhält Punkte ausschließlich in der Reservewertung des Einsatzes', () => {
  const { buildSeasonData } = require('../services/standings');
  const driver = { id: 7, name: 'Sonntagsstamm', roleF1Sunday: true, roleF1Reserve: true };
  const races = [{ id: 1, SeasonId: 10, LeagueId: 1, sortOrder: 1, title: 'Freitag GP', raceType: 'main', entries: [{ GrandPrixResultId: 1, DriverId: 7, driverName: driver.name, position: 4, points: 12, teamName: 'Ferrari' }] }];
  const lineups = [{ GrandPrixResultId: 1, DriverId: 7, ReplacementForDriverId: 8, roleType: 'reserve', includeInResults: true, driver }];
  const data = buildSeasonData({ id: 1, name: 'Freitag' }, races, [], lineups, {}, []);
  assert.equal(data.reserveStandings.find((row) => row.driver.id === 7).points, 12);
  assert.equal(data.driverStandings.some((row) => row.driver.id === 7), false);
});
