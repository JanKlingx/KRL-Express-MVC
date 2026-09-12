const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const { buildPublicWeekends, calendarEventForRace, isTestDayResult } = require('../services/publicRaceWeekend');
const { linkLegacyF1Events } = require('../services/legacyRaceLinks');
const root = path.join(__dirname, '..');
function fixture() {
  const teams = [{ id: 10, sourceId: 100, sourceType: 'current', name: 'McLaren', logoPath: '/mclaren.svg' }];
  const a = { id: 1, name: 'Stamm A', email: 'private@example.test' }, b = { id: 2, name: 'Stamm B' }, r = { id: 3, name: 'Reserve' };
  const races = [1, 2].map((id) => ({ id, SeasonId: 1, LeagueId: 1, raceType: 'main', sortOrder: id, title: 'GP ' + id, raceDate: `2026-09-${id === 1 ? '12' : '19'}` }));
  const stints = [a, b].map((driver) => ({ DriverId: driver.id, SeasonTeamId: 10, roleType: 'regular', fromRound: 1, toRound: null, driver }));
  const entries = [
    { GrandPrixResultId: 1, DriverId: 1, TeamId: 100, roleType: 'regular', status: 'abgemeldet', driver: a },
    { GrandPrixResultId: 1, DriverId: 2, TeamId: 100, roleType: 'regular', status: 'anwesend', attendanceStatus: 'zu_spaet_vorbesprechung', includeInResults: true, driver: b },
    { GrandPrixResultId: 1, DriverId: 3, TeamId: 100, roleType: 'reserve', status: 'auf_abruf', attendanceStatus: 'anwesend', includeInResults: true, ReplacementForDriverId: 1, driver: r }
  ];
  return { teams, races, entries, stints, now: new Date('2026-09-12T12:00:00Z') };
}
test('Testtag und GP auf derselben Strecke bleiben getrennt, einschließlich Sprint', () => {
  const races = [{ id: 10, title: 'Testtag · Belgien', raceType: 'main', sortOrder: 1, circuit: 'Spa', SeasonId: 1 }, { id: 11, title: 'GP', raceType: 'main', sortOrder: 1, circuit: 'Spa', SeasonId: 1 }, { id: 12, raceType: 'sprint', sortOrder: 1, circuit: 'Spa', SeasonId: 1 }];
  const events = [{ GrandPrixResultId: 10, isTestDay: true, sortOrder: 1, circuit: 'Spa' }, { GrandPrixResultId: 11, isTestDay: false, sortOrder: 1, circuit: 'Spa' }];
  assert.equal(isTestDayResult(races[0], events, races), true);
  assert.equal(isTestDayResult(races[1], events, races), false);
  assert.equal(calendarEventForRace(races[2], events, races).isTestDay, false);
  assert.equal(isTestDayResult({ ...races[1], id: 20 }, events, races), false);
  assert.equal(buildPublicWeekends({ races, calendar: events }).snapshots.length, 1);
});
test('Serverstart verknüpft reguläre Alttermine, erstellt aber niemals ein Testtag-Ergebnis', async () => {
  const updates = [], created = [];
  const events = [{ id: 1, isTestDay: true }, { id: 2, isTestDay: false }].map((row) => ({ ...row, LeagueId: 1, league: { currentSeason: 'Saison' }, title: row.isTestDay ? 'Testtag' : 'Rennen', async update(v) { updates.push([this.id, v]); } }));
  await linkLegacyF1Events({ RaceEvent: { findAll: async () => events }, League: {}, GrandPrixResult: { findOrCreate: async (values) => { created.push(values); return [{ id: 9 }]; } } });
  assert.equal(created.length, 1); assert.equal(created[0].defaults.title, 'Rennen'); assert.deepEqual(updates, [[2, { GrandPrixResultId: 9 }]]);
});
test('Öffentliche Einteilung zeigt gespeicherte Anwesenheit und Ersatzzuordnung ohne private Attribute', () => {
  const board = buildPublicWeekends(fixture());
  assert.equal(board.currentIndex, 0);
  const team = board.snapshots[0].teams[0];
  assert.equal(team.regulars[1].status, 'zu_spaet_vorbesprechung');
  assert.equal(team.reserves[0].name, 'Reserve'); assert.equal(team.reserves[0].replacesName, 'Stamm A');
  assert.equal(team.reserves[0].confirmed, true);
  assert.equal(JSON.stringify(board).includes('private@example.test'), false);
  assert.equal(board.snapshots[1].saved, false);
  assert.equal(board.snapshots[1].teams[0].regulars[0].status, 'offen');
  assert.equal(board.snapshots[1].reserves.length, 0);
});
test('Rennhistorie bleibt bei Fahrerwechseln und ligaübergreifenden Einsätzen rundenbezogen', () => {
  const data = fixture(); data.stints[0].toRound = 1;
  data.stints.push({ DriverId: 4, SeasonTeamId: 10, roleType: 'regular', fromRound: 2, driver: { id: 4, name: 'Neu' } });
  data.now = new Date('2026-09-13T10:00:00Z');
  const board = buildPublicWeekends(data);
  assert.equal(board.currentIndex, 1);
  assert.deepEqual(board.snapshots[0].teams[0].regulars.map((d) => d.id), [1, 2]);
  assert.deepEqual(board.snapshots[1].teams[0].regulars.map((d) => d.id), [2, 4]);
});
test('Öffentliches Karussell schaltet nur das ausgewählte Rennen sichtbar; Namen sind escaped', async () => {
  const data = fixture(); data.entries[0].driver.name = '<script>alert(1)</script>';
  const html = await ejs.renderFile(path.join(root, 'views/partials/public-weekend-lineup.ejs'), { publicWeekends: buildPublicWeekends(data) });
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>alert(1)'));
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost' });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  try {
    dom.window.eval(fs.readFileSync(path.join(root, 'public/js/public-weekend-lineup.js'), 'utf8'));
    const d = dom.window.document; d.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    assert.equal(d.querySelector('[data-weekend-prev]').disabled, true);
    d.querySelector('[data-weekend-next]').click();
    assert.equal(d.querySelector('[data-weekend-panel="0"]').hidden, true);
    assert.equal(d.querySelector('[data-weekend-panel="1"]').hidden, false);
    assert.equal(d.querySelector('[data-weekend-next]').disabled, true);
  } finally { dom.window.close(); }
});
test('Testtag-Kachel zeigt neben der Flagge nur das Land', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/partials/race-calendar.ejs'), { league: {}, calendar: [{ id: 1, isTestDay: true, title: 'Testtag · Belgien', startsAt: new Date('2026-09-12T12:00:00Z'), track: { countryRecord: { name: 'Belgien', flagPath: '/be.svg' } } }] });
  const dom = new JSDOM(html); assert.equal(dom.window.document.querySelector('h3').textContent.trim(), 'Belgien'); dom.window.close();
});

test('Schritt 3 öffnet Ergebnispflege direkt und enthält keine gesperrte Einbettung oder Ausgeschiedenen-Korrektur', async () => {
  const league = { id: 1, name: 'Sonntag', slug: 'sonntag' }, season = { id: 2, name: 'Saison' }, race = { id: 3, title: 'GP' };
  const resultUrl = '/admin/current-season-progress?league=1&season=2&race=3';
  const html = await ejs.renderFile(path.join(root, 'views/admin/race-weekend.ejs'), {
    title: 'Test', currentPath: '/admin', isAdmin: true, flash: null, leagues: [league], league, seasons: [season], season, race,
    event: { id: 1 }, events: [], entries: [], attendanceRows: [], availableReplacements: [], attendanceStatuses: [],
    resultsHref: resultUrl, workflow: { lineupComplete: true, attendanceComplete: true }
  });
  const dom = new JSDOM(html);
  assert.equal(dom.window.document.querySelector('#ergebnisse a').getAttribute('href'), resultUrl);
  assert.equal(dom.window.document.querySelector('iframe'), null);
  assert.equal(dom.window.document.querySelector('.f1-attendance-corrections'), null);
  dom.window.close();
});
