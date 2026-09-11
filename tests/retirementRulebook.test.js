const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const config = require('../services/resourceConfig');
const { retirementRound, retirementRoles, applyReserveRetirement, planReserveRetirement } = require('../services/reserveRetirement');
const { parseRulebook, rulebookVersion } = require('../services/rulebook');
const root = path.join(__dirname, '..');

test('Ersatz-Ausstieg mappt Datum statt Rundennummer und erhält andere Stammränge', () => {
  assert.equal(retirementRound([{ sortOrder: 4, raceDate: '2026-09-04' }, { sortOrder: 5, raceDate: '2026-09-13' }], '2026-09-11'), 5);
  assert.equal(retirementRound([{ sortOrder: 4, raceDate: '2026-09-04' }], '2026-09-11'), null);
  assert.throws(() => retirementRound([{ sortOrder: 1 }], '2026-09-11'), /Renndaten/);
  assert.equal(retirementRoles({ roleF1Reserve: true }).roleFormerF1, true);
  assert.deepEqual([retirementRoles({ roleF1Friday: true }).roleFormerF1, retirementRoles({ roleF1Friday: true }).f1Role], [false, 'friday']);
});

test('Ausstieg beendet nur betroffene Reserve-Stints und ergänzt Legacy-Historie atomar', async (t) => {
  const calls = []; const transaction = {};
  t.mock.method(models.SeasonDriverStint, 'create', async (values, opts) => { calls.push(['stint', values]); assert.equal(opts.transaction, transaction); });
  t.mock.method(models.SeasonLineupEntry, 'destroy', async (opts) => { calls.push(['season', opts.where]); assert.equal(opts.transaction, transaction); });
  t.mock.method(models.F1RaceLineupEntry, 'destroy', async (opts) => { calls.push(['weekend', opts.where]); assert.equal(opts.transaction, transaction); });
  const stint = { fromRound: 2, toRound: null, async update(values) { Object.assign(this, values); } };
  const driver = { id: 7, roleF1Reserve: true, async update(values) { Object.assign(this, values); } };
  await applyReserveRetirement({ driver, transaction, plan: { scopes: [
    { season: { id: 1 }, round: 6, stints: [stint], plans: [{ race: { id: 60 } }] },
    { season: { id: 2 }, round: 4, stints: [], membership: null, hadLegacyHistory: true, plans: [{ race: { id: 40 } }] }
  ] } });
  assert.equal(stint.toRound, 5); assert.equal(stint.endReason, 'left');
  assert.equal(driver.roleF1Reserve, false); assert.equal(driver.roleFormerF1, true);
  assert.deepEqual(calls.filter(([type]) => type === 'weekend').map(([,v]) => [v.GrandPrixResultId, v.DriverId, v.roleType]), [[60,7,'reserve'],[40,7,'reserve']]);
  assert.equal(calls.find(([type]) => type === 'stint')[1].toRound, 3);
});

test('Fahrerbearbeitung weist manipulierte F1-Ränge ab und erhält den bisherigen Status', async (t) => {
  t.mock.method(models.Driver, 'findOne', async () => null);
  t.mock.method(models.Platform, 'findByPk', async () => ({ id: 1, name: 'PC' }));
  const existing = { id: 7, roleF1Reserve: true, roleF1Friday: false, roleF1Saturday: false, roleF1Sunday: false, roleFormerF1: false, f1Role: 'reserve' };
  const values = { name: 'Max', PlatformId: 1, roleF1Friday: true, roleFormerF1: true, roleF1Reserve: true };
  t.mock.method(models.League, 'findOne', async () => ({ id: 1 }));
  await config.drivers.prepareValues(values, { driverWizard: '1', driverViews: ['formerF1'] }, existing);
  assert.equal(Object.hasOwn(values, 'roleF1Friday'), false); assert.equal(values.roleFormerF1, false); assert.equal(values.roleF1Reserve, true); assert.equal(values.f1Role, 'reserve');
});

test('Regelwerk prüft IDs, Typen und Überschriften und erkennt konkurrierende Änderungen', () => {
  const row = { id: 1, title: '§ 1 Teilnahme', content: '<script>kein HTML</script>', sectionType: 'rule', headingLevel: 3, isPublished: true };
  assert.equal(parseRulebook(JSON.stringify([row]))[0].sortOrder, 0);
  assert.throws(() => parseRulebook(JSON.stringify([row, row])), /doppelter/);
  assert.throws(() => parseRulebook(JSON.stringify([{ ...row, headingLevel: 8 }])), /Überschriftentyp/);
  assert.notEqual(rulebookVersion([row]), rulebookVersion([{ ...row, content: 'Anders' }]));
});

test('Regelwerk-Editor fügt Abschnitte hinzu, verschiebt sie und speichert sichere Texte', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/partials/rulebook-editor.ejs'), { sections: [], rulebookVersion: 'v', draftSections: null });
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  try {
    dom.window.eval(fs.readFileSync(path.join(root, 'public/js/rulebook-editor.js'), 'utf8'));
    const d = dom.window.document; d.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    d.querySelector('[data-add-rule=rule]').click(); d.querySelector('[data-add-rule=penalty]').click();
    const blocks = d.querySelector('[data-rulebook-blocks]');
    blocks.children[0].querySelector('[data-field=title]').value = '<img src=x onerror=alert(1)>';
    blocks.children[1].querySelector('[data-field=title]').value = 'Strafe';
    blocks.children[1].querySelector('[data-block-action=up]').click();
    d.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    const saved = parseRulebook(d.querySelector('[data-rulebook-payload]').value);
    assert.equal(saved[0].sectionType, 'penalty'); assert.match(saved[1].title, /<img/);
    assert.equal(blocks.querySelector('img'), null);
    dom.window.confirm = () => true; blocks.children[1].querySelector('[data-block-action=remove]').click(); assert.equal(blocks.children.length, 1);
  } finally { dom.window.close(); }
});

test('Regelwerk speichern ist ohne Admin-Anmeldung gesperrt', async () => {
  const express = require('express'), request = require('supertest');
  const app = express(); app.use((req,res,next) => { req.session = {}; next(); }); app.use('/admin', require('../routes/adminRoutes'));
  const response = await request(app).post('/admin/rulebook');
  assert.equal(response.headers.location, '/admin/login');
});

test('Ausstiegsprüfung erfasst mehrere aktuelle Saisonkalender und blockiert bestätigte Folgerennen', async (t) => {
  const { Op } = require('sequelize');
  const seasons = [{ id: 1, name: 'Freitag', scopeSlug: 'freitag' }, { id: 2, name: 'Sonntag', scopeSlug: 'sonntag' }];
  const races = [
    { id: 10, SeasonId: 1, sortOrder: 1, raceDate: '2026-09-04', entries: [{ id: 100 }] },
    { id: 11, SeasonId: 1, sortOrder: 2, raceDate: '2026-09-11', entries: [] },
    { id: 20, SeasonId: 2, sortOrder: 3, raceDate: '2026-09-06', entries: [{ id: 200 }] },
    { id: 21, SeasonId: 2, sortOrder: 4, raceDate: '2026-09-13', entries: [] }
  ];
  let conflict = false;
  t.mock.method(models.Season, 'findAll', async ({ where }) => { assert.equal(where.status, 'active'); assert.equal(where.leagueType, 'f1'); return seasons; });
  t.mock.method(models.GrandPrixResult, 'findOne', async () => races[1]);
  t.mock.method(models.GrandPrixResult, 'findAll', async ({ where }) => {
    if (where.raceType === 'sprint') return [];
    return races.filter((r) => r.SeasonId === where.SeasonId && (!where.sortOrder || r.sortOrder >= where.sortOrder[Op.gte])).map((r) => ({ ...r, entries: conflict && r.id === 21 ? [{ id: 999 }] : r.entries }));
  });
  t.mock.method(models.SeasonDriverStint, 'findAll', async ({ where }) => where.SeasonId === 1 ? [{ id: 1, fromRound: 1, toRound: null }] : []);
  t.mock.method(models.SeasonLineupEntry, 'findOne', async () => null);
  t.mock.method(models.F1RaceLineupEntry, 'findAll', async ({ where }) => {
    const ids = where.GrandPrixResultId[Op.in];
    return [10,20].filter((id) => ids.includes(id)).map((id) => ({ id: id + 1000, GrandPrixResultId: id, DriverId: 7, roleType: 'reserve', includeInResults: true }));
  });
  const args = { driver: { id: 7, roleF1Reserve: true }, seasonId: 1, effectiveRound: 2 };
  const plan = await planReserveRetirement(args);
  assert.deepEqual(plan.scopes.map((s) => [s.season.id, s.round]), [[1,2],[2,4]]);
  assert.equal(plan.scopes[1].hadLegacyHistory, true);
  conflict = true;
  await assert.rejects(() => planReserveRetirement(args), /Sonntag.*bestätigt/);
});

test('Ehemalige Ersatzfahrer behalten Punkte und bekommen DNA in allen Folgerunden', () => {
  const { buildSeasonData } = require('../services/standings');
  const driver = { id: 7, name: 'Ersatz', roleFormerF1: true };
  const races = [1,2,3].map((round) => ({ id: round, sortOrder: round, title: 'R' + round, raceType: 'main', entries: round === 1 ? [{ DriverId: 7, position: 3, points: 15, driver }] : [] }));
  const lineups = [{ GrandPrixResultId: 1, DriverId: 7, roleType: 'reserve', includeInResults: true, driver }];
  const stints = [{ id: 1, DriverId: 7, roleType: 'reserve', fromRound: 1, toRound: 1, endReason: 'left', driver }];
  const data = buildSeasonData({ id: 1, name: 'Liga' }, races, [], lineups, {}, stints);
  const reserve = data.selectedHistory.reserveDrivers.find((row) => row.id === 7);
  assert.deepEqual(reserve.results.map((row) => row.main.value), ['P3','DNA','DNA']);
  assert.equal(reserve.total, 15); assert.equal(reserve.starts, 1);
});

test('Fahrerwechsel zeigt Ersatz-Ausstieg ohne Team-Pflicht und ohne Stammfahrerfelder', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/admin/season-driver-change.ejs'), {
    title: 'Fahrerwechsel', currentPath: '/admin', isAdmin: true, flash: null,
    leagues: [{ id: 1, name: 'Freitag' }], seasons: [{ id: 2, name: 'Saison' }], selectedLeague: { id: 1 }, selectedSeason: { id: 2 },
    teams: [], lineup: [], memberships: [], stints: [], completedRound: 1, rounds: [{ round: 2, title: 'GP' }], reserveDrivers: [{ id: 7, name: 'Max' }]
  });
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  try {
    dom.window.eval(fs.readFileSync(path.join(root, 'public/js/season-driver-change.js'), 'utf8'));
    const d = dom.window.document; d.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    const set = (selector, value) => { const input = d.querySelector(selector); input.value = value; input.dispatchEvent(new dom.window.Event('change')); };
    set('[data-change-round]', '2'); set('[data-change-operation]', 'retireReserve');
    assert.equal(d.querySelector('[data-stage=team]').hidden, true);
    assert.equal(d.querySelector('[data-change-team]').disabled, true);
    assert.equal(d.querySelector('[data-reserve-driver-field]').hidden, false);
    set('[data-retiring-reserve]', '7');
    assert.equal(d.querySelector('[data-review-button]').hidden, false);
    assert.equal(d.querySelector('[data-old-driver]').disabled, true);
    assert.equal(d.querySelector('[data-new-driver]').disabled, true);
  } finally { dom.window.close(); }
});
