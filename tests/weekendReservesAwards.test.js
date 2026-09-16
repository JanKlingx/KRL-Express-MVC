const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const { rolloverIds, suggestedReserves } = require('../services/reserveRollover');
const { submittedRaceAwards } = require('../services/raceAwards');
const { buildSeasonData } = require('../services/standings');
const { buildPublicWeekends } = require('../services/publicRaceWeekend');
const root = path.join(__dirname, '..');

test('Übernahme übernimmt nur zulässige Ersatzfahrer und berücksichtigt beendete Reservezeiträume', () => {
  const entries = [1, 2, 3, 4].map(DriverId => ({ DriverId, roleType: 'reserve', status: 'anwesend', includeInResults: true }));
  const candidates = [1, 2, 4].map(id => ({ id }));
  const periods = [{ DriverId: 2, fromRound: 1, toRound: 1 }, { DriverId: 4, fromRound: 1, toRound: null }];
  assert.deepEqual([...rolloverIds(entries, candidates, periods, 2)], [1, 4]);
});
test('Gespeicherte Aufstellung wird nicht ergänzt; neue Aufstellung benutzt letzte gespeicherte Saison/Liga', async t => {
  let calls = 0;
  t.mock.method(models.GrandPrixResult, 'findOne', async options => {
    calls++; assert.equal(options.where.SeasonId, 7); assert.equal(options.where.LeagueId, 2);
    assert.equal(options.include[0].required, true); return { lineupEntries: [{ DriverId: 4, roleType: 'reserve' }] };
  });
  t.mock.method(models.SeasonDriverStint, 'findAll', async () => []);
  const race = { SeasonId: 7, LeagueId: 2, sortOrder: 3 };
  assert.equal((await suggestedReserves(race, [{}], [{ id: 4 }])).size, 0); assert.equal(calls, 0);
  assert.deepEqual([...(await suggestedReserves(race, [], [{ id: 4 }]))], [4]);
});
test('DNA vor erster Anmeldung, DNS ab Anmeldung ohne Cockpit; geschlossene Reserve bleibt DNA', () => {
  const driver = { id: 9, name: 'Reserve' };
  const races = [1, 2, 3, 4].map(id => ({ id, sortOrder: id, SeasonId: 1, LeagueId: 2, title: `GP ${id}`, raceType: 'main', entries: [] }));
  const lineups = [{ DriverId: 9, GrandPrixResultId: 2, roleType: 'reserve', includeInResults: false, driver }];
  const stints = [{ DriverId: 9, roleType: 'reserve', fromRound: 1, toRound: 3, driver }];
  const data = buildSeasonData({ id: 2, slug: 'freitag' }, races, [], lineups, {}, stints);
  assert.deepEqual(data.selectedHistory.reserveDrivers[0].results.map(result => result.status), ['DNA', 'DNS', 'DNS', 'DNA']);
});
test('Stammfahrer anderer Liga sind zulässig, nicht doppelt im eigenen Rennen', () => {
  const { reserveEligible } = require('../services/f1DriverPolicy');
  const { selectWeekendReserves } = require('../services/raceLineup');
  assert.equal(reserveEligible({ roleF1Sunday: true }, false), true);
  assert.equal(reserveEligible({ roleFormerF1: true }, false), false);
  assert.throws(() => selectWeekendReserves([{ id: 2, roleF1Sunday: true }], [], { d1: {} }), /Stammcockpit/);
});
test('Sprint ignoriert auch manipulierte Auszeichnungen, Hauptrennen speichert alle drei', () => {
  const submitted = { fastestLap: 'on', polePosition: 'on', driverOfTheDay: 'on', sprintFastestLap: 'on', sprintPolePosition: 'on' };
  const disabled = { fastestLap: false, polePosition: false, driverOfTheDay: false };
  assert.deepEqual(submittedRaceAwards({ raceType: 'sprint', pointsMode: 'database' }, submitted), disabled);
  assert.deepEqual(submittedRaceAwards({ raceType: 'main', pointsMode: 'database' }, submitted, 'sprint'), disabled);
  assert.deepEqual(submittedRaceAwards({ raceType: 'main', pointsMode: 'database' }, submitted), { fastestLap: true, polePosition: true, driverOfTheDay: true });
});
test('Fahrersuche zeigt editierbare Sprint-Treffer ohne Sprungbutton und ohne automatische Umplatzierung', t => {
  const rows = [1, 2].map(id => `<div data-result-driver="${id}" data-driver-name="Fahrer ${id}"><input data-result-position="main" value="${id}"><input data-result-position="sprint" value="${id}"><input type="checkbox" data-result-pole="main"><input type="checkbox" data-result-fastest="main"><input type="checkbox" data-result-dotd="main"><select data-result-status><option value=""></option></select></div>`).join('');
  const config = { hasSprint: true, pointsMode: 'database', main: [], sprint: [], fastestLapEnabled: false };
  const dom = new JSDOM(`<form data-result-race-control><div data-result-control-mount></div><script data-result-control-points type="application/json">${JSON.stringify(config)}</script><div class="lineup-team-grid">${rows}</div></form>`, { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  dom.window.eval(fs.readFileSync(path.join(root, 'public/js/f1-result-control.js'), 'utf8'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const d = dom.window.document;
  assert.equal(d.querySelectorAll('[data-result-board="main"] [data-bonus]').length, 3);
  assert.equal(d.querySelectorAll('[data-result-board="sprint"] [data-bonus]').length, 0);
  const tabs = d.querySelectorAll('.result-control-tabs button'); tabs[1].click(); assert.equal(tabs[1].getAttribute('aria-pressed'), 'true');
  const search = d.querySelector('[data-result-search]'); search.value = 'Fahrer 2'; search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(d.querySelector('.result-search-hit button'), null);
  assert.ok(d.querySelector('.result-search-hit select'));
  assert.deepEqual([...d.querySelectorAll('[data-result-position="sprint"]')].map(input => input.value), ['1', '2']);
});
test('GP und Saisonverlauf zeigen die Auszeichnungen mit Legende nur beim Hauptrennen', async () => {
  const entry = { DriverId: 1, driverName: 'Fahrer', position: 5, points: 10, status: 'DNF', fastestLap: true, polePosition: true, driverOfTheDay: true };
  const items = ['main', 'sprint'].map((raceType, i) => ({ id: i + 1, title: 'GP', raceType, sortOrder: 1, entries: [entry] }));
  const html = await ejs.renderFile(path.join(root, 'views/partials/gp-results.ejs'), { items, label: 'GP' });
  const d = new JSDOM(html).window.document;
  assert.equal(d.querySelectorAll('.gp-broadcast-row .race-award').length, 3);
  assert.equal(d.querySelector('.race-status-chip').textContent.trim(), 'DNF');
  assert.match(d.querySelector('.race-result-legend').textContent, /Nicht ins Ziel/);
  const data = buildSeasonData({ slug: 'freitag' }, [items[0]], [{ id: 1, name: 'Fahrer' }]);
  const historyHtml = await ejs.renderFile(path.join(root, 'views/partials/season-history.ejs'), { league: { slug: 'freitag' }, isAdmin: false, history: { seasons: [{}] }, selectedHistory: data.selectedHistory });
  const history = new JSDOM(historyHtml).window.document;
  assert.equal(history.querySelectorAll('.sheet-result .race-award').length, 3);
  assert.equal(history.querySelectorAll('.sheet-result .season-race-position-1').length, 0);
});
test('Interne Rückmeldestatus werden öffentlich als bekannte Abmeldestatus dargestellt', () => {
  const board = buildPublicWeekends({ races: [{ id: 1, sortOrder: 1, raceType: 'main' }], entries: ['rueckmeldung_unsicher', 'fehlende_rueckmeldung_unsicher'].map((attendanceStatus, i) => ({ GrandPrixResultId: 1, DriverId: i + 1, roleType: 'reserve', attendanceStatus, driver: { name: 'Fahrer' } })) });
  assert.deepEqual(board.snapshots[0].reserves.map(row => row.status), ['abgemeldet', 'unabgemeldet']);
});
