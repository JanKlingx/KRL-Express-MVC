const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const render = (name, data) => ejs.renderFile(path.join(root, 'views/partials', name + '.ejs'), data);
function script(dom, file) { dom.window.eval(fs.readFileSync(path.join(root, 'public/js', file), 'utf8')); dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded')); }
test('Saisonverlauf trennt Sprint und GP und stellt Gesamt vor Abstand dar', async t => {
  const html = await render('season-history', {
    league: { slug: 'sonntag' }, history: { seasons: [{}] }, isAdmin: false,
    selectedHistory: { name: 'Saison', races: [{ round: 1, title: 'BRA', isCompleted: true }, { round: 2, title: 'USA', countryCode: 'USA', hasSprint: true, isCompleted: true }], drivers: [
      { position: 1, name: 'Lemi', total: 48, gap: 0, results: [{ main: { position: 1, points: 26, polePosition: true } }, { sprint: { position: 3, points: 6 }, main: { position: 2, points: 16, fastestLap: true } }] }
    ] }
  });
  const dom = new JSDOM(html); t.after(() => dom.window.close()); const d = dom.window.document;
  const cells = d.querySelectorAll('td.sheet-result'); assert.equal(cells.length, 3);
  assert.deepEqual([...cells].map(cell => cell.dataset.raceType), ['main', 'sprint', 'main']);
  assert.deepEqual([...cells].map(cell => cell.querySelector('.sheet-result-value').textContent.trim()), ['26', '6', '16']);
  assert.equal(d.querySelector('.sheet-total').textContent.trim(), '48');
  const heads = [...d.querySelectorAll('thead th')].map(th => th.textContent.trim()); assert.equal(heads[heads.indexOf('Gesamt') + 1], 'Abstand');
  assert.equal(cells[1].querySelectorAll('.race-award').length, 0);
  assert.equal(cells[0].querySelectorAll('.sheet-result-awards').length, cells[1].querySelectorAll('.sheet-result-awards').length);
});
test('GP startet beim neuesten vorhandenen Ergebnis; Dropdown und Navigation bleiben synchron', async t => {
  const entry = { driverName: 'Fahrer', position: 1, points: 25 };
  const html = await render('gp-results', { label: 'GP', items: [
    { title: 'R2 Sprint', sortOrder: 2, raceType: 'sprint', raceDate: '2026-09-12', entries: [entry] },
    { title: 'R1', sortOrder: 1, raceType: 'main', raceDate: '2026-09-05', entries: [entry] },
    { title: 'R2 GP', sortOrder: 2, raceType: 'main', raceDate: '2026-09-12', entries: [entry] },
    { title: 'R3 offen', sortOrder: 3, raceDate: '2026-09-19', entries: [] }
  ] });
  const dom = new JSDOM(html, { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  script(dom, 'app.js'); const d = dom.window.document;
  assert.match(d.querySelector('.carousel-slide.active').dataset.slideLabel, /R2 GP/);
  const select = d.querySelector('.carousel-jump select'); assert.equal(select.value, '2');
  d.querySelector('.prev').click(); assert.equal(select.value, '1');
  select.value = '0'; select.dispatchEvent(new dom.window.Event('change')); assert.match(d.querySelector('.carousel-slide.active').dataset.slideLabel, /Sprint/);
});
test('Suche ordnet direkt ein, tauscht belegte Plätze und folgt der aktiven Session', t => {
  const rows = [1, 2].map(id => `<div data-result-driver="${id}" data-driver-name="Fahrer ${id}"><input data-result-position="main" value="${id}"><input data-result-position="sprint" value="${id}"><select data-result-status><option value=""></option></select></div>`).join('');
  const dom = new JSDOM(`<form data-result-race-control><div data-result-control-mount></div><script type="application/json" data-result-control-points>{"pointsMode":"database","hasSprint":true}</script><div class="lineup-team-grid">${rows}</div></form>`, { runScripts: 'outside-only' }); t.after(() => dom.window.close()); script(dom, 'f1-result-control.js'); const d = dom.window.document;
  const search = d.querySelector('[data-result-search]'); search.value = 'Fahrer 2'; search.dispatchEvent(new dom.window.Event('input'));
  const choose = value => { const select = d.querySelector('[data-search-position]'); select.value = value; select.dispatchEvent(new dom.window.Event('change')); };
  choose('1'); assert.deepEqual([...d.querySelectorAll('[data-result-position="main"]')].map(i => i.value), ['2', '1']);
  d.querySelectorAll('.result-control-tabs button')[1].click(); assert.equal(d.querySelector('[data-search-position]').value, '2');
  choose(''); assert.equal(d.querySelector('[data-result-driver="2"] [data-result-position="sprint"]').value, '');
  assert.equal(d.querySelector('[data-result-driver="2"] [data-result-position="main"]').value, '1');
  search.value = 'xyz'; search.dispatchEvent(new dom.window.Event('input')); assert.match(d.querySelector('[data-result-search-matches]').textContent, /Kein Fahrer/);
});
test('Manuelle Punkte lassen sich aus dem Suchtreffer in das Originalfeld übernehmen', t => {
  const dom = new JSDOM('<form data-result-race-control><div data-result-control-mount></div><script data-result-control-points type="application/json">{"pointsMode":"manual"}</script><div data-result-driver="1" data-driver-name="Lemi"><input type="number" name="rows[d1][points]" value="20"></div></form>', { runScripts: 'outside-only' }); t.after(() => dom.window.close()); script(dom, 'f1-result-control.js'); const d = dom.window.document;
  const search = d.querySelector('[data-result-search]'); search.value = 'Lemi'; search.dispatchEvent(new dom.window.Event('input'));
  const field = d.querySelector('.result-search-hit input'); field.value = '26'; field.dispatchEvent(new dom.window.Event('input'));
  assert.equal(d.querySelector('[data-result-driver] input').value, '26'); assert.equal(field.hasAttribute('name'), false);
});
