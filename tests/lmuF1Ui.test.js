const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const m = require('../models');
const calendar = require('../services/lmuCalendar');
const change = require('../services/lmuDriverChange');
const form = require('../services/lmuWeekendForm');
const weekend = require('../services/lmuWeekend');
const seasonService = require('../services/lmuSeason');
const tx = { LOCK: { UPDATE: 'UPDATE' } };
const layout = { title: 'LMU', isAdmin: true, currentPath: '/admin', flash: null };
const league = { id: 7, name: 'Endurance', type: 'lmu', slug: 'endurance', raceTime: '20:00' };
const season = { id: 12, name: 'S7', leagueType: 'lmu', scopeSlug: 'endurance', status: 'active', lmuManaged: true };
const team = { id: 20, SeasonId: 12, sourceId: 30, sourceType: 'lmu', name: 'Ferrari', accentColor: '#ff0000' };
const driver = { id: 1, name: 'Normaler Name', lmuDisplayName: 'LMU Name', viewLmu: true, roleLmuRegular: true };
const reserve = { id: 2, name: 'Reserve normal', lmuDisplayName: 'LMU Reserve', viewLmu: true, roleLmuReserve: true };
const stint = { id: 1, SeasonId: 12, DriverId: 1, SeasonTeamId: 20, roleType: 'regular', fromRound: 1, toRound: null, driver, carryOvers: [] };
const races = [1,2,3].map(round => ({ id: 50 + round, SeasonId: 12, LeagueId: 7, discipline: 'lmu', raceType: 'main', sortOrder: round, title: 'Spa', raceDate: `2026-10-${10+round}`, entries: [], lineupEntries: [] }));
const entry = { id: 8, GrandPrixResultId: 51, DriverId: 1, TeamId: 30, SeasonTeamId: 20, roleType: 'regular', status: 'anwesend', attendanceStatus: null, includeInResults: false, driver };
const reserveEntry = { id: 9, GrandPrixResultId: 51, DriverId: 2, TeamId: 30, SeasonTeamId: 20, roleType: 'reserve', status: 'anwesend', attendanceStatus: null, includeInResults: false, ReplacementForDriverId: 1, driver: reserve };
const scheme = { discipline: 'lmu', fastestLapEnabled: true, fastestLapPoints: 1, polePositionEnabled: true, polePositionPoints: 2, allocations: [{raceType:'main',position:1,points:25},{raceType:'main',position:2,points:18}] };
const record = value => ({ ...value, async update(values) {Object.assign(this,values);}, async destroy(){this.deleted=true;} });
const mock = (t,model,method,fn) => t.mock.method(m[model],method,fn);
function details(entries = [entry]) { return { race: races[0], season, league, teams:[team], regulars:[{driver,team,stint}], reserves:[reserve], vacancy:[{key:'20:2',team},{key:'20:3',team}], entries, results:[], penalty:{banned:new Set()}, scheme, version:'revision' }; }
function browser(t, html) {const dom=new JSDOM(html,{url:'http://localhost/admin',runScripts:'outside-only'});t.after(()=>dom.window.close());return dom.window;}
const render = (view,locals) => ejs.renderFile('views/'+view+'.ejs',{...layout,...locals});
function changeDatabase(t) {
 t.mock.method(m.sequelize,'transaction',async fn=>fn(tx));
 mock(t,'Season','findByPk',async()=>season); mock(t,'Season','findAll',async()=>[season]);
 mock(t,'SeasonTeam','findAll',async()=>[team]); mock(t,'Driver','findAll',async()=>[driver,reserve]);
 mock(t,'SeasonDriverStint','findAll',async()=>[stint]); mock(t,'GrandPrixResult','findAll',async()=>races);
}
function weekendDatabase(t, data) {
 t.mock.method(m.sequelize,'transaction',async fn=>fn(tx));
 mock(t,'Season','findByPk',async()=>season);
 mock(t,'GrandPrixResult','findByPk',async()=>({...data.race,seasonRecord:season,league}));
 mock(t,'SeasonDriverStint','findAll',async()=>[stint]); mock(t,'SeasonTeam','findAll',async()=>[team]);
 mock(t,'Driver','findAll',async()=>[driver,reserve]); mock(t,'F1RaceLineupEntry','findAll',async()=>data.entries);
 mock(t,'GrandPrixResultEntry','findAll',async()=>data.results); mock(t,'PointsScheme','findByPk',async()=>scheme);
 mock(t,'PenaltyEntry','findAll',async()=>[]);
}
test('LMU-Kalender übernimmt F1-Ansicht: Reihenfolge, Testtag, keine Titel/Termine/Sprints',async t=>{
 const saved={id:3,name:'Kalender',isActive:true,rounds:[{id:1,sortOrder:1,LmuTrackId:8,circuit:'Spa'},{id:2,sortOrder:2,LmuTrackId:8,circuit:'Spa',isTestDay:true}]};
 mock(t,'LmuCalendar','findAll',async()=>[saved]);mock(t,'LmuTrack','findAll',async()=>[{id:8,name:'Spa',country:'Belgien'}]);
 const res={render(view,data){this.view=view;this.data=data;}};
 await require('../controllers/lmuCalendarController').index({query:{calendar:'3',step:'structure'},session:{}},res);
 assert.equal(res.view,'admin/f1-calendars');const w=browser(t,await render(res.view,res.data)),d=w.document;
 assert.equal(d.querySelectorAll('[data-round-row]').length,2);
 assert.equal(d.querySelectorAll('input[name*="title"],input[type="datetime-local"],[data-sprint-toggle]').length,0);
 assert.equal(d.querySelector('[data-calendar-structure]').action,'http://localhost/admin/lmu-calendars/3/structure');
 w.eval(fs.readFileSync('public/js/calendar-structure.js','utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));
 d.querySelector('[data-round-row] [data-move="down"]').click();
 assert.deepEqual([...d.querySelectorAll('[name="roundIds"]')].map(i=>i.value),['2','1']);
 assert.equal(d.querySelectorAll('[data-round-number-field]')[1].textContent,'R1');
 const dragged=d.querySelectorAll('[data-round-row]')[1];dragged.querySelector('[data-drag-handle]').dispatchEvent(new w.Event('dragstart',{bubbles:true}));
 d.querySelector('[data-round-row]').dispatchEvent(new w.MouseEvent('dragover',{bubbles:true,clientY:-1,cancelable:true}));
 assert.equal(d.querySelector('[data-round-row]').dataset.roundId,'1');
});
test('Kalendervorlagen speichern stabile IDs und Testtage; veraltete Struktur wird abgewiesen',async t=>{
 const saved=record({id:3,name:'Kalender',isActive:true,rounds:[{id:1,sortOrder:1,LmuTrackId:8,circuit:'Spa'},{id:2,sortOrder:2,circuit:'Alte Strecke'}]});
 t.mock.method(m.sequelize,'transaction',async fn=>fn(tx));mock(t,'LmuCalendar','findByPk',async()=>saved);mock(t,'LmuTrack','findByPk',async()=>({id:8,name:'Spa',country:'Belgien'}));
 const old=calendar.version(saved);
 await calendar.edit(3,{version:old,roundIds:['2','1'],rounds:{r2:{isTestDay:'on'},r1:{LmuTrackId:'8'}}},'structure');
 assert.deepEqual(saved.rounds.map(r=>[r.id,r.roundNumber,r.circuit]),[[2,null,'Alte Strecke'],[1,1,'Spa']]);
 await assert.rejects(calendar.edit(3,{version:old},'add'),/inzwischen/);
 await assert.rejects(calendar.edit(3,{version:calendar.version(saved),roundIds:['1','1']},'structure'),/Kalendereinträge/);
 await calendar.edit(3,{version:calendar.version(saved),LmuTrackId:8},'add');assert.equal(saved.rounds.at(-1).id,3);
 await calendar.edit(3,{version:calendar.version(saved),roundId:1},'delete');assert.deepEqual(saved.rounds.map(r=>r.roundNumber),[null,1]);
});
test('Saisontermine verwenden Ligauhrzeit/Berlin, Kalenderstruktur bleibt unverändert',()=>{
 const saved={rounds:[{id:9,sortOrder:1,circuit:'Spa'}]};
 assert.equal(calendar.seasonRounds(saved,{dates:{r9:'2026-10-11'}},league)[0].startsAt,'2026-10-11T18:00:00.000Z');
 assert.equal(saved.rounds[0].startsAt,undefined);
 assert.throws(()=>calendar.seasonRounds(saved,{dates:{r9:'2026-02-31'}},league),/Datum|Termin/);
});
test('LMU-Fahrerwechsel nutzt F1-Schritte und bietet ein drittes Cockpit mit LMU-Namen',async t=>{
 const data={...layout,driverChangeBase:'/admin/lmu-driver-change',driverChangeSeries:'LMU',leagues:[league],seasons:[season],selectedLeague:league,selectedSeason:season,completedRound:0,selectedRound:1,selectedTeamId:null,rounds:[{round:1,title:'Spa'}],stints:[stint,{...stint,id:2,DriverId:3,driver:{id:3,name:'Dritter'}}].map(st=>({...st,driver:change.display(st.driver)})),memberships:[],eligibleMemberships:[{DriverId:2,driver:change.display(reserve)}],reserveDrivers:[change.display(reserve)],teamSlots:[{team,freeSeats:1}],preview:null,previewError:null};
 const w=browser(t,await render('admin/season-driver-change',data)),d=w.document;
 w.eval(fs.readFileSync('public/js/season-driver-change.js','utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));
 const select=(name,value)=>{const input=d.querySelector(name);input.value=value;input.dispatchEvent(new w.Event('change'));};
 select('[data-change-round]','1');select('[data-change-operation]','fill');
 assert.equal(d.querySelector('[data-change-team] [value="20"]').disabled,false);
 select('[data-change-team]','20');select('[data-new-driver]','2');assert.equal(d.querySelector('[data-review-button]').hidden,false);
 assert.match(d.querySelector('[data-new-driver]').textContent,/LMU Reserve/);
 assert.equal(d.querySelector('[data-driver-change-form]').action,'http://localhost/admin/lmu-driver-change');
});
test('Fahrerwechsel-Vorschau und Bestätigungsformular stimmen für Abgabe überein',async t=>{
 changeDatabase(t);const data=await change.context(12),input={operation:'release',round:'2',team:'20',oldDriver:'1',staysReserve:'1'};
 const preview=await change.plan(data,input);let saved;
 t.mock.method(seasonService,'changeDriver',async(id,body,transaction)=>{saved=body;assert.equal(transaction,tx);});t.mock.method(seasonService,'syncRanks',async()=>{});
 const html=await render('admin/season-driver-change',{driverChangeBase:'/admin/lmu-driver-change',driverChangeSeries:'LMU',leagues:[league],seasons:[season],selectedLeague:league,selectedSeason:season,completedRound:0,selectedRound:2,selectedTeamId:20,rounds:races.map(r=>({round:r.sortOrder,title:r.title})),stints:[{...stint,driver:change.display(driver)}],memberships:[],eligibleMemberships:[],reserveDrivers:[],teamSlots:[{team,freeSeats:2}],preview,previewError:null});
 const w=browser(t,html),post=w.document.querySelector('form[method="post"][action="/admin/lmu-driver-change"]');
 const body=Object.fromEntries(new w.FormData(post));assert.equal(post.querySelectorAll('[name="changeVersion"]').length,1);
 await change.save(12,body);assert.equal(saved.DriverId,1);assert.equal(saved.fromRound,2);assert.equal(saved.retire,'');
 await assert.rejects(change.save(12,{...body,changeVersion:'stale'}),/erneut prüfen/);
});
test('Fahrerwechsel prüft spätere Teambelegung, bestätigte Anwesenheit und historische Ausstiege',async()=>{
 const data={season,teams:[team],drivers:[driver,reserve],stints:[stint],races,completedRound:0,version:'v'};
 await assert.rejects(change.plan({...data,stints:[stint,{...stint,id:2,DriverId:3},{...stint,id:3,DriverId:4,fromRound:3}]},{operation:'fill',round:2,team:20,newDriver:2}),/höchstens 3/);
 await assert.rejects(change.plan({...data,races:races.map(r=>({...r,lineupEntries:[{attendanceStatus:'anwesend'}]}))},{operation:'release',round:2,team:20,oldDriver:1,staysReserve:'1'}),/Anwesenheit/);
 await assert.rejects(change.plan({...data,season:{...season,status:'historical'}},{operation:'retireReserve',round:2,reserveDriver:2}),/aktuellen Saisons/);
});
test('Ersatzfahrer-Ausstieg speichert eine Endgrenze auch ohne bisherige Saisonzuordnung',async t=>{
 changeDatabase(t);const data=await change.context(12);
 const preview=await change.plan(data,{operation:'retireReserve',round:'2',reserveDriver:'2'});
 assert.equal(preview.retirement.scopes.length,1);let boundary;
 mock(t,'SeasonDriverStint','create',async values=>{boundary=values;});mock(t,'SeasonLineupEntry','destroy',async()=>{});mock(t,'F1RaceLineupEntry','destroy',async()=>{});t.mock.method(seasonService,'syncRanks',async()=>{});
 await change.save(12,{operation:'retireReserve',effectiveRound:'2',ReserveDriverId:'2',changeVersion:preview.version});
 assert.equal(boundary.DriverId,2);assert.equal(boundary.toRound,1);assert.equal(boundary.endReason,'left');
 const weekendData=details();weekendDatabase(t,weekendData);
 mock(t,'GrandPrixResult','findByPk',async()=>({...races[1],seasonRecord:season,league}));mock(t,'SeasonDriverStint','findAll',async()=>[stint,boundary]);
 assert.equal((await weekend.load(52)).reserves.length,0);
});
test('Beförderung erkennt nur ausgewählte frühere Einsätze desselben LMU-Teams an',async t=>{
 changeDatabase(t);
 const prior={...races[0],entries:[{id:90,DriverId:2,TeamId:30,points:28}],lineupEntries:[{...reserveEntry,includeInResults:true}]};
 mock(t,'GrandPrixResult','findAll',async()=>[prior,...races.slice(1)]);
 const data=await change.context(12),preview=await change.plan(data,{operation:'fill',round:'2',team:'20',newDriver:'2'});assert.equal(preview.carryHistory[0].totalPoints,28);
 t.mock.method(seasonService,'changeDriver',async()=>{});t.mock.method(seasonService,'syncRanks',async()=>{});mock(t,'SeasonDriverStint','findOne',async()=>({id:5}));let carries;
 mock(t,'SeasonDriverCarryOver','bulkCreate',async rows=>{carries=rows;});
 const body={operation:'fill',effectiveRound:2,SeasonTeamId:20,NewDriverId:2,changeVersion:preview.version,carryResultIds:['51','51']};
 await change.save(12,body);assert.equal(carries.length,1);assert.equal(carries[0].selected,true);assert.equal(carries[0].SeasonTeamId,20);
 await assert.rejects(change.save(12,{...body,carryResultIds:['99']}),/Ersatzeinsatz/);
 const promoted={id:5,DriverId:2,roleType:'regular',SeasonTeamId:20,seasonTeam:team,driver:reserve,fromRound:2,carryOvers:carries};
 const result={...prior,entries:[{DriverId:2,driverName:reserve.lmuDisplayName,TeamId:30,teamName:team.name,position:1,points:28,polePosition:true,fastestLap:true}]};
 const standings=require('../services/standings').buildSeasonData({...league,currentSeason:season.name},[result,...races.slice(1)],[{...form.name(reserve),team}],prior.lineupEntries,{...season,reservePointsForConstructors:false},[{...stint},promoted]);
 assert.equal(standings.driverStandings.find(row=>row.driver.id===2).points,28);
 assert.equal(standings.teamStandings.find(row=>row.name===team.name).points,28);
});
test('LMU-Aufstellung übernimmt F1-Pool und Ersatz bei Unsicherheit/Sperre; doppelte Einsätze werden verhindert',()=>{
 const data=details();data.penalty.banned.add(1);
 const body={regular:{1:{status:'rennsperre',ReplacementDriverId:'2'}},reserve:{2:{status:'anwesend'}}};
 assert.equal(form.lineupBody(data,body).reserves['2'].seat,'d1');
 assert.throws(()=>form.lineupBody(data,{...body,vacant:{'20:2':'2'}}),/nur ein Cockpit/);
 assert.throws(()=>form.lineupBody(data,{...body,reserve:{}}),/Pool/);
});
test('LMU-Anwesenheit prüft beide Unsicher-Antworten und rechnet Ersatz dem Stammteam zu',()=>{
 const data=details([{...entry,status:'unsicher'},reserveEntry]);
 assert.throws(()=>form.attendanceValues(data,{uncertain:{d8:{present:'no'}}}),/Teilnahme und Rückmeldung/);
 const rows=form.attendanceValues(data,{uncertain:{d8:{present:'no',respondedInTime:'yes'}},attendance:{d9:{status:'anwesend'}}});
 assert.equal(rows[0].values.includeInResults,false);assert.equal(rows[0].values.attendanceStatus,'rueckmeldung_unsicher');
 assert.equal(rows[1].values.includeInResults,true);assert.equal(rows[1].values.TeamId,30);
 const present=form.attendanceValues(data,{uncertain:{d8:{present:'yes',respondedInTime:'yes'}}});
 assert.equal(present[0].values.includeInResults,true);assert.equal(present[1].values.includeInResults,false);
});
test('Spontaner Ersatz funktioniert über ausgefallenen Ersatz; derselbe Fahrer kann nicht doppelt starten',()=>{
 const other={...reserveEntry,id:10,DriverId:3,ReplacementForDriverId:null,TeamId:null,SeasonTeamId:null,status:'auf_abruf',driver:{id:3,name:'Dritter'}};
 const data=details([{...entry,status:'abgemeldet'},reserveEntry,other]);
 const rows=form.attendanceValues(data,{attendance:{d9:{status:'unabgemeldet',ReplacementDriverId:'3'}}});
 assert.equal(rows[2].values.ReplacementForDriverId,1);assert.equal(rows[2].values.SeasonTeamId,20);assert.equal(rows[2].values.includeInResults,true);
 assert.throws(()=>form.attendanceValues({...data,entries:[...data.entries,{...entry,id:11,DriverId:4,status:'abgemeldet'}]},{attendance:{d9:{status:'unabgemeldet',ReplacementDriverId:'3'},d11:{ReplacementDriverId:'3'}}}),/mehrfach/);
});
test('Bestätigte LMU-Aufstellung ist geschützt; fehlerhafte Anwesenheit löscht keine Ergebnisse',async t=>{
 const data=details([record({...entry,status:'unsicher',attendanceStatus:'anwesend',includeInResults:true})]);weekendDatabase(t,data);
 let deleted=false;mock(t,'GrandPrixResultEntry','destroy',async()=>{deleted=true;});
 let current=await weekend.load(51);await assert.rejects(weekend.saveLineup(51,{version:current.version,formMode:'f1'}),/Bearbeitung öffnen/);
 data.results=[{id:100,points:25}];current=await weekend.load(51);
 await assert.rejects(weekend.saveAttendance(51,{version:current.version,formMode:'f1',uncertain:{d8:{present:'no'}}}),/Rückmeldung/);assert.equal(deleted,false);
 mock(t,'RaceEvent','update',async()=>{});
 await weekend.saveAttendance(51,{version:current.version,formMode:'f1',uncertain:{d8:{present:'yes',respondedInTime:'yes'}}});assert.equal(deleted,true);assert.equal(data.entries[0].respondedInTime,true);
});
test('Gemeinsames Rennwochenende rendert LMU-Namen, Ziele und alle drei Schritte',async t=>{
 for(const entries of [[],[entry],[{...entry,attendanceStatus:'anwesend',includeInResults:true}]]){
  const html=await render('admin/race-weekend',{...form.view(details(entries),{leagues:[league],seasons:[season],season,league,events:[{id:51,title:'Spa',sortOrder:1}],event:{id:51,title:'Spa',sortOrder:1}}),regularStatuses:require('../services/raceLineup').REGULAR_STATUSES,reserveStatuses:require('../services/raceLineup').RESERVE_STATUSES});
  const w=browser(t,html),d=w.document;
  assert.match(html,/LMU Name/);assert.doesNotMatch(html,/Normaler Name/);
  assert.equal(d.querySelector('[data-f1-lineup-matrix]').action,'http://localhost/admin/lmu-weekends/51/lineup');
  assert.equal(d.querySelectorAll('form[action*="/race-weekend/f1"]').length,0);
  if(entries[0]?.attendanceStatus)assert.ok(d.querySelector('a[href="/admin/lmu-weekends/51/results"]'));
 }
 const html=await render('admin/race-weekend',{...form.view(null,{leagues:[],seasons:[],season:null,league:null}),regularStatuses:[],reserveStatuses:[]});assert.match(html,/LMU/);
});
test('LMU-Ergebniseditor zeigt Alias und berechnet Pole/FL auch für Ersatzfahrer',async t=>{
 const data=details([{...entry,attendanceStatus:'anwesend',includeInResults:true},{...reserveEntry,ReplacementForDriverId:null,vacantSeat:'20:2',attendanceStatus:'anwesend',includeInResults:true}]);
 const w=browser(t,await render('admin/lmu-results',{details:data,displayName:d=>d.lmuDisplayName||d.name})),d=w.document;
 w.eval(fs.readFileSync('public/js/lmu-results.js','utf8'));
 const rows=d.querySelectorAll('[data-lmu-result-row]');
 rows[1].querySelector('[data-result-position]').value='1';
 for(const award of ['polePosition','fastestLap']){const input=rows[1].querySelector(`[data-award="${award}"]`);input.checked=true;input.dispatchEvent(new w.Event('change',{bubbles:true}));}
 assert.equal(rows[1].querySelector('[data-result-points]').textContent,'28');
 assert.match(rows[1].textContent,/LMU Reserve/);assert.doesNotMatch(d.body.textContent,/Reserve normal/);
 const input=rows[0].querySelector('[data-award="polePosition"]');input.checked=true;input.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(rows[1].querySelector('[data-award="polePosition"]').checked,false);
});
test('Öffentliche Anwesenheit zeigt drei LMU-Cockpits und ausschließlich LMU-Anzeigenamen',async t=>{
 const publicWeekends=require('../services/publicRaceWeekend').buildPublicWeekends({races,teams:[team],stints:[stint,{...stint,id:2,DriverId:3,driver:{id:3,name:'Drei'}},{...stint,id:3,DriverId:4,driver:{id:4,name:'Vier'}}].map(st=>({...st,driver:form.name(st.driver)})),entries:[],calendar:[]});
 assert.equal(publicWeekends.snapshots[0].teams.length,1);
 const html=await render('partials/public-weekend-lineup',{publicWeekends,lineupSectionId:'lmu-lineup',cockpitCount:3});
 const w=browser(t,html);assert.ok(w.document.querySelector('#lmu-lineup'));assert.match(html,/LMU Name/);assert.match(html,/Vier/);assert.doesNotMatch(html,/Normaler Name/);
});
test('Rennstatistik zeigt Fahrer/Team für alle sechs Kategorien; Ersatzfahrer ohne Team',async t=>{
 const awards=require('../services/raceStatistics').awardColumns([{driverName:'Stamm',teamName:'Ferrari',position:1,polePosition:true},{driverName:'Ersatz',teamName:'Ferrari',position:2,fastestLap:true,driverOfTheDay:true,isReserve:true}]);
 assert.equal(awards.poleTeam,'Ferrari');assert.equal(awards.fastestLapTeam,'');assert.equal(awards.secondTeam,'');
 const w=browser(t,await render('partials/race-statistics-table',{statisticsRows:[{round:1,country:'Spa',date:'2026-10-11',...awards}]})),d=w.document;
 assert.equal(d.querySelectorAll('thead th[colspan="2"]').length,6);assert.equal(d.querySelectorAll('tbody tr>*').length,15);
 assert.equal(d.querySelector('[data-historical-statistic-team="fastestLap"]').textContent,'');
});
