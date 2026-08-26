const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const {
  REGULAR_STATUSES, RESERVE_STATUSES, ATTENDANCE_STATUSES,
  regularStarts, regularRoleField, reserveRoleField, reserveStarts,
} = require('../services/raceLineup');
const { selectCurrentRaceEvent, buildCockpitRows, availableReplacementRows } = require('../services/raceWeekend');

const layout = { currentPath: '/admin/f1-race-lineup', isAdmin: true, flash: null };

test('Statuslogik übernimmt nur bestätigte Fahrer in den aktuellen Saisonverlauf', () => {
  assert.equal(REGULAR_STATUSES.some((status) => status.value === 'unabgemeldet'), false);
  assert.equal(ATTENDANCE_STATUSES.some((status) => status.value === 'unabgemeldet'), true);
  assert.equal(ATTENDANCE_STATUSES.some((status) => status.value === 'zu_spaet_vorbesprechung'), true);
  assert.equal(regularStarts('anwesend'), true);
  assert.equal(regularStarts('zu_spaet_vorbesprechung'), false);
  assert.equal(regularStarts('unsicher'), false);
  assert.equal(regularStarts('abgemeldet'), false);
  assert.equal(reserveStarts('anwesend'), true);
  assert.equal(reserveStarts('auf_abruf'), true);
  assert.equal(reserveStarts('angefragt'), false);
  assert.equal(reserveRoleField('freitag'), 'roleF1ReserveFriday');
  assert.equal(reserveRoleField('samstag'), 'roleF1ReserveSaturday');
  assert.equal(reserveRoleField('sonntag'), 'roleF1ReserveSunday');
  assert.equal(regularRoleField('samstag'), 'roleF1Saturday');
});

test('Auf-Abruf-Automatik und Ersatz-Zulässigkeit bleiben serverseitig eindeutig', () => {
  assert.deepEqual(RESERVE_STATUSES.map((status) => status.value), [
    'angefragt', 'abgemeldet', 'unsicher', 'anwesend', 'auf_abruf'
  ]);
  assert.equal(reserveStarts('anwesend'), true);
  assert.equal(reserveStarts('auf_abruf'), true);
  assert.equal(reserveStarts('angefragt'), false);
  assert.equal(ATTENDANCE_STATUSES.some((status) => status.value === 'unsicher'), true);
});

test('Aktuelles Rennen priorisiert heute, Zukunft und Vergangenheit und ignoriert Testtage', () => {
  const event = (id, date, isTestDay = false) => ({ id, GrandPrixResultId: id + 100, startsAt: `${date}T18:00:00+02:00`, isTestDay });
  const events = [event(1, '2026-08-20'), event(2, '2026-08-25', true), event(3, '2026-08-25'), event(4, '2026-09-01')];
  assert.equal(selectCurrentRaceEvent(events, { today: '2026-08-25' }).id, 3);
  assert.equal(selectCurrentRaceEvent(events, { today: '2026-08-26' }).id, 4);
  assert.equal(selectCurrentRaceEvent(events, { today: '2026-09-02' }).id, 4);
  assert.equal(selectCurrentRaceEvent(events, { event: 1, today: '2026-08-25' }).id, 1);
});

test('Driver of the Day ist migrationssicher, exklusiv und nur dem Hauptrennen zugeordnet', () => {
  const models = fs.readFileSync(path.join(__dirname, '..', 'models', 'index.js'), 'utf8');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'services', 'schema.js'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'raceEditorController.js'), 'utf8');
  const control = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'f1-result-control.js'), 'utf8');
  assert.match(models, /driverOfTheDay: \{ type: DataTypes\.BOOLEAN, allowNull: false, defaultValue: false \}/);
  assert.match(schema, /driver_of_the_day/);
  assert.match(editor, /driverOfTheDayCount > 1/);
  assert.match(editor, /!prefix && submitted\.driverOfTheDay/);
  assert.match(control, /DRIVER OF THE DAY/);
});

test('Unsicher-Kette reserviert den vorgemerkten Ersatz und endet ohne Schleife beim freien Starter', () => {
  const regular = { id: 1, DriverId: 10, TeamId: 7, roleType: 'regular', status: 'unsicher', uncertainPresent: false, driver: { name: 'Stamm' } };
  const planned = { id: 2, DriverId: 20, ReplacementForDriverId: 10, TeamId: 7, roleType: 'reserve', status: 'unsicher', uncertainPresent: null, driver: { name: 'Vorgemerkt' } };
  const next = { id: 3, DriverId: 30, ReplacementForDriverId: 20, TeamId: 7, roleType: 'reserve', status: 'auf_abruf', uncertainPresent: null, driver: { name: 'Auf Abruf' } };
  let cockpit = buildCockpitRows([regular, planned, next])[0];
  assert.equal(cockpit.pending, planned);
  assert.equal(cockpit.current, null);
  planned.uncertainPresent = false;
  cockpit = buildCockpitRows([regular, planned, next])[0];
  assert.equal(cockpit.current, next);
  assert.deepEqual(cockpit.chain.map((entry) => entry.DriverId), [10, 20, 30]);
});

test('Eine Rennsperre öffnet auch in der Anwesenheitskontrolle kein Ersatzcockpit', () => {
  const regular = { id: 1, DriverId: 10, TeamId: 7, roleType: 'regular', status: 'rennsperre', driver: { name: 'Gesperrt' } };
  const cockpit = buildCockpitRows([regular])[0];
  assert.equal(cockpit.current, null);
  assert.equal(cockpit.replacementBlocked, true);
  assert.equal(cockpit.needsReplacement, false);
});

test('Spontane Ersatzliste bevorzugt Auf Abruf und schließt reservierte oder bestätigte Fahrer aus', () => {
  const entry = (id, status, extra = {}) => ({ id, DriverId: id, roleType: 'reserve', status, driver: { name: `F${id}` }, ...extra });
  const rows = availableReplacementRows([
    entry(1, 'unsicher'), entry(2, 'anwesend'), entry(3, 'auf_abruf'),
    entry(4, 'auf_abruf', { ReplacementForDriverId: 99 }),
    entry(5, 'auf_abruf', { includeInResults: true }),
    entry(6, 'abgemeldet')
  ]);
  assert.deepEqual(rows.map((row) => row.DriverId), [3, 2, 1]);
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
  assert.match(html, /name="regular\[d7\]\[ReplacementDriverId\]"/);
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

test('LMU-Fahrereinteilung nutzt LMU-Anzeigename, persönliches Auto und Ersatzstatus', async () => {
  const league = { id: 1, name: 'KRL LMU', slug: 'lmu' };
  const season = { id: 2, name: 'LMU 2026', status: 'active' };
  const race = { id: 3, title: '6H Spa', circuit: 'Spa', raceDate: '2026-09-04', sortOrder: 1 };
  const car = { manufacturer: 'BMW', name: 'M4 GT3' };
  const regular = { id: 7, name: 'Paul', lmuDisplayName: 'Paul Schober | alaric01', platform: 'PC', lmuCar: car };
  const reserve = { id: 8, name: 'Reserve', lmuDisplayName: 'Reserve | R8', platform: 'PC', lmuCar: car };
  const team = { id: 9, name: 'A.C.N. Racing', logoPath: null };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'lmu-race-lineup.ejs'), {
    ...layout, title: 'LMU-Fahrereinteilung', league, activeSeason: season, races: [race], selectedRace: race,
    regularStatuses: REGULAR_STATUSES, reserveStatuses: RESERVE_STATUSES, displayName: (driver) => driver.lmuDisplayName || driver.name,
    reserves: [reserve], reserveRows: [{ driver: reserve, status: 'auf_abruf', assignedTo: null }],
    teamCards: [{ team, rows: [{ driver: regular, team, status: 'anwesend', replacementDriverId: null }] }], hasSavedPlan: true
  });
  assert.match(html, /Paul Schober \| alaric01/);
  assert.match(html, /BMW M4 GT3/);
  assert.match(html, /status-auf_abruf/);
  assert.match(html, /LMU-FAHRERFELD/);
  assert.match(html, /LMU-Fahrereinteilung speichern/);
});

