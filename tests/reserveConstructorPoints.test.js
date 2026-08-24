const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Saisonmodell und Schema verwenden die abwärtskompatible Team-WM-Einstellung', () => {
  const modelSource = read('models/index.js');
  const schemaSource = read('services/schema.js');

  assert.match(modelSource, /reservePointsForConstructors:\s*\{/);
  assert.match(modelSource, /field:\s*['"]reserve_points_for_constructors['"]/);
  assert.match(modelSource, /reservePointsForConstructors:[\s\S]*?defaultValue:\s*true/);
  assert.match(schemaSource, /addMissingColumn\('seasons',[\s\S]*?'reserve_points_for_constructors',[\s\S]*?defaultValue:\s*true/);
});

test('Saison-Assistent und Saisonpflege speichern den Checkboxwert explizit', () => {
  const setupController = read('controllers/seasonSetupController.js');
  const managerController = read('controllers/seasonManagerController.js');

  assert.ok((setupController.match(/req\.body\.reservePointsForConstructors\s*===\s*["']on["']/g) || []).length >= 2);
  assert.match(managerController, /reservePointsForConstructors:\s*req\.body\.reservePointsForConstructors\s*===\s*['"]on['"]/);
});

test('Team-WM erkennt Ersatzfahrer über das konkrete Renn-Line-up', () => {
  const standingsSource = read('services/standings.js');

  assert.match(standingsSource, /Number\(\s*row\.GrandPrixResultId,?\s*\)\s*===\s*directRaceId/);
  assert.match(standingsSource, /Number\(\s*row\.DriverId,?\s*\)\s*===\s*Number\(\s*entry\.DriverId,?\s*\)/);
  assert.match(standingsSource, /concreteLineupEntry\s*[\s\S]*?\?\.roleType\s*===\s*["']reserve["']/);
  assert.match(standingsSource, /isReserve\s*&&\s*!reservePointsForConstructors/);
});
