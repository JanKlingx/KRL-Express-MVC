const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const { countries } = require('../services/resourceConfig');
const calendar = require('../controllers/calendarEventController');
const root = path.join(__dirname, '..');
async function domFor(html, script) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost' });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  dom.window.eval(fs.readFileSync(path.join(root, 'public/js', script), 'utf8'));
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}
test('Länderabkürzung ist optional und wird normalisiert; neue Spalten haben sichere Defaults', () => {
  const values = { abbreviation: ' esp ' }; countries.prepareValues(values); assert.equal(values.abbreviation, 'ESP');
  countries.prepareValues({}); const empty = { abbreviation: '' }; countries.prepareValues(empty); assert.equal(empty.abbreviation, null);
  assert.throws(() => countries.prepareValues({ abbreviation: '<ESP>' }), /abkürzung/i);
  assert.equal(models.Country.rawAttributes.abbreviation.allowNull, true);
  assert.equal(models.RaceEvent.rawAttributes.isCompleted.defaultValue, false);
});
test('Kalenderstatus ist explizit und wiederholbar, ohne Ergebnisse zu verändern', async (t) => {
  const event = { id: 1, SeasonId: 2, league: { type: 'f1', slug: 'sonntag' }, isCompleted: false, async update(values) { assert.deepEqual(Object.keys(values), ['isCompleted']); Object.assign(this, values); } };
  t.mock.method(models.sequelize, 'transaction', async (fn) => fn({ LOCK: { UPDATE: true } }));
  t.mock.method(models.RaceEvent, 'findByPk', async () => event);
  let redirect; const res = { redirect: (url) => { redirect = url; } };
  for (const completed of ['1', '1', '0']) {
    await calendar.setCompletion({ params: { eventId: 1 }, body: { completed }, session: {} }, res, () => assert.fail('missing event'));
    assert.equal(event.isCompleted, completed === '1');
  }
  assert.equal(redirect, '/f1/sonntag?season=2#f1-calendar');
});
test('Öffentlicher Kalender zeigt Gefahren, nur Admins können wieder öffnen', async () => {
  const locals = { league: {}, calendar: [{ id: 1, title: 'GP', startsAt: '2026-09-12', isCompleted: true }] };
  const publicHtml = await ejs.renderFile(path.join(root, 'views/partials/race-calendar.ejs'), { ...locals, isAdmin: false });
  assert.match(publicHtml, /✓ Gefahren/); assert.doesNotMatch(publicHtml, /name="completed"/);
  const adminHtml = await ejs.renderFile(path.join(root, 'views/partials/race-calendar.ejs'), { ...locals, isAdmin: true });
  assert.match(adminHtml, /name="completed" value="0"/); assert.match(adminHtml, /Wieder als offen markieren/);
});
test('Pole lässt sich ohne Pole-Bonuspunkte exklusiv einem Fahrer zuweisen', async (t) => {
  const rows = [1, 2].map((id) => `<div data-result-driver="${id}" data-driver-name="Fahrer ${id}"><input data-result-position="main" value="${id}"><input type="checkbox" data-result-pole="main"><input type="checkbox" data-result-fastest="main"><input type="checkbox" data-result-dotd="main"><select data-result-status><option value=""></option></select></div>`).join('');
  const html = `<form data-result-race-control><div data-result-control-mount></div><script type="application/json" data-result-control-points>${JSON.stringify({ pointsMode: 'database', polePositionEnabled: false, main: [{ position: 1, points: 25 }, { position: 2, points: 18 }] })}</script><div class="lineup-team-grid">${rows}</div></form>`;
  const dom = await domFor(html, 'f1-result-control.js'); t.after(() => dom.window.close()); const d = dom.window.document;
  const badge = d.querySelector('[data-bonus="pole"]'); assert.equal(badge.hidden, false);
  const drop = (id) => { const event = new dom.window.Event('drop', { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: { getData: (type) => type === 'application/x-result-bonus' ? 'pole' : '' } }); d.querySelector(`.result-control-driver[data-driver-id="${id}"]`).dispatchEvent(event); };
  drop(1); assert.equal(d.querySelector('[data-result-driver="1"] [data-result-pole]').checked, true);
  drop(2); assert.equal(d.querySelector('[data-result-driver="1"] [data-result-pole]').checked, false); assert.equal(d.querySelector('[data-result-driver="2"] [data-result-pole]').checked, true);
  assert.match(d.querySelector('[data-result-summary]').textContent, /43/);
});
for (const standings of [false, true]) test(`${standings ? 'WM' : 'GP'}-Dropdown und Pfeile bleiben synchron`, async (t) => {
  const html = standings
    ? '<div data-standings-history><article data-standings-slide data-slide-label="R1"></article><article data-standings-slide data-slide-label="R2" class="is-active"></article><button data-standings-prev></button><button data-standings-next></button></div>'
    : '<div data-carousel><article class="carousel-slide active" data-slide-label="R1"></article><article class="carousel-slide" data-slide-label="R2"></article><button class="prev"></button><button class="next"></button><div class="carousel-dots"></div></div>';
  const dom = await domFor(html, standings ? 'standings-history.js' : 'app.js'); t.after(() => dom.window.close()); const d = dom.window.document, select = d.querySelector('.carousel-jump select');
  assert.equal(select.value, standings ? '1' : '0');
  select.value = '0'; select.dispatchEvent(new dom.window.Event('change'));
  d.querySelector(standings ? '[data-standings-next]' : '.next').click(); assert.equal(select.value, '1');
  assert.equal(select.options[1].textContent, 'R2');
});

test('Pole-Auszeichnung verändert serverseitige Punkte nur bei aktiviertem Bonus', async (t) => {
  const { pointsForPosition } = require('../services/championship');
  const scheme = { id: 1, polePositionEnabled: false, polePositionPoints: 2 };
  t.mock.method(models.PointsScheme, 'findOne', async () => scheme);
  t.mock.method(models.PointAllocation, 'findOne', async () => ({ points: 25 }));
  assert.equal(await pointsForPosition(1, { PointsSchemeId: 1, polePosition: true }), 25);
  scheme.polePositionEnabled = true;
  assert.equal(await pointsForPosition(1, { PointsSchemeId: 1, polePosition: true }), 27);
});
