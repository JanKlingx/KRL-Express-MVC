const test=require('node:test'),assert=require('node:assert/strict'),ejs=require('ejs'),path=require('path'),fs=require('fs'),{JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');const {renderRichContent}=require('../services/richContent');
test('Rich content escapes HTML and unsafe URLs but renders images, links and videos',()=>{
 const html=renderRichContent('## Saisonstart\n\n[Kalender](/f1/freitag)\n\n![Strecke](/images/guides/image1.jpeg)\n\nhttps://youtu.be/abcdefghijk\n\n<script>alert(1)</script> [Bad](javascript:alert) ![Bad](data:text/html,test)');
 const d=new JSDOM(html).window.document;assert.equal(d.querySelector('h2').textContent,'Saisonstart');assert.equal(d.querySelectorAll('img').length,1);assert.equal(d.querySelectorAll('a').length,1);assert.equal(d.querySelectorAll('script').length,0);assert.equal(d.querySelector('iframe').src,'https://www.youtube-nocookie.com/embed/abcdefghijk');
});
test('News expands the same content once and Discord is embedded directly',async()=>{
 const body='Diese Nachricht wird nicht doppelt angezeigt. '.repeat(12);
 const html=await ejs.renderFile(path.join(root,'views/partials/home-community.ejs'),{newsPosts:[{id:1,title:'News',body,isPublished:true}],communitySettings:{discordServerId:'123456789012345678'},communityEditing:false,renderRichContent});
 const dom=new JSDOM(html,{runScripts:'outside-only'});dom.window.eval(fs.readFileSync(path.join(root,'public/js/community.js'),'utf8'));const d=dom.window.document;assert.equal(d.querySelectorAll('[data-news-body]').length,1);const button=d.querySelector('[data-news-toggle]');assert.ok(d.querySelector('[data-news-body]').classList.contains('is-collapsed'));button.click();assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(d.querySelector('[data-news-body]').textContent,body);assert.ok(d.querySelector('iframe[src^="https://discord.com/widget"]'));assert.equal(d.querySelector('[data-load-frame*="discord"]'),null);dom.window.close();
});
test('Vacant starter appears in a normal attendance card with team logo',async()=>{
 const league={id:1,name:'Freitag',slug:'freitag'},season={id:2,name:'Saison'},race={id:3,title:'GP'};
 const entry={DriverId:8,TeamId:1,SeasonTeamId:10,vacantSeat:'10:1',roleType:'reserve',status:'anwesend',driver:{id:8,name:'Reserve'},attendanceStatus:null};
 const html=await ejs.renderFile(path.join(root,'views/admin/race-weekend.ejs'),{title:'Wochenende',isAdmin:true,adminRole:'admin',leagues:[league],league,seasons:[season],season,race,event:{id:1},events:[],entries:[entry],attendanceRows:[],availableReplacements:[],attendanceStatuses:[],teamCards:[{team:{id:1,seasonTeamId:10,name:'Ferrari',logoPath:'/ferrari.png'},rows:[]}],reserveRows:[],resultsHref:'/admin/current-season-progress',workflow:require('../services/weekendWorkflow').weekendProgress([entry])});
 const d=new JSDOM(html).window.document;const field=d.querySelector('[name="vacantAttendance[d8]"]');assert.ok(field.closest('.f1-attendance-seat'));assert.equal(field.closest('.f1-attendance-seat').querySelector('img').getAttribute('src'),'/ferrari.png');assert.equal(d.querySelector('.vacant-cockpit-grid'),null);
});
test('Brand upload is admin-only and join button sits outside centered menu',async()=>{
 const render=isAdmin=>ejs.renderFile(path.join(root,'views/partials/header.ejs'),{title:'Nav',isAdmin,adminRole:isAdmin?'admin':null,siteBranding:{logoPath:'/uploads/logo.png'},navigationItems:[]});
 const admin=new JSDOM(await render(true)).window.document;assert.equal(admin.querySelector('.brand').getAttribute('href'),'/');assert.ok(admin.querySelector('.brand-logo'));assert.ok(admin.querySelector('form[action="/admin/branding"]'));assert.equal(admin.querySelector('.nav-join').closest('nav'),null);
 const guest=new JSDOM(await render(false)).window.document;assert.equal(guest.querySelector('form[action="/admin/branding"]'),null);
});
test('Session tabs are visible only on sprint weekends',()=>{
 for(const hasSprint of [false,true]){
 const config={hasSprint,pointsMode:'database',main:[],sprint:[]};
 const dom=new JSDOM(`<form data-result-race-control><div data-result-control-mount></div><script data-result-control-points type="application/json">${JSON.stringify(config)}</script><div class="lineup-team-grid"><div data-result-driver="1" data-driver-name="A" data-team-name="Team"><input data-result-position="main" value="1"><input data-result-position="sprint" value="1"><select data-result-status><option value=""></option></select></div></div></form>`,{runScripts:'outside-only'});
 dom.window.eval(fs.readFileSync(path.join(root,'public/js/f1-result-control.js'),'utf8'));dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));assert.equal(dom.window.document.querySelector('.result-control-tabs').hidden,!hasSprint);dom.window.close();
 }
});
