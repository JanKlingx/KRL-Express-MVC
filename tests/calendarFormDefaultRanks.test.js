const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const calendar = require('../controllers/f1CalendarController');
const setup = require('../controllers/seasonSetupController');
const policy = require('../services/f1DriverPolicy');
const config = require('../services/resourceConfig');
const { registerReserveParticipation } = require('../services/reserveParticipation');
function row(data) { return { ...data, async update(values) { Object.assign(this, values); } }; }
function appFor(handler, session, params) {
  const app = express(); app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.post('/', (req, res, next) => { req.session = session; req.params = params; Promise.resolve(handler(req, res)).catch(next); }); return app;
}

test('Echter Express-POST behält Kalendereinträge nach Verschieben bei kleinen und großen IDs', async (t) => {
  const rounds = [row({ id: 2, sortOrder: 1 }), row({ id: 7, sortOrder: 2 }), row({ id: 1234, sortOrder: 3 })];
  t.mock.method(models.sequelize, 'transaction', async (fn) => fn({ LOCK: { UPDATE: 'update' } }));
  t.mock.method(models.F1Calendar, 'findByPk', async () => ({ id: 1 }));
  t.mock.method(models.F1CalendarRound, 'findAll', async () => rounds);
  t.mock.method(models.F1CalendarRound, 'findByPk', async (id) => rounds.find((item) => item.id === id));
  t.mock.method(models.RaceEvent, 'findAll', async () => []);
  t.mock.method(models.F1Track, 'findByPk', async () => ({ id: 9, name: 'Spa' }));
  const session = {};
  await request(appFor(calendar.saveStructure, session, { calendarId: 1 })).post('/').type('form').send('roundIds=1234&roundIds=2&roundIds=7&rounds[r1234][F1TrackId]=9&rounds[r2][F1TrackId]=9&rounds[r2][isTestDay]=on&rounds[r7][F1TrackId]=9').expect(302);
  assert.equal(session.flash.type, 'success'); assert.deepEqual(rounds.map((item) => [item.id, item.sortOrder, item.roundNumber]), [[2, 2, null], [7, 3, 2], [1234, 1, 1]]);
});

test('Saisontermine: echter POST erzeugt Testtag und R1 getrennt, erneutes Speichern aktualisiert statt zu duplizieren', async (t) => {
  const season = row({ id: 1, F1CalendarId: 10, leagueType: 'f1', scopeSlug: 'sonntag', status: 'active', isPublished: false });
  const league = { id: 2, raceTime: '20:00' }; const track = { name: 'Spa', country: 'Belgien' };
  const rounds = [{ id: 2, isTestDay: true, sortOrder: 1, F1TrackId: 9, track }, { id: 7, roundNumber: 1, sortOrder: 2, F1TrackId: 9, track }];
  const events = []; const results = [];
  t.mock.method(models.sequelize, 'transaction', async (fn) => fn({ LOCK: { UPDATE: 'update' } }));
  t.mock.method(models.Season, 'findByPk', async () => season);
  t.mock.method(models.League, 'findOne', async () => league);
  t.mock.method(models.F1Calendar, 'findByPk', async () => ({ id: 10, name: 'Kalender', isActive: true, rounds }));
  t.mock.method(models.RaceEvent, 'findAll', async ({ where }) => events.filter((event) => (where.F1CalendarRoundId === undefined || event.F1CalendarRoundId === where.F1CalendarRoundId) && (where.sortOrder === undefined || event.sortOrder === where.sortOrder) && (where.isTestDay === undefined || event.isTestDay === where.isTestDay)));
  t.mock.method(models.RaceEvent, 'create', async (values) => { const event = row({ id: events.length + 1, ...values }); events.push(event); return event; });
  t.mock.method(models.GrandPrixResult, 'findAll', async ({ where }) => results.filter((result) => (typeof where.raceType !== 'string' || result.raceType === where.raceType) && (where.sortOrder === undefined || result.sortOrder === where.sortOrder)));
  t.mock.method(models.GrandPrixResult, 'create', async (values) => { const result = row({ id: results.length + 1, ...values }); results.push(result); return result; });
  t.mock.method(models.GrandPrixResult, 'findByPk', async (id) => results.find((result) => result.id === id));
  t.mock.method(models.GrandPrixResultEntry, 'count', async () => 0);
  const session = {}; const app = appFor(setup.saveCentralCalendar, session, { seasonId: 1 });
  await request(app).post('/').type('form').send('dates[r2]=2026-09-13&dates[r7]=2026-09-20').expect(302);
  assert.equal(session.flash.type, 'success'); assert.equal(events.length, 2); assert.equal(events[0].isTestDay, true); assert.equal(events[1].GrandPrixResultId, 1);
  await request(app).post('/').type('form').send('dates[r2]=2026-09-14&dates[r7]=2026-09-21').expect(302);
  assert.equal(session.flash.type, 'success'); assert.equal(events.length, 2); assert.equal(results[0].raceDate, '2026-09-21');
  await request(app).post('/').type('form').send('dates[r2]=2026-09-14&dates[r7]=2026-02-30').expect(302);
  assert.equal(session.flash.type, 'error'); assert.deepEqual(session.seasonDateDraft.dates, { 2: '2026-09-14', 7: '' });
});

test('Neue F1-Fahrer erhalten Ersatz als Default; manipulierte Stammränge werden ignoriert', async (t) => {
  t.mock.method(models.Driver, 'findOne', async () => null);
  t.mock.method(models.Platform, 'findByPk', async () => ({ id: 1, name: 'PC' }));
  const values = { name: 'Neu', PlatformId: 1, roleF1Sunday: true };
  await config.drivers.prepareValues(values, { driverWizard: '1', driverViews: ['f1'] });
  assert.equal(values.roleF1Reserve, true); assert.equal(values.roleF1Sunday, false); assert.equal(values.roleFormerF1, false);
  assert.equal(policy.seasonDriverEligible(values, { status: 'active' }), true);
});

test('Alte Stammflags ohne aktiven Stammplatz werden Ersatz; echte Stammplätze und Ehemalige bleiben korrekt', () => {
  assert.equal(policy.defaultF1Values({ roleF1Sunday: true }, []).roleF1Reserve, true);
  const regular = policy.defaultF1Values({ viewF1: true }, ['sonntag']);
  assert.equal(regular.roleF1Sunday, true); assert.equal(regular.roleF1Reserve, false);
  assert.equal(policy.defaultF1Values(regular, ['sonntag'], ['freitag']).roleF1Reserve, true);
  assert.equal(policy.defaultF1Values({ roleFormerF1: true }, []).roleF1Reserve, false);
  assert.equal(policy.seasonDriverEligible({ id: 7, roleF1Sunday: true }, { status: 'active' }), false);
  assert.equal(policy.seasonDriverEligible({ id: 7, roleF1Sunday: true }, { status: 'active' }, [7]), true);
});

test('Ersatz in anderer Liga erhält zusätzliche Rolle und rundenbezogenen Ersatzzeitraum', async (t) => {
  const driver = row({ id: 7, roleF1Sunday: true, roleF1Reserve: false }); let created;
  t.mock.method(models.Driver, 'findByPk', async () => driver);
  t.mock.method(models.SeasonDriverStint, 'findAll', async () => []);
  t.mock.method(models.F1RaceLineupEntry, 'findAll', async () => []);
  t.mock.method(models.SeasonDriverStint, 'create', async (values) => { created = values; });
  await registerReserveParticipation({ SeasonId: 2, sortOrder: 5 }, [{ DriverId: 7, roleType: 'reserve' }], false, { LOCK: { UPDATE: 'update' } });
  assert.equal(driver.roleF1Sunday, true); assert.equal(driver.roleF1Reserve, true); assert.equal(created.fromRound, 5); assert.equal(created.SeasonId, 2);
});

test('Reservewertung zeigt DNA vor Eintritt und DNS bei späterem Nichteinsatz', () => {
  const { buildSeasonData } = require('../services/standings');
  const driver = { id: 7, name: 'Sonntagsstamm', roleF1Sunday: true, roleF1Reserve: true };
  const races = [4, 5, 6].map((round) => ({ id: round, SeasonId: 2, LeagueId: 1, sortOrder: round, title: `GP ${round}`, raceType: 'main', entries: [] }));
  const stint = { DriverId: 7, SeasonId: 2, roleType: 'reserve', fromRound: 5, toRound: null, driver };
  const data = buildSeasonData({ id: 1, name: 'Freitag' }, races, [], [{ GrandPrixResultId: 5, DriverId: 7, roleType: 'reserve', driver, includeInResults: false }], {}, [stint]);
  const results = data.selectedHistory.reserveDrivers.find((row) => row.id === 7).results;
  assert.deepEqual(results.map((row) => row.status), ['DNA', 'DNS', 'DNS']);
});

test('Rangabgleich nutzt aktive Stammplätze, ist wiederholbar und ändert keine Rennhistorie', async (t) => {
  const drivers = [row({ id: 1, roleF1Sunday: true }), row({ id: 2, viewF1: true }), row({ id: 3, roleFormerF1: true })];
  t.mock.method(models.sequelize, 'transaction', async (fn) => fn({ LOCK: { UPDATE: 'update' } }));
  t.mock.method(models.Season, 'findAll', async ({ where }) => { assert.equal(where.status, 'active'); assert.equal(where.isPublished, undefined); return [{ id: 10, scopeSlug: 'sonntag' }]; });
  t.mock.method(models.SeasonDriverStint, 'findAll', async () => [{ DriverId: 2, SeasonId: 10 }]);
  t.mock.method(models.F1RaceLineupEntry, 'findAll', async () => []);
  t.mock.method(models.Driver, 'findAll', async () => drivers);
  await policy.reconcileF1Ranks();
  assert.equal(drivers[0].roleF1Sunday, false); assert.equal(drivers[0].roleF1Reserve, true);
  assert.equal(drivers[1].roleF1Sunday, true); assert.equal(drivers[1].roleF1Reserve, false);
  assert.equal(drivers[2].roleFormerF1, true); assert.equal(drivers[2].roleF1Reserve, false);
  const previous = drivers.map((driver) => JSON.stringify(driver));
  await policy.reconcileF1Ranks(); assert.deepEqual(drivers.map((driver) => JSON.stringify(driver)), previous);
});

test('Beendeter Ersatzstatus wird beim Neustart durch alte Einsätze nicht wieder vergeben', async (t) => {
  const driver = row({ id: 2, roleF1Sunday: true, roleF1Reserve: false });
  t.mock.method(models.sequelize, 'transaction', async (fn) => fn({ LOCK: { UPDATE: 'update' } }));
  t.mock.method(models.Season, 'findAll', async () => [{ id: 10, scopeSlug: 'sonntag' }, { id: 20, scopeSlug: 'freitag' }]);
  t.mock.method(models.SeasonDriverStint, 'findAll', async ({ where }) => where.roleType === 'regular' ? [{ DriverId: 2, SeasonId: 10, toRound: null }] : [{ DriverId: 2, SeasonId: 20, fromRound: 1, toRound: 4 }]);
  t.mock.method(models.F1RaceLineupEntry, 'findAll', async () => [{ DriverId: 2, race: { SeasonId: 20 } }]);
  t.mock.method(models.Driver, 'findAll', async () => [driver]);
  await policy.reconcileF1Ranks(); assert.equal(driver.roleF1Sunday, true); assert.equal(driver.roleF1Reserve, false);
});
