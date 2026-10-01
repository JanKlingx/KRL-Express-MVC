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
 dom.window.eval(fs.readFileSync('public/js/historical-grid.js','utf8'));const doc=dom.window.document;
 const regular=doc.querySelector('[data-history-driver="1"][data-history-role="regular"]');
 regular.querySelector('.historical-cell-button').click();const form=doc.querySelector('[data-historical-dialog] form');form.elements.points.value='26';form.elements.position.value='1';form.elements.teamId.value='10';form.elements.fastestLap.checked=true;form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 assert.match(regular.querySelector('.historical-cell-button').textContent,/P1F/);assert.equal(form.elements.points.disabled,true);
 const reserve=doc.querySelector('[data-history-driver="1"][data-history-role="reserve"]');
 [...reserve.querySelectorAll('.sheet-driver button')].find(b=>b.textContent==='−').click();assert.equal(reserve.hidden,true);assert.equal(regular.hidden,false);
 const role=doc.querySelector('[data-historical-role]');role.value='reserve';role.dispatchEvent(new dom.window.Event('change'));doc.querySelector('[data-historical-add]').value='1';doc.querySelector('[data-historical-add-button]').click();assert.equal(doc.querySelectorAll('[data-history-driver="1"][data-history-role="reserve"]:not([hidden])').length,1);
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
 const html='<button data-historical-open>Aufstellung</button>'+await ejs.renderFile('views/partials/historical-grid-editor.ejs',{historicalEditor:data,selectedSeason})+await ejs.renderFile('views/partials/season-history.ejs',{historicalEditor:data,selectedSeason,selectedHistory,history:{seasons:[{name:'S1'}]},isAdmin:true,league:{}});
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost'});t.after(()=>dom.window.close());
 const w=dom.window,doc=w.document;w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.eval(fs.readFileSync('public/js/historical-grid.js','utf8'));
 assert.equal(doc.querySelectorAll('script').length,2);
 const submit=form=>form.dispatchEvent(new w.Event('submit',{cancelable:true}));
 function add(role,driverId,teamId){doc.querySelector('[data-historical-role]').value=role;doc.querySelector('[data-historical-add]').value=driverId;doc.querySelector('[data-historical-add-button]').click();const f=doc.querySelector('[data-historical-row-dialog] form');f.elements.teamId.value=teamId;submit(f);}
 add('regular',1,10);add('regular',1,20);add('reserve',2,10);
 const rows=[...doc.querySelectorAll('[data-history-role="regular"]:not([hidden])')];assert.equal(rows.length,2);
 assert.notEqual(rows[0].dataset.historyRow,rows[1].dataset.historyRow);
 rows[0].querySelector('[data-round="1"] button').click();let form=doc.querySelector('[data-historical-dialog] form');form.elements.position.value='1';submit(form);
 rows[1].querySelector('[data-round="2"][data-race-type="main"] button').click();form.elements.position.value='2';submit(form);
 doc.querySelector('[data-historical-stats-open]').click();form=doc.querySelector('[data-historical-stats-dialog] form');
 for(const key of ['fastestLap','polePosition','driverOfTheDay'])form.elements[key].value=rows[0].dataset.historyRow;
 submit(form);assert.match(rows[0].querySelector('[data-round="1"]').textContent,/P1FPLD/);
 doc.querySelector('[data-historical-open]').click();form=doc.querySelector('[data-historical-lineup-dialog] form');const selects=form.querySelectorAll('select');assert.equal(selects.length,teams.length*2);
 selects[0].value='1';selects[1].value='1';submit(form);assert.match(doc.querySelector('[data-historical-lineup-error]').textContent,/nur einem Cockpit/);
 selects[1].value='2';submit(form);
 let posted;w.fetch=async(url,options)=>{posted=JSON.parse(options.body);return {ok:false,json:async()=>({error:'Test'})};};doc.querySelector('[data-historical-save]').click();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(posted.grid.rows.length,3);assert.equal(posted.grid.lineup.length,2);assert.equal(posted.grid.rows[0].cells[1].points,null);
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
