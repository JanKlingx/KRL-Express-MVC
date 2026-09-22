process.env.DB_HOST ||= 'localhost';process.env.DB_NAME ||= 'krl';process.env.DB_USER ||= 'krl';process.env.DB_PASSWORD ||= 'krl';
const test=require('node:test'),assert=require('node:assert/strict');
const {initialGrid,validateGrid,projectGrid,standingsForGrid,lineupsForGrid}=require('../services/historicalGrid');
const {buildSeasonData}=require('../services/standings');const {wizardState}=require('../services/seasonWizard');
const drivers=[{id:1,name:'Alpha'},{id:2,name:'Beta'}],teams=[{id:10,name:'Team A',sourceType:'current',sourceId:100,baseTeamId:100},{id:20,name:'Team B',sourceType:'current',sourceId:200,baseTeamId:200}];
const races=[{id:1,sortOrder:1,raceType:'main',entries:[]},{id:2,sortOrder:2,raceType:'main',entries:[]},{id:3,sortOrder:2,raceType:'sprint',entries:[]}];
const cell=(position,teamId=10,status='')=>({position,teamId,status});
const points=async(position,context)=>(context.raceType==='sprint'?{1:8,2:7}:{1:25,2:18})[position]+(context.fastestLap?1:0)+(context.polePosition?2:0);
test('Historical wizard requires participants and teams but no lineup; current seasons still require seats',()=>{
 const input={selectedLeague:{id:1},selectedSeason:{id:1,status:'historical',PointsSchemeId:1},calendar:[{startsAt:new Date()}],structure:{allDrivers:drivers,teams,lineup:[]}};
 assert.equal(wizardState(input).current,8);assert.equal(wizardState(input,7).current,8);
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
 grid.rows[0].cells={3:{...cell(1),fastestLap:true}};assert.throws(()=>validateGrid(grid,drivers,teams,races),/GP-Platzierung/);
});
test('Deleting one row leaves the opposite role intact; manual legacy points need explicit reconstruction',async()=>{
 const grid=initialGrid(drivers,teams);grid.rows[0].cells[1]=cell(1);grid.rows[1].cells[2]=cell(2);
 grid.rows.splice(0,1);const entries=await projectGrid(validateGrid(grid,drivers,teams,races),races,drivers,teams,points,{});
 assert.equal(entries.length,1);assert.equal(entries[0].role,'reserve');assert.equal(entries[0].points,18);
 const old=initialGrid(drivers,teams,[{...races[0],entries:[{DriverId:1,teamName:'Team A',points:20}]}]);assert.throws(()=>validateGrid(old,drivers,teams,races),/Platzierung/);
});
test('Inline editor edits one cell and removes only the selected valuation row',async t=>{
 const ejs=require('ejs'),fs=require('node:fs'),{JSDOM}=require('jsdom');
 const data={grid:initialGrid(drivers,teams,races),drivers,teams,races,revision:'test'};
 const html=await ejs.renderFile('views/partials/historical-grid-editor.ejs',{historicalEditor:data,selectedSeason:{id:1}});
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost/f1/sonntag?season=1'});t.after(()=>dom.window.close());
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 dom.window.eval(fs.readFileSync('public/js/historical-grid.js','utf8'));const doc=dom.window.document;
 assert.equal(doc.querySelectorAll('[data-historical-rows] tr').length,2);
 doc.querySelector('.historical-result-button').click();const form=doc.querySelector('dialog form');form.elements.position.value='1';form.elements.teamId.value='10';form.elements.fastestLap.checked=true;form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 assert.match(doc.querySelector('.historical-result-button').textContent,/P1 FL/);
 const role=doc.querySelector('[data-historical-role]');role.value='reserve';role.dispatchEvent(new dom.window.Event('change'));
 assert.equal(doc.querySelector('.historical-result-button').textContent,'+ Ergebnis');
 doc.querySelector('[data-historical-rows] tr td:last-child button').click();assert.equal(doc.querySelectorAll('[data-historical-rows] tr').length,1);
 role.value='regular';role.dispatchEvent(new dom.window.Event('change'));assert.equal(doc.querySelectorAll('[data-historical-rows] tr').length,2);assert.match(doc.querySelector('.historical-result-button').textContent,/P1 FL/);
});
test('Saving rejects active seasons and stale revisions before deleting results',async t=>{
 const models=require('../models'),controller=require('../controllers/historicalGridController'),{revision}=require('../services/historicalGrid');
 const season={id:1,leagueType:'f1',scopeSlug:'sonntag',status:'active',updatedAt:'2026-01-01',historicalGrid:null,PointsSchemeId:1};
 t.mock.method(models.Season,'findByPk',async()=>season);
 let code,payload;const res={status(value){code=value;return this;},json(value){payload=value;return this;}};
 await controller.save({params:{seasonId:1},body:{}},res);assert.equal(code,400);
 season.status='historical';
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
