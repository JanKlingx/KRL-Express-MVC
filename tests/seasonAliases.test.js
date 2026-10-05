const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),ejs=require('ejs');
process.env.DB_HOST||='localhost';process.env.DB_NAME||='krl';process.env.DB_USER||='krl';process.env.DB_PASSWORD||='krl';
const models=require('../models'),aliases=require('../services/seasonAliases'),grid=require('../services/historicalGrid');
const drivers=[{id:1,name:'Alpha',aliases:[{alias:'Alter Name'},{alias:'Cockpitname'}]},{id:2,name:'Beta',aliases:[]}];

test('Alias-Auswahl bleibt saisonbezogen, trennt Aufstellung und Verlauf und verwirft entfernte Aliase',async t=>{
 t.mock.method(models.Driver,'findAll',async()=>drivers);
 const input={history:{1:'Alter Name'},lineup:{1:'Cockpitname'}};
 assert.deepEqual(aliases.validate(input,drivers,true),input);
 assert.notEqual(grid.revision({updatedAt:'2020-01-01',driverDisplayNames:input}),grid.revision({updatedAt:'2020-01-01',driverDisplayNames:{}}));
 assert.throws(()=>aliases.validate(input,drivers,false),/historisch/);
 assert.throws(()=>aliases.validate({history:{2:'Alter Name'}},drivers,true),/gehört/);
 const context=await aliases.load({driverDisplayNames:input},[1,2]);
 assert.equal(context.name(1,'Alpha'),'Alter Name');assert.equal(context.name(1,'Alpha','lineup'),'Cockpitname');
 const data={selectedHistory:{drivers:[{id:1,name:'Alpha',total:26}],reserveDrivers:[]},driverStandings:[{points:26,driver:{id:1,name:'Alpha'}}],standingsHistory:[{driverStandings:[{id:1,name:'Alpha',points:26}]}]};
 aliases.applyStandings(data,context);assert.equal(data.selectedHistory.drivers[0].name,'Alter Name');assert.equal(data.driverStandings[0].driver.name,'Alter Name');assert.equal(data.driverStandings[0].driver.id,1);assert.equal(data.standingsHistory[0].driverStandings[0].points,26);
 const other=await aliases.load({driverDisplayNames:{history:{1:'Gelöscht'}}},[1]);assert.equal(other.name(1,'Alpha'),'Alpha');
 assert.equal((await aliases.load({},[1])).name(1,'Alpha'),'Alpha');
});

test('Aktuelle Alias-Auswahl speichert nur den gewählten Fahrer und lehnt fremde Fahrer/Aliase ab',async t=>{
 const tx={LOCK:{UPDATE:'update'}},season={id:9,status:'active',leagueType:'f1',driverDisplayNames:{history:{2:'Bestehend'}}};let values;
 season.update=async(v,o)=>{assert.equal(o.transaction,tx);values=v;};
 t.mock.method(models.sequelize,'transaction',async fn=>fn(tx));t.mock.method(models.Season,'findByPk',async()=>season);
 t.mock.method(models.SeasonDriver,'count',async()=>1);t.mock.method(models.Driver,'findByPk',async()=>drivers[0]);
 let code=200,result;const res={status(v){code=v;return this;},json(v){result=v;}};
 const req={params:{seasonId:9},body:{driverId:1,scope:'history',alias:'Alter Name'}};
 await aliases.save(req,res);assert.equal(code,200);assert.equal(values.driverDisplayNames.history[2],'Bestehend');assert.equal(values.driverDisplayNames.history[1],'Alter Name');
 values=null;req.body.alias='Unbekannt';await aliases.save(req,res);assert.equal(code,422);assert.equal(values,null);
 req.body.alias='Alpha';await aliases.save(req,res);assert.equal(values.driverDisplayNames.history[1],undefined);
 t.mock.method(models.SeasonDriver,'count',async()=>0);t.mock.method(models.SeasonDriverStint,'count',async()=>0);t.mock.method(models.GrandPrixResultEntry,'count',async()=>0);
 values=null;await aliases.save(req,res);assert.equal(values,null);assert.match(result.error,/gehört nicht/);
 season.status='historical';await aliases.save(req,res);assert.match(result.error,/Saisonverlauf speichern/);
});

test('Chips können Namen mit Komma hinzufügen, bearbeiten, entfernen und beim Speichern übernehmen',t=>{
 const dom=new JSDOM('<form><div data-alias-editor><textarea name="aliasesText">Alt</textarea></div></form>',{runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 w.eval(fs.readFileSync('public/js/alias-chips.js','utf8'));
 const input=d.querySelector('.alias-chip-controls input'),add=d.querySelector('.alias-chip-controls button');
 input.value='Name, mit Komma';add.click();assert.deepEqual(JSON.parse(d.querySelector('[name=aliasesJson]').value),['Alt','Name, mit Komma']);
 d.querySelector('[aria-label="Alt bearbeiten"]').click();input.value='Neu';add.click();assert.match(d.querySelector('.alias-chip').textContent,/Neu/);
 input.value='neu';add.click();assert.match(d.querySelector('[role=alert]').textContent,/bereits/);
 d.querySelector('[aria-label="Neu löschen"]').click();assert.equal(d.querySelectorAll('.alias-chip').length,1);
 input.value='Noch ein Alias';d.querySelector('form').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.deepEqual(JSON.parse(d.querySelector('[name=aliasesJson]').value),['Name, mit Komma','Noch ein Alias']);
});

test('Alias-Chips werden strukturiert gespeichert, Duplikate entfernt und ungültige Eingaben nicht gelöscht',async t=>{
 const tx={};let saved,destroyed=0;
 t.mock.method(models.sequelize,'transaction',async fn=>fn(tx));t.mock.method(models.DriverAlias,'destroy',async()=>destroyed++);t.mock.method(models.DriverAlias,'bulkCreate',async rows=>saved=rows);
 const sync=require('../services/resourceConfig').lmuDrivers.afterSave;
 await sync(drivers[0],{aliasesJson:JSON.stringify(['Name, mit Komma','NAME, MIT KOMMA','Alpha','Neu'])});assert.deepEqual(saved.map(r=>r.alias),['Name, mit Komma','Neu']);
 await assert.rejects(sync(drivers[0],{aliasesJson:'{}'}));assert.equal(destroyed,1);
});

test('Historische Alias-Dropdowns markieren Änderungen und bleiben zwischen Aufstellung und Verlauf getrennt',t=>{
 const data={seasonId:1,historical:true,drivers:[{id:1,name:'Alpha',aliases:['Alpha','Alter Name','Cockpitname']}],selected:{history:{},lineup:{}}};
 const dom=new JSDOM(`<script id="season-alias-data" type="application/json">${JSON.stringify(data)}</script><div data-history-driver="1"><div class="sheet-driver"></div></div><li data-lineup-alias-driver="1"><strong>Alpha</strong></li>`,{runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document;let changes=0;d.addEventListener('season-alias-change',()=>changes++);
 w.eval(fs.readFileSync('public/js/season-aliases.js','utf8'));
 const history=d.querySelector('[data-alias-scope=history]');history.value='Alter Name';history.dispatchEvent(new w.Event('change'));
 const lineup=d.querySelector('[data-alias-scope=lineup]');lineup.value='Cockpitname';lineup.dispatchEvent(new w.Event('change'));
 assert.equal(w.SeasonAliases.name(1,'Alpha'),'Alter Name');assert.equal(d.querySelector('li strong').textContent,'Cockpitname');assert.equal(changes,2);
 w.SeasonAliases.reset();assert.equal(history.value,'Alpha');assert.equal(lineup.value,'Alpha');
});

test('Teamlose Ersatzfahrer behalten Punkte und Auszeichnungen; kein Team erhält diese Ergebnisse',async()=>{
 const racers=Array.from({length:3},(_,i)=>({id:i+1,name:`Fahrer ${i+1}`}));
 const teams=[{id:10,baseTeamId:100,name:'Team'}],race={id:7,sortOrder:1,raceType:'main',discipline:'f1',SeasonId:9,isHistorical:true,seasonRecord:{isPublished:true,name:'Archiv'}};
 const input={lineup:[],rows:racers.map((d,i)=>({rowId:`r${i}`,driverId:d.id,role:'reserve',teamId:10,cells:{7:{position:i+1,teamId:null,fastestLap:i===0,polePosition:i===0,driverOfTheDay:i===0}}}))};
 const valid=grid.validateGrid(input,racers,teams,[race]);assert.ok(valid.rows.every(r=>r.cells[7].teamId===null));
 const entries=await grid.projectGrid(valid,[race],racers,teams,async(p,c)=>25-(p-1)*7+(c.fastestLap?1:0),{PointsSchemeId:1});
 assert.equal(entries[0].points,26);assert.ok(entries.every(e=>e.TeamId===null&&e.teamName===null));
 const career=entries.map((e,i)=>({...e,id:i+1,grandPrixResult:race}));
 assert.equal(require('../services/driverStats').summarizeDriverEntries([career[0]]).f1.points,26);
 assert.equal(require('../services/driverStats').summarizeDriverEntries([career[0]]).f1.poles,1);
 assert.equal(require('../services/teamCareerStatistics').buildTeamCareerStatistics([{id:100,name:'Team'}],career)[0].seasons.length,0);
 const base={selectedHistory:{},standingsHistory:[]};grid.standingsForGrid(base,valid,[{...race,entries}],racers,teams,{reservePointsForConstructors:true});assert.equal(base.teamStandings[0].points,0);assert.equal(base.reserveStandings[0].points,26);
 const html=await ejs.renderFile('views/partials/gp-results.ejs',{label:'Ergebnisse',items:[{...race,entries}],teams:[],league:{name:'Freitag',logoPath:'/liga.png'},selectedSeason:{status:'historical'}});
 const dom=new JSDOM(html);const logos=[...dom.window.document.querySelectorAll('.gp-broadcast-podium-team img')];assert.equal(logos.length,3);assert.ok(logos.every(img=>img.getAttribute('src')==='/liga.png'));dom.window.close();assert.match(html,/Fahrer 1/);
 const regular=structuredClone(input);regular.rows[0].role='regular';assert.throws(()=>grid.validateGrid(regular,racers,teams,[race]),/Team/);
 const unknown=structuredClone(input);unknown.rows[0].cells[7].teamId=999;assert.throws(()=>grid.validateGrid(unknown,racers,teams,[race]),/Team/);
});

test('F1-Seite zeigt gespeicherte Aliase in Verlauf, WM und GP, ohne Ergebnisse umzuschreiben',async t=>{
 const make=values=>({...values,toJSON(){const {toJSON,...plain}=this;return plain;}});
 const season=make({id:9,name:'Archiv',status:'historical',leagueType:'f1',scopeSlug:'freitag',isPublished:true,driverDisplayNames:{history:{1:'Alter Name'},lineup:{1:'Cockpitname'}},historicalGrid:{lineup:[],rows:[{rowId:'a',driverId:1,role:'reserve',teamId:null,cells:{7:{position:1,teamId:null,points:null,status:''}}}]}});
 const league=make({id:1,name:'Freitag',slug:'freitag',logoPath:'/liga.png'});
 const race=make({id:7,title:'GP',circuit:'Spa',sortOrder:1,raceType:'main',discipline:'f1',raceDate:'2020-01-01',entries:[{DriverId:1,driverName:'Alpha',position:1,TeamId:null,teamName:null,points:26,fastestLap:true}]});
 t.mock.method(models.League,'findOne',async()=>league);t.mock.method(models.Season,'findAll',async()=>[season]);
 for(const model of ['TeamRoster','RaceEvent','SeasonF1CarAssignment','PenaltyEntry','SeasonDriver','SeasonTeam','SeasonLineupEntry','SeasonDriverStint','F1RaceLineupEntry'])t.mock.method(models[model],'findAll',async()=>[]);
 t.mock.method(models.F1PenaltySetting,'findOne',async()=>null);t.mock.method(models.Driver,'findAll',async()=>drivers.map(make));t.mock.method(models.GrandPrixResult,'findAll',async()=>[race]);t.mock.method(models.Team,'findAll',async()=>[]);
 let data;await require('../controllers/f1Controller').show({params:{slug:'freitag'},query:{}},{locals:{isAdmin:true},render(view,result){data=result;}});
 assert.equal(data.selectedHistory.reserveDrivers[0].name,'Alter Name');assert.equal(data.reserveStandings[0].driver.name,'Alter Name');assert.equal(data.gpResults[0].entries[0].driverName,'Alter Name');assert.equal(data.raceStatistics[0].fastestLap,'Alter Name');assert.equal(race.entries[0].driverName,'Alpha');assert.equal(data.reserveStandings[0].points,26);
 const html=await ejs.renderFile('views/f1.ejs',{...data,title:'Liga',isAdmin:true});const dom=new JSDOM(html);t.after(()=>dom.window.close());
 assert.equal(JSON.parse(dom.window.document.getElementById('season-alias-data').textContent).selected.history[1],'Alter Name');
 season.status='active';
 t.mock.method(models.SeasonTeam,'findAll',async()=>[make({id:10,name:'Team',sourceType:'current',sourceId:100})]);
 t.mock.method(models.SeasonLineupEntry,'findAll',async()=>[{DriverId:1,SeasonTeamId:10,roleType:'regular',driver:make(drivers[0])}]);
 await require('../controllers/f1Controller').show({params:{slug:'freitag'},query:{}},{locals:{isAdmin:true},render(view,result){data=result;}});assert.equal(data.gpResults[0].entries[0].driverName,'Alter Name');assert.equal(data.selectedHistory.drivers[0].name,'Alter Name');assert.equal(data.driverStandings[0].driver.name,'Alter Name');
});

test('Chip-Eingabe bleibt im ersten Wizard-Schritt und Enter fügt den Alias hinzu',async t=>{
 const config=require('../services/resourceConfig').drivers;
 const html=await ejs.renderFile('views/admin/resource-form.ejs',{title:'Fahrer',isAdmin:true,resource:'drivers',config,entry:null,error:null,duplicateDriver:null,fieldOptions:{PlatformId:[]},adminBasePath:'/admin',returnHref:'/admin/drivers'});
 const dom=new JSDOM(html,{runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document;
 await new Promise(resolve=>w.addEventListener('load',resolve,{once:true}));
 w.eval(fs.readFileSync('public/js/alias-chips.js','utf8'));w.eval(fs.readFileSync('public/js/driver-wizard.js','utf8'));d.dispatchEvent(new w.Event('DOMContentLoaded'));
 const editor=d.querySelector('[data-alias-editor]');assert.equal(editor.closest('fieldset').querySelector('legend').textContent,'1 · Name und Identität');
 const input=editor.querySelector('.alias-chip-controls input');input.value='Alias';input.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(editor.querySelectorAll('.alias-chip').length,1);assert.equal(d.querySelector('[data-driver-view-picker]').hidden,true);
});

test('Historischer Speichervorgang speichert Aliase und teamlose Ergebnisse gemeinsam',async t=>{
 const make=v=>({...v,toJSON(){const {toJSON,...data}=this;return data;}});
 const state={lineup:[],rows:[{rowId:'a',driverId:1,role:'reserve',teamId:null,cells:{7:{position:1,teamId:null,status:'',fastestLap:true}}}]};
 const season={id:9,status:'historical',leagueType:'f1',scopeSlug:'freitag',PointsSchemeId:1,updatedAt:'2020-01-01',historicalGrid:state};
 const tx={LOCK:{UPDATE:'update'}};let saved,results;
 season.update=async(values,options)=>{assert.equal(options.transaction,tx);saved=values;};
 t.mock.method(models.sequelize,'transaction',async fn=>fn(tx));t.mock.method(models.Season,'findByPk',async()=>season);
 t.mock.method(models.SeasonDriver,'findAll',async()=>[]);t.mock.method(models.SeasonTeam,'findAll',async()=>[]);t.mock.method(models.Driver,'findAll',async()=>drivers.map(make));
 t.mock.method(models.GrandPrixResult,'findAll',async()=>[{id:7,title:'GP',sortOrder:1,raceType:'main',entries:[]}]);
 t.mock.method(models.GrandPrixResultEntry,'destroy',async opts=>assert.equal(opts.transaction,tx));t.mock.method(models.GrandPrixResultEntry,'bulkCreate',async(rows,opts)=>{assert.equal(opts.transaction,tx);results=rows;});
 t.mock.method(models.GrandPrixResult,'update',async()=>{});t.mock.method(models.RaceEvent,'update',async()=>{});t.mock.method(require('../services/championship'),'pointsForPosition',async()=>26);
 let status=200,response;await require('../controllers/historicalGridController').save({params:{seasonId:9},body:{grid:state,revision:grid.revision(season),displayNames:{history:{1:'Alter Name'},lineup:{1:'Cockpitname'}}}},{status(code){status=code;return this;},json(value){response=value;}});
 assert.equal(status,200,JSON.stringify(response));assert.equal(saved.driverDisplayNames.history[1],'Alter Name');assert.equal(saved.driverDisplayNames.lineup[1],'Cockpitname');assert.equal(results[0].TeamId,null);assert.equal(results[0].teamName,null);assert.equal(results[0].points,26);assert.equal(results[0].DriverId,1);
});
