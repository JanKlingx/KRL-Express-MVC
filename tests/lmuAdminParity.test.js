const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');
const { Op } = require('sequelize');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const m = require('../models');
const dashboard = require('../services/adminDashboard');
const tracks = require('../services/lmuTracks');
const adapter = require('../services/lmuPenaltyLedger');
const ledger = require('../controllers/lmuPenaltyLedgerController');
const tx = { LOCK: { UPDATE: 'UPDATE' } };
const layout = { title: 'LMU', isAdmin: true, currentPath: '/admin', flash: null };
const league = { id: 7, type: 'lmu', slug: 'endurance', name: 'Endurance', accentColor: '#abcdef' };
const season = { id: 12, leagueType: 'lmu', scopeSlug: 'endurance', status: 'active', isPublished: true, lmuManaged: true, LmuCalendarId: 3 };
const regular = { id: 1, name: 'Stamm', viewLmu: true, roleLmuRegular: true };
const reserve = { id: 2, name: 'Ersatz', viewLmu: true, roleLmuReserve: true };
const former = { id: 3, name: 'Ehemalig', roleFormerLmu: true };
const record = row => ({ ...row, toJSON() { return {...row}; }, async update(values) { Object.assign(this, values); } });
const mock = (t, model, method, fn) => t.mock.method(m[model], method, fn);
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
function response() { return { code:200, json(value){this.data=value;return this;},status(code){this.code=code;return this;},render(view,data){this.view=view;this.data=data;},redirect(url){this.url=url;} }; }
function penaltyDatabase(t) {
  mock(t,'Season','findOne',async options => { assert.equal(options.where.leagueType,'lmu'); return season; });
  mock(t,'Season','findByPk',async()=>season); mock(t,'Season','findAll',async options=>{assert.equal(options.where.leagueType,'lmu');return [season];});
  mock(t,'League','findAll',async options=>{assert.deepEqual(options.where,{type:'lmu'});return [league];});
  mock(t,'League','findOne',async options=>{assert.equal(options.where.type,'lmu');return league;});
  mock(t,'F1PenaltySetting','findOne',async()=>({pointsLimit:99,publicVisible:true}));
  mock(t,'SeasonTeam','findAll',async()=>[{id:20,name:'Team',accentColor:'#abcdef'}]);
  mock(t,'SeasonDriverStint','findAll',async()=>[{DriverId:1,SeasonTeamId:20,roleType:'regular',driver:regular,fromRound:1}]);
  mock(t,'GrandPrixResult','findAll',async()=>[]);
  mock(t,'RaceEvent','findAll',async()=>[{id:50,sortOrder:2,title:'Spa',circuit:'Spa',grandPrixResult:{sortOrder:1}}]);
  mock(t,'LmuCalendar','findAll',async()=>[{id:3,name:'LMU Kalender',rounds:[{sortOrder:1,isTestDay:true},{sortOrder:2,LmuTrackId:8,circuit:'Spa'}]}]);
  mock(t,'LmuTrack','findAll',async()=>[{id:8,name:'Spa',countryRecord:{name:'Belgien',abbreviation:'BE',flagPath:'/be.svg'}}]);
  mock(t,'Driver','findAll',async options=>options.where.id?[record(regular)]:[record(reserve),record(former)]);
  mock(t,'Driver','findByPk',async()=>record(regular));
  t.mock.method(m.sequelize,'transaction',async fn=>fn(tx));
  const entries=[{id:1,LeagueId:7,SeasonId:12,DriverId:1,roundNumber:1,points:4,cellColor:'#ABCDEF'},{id:2,LeagueId:7,SeasonId:12,DriverId:2,roundNumber:1,points:2},{id:3,LeagueId:7,SeasonId:12,DriverId:3,roundNumber:1,points:0,isRaceBan:true}];
  mock(t,'PenaltyEntry','findAll',async options=>entries.filter(row=>(!options.where.DriverId||row.DriverId===options.where.DriverId)&&(!options.where.roundNumber||row.roundNumber===options.where.roundNumber)));
  return entries;
}

test('LMU-Strecken verwenden Länderstamm und reale IDs; alte Kalender bleiben bearbeitbar',async t=>{
  mock(t,'Country','findByPk',async id=>Number(id)===2?{name:'Belgien'}:null);
  const values={CountryId:2,name:' Spa '};await tracks.prepare(values);assert.equal(values.country,'Belgien');assert.equal(values.name,'Spa');
  await assert.rejects(tracks.prepare({CountryId:99,name:'X'}),/Land/);
  mock(t,'LmuTrack','findByPk',async id=>id===8?{id:8,name:'Spa'}:null);
  const round={LmuTrackId:'8',circuit:'Manipuliert',title:'Belgien',startsAt:'2026-10-11T20:00'};
  const saved=await tracks.resolveRounds([round],tx);assert.equal(saved[0].circuit,'Spa');assert.equal(saved[0].LmuTrackId,8);
  await assert.rejects(tracks.resolveRounds([{...round,LmuTrackId:99}]),/existiert/);
  await assert.rejects(tracks.resolveRounds([{...round,LmuTrackId:'',circuit:'Frei'}]),/auswählen/);
  assert.equal((await tracks.resolveRounds([{...round,LmuTrackId:'',circuit:'Alt'}],tx,[{circuit:'Alt'}]))[0].circuit,'Alt');
  const group=dashboard.groups().find(g=>g.id==='lmu');assert.ok(group.modules.some(([key])=>key==='lmuTracks'));
});
test('Verwendete LMU-Strecken lassen sich weder aus Vorlagen noch Saisonkalendern löschen',async t=>{
  mock(t,'LmuCalendar','findAll',async()=>[{rounds:[{LmuTrackId:8}]}]);mock(t,'RaceEvent','count',async()=>0);
  await assert.rejects(tracks.beforeRemove({id:8}),/verwendet/);
  mock(t,'LmuCalendar','findAll',async()=>[]);mock(t,'RaceEvent','count',async()=>1);await assert.rejects(tracks.beforeRemove({id:8}),/verwendet/);
  mock(t,'RaceEvent','count',async()=>0);await tracks.beforeRemove({id:8});
});
test('Kategorien behalten alle Transaktionen, erlauben Umbenennen und Verschieben, schützen Standardgruppen',()=>{
  let saved=dashboard.applyLayout(null,{action:'create',name:'Rennvorbereitung'});const id=saved.categories.at(-1).id;
  saved=dashboard.applyLayout(saved,{action:'move',category:id,module:'lmuTracks'});
  saved=dashboard.applyLayout(saved,{action:'collapse',category:id,collapsed:'1'});
  assert.equal(dashboard.groups(saved).at(-1).modules[0][0],'lmuTracks');assert.equal(dashboard.groups(saved).at(-1).collapsed,true);
  assert.throws(()=>dashboard.applyLayout(saved,{action:'create',category:id,name:'Rennvorbereitung'}),/vergeben/);
  assert.throws(()=>dashboard.applyLayout(saved,{action:'move',category:id,module:'unknown'}),/gefunden/);
  assert.throws(()=>dashboard.applyLayout(saved,{action:'delete',category:'lmu'}),/Standard/);
  saved=dashboard.applyLayout(saved,{action:'rename',category:id,name:'Vorbereitung'});assert.equal(saved.categories.at(-1).name,'Vorbereitung');
  saved=dashboard.applyLayout(saved,{action:'delete',category:id});assert.equal(saved.placements.lmuTracks,'lmu');
  assert.equal(dashboard.groups(saved).flatMap(g=>g.modules).length,dashboard.modules().length);
});
test('Dashboard speichert Kategorien gesperrt ausschließlich im angemeldeten Konto',async t=>{
  const user=record({dashboardLayout:null,dashboardFavorites:['lmuWeekend']});t.mock.method(m.sequelize,'transaction',async fn=>fn(tx));
  mock(t,'User','findByPk',async(id,options)=>{assert.equal(id,4);assert.equal(options.lock,'UPDATE');return user;});
  const res=response();await require('../controllers/dashboardLayoutController').save({session:{userId:4},body:{action:'create',name:'Privat'}},res);
  assert.equal(res.data.layout.categories.at(-1).name,'Privat');assert.deepEqual(user.dashboardFavorites,['lmuWeekend']);
});
test('Dashboard erstellt Kategorien und verschiebt per Drag-and-drop; Suche respektiert gespeicherte Klappzustände',async t=>{
  let state=dashboard.layout();state.categories[0].collapsed=true;
  const html=await ejs.renderFile('views/admin/dashboard.ejs',{...layout,groups:dashboard.groups(state),counts:{},favorites:['lmuWeekend'],adminBasePath:'/admin',dashboardEyebrow:'KRL',dashboardTitle:'Admin',dashboardDescription:'Verwaltung'});
  const dom=new JSDOM(html,{url:'http://localhost/admin',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document;let requests=0,fail=false;
  w.fetch=async(url,options)=>{requests++;if(fail)throw new Error('Offline');state=dashboard.applyLayout(state,Object.fromEntries(options.body));return {ok:true,headers:{get:()=> 'application/json'},json:async()=>({layout:state})};};
  w.eval(fs.readFileSync('public/js/admin-dashboard.js','utf8'));w.eval(fs.readFileSync('public/js/dashboard-layout.js','utf8'));await tick();
  assert.equal(d.querySelector('[data-category-id="f1"]').open,false);
  const create=d.querySelector('[data-category-create]');create.elements.name.value='Renntag';create.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();const category=state.categories.at(-1).id;
  assert.equal(d.querySelector(`[data-category-id="${category}"] h2`).textContent,'Renntag');
  const drag=new w.Event('dragstart',{bubbles:true});Object.defineProperty(drag,'dataTransfer',{value:{setData(){}}});d.querySelector('[data-dashboard-category] [data-module="lmuTracks"] [data-drag-handle]').dispatchEvent(drag);
  d.querySelector(`[data-category-id="${category}"] summary`).dispatchEvent(new w.Event('drop',{bubbles:true,cancelable:true}));await tick();
  assert.equal(d.querySelector('[data-dashboard-category] [data-module="lmuTracks"]').closest('details').dataset.categoryId,category);
  const search=d.querySelector('[data-dashboard-search]');const before=requests;search.value='Rennwochenende Formel';search.dispatchEvent(new w.Event('input'));await tick();assert.equal(d.querySelector('[data-category-id="f1"]').open,true);search.value='';search.dispatchEvent(new w.Event('input'));await tick();assert.equal(d.querySelector('[data-category-id="f1"]').open,false);assert.equal(requests,before);
  const group=d.querySelector(`[data-category-id="${category}"]`);group.open=false;await tick();assert.equal(state.categories.at(-1).collapsed,true);
  fail=true;const move=d.querySelector('[data-category-move]');move.elements.module.value='lmuTracks';move.elements.category.value='f1';move.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(d.querySelector('[data-dashboard-category] [data-module="lmuTracks"]').closest('details').dataset.categoryId,category);assert.match(d.querySelector('[data-layout-status]').textContent,/Offline/);
  assert.equal(d.querySelectorAll('[data-dashboard-category] [data-module]').length,dashboard.modules().length);
});
test('LMU-Strafkartei rendert F1-Matrix mit Stamm-, Ersatz- und ehemaligen Fahrern, 12-SP-Limit und Flaggen',async t=>{
  penaltyDatabase(t);const res=response();await ledger.show({query:{}},res);
  assert.equal(res.view,'admin/penalty-ledger');assert.equal(res.data.ledgerBasePath,'/admin/lmu-penalty-ledger');
  const row=res.data.ledgers[0];assert.equal(row.threshold,12);assert.equal(row.groups.regular[0].remaining,8);assert.equal(row.rounds[0].roundNumber,1);assert.equal(row.rounds[0].flagPath,'/be.svg');assert.equal(row.groups.regular[0].cells[1].cellColor,'#ABCDEF');
  assert.equal(res.data.reserveLedger.rows[0].id,2);assert.equal(res.data.formerLedger.rows[0].id,3);
  const html=await ejs.renderFile('views/'+res.view+'.ejs',{...layout,...res.data});assert.match(html,/LMU STRAFKARTEI/);assert.match(html,/action="\/admin\/lmu-penalty-ledger\/settings"/);assert.doesNotMatch(html,/FORMEL 1 STRAFKARTEI/);
  const dom=new JSDOM(html);t.after(()=>dom.window.close());assert.equal(dom.window.document.querySelectorAll('[data-penalty-ledger]').length,3);assert.ok(dom.window.document.querySelectorAll('.penalty-cell-input').length>=3);
  assert.equal((await adapter.findRaceEvent(7,12,1)).eventId,50);assert.equal(await adapter.findRaceEvent(7,12,2),null);
});
test('LMU-Zellen speichern Zahl, S, Farbe und Leeren mit derselben F1-Berechnung',async t=>{
  penaltyDatabase(t);let rows=[];mock(t,'PenaltyEntry','findAll',async()=>rows);
  mock(t,'PenaltyEntry','create',async values=>{rows=[{id:1,...values,async update(next){Object.assign(this,next);}}];});mock(t,'PenaltyEntry','destroy',async()=>{rows=[];});
  const req={xhr:true,get:()=> 'application/json',session:{},body:{LeagueId:7,SeasonId:12,DriverId:1,roundNumber:1,cellValue:'4',cellColor:'#aabbcc'}};
  for(const [value,color,points,ban] of [['4','#aabbcc',4,false],['S','#aabbcc',0,true],['','#aabbcc',0,false],['','',0,false]]){
    req.body.cellValue=value;req.body.cellColor=color;const res=response();await ledger.create(req,res);assert.equal(res.code,200,JSON.stringify(res.data));assert.equal(res.data.points,points);assert.equal(res.data.isRaceBan,ban);assert.equal(res.data.totalPoints,points);assert.equal(res.data.cellColor,color.toUpperCase());
  }
  assert.equal(rows.length,0);
  for(const value of ['DNA','-1','1.5']){const res=response();await ledger.create({...req,body:{...req.body,cellValue:value}},res);assert.equal(res.code,400);}
});
test('LMU-Strafkartei lehnt disziplinfremde Saisons, Fahrer und Löschungen ab',async t=>{
  penaltyDatabase(t);const req={xhr:true,get:()=> 'application/json',body:{LeagueId:7,SeasonId:12,DriverId:1,roundNumber:1,cellValue:'1'}};
  mock(t,'Season','findOne',async options=>{assert.equal(options.where.leagueType,'lmu');return null;});let res=response();await ledger.create(req,res);assert.equal(res.code,400);
  mock(t,'Season','findOne',async()=>season);mock(t,'Driver','findByPk',async()=>({id:1,viewF1:true}));res=response();await ledger.create(req,res);assert.equal(res.code,400);
  mock(t,'PenaltyEntry','findByPk',async()=>({LeagueId:9,destroy(){assert.fail('F1-Strafe darf nicht gelöscht werden');}}));mock(t,'League','findOne',async()=>null);await assert.rejects(ledger.remove({params:{id:99},session:{}},response()),/anderen Disziplin/);
});
test('Öffentliche LMU-Strafkartei respektiert Sichtbarkeit auch in globalen Tabellen',async t=>{
  penaltyDatabase(t);const res=response();await ledger.publicShow({query:{}},res);assert.equal(res.data.publicPath,'/lmu/strafkartei');assert.equal(res.data.leagueTabs.length,1);
  const html=await ejs.renderFile('views/penalty-ledger-public.ejs',{...layout,isAdmin:false,...res.data});assert.match(html,/\/lmu\/strafkartei/);
  mock(t,'F1PenaltySetting','findOne',async()=>({publicVisible:false}));await ledger.publicShow({query:{}},res);assert.equal(res.data.leagueTabs.length,0);assert.equal(res.data.reserveLedger.rows.length,0);assert.equal(res.data.formerLedger.rows.length,0);
});

test('LMU-Saisonassistent führt durch acht Schritte, speichert Entwürfe und begrenzt das Line-up auf ausgewählte Fahrer',async t=>{
  const drivers=[regular,reserve,{id:4,name:'Nicht gewählt',viewLmu:true}];
  const html=await ejs.renderFile('views/admin/lmu-season-setup.ejs',{...layout,leagues:[league],league,calendars:[{id:3,name:'Kalender',rounds:[{sortOrder:1,isTestDay:true,circuit:'Spa',startsAt:'2026-10-01T18:00Z'},{sortOrder:2,circuit:'Spa',startsAt:'2026-10-11T18:00Z'}]}],games:[{id:5,name:'LMU'}],schemes:[{id:6,name:'Punkte'}],teams:[{id:8,name:'Team',accentColor:'#abcdef'}],drivers,draft:{name:'S7',LeagueId:7,LmuGameId:5,LmuCalendarId:3,PointsSchemeId:6,driverIds:['1','2'],teamIds:['8'],cockpits:{t8:{s0:'1'}},step:1}});
  const dom=new JSDOM(html,{url:'http://localhost/admin/lmu-season-setup',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document;let sent,offline=false;
  w.fetch=async(url,options)=>{assert.equal(url,'/admin/lmu-season-setup/draft');if(offline)throw new Error('Offline');sent=new URLSearchParams(options.body);return {ok:true,headers:{get:()=> 'application/json'}};};
  w.eval(fs.readFileSync('public/js/lmu-season-wizard.js','utf8'));
  const steps=[...d.querySelectorAll('[data-lmu-step]')];assert.equal(steps.length,8);assert.equal(steps.filter(s=>!s.hidden).length,1);assert.equal(steps[0].hidden,false);
  d.querySelector('[data-lmu-step-link="6"]').click();await tick();assert.equal(steps[6].hidden,false);assert.equal(sent.get('step'),'7');assert.deepEqual(sent.getAll('driverIds'),['1','2']);
  const seats=[...d.querySelectorAll('[data-cockpit-driver]')];assert.equal(seats.length,3);assert.equal(seats[0].querySelector('[value="4"]').disabled,true);
  seats[1].value='1';seats[1].dispatchEvent(new w.Event('change',{bubbles:true}));d.querySelector('[data-wizard-next]').click();await tick();assert.match(d.querySelector('[data-wizard-status]').textContent,/nur ein Cockpit/);assert.equal(steps[6].hidden,false);
  seats[1].value='';seats[1].dispatchEvent(new w.Event('change',{bubbles:true}));d.querySelector('[data-wizard-next]').click();await tick();assert.equal(steps[7].hidden,false);assert.equal(d.querySelector('[data-wizard-submit]').hidden,false);assert.match(d.querySelector('[data-setup-review]').textContent,/Ersatzfahrer: 1/);
  offline=true;d.querySelector('[data-wizard-back]').click();await tick();assert.equal(steps[7].hidden,false);assert.match(d.querySelector('[data-wizard-status]').textContent,/Offline/);
});
test('LMU-Saisonentwurf ist pro Sitzung gespeichert und erzeugt noch keine Saison',async()=>{
  const req={session:{},body:{step:'99',name:'Entwurf',driverIds:['1','2'],cockpits:{t8:{s0:'1'}}}},res=response();
  await require('../controllers/lmuAdminController').saveSetupDraft(req,res);assert.equal(req.session.lmuSetupDraft.step,8);assert.deepEqual(req.session.lmuSetupDraft.driverIds,['1','2']);assert.equal(res.data.saved,true);
});
function setupDatabase(t) {
  const saved={drivers:[],stints:[],events:[]};
  t.mock.method(m.sequelize,'transaction',async fn=>fn(tx));mock(t,'League','findByPk',async()=>record(league));mock(t,'Season','findOne',async()=>null);mock(t,'Season','findAll',async()=>[]);
  mock(t,'LmuCalendar','findByPk',async()=>({id:3,rounds:[{isTestDay:true,sortOrder:1,LmuTrackId:8,startsAt:'2026-10-01T18:00:00Z'},{sortOrder:2,LmuTrackId:8,startsAt:'2026-10-11T18:00:00Z'}]}));mock(t,'LmuGame','findByPk',async()=>({id:5,name:'LMU'}));mock(t,'PointsScheme','findByPk',async()=>({id:6,discipline:'lmu'}));
  mock(t,'Team','findAll',async()=>[{id:8,name:'Team',accentColor:'#abcdef'},{id:9,name:'Andere'}]);mock(t,'Driver','findAll',async()=>[regular,reserve,{id:3,name:'Dritter'},{id:4,name:'Vierter'}].map(record));
  mock(t,'Season','create',async values=>record({...season,...values}));mock(t,'SeasonTeam','create',async values=>record({id:20,...values}));
  mock(t,'SeasonDriver','create',async values=>{saved.drivers.push(values.DriverId);});mock(t,'SeasonLineupEntry','create',async()=>{});mock(t,'SeasonDriverStint','create',async values=>saved.stints.push(values));
  mock(t,'GrandPrixResult','create',async values=>({id:50,...values}));mock(t,'GrandPrixResult','update',async()=>{});mock(t,'RaceEvent','create',async values=>saved.events.push(values));mock(t,'RaceEvent','update',async()=>{});
  return saved;
}
const setupBody={LeagueId:7,name:'S7',LmuGameId:5,LmuCalendarId:3,PointsSchemeId:6,accentColor:'#abcdef',teamIds:['8'],driverIds:['1','2'],driverSelection:'explicit',cockpits:{t8:{s0:'1',s1:'',s2:''}}};
test('LMU-Saison speichert nur ausgewählte Fahrer mit drei Cockpits und übernimmt Strecken-IDs',async t=>{
  const saved=setupDatabase(t);await require('../services/lmuSeason').createSeason(setupBody);assert.deepEqual(saved.drivers,[1,2]);assert.deepEqual(saved.stints.map(s=>[s.DriverId,s.roleType,s.SeasonTeamId]),[[1,'regular',20],[2,'reserve',null]]);assert.equal(saved.events[0].LmuTrackId,8);assert.equal(saved.events[0].GrandPrixResultId,null);assert.equal(saved.events[1].GrandPrixResultId,50);
});
test('LMU-Saison schützt gegen fremde Fahrer/Teams, doppelte Cockpits und mehr als drei Stammfahrer',async t=>{
  setupDatabase(t);const create=require('../services/lmuSeason').createSeason;
  for(const bad of [{driverIds:[]},{driverIds:['99']},{cockpits:{t8:{s0:'3'}}},{cockpits:{t9:{s0:'1'}}},{cockpits:{t8:{s0:'1',s1:'1'}}},{driverIds:['1','2','3','4'],cockpits:{t8:{s0:'1',s1:'2',s2:'3',s3:'4'}}}]) await assert.rejects(create({...setupBody,...bad}));
});
test('LMU-Saisonkalender schützt Rundennummern auch bei vorhandenen Strafpunkten',async t=>{
  const calendar=require('../services/lmuSeasonCalendar');t.mock.method(m.sequelize,'transaction',async fn=>fn(tx));mock(t,'Season','findByPk',async()=>season);mock(t,'League','findOne',async()=>league);
  const events=[{id:50,GrandPrixResultId:80,SeasonId:12,circuit:'Spa',startsAt:'2026-10-11T18:00Z',sortOrder:1}];mock(t,'RaceEvent','findAll',async()=>events);mock(t,'GrandPrixResult','findAll',async()=>[{id:80,sortOrder:1,entries:[],lineupEntries:[]}]);mock(t,'SeasonDriverStint','findAll',async()=>[]);mock(t,'PenaltyEntry','count',async()=>1);
  await assert.rejects(calendar.save(12,{version:calendar.version(events),rounds:[{title:'Neu',circuit:'Spa',startsAt:'2026-10-12T20:00'}]}),/Strafeinträgen/);
});
test('LMU-Rennwochenende setzt bei zwölf Saison-Strafpunkten wie F1 eine Sperre',async t=>{
  mock(t,'PenaltyEntry','findAll',async options=>{assert.equal(options.where.SeasonId,12);return [{DriverId:1,points:5},{DriverId:1,points:7},{DriverId:2,points:11}];});
  const penalties=await require('../services/lmuWeekend').penalties(7,{SeasonId:12,sortOrder:2});assert.deepEqual([...penalties.banned],[1]);assert.equal(penalties.limit,12);
});
test('F1-Strafkartei behält ihren Endpunkt, die drei Ligen und die gemeinsame Zellberechnung',async t=>{
  const f1=require('../controllers/penaltyLedgerController');mock(t,'League','findAll',async options=>{assert.equal(options.where.type,'f1');assert.deepEqual(options.where.slug[Op.in],['freitag','samstag','sonntag']);return [];});mock(t,'F1Calendar','findAll',async()=>[]);
  const res=response();await f1.show({query:{}},res);assert.equal(res.data.ledgerBasePath,'/admin/penalty-ledger');const html=await ejs.renderFile('views/admin/penalty-ledger.ejs',{...layout,...res.data});assert.match(html,/FORMEL 1 STRAFKARTEI/);assert.match(html,/data-ledger-url="\/admin\/penalty-ledger"/);
  t.mock.method(m.sequelize,'transaction',async fn=>fn(tx));mock(t,'League','findOne',async options=>{assert.equal(options.where.type,'f1');return {id:1,slug:'freitag'};});mock(t,'Season','findOne',async options=>{assert.equal(options.where.leagueType,'f1');return {id:1,scopeSlug:'freitag'};});mock(t,'Driver','findByPk',async()=>({id:1}));mock(t,'RaceEvent','findOne',async options=>{assert.equal(options.where.sortOrder,1);return {id:1};});mock(t,'F1PenaltySetting','findOne',async()=>null);mock(t,'PenaltyEntry','findAll',async()=>[]);mock(t,'PenaltyEntry','create',async values=>{assert.equal(values.cellColor,'#AABBCC');assert.equal(values.points,3);});mock(t,'Season','findAll',async options=>{assert.equal(options.where.leagueType,'f1');return [];});
  await f1.create({xhr:true,get:()=> 'application/json',body:{LeagueId:1,SeasonId:1,DriverId:1,roundNumber:1,cellValue:'3',cellColor:'#aabbcc'}},res);assert.equal(res.data.ok,true);assert.equal(res.data.points,3);
});
