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
  assert.match(setup, /sequelize\.transaction\(async \(transaction\) =>\s*syncSeasonDates/);
  assert.match(service, /F1CalendarRoundId: round\.id/);
  assert.match(service, /where: \{ SeasonId: season\.id, sortOrder: eventSortOrder\(round\) \}/);
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

test("Admin-Strafkartei rendert gemeinsame Ersatz- und Ehemaligen-Spalten", async () => {
  const column = {
    key: "round:1", roundNumber: 1, country: "Belgien", title: "Belgien",
    flagPath: "/uploads/be.png", LeagueId: 1, SeasonId: 2, leagueColor: "#6ef2f2",
  };
  const cell = { value: "1", points: 1, LeagueId: 1, SeasonId: 2, entries: [{}] };
  const row = { id: 7, name: "Testfahrer", points: 1, suspended: false, cells: { "round:1": cell } };
  const ledger = { columnGroups: [{ columns: [column] }], columns: [column], rows: [row] };
  const html = await ejs.renderFile(path.join(root, "views", "admin", "penalty-ledger.ejs"), {
    ...layout,
    title: "Formel 1 Strafkartei",
    ledgers: [],
    reserveLedger: ledger,
    formerLedger: ledger,
  });
  assert.match(html, /ERSATZFAHRER/);
  assert.match(html, /EHEMALIGE FAHRER MIT SP/);
  assert.match(html, /R1/);
  assert.match(html, /Testfahrer/);
});

test("Navigation schließt die F1-Gruppe vor den übrigen Hauptlinks", () => {
  const header = read("views/partials/header.ejs");
  assert.match(header, /<\/div>\s*<\/div>\s*<a href="\/lmu">LMU Liga<\/a>/);
});

test("bestehende Saisons werden sicher verknüpft und nicht neu aufgebaut", () => {
  const setup = read("controllers/seasonSetupController.js");
  const service = read("services/f1Calendar.js");
  const view = read("views/admin/season-setup.ejs");
  assert.match(setup, /exports\.selectCentralCalendar/);
  assert.match(setup, /sequelize\.transaction\(async \(transaction\)/);
  assert.match(service, /linkExistingSeasonCalendar/);
  assert.match(service, /Number\(event\.sortOrder\) === roundNumber\(round\)/);
  assert.match(service, /Number\(event\.F1TrackId\) === Number\(round\.F1TrackId\)/);
  assert.doesNotMatch(setup, /createCentralCalendarFromSeason/);
  assert.doesNotMatch(view, /Vorlagenname|Legacy-Kalendereditor/);
  const existingSync = service.slice(
    service.indexOf("async function syncSeasonDates"),
    service.indexOf("async function syncLinkedRaceEvents"),
  );
  assert.doesNotMatch(existingSync, /GrandPrixResult\.(create|update|destroy)/);
  assert.doesNotMatch(existingSync, /RaceEvent\.(create|destroy)/);
  assert.doesNotMatch(existingSync, /F1TrackId:\s*round\.F1TrackId|circuit:|title:|sortOrder:/);
  assert.match(existingSync, /skippedCompleted \+= 1/);
});

test("F1-Ligaseite zeigt nur den zentralen Saisonkalender im Adminbereich", () => {
  const view = read("views/f1.ejs");
  const dashboard = read("controllers/adminController.js");
  assert.doesNotMatch(view, /✎ Teams & Fahrer/);
  assert.doesNotMatch(view, /href="\/admin\/season-calendar/);
  assert.match(view, /AKTUELLER ZENTRALER RENNKALENDER/);
  assert.doesNotMatch(dashboard, /F1 Rennkalender bearbeiten \/ löschen/);
  assert.doesNotMatch(dashboard, /title: 'F1-Fahrerfeld'/);
});

test("Kalenderschritt besitzt nur Datum als editierbaren Rundeneingang", () => {
  const view = read("views/admin/season-setup.ejs");
  const service = read("services/f1Calendar.js");
  assert.match(view, /class="setup-calendar-table"/);
  assert.match(view, /name="dates\[<%= round\.id %>\]"/);
  assert.match(view, /type="time" value="<%= defaultTime %>" readonly/);
  assert.doesNotMatch(view, /name="centralCalendar"/);
  assert.doesNotMatch(view, /name="F1TrackId"/);
  assert.doesNotMatch(view, /Runde hinzufügen|Termin hinzufügen/i);
  assert.match(service, /new Date\(`\$\{date\}T\$\{extractLeagueTime\(league\.raceTime\)\}:00`\)/);
});

test("öffentliche F1- und CSV-Exports bleiben vorhanden", () => {
  const controller = read("controllers/f1Controller.js");
  for (const name of ["show", "downloadDriverStandings", "downloadTeamStandings", "downloadGpResults", "publicPenaltyLedger"]) {
    assert.match(controller, new RegExp(`exports\\.${name}`));
  }
  assert.match(controller, /module\.exports\.loadLeagueData/);
});
