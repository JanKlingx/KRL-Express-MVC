const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

process.env.DB_HOST ||= 'localhost';
process.env.DB_NAME ||= 'krl';
process.env.DB_USER ||= 'krl';
process.env.DB_PASSWORD ||= 'krl';

const { sequelize, TeamRoster, TeamRosterDriver } = require('../models');

const layout = { currentPath: '/admin', isAdmin: true, flash: null };

test('Teamaufstellung zeigt mehr als zwei Fahrer und weist auf die Mindestzahl hin', async () => {
  const drivers = ['Fahrer A', 'Fahrer B', 'Fahrer C', 'Fahrer D', 'Fahrer E'].map((name, index) => ({
    id: index + 1, name, platform: 'PC', aliases: [], roleF1Friday: true, roleF1Reserve: false
  }));
  const league = { id: 1, name: 'KRL Freitagsliga', slug: 'freitag' };
  const team = { id: 1, name: 'Mercedes', accentColor: '#00d2be', car: 'Mercedes', logoPath: null };
  const availableTeam = { id: 2, name: 'Racing Bulls', accentColor: '#6692ff', car: 'Mercedes', logoPath: '/uploads/racing-bulls.png' };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'team-rosters.ejs'), {
    ...layout, title: 'F1-Fahrerfelder', discipline: 'f1',
    config: { title: 'F1-Fahrerfelder', description: 'Test', minimum: 2 },
    leagues: [league], selectedLeague: league, teams: [team, availableTeam], drivers,
    rosters: [{
      id: 1, TeamId: team.id, league, team, assignments: drivers.slice(0, 4).map((driver, index) => ({ id: index + 1, DriverId: driver.id, roleName: 'Stammfahrer', driver }))
    }]
  });
  drivers.forEach((driver) => assert.match(html, new RegExp(driver.name)));
  assert.match(html, /<strong>4<\/strong> Fahrer · mindestens 2 ✓/);
  assert.match(html, /option value="Fahrer E" data-driver-id="5"/);
  assert.match(html, /name="DriverId" data-driver-id/);
  assert.match(html, /option value="1" selected/);
  assert.match(html, /team-choice-card team-choice-assigned/);
  assert.match(html, /team-choice-card team-choice-available/);
  assert.match(html, /style="--team-color:#00d2be"/);
  assert.match(html, /name="TeamId" value="2"/);
  assert.match(html, /\+ Team hinzufügen/);
  assert.match(html, /− Team entfernen/);
  assert.match(html, /team-rosters\/f1\/1\?_method=DELETE/);
  assert.match(html, /Die zentralen Team-Stammdaten bleiben erhalten/);
  assert.match(html, /ME/);
});

test('Öffentliche F1-Teamkarte verwendet Teamfarbe, Logo-Wasserzeichen und linke Fahrernamen', async () => {
  const season = { id: 1, name: 'Saison 13', status: 'active', category: null };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'f1.ejs'), {
    ...layout, isAdmin: false, title: 'Freitagsliga', seasons: [season], selectedSeason: season,
    league: { id: 1, slug: 'freitag', name: 'Freitagsliga', currentSeason: season.name, accentColor: '#6ef2f2', logoPath: '/uploads/freitag.png', description: 'Testliga', raceDay: 'Freitag', raceTime: '20:00' },
    teams: [{ id: 2, name: 'Racing Bulls', accentColor: '#3671c6', car: 'Mercedes', logoPath: '/uploads/racing-bulls.png', drivers: [{ name: 'Fahrer A', platform: 'PC' }, { name: 'Fahrer B', platform: 'PC' }] }],
    calendar: [{ title: 'Belgien GP', circuit: 'Spa', startsAt: new Date('2026-08-20T18:00:00Z'), isTestDay: true }], driverStandings: [], teamStandings: [], gpResults: [], history: { seasons: [], warning: null }, selectedHistory: null
  });
  assert.match(html, /class="league-hero-logo" src="\/uploads\/freitag.png"/);
  assert.match(html, /class="race-calendar-card race-calendar-test"/);
  assert.match(html, /class="race-calendar-watermark" src="\/uploads\/freitag.png"/);
  assert.match(html, />TESTTAG</);
  assert.match(html, /class="f1-team-grid"/);
  assert.match(html, /class="f1-team-card" style="--team-color:#3671c6"/);
  assert.match(html, /class="f1-team-watermark" aria-hidden="true"/);
  assert.match(html, /src="\/uploads\/racing-bulls\.png" alt=""/);
  assert.match(html, /aria-label="Fahrer von Racing Bulls"/);
  assert.match(html, /Fahrer A/);
  assert.match(html, /Fahrer B/);
  assert.doesNotMatch(html, /f1-driver-dot/);
  assert.match(html, /data-png-title="Freitagsliga · Fahrer-WM"/);
  assert.match(html, /data-png-title="Freitagsliga · GP-Results"/);
  assert.doesNotMatch(html, /Mercedes/);
  assert.doesNotMatch(html, /Fahrer 1:/);
  assert.doesNotMatch(html, /· PC/);
});

test('Historische Saison verwendet Fahrersuche statt Teilnahme-Checkbox', async () => {
  const league = { id: 1, name: 'KRL Freitagsliga', slug: 'freitag' };
  const season = { id: 2, name: '2020', status: 'historical', category: null };
  const race = { id: 3, LeagueId: 1, SeasonId: 2, title: 'Spa', circuit: 'Spa', sortOrder: 1, pointsMode: 'database', league };
  const driver = { id: 7, name: 'Historischer Fahrer', platform: 'PC', aliases: [] };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'race-editor.ejs'), {
    ...layout, title: 'Saisonverlauf', leagues: [league], selectedLeague: league,
    seasons: [season], selectedSeason: season, races: [race], selectedRace: race,
    sprintRace: null, teams: [{ id: 1, name: 'Mercedes' }], statuses: ['', 'DNF'],
    availableDrivers: [driver], historicalDriverIds: [driver.id],
    rows: [{ driver, entry: null, sprintEntry: null, assignedTeam: null, isReserve: false }]
  });
  assert.match(html, /Historisches Fahrerfeld/);
  assert.match(html, /maximal 20 Fahrern/);
  assert.match(html, /type="search"/);
  assert.match(html, /type="hidden" name="rows\[7\]\[included\]" value="on"/);
  assert.doesNotMatch(html, /type="checkbox" name="rows\[7\]\[included\]"/);
});

test('LMU-Kachel verwendet das zentrale Team und zeigt mehr als drei Fahrer', async () => {
  const season = { id: 1, name: 'Saison 4', status: 'active', category: null };
  const cockpitDrivers = ['LMU A', 'LMU B', 'LMU C', 'LMU D'].map((name) => ({ name, rosterRole: 'Stammfahrer' }));
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'lmu.ejs'), {
    ...layout, isAdmin: false, title: 'LMU', selectedSeason: season, seasons: [season],
    league: { id: 3, name: 'LMU', currentSeason: season.name, accentColor: '#ff343f', logoPath: '/uploads/lmu.png', description: 'Langstrecke', raceDay: 'Samstag', raceTime: '19:00' },
    drivers: [], calendar: [], driverStandings: [], teamStandings: [], gpResults: [],
    cockpits: [{ carNumber: '7', vehicleClass: 'Hypercar', team: { name: 'Mercedes', car: null, logoPath: null, lmuCar: { manufacturer: 'Porsche', name: '963', vehicleClass: 'Hypercar', logoPath: '/uploads/porsche.png' } }, drivers: cockpitDrivers }]
  });
  cockpitDrivers.forEach((driver) => assert.match(html, new RegExp(driver.name)));
  assert.match(html, /roster-logo-fallback">ME</);
  assert.match(html, /Porsche 963/);
  assert.match(html, /src="\/uploads\/porsche.png"/);
  assert.match(html, /data-png-title="LMU · Fahrer-WM"/);
});

test('WDL-Kachel kombiniert Liga- und zentrales Teamlogo', async () => {
  const season = { id: 1, name: '2026', status: 'active', category: null };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'competition.ejs'), {
    ...layout, isAdmin: false, title: 'WDL', selectedSeason: season, seasons: [season],
    pageLeague: { name: 'Wettkampf der Ligen', description: 'Wettkampf', raceTime: '19:30', accentColor: '#ff343f', logoPath: '/uploads/wdl.png' },
    leagues: [{ id: 1, name: 'KRL', abbreviation: 'KRL', logoPath: '/uploads/krl.png', websiteUrl: null, f1Team: { name: 'Mercedes', logoPath: '/uploads/mercedes.png' } }],
    races: [], calendar: [], standings: []
  });
  assert.match(html, /src="\/uploads\/krl\.png"/);
  assert.match(html, /src="\/uploads\/mercedes\.png"/);
  assert.match(html, /F1-Team: Mercedes/);
  assert.match(html, /class="league-hero-logo" src="\/uploads\/wdl.png"/);
  assert.match(html, /data-png-title="Wettkampf der Ligen · Liga-Standings"/);
  assert.match(html, /data-png-title="Wettkampf der Ligen · Results"/);
});

test('KRL Icons besitzen eine eigene öffentliche Seite', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'icons.ejs'), {
    ...layout, isAdmin: false, title: 'KRL Icons',
    icons: [{ id: 1, text: 'Für besondere Verdienste', appointedAt: '2026-08-16', driver: { name: 'KRL Legende' } }]
  });
  assert.match(html, /HALL OF FAME/);
  assert.match(html, /UNSERE KRL ICONS/);
  assert.match(html, /KRL Legende/);
  assert.match(html, /Für besondere Verdienste/);
  assert.match(html, /August 2026/);
  assert.doesNotMatch(html, /16\. August 2026/);
  assert.doesNotMatch(html, /icon-hall-initial/);
  const css = require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /#e91e63/);
});

test('Öffentlicher Rennkalender fängt ungültige Altdaten ohne Absturz ab', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'partials', 'race-calendar.ejs'), {
    calendar: [{ title: 'Altes Rennen', circuit: 'Unbekannt', startsAt: '0000-00-00 00:00:00' }],
    league: { name: 'Freitagsliga', accentColor: '#6ef2f2', logoPath: null },
    emptyMessage: 'Keine Termine'
  });
  assert.match(html, /race-calendar-invalid/);
  assert.match(html, /TERMIN IM ADMIN PRÜFEN/);
  assert.doesNotMatch(html, /Invalid Date/);
});

test('Teamaufstellungen sortieren MariaDB-Spalten über den richtigen Alias', () => {
  const options = {
    include: [
      { association: TeamRoster.associations.team },
      { association: TeamRoster.associations.assignments, include: [{ association: TeamRosterDriver.associations.driver }] }
    ],
    order: [['sortOrder', 'ASC'], ['id', 'ASC'], [{ model: TeamRosterDriver, as: 'assignments' }, 'sortOrder', 'ASC']]
  };
  TeamRoster._validateIncludedElements(options);
  const sql = sequelize.dialect.queryGenerator.selectQuery(TeamRoster.getTableName(), options, TeamRoster);
  assert.match(sql, /ORDER BY `TeamRoster`\.`sort_order` ASC, `TeamRoster`\.`id` ASC, `assignments`\.`sort_order` ASC/);
  assert.doesNotMatch(sql, /``\.`sortOrder`/);
});
