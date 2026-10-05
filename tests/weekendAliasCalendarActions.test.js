const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const ejs=require('ejs'),{JSDOM}=require('jsdom');
process.env.DB_HOST||='localhost';process.env.DB_NAME||='krl';process.env.DB_USER||='krl';process.env.DB_PASSWORD||='krl';
const models=require('../models');
const driver={id:1,name:'Original',aliases:[{alias:'Saisonname'}]},reserve={id:2,name:'Reserve',aliases:[{alias:'Ersatzalias'}]};
const season={id:2,status:'active',leagueType:'f1',scopeSlug:'freitag',driverDisplayNames:{history:{1:'Saisonname',2:'Ersatzalias'},lineup:{1:'Anderer Name'}}};
const make=values=>({...values,toJSON(){const {toJSON,...data}=this;return data;}});

test('Anzeigenamen ersetzen Fahrer in allen Assistenten-Zeilen, niemals IDs, Teams oder Stammdaten',async t=>{
 t.mock.method(models.Driver,'findAll',async()=>[driver,reserve]);
 const data={teamCards:[{team:{id:1,name:'Team'},rows:[{driver,entry:{DriverId:1,driverName:'Original'}}]}],reserveRows:[{driver:reserve,assignedTo:{driver}}],availableReplacements:[{id:2,name:'Reserve',entryId:99}],availableDrivers:[driver],rows:[{driver:reserve,replacesDriver:driver}],entries:[{DriverId:2,replacementFor:driver,driver:reserve}],bannedDriverIds:new Set([2])};
 const view=await require('../services/seasonAliases').forDisplay(season,data);
 assert.equal(view.teamCards[0].rows[0].driver.name,'Saisonname');assert.equal(view.teamCards[0].rows[0].entry.driverName,'Saisonname');assert.equal(view.teamCards[0].team.name,'Team');assert.equal(view.reserveRows[0].driver.name,'Ersatzalias');assert.equal(view.entries[0].replacementFor.name,'Saisonname');assert.equal(view.availableReplacements[0].name,'Ersatzalias');assert.equal(view.availableReplacements[0].entryId,99);assert.equal(view.availableDrivers[0].name,'Saisonname');assert.equal(view.rows[0].replacesDriver.name,'Saisonname');assert.ok(view.bannedDriverIds.has(2));assert.equal(driver.name,'Original');
 assert.equal((await require('../services/seasonAliases').forDisplay({...season,driverDisplayNames:{}},data)),data);
});

test('Rennwochenende rendert Saison-Aliase für Aufstellung, Anwesenheit und Ersatzsuche',async t=>{
 const league={id:3,name:'Freitag',slug:'freitag'},race={id:4,SeasonId:2,LeagueId:3,sortOrder:1,title:'GP',raceType:'main'};
 const team={id:5,name:'Team'},entries=[make({id:6,DriverId:1,roleType:'regular',driver:make(driver),team,status:'anwesend'}),make({id:7,DriverId:2,roleType:'reserve',driver:make(reserve),status:'anwesend',includeInResults:false})];
 t.mock.method(models.League,'findAll',async()=>[league]);t.mock.method(models.Season,'findAll',async()=>[season]);
 t.mock.method(models.RaceEvent,'findAll',async()=>[{id:8,GrandPrixResultId:4,grandPrixResult:race,startsAt:'2026-11-01',sortOrder:1}]);
 t.mock.method(models.F1RaceLineupEntry,'findAll',async()=>entries);
 for(const name of ['SeasonDriver','SeasonTeam','SeasonLineupEntry','SeasonDriverStint'])t.mock.method(models[name],'findAll',async()=>[]);
 t.mock.method(models.Driver,'findAll',async()=>[driver,reserve]);t.mock.method(models.GrandPrixResultEntry,'count',async()=>0);
 t.mock.method(require('../controllers/f1RaceLineupController'),'loadPlanningRows',async()=>({teamCards:[{team,rows:[{driver,entry:entries[0],status:'anwesend'}],vacantSlots:[]}],reserveRows:[{driver:reserve,status:'anwesend'}],reserves:[reserve],hasSavedPlan:true}));
 let data;await require('../controllers/raceWeekendController').show({params:{discipline:'f1'},query:{league:3,season:2,race:4},session:{}},{render(view,result){assert.equal(view,'admin/race-weekend');data=result;}});
 assert.equal(data.teamCards[0].rows[0].driver.name,'Saisonname');assert.equal(data.attendanceRows[0].entry.driver.name,'Saisonname');assert.equal(data.availableReplacements[0].name,'Ersatzalias');assert.equal(entries[0].driver.name,'Original');
 const html=await ejs.renderFile('views/admin/race-weekend.ejs',{...data,isAdmin:true});assert.match(html,/Saisonname/);assert.match(html,/Ersatzalias/);
});

for(const type of ['f1','lmu'])for(const status of ['active','historical'])test(`Kalender-Sammelstatus bleibt auf ${type}/${status} Saison beschränkt`,async t=>{
 const tx={LOCK:{UPDATE:'update'}};t.mock.method(models.sequelize,'transaction',async fn=>fn(tx));
 t.mock.method(models.Season,'findByPk',async(id,options)=>{assert.equal(options.lock,'update');return {id:7,leagueType:type,status,scopeSlug:'freitag'};});
 t.mock.method(models.League,'findOne',async options=>{assert.deepEqual(options.where,{slug:'freitag',type});return {id:3,type,slug:'freitag'};});
 const calls=[];t.mock.method(models.RaceEvent,'update',async(values,options)=>{assert.equal(options.transaction,tx);assert.deepEqual(options.where,{SeasonId:7,LeagueId:3});calls.push(values);return [4];});
 t.mock.method(models.GrandPrixResultEntry,'destroy',async()=>assert.fail('Ergebnisse dürfen nicht gelöscht werden'));
 let url;for(const completed of ['1','0']){const req={params:{seasonId:7},body:{completed},session:{}};await require('../controllers/calendarEventController').setSeasonCompletion(req,{redirect(value){url=value;}},()=>assert.fail('404'));assert.equal(req.session.flash.type,'success');}
 assert.deepEqual(calls,[{isCompleted:true},{isCompleted:false}]);assert.match(url,/season=7#/);
});

test('Ungültiger Status oder fehlende Saison führt zu keiner Kalenderänderung',async t=>{
 const action=require('../controllers/calendarEventController').setSeasonCompletion;
 const update=t.mock.method(models.RaceEvent,'update',async()=>assert.fail('Kein Schreiben'));
 let code,next=false;t.mock.method(models.sequelize,'transaction',async fn=>fn({LOCK:{UPDATE:'update'}}));t.mock.method(models.Season,'findByPk',async()=>null);
 const res={status(v){code=v;return this;},send(){}};
 await action({body:{completed:'yes'},params:{seasonId:1}},res,()=>{next=true;});assert.equal(code,400);
 await action({body:{completed:'1'},params:{seasonId:1}},res,()=>{next=true;});assert.equal(next,true);assert.equal(update.mock.callCount(),0);
});

test('Sammelaktionen im Kalender sind nur für Admins und echte Saisontermine sichtbar',async()=>{
 for(const status of ['active','historical'])for(const isAdmin of [true,false]){
 const html=await ejs.renderFile('views/partials/race-calendar.ejs',{isAdmin,selectedSeason:{id:2,status,leagueType:'f1',isPublished:true},league:{name:'Freitag'},calendar:[{id:1,title:'GP',isPublished:true}],emptyMessage:'Leer'});
 const dom=new JSDOM(html),d=dom.window.document;assert.equal(d.querySelectorAll('.calendar-bulk-actions button').length,isAdmin?2:0);if(isAdmin)assert.equal(d.querySelector('.calendar-bulk-actions form').getAttribute('action'),'/admin/calendar-seasons/2/completion');dom.window.close();
 }
});

test('Fahrerprofil listet alle Aliase sicher und ist auch unter einem Alias auffindbar',async t=>{
 const names=['Alt','<img src=x onerror=alert(1)>','Anderer Alias'];
 const statistics=require('../services/careerStatistics').buildCareerStatistics([{id:1,name:'Original',email:'privat',aliases:names.map((alias,i)=>({alias,sortOrder:i,secret:'privat'}))}],[]);
 assert.deepEqual(statistics[0].aliases,names);assert.equal(statistics[0].email,undefined);
 const html=await ejs.renderFile('views/statistics.ejs',{title:'Statistik',statistics});const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost/krl-statistik?driver=1'});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 w.eval(fs.readFileSync('public/js/career-statistics.js','utf8'));assert.deepEqual([...d.querySelectorAll('.career-aliases li')].map(li=>li.textContent),names);assert.equal(d.querySelector('.career-aliases img'),null);
 const search=d.querySelector('[data-career-search]');search.value='anderer alias';search.dispatchEvent(new w.Event('input'));assert.equal(d.querySelectorAll('.career-driver').length,1);
});
