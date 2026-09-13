const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const { buildCareerStatistics } = require('../services/careerStatistics');
const { summarizeDriverEntries } = require('../services/driverStats');
const root = path.join(__dirname, '..');
const race = { discipline: 'f1', raceType: 'main', season: 'Saison 10', SeasonId: 10, LeagueId: 1, league: { name: 'Sonntag' } };
const result = (driver, points, extras = {}) => ({ DriverId: driver, position: 1, points, polePosition: true, fastestLap: true, driverOfTheDay: true, grandPrixResult: race, ...extras });
test('Karrieredaten trennen Ligen und Saisons, behalten Nullfahrer und geben nur Sportdaten aus', () => {
  const rows = buildCareerStatistics([{ id: 1, name: 'A', email: 'private' }, { id: 2, name: 'B' }], [result(1, 25), result(1, 10, { grandPrixResult: { ...race, LeagueId: 2, league: { name: 'Freitag' } } }), result(null, 20)]);
  assert.equal(rows[0].seasons.length, 2); assert.equal(rows[1].seasons.length, 0); assert.equal(rows[0].email, undefined);
  assert.equal(rows[0].seasons[0].poles, 1);
});
test('Auszeichnungen zählen aus Hauptrennen; Testtage nicht, Sprintpunkte schon, DNS kein Start', () => {
  const stats = summarizeDriverEntries([result(1, 25), result(1, 8, { grandPrixResult: { ...race, raceType: 'sprint' } }), result(1, 99, { grandPrixResult: { ...race, calendarEvent: { isTestDay: true } } }), result(1, 0, { position: null, status: 'DNS', polePosition: false, fastestLap: false, driverOfTheDay: false })]).f1;
  assert.equal(stats.points, 33); assert.equal(stats.starts, 1); assert.equal(stats.poles, 1); assert.equal(stats.fastestLaps, 1); assert.equal(stats.driverOfTheDays, 1);
});
test('Statistik-Suche, Vergleichslimit, Filter, beste Saison und Reset funktionieren', async t => {
  const drivers = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, name: `Fahrer ${i + 1}` }));
  const statistics = buildCareerStatistics(drivers, [result(1, 25), result(1, 40, { grandPrixResult: { ...race, season: 'Saison 11', SeasonId: 11 } }), result(2, 18)]);
  const html = await ejs.renderFile(path.join(root, 'views/statistics.ejs'), { title: 'Statistik', statistics });
  const dom = new JSDOM(html, { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  dom.window.eval(fs.readFileSync(path.join(root, 'public/js/career-statistics.js'), 'utf8'));
  const d = dom.window.document; const get = key => d.querySelector(`[data-career-${key}]`);
  assert.equal(d.querySelectorAll('.career-driver').length, 4); assert.match(d.querySelector('.career-best').textContent, /Saison 11/);
  for (let i = 0; i < 3; i++) d.querySelectorAll('.career-driver button')[i].click();
  assert.equal(d.querySelectorAll('.career-driver button')[3].disabled, true); assert.equal(get('comparison').querySelectorAll('thead th').length, 4);
  get('search').value = 'Fahrer 2'; get('search').dispatchEvent(new dom.window.Event('input')); assert.equal(d.querySelectorAll('.career-driver').length, 1);
  get('season').value = 'Saison 10'; get('season').dispatchEvent(new dom.window.Event('change')); assert.doesNotMatch(get('comparison').textContent, /65/);
  get('reset').click(); assert.equal(d.querySelectorAll('.career-driver').length, 4); assert.equal(get('comparison').querySelector('table'), null);
});
test('Fahrername kann kein Script in den Statistikdaten einschleusen', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/statistics.ejs'), { title: 'Statistik', statistics: [{ id: 1, name: '</script><script>bad()</script>', seasons: [] }] });
  assert.doesNotMatch(html, /<script>bad/);
});
test('Aufstellung zeigt nur Namen und verteilt zwei Reserven auf separate Spalten', async () => {
  const driver = id => ({ id, name: `Name ${id}`, status: 'anwesend', statusLabel: 'Anwesend', confirmed: true });
  const html = await ejs.renderFile(path.join(root, 'views/partials/public-weekend-lineup.ejs'), { publicWeekends: { currentIndex: 0, snapshots: [{ round: 1, title: 'GP', saved: true, reserves: [driver(3), driver(4)], teams: [{ name: 'Team', regulars: [driver(1), driver(2)], reserves: [driver(3), driver(4)] }] }] } });
  const d = new JSDOM(html).window.document;
  assert.equal(d.querySelectorAll('.public-lineup-table tbody td').length, 4);
  assert.equal(d.querySelector('[data-label="Ersatzfahrer 1"]').textContent.trim(), 'Name 3');
  assert.equal(d.querySelector('[data-label="Ersatzfahrer 2"]').textContent.trim(), 'Name 4');
  assert.doesNotMatch(html, /Start bestätigt/); assert.equal(d.querySelectorAll('.public-reserve-pool small').length, 0);
});
