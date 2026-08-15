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
  const drivers = ['Fahrer A', 'Fahrer B', 'Fahrer C', 'Fahrer D'].map((name, index) => ({
    id: index + 1, name, platform: 'PC', aliases: [], roleF1Friday: true, roleF1Reserve: false
  }));
  const league = { id: 1, name: 'KRL Freitagsliga', slug: 'freitag' };
  const team = { id: 1, name: 'Mercedes', car: 'Mercedes', logoPath: null };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin', 'team-rosters.ejs'), {
    ...layout, title: 'F1-Fahrerfelder', discipline: 'f1',
    config: { title: 'F1-Fahrerfelder', description: 'Test', minimum: 2 },
    leagues: [league], teams: [team], drivers,
    rosters: [{
      id: 1, league, team, assignments: drivers.map((driver, index) => ({ id: index + 1, DriverId: driver.id, roleName: 'Stammfahrer', driver }))
    }]
  });
  drivers.forEach((driver) => assert.match(html, new RegExp(driver.name)));
  assert.match(html, /<strong>4<\/strong> Fahrer · mindestens 2 ✓/);
  assert.match(html, /ME/);
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
    league: { id: 3, name: 'LMU', currentSeason: season.name, description: 'Langstrecke', raceDay: 'Samstag', raceTime: '19:00' },
    drivers: [], calendar: [], driverStandings: [], teamStandings: [], gpResults: [],
    cockpits: [{ carNumber: '7', vehicleClass: 'Hypercar', team: { name: 'Mercedes', car: 'Mercedes', logoPath: null }, drivers: cockpitDrivers }]
  });
  cockpitDrivers.forEach((driver) => assert.match(html, new RegExp(driver.name)));
  assert.match(html, /roster-logo-fallback">ME</);
});

test('WDL-Kachel kombiniert Liga- und zentrales Teamlogo', async () => {
  const season = { id: 1, name: '2026', status: 'active', category: null };
  const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'competition.ejs'), {
    ...layout, isAdmin: false, title: 'WDL', selectedSeason: season, seasons: [season],
    pageLeague: { description: 'Wettkampf', raceTime: '19:30', logoPath: null },
    leagues: [{ id: 1, name: 'KRL', abbreviation: 'KRL', logoPath: '/uploads/krl.png', websiteUrl: null, f1Team: { name: 'Mercedes', logoPath: '/uploads/mercedes.png' } }],
    races: [], calendar: [], standings: []
  });
  assert.match(html, /src="\/uploads\/krl\.png"/);
  assert.match(html, /src="\/uploads\/mercedes\.png"/);
  assert.match(html, /F1-Team: Mercedes/);
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
