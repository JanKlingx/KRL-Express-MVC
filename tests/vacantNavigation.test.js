const test=require('node:test');const assert=require('node:assert/strict');
const {vacantSlots,applyVacantPlan,saveVacantAttendance}=require('../services/vacantSeats');
const {weekendProgress}=require('../services/weekendWorkflow');
test('Empty and half-filled teams expose real vacant cockpits',()=>{
 const slots=vacantSlots([{team:{seasonTeamId:10,id:1},rows:[]},{team:{seasonTeamId:11,id:2},rows:[{}]},{team:{seasonTeamId:12,id:3},rows:[{},{}]}]);
 assert.deepEqual(slots.map(s=>s.key),['10:1','10:2','11:2']);
 const records=[{DriverId:7,roleType:'reserve',status:'anwesend'}];applyVacantPlan(records,{'10:1':'7'},slots);assert.equal(records[0].TeamId,1);assert.equal(records[0].SeasonTeamId,10);
 assert.throws(()=>applyVacantPlan(records,{'10:1':'7','10:2':'7'},slots));
 assert.throws(()=>applyVacantPlan(records,{'12:1':'7'},slots));
});
test('Vacant reserve survives attendance and is an independent valid starter',async()=>{
 const entry={DriverId:7,roleType:'reserve',status:'anwesend',vacantSeat:'10:1',SeasonTeamId:10,TeamId:1,async update(values){Object.assign(this,values);}};
 await saveVacantAttendance([entry],{d7:'anwesend'});assert.equal(weekendProgress([entry]).attendanceComplete,true);
 await saveVacantAttendance([entry],{d7:'abgemeldet'});assert.equal(entry.includeInResults,false);assert.equal(weekendProgress([entry]).attendanceComplete,true);
 entry.includeInResults=true;entry.ReplacementForDriverId=5;assert.equal(weekendProgress([entry]).validSeats,false);
});
test('Navigation permits arbitrary groups and rejects unsafe or duplicate destinations',()=>{
 const {catalog,validate}=require('../services/navigation');const pages=catalog([{slug:'montag',name:'Montagsliga'}]);
 assert.deepEqual(validate([{label:'Community',children:[{label:'Montag',url:'/ligen/montag'}]}],pages)[0].label,'Community');
 assert.throws(()=>validate([{label:'Bad',url:'javascript:alert(1)'}],pages));
 assert.throws(()=>validate([{label:'A',url:'/'},{label:'B',url:'/'}],pages));
});
test('Navigation editor assigns pages to groups and persists visible ordering',async()=>{
 const ejs=require('ejs'),path=require('path'),fs=require('fs'),{JSDOM}=require('jsdom');
 const html=await ejs.renderFile(path.join(__dirname,'../views/partials/header.ejs'),{title:'Navigation',isAdmin:true,adminRole:'admin',navigationItems:[{label:'A',url:'/'},{label:'Gruppe',children:[]}],navigationPages:[{label:'Start',url:'/'},{label:'Statistik',url:'/krl-statistik'}],navigationVersion:''});
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://krl.test/'});const d=dom.window.document;
 dom.window.eval(fs.readFileSync(path.join(__dirname,'../public/js/navigation-editor.js'),'utf8'));
 const picker=d.querySelector('.navigation-editor-card select');picker.value='1';picker.dispatchEvent(new dom.window.Event('change'));
 assert.equal(d.querySelector('.navigation-editor-children input').value,'A');
 d.querySelector('[data-navigation-add]').click();assert.equal(d.querySelectorAll('[data-navigation-list] > .navigation-editor-card').length,2);
 dom.window.close();
});
