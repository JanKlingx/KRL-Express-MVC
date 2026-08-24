const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

process.env.DB_HOST ||= 'localhost';
process.env.DB_NAME ||= 'krl';
process.env.DB_USER ||= 'krl';
process.env.DB_PASSWORD ||= 'krl';

const models = require('../models');
const root = path.join(__dirname, '..');
const views = path.join(root, 'views');
const layout = {
  currentPath: '/admin',
  isAdmin: true,
  adminRole: 'admin',
  adminHome: '/admin',
  flash: null,
};

test('F1Game ist migrationsfreundlich mit der bestehenden Season verknüpft', () => {
  assert.equal(models.F1Game.rawAttributes.name.unique, true);
  assert.equal(models.F1Game.rawAttributes.isActive.defaultValue, true);
  assert.equal(models.Season.rawAttributes.gameName.type.key, 'STRING');
  assert.equal(models.Season.rawAttributes.F1GameId.allowNull, true);
  assert.equal(models.Season.associations.f1Game.target, models.F1Game);
  assert.equal(models.F1Game.associations.seasons.target, models.Season);

  const schema = fs.readFileSync(path.join(root, 'services', 'schema.js'), 'utf8');
  assert.match(schema, /f1_games/);
  assert.match(schema, /f1_game_id/);
  assert.doesNotMatch(schema, /dropTable\(['"]f1_games/);
});

test('F1-Spiel-Pflege nutzt Upload, Aktivstatus und blockierbare Löschung', async () => {
  const html = await ejs.renderFile(path.join(views, 'admin', 'f1-games.ejs'), {
    ...layout,
    title: 'F1-Spiele pflegen',
    error: null,
    form: null,
    games: [{
      id: 1,
      name: 'EA SPORTS F1 26',
      logoPath: '/uploads/f126.png',
      isActive: true,
      sortOrder: 1,
      seasons: [{ id: 2, name: 'Saison 16' }],
    }],
  });
  assert.match(html, /name="image"/);
  assert.match(html, /data-upload-dropzone/);
  assert.match(html, /EA SPORTS F1 26/);
  assert.match(html, /disabled title="Wird noch von einer Saison verwendet"/);
});

test('Saisonverlauf zeigt 20 kompakte Runden, Punkte, Status und Spiel-Logo', async () => {
  const races = Array.from({ length: 20 }, (_, index) => ({
    round: index + 1,
    title: `Rennen ${index + 1}`,
    code: `R${index + 1}`,
    countryFlagPath: `/uploads/flag-${index + 1}.png`,
    countryName: `Land ${index + 1}`,
    hasSprint: index === 0,
    isCompleted: index < 3,
  }));
  const results = races.map((race, index) => ({
    main: index === 0
      ? { position: 1, points: 26, status: '' }
      : index === 1
        ? { position: 2, points: 0, status: 'DSQ' }
        : null,
    sprint: race.hasSprint ? { position: 3, points: 6, status: 'DNF' } : null,
  }));
  const driver = {
    position: 1,
    name: 'Lemi',
    team: 'Mercedes',
    teamLogoPath: '/uploads/mercedes.png',
    total: 26,
    gap: 0,
    average: 13,
    startRate: 67,
    failureRate: 0,
    results,
  };
  const reserve = {
    ...driver,
    position: 1,
    name: 'Tobi',
    promotedToRegular: true,
    promotedFromRound: 5,
    results: races.map((race, index) => ({
      main: index >= 4 ? { outsideStint: true, status: 'DNS', points: 0 } : null,
      sprint: race.hasSprint ? null : undefined,
    })),
  };
  const html = await ejs.renderFile(path.join(views, 'partials', 'season-history.ejs'), {
    history: { seasons: [{ id: 9 }] },
    selectedHistory: { name: 'Saison 16', races, drivers: [driver], reserveDrivers: [reserve] },
    selectedSeason: {
      accentColor: '#00d2be',
      gameName: 'Legacy F1',
      f1Game: { name: 'EA SPORTS F1 26', logoPath: '/uploads/f126.png' },
    },
    league: { name: 'Sonntagsliga', accentColor: '#00d2be', logoPath: '/uploads/krl.png' },
    isAdmin: true,
  });
  assert.equal((html.match(/class="sheet-race-head/g) || []).length, 40);
  assert.match(html, /\/uploads\/f126\.png/);
  assert.match(html, />26</);
  assert.match(html, />DNF</);
  assert.match(html, />DSQ</);
  assert.match(html, />SPR</);
  assert.match(html, /ab R5 Stammfahrer/);
  assert.match(html, /is-inactive/);
});

test('Race-Control schützt Aufstellung und Ergebnis serverseitig', () => {
  const lineup = fs.readFileSync(path.join(root, 'controllers', 'f1RaceLineupController.js'), 'utf8');
  const editor = fs.readFileSync(path.join(root, 'controllers', 'raceEditorController.js'), 'utf8');
  assert.match(lineup, /new Set\(driverIds\)\.size !== driverIds\.length/);
  assert.match(lineup, /new Set\(targetIds\)\.size !== targetIds\.length/);
  assert.match(lineup, /includeInResults === true/);
  assert.match(lineup, /Anwesenheit bestätigt/);
  assert.match(editor, /Bitte zuerst Aufstellung und Anwesenheitskontrolle vollständig abschließen/);
  assert.match(editor, /assignedTeam;/);
  assert.doesNotMatch(editor, /GrandPrixResultEntry\.destroy/);
});
