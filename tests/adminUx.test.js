const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

process.env.DB_HOST ||= 'localhost';
process.env.DB_NAME ||= 'krl';
process.env.DB_USER ||= 'krl';
process.env.DB_PASSWORD ||= 'krl';

const resourceConfig = require('../services/resourceConfig');
const models = require('../models');
const adminController = require('../controllers/adminController');
const { F1RaceLineupEntry } = models;

const layout = { currentPath: '/admin', isAdmin: true, flash: null };

test('Fahrerpflege nutzt feste Nationalitäten und Rangfilter', () => {
  const nationality = resourceConfig.drivers.fields.find((field) => field.name === 'nationality');
  assert.equal(nationality.type, 'select');
  assert.deepEqual(nationality.choices.find(([value]) => value === 'DE'), ['DE', 'Deutschland (DE)']);
  assert.deepEqual(nationality.choices.find(([value]) => value === 'CH'), ['CH', 'Schweiz (CH)']);
  assert.deepEqual(nationality.choices.find(([value]) => value === 'AU'), ['AU', 'Australien (AU)']);
  assert.equal(resourceConfig.drivers.groupByRanks, true);
  assert.equal(resourceConfig.drivers.rankFilters.some((rank) => rank.value === 'f1-friday'), true);
  assert.equal(resourceConfig.drivers.rankFilters.some((rank) => rank.value === 'f1-saturday'), true);
  assert.ok(resourceConfig.drivers.fields.some((field) => field.name === 'roleF1ReserveSaturday'));
});

test('Fahrerpflege warnt bei Namensgleichheit und erlaubt eine bestätigte zweite Person', async () => {
  const originalFindOne = models.Driver.findOne;
  models.Driver.findOne = async () => ({ id: 4, name: 'Max Beispiel' });
  try {
    let warning;
    try {
      await resourceConfig.drivers.prepareValues({ name: '  MAX BEISPIEL  ' }, {}, null);
    } catch (error) {
      warning = error;
    }
    assert.match(warning.message, /Fahrername „MAX BEISPIEL“ existiert bereits/);
    assert.deepEqual(warning.duplicateDriver, { id: 4, name: 'Max Beispiel' });
    const confirmed = { name: '  MAX BEISPIEL  ' };
    await resourceConfig.drivers.prepareValues(confirmed, { confirmDuplicateName: 'on' }, null);
    assert.equal(confirmed.name, 'MAX BEISPIEL');
  } finally {
    models.Driver.findOne = originalFindOne;
  }
});

test('Bildfelder unterstützen Drag-and-drop ohne externe URL', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'resource-form.ejs'), {
    ...layout, title: 'Teamlogo', adminBasePath: '/admin', returnHref: '/admin/teams', resource: 'teams',
    config: { group: 'Stammdaten', description: 'Upload', fields: [], upload: { field: 'logoPath', label: 'Teamlogo' } },
    entry: {}, error: null, duplicateDriver: null, fieldOptions: {}
  });
  assert.match(html, /data-upload-dropzone/);
  assert.match(html, /Bild hierher ziehen/);
  assert.match(html, /type="file"/);
  assert.doesNotMatch(html, /name="imageUrl"/);
});

test('LMU-Stammdaten enthalten Anzeigename, persönliches Auto, Zusatz und Pole-Bonus', () => {
  assert.ok(resourceConfig.drivers.fields.some((field) => field.name === 'lmuDisplayName'));
  assert.equal(resourceConfig.drivers.fields.find((field) => field.name === 'LmuCarId').relation.model, models.LmuCar);
  assert.ok(resourceConfig.lmuCars.fields.some((field) => field.name === 'additionalInfo'));
  assert.equal(resourceConfig.lmuCars.fields.some((field) => field.name === 'sortOrder'), false);
  assert.ok(resourceConfig.pointsSchemes.fields.some((field) => field.name === 'polePositionEnabled'));
  assert.equal(models.GrandPrixResultEntry.rawAttributes.polePosition.defaultValue, false);
});

test('F1-Saison-Assistent führt vollständig durch acht Stammdaten-Schritte', async () => {
  const league = { id: 1, name: 'KRL Freitagsliga', type: 'f1', slug: 'freitag', accentColor: '#00aaff', raceDay: 'Freitag', raceTime: '20:00', logoPath: null };
  const season = { id: 2, name: 'Saison 13', status: 'active', accentColor: '#00aaff', PointsSchemeId: 3, F1CalendarId: 10, pointsScheme: { name: 'F1 2026' }, isPublished: false, reservePointsForConstructors: true };
  const country = { name: 'Belgien', flagPath: '/uploads/be.png' };
  const track = { id: 20, name: 'Spa-Francorchamps', country: 'Belgien', countryRecord: country };
  const centralCalendar = { id: 10, name: 'KRL F1 Saison 17', rounds: [{ id: 30, roundNumber: 1, sortOrder: 1, F1TrackId: 20, hasSprint: false, isTestDay: false, track }] };
  const driver = { id: 7, name: 'Max Beispiel', roleF1Friday: true };
  const seasonTeam = { id: 8, sourceType: 'current', sourceId: 4, name: 'Mercedes', accentColor: '#00d2be', logoPath: null, drivers: [driver] };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'season-setup.ejs'), {
    ...layout, title: 'Saison-Assistent', leagues: [league], selectedLeague: league, discipline: 'f1',
    seasons: [season], selectedSeason: season, pointsSchemes: [{ id: 3, name: 'F1 2026' }], calendar: [],
    f1Teams: [{ id: 4, name: 'Mercedes', accentColor: '#00d2be', logoPath: null }], carProfiles: [],
    defaultTime: '20:00', tracks: [], eligibleDrivers: [driver],
    structure: { allDrivers: [driver], teams: [seasonTeam], unassignedDrivers: [] }, finishReady: false,
    centralCalendars: [centralCalendar], selectedCentralCalendar: centralCalendar, f1Games: [], lineupProtected: false
  });
  assert.match(html, /F1-SAISON ERSTELLEN/);
  assert.match(html, /setup-steps-eight/);
  assert.match(html, /LIGA AUSWÄHLEN/);
  assert.match(html, /RENNTERMINE FESTLEGEN/);
  assert.match(html, /PUNKTESYSTEM/);
  assert.match(html, /FAHRER AUSWÄHLEN/);
  assert.match(html, /AKTUELLE ODER HISTORISCHE TEAMS/);
  assert.match(html, /LINE-UP ERSTELLEN/);
  assert.match(html, /ABSCHLUSS/);
  assert.match(html, /value="20:00"/);
  assert.match(html, /name="dates\[30\]"/);
  assert.doesNotMatch(html, /Runde hinzufügen|Termin hinzufügen/i);
  assert.doesNotMatch(html, /name="F1TrackId"/);
  assert.equal((html.match(/name="PointsSchemeId"/g) || []).length, 1);
  assert.equal((html.match(/name="reservePointsForConstructors"/g) || []).length, 2);
  assert.match(html, /Ersatzfahrer-Punkte in Team-WM berücksichtigen/);
  assert.match(html, /Nicht zugeordnete Fahrer bleiben automatisch als Ersatzfahrer/);
});

test('Historische F1-Teams können im sechsten Schritt ausgewählt werden', async () => {
  const league = { id: 1, name: 'KRL Freitagsliga', type: 'f1', slug: 'freitag', accentColor: '#00aaff', raceDay: 'Freitag', raceTime: '20:00', logoPath: null };
  const season = { id: 2, name: 'Saison 2020', status: 'historical', accentColor: '#00aaff', PointsSchemeId: 3, pointsScheme: { name: 'F1 2020' }, isPublished: false };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'season-setup.ejs'), {
    ...layout, title: 'Saison-Assistent', leagues: [league], selectedLeague: league, discipline: 'f1',
    seasons: [season], selectedSeason: season, pointsSchemes: [{ id: 3, name: 'F1 2020' }], calendar: [],
    f1Teams: [{ id: 4, name: 'Mercedes', accentColor: '#00d2be', logoPath: null }],
    carProfiles: [{ id: 5, BaseTeamId: 4, name: 'Mercedes W11', seasonLabel: '2020', accentColor: '#00d2be', logoPath: null, baseTeam: { name: 'Mercedes' } }],
    defaultTime: '20:00', tracks: [], eligibleDrivers: [],
    structure: { allDrivers: [], teams: [], unassignedDrivers: [] }, finishReady: false
  });
  assert.match(html, /Historische Teams/);
  assert.match(html, /Mercedes W11/);
  assert.match(html, /gehört zu Mercedes/);
  assert.match(html, /value="historical:5"/);
});

test('Tabellen-Hub bündelt Pflege, Frontend und Downloads pro Saison', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'table-hub.ejs'), {
    ...layout, title: 'Tabellen-Hub', sections: [{
      league: { id: 1, name: 'KRL Freitagsliga', type: 'f1', accentColor: '#00aaff', logoPath: null },
      seasons: [{
        season: { id: 2, name: 'Saison 13', status: 'active' }, races: 8,
        editor: '/admin/race-editor?league=1&season=2', frontend: '/f1/freitag?season=2',
        downloads: [['Fahrer-WM', '/f1/freitag/download/fahrer-wm.csv?season=2'], ['GP-Results', '/f1/freitag/download/gp-results.csv?season=2']]
      }]
    }]
  });
  assert.match(html, /TABELLEN-HUB/);
  assert.match(html, /Tabelle pflegen/);
  assert.match(html, /Fahrer-WM/);
  assert.match(html, /GP-Results/);
});

test('Fahrerübersicht gruppiert Stammdaten automatisch nach Rang', async () => {
  const driver = { id: 7, name: 'Max Beispiel', aliasesText: 'Alter Name', platform: 'PC', nationality: 'CH', roleF1Friday: true };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'resource-list.ejs'), {
    ...layout, title: 'Fahrer-Pflege', adminBasePath: '/admin', resource: 'drivers',
    config: resourceConfig.drivers, entries: [driver],
    fieldOptions: { nationality: [{ value: 'CH', label: 'Schweiz (CH)' }] },
    selectedLeague: '', leagueOptions: [], selectedRank: '',
    rankGroups: [{ value: 'f1-friday', label: 'Stamm Freitag', entries: [driver] }]
  });
  assert.match(html, /Fahrer nach Rang filtern/);
  assert.match(html, /Stamm Freitag/);
  assert.match(html, /Max Beispiel/);
  assert.match(html, /Schweiz \(CH\)/);
});

test('Punkte je Platz erscheinen direkt im zugehörigen Punktesystem', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'resource-list.ejs'), {
    ...layout, title: 'Punktesysteme', adminBasePath: '/admin', resource: 'pointsSchemes',
    config: resourceConfig.pointsSchemes,
    entries: [{ id: 2, name: 'F1 2026', discipline: 'f1', validFrom: '2026-01-01', validUntil: null, fastestLapEnabled: true, fastestLapPoints: 1, allocations: [
      { id: 11, raceType: 'main', position: 1, points: 25 },
      { id: 12, raceType: 'sprint', position: 1, points: 8 }
    ] }],
    fieldOptions: {}, selectedLeague: '', leagueOptions: [], selectedRank: '', rankGroups: []
  });
  assert.match(html, /Hauptrennen/);
  assert.match(html, /Sprintrennen/);
  assert.match(html, /Platz 1/);
  assert.match(html, /pointAllocations\/new\?scheme=2/);
});

test('Vorhandene F1-Teams erhalten einen verpflichtenden Farbcode', () => {
  const accentColor = resourceConfig.teams.fields.find((field) => field.name === 'accentColor');
  assert.equal(accentColor.type, 'color');
  assert.equal(accentColor.required, true);
  assert.equal(models.Team.rawAttributes.accentColor.field, 'accent_color');
  assert.equal(models.Team.rawAttributes.accentColor.defaultValue, '#6ef2f2');
});

test('Stammdatenlisten bieten Mehrfachauswahl zum Löschen', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'resource-list.ejs'), {
    ...layout, title: 'Formel-1-Teams', adminBasePath: '/admin', resource: 'teams',
    config: resourceConfig.teams,
    entries: [{ id: 4, name: 'Mercedes', accentColor: '#00d2be', totalPoints: 120 }],
    fieldOptions: {}, selectedLeague: '', leagueOptions: [], selectedRank: '', rankGroups: []
  });
  assert.match(html, /id="bulk-delete-form"/);
  assert.match(html, /name="ids" value="4"/);
  assert.match(html, /Alle sichtbaren auswählen/);
  assert.match(html, /Auswahl löschen/);
});

test('Mehrfachlöschen entfernt nur ausgewählte Stammdatensätze', async () => {
  const originalFindAll = models.Team.findAll;
  const destroyed = [];
  models.Team.findAll = async () => [
    { id: 2, logoPath: null, destroy: async () => destroyed.push(2) },
    { id: 7, logoPath: null, destroy: async () => destroyed.push(7) }
  ];
  const req = { params: { resource: 'teams' }, body: { ids: ['2', '7', '7', 'ungueltig'] }, session: {}, adminBasePath: '/admin' };
  const res = { redirectPath: null, redirect(value) { this.redirectPath = value; } };
  try {
    await adminController.bulkRemove(req, res, () => {});
    assert.deepEqual(destroyed, [2, 7]);
    assert.equal(req.session.flash.message, '2 Einträge wurden gelöscht.');
    assert.equal(res.redirectPath, '/admin/teams');
  } finally {
    models.Team.findAll = originalFindAll;
  }
});

test('LMU-Autos sind eigene Stammdaten und werden nur LMU-Fahrern zugeordnet', () => {
  assert.ok(resourceConfig.lmuCars);
  assert.equal(resourceConfig.lmuCars.model, models.LmuCar);
  assert.equal(resourceConfig.lmuTeams.fields.some((field) => field.name === 'LmuCarId'), false);
  const driverCar = resourceConfig.drivers.fields.find((field) => field.name === 'LmuCarId');
  assert.equal(driverCar.relation.model, models.LmuCar);
  assert.equal(models.Driver.rawAttributes.LmuCarId.field, 'lmu_car_id');
});

test('KRL Icons werden nur mit Ernennungsmonat statt vollständigem Datum gepflegt', async () => {
  const appointedAt = resourceConfig.krlIcons.fields.find((field) => field.name === 'appointedAt');
  assert.equal(appointedAt.type, 'month');
  const values = { appointedAt: '2026-08' };
  await resourceConfig.krlIcons.prepareValues(values);
  assert.equal(values.appointedAt, '2026-08-01');
  const prepared = await resourceConfig.krlIcons.prepareEntry({ appointedAt: '2026-08-16' });
  assert.equal(prepared.appointedAt, '2026-08');
});

test('Rennkalender können als Testtag markiert werden', () => {
  assert.equal(models.F1CalendarRound.rawAttributes.isTestDay.defaultValue, false);
  assert.equal(models.RaceEvent.rawAttributes.isTestDay.defaultValue, false);
  assert.equal(resourceConfig.f1CalendarRounds.fields.some((field) => field.name === 'isTestDay'), true);
  assert.equal(resourceConfig.lmuSeasonCalendar.fields.some((field) => field.name === 'isTestDay'), true);
  assert.equal(resourceConfig.wdlSeasonCalendar.fields.some((field) => field.name === 'isTestDay'), true);
});

test('MariaDB-kompatibler Ersatzfahrerindex hat einen kurzen Namen', () => {
  const index = F1RaceLineupEntry.options.indexes.find((candidate) => candidate.fields.includes('replacement_for_driver_id'));
  assert.equal(index.name, 'uq_f1_lineup_replacement');
  assert.ok(index.name.length <= 64);
});
