const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const calendar = require('../controllers/f1CalendarController');
const groups = require('../controllers/teamGroupController');
const { syncCalendarSequence } = require('../services/f1Calendar');
const layout = { title: 'Test', isAdmin: true, currentPath: '/', flash: null };
async function page(view, data, script) {
  const html = await ejs.renderFile(view, data);
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  if (script) { dom.window.eval(fs.readFileSync(script, 'utf8')); dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded')); }
  return dom;
}
function record(data) { return { ...data, async update(values) { Object.assign(this, values); }, async destroy() { this.deleted = true; } }; }

test('Kalenderpfeile und Drag-and-drop ändern Reihenfolge und Nummern ohne Testtage mitzuzählen', async () => {
  const rounds = [{ id: 1 }, { id: 2, isTestDay: true }, { id: 3 }].map((row) => ({ F1TrackId: 1, ...row }));
  const dom = await page('views/admin/f1-calendars.ejs', { ...layout, selectedCalendar: { id: 1, name: 'Kalender', rounds }, calendars: [], tracks: [{ id: 1, name: 'Strecke' }], structureOpen: true }, 'public/js/calendar-structure.js');
  const d = dom.window.document;
  const last = d.querySelector('[data-round-id="3"]');
  last.querySelector('[data-move="up"]').click(); last.querySelector('[data-move="up"]').click();
  assert.deepEqual([...d.querySelectorAll('[name="roundIds"]')].map((input) => input.value), ['3', '1', '2']);
  assert.equal(last.querySelector('[data-round-number-field]').textContent, 'R1');
  assert.equal(d.querySelector('[data-round-id="2"] [data-round-number-field]').hidden, true);
  assert.equal(d.querySelector('input[name="roundNumber"]'), null);
  const handle = last.querySelector('[data-drag-handle]'); const transfer = { setData() {} };
  const start = new dom.window.Event('dragstart', { bubbles: true }); Object.defineProperty(start, 'dataTransfer', { value: transfer }); handle.dispatchEvent(start);
  const over = new dom.window.Event('dragover', { bubbles: true, cancelable: true }); Object.defineProperty(over, 'clientY', { value: 1 }); d.querySelector('[data-round-id="1"]').dispatchEvent(over);
  assert.deepEqual([...d.querySelectorAll('[name="roundIds"]')].map((input) => input.value), ['1', '3', '2']);
  dom.window.close();
});

test('Bearbeiten zeigt zuerst den Namen, erst danach die Kalenderstruktur', async () => {
  const dom = await page('views/admin/f1-calendars.ejs', { ...layout, selectedCalendar: { id: 1, name: 'Kalender', rounds: [] }, calendars: [], tracks: [], structureOpen: false });
  assert.ok(dom.window.document.querySelector('input[name="name"]'));
  assert.equal(dom.window.document.querySelector('[data-calendar-structure]'), null); dom.window.close();
});

test('Server nummeriert nach Reihenfolge und ignoriert manipulierte Rennnummern', async (t) => {
  const rows = [record({ id: 1, sortOrder: 1, roundNumber: 1 }), record({ id: 2, sortOrder: 2, roundNumber: null, isTestDay: true }), record({ id: 3, sortOrder: 3, roundNumber: 2 })];
  t.mock.method(models.sequelize, 'transaction', async (fn) => fn({ LOCK: { UPDATE: 'update' } }));
  t.mock.method(models.F1Calendar, 'findByPk', async () => ({ id: 1 }));
  t.mock.method(models.F1CalendarRound, 'findAll', async () => rows);
  t.mock.method(models.F1CalendarRound, 'findByPk', async (id) => rows.find((row) => row.id === id));
  t.mock.method(models.F1Track, 'findByPk', async () => ({ id: 1, name: 'Strecke' }));
  t.mock.method(models.RaceEvent, 'findAll', async () => []);
  const req = { params: { calendarId: 1 }, session: {}, body: { roundIds: ['3', '2', '1'], roundNumber: 999, rounds: { 1: { F1TrackId: 1, roundNumber: 999 }, 2: { F1TrackId: 1, isTestDay: 'on', hasSprint: 'on' }, 3: { F1TrackId: 1 } } } };
  await calendar.saveStructure(req, { redirect() {} });
  assert.equal(req.session.flash.type, 'success');
  assert.deepEqual(rows.map((row) => [row.sortOrder, row.roundNumber]), [[3, 2], [2, null], [1, 1]]);
  assert.equal(rows[1].hasSprint, false);
});

test('Unser Team zeigt Bearbeitungskästen nur im Bearbeitungsmodus und speichert Pfeilreihenfolge', async () => {
  const data = { ...layout, krlTeams: [{ id: 1, name: 'Administration', assignments: [] }, { id: 2, name: 'Ligaleitung', assignments: [{ id: 7, DriverId: 3, driver: { id: 3, name: 'Jan' }, roleName: 'Leitung', description: '<script>unsafe</script>' }] }], teamDrivers: [{ id: 3, name: 'Jan' }], teamEditing: false };
  let dom = await page('views/partials/home-team.ejs', data);
  assert.equal(dom.window.document.querySelector('form'), null);
  assert.equal(dom.window.document.querySelector('script'), null);
  assert.match(dom.window.document.querySelector('.team-member-description').textContent, /<script>/); dom.window.close();
  dom = await page('views/partials/home-team.ejs', { ...data, teamEditing: true }, 'public/js/team-editor.js');
  const d = dom.window.document; assert.equal(d.querySelectorAll('.team-add-member').length, 2);
  assert.ok(d.querySelector('form[action="/admin/team-groups/2/members/7"] input[type="file"]'));
  d.querySelector('[data-group-id="2"] [data-group-move="up"]').click();
  assert.deepEqual([...d.querySelectorAll('[name="groupIds"]')].map((input) => input.value), ['2', '1']);
  assert.equal(d.querySelector('[name="version"]').value, '1,2'); dom.window.close();
});

test('Gruppenreihenfolge wird persistent gespeichert; veraltete Reihenfolge wird abgewiesen', async (t) => {
  const rows = [record({ id: 1 }), record({ id: 2 })];
  t.mock.method(models.sequelize, 'transaction', async (fn) => fn({ LOCK: { UPDATE: 'update' } }));
  t.mock.method(models.KrlTeam, 'findAll', async () => rows);
  const req = { session: {}, body: { version: '1,2', groupIds: ['2', '1'] } };
  await groups.reorder(req, { redirect() {} }); assert.equal(req.session.flash.type, 'success'); assert.deepEqual(rows.map((row) => row.sortOrder), [1, 0]);
  req.body.version = '2,1'; await groups.reorder(req, { redirect() {} }); assert.equal(req.session.flash.type, 'error');
});

test('Mitglied bearbeiten erhält Fahrerzuordnung; Entfernen löscht nur diese Gruppenzuordnung', async (t) => {
  const member = record({ id: 7, KrlTeamId: 2, DriverId: 3, imagePath: '/uploads/existing.png' });
  t.mock.method(models.sequelize, 'transaction', async (fn) => fn({ LOCK: { UPDATE: 'update' } }));
  t.mock.method(models.KrlTeam, 'findByPk', async () => ({ id: 2 }));
  t.mock.method(models.KrlTeamAssignment, 'findByPk', async () => member);
  t.mock.method(models.Driver, 'findByPk', async (id) => { assert.equal(id, 3); return { id }; });
  const req = { session: {}, params: { id: 2, memberId: 7 }, body: { DriverId: 999, roleName: 'Leitung', description: 'Organisiert Rennen' } };
  await groups.saveMember(req, { redirect() {} }); assert.equal(req.session.flash.type, 'success'); assert.equal(member.DriverId, 3); assert.equal(member.imagePath, '/uploads/existing.png'); assert.equal(member.description, 'Organisiert Rennen');
  req.params.id = 8; await groups.removeMember(req, { redirect() {} }); assert.equal(req.session.flash.type, 'error'); assert.equal(member.deleted, undefined);
  req.params.id = 2; await groups.removeMember(req, { redirect() {} }); assert.equal(member.deleted, true);
});

test('Kalendertausch erhält Haupt-/Sprintidentitäten auch bei mehrfach derselben Strecke', async (t) => {
  const season = { id: 1, status: 'active', isPublished: true }; const league = { id: 2, raceTime: '20:00' };
  const rounds = [record({ id: 1, roundNumber: 2, sortOrder: 2, track: { name: 'Melbourne', country: 'Australien' }, F1TrackId: 5, hasSprint: true }), record({ id: 2, roundNumber: 1, sortOrder: 1, track: { name: 'Melbourne', country: 'Australien' }, F1TrackId: 5, hasSprint: true })];
  const events = [record({ id: 1, F1CalendarRoundId: 1, GrandPrixResultId: 11, sortOrder: 1, circuit: 'Melbourne', startsAt: new Date('2026-09-13T18:00Z'), seasonRecord: season, league }), record({ id: 2, F1CalendarRoundId: 2, GrandPrixResultId: 21, sortOrder: 2, circuit: 'Melbourne', startsAt: new Date('2026-09-20T18:00Z'), seasonRecord: season, league })];
  const results = [record({ id: 11, sortOrder: 1, raceType: 'main' }), record({ id: 12, sortOrder: 1, raceType: 'sprint' }), record({ id: 21, sortOrder: 2, raceType: 'main' }), record({ id: 22, sortOrder: 2, raceType: 'sprint' })];
  t.mock.method(models.F1CalendarRound, 'findByPk', async (id) => rounds.find((row) => row.id === id));
  t.mock.method(models.RaceEvent, 'findAll', async ({ where }) => events.filter((event) => event.F1CalendarRoundId === where.F1CalendarRoundId));
  t.mock.method(models.GrandPrixResult, 'findByPk', async (id) => results.find((result) => result.id === id));
  t.mock.method(models.GrandPrixResult, 'findAll', async ({ where }) => results.filter((result) => result.sortOrder === where.sortOrder && (typeof where.raceType !== 'string' || result.raceType === where.raceType)));
  t.mock.method(models.GrandPrixResultEntry, 'count', async () => 0);
  await syncCalendarSequence(rounds, {});
  assert.deepEqual(results.map((row) => [row.id, row.sortOrder]), [[11, 2], [12, 2], [21, 1], [22, 1]]);
  assert.deepEqual(events.map((row) => row.GrandPrixResultId), [11, 21]);
});

test('Gewertete Kalender werden vor jeder Umnummerierung geschützt', async (t) => {
  const { protectCompleted } = require('../services/calendarOrder');
  t.mock.method(models.RaceEvent, 'findAll', async () => [{ SeasonId: 1, LeagueId: 2, sortOrder: 1, GrandPrixResultId: 11 }]);
  t.mock.method(models.GrandPrixResult, 'findAll', async () => [{ id: 11 }]);
  t.mock.method(models.GrandPrixResultEntry, 'count', async () => 1);
  await assert.rejects(() => protectCompleted([{ id: 1 }], {}), /gewertete Rennen/);
});
