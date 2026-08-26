const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { SeasonDriverStint, SeasonDriverCarryOver } = require('../models');
const {
  canCarryReservePoints,
  driverCanBecomeRegular,
  isRoundInStint,
  validateRegularStintSet,
  validateStintRange
} = require('../services/seasonDriverStints');
const { lineupForRound } = require('../services/f1Season');
const { hasConfirmedWeekendData } = require('../services/seasonDriverChange');

test('SeasonDriverStint besitzt migrationssichere Rollen- und Zeitraumfelder', () => {
  assert.ok(SeasonDriverStint.rawAttributes.SeasonId);
  assert.ok(SeasonDriverStint.rawAttributes.DriverId);
  assert.ok(SeasonDriverStint.rawAttributes.SeasonTeamId);
  assert.ok(SeasonDriverStint.rawAttributes.previousStintId);
  assert.equal(SeasonDriverStint.rawAttributes.carryReservePoints.defaultValue, false);
  assert.ok(SeasonDriverCarryOver.rawAttributes.SeasonDriverStintId);
  assert.ok(SeasonDriverCarryOver.rawAttributes.GrandPrixResultId);
  assert.throws(() => validateStintRange(5, 4), /Startrunde/);
  assert.equal(isRoundInStint({ fromRound: 1, toRound: 4 }, 4), true);
  assert.equal(isRoundInStint({ fromRound: 1, toRound: 4 }, 5), false);
});

test('Regular-Stints und Liga-Rollen werden ohne Überschneidung validiert', () => {
  assert.equal(driverCanBecomeRegular({ roleF1Sunday: true }, 'sonntag'), true);
  assert.equal(driverCanBecomeRegular({ roleF1ReserveSunday: true }, 'sonntag'), true);
  assert.equal(driverCanBecomeRegular({ roleF1ReserveFriday: true }, 'sonntag'), false);
  assert.throws(() => validateRegularStintSet([
    { DriverId: 1, SeasonTeamId: 10, roleType: 'regular', fromRound: 1, toRound: null },
    { DriverId: 1, SeasonTeamId: 20, roleType: 'regular', fromRound: 5, toRound: null }
  ]), /mehrere Stammfahrer-Stints/);
});

test('Zukünftige Renn-Line-ups werden für die konkrete Runde aus Stints aufgelöst', () => {
  const legacyLineup = [{ DriverId: 9 }];
  const stints = [
    { id: 1, DriverId: 1, SeasonTeamId: 10, roleType: 'regular', fromRound: 1, toRound: 5 },
    { id: 2, DriverId: 2, SeasonTeamId: 10, roleType: 'regular', fromRound: 6, toRound: null }
  ];
  assert.deepEqual(lineupForRound([], stints, 5).map((row) => row.DriverId), [1]);
  assert.deepEqual(lineupForRound([], stints, 6).map((row) => row.DriverId), [2]);
  assert.equal(lineupForRound(legacyLineup, [], 6), legacyLineup);
  assert.equal(hasConfirmedWeekendData({ attendanceStatus: null, includeInResults: false, uncertainPresent: null }), false);
  assert.equal(hasConfirmedWeekendData({ attendanceStatus: 'anwesend', includeInResults: true }), true);
  assert.equal(hasConfirmedWeekendData({ status: 'unsicher', attendanceStatus: null, includeInResults: false }), true);
  assert.equal(hasConfirmedWeekendData({ status: 'anwesend', ReplacementForDriverId: 7 }), true);
});

test('Punkteübertrag ist ausschließlich reserve -> regular im selben Team möglich', () => {
  assert.equal(canCarryReservePoints({ roleType: 'reserve', SeasonTeamId: 10 }, 10), true);
  assert.equal(canCarryReservePoints({ roleType: 'reserve', SeasonTeamId: 20 }, 10), false);
  assert.equal(canCarryReservePoints({ roleType: 'regular', SeasonTeamId: 10 }, 10), false);
});

test('Fahrerwechsel wird atomar gespeichert und schreibt keine Rennergebnisse um', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'seasonDriverChangeController.js'), 'utf8');
  assert.match(source, /sequelize\.transaction\(async \(transaction\)/);
  assert.match(source, /oldStint\.update/);
  assert.match(source, /SeasonDriverStint\.create/);
  assert.match(source, /SeasonLineupEntry\.destroy/);
  assert.match(source, /futureWeekendPlan/);
  assert.match(source, /validateRegularStintSet/);
  assert.doesNotMatch(source, /GrandPrixResultEntry\.(?:update|destroy|bulkCreate|create)/);
});

test('Bestands-Line-ups werden idempotent ergänzt und die Stint-Historie nie gelöscht', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'seasonDriverStints.js'), 'utf8');
  assert.match(source, /SeasonDriverStint\.findOrCreate/);
  assert.doesNotMatch(source, /SeasonDriverStint\.(?:destroy|truncate)/);
});

test('Admin-Workflow zeigt Kontext, Wechsel, Punkteübertrag und dauerhafte Historie', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'season-driver-change.ejs'), {
    title: 'Fahrerwechsel',
    currentPath: '/admin/season-driver-change',
    isAdmin: true,
    adminRole: 'admin',
    flash: null,
    leagues: [{ id: 1, name: 'Freitagsliga' }],
    seasons: [{ id: 2, name: 'Saison 14', status: 'active' }],
    selectedLeague: { id: 1, name: 'Freitagsliga' },
    selectedSeason: { id: 2, name: 'Saison 14' },
    teams: [{ id: 10, name: 'Mercedes' }],
    lineup: [{ DriverId: 1, SeasonTeamId: 10, roleType: 'regular', driver: { name: 'Marcel' } }],
    memberships: [{ DriverId: 1, driver: { name: 'Marcel' } }, { DriverId: 2, driver: { name: 'Tobi' } }],
    eligibleMemberships: [{ DriverId: 1, driver: { name: 'Marcel' } }, { DriverId: 2, driver: { name: 'Tobi' } }],
    stints: [
      { id: 1, DriverId: 1, SeasonTeamId: 10, roleType: 'regular', fromRound: 1, toRound: null, endReason: null, carryReservePoints: false, driver: { name: 'Marcel' }, seasonTeam: { name: 'Mercedes' } },
      { id: 2, DriverId: 2, SeasonTeamId: 10, roleType: 'reserve', fromRound: 1, toRound: null, endReason: null, carryReservePoints: false, driver: { name: 'Tobi' }, seasonTeam: { name: 'Mercedes' } }
    ],
    completedRound: 4,
    selectedRound: 5,
    rounds: [{ round: 5, title: 'Spanien' }],
    teamSlots: [{ team: { id: 10, name: 'Mercedes' }, regulars: [], freeSeats: 1 }],
    selectedTeamId: 10,
    previewError: null,
    preview: {
      operation: 'replace', team: { id: 10, name: 'Mercedes' }, effectiveRound: 5,
      oldStint: { id: 1, DriverId: 1, driver: { name: 'Marcel' } },
      membership: { DriverId: 2, driver: { name: 'Tobi' } },
      carryHistory: [{ GrandPrixResultId: 99, round: 4, title: 'Kanada', raceDate: '2026-06-01', mainPoints: 8, sprintPoints: 2, totalPoints: 10 }]
    },
    reasons: [['promoted', 'Ersatzfahrer wird Stammfahrer']]
  });
  assert.match(html, /name="round"[^>]*data-change-round/);
  assert.match(html, /name="effectiveRound" value="5"/);
  assert.match(html, /Ersatzfahrer-Punkte aus diesem Team/);
  assert.match(html, /DAUERHAFTE SAISONHISTORIE/);
  assert.match(html, /data-reserve-team-id="10"/);
  assert.match(html, /name="carryResultIds" value="99"/);
});

test('Direkte Stammplatz-Editoren sind bei vorhandener Saisonhistorie geschützt', () => {
  const setupController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'seasonSetupController.js'), 'utf8');
  const rosterController = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'teamRosterController.js'), 'utf8');
  const setupView = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'season-setup.ejs'), 'utf8');
  const rosterView = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin', 'team-rosters.ejs'), 'utf8');
  assert.match(setupController, /seasonLineupIsProtected/);
  assert.match(rosterController, /seasonLineupIsProtected/);
  assert.match(setupView, /Stammfahrer einer laufenden Saison können nur über Fahrerwechsel geändert werden/);
  assert.match(rosterView, /Stammfahrer einer laufenden Saison können nur über Fahrerwechsel geändert werden/);
  assert.match(setupView, /FAHRERWECHSEL ÖFFNEN/);
  assert.match(rosterView, /FAHRERWECHSEL ÖFFNEN/);
});

