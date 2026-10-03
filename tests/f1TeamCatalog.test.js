const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl';
process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const catalog = require('../services/f1Teams');
const config = require('../services/resourceConfig');
const setup = require('../controllers/seasonSetupController');
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const graph = () => [
  { id: 1, name: 'Audi', AggregationTeamId: null },
  { id: 2, name: 'Alfa Romeo', AggregationTeamId: 1 },
  { id: 3, name: 'Sauber', AggregationTeamId: 2 },
  { id: 4, name: 'Kick Sauber', AggregationTeamId: null },
];
function transactional(t) { t.mock.method(models.sequelize, 'transaction', async fn => fn(transaction)); }
function record(values, writes = []) {
  return { ...values, async update(changes, options) {
    assert.equal(options.transaction, transaction);
    writes.push({ id: this.id, changes }); Object.assign(this, changes); return this;
  } };
}

test('Zuordnung ist optional, erlaubt historische Teamketten und verhindert Kreise', () => {
  assert.equal(catalog.validateGraph(graph(), 4, ''), null);
  assert.equal(catalog.validateGraph(graph(), 4, null), null);
  assert.equal(catalog.validateGraph(graph(), 4, 3), 3);
  assert.throws(() => catalog.validateGraph(graph(), 1, 3), /Kreis/);
  assert.throws(() => catalog.validateGraph(graph(), 2, 2), /selbst/);
  assert.throws(() => catalog.validateGraph(graph(), 4, 99), /Formel-1-Team/);
  assert.throws(() => catalog.validateGraph(graph(), 4, 'abc'), /gültig/);
  assert.deepEqual(catalog.descendantIds(graph(), 1), [1, 2, 3]);
  assert.deepEqual(catalog.descendantIds(graph(), 4), [4]);
});

test('Punkteaggregation zählt Nachfolger und alte Namenseinträge einmal, Trennung wird sofort wirksam', async t => {
  const teams = graph();
  const results = [
    { TeamId: 1, teamName: 'Audi', points: 10 },
    { TeamId: 2, teamName: 'Alfa Romeo', points: 20 },
    { TeamId: 3, teamName: 'Sauber', points: 27 },
    { TeamId: null, teamName: 'Sauber', points: 5 },
    { TeamId: 4, teamName: 'Kick Sauber', points: 8 },
  ];
  t.mock.method(models.Team, 'findAll', async () => teams);
  t.mock.method(models.GrandPrixResultEntry, 'findAll', async options => {
    assert.equal(options.include[0].where.discipline, 'f1');
    const [byId, byName] = options.where[Op.or];
    return results.filter(row => byId.TeamId[Op.in].includes(row.TeamId) || (row.TeamId === null && byName.teamName[Op.in].includes(row.teamName)));
  });
  assert.deepEqual(await catalog.totalsFor(teams[0]), { totalPoints: 62, aggregationMembers: 'Alfa Romeo, Sauber' });
  assert.equal((await catalog.totalsFor(teams[1])).totalPoints, 52);
  teams[1].AggregationTeamId = null;
  assert.equal((await catalog.totalsFor(teams[0])).totalPoints, 10);
  assert.equal((await catalog.totalsFor(teams[1])).totalPoints, 52);
  assert.equal((await catalog.totalsFor(teams[3])).totalPoints, 8);
  assert.deepEqual(results.map(row => row.points), [10, 20, 27, 5, 8]);
});

test('Team speichern prüft Zuordnungen unter derselben Datenbanksperre erneut', async t => {
  transactional(t);
  t.mock.method(models.Team, 'findAll', async options => {
    assert.equal(options.transaction, transaction); assert.equal(options.lock, 'UPDATE'); return graph();
  });
  const entry = record({ id: 1 });
  await assert.rejects(catalog.saveTeam({ AggregationTeamId: 3 }, entry), /Kreis/);
  assert.equal(entry.AggregationTeamId, undefined);
  await catalog.saveTeam({ AggregationTeamId: '' }, entry);
  assert.equal(entry.AggregationTeamId, null);
});

test('Logoarchiv behält alte Uploads; Auswahl gilt nur für eigene Logos oder gespeichertes Saisonlogo', () => {
  const team = { logoPath: '/uploads/new.png', logoVariants: [{ path: '/uploads/old.png', label: '2020' }] };
  assert.deepEqual(catalog.addLogo(team, '/uploads/new.png').map(logo => logo.path), ['/uploads/new.png', '/uploads/old.png']);
  assert.equal(catalog.chooseLogo(team, '/uploads/old.png'), '/uploads/old.png');
  assert.equal(catalog.chooseLogo(team, '', '/uploads/season.png'), '/uploads/season.png');
  assert.equal(catalog.chooseLogo(team, '/uploads/season.png', '/uploads/season.png'), '/uploads/season.png');
  assert.equal(catalog.chooseLogo(team, 'default'), '/uploads/new.png');
  assert.equal(catalog.chooseLogo(team, 'none'), null);
  assert.throws(() => catalog.chooseLogo(team, '/uploads/foreign.png'), /gehört nicht/);
});

test('Migration erhält Zuordnung, Saison-IDs, Logos, Fahrerpunkte und ist wiederholbar', async t => {
  transactional(t);
  const writes = [], teams = [record({ id: 1, name: 'Audi' }, writes)];
  const profiles = [
    record({ id: 11, name: 'Sauber', BaseTeamId: 1, logoPath: '/uploads/old.png', seasonLabel: '2020' }, writes),
    record({ id: 12, name: 'Jordan', BaseTeamId: null, logoPath: null }, writes),
    record({ id: 13, name: 'Audi', BaseTeamId: 1, logoPath: '/uploads/older.png' }, writes),
  ];
  const entries = [record({ id: 41, TeamId: 1, teamName: 'Sauber', DriverId: 7, GrandPrixResultId: 8, points: 27, position: 1, fastestLap: true }, writes)];
  const snapshots = [{ id: 71, sourceType: 'historical', sourceId: 11, name: 'Sauber', logoPath: '/uploads/season.png' }];
  const originalSnapshots = JSON.stringify(snapshots);
  const lineupWrites = [];
  t.mock.method(models.F1CarProfile, 'findAll', async () => profiles);
  t.mock.method(models.Team, 'findOne', async options => teams.find(team => team.name === options.where.name));
  t.mock.method(models.Team, 'create', async (values, options) => {
    assert.equal(options.transaction, transaction); const row = record({ ...values, id: teams.length + 1 }, writes); teams.push(row); return row;
  });
  t.mock.method(models.GrandPrixResultEntry, 'findAll', async options => {
    assert.equal(options.include[0].where.discipline, 'f1'); return entries.filter(e => e.teamName === options.where.teamName);
  });
  t.mock.method(models.F1RaceLineupEntry, 'update', async (values, options) => {
    assert.equal(options.transaction, transaction); lineupWrites.push({ values, where: options.where });
  });
  t.mock.method(models.SeasonTeam, 'findAll', async options => snapshots.filter(s => s.sourceId === options.where.sourceId));
  await catalog.migrateLegacyTeams();
  const sauber = teams.find(team => team.name === 'Sauber');
  assert.equal(sauber.AggregationTeamId, 1);
  assert.equal(profiles[0].UnifiedTeamId, sauber.id);
  assert.equal(entries[0].TeamId, sauber.id);
  assert.equal(entries[0].points, 27); assert.equal(entries[0].position, 1); assert.equal(entries[0].fastestLap, true); assert.equal(entries[0].DriverId, 7);
  assert.equal(teams.find(team => team.name === 'Jordan').AggregationTeamId, null);
  assert.equal(profiles[2].UnifiedTeamId, 1); assert.equal(teams[0].AggregationTeamId, undefined);
  assert.deepEqual(catalog.logosFor(sauber).map(l => l.path), ['/uploads/old.png', '/uploads/season.png']);
  assert.equal(JSON.stringify(snapshots), originalSnapshots);
  assert.ok(lineupWrites.some(write => write.where.SeasonTeamId === 71 && write.values.TeamId === sauber.id));
  const previousWrites = writes.length, previousLineupWrites = lineupWrites.length;
  await catalog.migrateLegacyTeams();
  assert.equal(teams.length, 3); assert.equal(writes.length, previousWrites); assert.equal(lineupWrites.length, previousLineupWrites);
});

test('Alte Saisonverweise verwenden eigene Teamidentität auch nach Entfernen der Aggregation', async t => {
  t.mock.method(models.F1CarProfile, 'findByPk', async () => ({ id: 11, name: 'Sauber', UnifiedTeamId: 3, BaseTeamId: 1 }));
  t.mock.method(models.Team, 'findByPk', async () => ({ id: 3, name: 'Sauber', AggregationTeamId: null, logoPath: '/uploads/new.png' }));
  const source = { sourceType: 'historical', sourceId: 11 };
  assert.equal(await catalog.identityFor(source), 3);
  assert.equal(await require('../services/seasonDriverChange').actualTeamIdForSeasonTeam(source), 3);
  const resolved = await require('../services/f1Season').resolveTeamToken('historical:11');
  assert.equal(resolved.BaseTeamId, 3); assert.equal(resolved.name, 'Sauber');
  assert.equal(resolved.logoPath, '/uploads/new.png');
});

function mockSeason(t, status = 'active') {
  transactional(t);
  const season = { id: 2, leagueType: 'f1', scopeSlug: 'freitag', status, isPublished: status === 'active', historicalGrid: { rows: [{ teamId: 71, cells: { 1: { position: 1 } } }] }, changed() {}, async save(options) { assert.equal(options.transaction, transaction); } };
  t.mock.method(models.Season, 'findByPk', async () => season);
  t.mock.method(models.League, 'findOne', async () => ({ id: 1 }));
  const snapshot = record({ id: 71, SeasonId: 2, sourceType: 'historical', sourceId: 11, name: 'Sauber 2020', logoPath: '/uploads/old.png' });
  t.mock.method(models.SeasonTeam, 'findAll', async () => [snapshot]);
  t.mock.method(models.F1CarProfile, 'findByPk', async () => ({ id: 11, name: 'Sauber', UnifiedTeamId: 3, BaseTeamId: 1 }));
  const team = { id: 3, name: 'Sauber', logoPath: '/uploads/new.png', logoVariants: [{ path: '/uploads/old.png', label: '2020' }] };
  t.mock.method(models.Team, 'findByPk', async () => team);
  t.mock.method(models.Team, 'findOne', async () => team);
  return { season, snapshot, team };
}

test('Saisonlogo lässt sich nach Veröffentlichung ändern ohne Line-up, Ergebnis oder anderes Saisonlogo anzufassen', async t => {
  const { season, snapshot, team } = mockSeason(t);
  const before = JSON.stringify(season.historicalGrid);
  const req = { params: { seasonId: 2 }, body: { teamLogos: { 71: 'none' } }, session: {} };
  let redirect;
  const results = t.mock.method(models.GrandPrixResultEntry, 'update', async () => assert.fail('Keine Ergebnisänderung'));
  const lineup = t.mock.method(models.SeasonLineupEntry, 'update', async () => assert.fail('Keine Line-up-Änderung'));
  await setup.saveTeamLogos(req, { redirect(url) { redirect = url; } });
  assert.equal(req.session.flash.type, 'success'); assert.equal(snapshot.logoPath, null);
  assert.equal(snapshot.id, 71); assert.equal(snapshot.name, 'Sauber 2020');
  assert.equal(team.logoPath, '/uploads/new.png'); assert.equal(JSON.stringify(season.historicalGrid), before);
  assert.equal(results.mock.callCount(), 0); assert.equal(lineup.mock.callCount(), 0);
  assert.match(redirect, /season=2&step=6#setup-teams/);
});

test('Saisonlogo-Endpunkt weist fremde Saisonteams und fremde Logo-Dateien zurück', async t => {
  const { snapshot } = mockSeason(t);
  for (const teamLogos of [{ 99: 'none' }, { 71: '/uploads/foreign.png' }]) {
    const req = { params: { seasonId: 2 }, body: { teamLogos }, session: {} };
    await setup.saveTeamLogos(req, { redirect() {} });
    assert.equal(req.session.flash.type, 'error'); assert.equal(snapshot.logoPath, '/uploads/old.png');
  }
});

test('Erneute Teamauswahl behält bestehende historische Saison-ID und Datenreferenzen', async t => {
  const { season, snapshot } = mockSeason(t, 'historical');
  t.mock.method(models.SeasonDriverStint, 'findAll', async () => []);
  t.mock.method(models.GrandPrixResult, 'findAll', async () => []);
  const create = t.mock.method(models.SeasonTeam, 'create', async () => assert.fail('Vorhandenes Team wiederverwenden'));
  const req = { params: { seasonId: 2 }, body: { teamTokens: ['current:3'], teamLogos: { 'current:3': '/uploads/new.png' } }, session: {} };
  await setup.assignTeams(req, { redirect() {} });
  assert.equal(req.session.flash.type, 'success'); assert.equal(snapshot.id, 71);
  assert.equal(snapshot.sourceType, 'historical'); assert.equal(snapshot.sourceId, 11);
  assert.equal(snapshot.name, 'Sauber 2020'); assert.equal(snapshot.logoPath, '/uploads/new.png');
  assert.equal(season.historicalGrid.rows[0].teamId, 71); assert.equal(create.mock.callCount(), 0);
});

test('Verwendete historische Teams bleiben gegen versehentliches Löschen geschützt', async t => {
  t.mock.method(models.F1CarProfile, 'findAll', async () => [{ id: 11 }]);
  await assert.rejects(config.teams.beforeRemove({ id: 3 }), /historischen Verknüpfung/);
});

test('Zusätzlicher Upload bewahrt Logoarchiv und eine spätere Standardauswahl ist unabhängig', async t => {
  t.mock.method(models.Team, 'findOne', async () => null);
  const entry = { id: 3, name: 'Sauber', logoPath: '/uploads/old.png' };
  const values = { name: 'Sauber', AggregationTeamId: '' };
  await config.teams.prepareValues(values, {}, entry);
  config.teams.prepareUpload(values, '/uploads/new.png', entry, { logoLabel: '2026' });
  assert.equal(values.AggregationTeamId, null);
  assert.deepEqual(values.logoVariants.map(l => l.path), ['/uploads/old.png', '/uploads/new.png']);
  await config.teams.prepareValues(values, { defaultLogo: '/uploads/old.png' }, { ...entry, logoPath: '/uploads/new.png', logoVariants: values.logoVariants });
  assert.equal(values.logoPath, '/uploads/old.png');
});

test('Archiviertes Logo wird beim Hochladen eines neuen Logos nicht von der Platte entfernt', async t => {
  for (const model of [models.SeasonTeam, models.Team, models.F1CarProfile]) t.mock.method(model, 'count', async () => 0);
  t.mock.method(models.Team, 'findAll', async () => [{ logoVariants: [{ path: '/uploads/abcd.png', label: '2020' }] }]);
  const unlink = t.mock.method(require('node:fs/promises'), 'unlink', async () => assert.fail('Archivlogo erhalten'));
  await require('../services/imageStorage').deleteUpload('/uploads/abcd.png');
  assert.equal(unlink.mock.callCount(), 0);
});

test('Gemeinsame Teammaske zeigt optionale Zuordnung und mehrere auswählbare Logos', async () => {
  const html = await ejs.renderFile('views/admin/resource-form.ejs', {
    currentPath: '/admin', isAdmin: true, flash: null, title: 'Formel-1-Teams', adminBasePath: '/admin', returnHref: '/admin/teams', resource: 'teams', config: config.teams,
    entry: { id: 3, name: 'Sauber', logoPath: '/uploads/new.png', logoVariants: [{ path: '/uploads/old.png', label: '2020' }, { path: '/uploads/new.png', label: '2026' }] },
    error: null, duplicateDriver: null, fieldOptions: { AggregationTeamId: [{ value: 2, label: 'Alfa Romeo' }] },
  });
  const dom = new JSDOM(html); const d = dom.window.document;
  assert.equal(d.querySelector('[name="AggregationTeamId"]').required, false);
  assert.equal(d.querySelectorAll('[name="defaultLogo"]').length, 3);
  assert.equal(d.querySelector('[name="defaultLogo"]:checked').value, '/uploads/new.png');
  assert.match(d.body.textContent, /Alfa Romeo/); dom.window.close();
});

test('Saisonmaske bietet Logoänderung bei geschütztem Line-up und wählt migrierte Teams korrekt vor', async () => {
  const league = { id: 1, name: 'Freitagsliga', type: 'f1', slug: 'freitag' };
  const season = { id: 2, name: 'Saison 2026', status: 'active', isPublished: true };
  const team = { id: 3, name: 'Sauber', logoPath: '/uploads/new.png', logoVariants: [{ path: '/uploads/old.png', label: '2020' }] };
  const snapshot = { id: 71, sourceType: 'historical', sourceId: 11, catalogToken: 'current:3', name: 'Sauber 2020', logoPath: '/uploads/old.png', logoOptions: catalog.logosFor(team), drivers: [] };
  const html = await ejs.renderFile('views/admin/season-setup.ejs', {
    currentPath: '/admin', isAdmin: true, flash: null, title: 'Saison', leagues: [league], selectedLeague: league,
    discipline: 'f1', seasons: [season], selectedSeason: season, pointsSchemes: [], calendar: [], f1Teams: [team], carProfiles: [],
    defaultTime: '20:00', structure: { allDrivers: [], teams: [snapshot], unassignedDrivers: [] }, lineupProtected: true,
    wizard: { current: 6, available: 8 },
  });
  const dom = new JSDOM(html); const d = dom.window.document;
  assert.equal(d.querySelector('[name="teamTokens"]').checked, true);
  assert.equal(d.querySelector('#setup-teams').hidden, false);
  const logoForm = d.querySelector('form[action="/admin/season-setup/2/team-logos"]');
  assert.ok(logoForm); assert.equal(logoForm.closest('[inert]'), null);
  assert.equal(logoForm.querySelectorAll('[type="radio"]').length, 3);
  assert.equal(logoForm.querySelector('[type="radio"]:checked').value, '/uploads/old.png');
  assert.equal(d.querySelector('[name="images"]').form.id, 'season-logo-upload-71');
  assert.equal(logoForm.querySelector('[name="images"]').form === logoForm, false);
  assert.ok(d.querySelector('form[action="/admin/season-setup/2/teams"]').hasAttribute('inert'));
  dom.window.close();
});
