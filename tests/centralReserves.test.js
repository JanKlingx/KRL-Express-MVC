const test = require('node:test');
const assert = require('node:assert/strict');
const { selectWeekendReserves, reserveRoleField } = require('../services/raceLineup');
const candidates = [{ id: 1, roleF1Reserve: true }, { id: 2, roleF1Reserve: true }, { id: 3, roleF1Reserve: false }];
test('Ein Rang erlaubt unterschiedliche manuelle Pools je Rennen und Saison', () => {
  for (const slug of ['freitag', 'samstag', 'sonntag']) assert.equal(reserveRoleField(slug), 'roleF1Reserve');
  assert.deepEqual(selectWeekendReserves(candidates, [], {}), []);
  assert.deepEqual(selectWeekendReserves(candidates, [], { d1: { status: 'anwesend' } }).map(d => d.id), [1]);
  assert.deepEqual(selectWeekendReserves(candidates, [], { d2: { status: 'unsicher' } }).map(d => d.id), [2]);
});
test('Gespeicherte Einsätze bleiben auch nach Rangverlust erhalten', () => {
  assert.deepEqual(selectWeekendReserves(candidates, [{ DriverId: 3 }], { d1: {} }).map(d => d.id), [1, 3]);
});
test('Manipulierte oder ranglose Neuzugänge werden abgewiesen und doppelte IDs dedupliziert', () => {
  assert.throws(() => selectWeekendReserves(candidates, [], { d3: {} }), /F1 Ersatz/);
  assert.throws(() => selectWeekendReserves(candidates, [], { d99: {} }), /F1 Ersatz/);
  assert.throws(() => selectWeekendReserves(candidates, [], { invalid: {} }), /F1 Ersatz/);
  assert.deepEqual(selectWeekendReserves(candidates, [], { d1: {}, 1: {} }).map(d => d.id), [1]);
});
