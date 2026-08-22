const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Saison-Assistent besitzt funktionierende Kalenderaktionen statt 404-Zielen', () => {
  const routes = read('routes/adminRoutes.js');
  const controller = read('controllers/seasonSetupController.js');
  assert.match(routes, /calendar\/:eventId\/update'.*updateCalendarEvent/);
  assert.match(routes, /calendar\/reorder'.*reorderCalendar/);
  assert.match(routes, /calendar\/:eventId\/delete'.*removeCalendarEvent/);
  assert.match(controller, /exports\.updateCalendarEvent/);
});

test('Kalenderstatus bleibt sichtbar und Fehleingaben werden wieder eingesetzt', () => {
  const view = read('views/admin/season-setup.ejs');
  const controller = read('controllers/seasonSetupController.js');
  assert.match(view, /setupCalendarDraft\.hasSprint \? 'checked'/);
  assert.match(view, /event\.hasSprint \? 'checked'/);
  assert.match(view, /SPRINT \+ HAUPTRENNEN/);
  assert.match(controller, /seasonSetupDraft/);
  assert.match(controller, /raceType: 'sprint'/);
});

test('Fahrer- und Teamauswahl bieten Filter, Suche und Auswahlzähler', () => {
  const view = read('views/admin/season-setup.ejs');
  assert.match(view, /data-driver-filter="saturday"/);
  assert.match(view, /data-driver-search/);
  assert.match(view, /data-driver-selected-count/);
  assert.match(view, /data-team-search/);
  assert.match(view, /\/ 11 ausgewählt/);
});

test('Saisonverlauf akzeptiert nur kalendergebundene Rennen der gewählten Saison', () => {
  const controller = read('controllers/raceEditorController.js');
  assert.match(controller, /as: 'calendarEvent'/);
  assert.match(controller, /required: true/);
  assert.match(controller, /where: \{ LeagueId: leagueId, SeasonId: seasonId \}/);
});
