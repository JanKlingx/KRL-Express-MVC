const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const { sessionResultStatus } = require('../services/resultStatus');
const { buildSeasonData } = require('../services/standings');
const root = path.join(__dirname, '..');
test('Server liest Status je Session und erhält bei alten Formularen den separaten Sprintstatus', () => {
  const body = { status: '', sprintStatus: 'DNF' };
  assert.equal(sessionResultStatus(body, { status: 'DSQ' }, 'main'), '');
  assert.equal(sessionResultStatus(body, {}, 'sprint'), 'DNF');
  assert.equal(sessionResultStatus({ status: 'DSQ' }, { status: 'DNF' }, 'sprint'), 'DNF');
  assert.equal(sessionResultStatus({ status: 'bad' }, {}, 'main'), '');
});
test('Sprint-DSQ ändert weder GP-Status noch GP-Punktesumme; Suchfeld behält Fokus', t => {
  const dom = new JSDOM(`<form data-result-race-control><div data-result-control-mount></div><script data-result-control-points type="application/json">{"pointsMode":"database","hasSprint":true,"main":[{"position":1,"points":25}],"sprint":[{"position":1,"points":8}]}</script><div class="lineup-team-grid"><div data-result-driver="1" data-driver-name="Lemi"><input data-result-position="main" value="1"><input data-result-position="sprint" value="1"><select data-result-status data-result-status-race="main"><option value="">Gewertet</option><option>DNF</option><option>DSQ</option></select><select data-result-status data-result-status-race="sprint"><option value="">Gewertet</option><option>DNF</option><option>DSQ</option></select></div></div></form>`, { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  dom.window.eval(fs.readFileSync(path.join(root, 'public/js/f1-result-control.js'), 'utf8'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded')); const d = dom.window.document;
  d.querySelectorAll('.result-control-tabs button')[1].click();
  const search = d.querySelector('[data-result-search]'); search.value = 'lem'; search.dispatchEvent(new dom.window.Event('input'));
  const field = d.querySelector('[data-search-status]'); field.focus(); field.value = 'DSQ'; field.dispatchEvent(new dom.window.Event('change'));
  assert.equal(d.querySelector('[data-result-status-race="sprint"]').value, 'DSQ'); assert.equal(d.querySelector('[data-result-status-race="main"]').value, '');
  assert.equal(d.activeElement.dataset.searchStatus, '1');
  assert.match(d.querySelector('[data-result-board="main"] [data-result-summary]').textContent, /AKTUELL\s*25/);
  assert.match(d.querySelector('[data-result-board="sprint"] [data-result-summary]').textContent, /AKTUELL\s*0/);
  d.querySelector('[data-clear-result-search]').click(); assert.equal(search.value, ''); assert.equal(d.querySelector('[data-result-search-matches]').children.length, 0);
});
test('DNS rangiert bei Punktgleichheit vor DNA in Stamm-, Reservewertung und WM-Snapshot', () => {
  const dns = { id: 9, name: 'Z DNS' }, dna = { id: 1, name: 'A DNA' };
  const races = [{ id: 10, title: 'R1', raceType: 'main', sortOrder: 1, isCompleted: true, entries: [] }];
  const stints = [dns, dna].flatMap(driver => ['regular', 'reserve'].map(roleType => ({ DriverId: driver.id, driver, roleType, fromRound: driver.id === 9 ? 1 : 2, toRound: null })));
  const data = buildSeasonData({ slug: 'sonntag' }, races, [dns, dna], [{ DriverId: 9, driver: dns, GrandPrixResultId: 10, roleType: 'reserve', includeInResults: false }], {}, stints);
  assert.equal(data.selectedHistory.drivers[0].name, 'Z DNS');
  assert.equal(data.selectedHistory.reserveDrivers[0].name, 'Z DNS');
  assert.equal(data.driverStandings[0].driver.name, 'Z DNS');
});
test('Lange Saison erhält lückenlose schmale Blöcke mit höchstens sechs Ergebnisfeldern', async t => {
  const races = Array.from({ length: 8 }, (_, index) => ({ round: index + 1, title: 'GP', hasSprint: index === 3, isCompleted: true }));
  const html = await ejs.renderFile(path.join(root, 'views/partials/season-history.ejs'), { league: { slug: 'sonntag' }, history: { seasons: [{}] }, isAdmin: false, selectedHistory: { name: 'Saison', races, drivers: [{ position: 1, name: 'Lemi', total: 0, results: races.map(() => ({ main: { status: 'DNS' }, sprint: { status: 'DNS' } })) }] } });
  const dom = new JSDOM(html); t.after(() => dom.window.close()); const d = dom.window.document;
  assert.equal(d.querySelector('.sheet-wide').querySelectorAll('td.sheet-result').length, 9);
  const blocks = [...d.querySelectorAll('.sheet-narrow')]; assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map(block => block.querySelectorAll('td.sheet-result').length), [6, 3]);
});
