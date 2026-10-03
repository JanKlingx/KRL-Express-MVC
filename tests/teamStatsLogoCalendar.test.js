const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const { buildTeamCareerStatistics } = require('../services/teamCareerStatistics');
const teams = [
  { id: 1, name: 'Mercedes', logoPath: '/uploads/mercedes.png' },
  { id: 2, name: 'Brawn GP', AggregationTeamId: 1 },
  { id: 3, name: 'Honda', AggregationTeamId: 2 },
  { id: 4, name: 'Ferrari' },
];
const race = { id: 10, discipline: 'f1', raceType: 'main', SeasonId: 5, LeagueId: 1, seasonRecord: { name: 'Saison 5', isPublished: true }, league: { name: 'Freitag' } };
const entry = (id, TeamId, extra = {}) => ({ id, TeamId, points: 26, position: 1, polePosition: true, fastestLap: true, driverOfTheDay: true, grandPrixResult: race, ...extra });
const total = (team, key, assigned = false) => (assigned ? team.aggregatedSeasons : team.seasons).reduce((sum, row) => sum + row[key], 0);

test('Teamstatistiken verwenden Ergebnisse einschließlich Sprint und identische Haupt-Renn-Auszeichnungen', () => {
  const results = [entry(1, 1), entry(2, 1, { points: 8, grandPrixResult: { ...race, raceType: 'sprint' } }), entry(3, 1, { position: null, status: 'DNF', points: 0, polePosition: false, fastestLap: false, driverOfTheDay: false }), entry(4, 1, { position: null, status: 'DNS', points: 0, polePosition: false, fastestLap: false, driverOfTheDay: false })];
  const before = JSON.stringify(results);
  const team = buildTeamCareerStatistics(teams, results).find(row => row.id === 1);
  assert.equal(total(team, 'points'), 34); assert.equal(total(team, 'starts'), 2);
  for (const key of ['wins', 'poles', 'fastestLaps', 'driverOfTheDays']) assert.equal(total(team, key), 1);
  assert.equal(JSON.stringify(results), before);
});

test('Mehrstufige Teamzuordnungen zählen Ergebnisse je Team nur einmal und bleiben abschaltbar', () => {
  const result = entry(2, 2);
  const stats = buildTeamCareerStatistics(teams, [entry(1, 1), result, result, entry(3, 3), entry(4, 4)]);
  const mercedes = stats.find(team => team.id === 1), brawn = stats.find(team => team.id === 2);
  assert.equal(total(mercedes, 'points'), 26); assert.equal(total(mercedes, 'points', true), 78);
  assert.equal(total(mercedes, 'poles', true), 3); assert.equal(total(brawn, 'poles', true), 2);
  assert.deepEqual(mercedes.includedTeams, ['Brawn GP', 'Honda']);
  const detached = buildTeamCareerStatistics(teams.map(team => team.id === 2 ? { ...team, AggregationTeamId: null } : team), [entry(1, 1), result, entry(3, 3)]);
  assert.equal(total(detached.find(team => team.id === 1), 'points', true), 26);
});

test('Teamstatistiken trennen Liga/Saison, lösen alte Namen auf und schließen Testtage sowie Entwürfe aus', () => {
  const stats = buildTeamCareerStatistics(teams, [
    entry(1, null, { teamName: ' mercedes ' }),
    entry(2, 1, { grandPrixResult: { ...race, LeagueId: 2, league: { name: 'Sonntag' } } }),
    entry(3, 1, { grandPrixResult: { ...race, seasonRecord: { isPublished: false } } }),
    entry(4, 1, { grandPrixResult: { ...race, calendarEvent: { isTestDay: true } } }),
    entry(5, 1, { grandPrixResult: { ...race, title: 'Testtag in Spa' } }),
    entry(6, 1, { grandPrixResult: { ...race, discipline: 'lmu' } }),
    entry(7, 1, { grandPrixResult: { ...race, seasonRecord: null } }),
    entry(8, 999, { teamName: 'Mercedes' }),
  ]);
  const team = stats.find(row => row.id === 1);
  assert.equal(team.seasons.length, 2); assert.equal(total(team, 'points'), 52);
  assert.equal(stats.find(row => row.id === 4).seasons.length, 0);
});

function metric(card, label) {
  return [...card.querySelectorAll('.career-metrics > div')].find(row => row.querySelector('dt').textContent === label).querySelector('dd').textContent;
}
test('Teamtab: Suche, Filter, Vergleich, Profil und Zuordnungsschalter funktionieren ohne doppelte Gesamtzahlen', async t => {
  const statistics = buildTeamCareerStatistics(teams, [entry(1, 1), entry(2, 2), entry(3, 3), entry(4, 4)]);
  const html = await ejs.renderFile('views/team-career-statistics.ejs', { title: 'Teamstatistiken', statistics });
  const dom = new JSDOM(html, { url: 'http://localhost/krl-statistik/teams?team=1', runScripts: 'outside-only' }); t.after(() => dom.window.close());
  dom.window.eval(fs.readFileSync('public/js/career-statistics.js', 'utf8'));
  const d = dom.window.document, get = key => d.querySelector(`[data-career-${key}]`);
  const mercedes = () => [...d.querySelectorAll('.career-driver')].find(card => card.querySelector('h3').textContent === 'Mercedes');
  assert.equal(d.querySelector('.statistics-tabs [aria-current]').textContent, 'F1-Teamstatistiken');
  assert.equal(get('profile').hidden, false); assert.match(get('profile').textContent, /TEAMPROFIL/);
  assert.equal(metric(mercedes(), 'Polepositions'), '3');
  const summaryPoles = [...get('summary').children].find(row => row.querySelector('span').textContent === 'Polepositions');
  assert.equal(summaryPoles.querySelector('strong').textContent, '4');
  get('aggregate').checked = false; get('aggregate').dispatchEvent(new dom.window.Event('change'));
  assert.equal(metric(mercedes(), 'Polepositions'), '1');
  for(let i=0;i<3;i++)d.querySelectorAll('.career-driver button[aria-pressed]')[i].click();
  assert.equal(d.querySelectorAll('.career-driver button[aria-pressed]')[3].disabled, true);
  get('search').value = 'Mercedes'; get('search').dispatchEvent(new dom.window.Event('input'));
  assert.equal(d.querySelectorAll('.career-driver').length, 1);
  get('league').value = 'Freitag'; get('league').dispatchEvent(new dom.window.Event('change'));
  get('season').value = 'Saison 5'; get('season').dispatchEvent(new dom.window.Event('change'));
  assert.equal(metric(mercedes(), 'Ergebnispunkte'), '26');
  get('reset').click(); assert.equal(get('aggregate').checked, true); assert.equal(d.querySelectorAll('.career-driver').length, 4);
});

test('Statistikdaten geben keine privaten Stammdaten aus und maskieren Teamnamen', async () => {
  const stats = buildTeamCareerStatistics([{ id: 1, name: '</script><script>bad()</script>', internal: 'secret' }], [entry(1, 1)]);
  assert.equal(stats[0].internal, undefined);
  const html = await ejs.renderFile('views/team-career-statistics.ejs', { title: 'Teams', statistics: stats });
  assert.doesNotMatch(html, /<script>bad/);
});

test('Veröffentlichter historischer F1-Kalender ist für Gäste sichtbar; aktive und unveröffentlichte Termine bleiben geschützt', async () => {
  const event = { id: 9, title: 'Archiv GP', circuit: 'Spa', startsAt: '2020-10-03T18:00:00Z', sortOrder: 1, isPublished: false };
  const data = { calendar: [event], league: { name: 'Freitag' }, emptyMessage: 'Keine Termine', isAdmin: false, selectedSeason: { id: 2, leagueType: 'f1', status: 'historical', isPublished: true, hideCalendarTime: true } };
  for(const isAdmin of [false, true]) {
    const html = await ejs.renderFile('views/partials/race-calendar.ejs', { ...data, isAdmin });
    assert.match(html, /Archiv GP/); assert.doesNotMatch(html, /Uhr/);
    if (!isAdmin) assert.doesNotMatch(html, /calendar-edit-pencil|calendar-completion-action/);
  }
  for (const selectedSeason of [{ ...data.selectedSeason, isPublished: false }, { ...data.selectedSeason, status: 'active' }, { ...data.selectedSeason, leagueType: 'lmu' }, null]) {
    const html = await ejs.renderFile('views/partials/race-calendar.ejs', { ...data, selectedSeason });
    assert.match(html, /Keine Termine/); assert.doesNotMatch(html, /Archiv GP/);
  }
});

const tx = { LOCK: { UPDATE: 'UPDATE' } };
function uploadMocks(t) {
  const team = { id: 1, logoPath: '/uploads/old.png', logoVariants: [{ path: '/uploads/old.png', label: 'Alt' }], async update(values, options) { assert.equal(options.transaction, tx); Object.assign(this, values); } };
  t.mock.method(models.sequelize, 'transaction', async run => run(tx));
  t.mock.method(models.Team, 'findOne', async options => { assert.equal(options.lock, 'UPDATE'); assert.equal(options.where.discipline, 'f1'); return team; });
  let counter=0;
  t.mock.method(require('../services/imageStorage'), 'saveImage', async () => `/uploads/new${++counter}.png`);
  const removed=[];
  t.mock.method(require('../services/imageStorage'), 'deleteUpload', async path => removed.push(path));
  return { team, removed };
}
const files = [{ originalname: 'Mercedes_2020.png', mimetype: 'image/png' }, { originalname: 'Mercedes-2026.png', mimetype: 'image/png' }];
test('Mehrfachupload ergänzt benannte Logos und erhält Standardlogo und Saisonzuordnungen', async t => {
  const { team } = uploadMocks(t);
  const changes = t.mock.method(models.SeasonTeam, 'update', async () => assert.fail('Keine Saisonänderung'));
  const req = { params: { teamId: 1 }, body: {}, files, session: {} };
  await require('../controllers/teamLogoController').upload(req, { redirect() {} });
  assert.equal(req.session.flash.type, 'success'); assert.equal(team.logoPath, '/uploads/old.png');
  assert.deepEqual(team.logoVariants.map(logo => logo.label), ['Alt', 'Mercedes 2020', 'Mercedes 2026']);
  assert.equal(changes.mock.callCount(), 0);
});

test('Fehler mitten im Upload entfernt angelegte Dateien und speichert kein Teilarchiv', async t => {
  const { team, removed } = uploadMocks(t);
  let n=0;
  t.mock.method(require('../services/imageStorage'), 'saveImage', async () => { if(++n===2)throw new Error('Ungültiges Bild');return '/uploads/new1.png'; });
  const req = { params: { teamId: 1 }, files, session: {} };
  await require('../controllers/teamLogoController').upload(req, { redirect() {} });
  assert.equal(req.session.flash.type, 'error'); assert.equal(team.logoVariants.length, 1);
  assert.deepEqual(removed, ['/uploads/new1.png']);
});

test('Direkter Saisonupload ändert nur das ausgewählte Saisonlogo und invalidiert die Tabellenrevision', async t => {
  const { team } = uploadMocks(t); let saved=false;
  const snapshot = { id: 71, SeasonId: 2, sourceType: 'current', sourceId: 1, async update(values, options) { assert.deepEqual(Object.keys(values), ['logoPath']);assert.equal(options.transaction,tx); Object.assign(this, values); } };
  t.mock.method(models.SeasonTeam, 'findByPk', async () => snapshot);
  t.mock.method(models.Season, 'findByPk', async () => ({ id: 2, leagueType: 'f1', scopeSlug: 'freitag', changed(field, value) { assert.equal(field,'updatedAt');assert.equal(value,true); }, async save() { saved=true; } }));
  t.mock.method(models.League, 'findOne', async () => ({ id: 4 }));
  const req = { params: { teamId: 1 }, body: { seasonTeamId: 71 }, files: files.slice(0,1), session: {} };let redirect;
  await require('../controllers/teamLogoController').upload(req, { redirect(url) { redirect=url; } });
  assert.equal(req.session.flash.type, 'success');assert.equal(snapshot.logoPath,'/uploads/new1.png');assert.equal(saved,true);
  assert.equal(team.logoPath,'/uploads/old.png');assert.match(redirect,/league=4&season=2&step=6/);
});

test('Direkter Saisonupload akzeptiert weder fremde Teamzuordnungen noch mehrere Bilder', async t => {
  const { team }=uploadMocks(t);
  t.mock.method(models.SeasonTeam,'findByPk',async()=>({id:71,SeasonId:2,sourceType:'current',sourceId:99}));
  for(const uploaded of [files,files.slice(0,1)]) {
    const req={params:{teamId:1},body:{seasonTeamId:71},files:uploaded,session:{}};
    await require('../controllers/teamLogoController').upload(req,{redirect(){}});
    assert.equal(req.session.flash.type,'error');assert.equal(team.logoVariants.length,1);
  }
});

test('Logobezeichnungen und Standardlogo können ohne neuen Upload gespeichert werden', async t => {
  t.mock.method(models.Team,'findOne',async()=>null);
  const values={name:'Mercedes',AggregationTeamId:null};
  await require('../services/resourceConfig').teams.prepareValues(values,{defaultLogo:'none',logoLabels:{'/uploads/old.png':'  Saison 2020  '}},{id:1,logoPath:'/uploads/old.png'});
  assert.equal(values.logoPath,null);assert.equal(values.logoVariants[0].label,'Saison 2020');
});

test('Mehrfachupload zeigt Dateinamen/Vorschauen und verhindert ungültige Dateien im Formular', async t => {
  const dom = new JSDOM('<form data-team-logo-upload><label data-team-logo-drop><input type="file" data-team-logo-files multiple></label><div data-team-logo-previews></div></form>',{runScripts:'outside-only'});t.after(()=>dom.window.close());
  let revoked=0;dom.window.URL.createObjectURL=()=> 'blob:preview';dom.window.URL.revokeObjectURL=()=>{revoked++;};
  dom.window.eval(fs.readFileSync('public/js/team-logos.js','utf8'));
  const d=dom.window.document,input=d.querySelector('input');
  Object.defineProperty(input,'files',{configurable:true,value:[new dom.window.File(['a'],'Logo 2020.png',{type:'image/png'}),new dom.window.File(['b'],'Logo 2026.png',{type:'image/png'})]});
  input.dispatchEvent(new dom.window.Event('change'));
  assert.equal(d.querySelectorAll('figure').length,2);assert.match(d.body.textContent,/Logo 2026.png/);
  Object.defineProperty(input,'files',{value:[new dom.window.File(['bad'],'file.txt',{type:'text/plain'})]});
  input.dispatchEvent(new dom.window.Event('change'));
  assert.equal(input.validity.customError,true);assert.equal(d.querySelectorAll('figure').length,0);assert.equal(revoked,2);
});

test('Saisonlogo-Felder behalten kleine und große IDs nach Express-Formularparsing', async t => {
  const snapshots = [2, 7, 71].map(id => ({ id, sourceType: 'current', sourceId: 1, logoPath: '/uploads/old.png', async update(values) { Object.assign(this, values); } }));
  t.mock.method(models.sequelize, 'transaction', async run => run(tx));
  t.mock.method(models.Season, 'findByPk', async () => ({ id: 9, leagueType: 'f1', scopeSlug: 'freitag', changed() {}, async save() {} }));
  t.mock.method(models.SeasonTeam, 'findAll', async () => snapshots);
  t.mock.method(models.Team, 'findOne', async () => ({ id: 1, logoPath: '/uploads/old.png' }));
  t.mock.method(models.League, 'findOne', async () => ({ id: 4 }));
  const body = require('qs').parse(new URLSearchParams(snapshots.map(row => [`teamLogos[t${row.id}]`, 'none'])).toString());
  const req = { params: { seasonId: 9 }, body, session: {} };
  await require('../controllers/seasonSetupController').saveTeamLogos(req, { redirect() {} });
  assert.equal(req.session.flash.type, 'success'); assert.ok(snapshots.every(row => row.logoPath === null));
});
