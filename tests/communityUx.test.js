const test=require('node:test'),assert=require('node:assert/strict'),ejs=require('ejs'),path=require('path'),fs=require('fs'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
const render=(file,data)=>ejs.renderFile(path.join(root,'views',file),data);
test('News render as escaped content and editing is restricted to admins',async()=>{
 const data={newsPosts:[{id:1,title:'<script>alert(1)</script>',body:'A\nB',isPublished:true}],communitySettings:{},communityEditing:false};
 const html=await render('partials/home-community.ejs',data);const d=new JSDOM(html).window.document;
 assert.equal(d.querySelectorAll('script').length,0);assert.equal(d.querySelector('form'),null);assert.match(d.querySelector('.news-body').textContent,/A\nB/);
 const admin=await render('partials/home-community.ejs',{...data,communityEditing:true});assert.match(admin,/\/admin\/news\/1/);
});
test('Social settings only accept fixed Instagram post URLs and Discord IDs',()=>{
 const {settings}=require('../controllers/communityController');
 assert.equal(settings({instagramPost:'https://www.instagram.com/reel/Abc_123/'}).instagramPost,'https://www.instagram.com/reel/Abc_123/');
 assert.throws(()=>settings({instagramPost:'https://evil.test/p/abc'}));assert.throws(()=>settings({discordServerId:'123<script>'}));
});
test('F1 career data excludes LMU and exposes second and third podiums',()=>{
 const {buildCareerStatistics}=require('../services/careerStatistics');const race={discipline:'f1',raceType:'main',LeagueId:1,SeasonId:1};
 const rows=buildCareerStatistics([{id:1,name:'A'}],[{DriverId:1,position:2,points:18,grandPrixResult:race},{DriverId:1,position:3,points:15,grandPrixResult:race},{DriverId:1,position:1,points:100,grandPrixResult:{...race,discipline:'lmu'}}]);
 assert.equal(rows[0].seasons.length,1);assert.equal(rows[0].seasons[0].points,33);assert.equal(rows[0].seasons[0].podium2,1);assert.equal(rows[0].seasons[0].podium3,1);
});
test('Vacant cockpits sit inside their team and offer only registered available reserves',async()=>{
 const team={id:1,seasonTeamId:1,name:'Ferrari',logoPath:''};
 const html=await render('admin/partials/f1-lineup-board.ejs',{selectedRace:{id:1},regularStatuses:[],reserveStatuses:require('../services/raceLineup').RESERVE_STATUSES,teamCards:[{team,rows:[],vacantSlots:[{key:'1:1',slot:1,team}]}],reserveRows:[{driver:{id:1,name:'Registered'},entry:{},status:'anwesend'},{driver:{id:2,name:'Not registered'},entry:null,status:'anwesend'},{driver:{id:3,name:'Absent'},entry:{},status:'abgemeldet'}]});
 const dom=new JSDOM(html,{runScripts:'outside-only'});dom.window.eval(fs.readFileSync(path.join(root,'public/js/f1-race-lineup.js'),'utf8'));dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
 const select=dom.window.document.querySelector('[data-vacant-select]');assert.ok(select.closest('.f1-lineup-team'));assert.deepEqual([...select.options].map(o=>o.value),['','1']);dom.window.close();
});
test('Whisper guide is native HTML and includes all source screenshots',async()=>{
 const html=await render('guides.ejs',{title:'Anleitungen'});const d=new JSDOM(html).window.document;assert.equal(d.querySelectorAll('.guide-step img').length,6);assert.equal(d.querySelector('iframe'),null);assert.match(d.body.textContent,/gedrückt/);assert.match(d.body.textContent,/Rennleitung/);
});
