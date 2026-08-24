const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const { SeasonDriverStint } = require('../models');
const {
  canCarryReservePoints,
  isRoundInStint,
  validateStintRange
} = require('../services/seasonDriverStints');

test('SeasonDriverStint besitzt migrationssichere Rollen- und Zeitraumfelder', () => {
  assert.ok(SeasonDriverStint.rawAttributes.SeasonId);
  assert.ok(SeasonDriverStint.rawAttributes.DriverId);
  assert.ok(SeasonDriverStint.rawAttributes.SeasonTeamId);
  assert.ok(SeasonDriverStint.rawAttributes.previousStintId);
  assert.equal(SeasonDriverStint.rawAttributes.carryReservePoints.defaultValue, false);
  assert.throws(() => validateStintRange(5, 4), /Startrunde/);
  assert.equal(isRoundInStint({ fromRound: 1, toRound: 4 }, 4), true);
  assert.equal(isRoundInStint({ fromRound: 1, toRound: 4 }, 5), false);
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
  assert.match(source, /oldLineup\.destroy/);
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
    stints: [
      { id: 1, DriverId: 1, SeasonTeamId: 10, roleType: 'regular', fromRound: 1, toRound: null, endReason: null, carryReservePoints: false, driver: { name: 'Marcel' }, seasonTeam: { name: 'Mercedes' } },
      { id: 2, DriverId: 2, SeasonTeamId: 10, roleType: 'reserve', fromRound: 1, toRound: null, endReason: null, carryReservePoints: false, driver: { name: 'Tobi' }, seasonTeam: { name: 'Mercedes' } }
    ],
    completedRound: 4,
    selectedTeamId: 10,
    reasons: [['promoted', 'Ersatzfahrer wird Stammfahrer']]
  });
  assert.match(html, /name="effectiveRound"[^>]*min="5"/);
  assert.match(html, /Ersatzfahrer-Punkte aus diesem Team/);
  assert.match(html, /DAUERHAFTE SAISONHISTORIE/);
  assert.match(html, /data-reserve-team-id="10"/);
});
