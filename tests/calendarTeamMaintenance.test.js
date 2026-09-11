const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const { validateDates } = require('../services/f1Calendar');
const calendarController = require('../controllers/f1CalendarController');
const setupController = require('../controllers/seasonSetupController');
const groupController = require('../controllers/teamGroupController');
const layout = { title: 'Test', isAdmin: true, flash: null, currentPath: '/admin' };

test('Datumsprüfung meldet nur falsche Runden, erkennt ungültige Kalendertage', () => {
  assert.throws(() => validateDates([{ id: 1 }, { id: 2 }, { id: 3 }], { 1: '2026-09-13', 2: '2026-02-30', 3: '' }, { raceTime: '20:00' }), (error) => {
    assert.deepEqual(Object.keys(error.dateErrors), ['2', '3']); return true;
  });
  assert.doesNotThrow(() => validateDates([{ id: 1 }], { 1: '2028-02-29' }, { raceTime: '20:00' }));
});

test('Saison-Datumsfehler behält gültige Eingaben und leert nur das falsche Datum', async (t) => {
  t.mock.method(models.Season, 'findByPk', async () => ({ id: 4, F1CalendarId: 5, scopeSlug: 'sonntag', leagueType: 'f1' }));
  t.mock.method(models.League, 'findOne', async () => ({ id: 2 }));
  t.mock.method(models.sequelize, 'transaction', async () => { const error = new Error('Datum falsch'); error.dateErrors = { 8: 'Ungültig' }; throw error; });
  const req = { params: { seasonId: 4 }, body: { dates: { 7: '2026-09-13', 8: '2026-02-30' } }, session: {} };
  await setupController.saveCentralCalendar(req, { redirect() {} });
  assert.deepEqual(req.session.seasonDateDraft.dates, { 7: '2026-09-13', 8: '' });
  assert.equal(req.session.seasonDateDraft.calendarId, 5);
});

test('Kalendername erkennt Duplikate unabhängig von Großschreibung und Leerzeichen', async (t) => {
  t.mock.method(models.F1Calendar, 'findAll', async () => [{ id: 1, name: 'Saison 18' }]);
  const create = t.mock.method(models.F1Calendar, 'create', async () => { throw new Error('Darf nicht aufgerufen werden'); });
  const req = { body: { name: ' saison 18 ' }, params: {}, session: {} }; let url;
  await calendarController.create(req, { redirect(value) { url = value; } });
  assert.match(req.session.flash.message, /existiert bereits/);
  assert.equal(url, '/admin/f1-calendars?mode=create'); assert.equal(create.mock.callCount(), 0);
});

test('Kalender trennt Auswahl und Erstellung; Testtag blendet Rennnummer und Sprint korrekt um', async () => {
  const data = { ...layout, calendars: [], selectedCalendar: null, tracks: [], creating: false, draftName: '' };
  let html = await ejs.renderFile('views/admin/f1-calendars.ejs', data);
  assert.equal(new JSDOM(html).window.document.querySelector('input[name="name"]'), null);
  html = await ejs.renderFile('views/admin/f1-calendars.ejs', { ...data, creating: true });
  assert.ok(new JSDOM(html).window.document.querySelector('input[name="name"]'));
  const round = { id: 7, roundNumber: 1, isTestDay: false, hasSprint: true, F1TrackId: 2 };
  html = await ejs.renderFile('views/admin/f1-calendars.ejs', { ...data, selectedCalendar: { id: 3, name: 'Saison 18', rounds: [round] } });
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const d = dom.window.document; const row = d.querySelector('[data-round-row]');
  assert.equal(dom.window.getComputedStyle(row.querySelector('[data-test-label]')).display, 'none');
  assert.equal(d.querySelector('#calendar-reorder-form').getAttribute('action'), '/admin/f1-calendars/3/rounds/reorder');
  const toggle = row.querySelector('[data-test-toggle]'); toggle.checked = true; toggle.dispatchEvent(new dom.window.Event('change'));
  assert.equal(row.querySelector('[name="roundNumber"]').disabled, true);
  assert.equal(row.querySelector('[data-sprint-toggle]').checked, false);
  assert.equal(row.querySelector('[data-test-label]').hidden, false);
  toggle.checked = false; toggle.dispatchEvent(new dom.window.Event('change'));
  assert.equal(row.querySelector('[name="roundNumber"]').required, true);
  assert.equal(row.querySelector('[data-test-label]').hidden, true);
  assert.equal(d.querySelector('input[name="sortOrder"]'), null); dom.window.close();
});

test('Gruppe löschen entfernt nur deren Zuordnungen, keine Fahrer', async (t) => {
  const calls = []; const transaction = { LOCK: { UPDATE: 'update' } };
  t.mock.method(models.sequelize, 'transaction', async (fn) => fn(transaction));
  t.mock.method(models.KrlTeam, 'findByPk', async () => ({ id: 6, destroy: async () => calls.push('group') }));
  t.mock.method(models.KrlTeamAssignment, 'destroy', async (options) => { assert.deepEqual(options.where, { KrlTeamId: 6 }); calls.push('assignments'); });
  const drivers = t.mock.method(models.Driver, 'destroy', async () => { throw new Error('Keine Fahrer löschen'); });
  await groupController.remove({ params: { id: 6 }, session: {} }, { redirect() {} });
  assert.deepEqual(calls, ['assignments', 'group']); assert.equal(drivers.mock.callCount(), 0);
});

test('Historische Ergebnisbearbeitung übernimmt bestätigten Ersatzfahrer und sein Einsatzteam', async (t) => {
  const regular = { id: 10, name: 'Stamm', aliases: [] };
  const reserve = { id: 20, name: 'Ersatz aus anderer Liga', aliases: [] };
  t.mock.method(require('../services/f1Season'), 'loadSeasonStructure', async () => ({ teams: [{ id: 6, sourceType: 'current', sourceId: 7, name: 'Team', drivers: [regular] }], allDrivers: [regular], lineup: [] }));
  delete require.cache[require.resolve('../controllers/raceEditorController')];
  const controller = require('../controllers/raceEditorController');
  t.mock.method(models.League, 'findAll', async () => [{ id: 1, slug: 'sonntag' }]);
  t.mock.method(models.Season, 'findAll', async () => [{ id: 2, status: 'historical' }]);
  t.mock.method(models.GrandPrixResult, 'findAll', async () => [{ id: 3, SeasonId: 2, LeagueId: 1, sortOrder: 1 }]);
  t.mock.method(models.GrandPrixResult, 'findOne', async () => null);
  t.mock.method(models.Team, 'findByPk', async () => ({ id: 7 }));
  t.mock.method(models.GrandPrixResultEntry, 'findAll', async () => []);
  t.mock.method(models.PenaltyEntry, 'findAll', async () => []);
  t.mock.method(models.F1RaceLineupEntry, 'findAll', async () => [
    { DriverId: 10, TeamId: 7, roleType: 'regular', attendanceStatus: 'abgemeldet', includeInResults: false, driver: regular },
    { DriverId: 20, TeamId: 7, ReplacementForDriverId: 10, roleType: 'reserve', attendanceStatus: 'anwesend', includeInResults: true, driver: reserve },
  ]);
  let result;
  await controller.show({ query: { league: '1', season: '2', race: '3' } }, { render(view, data) { result = data; } });
  assert.equal(result.lineupManaged, true); assert.equal(result.attendanceManaged, true);
  assert.deepEqual(result.rows.map((row) => row.driver.id), [20]);
  assert.equal(result.rows[0].isReserve, true); assert.equal(result.rows[0].assignedTeam.id, 7);
});
