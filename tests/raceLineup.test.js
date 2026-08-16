const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');
const {
  REGULAR_STATUSES, RESERVE_STATUSES, regularStarts, reserveRoleField, reserveStarts
} = require('../services/raceLineup');

const layout = { currentPath: '/admin/f1-race-lineup', isAdmin: true, flash: null };

test('Statuslogik übernimmt nur bestätigte Fahrer in den aktuellen Saisonverlauf', () => {
  assert.equal(REGULAR_STATUSES.some((status) => status.value === 'unabgemeldet'), true);
  assert.equal(regularStarts('anwesend'), true);
  assert.equal(regularStarts('zu_spaet_vorbesprechung'), true);
  assert.equal(regularStarts('unsicher'), false);
  assert.equal(regularStarts('abgemeldet'), false);
  assert.equal(reserveStarts('anwesend'), true);
  assert.equal(reserveStarts('auf_abruf'), true);
  assert.equal(reserveStarts('angefragt'), false);
  assert.equal(reserveRoleField('freitag'), 'roleF1ReserveFriday');
  assert.equal(reserveRoleField('sonntag'), 'roleF1ReserveSunday');
});

test('Fahrereinteilung zeigt Team, Stammfahrer, Ersatzfahrer und alle Statusfarben', async () => {
  const league = { id: 1, name: 'KRL Freitagsliga', slug: 'freitag' };
  const season = { id: 2, name: 'Saison 13', status: 'active' };
  const race = { id: 3, title: 'Großer Preis von Spa', circuit: 'Spa', raceDate: '2026-09-04', sortOrder: 1 };
  const regular = { id: 7, name: 'Stammfahrer', platform: 'PC' };
  const reserve = { id: 9, name: 'Ersatzfahrer', platform: 'PC', aliases: [] };
  const team = { id: 4, name: 'Mercedes', logoPath: null };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'f1-race-lineup.ejs'), {
    ...layout, title: 'Fahrereinteilung', leagues: [league], selectedLeague: league,
    activeSeason: season, races: [race], selectedRace: race,
    regularStatuses: REGULAR_STATUSES, reserveStatuses: RESERVE_STATUSES,
    reserves: [reserve], reserveRows: [{ driver: reserve, status: 'anwesend', assignedTo: { driver: regular, team } }],
    teamCards: [{ team, rows: [{ driver: regular, team, status: 'abgemeldet', replacementDriverId: reserve.id }] }],
    hasSavedPlan: true
  });
  assert.match(html, /Mercedes/);
  assert.match(html, /Stammfahrer/);
  assert.match(html, /Ersatzfahrer/);
  assert.match(html, /für Stammfahrer/);
  assert.match(html, /status-rennsperre/);
  assert.match(html, /status-auf_abruf/);
  assert.match(html, /name="regular\[7\]\[ReplacementDriverId\]"/);
  assert.match(html, /nur für dieses Rennen der aktuellen Saison/);
});

test('Rennkalender wird als grafische Karten statt einfacher Tabelle gerendert', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'resource-list.ejs'), {
    ...layout, title: 'F1-Rennkalender', adminBasePath: '/admin', resource: 'f1CalendarRounds',
    config: { title: 'F1-Rennkalender', group: 'Formel 1 Liga', description: 'Kalender', cardView: 'calendar-f1', fields: [] },
    entries: [{ id: 1, circuit: 'Spa', fridayDate: '2026-09-04', sundayDate: '2026-09-06', fridayTime: '20:00', sundayTime: '19:30', hasSprint: true, isTestDay: true, sortOrder: 1 }],
    fieldOptions: {}, selectedLeague: '', leagueOptions: []
  });
  assert.match(html, /admin-calendar-grid/);
  assert.match(html, /Freitagsliga/);
  assert.match(html, /Sonntagsliga/);
  assert.match(html, /SPRINT/);
  assert.match(html, /TESTTAG/);
  assert.match(html, /admin-calendar-test/);
  assert.doesNotMatch(html, /class="table-wrap admin-table"/);
});
