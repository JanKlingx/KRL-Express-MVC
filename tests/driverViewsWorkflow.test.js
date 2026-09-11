const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const { applyDriverViews } = require('../services/driverViews');
const { weekendProgress, resetWeekendStep, lockLineup } = require('../services/weekendWorkflow');
const { parseBerlinDateTime } = require('../services/calendarTime');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const config = require('../services/resourceConfig');
const root = path.join(__dirname, '..');
const layout = { title: 'Test', currentPath: '/admin', isAdmin: true, flash: null };
const regular = (id, overrides = {}) => ({ id, DriverId: id, roleType: 'regular', status: 'anwesend', attendanceStatus: 'anwesend', includeInResults: true, driver: { id, name: 'Fahrer ' + id }, ...overrides });

async function domFor(html, script) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost' });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  dom.window.eval(fs.readFileSync(path.join(root, 'public/js', script), 'utf8'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}

test('Sichtenpflege bewahrt nicht ausgewählte LMU-Angaben und validiert Sichten', () => {
  const values = { lmuDisplayName: null, roleLmuRegular: false, roleF1Reserve: true };
  applyDriverViews(values, { driverViews: ['f1'] }, { lmuDisplayName: 'LMU Name', roleLmuRegular: true, viewLmu: true });
  assert.equal(values.lmuDisplayName, 'LMU Name'); assert.equal(values.roleLmuRegular, true);
  assert.equal(values.viewF1, true); assert.equal(values.viewLmu, true);
  const fresh = {}; applyDriverViews(fresh, { driverViews: ['formerF1'] });
  assert.equal(Boolean(fresh.roleFormerF1), false); assert.equal(fresh.viewLmu, false);
  assert.throws(() => applyDriverViews({}, { driverViews: [] }), /Sicht/);
  assert.throws(() => applyDriverViews({}, { driverViews: ['invented'] }), /Sicht/);
});

test('Schritte werden erst nach vollständiger Anwesenheit freigeschaltet', () => {
  assert.equal(weekendProgress([]).lineupComplete, false);
  assert.equal(weekendProgress([regular(1), regular(2, { attendanceStatus: null, includeInResults: false })]).attendanceComplete, false);
  const absent = regular(1, { status: 'abgemeldet', attendanceStatus: 'abgemeldet', includeInResults: false });
  const reserve = { ...regular(3), roleType: 'reserve', ReplacementForDriverId: 1, status: 'unsicher', attendanceStatus: null, includeInResults: false };
  assert.equal(weekendProgress([absent, reserve]).attendanceComplete, false);
  Object.assign(reserve, { attendanceStatus: 'anwesend', includeInResults: true, uncertainPresent: true, respondedInTime: false });
  assert.equal(weekendProgress([absent, reserve]).attendanceComplete, true);
  assert.equal(weekendProgress([regular(1), reserve]).validSeats, false);
  assert.equal(weekendProgress([regular(1), regular(2)]).attendanceComplete, true);
  assert.equal(weekendProgress([regular(1, { status: 'rennsperre', attendanceStatus: null, includeInResults: false })]).attendanceComplete, true);
});

test('Terminparser berücksichtigt Sommer-/Winterzeit und lehnt nicht existierende Termine ab', () => {
  assert.equal(parseBerlinDateTime('2026-09-10T20:00').toISOString(), '2026-09-10T18:00:00.000Z');
  assert.equal(parseBerlinDateTime('2026-12-10T20:00').toISOString(), '2026-12-10T19:00:00.000Z');
  assert.throws(() => parseBerlinDateTime('2026-03-29T02:30'), /existiert nicht/);
  assert.throws(() => parseBerlinDateTime('2026-02-30T20:00'), /existiert nicht/);
});

test('Reset löscht Haupt- und Sprintergebnis und nur die abhängigen Aufstellungsdaten', async () => {
  const calls = [];
  const originals = [models.GrandPrixResult.findAll, models.GrandPrixResultEntry.destroy, models.F1RaceLineupEntry.update, models.F1RaceLineupEntry.destroy];
  models.GrandPrixResult.findAll = async ({ where }) => { assert.equal(where.SeasonId, 2); assert.equal(where.LeagueId, 3); assert.equal(where.sortOrder, 4); return [{ id: 10 }, { id: 11 }]; };
  models.GrandPrixResultEntry.destroy = async (args) => { calls.push(['results', args]); };
  models.F1RaceLineupEntry.update = async (values, args) => { calls.push(['attendance', values, args]); };
  models.F1RaceLineupEntry.destroy = async (args) => { calls.push(['lineup', args]); };
  const race = { id: 10, SeasonId: 2, LeagueId: 3, sortOrder: 4 };
  try {
    await resetWeekendStep(race, 3, 'tx'); assert.deepEqual(calls.map(c => c[0]), ['results']);
    assert.deepEqual(calls[0][1].where.GrandPrixResultId[require('sequelize').Op.in], [10, 11]);
    calls.length = 0; await resetWeekendStep(race, 2, 'tx'); assert.deepEqual(calls.map(c => c[0]), ['results', 'attendance']);
    assert.equal(calls[1][1].includeInResults, false);
    calls.length = 0; await resetWeekendStep(race, 1, 'tx'); assert.deepEqual(calls.map(c => c[0]), ['results', 'lineup']);
  } finally { [models.GrandPrixResult.findAll, models.GrandPrixResultEntry.destroy, models.F1RaceLineupEntry.update, models.F1RaceLineupEntry.destroy] = originals; }
});

test('Zwischenzeitliche Änderungen werden vor dem Speichern abgewiesen', async () => {
  const old = [models.GrandPrixResult.findByPk, models.F1RaceLineupEntry.findAll];
  models.GrandPrixResult.findByPk = async () => ({});
  models.F1RaceLineupEntry.findAll = async () => [regular(1, { status: 'abgemeldet' })];
  try { await assert.rejects(() => lockLineup({ id: 10 }, [regular(1)], { LOCK: { UPDATE: 'UPDATE' } }), /zwischenzeitlich/); }
  finally { [models.GrandPrixResult.findByPk, models.F1RaceLineupEntry.findAll] = old; }
});

test('Fahrer-Wizard zeigt Name, Sichten, Ränge und nur ausgewählte Profilfelder', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/admin/resource-form.ejs'), {
    ...layout, resource: 'drivers', config: config.drivers, entry: null, error: null, duplicateDriver: null,
    fieldOptions: { PlatformId: [{ value: '1', label: 'PC' }] }, adminBasePath: '/admin', returnHref: '/admin/drivers'
  });
  const dom = await domFor(html, 'driver-wizard.js'); const d = dom.window.document;
  const next = () => [...d.querySelectorAll('button')].find(b => b.textContent === 'Weiter').click();
  try {
    assert.equal([...d.querySelectorAll('[data-driver-wizard] > fieldset')].filter(e => !e.hidden).length, 1);
    next(); assert.equal(d.querySelector('[data-driver-view-picker]').hidden, true);
    d.querySelector('[name=name]').value = 'Testfahrer'; next();
    assert.equal(d.querySelector('[data-driver-view-picker]').hidden, false);
    next(); assert.equal(d.querySelector('[data-view-error]').hidden, false);
    const f1 = d.querySelector('[name=driverViews][value=f1]'); f1.checked = true; f1.dispatchEvent(new dom.window.Event('change'));
    next(); assert.equal(d.querySelector('[name=roleF1Reserve]').disabled, false);
    assert.equal(d.querySelector('[name=lmuDisplayName]').disabled, true);
    d.querySelector('[name=roleF1Reserve]').checked = true; next();
    d.querySelector('[name=PlatformId]').value = '1';
    const data = new dom.window.FormData(d.querySelector('form'));
    assert.equal(data.get('PlatformId'), '1'); assert.equal(data.has('lmuDisplayName'), false);
    assert.equal(data.get('roleF1Reserve'), 'on');
  } finally { dom.window.close(); }
});

test('Plus/X im Ersatzpool und Status spät abgemeldet funktionieren ohne Entsperren bestätigter Zuordnungen', async () => {
  const team = { id: 1, name: 'Team', logoPath: '/team.png' };
  const html = await ejs.renderFile(path.join(root, 'views/admin/partials/f1-lineup-board.ejs'), {
    selectedRace: { id: 10 }, ...require('../services/raceLineup'),
    regularStatuses: require('../services/raceLineup').REGULAR_STATUSES, reserveStatuses: require('../services/raceLineup').RESERVE_STATUSES,
    teamCards: [{ team, rows: [{ driver: { id: 1, name: 'Stamm', platform: 'PC' }, team, status: 'zu_spaet_abgemeldet', replacementDriverId: null }] }],
    reserveRows: [{ driver: { id: 2, name: '<img src=x onerror=alert(1)>', platform: 'PC' }, status: 'anwesend', entry: null }]
  });
  const dom = await domFor(html, 'f1-race-lineup.js'); const d = dom.window.document;
  try {
    const select = d.querySelector('[data-add-reserve]'); const row = d.querySelector('[data-reserve-row]');
    assert.equal(row.hidden, true); d.querySelector('[data-open-reserve-picker]').click();
    assert.equal(d.querySelector('[data-reserve-picker]').hidden, false);
    select.value = '2'; select.dispatchEvent(new dom.window.Event('change'));
    assert.equal(row.hidden, false);
    const replacement = d.querySelector('[data-replacement-select]'); assert.equal(replacement.disabled, false);
    replacement.value = '2'; replacement.dispatchEvent(new dom.window.Event('change'));
    d.querySelector('[data-remove-reserve]').click(); assert.equal(row.hidden, true); assert.equal(replacement.value, '');
    assert.equal(new dom.window.FormData(d.querySelector('form')).has('reserve[d2][status]'), false);
    assert.equal(d.querySelector('[data-reserve-assignment] img'), null);
  } finally { dom.window.close(); }
});

test('Rennwochenenden-Template blendet spätere Schritte vollständig aus', async () => {
  const league = { id: 1, name: 'Freitag', slug: 'freitag' }, season = { id: 2, name: 'Saison' }, race = { id: 3, title: 'GP' };
  const locals = { ...layout, leagues: [league], league, seasons: [season], season, race, event: { id: 1 }, events: [], entries: [], attendanceRows: [], availableReplacements: [], attendanceStatuses: [], resultsHref: '/admin/current-season-progress', workflow: weekendProgress([]) };
  let html = await ejs.renderFile(path.join(root, 'views/admin/race-weekend.ejs'), locals);
  assert.match(html, /id="aufstellung"/); assert.doesNotMatch(html, /id="anwesenheit"|id="ergebnisse"/);
  locals.entries = [regular(1, { attendanceStatus: null, includeInResults: false })]; locals.workflow = weekendProgress(locals.entries);
  html = await ejs.renderFile(path.join(root, 'views/admin/race-weekend.ejs'), locals);
  assert.match(html, /id="anwesenheit"/); assert.doesNotMatch(html, /id="ergebnisse"/);
  locals.entries = [regular(1)]; locals.workflow = weekendProgress(locals.entries);
  html = await ejs.renderFile(path.join(root, 'views/admin/race-weekend.ejs'), locals);
  assert.match(html, /id="ergebnisse"/);
});

test('Bestätigte Ersatzzuordnung bleibt im Browser gesperrt', async () => {
  const team = { id: 1, name: 'Team', logoPath: '/team.png' };
  const html = await ejs.renderFile(path.join(root, 'views/admin/partials/f1-lineup-board.ejs'), {
    selectedRace: { id: 10 }, regularStatuses: require('../services/raceLineup').REGULAR_STATUSES, reserveStatuses: require('../services/raceLineup').RESERVE_STATUSES,
    teamCards: [{ team, rows: [{ driver: { id: 1, name: 'Stamm' }, team, status: 'abgemeldet', replacementDriverId: 2 }] }],
    reserveRows: [{ driver: { id: 2, name: 'Ersatz' }, status: 'anwesend', entry: { id: 20 }, isAttendanceLocked: true }]
  });
  const dom = await domFor(html, 'f1-race-lineup.js'); const d = dom.window.document;
  try {
    assert.equal(d.querySelector('[data-regular-status]').disabled, true);
    assert.equal(d.querySelector('[data-replacement-select]').disabled, true);
    assert.equal(new dom.window.FormData(d.querySelector('form')).get('regular[1][ReplacementDriverId]'), '2');
    assert.ok(d.querySelector('[data-remove-saved-reserve]'));
  } finally { dom.window.close(); }
});

test('Plattform-Dropdown übernimmt den zentralen Namen und bewahrt LMU-Sicht beim F1-Edit', async () => {
  const old = [models.Driver.findOne, models.Platform.findByPk];
  models.Driver.findOne = async () => null;
  models.Platform.findByPk = async (id) => id === 7 ? { id: 7, name: 'Xbox Series' } : null;
  try {
    const values = { name: 'Max', PlatformId: '7', roleF1Reserve: true, lmuDisplayName: null, roleLmuRegular: false };
    await config.drivers.prepareValues(values, { driverWizard: '1', driverViews: ['f1'] }, { id: 1, lmuDisplayName: 'LMU Max', roleLmuRegular: true, viewLmu: true });
    assert.equal(values.platform, 'Xbox Series'); assert.equal(values.lmuDisplayName, 'LMU Max'); assert.equal(values.roleLmuRegular, true);
    await assert.rejects(() => config.drivers.prepareValues({ name: 'Max', PlatformId: '999' }, { driverWizard: '1', driverViews: ['f1'] }), /Plattform/);
  } finally { [models.Driver.findOne, models.Platform.findByPk] = old; }
});

test('Einzeltermin aktualisiert nur eigenes Hauptrennen und Sprint in derselben Transaktion', async () => {
  const controller = require('../controllers/calendarEventController');
  const originals = [models.sequelize.transaction, models.RaceEvent.findByPk, models.F1Track.findByPk, models.GrandPrixResult.findByPk, models.GrandPrixResult.findOne, models.GrandPrixResultEntry.count, models.F1RaceLineupEntry.count];
  const changes = [];
  const record = (data) => ({ ...data, async update(values, { transaction }) { assert.equal(transaction, tx); changes.push([this.id, values]); Object.assign(this, values); } });
  const tx = { LOCK: { UPDATE: 'UPDATE' } };
  const event = record({ id: 5, SeasonId: 2, LeagueId: 3, GrandPrixResultId: 10, sortOrder: 4, isTestDay: false, startsAt: new Date('2026-09-10T18:00Z'), league: { type: 'f1', slug: 'freitag' }, seasonRecord: { name: 'Saison', status: 'active' } });
  const main = record({ id: 10, sortOrder: 4 }), sprint = record({ id: 11 });
  models.sequelize.transaction = async (fn) => fn(tx);
  models.RaceEvent.findByPk = async () => event;
  models.F1Track.findByPk = async () => ({ id: 20, name: 'Spa' });
  models.GrandPrixResult.findByPk = async (id) => { assert.equal(id, 10); return main; };
  models.GrandPrixResult.findOne = async ({ where }) => { assert.equal(where.SeasonId, 2); assert.equal(where.LeagueId, 3); assert.equal(where.sortOrder, 4); return sprint; };
  models.GrandPrixResultEntry.count = async () => 2; // date/name edits are allowed with existing results
  models.F1RaceLineupEntry.count = async () => 2;
  const req = { params: { eventId: 5 }, body: { title: 'Spa neu', F1TrackId: '20', localStart: '2026-09-12T21:00', durationMinutes: '', hasSprint: 'on', isPublished: 'on' }, session: {} };
  let redirect;
  try {
    await controller.update(req, { redirect(href) { redirect = href; } }, () => assert.fail('Event missing'));
    assert.equal(event.hasLocalOverride, true); assert.equal(event.startsAt.toISOString(), '2026-09-12T19:00:00.000Z');
    assert.equal(main.raceDate, '2026-09-12'); assert.equal(sprint.raceDate, '2026-09-12');
    assert.equal(main.title, 'Spa neu'); assert.equal(sprint.circuit, 'Spa');
    assert.ok(changes.every(([id]) => [5, 10, 11].includes(id)));
    assert.equal(redirect, '/f1/freitag?season=2#f1-calendar');
  } finally { [models.sequelize.transaction, models.RaceEvent.findByPk, models.F1Track.findByPk, models.GrandPrixResult.findByPk, models.GrandPrixResult.findOne, models.GrandPrixResultEntry.count, models.F1RaceLineupEntry.count] = originals; }
});

test('Neue Pflege- und Reset-Routen erfordern Admin-Anmeldung', async () => {
  const express = require('express'), request = require('supertest');
  const app = express(); app.use((req, res, next) => { req.session = {}; next(); });
  app.use('/admin', require('../routes/adminRoutes'));
  for (const url of ['/driver-edit', '/calendar-events/1/edit', '/platforms']) {
    const response = await request(app).get('/admin' + url); assert.equal(response.status, 302); assert.equal(response.headers.location, '/admin/login');
  }
  for (const url of ['/calendar-events/1', '/race-weekend/f1/1/reset-lineup', '/race-weekend/f1/1/reset-attendance', '/race-weekend/f1/1/reset-results', '/race-weekend/f1/1/reserves/2/remove']) {
    const response = await request(app).post('/admin' + url); assert.equal(response.status, 302); assert.equal(response.headers.location, '/admin/login');
  }
});

test('Zentrale Kalenderpflege überschreibt keine lokalen Terminänderungen', async () => {
  const { syncLinkedRaceEvents } = require('../services/f1Calendar');
  const old = [models.F1CalendarRound.findByPk, models.RaceEvent.findAll];
  models.F1CalendarRound.findByPk = async () => ({ id: 1 });
  models.RaceEvent.findAll = async () => [{ id: 3, hasLocalOverride: true, seasonRecord: { id: 2 }, league: { id: 4 } }];
  try { assert.deepEqual(await syncLinkedRaceEvents({ id: 1 }, 'tx'), { updated: 0, skippedCompleted: 1 }); }
  finally { [models.F1CalendarRound.findByPk, models.RaceEvent.findAll] = old; }
});
