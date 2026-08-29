const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ejs = require("ejs");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const layout = { currentPath: "/admin", isAdmin: true, adminRole: "admin", adminHome: "/admin", flash: null };

test("zentrale Kalenderstruktur erweitert Season und RaceEvent nullable", () => {
  const models = read("models/index.js");
  const schema = read("services/schema.js");
  assert.match(models, /const F1Calendar = sequelize\.define\("F1Calendar"/);
  assert.match(models, /F1Calendar\.hasMany\(Season/);
  assert.match(models, /name: "F1CalendarId",\s*allowNull: true/);
  assert.match(models, /F1CalendarRound\.hasMany\(RaceEvent/);
  assert.match(models, /name: "F1CalendarRoundId",\s*allowNull: true/);
  assert.match(schema, /uq_f1_calendar_round_number/);
  assert.match(schema, /uq_race_event_season_calendar_round/);
});

test("Saisonmapping ist transaktional und aktualisiert statt blind zu duplizieren", () => {
  const setup = read("controllers/seasonSetupController.js");
  const service = read("services/f1Calendar.js");
  assert.match(setup, /sequelize\.transaction\(async \(transaction\) =>\s*syncSeasonCalendar/);
  assert.match(service, /F1CalendarRoundId: round\.id/);
  assert.match(service, /where: \{ SeasonId: season\.id, sortOrder: roundNumber\(round\) \}/);
  assert.doesNotMatch(service, /sprint\.destroy/);
});

test("zentrale Adminpflege rendert Strecke, Land, Flagge und Sprint kompakt", async () => {
  const country = { name: "Australien", flagPath: "/uploads/au.png" };
  const track = { id: 7, name: "Melbourne", country: "Australien", countryRecord: country };
  const calendar = { id: 3, name: "KRL F1 Saison 17", isActive: true, sortOrder: 1, rounds: [{ id: 9, F1TrackId: 7, roundNumber: 1, sortOrder: 1, hasSprint: true, isTestDay: false, track }] };
  const html = await ejs.renderFile(path.join(root, "views", "admin", "f1-calendars.ejs"), {
    ...layout, title: "Zentrale F1-Rennkalender", calendars: [calendar], selectedCalendar: calendar, tracks: [track],
  });
  assert.match(html, /KRL F1 Saison 17/);
  assert.match(html, /R1/);
  assert.match(html, /Australien · Melbourne/);
  assert.match(html, /\/uploads\/au\.png/);
  assert.match(html, /name="hasSprint" checked/);
});

test("globale Strafkartei aggregiert ausschließlich nach Rundennummer", () => {
  const controller = read("controllers/penaltyLedgerController.js");
  const adminView = read("views/admin/penalty-ledger.ejs");
  assert.match(controller, /function globalCellKey\(roundNumber\)/);
  assert.match(controller, /key: globalCellKey\(round\.roundNumber\)/);
  assert.doesNotMatch(adminView, /reserveColumnGroups\.forEach/);
  assert.doesNotMatch(adminView, /formerColumnGroups\.forEach/);
});

test("öffentliche F1- und CSV-Exports bleiben vorhanden", () => {
  const controller = read("controllers/f1Controller.js");
  for (const name of ["show", "downloadDriverStandings", "downloadTeamStandings", "downloadGpResults", "publicPenaltyLedger"]) {
    assert.match(controller, new RegExp(`exports\\.${name}`));
  }
  assert.match(controller, /module\.exports\.loadLeagueData/);
});
