const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const express = require('express');
const request = require('supertest');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const { buildSeasonData } = require('../services/standings');
const { weekendProgress } = require('../services/weekendWorkflow');
const controller = require('../controllers/raceWeekendController');
const root = path.join(__dirname, '..');
async function browser(html, script) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/admin' });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  dom.window.eval(fs.readFileSync(path.join(root, 'public/js', script), 'utf8'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}
function entry(id, values) { return { id, DriverId: id, status: 'anwesend', attendanceStatus: null, includeInResults: false, driver: { id, name: 'Fahrer ' + id }, ...values, async update(v) { Object.assign(this, v); } }; }
async function attendancePage(entries) {
  const league = { id: 1, name: 'Freitag', slug: 'freitag' }, season = { id: 2, name: 'Saison' }, race = { id: 3, title: 'GP' };
  return ejs.renderFile(path.join(root, 'views/admin/race-weekend.ejs'), {
    title: 'Test', currentPath: '/admin', isAdmin: true, flash: null,
    leagues: [league], league, seasons: [season], season, race, event: { id: 1 }, events: [], entries,
    attendanceRows: entries.filter((e) => e.roleType === 'regular').map((regular) => ({ entry: regular, regular, displayTeam: { name: 'Team' }, plannedReplacement: entries.find((e) => e.ReplacementForDriverId === regular.DriverId) })),
    availableReplacements: [], attendanceStatuses: [], resultsHref: '/', workflow: weekendProgress(entries)
  });
}

test('Anwesender Ersatzfahrer sendet genau einen Status und wird vom Controller akzeptiert', async (t) => {
  const entries = [entry(2, { roleType: 'regular', status: 'abgemeldet', TeamId: 7 }), entry(7, { roleType: 'reserve', ReplacementForDriverId: 2, TeamId: 7 })];
  const dom = await browser(await attendancePage(entries), 'f1-race-control.js');
  t.after(() => dom.window.close());
  const form = dom.window.document.querySelector('[data-f1-attendance]');
  const data = new dom.window.FormData(form);
  assert.deepEqual(data.getAll('attendance[d7][status]'), ['anwesend']);
  assert.equal(data.has('attendance[d2][status]'), false);
  const race = { id: 3, SeasonId: 2, LeagueId: 1, sortOrder: 1, discipline: 'f1', seasonRecord: { status: 'active' } };
  t.mock.method(models.GrandPrixResult, 'findByPk', async () => race);
  t.mock.method(models.F1RaceLineupEntry, 'findAll', async () => entries);
  t.mock.method(models.sequelize, 'transaction', async (fn) => fn({ LOCK: { UPDATE: 'update' } }));
  t.mock.method(models.GrandPrixResult, 'findAll', async () => []);
  t.mock.method(models.GrandPrixResultEntry, 'destroy', async () => 0);
  const session = {}; const app = express(); app.use(express.urlencoded({ extended: true }));
  app.post('/', (req, res, next) => { req.session = session; req.params = { raceId: 3 }; controller.saveAttendance(req, res).catch(next); });
  await request(app).post('/').type('form').send(new URLSearchParams([...data]).toString()).expect(302);
  assert.equal(session.flash.type, 'success', session.flash.message);
  assert.equal(entries[1].attendanceStatus, 'anwesend'); assert.equal(entries[1].includeInResults, true);
  assert.equal(entries[0].includeInResults, false);
});

test('Unsichere Fahrer: Ja/Nein/Ja sendet nur sichtbare Alternative; versteckter Ersatz bleibt deaktiviert', async (t) => {
  const entries = [entry(2, { roleType: 'regular', status: 'unsicher' }), entry(7, { roleType: 'reserve', status: 'unsicher', ReplacementForDriverId: 2 })];
  const dom = await browser(await attendancePage(entries), 'f1-race-control.js'); t.after(() => dom.window.close());
  const d = dom.window.document, form = d.querySelector('[data-f1-attendance]');
  function choose(id, value) { const radio = form.querySelector(`input[name="uncertain[d${id}][present]"][value="${value}"]`); radio.checked = true; radio.dispatchEvent(new dom.window.Event('change')); }
  choose(2, 'no'); choose(7, 'yes');
  let data = new dom.window.FormData(form);
  assert.deepEqual(data.getAll('attendance[d2][status]'), ['unabgemeldet']);
  assert.deepEqual(data.getAll('attendance[d7][status]'), ['anwesend']);
  choose(2, 'yes'); data = new dom.window.FormData(form);
  assert.deepEqual(data.getAll('attendance[d2][status]'), ['anwesend']); assert.equal(data.has('attendance[d7][status]'), false);
  assert.equal(data.has('uncertain[d7][present]'), false);
});

test('Schritt 1 lässt sich auch vor dem ersten Speichern zurücksetzen', async () => {
  assert.match(await attendancePage([]), /action="\/admin\/race-weekend\/f1\/3\/reset-lineup"/);
});

test('Zähler behalten gefilterte Fahrer und zählen aktuelle sowie historische Teams gemeinsam', async (t) => {
  const html = '<div data-season-wizard data-current-step="1" data-available-step="1"><section data-setup-step="1"><form><input data-driver-search><output data-selection-count="driverIds"></output><label class="setup-driver-card">Anna<input type="checkbox" name="driverIds" checked></label><label class="setup-driver-card">Ben<input type="checkbox" name="driverIds"></label></form><form><output data-selection-count="teamTokens"></output><input type="checkbox" name="teamTokens" value="current:1" checked><input type="checkbox" name="teamTokens" value="historical:1"></form></section></div>';
  const dom = await browser(html, 'season-wizard.js'); t.after(() => dom.window.close()); const d = dom.window.document;
  const search = d.querySelector('[data-driver-search]'); search.value = 'Ben'; search.dispatchEvent(new dom.window.Event('input'));
  assert.match(d.querySelector('[data-selection-count="driverIds"]').textContent, /^1 /);
  d.querySelectorAll('[name=driverIds]')[1].click(); assert.match(d.querySelector('[data-selection-count="driverIds"]').textContent, /^2 /);
  d.querySelectorAll('[name=teamTokens]')[1].click(); assert.match(d.querySelector('[data-selection-count="teamTokens"]').textContent, /^2 /);
});

test('Anerkanntes R3 zählt vor Stammstart R4 inklusive Sprint; R1/R2 bleiben DNA und Team-Punkte unverändert', () => {
  const team = { id: 10, name: 'Mercedes', sourceType: 'current', sourceId: 100 };
  const driver = { id: 7, name: 'Ersatz', team };
  const races = [1, 2, 3, 4].map((round) => ({ id: round, SeasonId: 1, LeagueId: 1, sortOrder: round, raceType: 'main', title: 'GP ' + round, entries: round < 3 ? [] : [{ DriverId: 7, TeamId: 100, teamName: 'Mercedes', driverName: 'Ersatz', points: 10, position: 5 }] }));
  races.push({ id: 30, SeasonId: 1, LeagueId: 1, sortOrder: 3, raceType: 'sprint', title: 'Sprint 3', entries: [{ DriverId: 7, TeamId: 100, teamName: 'Mercedes', driverName: 'Ersatz', points: 3, position: 6 }] });
  const lineups = [{ GrandPrixResultId: 3, DriverId: 7, roleType: 'reserve', includeInResults: true, ReplacementForDriverId: 9, driver }];
  const stints = [{ id: 1, DriverId: 7, roleType: 'reserve', fromRound: 3, toRound: 3, driver }, { id: 2, DriverId: 7, SeasonTeamId: 10, roleType: 'regular', fromRound: 4, toRound: null, driver, seasonTeam: team, carryOvers: [] }];
  const calc = () => buildSeasonData({ id: 1, slug: 'sonntag' }, races, [driver], lineups, {}, stints);
  const before = calc(); assert.equal(before.driverStandings[0].points, 10);
  stints[1].carryOvers.push({ GrandPrixResultId: 3, DriverId: 7, SeasonTeamId: 10, selected: true });
  const after = calc(); assert.equal(after.driverStandings[0].points, 23);
  assert.deepEqual(after.selectedHistory.drivers[0].results.map((r) => r.main.value), ['DNA', 'DNA', 'P5', 'P5']);
  assert.equal(after.teamStandings[0].points, before.teamStandings[0].points);
  assert.equal(after.selectedHistory.drivers[0].results[2].sprint.points, 3);
  races[2].entries[0].points = 12; assert.equal(calc().driverStandings[0].points, 25);
  races[2].entries[0].TeamId = 200; assert.equal(calc().driverStandings[0].points, 10);
});
