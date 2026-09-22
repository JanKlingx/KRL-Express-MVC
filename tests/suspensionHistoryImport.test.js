const test=require('node:test'); const assert=require('node:assert/strict');
const {buildSeasonData}=require('../services/standings');
const {weekendProgress}=require('../services/weekendWorkflow');
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
