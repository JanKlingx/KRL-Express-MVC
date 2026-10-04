const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const ejs=require('ejs'),{JSDOM}=require('jsdom');
process.env.DB_HOST||='localhost';process.env.DB_NAME||='krl';process.env.DB_USER||='krl';process.env.DB_PASSWORD||='krl';
const models=require('../models'),service=require('../services/historicalTeams'),gridService=require('../services/historicalGrid');
const catalog=[{id:100,name:'Rot',logoPath:'/red.png'},{id:200,name:'Blau',logoPath:'/blue.png'},{id:300,name:'Grün',logoPath:'/green.png'}];
const teams=[{id:10,sourceType:'current',sourceId:100,baseTeamId:100,name:'Rot',logoPath:'/season-red.png'},{id:20,sourceType:'current',sourceId:200,baseTeamId:200,name:'Blau',logoPath:'/blue.png'}];
const drivers=[{id:1,name:'Alpha'},{id:2,name:'Beta'}];
const race={id:1,sortOrder:1,raceType:'main',title:'GP',entries:[]};
const cell={position:1,teamId:10,points:null,status:'',fastestLap:true,polePosition:true,driverOfTheDay:true};
const initial=()=>({lineup:[{driverId:1,teamId:10}],rows:[{rowId:'a',driverId:1,role:'regular',teamId:10,cells:{1:{...cell}}}]});
const transaction={LOCK:{UPDATE:'UPDATE'}};
function db(t){
 const records=structuredClone(teams),writes=[];
 t.mock.method(models.Team,'findAll',async()=>catalog);
 t.mock.method(models.SeasonTeam,'update',async(values,options)=>{
   assert.equal(options.transaction,transaction);writes.push({values,where:options.where});
   const row=records.find(r=>r.id===options.where.id);const next={...row,...values};
   assert.ok(!records.some(r=>r.id!==row.id&&r.sourceType===next.sourceType&&r.sourceId===next.sourceId),'unique source constraint');Object.assign(row,values);
 });
 t.mock.method(models.SeasonTeam,'destroy',async options=>{assert.equal(options.transaction,transaction);records.splice(records.findIndex(row=>row.id===options.where.id),1);});
 t.mock.method(models.SeasonTeam,'create',async(values,options)=>{assert.equal(options.transaction,transaction);const row={...values,id:30};records.push(row);return row;});
 t.mock.method(models.F1RaceLineupEntry,'update',async(values,options)=>{assert.equal(options.transaction,transaction);});
 for(const model of [models.SeasonLineupEntry,models.SeasonDriverStint,models.F1RaceLineupEntry])t.mock.method(model,'count',async()=>0);
 return {records,writes};
}
const season={id:1,status:'historical',leagueType:'f1',scopeSlug:'sonntag',PointsSchemeId:1,updatedAt:'2026-01-01'};

test('Historischer Teamtausch erhält Saison-IDs, Ergebnisse und unveränderte Saisonlogos',async t=>{
 const {records}=db(t),grid=initial(),before=JSON.stringify(grid);
 const result=await service.reconcile(season,[{id:10,sourceId:300},{id:20,sourceId:200}],grid,teams,transaction);
 assert.equal(records.find(t=>t.id===10).name,'Grün');assert.equal(records.find(t=>t.id===20).logoPath,'/blue.png');
 assert.equal(result.teams.find(t=>t.id===10).baseTeamId,300);assert.equal(result.teams.find(t=>t.id===10).logoPath,'/green.png');
 assert.equal(JSON.stringify(grid),before);assert.deepEqual(result.grid,grid);
 const valid=gridService.validateGrid(result.grid,drivers,result.teams,[race]);
 const projected=await gridService.projectGrid(valid,[race],drivers,result.teams,async()=>28,season);
 assert.equal(projected[0].TeamId,300);assert.equal(projected[0].teamName,'Grün');assert.equal(projected[0].points,28);assert.equal(projected[0].DriverId,1);
 for(const flag of ['fastestLap','polePosition','driverOfTheDay'])assert.equal(projected[0][flag],true);
});

test('Zwei vorhandene Teams lassen sich trotz eindeutiger Quellzuordnung vertauschen',async t=>{
 const {records}=db(t);
 await service.reconcile(season,[{id:10,sourceId:200},{id:20,sourceId:100}],initial(),teams,transaction);
 assert.equal(records.find(t=>t.id===10).sourceId,200);assert.equal(records.find(t=>t.id===20).sourceId,100);
});

test('Neue Teams erhalten echte IDs, die in Cockpits, Wertungszeilen und Rennzellen übernommen werden',async t=>{
 db(t);const grid=initial();grid.lineup.push({driverId:2,teamId:-1});grid.rows.push({rowId:'b',driverId:2,role:'regular',teamId:-1,cells:{1:{teamId:-1,status:'DNS'}}});
 const result=await service.reconcile(season,[{id:10,sourceId:100},{id:20,sourceId:200},{id:-1,sourceId:300}],grid,teams,transaction);
 assert.equal(result.grid.lineup[1].teamId,30);assert.equal(result.grid.rows[1].teamId,30);assert.equal(result.grid.rows[1].cells[1].teamId,30);
 assert.equal(result.teams.find(t=>t.id===10).logoPath,'/season-red.png');
});

test('Aktive Saisons, fremde/mehrfache Teams und Löschen verwendeter Teams werden zurückgewiesen',async t=>{
 const {writes}=db(t);
 await assert.rejects(service.reconcile({...season,status:'active'},[{id:10,sourceId:300}],initial(),teams,transaction),/historische/);
 for(const choices of [[{id:999,sourceId:100}],[{id:10,sourceId:100},{id:20,sourceId:100}],[{id:10,sourceId:999}],[{id:20,sourceId:200}]])await assert.rejects(service.reconcile(season,choices,initial(),teams,transaction));
 assert.equal(writes.length,0);
});

test('Auch alte Cockpit-/Stint-Verweise schützen leere Saisonteams vor dem Löschen',async t=>{
 db(t);t.mock.method(models.SeasonDriverStint,'count',async()=>1);
 await assert.rejects(service.reconcile(season,[{id:10,sourceId:100}],initial(),teams,transaction),/noch verwendet/);
});

test('Gemeinsames Speichern projiziert Teamkorrektur und Auszeichnungen innerhalb der Saisontransaktion',async t=>{
 const {records}=db(t);const stored={...season,historicalGrid:initial()};let entries,written;
 t.mock.method(models.sequelize,'transaction',async callback=>callback(transaction));
 t.mock.method(models.Season,'findByPk',async()=>stored);
 let invalidated=false;stored.changed=(field,changed)=>{assert.equal(field,'historicalGrid');invalidated=changed;};
 stored.update=async(values,options)=>{assert.equal(options.transaction,transaction);written=values.historicalGrid;};
 t.mock.method(models.SeasonDriver,'findAll',async()=>[]);
 t.mock.method(models.SeasonTeam,'findAll',async()=>records.map(row=>({...row,toJSON:()=>({...row})})));
 t.mock.method(models.Team,'findOne',async({where})=>catalog.find(t=>t.id===where.id));
 t.mock.method(models.Driver,'findAll',async()=>drivers.map(row=>({...row,toJSON:()=>({...row})})));
 t.mock.method(models.GrandPrixResult,'findAll',async()=>[race]);
 t.mock.method(require('../services/championship'),'pointsForPosition',async()=>28);
 t.mock.method(models.GrandPrixResultEntry,'destroy',async options=>{assert.equal(options.transaction,transaction);});
 t.mock.method(models.GrandPrixResultEntry,'bulkCreate',async(values,options)=>{assert.equal(options.transaction,transaction);entries=values;});
 t.mock.method(models.GrandPrixResult,'update',async()=>{});t.mock.method(models.RaceEvent,'update',async()=>{});
 const req={params:{seasonId:1},body:{grid:initial(),teams:[{id:10,sourceId:300},{id:20,sourceId:200}],revision:gridService.revision(stored)}};
 let code=200,response;
 await require('../controllers/historicalGridController').save(req,{status(v){code=v;return this;},json(value){response=value;}});
 assert.equal(code,200,JSON.stringify(response));assert.equal(invalidated,true);assert.equal(entries[0].TeamId,300);assert.equal(entries[0].points,28);assert.equal(written.rows[0].cells[1].teamId,10);
 req.body.revision='old';written=null;await require('../controllers/historicalGridController').save(req,{status(v){code=v;return this;},json(value){response=value;}});
 assert.equal(code,422);assert.equal(written,null);assert.match(response.error,/zwischenzeitlich/);
});

async function editor(t,grid=initial()){
 const data={grid,drivers,teams,teamCatalog:catalog,races:[race],revision:'test'};
 const selectedSeason={id:1,status:'historical'},selectedHistory={name:'S1',races:[{round:1,title:'GP'}],drivers:[],reserveDrivers:[]};
 const html='<button data-historical-open>Bearbeiten</button>'+await ejs.renderFile('views/partials/historical-grid-editor.ejs',{historicalEditor:data,selectedSeason})+await ejs.renderFile('views/partials/season-history.ejs',{historicalEditor:data,selectedSeason,selectedHistory,history:{seasons:[{}]},isAdmin:true,league:{}});
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost'});t.after(()=>dom.window.close());const w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;
 let posted,calls=0;w.fetch=async(url,options)=>{calls++;posted=JSON.parse(options.body);return {ok:false,json:async()=>({error:'Testantwort'})};};
 w.eval(fs.readFileSync('public/js/historical-periods.js','utf8'));w.eval(fs.readFileSync('public/js/historical-grid.js','utf8'));
 return {w,d:w.document,payload:()=>posted,calls:()=>calls};
}
test('Teamkarten zeigen zwei Cockpits, speichern Teamwechsel und behalten Eingaben bei Fehlern',async t=>{
 const {w,d,payload}=await editor(t);d.querySelector('[data-historical-open]').click();
 assert.equal(d.querySelectorAll('.historical-lineup-card').length,2);assert.equal(d.querySelectorAll('[data-historical-seat]').length,4);
 const select=d.querySelector('[data-historical-team-choice="10"]');select.value='300';select.dispatchEvent(new w.Event('change'));
 assert.match(d.querySelector('.historical-lineup-card legend').textContent,/Grün/);
 const form=d.querySelector('[data-historical-lineup-dialog] form');form.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(payload().teams[0].sourceId,300);assert.equal(payload().grid.rows[0].cells[1].position,1);assert.equal(payload().grid.rows[0].cells[1].fastestLap,true);
 assert.equal(d.querySelector('[data-historical-lineup-dialog]').open,true);assert.match(d.querySelector('[data-historical-lineup-error]').textContent,/Eingaben bleiben/);
});

test('Neue Aufstellung lässt sich gemeinsam mit DNS-Wertungszeilen anlegen und aus dem Verlauf übernehmen',async t=>{
 const {w,d,payload}=await editor(t,{rows:[],lineup:[]});d.querySelector('[data-historical-open]').click();
 assert.equal(d.querySelector('[data-historical-lineup-rows]').checked,true);
 const seats=d.querySelectorAll('[data-historical-seat]');seats[0].value='1';seats[1].value='2';
 const form=d.querySelector('[data-historical-lineup-dialog] form');form.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(payload().grid.rows.length,2);assert.ok(payload().grid.rows.every(row=>row.cells[1].status==='DNS'));
 d.querySelector('[data-historical-lineup-import]').click();assert.equal(d.querySelectorAll('[data-historical-seat]')[0].value,'1');assert.equal(d.querySelectorAll('[data-historical-seat]')[1].value,'2');
});

test('24 Runden samt Sprints erscheinen in genau einer Tabelle je Wertung',async t=>{
 const races=Array.from({length:24},(_,i)=>({round:i+1,title:`GP ${i+1}`,hasSprint:(i+1)%4===0}));
 const row={id:1,name:'Alpha',results:races.map(()=>({main:{points:25},sprint:{points:8}}))};
 for(const status of ['active','historical']){
   const html=await ejs.renderFile('views/partials/season-history.ejs',{selectedSeason:{id:1,status},selectedHistory:{name:'S1',races,drivers:[row],reserveDrivers:[{...row,id:2}]},history:{seasons:[{}]},isAdmin:false,league:{}});
   const dom=new JSDOM(`<section class="season-history-section">${html}</section>`,{runScripts:'outside-only'});t.after(()=>dom.window.close());const d=dom.window.document;
   assert.equal(d.querySelectorAll('.season-sheet-table').length,2);assert.equal(d.querySelectorAll('.sheet-wide,.sheet-narrow').length,0);
   for(const panel of d.querySelectorAll('[data-history-panel]')){
     assert.equal(panel.querySelectorAll('td.sheet-result').length,30);
     assert.equal(panel.querySelectorAll('td[data-round="24"]').length,2);
     assert.equal(panel.querySelector('[role=region]').getAttribute('tabindex'),'0');
   }
   dom.window.eval(fs.readFileSync('public/js/season-history-tabs.js','utf8'));d.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
   d.querySelector('[data-history-tab="reserve"]').click();assert.equal(d.querySelector('[data-history-panel="regular"]').hidden,true);assert.equal(d.querySelector('[data-history-panel="reserve"]').hidden,false);
 }
});
