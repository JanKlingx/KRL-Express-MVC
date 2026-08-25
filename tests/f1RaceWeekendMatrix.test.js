const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

process.env.DB_HOST ||= 'localhost';
process.env.DB_NAME ||= 'krl';
process.env.DB_USER ||= 'krl';
process.env.DB_PASSWORD ||= 'krl';

const { GrandPrixResultEntry, F1RaceLineupEntry } = require('../models');
const { selectCurrentEvent } = require('../controllers/raceWeekendController');
const { REGULAR_STATUSES, RESERVE_STATUSES } = require('../services/raceLineup');

const root = path.join(__dirname, '..');

function event(id, startsAt, isTestDay = false) {
  return { id, startsAt: new Date(startsAt), isTestDay };
}

test('aktuelles Rennen priorisiert heute, dann Zukunft und ignoriert Testtage', () => {
  const now = new Date('2026-08-25T12:00:00Z');
  const events = [
    event(1, '2026-08-25T08:00:00Z', true),
    event(2, '2026-08-25T18:00:00Z'),
    event(3, '2026-08-30T18:00:00Z'),
  ];
  assert.equal(selectCurrentEvent(events, now).id, 2);
  assert.equal(selectCurrentEvent(events.filter((row) => row.id !== 2), now).id, 3);
  assert.equal(selectCurrentEvent([event(4, '2026-08-20T18:00:00Z')], now).id, 4);
});

test('Einsatzmatrix ist kompakt, ohne Drag-and-drop und mit direkter Ersatzwahl', async () => {
  const regular = { id: 7, name: 'Marcel', platform: 'PC' };
  const reserve = { id: 9, name: 'Tobi', platform: 'PC' };
  const team = { id: 4, name: 'Mercedes', accentColor: '#00d2be', logoPath: null };
  const html = await ejs.renderFile(path.join(root, 'views', 'admin', 'partials', 'f1-lineup-board.ejs'), {
    selectedRace: { id: 3 },
    regularStatuses: REGULAR_STATUSES,
    reserveStatuses: RESERVE_STATUSES,
    reserveRows: [{ driver: reserve, status: 'anwesend', assignedTo: null, isAttendanceLocked: false }],
    teamCards: [{ team, rows: [{ driver: regular, team, status: 'unsicher', replacementDriverId: null, isBanned: false }] }],
  });
  assert.match(html, /f1-lineup-matrix/);
  assert.match(html, /name="regular\[7\]\[ReplacementDriverId\]"/);
  assert.match(html, /Auf Abruf.*automatisch/s);
  assert.doesNotMatch(html, /draggable=/);
});

test('Unsicher-Rückmeldung und Driver of the Day sind migrationssicher', () => {
  assert.equal(F1RaceLineupEntry.rawAttributes.uncertainPresent.allowNull, true);
  assert.equal(F1RaceLineupEntry.rawAttributes.respondedInTime.allowNull, true);
  assert.equal(GrandPrixResultEntry.rawAttributes.driverOfTheDay.defaultValue, false);
  const schema = fs.readFileSync(path.join(root, 'services', 'schema.js'), 'utf8');
  assert.match(schema, /uncertain_present/);
  assert.match(schema, /responded_in_time/);
  assert.match(schema, /driver_of_the_day/);
});

test('Server schützt Ersatzzuordnung und speichert zusammenhängend in Transaktionen', () => {
  const lineup = fs.readFileSync(path.join(root, 'controllers', 'f1RaceLineupController.js'), 'utf8');
  const weekend = fs.readFileSync(path.join(root, 'controllers', 'raceWeekendController.js'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'controllers', 'raceEditorController.js'), 'utf8');
  assert.match(lineup, /submittedStatus === "anwesend"/);
  assert.match(lineup, /\["anwesend", "unsicher"\]\.includes\(reserveStatus\)/);
  assert.match(lineup, /sequelize\.transaction/);
  assert.match(weekend, /respondedInTime/);
  assert.match(weekend, /bereits als Starter bestätigt/);
  assert.match(weekend, /sequelize\.transaction/);
  assert.match(editor, /driverOfTheDayCount/);
  assert.match(editor, /const driverOfTheDay = !prefix/);
});

test('öffentliche Rennstatistik liest bestehende Ergebnisse statt Parallelhaltung', () => {
  const controller = fs.readFileSync(path.join(root, 'controllers', 'f1Controller.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'views', 'f1.ejs'), 'utf8');
  assert.match(controller, /const raceStatistics = decoratedGpResults/);
  assert.match(controller, /entry\.driverOfTheDay/);
  assert.match(view, /Driver of the Day/);
  assert.match(view, /Poleposition/);
  assert.match(view, /Schnellste Runde/);
});
