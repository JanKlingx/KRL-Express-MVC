process.env.DB_HOST ||= 'localhost';process.env.DB_NAME ||= 'krl';process.env.DB_USER ||= 'krl';process.env.DB_PASSWORD ||= 'krl';
const test=require('node:test'),assert=require('node:assert/strict');
const {initialGrid,validateGrid,projectGrid,standingsForGrid,lineupsForGrid}=require('../services/historicalGrid');
const {buildSeasonData}=require('../services/standings');const {wizardState}=require('../services/seasonWizard');
const drivers=[{id:1,name:'Alpha'},{id:2,name:'Beta'}],teams=[{id:10,name:'Team A',sourceType:'current',sourceId:100,baseTeamId:100},{id:20,name:'Team B',sourceType:'current',sourceId:200,baseTeamId:200}];
const races=[{id:1,sortOrder:1,raceType:'main',entries:[]},{id:2,sortOrder:2,raceType:'main',entries:[]},{id:3,sortOrder:2,raceType:'sprint',entries:[]}];
const cell=(position,teamId=10,status='')=>({position,teamId,status});
const points=async(position,context)=>(context.raceType==='sprint'?{1:8,2:7}:{1:25,2:18})[position]+(context.fastestLap?1:0)+(context.polePosition?2:0);
test('Historical wizard skips participants and lineup; current seasons still require seats',()=>{
 const input={selectedLeague:{id:1},selectedSeason:{id:1,status:'historical',PointsSchemeId:1},calendar:[{startsAt:new Date()}],structure:{allDrivers:drivers,teams,lineup:[]}};
 input.structure.allDrivers=[];assert.equal(wizardState(input).current,8);assert.equal(wizardState(input,5).current,6);assert.equal(wizardState(input,7).current,8);input.structure.allDrivers=drivers;
 input.selectedSeason.status='active';assert.equal(wizardState(input).current,7);
});
test('New reconstruction starts with every participant in both tables and empty results',()=>{
 const grid=initialGrid(drivers,teams,races);assert.equal(grid.rows.length,4);
 const base=buildSeasonData({slug:'sonntag'},races,drivers,[],{status:'historical'});
 const data=standingsForGrid(base,grid,races,drivers,teams);
 for(const list of [data.selectedHistory.drivers,data.selectedHistory.reserveDrivers]){assert.equal(list.length,2);assert.ok(list.every(row=>row.results.every(result=>result.main.unfilled)));}
});
test('Manual roles, transfers and awards generate common results once and reconcile all standings',async()=>{
 const grid=initialGrid(drivers,teams);const row=(driver,role)=>grid.rows.find(row=>row.driverId===driver&&row.role===role);
 row(1,'regular').cells[1]={...cell(1),fastestLap:true,polePosition:true,driverOfTheDay:true};row(2,'regular').cells[1]=cell(null,10,'DNA');row(2,'reserve').cells[1]=cell(2);
 row(1,'regular').cells[2]=cell(null,10,'DNA');row(1,'reserve').cells[2]=cell(1,20);row(2,'regular').cells[2]=cell(2,20);
 row(1,'reserve').cells[3]=cell(null,20,'DNF');row(2,'regular').cells[3]=cell(1,20);
 const valid=validateGrid(grid,drivers,teams,races);const entries=await projectGrid(valid,races,drivers,teams,points,{PointsSchemeId:1});
 assert.equal(entries.filter(entry=>entry.DriverId===1&&entry.GrandPrixResultId===1).length,1);assert.equal(entries[0].points,28);
 const resultRaces=races.map(race=>({...race,entries:entries.filter(entry=>entry.GrandPrixResultId===race.id)}));
 const data=standingsForGrid(buildSeasonData({slug:'sonntag'},resultRaces,drivers,lineupsForGrid(valid,resultRaces),{status:'historical',reservePointsForConstructors:true}),valid,resultRaces,drivers,teams);
 assert.equal(data.driverStandings.find(row=>row.id===1).points,28);assert.equal(data.driverStandings.find(row=>row.id===2).points,26);
 assert.equal(data.reserveStandings.find(row=>row.id===1).points,25);assert.equal(data.reserveStandings.find(row=>row.id===2).points,18);
 assert.equal(data.teamStandings.reduce((sum,row)=>sum+row.points,0),97);
 const stats=require('../services/driverStats').summarizeDriverEntries(entries.filter(entry=>entry.DriverId===1).map(entry=>({...entry,grandPrixResult:{...races.find(race=>race.id===entry.GrandPrixResultId),discipline:'f1'}}))).f1;
 assert.equal(stats.points,53);assert.equal(stats.poles,1);assert.equal(stats.fastestLaps,1);assert.equal(stats.driverOfTheDays,1);
 assert.equal(data.selectedHistory.drivers.find(row=>row.id===1).results[1].main.status,'DNA');
 const noReserves=standingsForGrid(buildSeasonData({slug:'sonntag'},resultRaces,drivers,[],{}),valid,resultRaces,drivers,teams,{reservePointsForConstructors:false});assert.equal(noReserves.teamStandings.reduce((sum,row)=>sum+row.points,0),54);
});
test('Duplicate starts, duplicate places, invalid team and sprint awards are rejected',()=>{
 const grid=initialGrid(drivers,teams);grid.rows[0].cells[1]=cell(1);grid.rows[1].cells[1]=cell(2);
 assert.throws(()=>validateGrid(grid,drivers,teams,races),/einer Wertung/);
 delete grid.rows[1].cells[1];grid.rows[2].cells[1]=cell(1);assert.throws(()=>validateGrid(grid,drivers,teams,races),/bereits vergeben/);
 delete grid.rows[2].cells[1];grid.rows[0].cells[1].teamId=999;assert.throws(()=>validateGrid(grid,drivers,teams,races),/Team/);
 grid.rows[0].cells={3:{...cell(1),fastestLap:true}};assert.throws(()=>validateGrid(grid,drivers,teams,races),/Hauptrennen/);
});
test('Deleting one row leaves the opposite role intact; legacy points are preserved',async()=>{
 const grid=initialGrid(drivers,teams);grid.rows[0].cells[1]=cell(1);grid.rows[1].cells[2]=cell(2);
 grid.rows.splice(0,1);const entries=await projectGrid(validateGrid(grid,drivers,teams,races),races,drivers,teams,points,{});
 assert.equal(entries.length,1);assert.equal(entries[0].role,'reserve');assert.equal(entries[0].points,18);
 const old=initialGrid(drivers,teams,[{...races[0],entries:[{DriverId:1,teamName:'Team A',points:20}]}]);assert.equal(validateGrid(old,drivers,teams,races).rows[0].cells[1].points,20);
});
test('Public historical tables edit points, remove and restore rows, and keep final lineup independent',async t=>{
 const ejs=require('ejs'),fs=require('node:fs'),{JSDOM}=require('jsdom');
 const data={grid:{...initialGrid(drivers,teams,races),lineup:[]},drivers,teams,races,revision:'test'};
 const selectedSeason={id:1,status:'historical'};
 const selectedHistory={name:'S1',races:[{round:1,isCompleted:true,title:'R1'},{round:2,isCompleted:true,title:'R2',hasSprint:true}],drivers:drivers.map(d=>({...d,results:[],total:0})),reserveDrivers:drivers.map(d=>({...d,results:[],total:0}))};
 const html=await ejs.renderFile('views/partials/historical-grid-editor.ejs',{historicalEditor:data,selectedSeason})+await ejs.renderFile('views/partials/season-history.ejs',{historicalEditor:data,selectedSeason,selectedHistory,history:{seasons:[{name:'S1'}]},isAdmin:true,league:{}});
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost/f1/sonntag?season=1'});t.after(()=>dom.window.close());
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 dom.window.eval(fs.readFileSync('public/js/historical-periods.js','utf8'));dom.window.eval(fs.readFileSync('public/js/historical-grid.js','utf8'));const doc=dom.window.document;
 const regular=doc.querySelector('[data-history-driver="1"][data-history-role="regular"]');
 regular.querySelector('.historical-cell-button').click();const form=doc.querySelector('[data-historical-dialog] form');form.elements.position.value='1';form.elements.teamId.value='10';assert.equal(form.elements.fastestLap,undefined);form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 assert.match(regular.querySelector('.historical-cell-button').textContent,/P1/);assert.equal(form.elements.points,undefined);
 const reserve=doc.querySelector('[data-history-driver="1"][data-history-role="reserve"]');
 [...reserve.querySelectorAll('.sheet-driver button')].find(b=>b.textContent==='−').click();assert.equal(reserve.hidden,true);assert.equal(regular.hidden,false);
 doc.querySelector('[data-historical-add-role="reserve"]').click();doc.querySelector('[data-historical-add]').value='1';doc.querySelector('[data-historical-add-dialog] select[name=teamId]').value='10';doc.querySelector('[data-historical-add-button]').click();assert.equal(doc.querySelectorAll('[data-history-driver="1"][data-history-role="reserve"]:not([hidden])').length,1);
 [...regular.querySelectorAll('.sheet-driver button')].find(b=>b.textContent==='✎').click();const rowForm=doc.querySelector('[data-historical-row-dialog] form');rowForm.elements.retiredFromRound.value='2';rowForm.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 assert.equal(regular.querySelector('[data-round="2"]').classList.contains('is-historical-retired'),true);
 assert.equal(regular.querySelector('[data-round="1"]').classList.contains('is-historical-retired'),false);
 let posted;dom.window.fetch=async(url,options)=>{posted=JSON.parse(options.body);return {ok:false,json:async()=>({error:'Retry'})};};doc.querySelector('[data-historical-save]').click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(posted.grid.rows.find(r=>r.driverId===1&&r.role==='regular').cells[1].points,null);assert.deepEqual(posted.grid.lineup,[]);
});
test('Manual points reconcile driver and constructor totals; awards do not double-count bonuses',async()=>{
 const grid={...initialGrid(drivers,teams),lineup:[{driverId:1,teamId:20}]};
 grid.rows[0].teamId=10;grid.rows[0].retiredFromRound=2;
 grid.rows[0].cells[1]={points:26,position:1,status:'',teamId:10,fastestLap:true,polePosition:true,driverOfTheDay:true};
 grid.rows[0].cells[2]={status:'DNA'};
 grid.rows[1].cells[2]={points:0,status:'',teamId:20};
 grid.rows[2].cells[1]={points:18,status:'',teamId:10};
 const valid=validateGrid(grid,drivers,teams,races);
 const entries=await projectGrid(valid,races,drivers,teams,points,{});
 assert.equal(entries.reduce((sum,e)=>sum+e.points,0),46);assert.equal(entries.find(e=>e.DriverId===1&&e.GrandPrixResultId===1).TeamId,100);
 const projected=races.map(r=>({...r,entries:entries.filter(e=>e.GrandPrixResultId===r.id)}));
 const standings=standingsForGrid(buildSeasonData({slug:'sonntag'},projected,drivers,lineupsForGrid(valid,projected),{status:'historical'}),valid,projected,drivers,teams);
 assert.equal(standings.teamStandings[0].points,46);assert.equal(standings.selectedHistory.drivers[0].results[1].main.retired,true);
 const career=require('../services/driverStats').summarizeDriverEntries(entries.filter(e=>e.DriverId===1).map(e=>({...e,grandPrixResult:{discipline:'f1',raceType:'main',isHistorical:true}}))).f1;
 assert.equal(career.points,28);assert.equal(career.starts,2);assert.equal(career.wins,1);assert.equal(career.fastestLaps,1);assert.equal(career.poles,1);assert.equal(career.driverOfTheDays,1);
 assert.throws(()=>validateGrid({...grid,lineup:[{driverId:1,teamId:999}]},drivers,teams,races),/Aufstellung/);
 grid.rows[0].cells[1].status='DNS';assert.throws(()=>validateGrid(grid,drivers,teams,races),/keine (Punkte|Platzierung)/);
});
test('Saving rejects active seasons and stale revisions before deleting results',async t=>{
 const models=require('../models'),controller=require('../controllers/historicalGridController'),{revision}=require('../services/historicalGrid');
 const season={id:1,leagueType:'f1',scopeSlug:'sonntag',status:'active',updatedAt:'2026-01-01',historicalGrid:null,PointsSchemeId:1};
 t.mock.method(models.Season,'findByPk',async()=>season);
 let code,payload;const res={status(value){code=value;return this;},json(value){payload=value;return this;}};
 await controller.save({params:{seasonId:1},body:{}},res);assert.equal(code,400);
 season.status='historical';
 t.mock.method(models.Driver,'findAll',async()=>drivers.map(d=>({...d,toJSON:()=>d})));
 t.mock.method(models.SeasonDriver,'findAll',async()=>drivers.map(driver=>({driver:{...driver,toJSON:()=>driver}})));
 t.mock.method(models.SeasonTeam,'findAll',async()=>teams.map(team=>({...team,toJSON:()=>team})));
 t.mock.method(models.Team,'findOne',async()=>({name:'Team',id:100}));
 t.mock.method(models.GrandPrixResult,'findAll',async()=>races);
 t.mock.method(models.F1RaceLineupEntry,'findAll',async()=>[]);
 t.mock.method(models.sequelize,'transaction',async callback=>callback({LOCK:{UPDATE:'UPDATE'}}));
 let deleted=false;t.mock.method(models.GrandPrixResultEntry,'destroy',async()=>{deleted=true;});
 await controller.save({params:{seasonId:1},body:{grid:initialGrid(drivers,teams),revision:'stale'}},res);
 assert.equal(code,422);assert.match(payload.error,/zwischenzeitlich/);assert.equal(deleted,false);
 const saved=[];t.mock.method(models.GrandPrixResult,'update',async()=>{});t.mock.method(models.RaceEvent,'update',async()=>{});
 season.update=async values=>saved.push(values);
 await controller.save({params:{seasonId:1},body:{grid:initialGrid(drivers,teams),revision:revision(season)}},res);
 assert.equal(deleted,true);assert.equal(saved[0].historicalGrid.rows.length,4);assert.match(payload.url,/sonntag\?season=1/);
});

test('Repeated driver rows retain separate teams and aggregate once in driver WM and every GP snapshot',async()=>{
 const grid={lineup:[],rows:[
  {rowId:'first',driverId:1,role:'regular',teamId:10,cells:{1:{...cell(1),points:999,fastestLap:true,polePosition:true,driverOfTheDay:true},2:cell(null,10,'DNA')}},
  {rowId:'second',driverId:1,role:'regular',teamId:20,cells:{1:cell(null,20,'DNA'),2:cell(2,20),3:cell(1,20)}},
  {rowId:'reserve',driverId:2,role:'reserve',teamId:10,cells:{1:{points:12,teamId:10},2:cell(null,10,'DSQ')}}
 ]};
 const valid=validateGrid(grid,drivers,teams,races);
 assert.equal(valid.rows[0].cells[1].points,null);
 const entries=await projectGrid(valid,races,drivers,teams,points,{PointsSchemeId:1});
 const projected=races.map(race=>({...race,entries:entries.filter(e=>e.GrandPrixResultId===race.id)}));
 const data=standingsForGrid(buildSeasonData({slug:'sonntag'},projected,drivers,lineupsForGrid(valid,projected),{status:'historical'}),valid,projected,drivers,teams);
 assert.equal(data.selectedHistory.drivers.length,2);
 assert.deepEqual(data.selectedHistory.drivers.map(d=>d.total),[28,26]);
 assert.equal(data.driverStandings.length,1);assert.equal(data.driverStandings[0].points,54);
 assert.equal(data.reserveStandings[0].points,12);
 assert.equal(data.teamStandings.reduce((sum,row)=>sum+row.points,0),66);
 assert.equal(data.standingsHistory.find(r=>r.round===1).driverStandings[0].points,28);
 assert.equal(data.standingsHistory.find(r=>r.round===2).driverStandings[0].points,54);
 assert.equal(entries.filter(e=>e.DriverId===1).length,3);
 assert.equal(data.selectedHistory.drivers.find(d=>d.rowId==='second').results[0].main.points,0);
 const noReserves=standingsForGrid(buildSeasonData({slug:'sonntag'},projected,drivers,[],{}),valid,projected,drivers,teams,{reservePointsForConstructors:false});
 assert.equal(noReserves.teamStandings.reduce((sum,row)=>sum+row.points,0),54);
 valid.rows[1].cells[1]=cell(2,20);
 assert.throws(()=>validateGrid(valid,drivers,teams,races),/nur in einer Wertung/);
});

test('Upper lineup and race results allow at most two seats per team; row ids and awards are unique',()=>{
 const people=[...drivers,{id:3,name:'Gamma'}];
 const rows=people.map((d,index)=>({rowId:String(index),driverId:d.id,role:'regular',teamId:10,cells:{1:cell(index+1)}}));
 assert.throws(()=>validateGrid({rows:[],lineup:people.map(d=>({driverId:d.id,teamId:10}))},people,teams,races),/höchstens zwei/);
 assert.throws(()=>validateGrid({rows,lineup:[]},people,teams,races),/bereits zwei/);
 rows.pop();rows[1].rowId='0';assert.throws(()=>validateGrid({rows,lineup:[]},people,teams,races),/doppelt/);
 rows[1].rowId='1';rows.forEach(row=>row.cells[1].fastestLap=true);assert.throws(()=>validateGrid({rows,lineup:[]},people,teams,races),/Auszeichnung ist bereits/);
});

test('Empty season adds repeated driver rows and edits two-seat lineup and awards without preselected members',async t=>{
 const ejs=require('ejs'),fs=require('node:fs'),{JSDOM}=require('jsdom');
 const people=[...drivers,{id:3,name:'Unsafe </script><script>alert(1)</script>'}];
 const data={grid:{rows:[],lineup:[]},drivers:people,teams,races,revision:'test'};
 const selectedSeason={id:1,status:'historical'},selectedHistory={name:'S1',races:[{round:1,title:'R1'},{round:2,title:'R2',hasSprint:true}],drivers:[],reserveDrivers:[]};
 const html='<button data-historical-statistics-open="1">Auszeichnungen</button><button data-historical-open>Aufstellung</button>'+await ejs.renderFile('views/partials/historical-grid-editor.ejs',{historicalEditor:data,selectedSeason})+await ejs.renderFile('views/partials/season-history.ejs',{historicalEditor:data,selectedSeason,selectedHistory,history:{seasons:[{name:'S1'}]},isAdmin:true,league:{}});
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost'});t.after(()=>dom.window.close());
 const w=dom.window,doc=w.document;w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(fs.readFileSync('public/js/historical-periods.js','utf8'));w.eval(fs.readFileSync('public/js/historical-grid.js','utf8'));
 assert.equal(doc.querySelectorAll('script').length,3);
 const submit=form=>form.dispatchEvent(new w.Event('submit',{cancelable:true}));
 function add(role,driverId,teamId){doc.querySelector(`[data-historical-add-role="${role}"]`).click();const f=doc.querySelector('[data-historical-add-dialog] form');f.elements.driverId.value=driverId;f.elements.teamId.value=teamId;submit(f);}
 add('regular',1,10);add('regular',1,20);add('reserve',2,10);
 const rows=[...doc.querySelectorAll('[data-history-role="regular"]:not([hidden])')];assert.equal(rows.length,2);
 assert.notEqual(rows[0].dataset.historyRow,rows[1].dataset.historyRow);
 rows[0].querySelector('[data-round="1"] button').click();let form=doc.querySelector('[data-historical-dialog] form');form.elements.position.value='1';submit(form);
 rows[1].querySelector('[data-round="2"][data-race-type="main"] button').click();form.elements.position.value='2';submit(form);
 doc.querySelector('[data-historical-statistics-open]').click();form=doc.querySelector('[data-historical-stats-dialog] form');
 for(const key of ['fastestLap','polePosition','driverOfTheDay'])form.elements[key].value=rows[0].dataset.historyRow;
 w.fetch=async()=>({ok:false,json:async()=>({error:'Test'})});submit(form);await new Promise(resolve=>setImmediate(resolve));doc.querySelector('[data-historical-stats-cancel]').click();assert.match(rows[0].querySelector('[data-round="1"]').textContent,/P1FLPOLEDotD/);
 doc.querySelector('[data-historical-open]').click();form=doc.querySelector('[data-historical-lineup-dialog] form');const selects=form.querySelectorAll('select');assert.equal(selects.length,teams.length*2);
 selects[0].value='1';selects[1].value='1';submit(form);assert.match(doc.querySelector('[data-historical-lineup-error]').textContent,/nur einem Cockpit/);
 let posted,calls=0;w.fetch=async(url,options)=>{calls++;posted=JSON.parse(options.body);return {ok:false,json:async()=>({error:'Test'})};};
 selects[1].value='2';submit(form);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);assert.equal(doc.querySelector('[data-historical-lineup-dialog]').open,true);assert.match(doc.querySelector('[data-historical-lineup-error]').textContent,/Test.*bleiben erhalten/);assert.equal(form.querySelector('[type=submit]').disabled,false);
 assert.equal(posted.grid.rows.length,3);assert.equal(posted.grid.rows.find(row=>row.role==='reserve').teamId,null);assert.equal(doc.querySelector('[data-history-role="reserve"] .sheet-team'),null);assert.equal(doc.querySelector('[data-historical-add-search]'),null);assert.equal(doc.querySelector('[data-historical-add-team]').hidden,true);assert.equal(doc.querySelector('[data-historical-add-dialog] select[name=teamId]').required,false);assert.equal(posted.grid.lineup.length,2);assert.equal(posted.grid.rows[0].cells[1].points,null);
 assert.doesNotThrow(()=>validateGrid(posted.grid,people,teams,races));
});

test('Expanded news can be collapsed from the top with synchronized accessibility state',t=>{
 const {JSDOM}=require('jsdom'),fs=require('node:fs');
 const dom=new JSDOM('<article><div id="body">News</div><button data-news-toggle="body" hidden aria-expanded="false">Alles lesen</button></article>',{runScripts:'outside-only'});t.after(()=>dom.window.close());
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 dom.window.eval(fs.readFileSync('public/js/community.js','utf8'));
 const doc=dom.window.document,bottom=doc.querySelector('[data-news-toggle]'),top=doc.querySelector('[data-news-top]');
 assert.equal(top.hidden,true);bottom.click();assert.equal(top.hidden,false);assert.equal(top.getAttribute('aria-expanded'),'true');
 top.click();assert.equal(top.hidden,true);assert.equal(bottom.getAttribute('aria-expanded'),'false');assert.equal(doc.getElementById('body').classList.contains('is-collapsed'),true);
});

test('Column controls keep selection synchronized across responsive tables and delete only selected stint rows',async t=>{
 const ejs=require('ejs'),fs=require('node:fs'),{JSDOM}=require('jsdom');
 const rounds=Array.from({length:7},(_,i)=>({id:i+1,sortOrder:i+1,raceType:'main',entries:[]}));
 const data={grid:{lineup:[{driverId:1,teamId:10}],rows:[
   {rowId:'first',driverId:1,role:'regular',teamId:10,cells:{1:{position:1,teamId:10,fastestLap:true,polePosition:true,driverOfTheDay:true}}},
   {rowId:'second',driverId:1,role:'regular',teamId:20,cells:{}},
   {rowId:'reserve',driverId:2,role:'reserve',teamId:10,cells:{}}
 ]},drivers,teams,races:rounds,revision:'test'};
 const selectedSeason={id:1,status:'historical'},selectedHistory={name:'S1',races:rounds.map(r=>({round:r.sortOrder,title:'GP '+r.sortOrder})),drivers:[],reserveDrivers:[]};
 const stats='<section id="rennstatistik"><table><tr data-historical-statistics-round="1"><td data-historical-statistic="fastestLap"></td></tr></table><button data-historical-save-copy>Speichern</button><p data-historical-message-copy></p></section>';
 const html=stats+await ejs.renderFile('views/partials/historical-grid-editor.ejs',{historicalEditor:data,selectedSeason})+await ejs.renderFile('views/partials/season-history.ejs',{historicalEditor:data,selectedSeason,selectedHistory,history:{seasons:[{}]},isAdmin:true,league:{}});
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost'});t.after(()=>dom.window.close());const w=dom.window,doc=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;
 w.eval(fs.readFileSync('public/js/historical-periods.js','utf8'));w.eval(fs.readFileSync('public/js/historical-grid.js','utf8'));
 assert.equal(doc.querySelector('[data-historical-role]'),null);
 assert.equal(doc.querySelector('[data-historical-editor-body] [data-historical-add-role]'),null);
 assert.equal(doc.querySelectorAll('th.sheet-driver [data-historical-add-role]').length,6);
 assert.equal(doc.querySelector('[data-historical-dialog] [name=fastestLap]'),null);assert.ok(doc.querySelector('[data-historical-stats-dialog]'));
 assert.equal(doc.querySelector('[data-historical-stats-open]'),null);
 const first=doc.querySelector('[data-history-row="first"]'),actions=first.querySelector('.historical-driver-actions');
 assert.deepEqual([...actions.children].map(el=>el.tagName),['INPUT','BUTTON','BUTTON']);
 first.querySelector('[data-round="1"] button').click();const form=doc.querySelector('[data-historical-dialog] form');form.elements.position.value='2';form.dispatchEvent(new w.Event('submit',{cancelable:true}));
 assert.match(first.querySelector('[data-round="1"]').textContent,/P2FLPOLEDotD/);
 assert.equal(doc.querySelector('[data-historical-statistic="fastestLap"]').textContent,'Alpha');
 const selection=first.querySelector('[data-historical-select]');selection.click();
 assert.equal(doc.querySelectorAll('[data-historical-select="first"]:checked').length,3);
 assert.ok([...doc.querySelectorAll('[data-historical-select-all="regular"]')].every(el=>el.indeterminate));
 assert.ok([...doc.querySelectorAll('[data-historical-remove-selected="regular"]')].every(b=>b.textContent==='Auswahl entfernen (1)'));
 doc.querySelector('[data-historical-remove-selected="regular"]').click();
 assert.ok([...doc.querySelectorAll('[data-history-row="first"]')].every(row=>row.hidden));
 assert.ok([...doc.querySelectorAll('[data-history-row="second"]')].every(row=>!row.hidden));
 assert.equal(doc.querySelector('[data-history-row="reserve"]').hidden,false);
 assert.equal(doc.querySelector('[data-historical-statistic="fastestLap"]').textContent,'–');
 doc.querySelector('[data-historical-undo]').click();
 assert.equal(first.hidden,false);assert.equal(selection.checked,false);
 assert.equal(doc.querySelector('[data-historical-statistic="fastestLap"]').textContent,'Alpha');
 doc.querySelector('[data-historical-select-all="regular"]').click();doc.querySelector('[data-historical-remove-selected="regular"]').click();
 let posted;w.fetch=async(url,options)=>{posted=JSON.parse(options.body);return {ok:false,json:async()=>({error:'Retry'})};};doc.querySelector('[data-historical-save-copy]').click();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(posted.grid.rows.map(row=>row.rowId),['reserve']);assert.deepEqual(posted.grid.lineup,[{driverId:1,teamId:10}]);
 assert.match(doc.querySelector('[data-historical-message-copy]').textContent,/Retry.*bleiben erhalten/);
 doc.querySelector('[data-historical-undo]').click();first.querySelector('[data-round="1"] button').click();form.elements.status.value='DNA';form.elements.status.dispatchEvent(new w.Event('change'));form.dispatchEvent(new w.Event('submit',{cancelable:true}));
 assert.equal(first.querySelector('[data-round="1"]').textContent,'DNA');assert.equal(doc.querySelector('[data-historical-statistic="fastestLap"]').textContent,'–');assert.equal(doc.querySelector('[data-historical-position-field]').hidden,true);form.elements.status.value='DNS';form.elements.status.dispatchEvent(new w.Event('change'));assert.equal(doc.querySelector('[data-historical-position-field]').hidden,true);form.elements.status.value='';form.elements.status.dispatchEvent(new w.Event('change'));assert.equal(doc.querySelector('[data-historical-position-field]').hidden,false);
 const activeHtml=await ejs.renderFile('views/partials/season-history.ejs',{historicalEditor:data,selectedSeason:{id:1,status:'active'},selectedHistory,history:{seasons:[{}]},isAdmin:true,league:{}});
 assert.doesNotMatch(activeHtml,/data-historical-add-role|data-historical-select-all|data-historical-remove-selected/);
 const activeDom=new JSDOM(activeHtml);assert.equal(doc.querySelector('.race-result-legend').outerHTML,activeDom.window.document.querySelector('.race-result-legend').outerHTML);activeDom.window.close();
});

test('Historical WM starts at first non-DNA regular round and retains former regulars',async()=>{
 const people=[...drivers,{id:3,name:'LuYaxx'},{id:4,name:'Future'}];
 const sessions=[...races,{id:4,sortOrder:3,raceType:'main',entries:[]}];
 const grid=validateGrid({lineup:[],rows:[
  {driverId:1,role:'regular',teamId:10,cells:{1:cell(1),2:cell(null,10,'DNA'),4:cell(null,10,'DNA')}},
  {driverId:2,role:'regular',teamId:10,cells:{1:cell(null,10,'DNS'),2:cell(null,10,'S')}},
  {driverId:3,role:'regular',teamId:20,cells:{1:cell(null,20,'DNA'),2:cell(1,20),4:cell(null,20,'DNA')}},
  {driverId:4,role:'regular',teamId:20,cells:{1:cell(null,20,'DNA')}},
  {driverId:3,role:'reserve',teamId:null,cells:{1:cell(2,20)}}
 ]},people,teams,sessions);
 const entries=await projectGrid(grid,sessions,people,teams,points,{}),projected=sessions.map(r=>({...r,entries:entries.filter(e=>e.GrandPrixResultId===r.id)}));
 const result=standingsForGrid(buildSeasonData({slug:'sonntag'},projected,people,lineupsForGrid(grid,projected),{status:'historical'}),grid,projected,people,teams);
 assert.deepEqual(result.standingsHistory.find(r=>r.round===1).driverStandings.map(d=>d.id).sort(),[1,2]);
 assert.deepEqual(result.standingsHistory.find(r=>r.round===2).driverStandings.map(d=>d.id).sort(),[1,2,3]);
 assert.deepEqual(result.driverStandings.map(d=>d.id).sort(),[1,2,3]);
 assert.equal(result.reserveStandings.find(d=>d.id===3).points,18);
 const {isPublicGpEntry}=require('../services/historicalGrid');
 assert.deepEqual(['','DNF','DSQ','DNA','DNS','S',' dns '].filter(status=>isPublicGpEntry({status})),['','DNF','DSQ']);
});

test('Historical save persists the same points, wins and awards read by driver careers and team profiles',async t=>{
 const models=require('../models'),controller=require('../controllers/historicalGridController'),service=require('../services/historicalGrid');
 const people=[...drivers,{id:3,name:'Reserve'}];
 const season={id:1,leagueType:'f1',scopeSlug:'sonntag',status:'historical',updatedAt:'2026-01-01',historicalGrid:null,PointsSchemeId:1};
 const sessions=races.map(r=>({...r,discipline:'f1',SeasonId:1,isHistorical:true}));
 let persisted=[],savedGrid;
 t.mock.method(models.Season,'findByPk',async()=>season);
 t.mock.method(models.Driver,'findAll',async()=>people.map(d=>({...d,toJSON:()=>d})));
 t.mock.method(models.SeasonDriver,'findAll',async()=>[]);
 t.mock.method(models.SeasonTeam,'findAll',async()=>teams.map(team=>({...team,toJSON:()=>team})));
 t.mock.method(models.Team,'findOne',async()=>({name:'Team',id:100}));
 t.mock.method(models.GrandPrixResult,'findAll',async()=>sessions);
 t.mock.method(models.F1RaceLineupEntry,'findAll',async()=>[]);
 t.mock.method(models.PointsScheme,'findOne',async()=>({id:1,fastestLapEnabled:true,fastestLapPoints:1,polePositionEnabled:true,polePositionPoints:2}));
 t.mock.method(models.PointAllocation,'findOne',async({where})=>({points:(where.raceType==='sprint'?{1:8,2:7}:{1:25,2:18})[where.position]}));
 const transaction={LOCK:{UPDATE:'UPDATE'}};
 t.mock.method(models.sequelize,'transaction',async callback=>callback(transaction));
 t.mock.method(models.GrandPrixResultEntry,'destroy',async options=>{assert.equal(options.transaction,transaction);persisted=[];});
 t.mock.method(models.GrandPrixResultEntry,'bulkCreate',async(rows,options)=>{assert.equal(options.transaction,transaction);persisted=rows;});
 t.mock.method(models.GrandPrixResult,'update',async()=>{});t.mock.method(models.RaceEvent,'update',async()=>{});
 season.update=async(values,options)=>{assert.equal(options.transaction,transaction);savedGrid=values.historicalGrid;season.historicalGrid=savedGrid;};
 const grid={lineup:[{driverId:1,teamId:20},{driverId:2,teamId:10}],rows:[
  {driverId:1,role:'regular',teamId:20,startedFromRound:2,retiredFromRound:3,shadeRetired:false,cells:{1:cell(null,20,'DNA'),2:{...cell(1,20),fastestLap:true,polePosition:true,driverOfTheDay:true},3:cell(1,20)}},
  {driverId:2,role:'regular',teamId:10,cells:{1:cell(1),2:cell(null,10,'DNS')}},
  {driverId:3,role:'reserve',teamId:null,cells:{1:cell(2),2:cell(null,20,'DNF')}}
 ]};
 let payload,code=200;await controller.save({params:{seasonId:1},body:{grid,revision:service.revision(season)}},{status(c){code=c;return this;},json(v){payload=v;}});
 assert.equal(code,200,JSON.stringify(payload));const reloaded=(await controller.loadGridData(season)).grid;assert.deepEqual(reloaded.lineup,grid.lineup);assert.equal(reloaded.rows[0].startedFromRound,2);assert.equal(reloaded.rows[0].retiredFromRound,3);assert.equal(reloaded.rows[0].shadeRetired,false);assert.equal(persisted.find(e=>e.DriverId===1&&e.GrandPrixResultId===2).points,28);
 const withRace=persisted.map(entry=>({...entry,grandPrixResult:sessions.find(r=>r.id===entry.GrandPrixResultId)}));
 t.mock.method(models.GrandPrixResultEntry,'findAll',async({where})=>withRace.filter(e=>e.DriverId===where.DriverId));
 const career=await require('../services/driverStats').getDriverStatistics(1);
 assert.deepEqual(career.f1,{points:36,starts:1,wins:1,podium1:1,podium2:0,podium3:0,poles:1,fastestLaps:1,driverOfTheDays:1,winRate:100});
 const overall=require('../services/careerStatistics').buildCareerStatistics(people,withRace);assert.equal(overall.find(d=>d.id===1).seasons[0].points,36);assert.equal(overall.find(d=>d.id===1).seasons[0].driverOfTheDays,1);
 const projected=sessions.map(r=>({...r,entries:persisted.filter(e=>e.GrandPrixResultId===r.id)}));
 const totals=standingsForGrid(buildSeasonData({slug:'sonntag'},projected,people,lineupsForGrid(savedGrid,projected),season),savedGrid,projected,people,teams,season);
 assert.equal(totals.teamStandings.find(t=>t.name==='Team A').points,43);assert.equal(totals.teamStandings.find(t=>t.name==='Team B').points,36);
 t.mock.method(require('../controllers/f1Controller'),'loadLeagueData',async()=>({...totals,league:{},selectedSeason:season}));
 let profile;await require('../controllers/statisticsController').team({query:{league:'sonntag',season:'1',team:'Team B'}},{render(view,data){profile=data;}});
 assert.equal(profile.team.points,36);assert.equal(profile.rounds.find(r=>r.round===2).standing.points,36);
});

test('Reserve positions override old manual totals and project awards into points, careers and team WM',async()=>{
 const grid=validateGrid({lineup:[],rows:[{driverId:2,role:'reserve',teamId:null,cells:{
  1:{...cell(1,20),points:999,fastestLap:true,polePosition:true,driverOfTheDay:true},
  2:cell(null,10,'DNF'),3:{...cell(1,20),points:999}
 }}]},drivers,teams,races);
 assert.equal(grid.rows[0].cells[1].points,null);assert.equal(grid.rows[0].cells[3].points,null);
 const entries=await projectGrid(grid,races,drivers,teams,points,{PointsSchemeId:1});
 assert.deepEqual(entries.map(e=>e.points),[28,0,8]);
 const stats=require('../services/driverStats').summarizeDriverEntries(entries.map(e=>({...e,grandPrixResult:{...races.find(r=>r.id===e.GrandPrixResultId),discipline:'f1'}}))).f1;
 assert.equal(stats.points,36);assert.equal(stats.wins,1);assert.equal(stats.poles,1);assert.equal(stats.fastestLaps,1);assert.equal(stats.driverOfTheDays,1);
 const projected=races.map(r=>({...r,entries:entries.filter(e=>e.GrandPrixResultId===r.id)}));
 const totals=standingsForGrid(buildSeasonData({slug:'sonntag'},projected,drivers,lineupsForGrid(grid,projected),{}),grid,projected,drivers,teams);
 assert.equal(totals.reserveStandings[0].points,36);assert.equal(totals.driverStandings.length,0);assert.equal(totals.teamStandings[0].points,36);
});

test('Statistics assign awards to both roles; cells retain them and quick statuses clear them',async t=>{
 const ejs=require('ejs'),fs=require('node:fs'),{JSDOM}=require('jsdom');
 const data={grid:{lineup:[],rows:[{rowId:'regular',driverId:1,role:'regular',teamId:10,cells:{}},{rowId:'reserve',driverId:2,role:'reserve',teamId:null,cells:{}}]},drivers,teams,races,revision:'test'};
 const selectedSeason={id:1,status:'historical'},selectedHistory={name:'S1',races:[{round:1,title:'R1'},{round:2,title:'R2',hasSprint:true}],drivers:[],reserveDrivers:[]};
 const html='<button data-historical-statistics-open="1">Auszeichnungen</button><table><tr data-historical-statistics-round="1"><td data-historical-statistic="fastestLap"></td></tr></table>'+await ejs.renderFile('views/partials/historical-grid-editor.ejs',{historicalEditor:data,selectedSeason})+await ejs.renderFile('views/partials/season-history.ejs',{historicalEditor:data,selectedSeason,selectedHistory,history:{seasons:[{}]},isAdmin:true,league:{}});
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost'});t.after(()=>dom.window.close());const w=dom.window,doc=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(fs.readFileSync('public/js/historical-periods.js','utf8'));w.eval(fs.readFileSync('public/js/historical-grid.js','utf8'));
 const form=doc.querySelector('[data-historical-dialog] form'),submit=()=>form.dispatchEvent(new w.Event('submit',{cancelable:true}));
 const raceButton=(role,round=1,type='main')=>doc.querySelector(`[data-history-row="${role}"] [data-round="${round}"][data-race-type="${type}"] button`);
 assert.equal(form.elements.points,undefined);assert.equal(form.elements.fastestLap,undefined);
 const statsForm=doc.querySelector('[data-historical-stats-dialog] form');
 w.fetch=async()=>({ok:false,json:async()=>({error:'Retry'})});
 const saveStats=async()=>{statsForm.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(resolve=>setImmediate(resolve));assert.match(doc.querySelector('[data-historical-stats-error]').textContent,/Retry.*bleiben erhalten/);doc.querySelector('[data-historical-stats-cancel]').click();};
 for(const role of ['regular','reserve']){
  raceButton(role).click();form.elements.position.value='1';form.elements.teamId.value='10';
  submit();doc.querySelector('[data-historical-statistics-open]').click();
  for(const field of ['polePosition','fastestLap','driverOfTheDay'])statsForm.elements[field].value=role;
  await saveStats();assert.match(raceButton(role).textContent,/P1FLPOLEDotD/);
  assert.equal(doc.querySelector('[data-historical-statistic="fastestLap"]').textContent,role==='regular'?'Alpha':'Beta');
  for(const status of ['DNA','DNS','S']){
   const event=new w.MouseEvent('contextmenu',{bubbles:true,cancelable:true});raceButton(role).dispatchEvent(event);assert.equal(event.defaultPrevented,true);
   assert.equal(doc.querySelector('[data-historical-quick-dialog]').open,true);doc.querySelector(`[data-historical-quick-status="${status}"]`).click();
   assert.equal(raceButton(role).textContent,status);assert.equal(raceButton(role).classList.contains(`is-${status==='S'?'suspended':status.toLowerCase()}`),true);
   assert.equal(raceButton(role).classList.contains('historical-inline-button'),false);assert.equal(doc.querySelector('[data-historical-statistic="fastestLap"]').textContent,'–');
  }
  raceButton(role).dispatchEvent(new w.KeyboardEvent('keydown',{key:'F10',shiftKey:true,cancelable:true}));assert.equal(doc.querySelector('[data-historical-quick-dialog]').open,true);doc.querySelector('[data-historical-quick-cancel]').click();assert.equal(raceButton(role).textContent,'S');
  raceButton(role).click();assert.equal(doc.querySelector('[data-historical-position-field]').hidden,true);assert.equal(doc.querySelector('[data-historical-awards]'),null);
  form.elements.status.value='DNF';form.elements.status.dispatchEvent(new w.Event('change'));form.elements.teamId.value='10';submit();doc.querySelector('[data-historical-statistics-open]').click();statsForm.elements.driverOfTheDay.value=role;await saveStats();assert.match(raceButton(role).textContent,/DNFDotD/);
  raceButton(role).dispatchEvent(new w.MouseEvent('contextmenu',{cancelable:true}));doc.querySelector('[data-historical-quick-status="DNA"]').click();
  raceButton(role,2,'sprint').click();assert.equal(doc.querySelector('[data-historical-awards]'),null);assert.equal(form.elements.fastestLap,undefined);assert.deepEqual([...statsForm.elements.raceId.options].map(o=>o.value),['1','2']);doc.querySelector('[data-historical-cancel]').click();
 }
 let posted;w.fetch=async(url,options)=>{posted=JSON.parse(options.body);return {ok:false,json:async()=>({error:'Retry'})};};doc.querySelector('[data-historical-save]').click();await new Promise(resolve=>setImmediate(resolve));
 for(const row of posted.grid.rows){assert.equal(row.cells[1].points,null);assert.equal(row.cells[1].position,null);assert.equal(row.cells[1].fastestLap,false);assert.equal(row.cells[1].polePosition,false);assert.equal(row.cells[1].driverOfTheDay,false);}
 assert.doesNotThrow(()=>validateGrid(posted.grid,drivers,teams,races));
 // Actual shared stylesheet gives editable buttons and current-season tiles the same colors.
 const style=doc.createElement('style');style.textContent=fs.readFileSync('public/css/style.css','utf8');doc.head.append(style);
 for(const status of ['dna','dns','dnf','suspended']){
  const container=doc.createElement('div');container.className='season-sheet-table';container.innerHTML=`<div class="sheet-result"><div class="sheet-result-tile is-${status}"><b class="sheet-result-value">X</b></div><button class="sheet-result-tile historical-cell-button is-${status}"><b class="sheet-result-value">X</b></button></div>`;doc.body.append(container);
  const [current,historical]=container.querySelectorAll('.sheet-result-tile');assert.equal(w.getComputedStyle(historical).backgroundColor,w.getComputedStyle(current).backgroundColor,status);assert.equal(w.getComputedStyle(historical).color,w.getComputedStyle(current).color,status);assert.equal(w.getComputedStyle(historical.firstChild).color,w.getComputedStyle(current.firstChild).color,status);
 }
});

test('Historical periods replace every out-of-range session with DNA and reconcile role transfers',async()=>{
 const sessions=Array.from({length:6},(_,i)=>({id:i+1,sortOrder:Math.floor(i/2)+1,raceType:i%2?'sprint':'main',entries:[]}));
 const allCells=Object.fromEntries(sessions.map(r=>[r.id,{...cell(1),fastestLap:r.raceType==='main',driverOfTheDay:r.raceType==='main'}]));
 const grid=validateGrid({lineup:[],rows:[
  {rowId:'regular',driverId:1,role:'regular',teamId:10,startedFromRound:2,retiredFromRound:3,shadeRetired:false,cells:allCells},
  {rowId:'reserve',driverId:1,role:'reserve',teamId:null,startedFromRound:3,retiredFromRound:4,shadeRetired:false,cells:allCells}
 ]},drivers,teams,sessions);
 assert.equal(grid.rows[0].shadeRetired,false);assert.equal(grid.rows[1].shadeRetired,true);
 for(const [row,ids] of [[grid.rows[0],[1,2,5,6]],[grid.rows[1],[1,2,3,4]]])for(const id of ids){
  assert.equal(row.cells[id].status,'DNA');assert.equal(row.cells[id].position,null);assert.equal(row.cells[id].points,null);assert.equal(row.cells[id].fastestLap,false);assert.equal(row.cells[id].driverOfTheDay,false);
 }
 const entries=await projectGrid(grid,sessions,drivers,teams,points,{});assert.deepEqual(entries.map(e=>e.GrandPrixResultId),[3,4,5,6]);
 const projected=sessions.map(r=>({...r,entries:entries.filter(e=>e.GrandPrixResultId===r.id)}));
 const totals=standingsForGrid(buildSeasonData({slug:'sonntag'},projected,drivers,lineupsForGrid(grid,projected),{}),grid,projected,drivers,teams);
 assert.equal(totals.driverStandings[0].points,34);assert.equal(totals.reserveStandings[0].points,34);assert.equal(totals.teamStandings[0].points,68);
 assert.equal(totals.selectedHistory.drivers[0].results[2].main.retired,false);assert.equal(totals.selectedHistory.drivers[0].isFormerDriver,false);
 const stats=require('../services/driverStats').summarizeDriverEntries(entries.map(e=>({...e,grandPrixResult:{...sessions.find(r=>r.id===e.GrandPrixResultId),discipline:'f1'}}))).f1;
 assert.equal(stats.points,68);assert.equal(stats.wins,2);assert.equal(stats.fastestLaps,2);
 const periods=require('../public/js/historical-periods');assert.equal(periods.shaded(grid.rows[1],4),true);
 const widened=validateGrid({...grid,rows:[{...grid.rows[0],startedFromRound:1,retiredFromRound:null}]},drivers,teams,sessions);
 assert.deepEqual(Object.keys(widened.rows[0].cells),['3','4']);
 for(const fields of [{startedFromRound:3,retiredFromRound:3},{startedFromRound:4},{startedFromRound:-1},{retiredFromRound:5},{startedFromRound:'oops'}])assert.throws(()=>validateGrid({lineup:[],rows:[{...grid.rows[0],...fields}]},drivers,teams,sessions),/Einstieg|Runde/);
});

test('Period dialog uses inclusive reserve end, optional regular shading and reversible automatic DNA',async t=>{
 const ejs=require('ejs'),fs=require('node:fs'),{JSDOM}=require('jsdom');
 const sessions=Array.from({length:6},(_,i)=>({id:i+1,sortOrder:Math.floor(i/2)+1,raceType:i%2?'sprint':'main',entries:[]}));
 const data={grid:{lineup:[],rows:[{rowId:'regular',driverId:1,role:'regular',teamId:10,cells:{1:cell(1),5:cell(1)}},{rowId:'reserve',driverId:2,role:'reserve',teamId:null,cells:{}}]},drivers,teams,races:sessions,revision:'test'};
 const selectedSeason={id:1,status:'historical'},selectedHistory={name:'S1',races:[1,2,3].map(round=>({round,title:'R'+round,hasSprint:true})),drivers:[],reserveDrivers:[]};
 const html=await ejs.renderFile('views/partials/historical-grid-editor.ejs',{historicalEditor:data,selectedSeason})+await ejs.renderFile('views/partials/season-history.ejs',{historicalEditor:data,selectedSeason,selectedHistory,history:{seasons:[{}]},isAdmin:true,league:{}});
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost'});t.after(()=>dom.window.close());const w=dom.window,doc=w.document;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;
 w.eval(fs.readFileSync('public/js/historical-periods.js','utf8'));w.eval(fs.readFileSync('public/js/historical-grid.js','utf8'));
 const row=role=>doc.querySelector(`[data-history-row="${role}"]`),form=doc.querySelector('[data-historical-row-dialog] form');
 const edit=role=>row(role).querySelector('.historical-driver-actions button').click();const submit=()=>form.dispatchEvent(new w.Event('submit',{cancelable:true}));
 edit('regular');assert.equal(form.elements.shadeRetired.checked,true);form.elements.startedFromRound.value='2';form.elements.retiredFromRound.value='3';submit();
 assert.equal(row('regular').querySelector('[data-round="1"] button').textContent,'DNA');assert.equal(row('regular').querySelector('[data-round="3"][data-race-type="sprint"] button').textContent,'DNA');
 assert.equal(row('regular').querySelector('[data-round="1"]').classList.contains('is-historical-retired'),false);assert.equal(row('regular').querySelector('[data-round="3"]').classList.contains('is-historical-retired'),true);
 edit('regular');form.elements.shadeRetired.checked=false;submit();assert.equal(row('regular').querySelector('[data-round="3"]').classList.contains('is-historical-retired'),false);assert.equal(row('regular').classList.contains('is-former-driver'),false);
 row('regular').querySelector('[data-round="1"] button').click();assert.equal(doc.querySelector('[data-historical-row-dialog]').open,true);assert.match(doc.querySelector('[data-historical-row-error]').textContent,/außerhalb/);doc.querySelector('[data-historical-row-cancel]').click();
 edit('reserve');assert.equal(doc.querySelector('[data-historical-shade-field]').hidden,true);assert.equal(doc.querySelector('[data-historical-end-label]').textContent,'Ersatzfahrer bis einschließlich');
 form.elements.startedFromRound.value='2';form.elements.retiredFromRound.value='3';assert.equal(form.elements.retiredFromRound.selectedOptions[0].textContent,'Bis einschließlich R2');form.elements.shadeRetired.checked=false;submit();
 assert.equal(row('reserve').querySelector('[data-round="1"] button').textContent,'DNA');assert.equal(row('reserve').querySelector('[data-round="2"] button').textContent,'＋');assert.equal(row('reserve').querySelector('[data-round="3"] button').textContent,'DNA');assert.equal(row('reserve').querySelector('[data-round="3"]').classList.contains('is-historical-retired'),true);
 edit('reserve');form.elements.startedFromRound.value='3';submit();assert.match(doc.querySelector('[data-historical-row-error]').textContent,/Einstieg/);doc.querySelector('[data-historical-row-cancel]').click();
 let posted;w.fetch=async(url,options)=>{posted=JSON.parse(options.body);return {ok:false,json:async()=>({error:'Test'})};};doc.querySelector('[data-historical-save]').click();await new Promise(resolve=>setImmediate(resolve));
 const valid=validateGrid(posted.grid,drivers,teams,sessions);assert.equal(valid.rows[0].shadeRetired,false);assert.equal(valid.rows[1].shadeRetired,true);assert.equal(valid.rows[1].retiredFromRound,3);
 const projected=sessions.map(r=>({...r,entries:[]})),publicData=standingsForGrid(buildSeasonData({slug:'sonntag'},projected,drivers,[],{}),valid,projected,drivers,teams);
 const guestHtml=await ejs.renderFile('views/partials/season-history.ejs',{selectedSeason,selectedHistory:publicData.selectedHistory,history:{seasons:[{}]},isAdmin:false,league:{}});const guest=new JSDOM(guestHtml);t.after(()=>guest.window.close());
 assert.equal(guest.window.document.querySelector('[data-history-role="regular"] [data-round="3"]').classList.contains('is-historical-retired'),false);assert.equal(guest.window.document.querySelector('[data-history-role="reserve"] [data-round="3"]').classList.contains('is-historical-retired'),true);
 doc.querySelector('[data-historical-undo]').click();assert.equal(row('regular').querySelector('[data-round="1"][data-race-type="main"] button').textContent,'P1');assert.equal(row('reserve').querySelector('[data-round="3"] button').textContent,'＋');
});

test('Historical FL uses the real season scheme: 26 + 1 = 27, no duplicate bonus, transfers and removal recalculate',async t=>{
 const models=require('../models'),{pointsForPosition}=require('../services/championship');
 let scheme={id:9,fastestLapEnabled:true,fastestLapPoints:1,polePositionEnabled:false,polePositionPoints:2};
 t.mock.method(models.PointsScheme,'findOne',async({where})=>{assert.equal(where.id,9);return scheme;});
 t.mock.method(models.PointAllocation,'findOne',async({where})=>({points:where.position===1?26:18}));
 const grid={lineup:[],rows:[
  {driverId:1,role:'regular',teamId:10,cells:{1:{...cell(1),polePosition:true,driverOfTheDay:true}}},
  {driverId:2,role:'reserve',teamId:null,cells:{1:cell(2,20)}}
 ]};
 const calculate=()=>projectGrid(validateGrid(grid,drivers,teams,races),races,drivers,teams,pointsForPosition,{PointsSchemeId:9});
 assert.equal((await calculate())[0].points,26);
 grid.rows[0].cells[1].fastestLap=true;
 let entries=await calculate();assert.equal(entries[0].points,27);
 grid.rows[0].cells[1].points=27;assert.equal((await calculate())[0].points,27);
 const projected=races.map(r=>({...r,entries:entries.filter(e=>e.GrandPrixResultId===r.id)}));
 const valid=validateGrid(grid,drivers,teams,races),totals=standingsForGrid(buildSeasonData({slug:'sonntag'},projected,drivers,lineupsForGrid(valid,projected),{}),valid,projected,drivers,teams);
 assert.equal(totals.selectedHistory.drivers[0].results[0].main.points,27);assert.equal(totals.driverStandings[0].points,27);assert.equal(totals.teamStandings.find(t=>t.name==='Team A').points,27);
 const profile=require('../services/driverStats').summarizeDriverEntries(entries.filter(e=>e.DriverId===1).map(e=>({...e,grandPrixResult:{discipline:'f1',raceType:'main'}}))).f1;
 assert.equal(profile.points,27);assert.equal(profile.poles,1);assert.equal(profile.fastestLaps,1);assert.equal(profile.driverOfTheDays,1);
 grid.rows[0].cells[1].fastestLap=false;grid.rows[1].cells[1].fastestLap=true;
 entries=await calculate();assert.deepEqual(entries.map(e=>e.points),[26,19]);
 grid.rows[1].cells[1].fastestLap=false;assert.deepEqual((await calculate()).map(e=>e.points),[26,18]);
 grid.rows[0].cells[1].fastestLap=true;scheme={...scheme,fastestLapEnabled:false};assert.equal((await calculate())[0].points,26);
 scheme={...scheme,fastestLapEnabled:true,polePositionEnabled:true};assert.equal((await calculate())[0].points,29);
});
