const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const { steamCode, platformLogos } = require('../services/teamContacts');
const dashboard = require('../services/adminDashboard');
const layout = { title: 'Test', currentPath: '/admin', isAdmin: true, flash: null };

test('Steam-Codes bleiben auch mit führenden Nullen und über Number.MAX_SAFE_INTEGER exakt', () => {
  for (const value of ['00123456789', '12345678901234567890', '0', '']) assert.equal(steamCode(value), value);
  assert.equal(steamCode(' 001 234\u00a0567\n'), '001234567');
  assert.equal(steamCode('１２３４５６'), '123456');
  for (const value of ['123x', '-12', '1.2', '1e8', '1'.repeat(21), ['123']]) assert.throws(() => steamCode(value));
});

test('Steam-Code wird beim Hinzufügen und Bearbeiten gespeichert; ungültige Eingaben überschreiben nichts', async t => {
  const controller = require('../controllers/teamGroupController');
  t.mock.method(models.sequelize, 'transaction', async fn => fn({ LOCK: { UPDATE: 'UPDATE' } }));
  t.mock.method(models.KrlTeam, 'findByPk', async () => ({ id: 2 }));
  t.mock.method(models.Driver, 'findByPk', async () => ({ id: 4 }));
  t.mock.method(models.KrlTeamAssignment, 'findOne', async () => null);
  let saved;
  const member = { id: 7, KrlTeamId: 2, DriverId: 4, async update(values) { saved = values; } };
  t.mock.method(models.KrlTeamAssignment, 'findByPk', async () => member);
  t.mock.method(models.KrlTeamAssignment, 'create', async values => { saved = values; });
  for (const memberId of [undefined, 7]) {
    const req = { params: { id: 2, memberId }, session: {}, body: { DriverId: '4', roleName: 'Leitung', steamFriendCode: '001 234 56789012345678', eaName: 'EA-Jan' } };
    await controller.saveMember(req, { redirect() {} });
    assert.equal(req.session.flash.type, 'success'); assert.equal(saved.steamFriendCode, '00123456789012345678'); assert.equal(saved.eaName, 'EA-Jan');
    const previous = saved; req.body.steamFriendCode = '123x';
    await controller.saveMember(req, { redirect() {} });
    assert.equal(req.session.flash.type, 'error'); assert.equal(saved, previous); assert.equal(req.session.teamMemberDraft.steamFriendCode, '123x');
  }
});

test('Unser Team rendert Stammdatenlogos und kopierbare Codes, das Formular nimmt Ziffern an', async t => {
  const logos = platformLogos([{ name: ' Steam ', logoPath: '/uploads/steam.png' }, { name: 'EA App', logoPath: '/uploads/ea.png' }]);
  const html = await ejs.renderFile('views/partials/home-team.ejs', { isAdmin: true, teamEditing: true, teamPlatformLogos: logos, teamDrivers: [], krlTeams: [{ id: 2, name: 'Leitung', assignments: [{ id: 7, driver: { name: 'Jan' }, steamFriendCode: '00123456789012345678', eaName: 'EA-Jan' }] }] });
  const dom = new JSDOM(html, { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const d = dom.window.document;
  assert.equal(d.querySelector('[data-copy="00123456789012345678"] img').getAttribute('src'), '/uploads/steam.png');
  assert.equal(d.querySelector('[data-copy="EA-Jan"] img').getAttribute('src'), '/uploads/ea.png');
  await new Promise(resolve => dom.window.addEventListener('load', resolve, { once: true }));
  dom.window.eval(fs.readFileSync('public/js/team-editor.js', 'utf8')); d.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const field = d.querySelector('[data-steam-code]'); field.value = '001 234 567'; field.dispatchEvent(new dom.window.Event('input'));
  assert.equal(field.value, '001234567'); assert.equal(field.checkValidity(), true);
  field.value = '123x'; field.dispatchEvent(new dom.window.Event('input')); assert.equal(field.checkValidity(), false);
  field.value = '123456789'; field.dispatchEvent(new dom.window.Event('input')); assert.equal(field.checkValidity(), true);
  assert.equal(platformLogos([]).Steam, null);
});

test('Transaktionen sind vollständig und eindeutig den vier Kategorien zugeordnet', () => {
  const groups = dashboard.groups(); assert.deepEqual(groups.map(group => group.name), ['Formel 1', 'LMU', 'WDL', 'Allgemein']);
  const keys = groups.flatMap(group => group.modules.map(([key]) => key)); assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(new Set(keys), new Set(dashboard.modules().map(([key]) => key)));
  for (const [name, key] of [['Formel 1', 'f1Weekend'], ['LMU', 'lmuWeekend'], ['WDL', 'wdlWeekend'], ['Allgemein', 'platforms']]) assert.ok(groups.find(group => group.name === name).modules.some(([id]) => id === key));
  assert.deepEqual(dashboard.favorites(['f1Weekend', 'f1Weekend', 'invalid', 'teamCategories']), ['f1Weekend']);
});

test('Favoriten werden pro angemeldetem Nutzer gesperrt, gespeichert und wieder entfernt', async t => {
  const controller = require('../controllers/adminController');
  const tx = { LOCK: { UPDATE: 'UPDATE' } }; const account = { dashboardFavorites: ['lmuWeekend'], async update(values, options) { assert.equal(options.transaction, tx); Object.assign(this, values); } };
  t.mock.method(models.sequelize, 'transaction', async fn => fn(tx));
  const lookup = t.mock.method(models.User, 'findByPk', async (id, options) => { assert.equal(id, 12); assert.equal(options.lock, 'UPDATE'); return account; });
  const req = { session: { userId: 12 }, body: { module: 'f1Weekend', favorite: '1' }, get() { return 'application/json'; } };
  let result; const res = { json(value) { result = value; }, status(code) { this.code = code; return this; } };
  await controller.setDashboardFavorite(req, res); assert.deepEqual(result.favorites, ['lmuWeekend', 'f1Weekend']);
  await controller.setDashboardFavorite(req, res); assert.equal(result.favorites.length, 2);
  req.body.favorite = '0'; await controller.setDashboardFavorite(req, res); assert.deepEqual(result.favorites, ['lmuWeekend']);
  const calls = lookup.mock.callCount(); req.body.module = 'invalid'; await controller.setDashboardFavorite(req, res); assert.equal(res.code, 400); assert.equal(lookup.mock.callCount(), calls);
});

test('Dashboard sucht über Kategorien, synchronisiert Sterne und behält Favoriten bei Speicherfehlern', async t => {
  const html = await ejs.renderFile('views/admin/dashboard.ejs', { ...layout, groups: dashboard.groups(), counts: {}, favorites: ['lmuWeekend'], adminBasePath: '/admin', dashboardEyebrow: 'KRL', dashboardTitle: 'Admin', dashboardDescription: 'Verwaltung' });
  const dom = new JSDOM(html, { url: 'http://localhost/admin', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const w = dom.window, d = w.document; let success = true, request;
  w.fetch = async (url, options) => { request = { url, options }; if (!success) throw new Error('Offline'); return { ok: true, headers: { get() { return 'application/json'; } }, async json() { return { favorites: ['lmuWeekend', 'f1Weekend'] }; } }; };
  w.eval(fs.readFileSync('public/js/admin-dashboard.js', 'utf8'));
  const search = d.querySelector('[data-dashboard-search]'); search.value = 'rennwochenende formel'; search.dispatchEvent(new w.Event('input'));
  assert.equal([...d.querySelectorAll('[data-dashboard-category] [data-module]')].filter(card => !card.hidden).length, 1);
  search.value = ''; search.dispatchEvent(new w.Event('input'));
  const form = d.querySelector('[data-dashboard-category] [data-module="f1Weekend"] form');
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await new Promise(resolve => setImmediate(resolve));
  assert.match(request.options.body.toString(), /module=f1Weekend&favorite=1/); assert.equal(d.querySelectorAll('[data-favorites-grid] [data-module]').length, 2);
  assert.equal(form.querySelector('button').getAttribute('aria-pressed'), 'true'); assert.equal(form.elements.favorite.value, '0');
  success = false; form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await new Promise(resolve => setImmediate(resolve));
  assert.equal(form.querySelector('button').getAttribute('aria-pressed'), 'true'); assert.equal(d.querySelector('[data-favorite-status]').textContent, 'Offline');
  search.value = 'xyzz-not-a-module'; search.dispatchEvent(new w.Event('input')); assert.equal(d.querySelector('[data-search-empty]').hidden, false);
});

test('Dashboard lädt nur die Favoriten des angemeldeten Kontos und erhält alle Transaktionslinks', async t => {
  const config = require('../services/resourceConfig');
  for (const model of new Set(Object.values(config).filter(c => !c.hidden).map(c => c.model))) t.mock.method(model, 'count', async () => 0);
  t.mock.method(models.User, 'findByPk', async (id, options) => { assert.equal(id, 12); assert.deepEqual(options.attributes, ['dashboardFavorites']); return { dashboardFavorites: ['f1Weekend'] }; });
  let data; await require('../controllers/adminController').dashboard({ session: { userId: 12 } }, { render(view, values) { data = values; } });
  assert.deepEqual(data.favorites, ['f1Weekend']); assert.equal(data.groups.length, 4);
  const html = await ejs.renderFile('views/admin/dashboard.ejs', { ...layout, ...data });
  const dom = new JSDOM(html); t.after(() => dom.window.close());
  assert.equal(dom.window.document.querySelector('[data-favorites-grid] a').getAttribute('href'), '/admin/race-weekend/f1');
  assert.equal(dom.window.document.querySelectorAll('[data-dashboard-category] [data-module]').length, dashboard.modules().length);
});

test('Historische F1-Teamkarten behalten die Alias-Auswahl unter den Fahrern', async t => {
  const season = { id: 1, name: '2020', status: 'historical' };
  const html = await ejs.renderFile('views/f1.ejs', { ...layout, seasons: [season], selectedSeason: season, league: { id: 1, name: 'Freitag', slug: 'freitag', accentColor: '#6ef28a' }, teams: [{ id: 2, name: 'Sauber', logoPath: '/uploads/historical.png', accentColor: '#00ff00', drivers: [{ id: 3, name: 'Saisonalias' }, { id: 4, name: 'Zweiter Fahrer' }] }], calendar: [], driverStandings: [], teamStandings: [], gpResults: [], history: { seasons: [], warning: null }, selectedHistory: null });
  const dom = new JSDOM(html); t.after(() => dom.window.close()); const d = dom.window.document;
  assert.equal(d.querySelector('.league-team-logo img').getAttribute('src'), '/uploads/historical.png');
  assert.equal(d.querySelector('[data-lineup-alias-driver="3"] strong').textContent.trim(), 'Saisonalias');
  assert.equal(d.querySelectorAll('[data-lineup-alias-driver]').length, 2);
});

test('Neue Favoritenspalte wird nur bei Bedarf angelegt', async t => {
  const qi = models.sequelize.getQueryInterface(), added = [];
  let existing = false; const stop = new Error('Ende des untersuchten Schemaabschnitts');
  t.mock.method(qi, 'describeTable', async name => {
    if (name === 'seasons') return { hide_calendar_time: {}, historical_grid: {}, driver_display_names: {} };
    if (name === 'users') return existing ? { dashboard_favorites: {} } : {};
    throw stop;
  });
  t.mock.method(qi, 'addColumn', async (table, name, definition) => { added.push({ table, name, definition }); });
  const { ensureSchema } = require('../services/schema');
  await assert.rejects(ensureSchema(), error => error === stop); existing = true;
  await assert.rejects(ensureSchema(), error => error === stop);
  assert.equal(added.length, 1); assert.equal(added[0].table, 'users'); assert.equal(added[0].name, 'dashboard_favorites'); assert.equal(added[0].definition.allowNull, true);
});
