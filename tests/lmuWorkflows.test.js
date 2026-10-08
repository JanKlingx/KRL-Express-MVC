const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const m = require('../models');
const s = require('../services/lmuSeason');
const w = require('../services/lmuWeekend');
const calendar = require('../services/lmuSeasonCalendar');
const { buildSeasonData } = require('../services/standings');
const { summarizeDriverEntries } = require('../services/driverStats');
const root = path.join(__dirname, '..');
const tx = { LOCK: { UPDATE: 'UPDATE' } };
const league = { id: 7, slug: 'lmu', type: 'lmu', name: 'LMU', accentColor: '#abcdef', currentSeason: 'S5' };
const season = { id: 12, leagueType: 'lmu', scopeSlug: 'lmu', status: 'active', name: 'S5', isPublished: true, lmuManaged: true, PointsSchemeId: 9, accentColor: '#abcdef', reservePointsForConstructors: true, lmuGame: { name: 'LMU', logoPath: '/uploads/lmu.png' } };
const team = { id: 20, sourceType: 'lmu', sourceId: 30, SeasonId: 12, name: 'Mercedes', accentColor: '#123456', logoPath: '/team.png' };
const driver = { id: 1, name: 'Original', lmuDisplayName: 'LMU Alias', viewLmu: true, roleLmuRegular: true, aliases: [] };
const reserve = { id: 2, name: 'Ersatz', viewLmu: true, roleLmuReserve: true };
const scheme = { id: 9, discipline: 'lmu', fastestLapEnabled: true, fastestLapPoints: 1, polePositionEnabled: true, polePositionPoints: 2, allocations: [{ raceType: 'main', position: 1, points: 25 }, { raceType: 'main', position: 2, points: 18 }] };
const race = { id: 50, discipline: 'lmu', raceType: 'main', SeasonId: 12, LeagueId: 7, season: 'S5', title: 'Spa', circuit: 'Spa', sortOrder: 1, raceDate: '2026-10-01', seasonRecord: season, league };
const stint = { id: 1, SeasonId: 12, DriverId: 1, roleType: 'regular', SeasonTeamId: 20, fromRound: 1, toRound: null, seasonTeam: team, driver };
const entry = { id: 8, GrandPrixResultId: 50, DriverId: 1, TeamId: 30, SeasonTeamId: 20, roleType: 'regular', status: 'anwesend', attendanceStatus: 'anwesend', includeInResults: true, driver, team };
const record = data => ({ ...data, async update(values) { Object.assign(this, values); }, async destroy() { this.deleted = true; } });
function mock(t, model, method, fn) { t.mock.method(m[model], method, fn); }
function database(t, overrides = {}) {
  const data = { entries: [record(entry)], results: [], stints: [stint], race, ...overrides };
  t.mock.method(m.sequelize, 'transaction', async fn => fn(tx));
  mock(t, 'Season', 'findByPk', async () => record(data.race.seasonRecord));
  mock(t, 'Season', 'findAll', async () => []);
  mock(t, 'Driver', 'findAll', async () => [driver, reserve]);
  mock(t, 'Driver', 'findByPk', async id => [driver, reserve].find(d => d.id === Number(id)));
  mock(t, 'GrandPrixResult', 'findByPk', async () => data.race);
  mock(t, 'GrandPrixResult', 'findAll', async () => []);
  mock(t, 'SeasonTeam', 'findAll', async () => [team]);
  mock(t, 'SeasonDriverStint', 'findAll', async () => data.stints);
  mock(t, 'F1RaceLineupEntry', 'findAll', async () => data.entries);
  mock(t, 'GrandPrixResultEntry', 'findAll', async () => data.results);
  mock(t, 'PointsScheme', 'findByPk', async () => scheme);
  mock(t, 'PenaltyEntry', 'findAll', async () => []);
  mock(t, 'F1PenaltySetting', 'findOne', async () => null);
  return data;
}
function resultData(entries = [entry]) { return { race, season, entries, teams: [team], scheme, penalty: { banned: new Set() } }; }

test('LMU-Punkte kommen aus dem Saison-System inklusive FL und Pole; Status/Testtag geben null', () => {
  assert.equal(s.points(scheme, { position: 1, fastestLap: true, polePosition: true }), 28);
  for (const status of ['DNA', 'DNS', 'S', 'DNF', 'DSQ']) assert.equal(s.points(scheme, { position: 1, fastestLap: true, status }), 0);
  assert.equal(s.points(scheme, { position: 1 }, true), 0);
});
test('LMU-Ergebnisse verknüpfen Fahrer, Alias, Team und Auszeichnungen ohne manuelle Punkte', () => {
  const rows = w.resultRows(resultData(), { results: { d1: { position: '1', points: 999, fastestLap: 'on', polePosition: 'on', driverOfTheDay: 'on' } } });
  assert.equal(rows[0].points, 28); assert.equal(rows[0].DriverId, 1); assert.equal(rows[0].TeamId, 30); assert.equal(rows[0].driverName, 'LMU Alias'); assert.equal(rows[0].driverOfTheDay, true);
  const stats = summarizeDriverEntries(rows.map(row => ({ ...row, grandPrixResult: race }))).lmu;
  assert.equal(stats.wins, 1); assert.equal(stats.poles, 1); assert.equal(stats.averagePoints, 28);
});
test('LMU-DNS und Rennsperre bleiben punktelos; unbestätigte Anwesenheit verhindert Ergebnisse', () => {
  const data = resultData([{ ...entry, includeInResults: false }, { ...entry, DriverId: 2, status: 'rennsperre', driver: reserve, includeInResults: false }]);
  const rows = w.resultRows(data, { results: { d1: { position: 1, fastestLap: 'on' } } });
  assert.deepEqual(rows.map(r => [r.status, r.position, r.points, r.fastestLap]), [['DNS', null, 0, false], ['S', null, 0, false]]);
  assert.throws(() => w.resultRows(resultData([{ ...entry, attendanceStatus: null }]), {}), /Anwesenheit/);
});
test('LMU-Doppelplatzierungen, doppelte Auszeichnungen und manipulierte Status werden abgewiesen', () => {
  const data = resultData([entry, { ...entry, DriverId: 2, driver: reserve }]);
  assert.throws(() => w.resultRows(data, { results: { d1: { position: 1 }, d2: { position: 1 } } }), /doppelt/);
  assert.throws(() => w.resultRows(data, { results: { d1: { position: 1, fastestLap: 'on' }, d2: { position: 2, fastestLap: 'on' } } }), /nur einmal/);
  assert.throws(() => w.resultRows(resultData(), { results: { d1: { position: 1, status: 'DNS' } } }), /Ergebnisstatus/);
});
test('LMU-Kalender validiert Berliner Zeit, Titel und unmögliche Datumswerte', () => {
  const rows = s.roundsFrom({ r0: { title: 'Spa', circuit: 'Spa', startsAt: '2026-10-01T20:00', isTestDay: 'on' } });
  assert.equal(rows[0].startsAt, '2026-10-01T18:00:00.000Z'); assert.equal(rows[0].isTestDay, true);
  assert.throws(() => s.roundsFrom({ r0: { title: 'Spa', circuit: 'Spa', startsAt: '2026-02-31T20:00' } }), /Termin/);
  assert.throws(() => s.roundsFrom({}), /1 bis 100/);
});
test('LMU-Rennwochenende lehnt F1-Rennen vor jedem Schreibzugriff ab', async t => {
  database(t, { race: { ...race, discipline: 'f1' } });
  await assert.rejects(w.saveLineup(50, {}), /LMU-Rennen/);
  await assert.rejects(w.saveResults(50, {}), /LMU-Rennen/);
});
test('LMU-Rennwochenende weist veraltete Formulare ab', async t => {
  database(t); await assert.rejects(w.saveLineup(50, { version: 'stale' }), /inzwischen/);
});
test('LMU-Ersatzfahrer kann keinen anwesenden oder gesperrten Stammplatz übernehmen', async t => {
  database(t); const data = await w.load(50);
  for (const status of ['anwesend', 'unsicher', 'rennsperre']) await assert.rejects(w.saveLineup(50, { version: data.version, regular: { d1: { status } }, reserves: { d2: { selected: 'on', status: 'anwesend', seat: 'd1' } } }), /doppelt|blockiert/);
});
test('LMU-Ersatzfahrer übernimmt abgemeldeten Platz mit derselben Teamzuordnung', async t => {
  database(t); let saved;
  mock(t, 'F1RaceLineupEntry', 'destroy', async ({ transaction }) => assert.equal(transaction, tx));
  mock(t, 'F1RaceLineupEntry', 'bulkCreate', async rows => { saved = rows; });
  const data = await w.load(50);
  await w.saveLineup(50, { version: data.version, regular: { d1: { status: 'abgemeldet' } }, reserves: { d2: { selected: 'on', status: 'anwesend', seat: 'd1' } } });
  assert.equal(saved[1].ReplacementForDriverId, 1); assert.equal(saved[1].SeasonTeamId, 20); assert.equal(saved[1].TeamId, 30); assert.equal(saved[1].includeInResults, false);
});
test('LMU-Anwesenheit verhindert gleichzeitigen Einsatz von Stammfahrer und dessen Ersatz', async t => {
  database(t, { entries: [record(entry), record({ ...entry, DriverId: 2, roleType: 'reserve', ReplacementForDriverId: 1, driver: reserve })] });
  const data = await w.load(50); await assert.rejects(w.saveAttendance(50, { version: data.version, attendance: { d1: { status: 'anwesend' }, d2: { status: 'anwesend' } } }), /gleichzeitig/);
});
test('LMU-Ergebnisspeicherung ersetzt genau ein Rennen und markiert nur seinen Kalendertermin', async t => {
  database(t); mock(t, 'Driver', 'findAll', async () => []); const calls = [];
  mock(t, 'GrandPrixResultEntry', 'destroy', async options => calls.push(['delete', options]));
  mock(t, 'GrandPrixResultEntry', 'bulkCreate', async (rows, options) => calls.push(['rows', rows, options]));
  mock(t, 'RaceEvent', 'update', async (values, options) => calls.push(['calendar', values, options]));
  const data = await w.load(50);
  await w.saveResults(50, { version: data.version, results: { d1: { position: 1, fastestLap: 'on' } } });
  assert.deepEqual(calls[0][1].where, { GrandPrixResultId: 50 }); assert.equal(calls[1][1][0].points, 26); assert.equal(calls[2][1].isCompleted, true); assert.equal(calls[2][2].where.SeasonId, 12);
  assert.ok(calls.every(c => c.at(-1).transaction === tx));
});
test('LMU-Strafkartei berücksichtigt Jahresablauf, Saison und genaue Sperrrunde', async t => {
  database(t); mock(t, 'PenaltyEntry', 'findAll', async () => [
    { DriverId: 1, points: 3, awardedOn: '2026-01-01', expiresOn: '2027-01-01' },
    { DriverId: 1, points: 9, awardedOn: '2024-01-01', expiresOn: '2025-01-01' },
    { DriverId: 2, isRaceBan: true, SeasonId: 99, roundNumber: 1 },
    { DriverId: 1, isRaceBan: true, SeasonId: 12, roundNumber: 1 }
  ]);
  const data = await w.penalties(7, race); assert.equal(data.totals.get(1), 3); assert.deepEqual([...data.banned], [1]);
});
test('LMU-Aufstellung, Punkte und Team-WM nutzen die gemeinsame Saisonberechnung', () => {
  const reserveEntry = { ...entry, id: 9, DriverId: 2, driver: reserve, roleType: 'reserve', ReplacementForDriverId: 1 };
  const results = [{ ...race, entries: [
    { DriverId: 1, driverName: 'LMU Alias', teamName: 'Mercedes', TeamId: 30, status: 'DNS', points: 0 },
    { DriverId: 2, driverName: 'Ersatz', teamName: 'Mercedes', TeamId: 30, position: 1, points: 26, fastestLap: true }
  ] }];
  for (const include of [true, false]) {
    const data = buildSeasonData(league, results, [{ ...driver, name: 'LMU Alias', team }], [entry, reserveEntry], { ...season, reservePointsForConstructors: include }, [stint]);
    assert.equal(data.teamStandings.find(t => t.name === 'Mercedes').points, include ? 26 : 0);
    assert.equal(data.selectedHistory.reserveDrivers[0].total, 26);
  }
});
test('LMU-Saisonkalender lässt gespeicherte Rennen nicht entfernen oder umnummerieren', async t => {
  database(t); mock(t, 'League', 'findOne', async () => league);
  const events = [{ id: 40, SeasonId: 12, GrandPrixResultId: 50, title: 'Spa', circuit: 'Spa', sortOrder: 1, startsAt: '2026-10-01T18:00Z', isTestDay: false }];
  mock(t, 'RaceEvent', 'findAll', async () => events);
  mock(t, 'GrandPrixResult', 'findAll', async () => [{ ...race, entries: [{ DriverId: 1 }], lineupEntries: [] }]);
  await assert.rejects(calendar.save(12, { version: calendar.version(events), rounds: { r0: { title: 'Neu', circuit: 'Neu', startsAt: '2026-11-01T20:00' } } }), /Runden erhalten/);
});
test('LMU-Saisonkalender ändert Datum ohne Ergebnis- oder Punkteüberschreibung', async t => {
  database(t); mock(t, 'League', 'findOne', async () => league);
  const event = record({ id: 40, SeasonId: 12, GrandPrixResultId: 50, title: 'Spa', circuit: 'Spa', sortOrder: 1, startsAt: '2026-10-01T18:00Z', isTestDay: false });
  const savedRace = record({ ...race, pointsMode: 'manual', entries: [{ points: 40 }], lineupEntries: [] });
  mock(t, 'RaceEvent', 'findAll', async () => [event]); mock(t, 'GrandPrixResult', 'findAll', async () => [savedRace]);
  await calendar.save(12, { version: calendar.version([event]), rounds: { r0: { id: 40, title: 'Spa neu', circuit: 'Spa', startsAt: '2026-10-02T20:00' } } });
  assert.equal(savedRace.raceDate, '2026-10-02'); assert.equal(savedRace.entries[0].points, 40); assert.equal(savedRace.pointsMode, 'manual');
});
test('LMU-Fahrerwechsel verhindert rückwirkende Änderung bereits gefahrener Runden', async t => {
  database(t); mock(t, 'GrandPrixResult', 'findAll', async () => [{ sortOrder: 3, entries: [{}] }]);
  await assert.rejects(s.changeDriver(12, { DriverId: 1, fromRound: 3 }), /letzten gespeicherten Rennen/);
});
test('LMU-Rang wird aus aktuellem Saisonplatz abgeleitet, Abgabe führt in den Ersatzpool', async t => {
  database(t); const d = record(driver); mock(t, 'Driver', 'findAll', async () => [d]); mock(t, 'Season', 'findAll', async () => [season]);
  mock(t, 'SeasonDriverStint', 'findAll', async () => [{ ...stint, toRound: 2 }, { ...stint, roleType: 'reserve', SeasonTeamId: null, fromRound: 3 }]);
  mock(t, 'GrandPrixResult', 'findAll', async () => [{ sortOrder: 2, entries: [{}] }]);
  await s.syncRanks(tx); assert.equal(d.roleLmuRegular, false); assert.equal(d.roleLmuReserve, true); assert.equal(d.roleFormerLmu, false);
});
test('LMU-Austritt wird erst ab seiner Runde zum ehemaligen LMU-Fahrer', async t => {
  database(t); const d = record(driver); mock(t, 'Driver', 'findAll', async () => [d]); mock(t, 'Season', 'findAll', async () => [season]);
  mock(t, 'SeasonDriverStint', 'findAll', async () => [{ ...stint, toRound: 3, endReason: 'left' }]);
  let finished = 2; mock(t, 'GrandPrixResult', 'findAll', async () => [{ sortOrder: finished, entries: [{}] }]);
  await s.syncRanks(tx); assert.equal(d.roleLmuRegular, true);
  finished = 3; await s.syncRanks(tx); assert.equal(d.roleFormerLmu, true); assert.equal(d.viewLmu, false); assert.equal(d.roleLmuReserve, false);
});
test('LMU-Altsaison übernimmt gespeicherte Perioden ohne Ergebnisänderung und nur einmal', async t => {
  database(t); const old = record({ ...season, lmuManaged: false, status: 'historical' }); const periods = [];
  mock(t, 'Season', 'findByPk', async () => old); mock(t, 'Driver', 'findAll', async () => []); mock(t, 'League', 'findOne', async () => league);
  mock(t, 'GrandPrixResult', 'findAll', async () => [1, 2, 3].map(round => ({ ...race, sortOrder: round, entries: [{ DriverId: 1, TeamId: 30, teamName: 'Mercedes', status: round === 2 ? 'DNA' : '' }], lineupEntries: [] })));
  mock(t, 'SeasonDriverStint', 'findAll', async () => periods); mock(t, 'Team', 'findAll', async () => [{ id: 30, ...team }]);
  mock(t, 'SeasonTeam', 'findOrCreate', async () => [team]); mock(t, 'SeasonDriver', 'findOrCreate', async () => [{}]); mock(t, 'SeasonLineupEntry', 'findOrCreate', async () => [{}]);
  mock(t, 'SeasonDriverStint', 'create', async values => periods.push(values));
  mock(t, 'GrandPrixResultEntry', 'update', async () => assert.fail('Legacy result overwritten'));
  await s.ensureStructure(12); await s.ensureStructure(12);
  assert.equal(periods.length, 2); assert.deepEqual(periods.map(p => [p.fromRound, p.toRound]), [[1, 1], [3, 3]]); assert.equal(old.lmuManaged, true);
});

test('Neue LMU-Adminseiten rendern mit gefüllten Daten; Kalender hinzufügen bewahrt Testtag-Wert', async t => {
  database(t); const details = await w.load(50);
  const common = { title: 'LMU', isAdmin: true, currentPath: '/admin', flash: null, leagues: [league], league, seasons: [season], season, calendars: [{ id: 1, name: 'Kalender', rounds: [] }], games: [{ id: 2, name: 'LMU' }], schemes: [scheme], teams: [team], drivers: [driver, reserve], rounds: [race], stints: [stint], nextRound: 1, draft: null, selected: null, details, races: [race], regularStatuses: require('../services/raceLineup').REGULAR_STATUSES, reserveStatuses: require('../services/raceLineup').RESERVE_STATUSES, entries: [], setting: null, documents: [], events: [], version: 'test', localDateTime: require('../services/calendarTime').localDateTime };
  for (const name of ['lmu-games','lmu-calendars','lmu-season-setup','lmu-seasons','lmu-driver-change','lmu-weekend','lmu-penalties','lmu-race-director-documents','lmu-season-calendar','lmu-car-assignments']) {
    const html = await ejs.renderFile(path.join(root, 'views/admin', name+'.ejs'), { ...common, ...(name==='lmu-season-setup'?{draft:{}}:{}), cars: [] });
    assert.match(html, /<form/);
  }
  const html = await ejs.renderFile(path.join(root, 'views/admin/lmu-calendars.ejs'), common);
  const dom = new JSDOM(html, { runScripts: 'outside-only' }); t.after(() => dom.window.close()); dom.window.eval(fs.readFileSync(path.join(root,'public/js/lmu-admin.js'),'utf8'));
  dom.window.document.querySelector('[data-round-add]').click();
  const checkbox = dom.window.document.querySelectorAll('[data-field="isTestDay"]')[1]; checkbox.checked = true;
  assert.equal(new dom.window.FormData(checkbox.form).get('rounds[r1][isTestDay]'), 'on');
});
test('LMU-Gastseite zeigt historischen Kalender, Spiel-Logo, vollständigen Verlauf und gefilterte GP-Ergebnisse', async t => {
  const historical = { ...season, status: 'historical', leagueType: 'lmu' };
  mock(t, 'League', 'findOne', async () => league);
  mock(t, 'Season', 'findAll', async ({where}) => { assert.equal(where.isPublished, true); return [historical]; });
  mock(t, 'TeamRoster', 'findAll', async () => []);
  mock(t, 'GrandPrixResult', 'findAll', async () => [{...race,isHistorical:true,entries:[{DriverId:1,driverName:'LMU Alias',position:1,points:26,TeamId:30,teamName:'Mercedes',fastestLap:true},{DriverId:2,driverName:'Ersatz',status:'DNS',points:0}]}]);
  mock(t, 'RaceEvent', 'findAll', async ({where}) => { assert.equal(where.isPublished, undefined);return [{id:40,SeasonId:12,title:'Spa',circuit:'Spa',startsAt:'2026-10-01T18:00Z',isPublished:false}]; });
  mock(t, 'SeasonTeam', 'findAll', async () => [team]);
  mock(t, 'SeasonDriverStint', 'findAll', async () => [stint]);
  mock(t, 'F1RaceLineupEntry', 'findAll', async ({include}) => { for(const row of include)assert.ok(m.F1RaceLineupEntry.associations[row.association],row.association);return [entry]; });
  mock(t, 'Team', 'findAll', async () => [{...team,id:30,standingsColor:'#fedcba'}]);
  const data = await require('../controllers/lmuController').loadData(12,'lmu',false);
  assert.equal(data.gpResults[0].entries.length,1);assert.equal(data.teams[0].standingsColor,'#fedcba');
  const html=await ejs.renderFile(path.join(root,'views/lmu.ejs'),{...data,title:'LMU',isAdmin:false,currentPath:'/lmu',flash:null});
  const dom=new JSDOM(html);t.after(()=>dom.window.close());const d=dom.window.document;
  assert.equal(d.querySelectorAll('.race-calendar-card').length,1);assert.ok(d.querySelector('img[src="/uploads/lmu.png"]'));assert.match(d.querySelector('#season-history').textContent,/LMU Alias/);assert.ok(d.querySelector('#f1-standings-history'));assert.ok(d.querySelector('.league-team-card'));
});
test('Durchschnitte zählen Hauptstarts inklusive DNF/DSQ, keine DNS/DNA/S oder Sprintpunkte', () => {
  const rows=[{position:1,points:26},{position:3,points:15},{status:'DNF',points:0},{status:'DSQ',points:0},...['DNS','DNA','S'].map(status=>({status,points:0})),{position:1,points:8,grandPrixResult:{...race,raceType:'sprint'}}].map(row=>({grandPrixResult:race,...row}));
  const stats=summarizeDriverEntries(rows).lmu;
  assert.equal(stats.points,49);assert.equal(stats.averagePosition,2);assert.equal(stats.averagePoints,10.25);assert.equal(stats.starts,4);
  const empty=summarizeDriverEntries([{grandPrixResult:race,status:'DNA'}]).lmu;assert.equal(empty.averagePoints,null);assert.equal(empty.averagePosition,null);
});
test('Durchschnitte werden über Saisons gewichtet; beste Endposition wird aufsteigend gewählt', async t => {
  const {buildCareerStatistics}=require('../services/careerStatistics');
  const statistics=buildCareerStatistics([driver],[{DriverId:1,position:1,points:25,grandPrixResult:race},{DriverId:1,position:5,points:10,grandPrixResult:{...race,SeasonId:13,season:'S6'}},{DriverId:1,position:3,points:15,grandPrixResult:{...race,SeasonId:13,season:'S6'}}]);
  const html=await ejs.renderFile(path.join(root,'views/statistics.ejs'),{title:'Statistik',statistics});const dom=new JSDOM(html,{runScripts:'outside-only'});t.after(()=>dom.window.close());dom.window.eval(fs.readFileSync(path.join(root,'public/js/career-statistics.js'),'utf8'));
  const d=dom.window.document,metric=d.querySelector('[data-career-metric]');metric.value='averagePosition';metric.dispatchEvent(new dom.window.Event('change'));
  assert.match(d.querySelector('.career-best').textContent,/S5/);
  const metrics=[...d.querySelectorAll('.career-driver > .career-metrics > div')];assert.equal(metrics.find(el=>el.querySelector('dt').textContent==='Ø Endposition').querySelector('dd').textContent,'3');
});
test('LMU-Saisonauswahl findet die richtige Liga auch bei Weiterleitung nur mit Saison-ID', async t => {
  const other={id:8,type:'lmu',slug:'endurance',name:'Endurance'};
  mock(t,'League','findAll',async()=>[league,other]);mock(t,'Season','findByPk',async()=>({...season,scopeSlug:'endurance'}));mock(t,'Season','findAll',async({where})=>{assert.equal(where.scopeSlug,'endurance');return [{...season,scopeSlug:'endurance'}];});
  const context=await require('../controllers/lmuAdminController').context({season:12});assert.equal(context.league.id,8);
});

test('LMU-Saison erstellt Teams, Stamm-/Ersatzfahrer und Kalender atomar; Testtage zählen nicht als Runde', async t => {
  database(t); const created = { races: [], events: [], stints: [] };
  const activeLeague = record(league);
  mock(t,'League','findByPk',async()=>activeLeague); mock(t,'Season','findOne',async()=>null);
  mock(t,'LmuCalendar','findByPk',async()=>({id:4,rounds:[{title:'Testtag',circuit:'Spa',startsAt:'2026-10-01T18:00Z',isTestDay:true,sortOrder:1},{title:'Spa',circuit:'Spa',startsAt:'2026-10-02T18:00Z',sortOrder:2}]}));
  mock(t,'LmuGame','findByPk',async()=>({id:3,name:'LMU'}));mock(t,'Team','findAll',async()=>[{...team,id:30}]);mock(t,'Driver','findAll',async()=>[record(driver),record(reserve)]);
  mock(t,'Season','create',async(values,options)=>{assert.equal(options.transaction,tx);return record({id:12,...values});});
  mock(t,'SeasonTeam','create',async values=>record({...values,id:20}));mock(t,'SeasonDriver','create',async()=>({}));mock(t,'SeasonLineupEntry','create',async()=>({}));
  mock(t,'SeasonDriverStint','create',async values=>{created.stints.push(values);return values;});
  mock(t,'GrandPrixResult','create',async values=>{created.races.push(values);return {id:50,...values};});mock(t,'GrandPrixResult','update',async()=>{});
  mock(t,'RaceEvent','create',async values=>{created.events.push(values);return values;});mock(t,'RaceEvent','update',async()=>{});
  await s.createSeason({LeagueId:7,name:'S5',LmuCalendarId:4,LmuGameId:3,PointsSchemeId:9,teamIds:['30'],assignments:{d1:{TeamId:'30'},d2:{TeamId:''}},accentColor:'#abcdef',isPublished:'on',reservePointsForConstructors:'on'});
  assert.equal(created.races.length,1);assert.equal(created.races[0].sortOrder,1);assert.equal(created.events[0].GrandPrixResultId,null);assert.equal(created.events[1].GrandPrixResultId,50);
  assert.deepEqual(created.stints.map(row=>[row.DriverId,row.roleType,row.SeasonTeamId]),[[1,'regular',20],[2,'reserve',null]]);assert.equal(activeLeague.currentSeason,'S5');
});
test('LMU-Fahrerwechsel schließt alten Stammplatz und eröffnet Ersatzzeitraum in einer Transaktion', async t => {
  database(t);const old=record(stint),periods=[old];mock(t,'SeasonDriverStint','findAll',async()=>periods);
  mock(t,'GrandPrixResult','findOne',async()=>({...race,sortOrder:3}));mock(t,'GrandPrixResult','findAll',async()=>[{...race,sortOrder:2,entries:[{}]},{...race,id:51,sortOrder:3,entries:[]}].filter(r=>r.sortOrder<3));
  // The first read computes the next round; the later read covers future races only.
  mock(t,'GrandPrixResult','findAll',async({where})=>where.sortOrder?[{...race,id:51,sortOrder:3,entries:[]}]:[{...race,sortOrder:2,entries:[{}]}]);
  mock(t,'SeasonDriverStint','create',async values=>{assert.equal(old.toRound,2);periods.push(values);});mock(t,'SeasonDriver','findOrCreate',async()=>[{}]);mock(t,'SeasonLineupEntry','findOrCreate',async()=>[record({})]);
  mock(t,'F1RaceLineupEntry','destroy',async({where,transaction})=>{assert.equal(transaction,tx);assert.deepEqual(Object.values(where.GrandPrixResultId)[0]||where.GrandPrixResultId[require('sequelize').Op.in],[51]);});
  mock(t,'Driver','findAll',async()=>[]);
  await s.changeDriver(12,{DriverId:1,fromRound:3});assert.equal(old.endReason,'demoted');assert.equal(periods[1].roleType,'reserve');assert.equal(periods[1].fromRound,3);assert.equal(periods[1].SeasonTeamId,null);
});
test('LMU-Farbpflicht und getrennte Autozuordnung verändern die F1-Felder nicht', async () => {
  const config=require('../services/resourceConfig');
  assert.equal(config.drivers.fields.some(f=>f.name==='LmuCarId'),false);
  assert.ok(config.lmuCars.fields.find(f=>f.name==='accentColor')?.required);
  assert.ok(config.lmuTeams.fields.find(f=>f.name==='accentColor')?.required);
  assert.ok(config.lmuTeams.fields.find(f=>f.name==='standingsColor')?.required);
  assert.throws(()=>s.color('red'),/Farbe/);
  for(const name of ['LmuCalendar','LmuGame','LmuRuleSection','LmuRaceDirectorDocument'])assert.ok(m[name]);
});
test('LMU-Schema ergänzt neue Spalten einmalig und bewahrt bestehende Daten', async t => {
  const qi=m.sequelize.getQueryInterface();const columns={seasons:{hide_calendar_time:{},historical_grid:{},driver_display_names:{}},users:{dashboard_favorites:{}},teams:{aggregation_team_id:{},logo_variants:{}},lmu_cars:{},drivers:{},f1_car_profiles:{unified_team_id:{}},community_settings:{logo_path:{}}};
  const added=[],stop=new Error('Schemaabschnitt geprüft');t.mock.method(qi,'describeTable',async table=>columns[table]);
  t.mock.method(qi,'addColumn',async(table,name,definition)=>{assert.equal(columns[table][name],undefined);columns[table][name]={};added.push({table,name,definition});});
  mock(t,'Guide','findOrCreate',async()=>{throw stop;});
  const {ensureSchema}=require('../services/schema');await assert.rejects(ensureSchema(),error=>error===stop);const count=added.length;await assert.rejects(ensureSchema(),error=>error===stop);assert.equal(added.length,count);
  for(const name of ['lmu_managed','lmu_game_id','lmu_calendar_id','view_former_lmu','standings_color','accent_color'])assert.ok(added.some(row=>row.name===name),name);
});
