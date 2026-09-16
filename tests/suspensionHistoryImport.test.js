const test=require('node:test'); const assert=require('node:assert/strict');
const {buildSeasonData}=require('../services/standings');
const {weekendProgress}=require('../services/weekendWorkflow');
const {HEADERS,validateImport,parseCsv,createHistoricalSeason}=require('../services/historicalSeasonImport');
const {createCsv}=require('../services/csv');
const masters={drivers:[{id:1,name:'A',viewF1:true},{id:2,name:'B',roleFormerF1:true}],teams:[{id:10,name:'Team'}],tracks:[{id:20,name:'Bahrain',country:'Bahrain'}]};
const row=(round,driver,role='stamm',status='',session='gp')=>[round,'2020-01-01',20,driver,10,role,session,status?'':driver, status?0:25,status,0,0,0];
const csv=rows=>createCsv([HEADERS,...rows]);
test('Suspended cockpit accepts one reserve, never the suspended regular or two reserves',()=>{
 const regular={DriverId:1,roleType:'regular',status:'rennsperre',includeInResults:false};
 const reserve={DriverId:2,ReplacementForDriverId:1,roleType:'reserve',status:'anwesend',attendanceStatus:'anwesend',includeInResults:true};
 assert.equal(weekendProgress([regular,reserve]).attendanceComplete,true);
 assert.equal(weekendProgress([{...regular,includeInResults:true}]).validSeats,false);
 assert.equal(weekendProgress([regular,reserve,{...reserve,DriverId:3}]).validSeats,false);
});
test('WM excludes future regulars, retains former regulars; suspension is S despite replacement',()=>{
 const team={id:10,name:'Team'},a={id:1,name:'A',team},b={id:2,name:'B',team};
 const races=[1,2,3].map(round=>({id:round,sortOrder:round,raceType:'main',entries:[{DriverId:1,driverName:'A',position:round===1?1:null,points:round===1?25:0,status:round===1?'':'DNS'}]}));
 const stints=[{DriverId:1,roleType:'regular',fromRound:1,toRound:2,driver:a,seasonTeam:team},{DriverId:2,roleType:'regular',fromRound:3,toRound:null,driver:b,seasonTeam:team}];
 const lineup=[{GrandPrixResultId:2,DriverId:1,roleType:'regular',status:'rennsperre'},{GrandPrixResultId:2,DriverId:2,roleType:'reserve',ReplacementForDriverId:1,includeInResults:true}];
 const data=buildSeasonData({slug:'sonntag'},races,[a,b],lineup,{},stints);
 assert.deepEqual(data.standingsHistory[0].driverStandings.map(row=>row.id),[1]);
 assert.deepEqual(data.standingsHistory[2].driverStandings.map(row=>row.id).sort(),[1,2]);
 assert.equal(data.history.seasons[0].drivers.find(driver=>driver.id===1).results[1].status,'S');
});
test('Historical CSV recognizes promotion and separate sprint result statuses',()=>{
 const plan=validateImport(csv([row(1,1),row(1,2,'ersatz','DNF'),row(1,1,'stamm','','sprint'),row(1,2,'ersatz','DNS','sprint'),row(2,2)]),masters);
 assert.equal(plan.driverCount,2);assert.equal(plan.rounds.length,2);
 assert.deepEqual(plan.stints.filter(stint=>stint.driverId===2).map(stint=>[stint.role,stint.fromRound,stint.toRound]),[['ersatz',1,1],['stamm',2,2]]);
});
test('CSV rejects invalid dates, unknown IDs, duplicate places, missing rounds and sprint awards',()=>{
 const invalid=row(1,1); invalid[1]='2020-02-31';assert.throws(()=>validateImport(csv([invalid]),masters),/Datum/);
 assert.throws(()=>validateImport(csv([row(1,99)]),masters),/Fahrer/);
 const duplicate=row(1,2);duplicate[7]=1;assert.throws(()=>validateImport(csv([row(1,1),duplicate]),masters),/Platzierung/);
 assert.throws(()=>validateImport(csv([row(2,1)]),masters),/Runde 1/);
 const sprint=row(1,1,'stamm','','sprint');sprint[10]=1;assert.throws(()=>validateImport(csv([row(1,1),sprint]),masters),/Hauptrennen/);
 assert.throws(()=>parseCsv('"unclosed'),/Anführungszeichen/);
 assert.throws(()=>validateImport(csv([row(1,1),row(1,1)]),masters),/doppelt/);
});
test('Import writes season-linked data, no current ranks, and refuses duplicate seasons',async()=>{
 const created={};let id=100;
 const names=['Season','SeasonTeam','SeasonDriver','SeasonLineupEntry','SeasonDriverStint','GrandPrixResult','GrandPrixResultEntry','F1RaceLineupEntry','RaceEvent'];
 const models=Object.fromEntries(names.map(name=>[name,{create:async data=>{const row={id:++id,...data};(created[name]||=[]).push(row);return row;}}]));
 models.League={findByPk:async()=>({id:5})};models.Season.findAll=async()=>[];
 const config={name:'Saison 1',league:{id:5,slug:'sonntag'},masters,plan:validateImport(csv([row(1,1),row(1,2,'ersatz','DNF'),row(2,2)]),masters),reservePointsForConstructors:true};
 const season=await createHistoricalSeason(config,models,{LOCK:{UPDATE:'UPDATE'}});
 assert.equal(season.status,'historical');assert.equal(created.SeasonDriverStint.length,3);
 assert.equal(created.RaceEvent.length,2);assert.equal(created.GrandPrixResultEntry.length,3);
 assert.ok(created.RaceEvent.every(event=>event.SeasonId===season.id&&event.isCompleted));
 const drivers=masters.drivers.map(driver=>({...driver,team:created.SeasonTeam[0]}));
 const races=created.GrandPrixResult.map(race=>({...race,entries:created.GrandPrixResultEntry.filter(entry=>entry.GrandPrixResultId===race.id)}));
 const stints=created.SeasonDriverStint.map(stint=>({...stint,driver:drivers.find(driver=>driver.id===stint.DriverId),seasonTeam:created.SeasonTeam[0]}));
 const result=buildSeasonData(config.league,races,drivers,created.F1RaceLineupEntry,season,stints);
 assert.deepEqual(result.standingsHistory[0].driverStandings.map(driver=>driver.id),[1]);
 assert.equal(result.teamStandings[0].points,50);
 assert.equal(result.selectedHistory.drivers.find(driver=>driver.id===2).results[0].status,'DNA');

 models.Season.findAll=async()=>[{name:'saison 1'}];
 await assert.rejects(createHistoricalSeason(config,models,{LOCK:{UPDATE:'UPDATE'}}),/bereits/);
});
test('Suspended cockpit renders an enabled replacement selector and S gets its own legend',async()=>{
 const ejs=require('ejs'),{JSDOM}=require('jsdom'),fs=require('node:fs');
 const statuses=require('../services/raceLineup');
 const html=await ejs.renderFile('views/admin/partials/f1-lineup-board.ejs',{selectedRace:{id:3},regularStatuses:statuses.REGULAR_STATUSES,reserveStatuses:statuses.RESERVE_STATUSES,reserveRows:[{driver:{id:2,name:'Reserve'},status:'anwesend',entry:{id:20},isAttendanceLocked:false}],teamCards:[{team:{id:10,name:'Team'},rows:[{driver:{id:1,name:'Gesperrt'},team:{id:10,name:'Team'},status:'rennsperre',isBanned:true}]}]});
 const dom=new JSDOM(html,{runScripts:'outside-only'});
 try {dom.window.eval(fs.readFileSync('public/js/f1-race-lineup.js','utf8'));dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
 const field=dom.window.document.querySelector('[data-replacement-field]'),select=field.querySelector('select');
 assert.equal(field.hidden,false);assert.equal(select.disabled,false);assert.ok([...select.options].some(option=>option.value==='2'));
 } finally {dom.window.close();}
 const data=buildSeasonData({slug:'sonntag'},[{id:1,sortOrder:1,raceType:'main',entries:[]}],[{id:1,name:'Gesperrt'}],[{GrandPrixResultId:1,DriverId:1,roleType:'regular',status:'rennsperre'}]);
 const history=await ejs.renderFile('views/partials/season-history.ejs',{league:{slug:'sonntag'},isAdmin:false,history:data.history,selectedHistory:data.selectedHistory});
 const doc=new JSDOM(history);try {assert.equal(doc.window.document.querySelector('.sheet-result-tile.is-suspended b').textContent,'S');assert.match(doc.window.document.querySelector('.race-result-legend').textContent,/Rennsperre/);}finally{doc.window.close();}
});
