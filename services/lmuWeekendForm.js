const s=require('./lmuSeason');
const field=(rows,id)=>rows?.['d'+id]||rows?.[id]||{};
const name=d=>({...s.plain(d),name:d?.lmuDisplayName||d?.name||'Unbekannt'});
function view(data,context){
 if(!data)return {...context,weekendSeries:'LMU',weekendBase:'/admin/lmu-weekends',race:null,event:null,events:context.races||[],entries:[],attendanceRows:[],availableReplacements:[],teamCards:[],reserveRows:[],attendanceStatuses:[]};
 const entries=data.entries.map(e=>({...s.plain(e),driver:name(e.driver)}));
 const replacementFor=id=>entries.filter(e=>e.roleType==='reserve'&&e.ReplacementForDriverId===id).find(e=>e.includeInResults)||entries.filter(e=>e.roleType==='reserve'&&e.ReplacementForDriverId===id).at(-1);
 const teamCards=data.teams.map(t=>({team:{...s.plain(t),id:t.sourceId,seasonTeamId:t.id},rows:data.regulars.filter(r=>r.team.id===t.id).map(r=>({driver:name(r.driver),status:data.penalty.banned.has(r.driver.id)?'rennsperre':entries.find(e=>e.DriverId===r.driver.id)?.status||'anwesend',isBanned:data.penalty.banned.has(r.driver.id),replacementDriverId:replacementFor(r.driver.id)?.DriverId||null})),vacantSlots:data.vacancy.filter(v=>v.team.id===t.id).map(v=>({key:v.key,entry:entries.find(e=>e.vacantSeat===v.key)}))}));
 const reserveRows=data.reserves.filter(d=>!data.penalty.banned.has(d.id)).map(d=>{const entry=entries.find(e=>e.DriverId===d.id),root=data.regulars.find(r=>r.driver.id===entry?.ReplacementForDriverId);return {driver:name(d),entry,status:entry?.status||'angefragt',isAttendanceLocked:Boolean(entry?.includeInResults),assignedTo:root?{team:root.team,driver:name(root.driver)}:null};});
 return {...context,race:data.race,event:context.event||data.race,events:context.events||context.races,entries,teamCards,reserveRows,attendanceRows:entries.filter(e=>e.roleType==='regular').map(e=>({entry:e,displayTeam:data.teams.find(t=>t.id===e.SeasonTeamId),plannedReplacement:replacementFor(e.DriverId)})),availableReplacements:reserveRows.filter(r=>r.entry&&['anwesend','auf_abruf'].includes(r.status)&&!r.entry.includeInResults).map(r=>({...r.driver,status:r.status})),attendanceStatuses:[],workflow:require('./weekendWorkflow').weekendProgress(entries.filter(e=>!(e.roleType==='reserve'&&!e.includeInResults&&e.attendanceStatus==='abgemeldet'&&entries.some(root=>root.DriverId===e.ReplacementForDriverId&&root.includeInResults)))),resultCount:data.results.length,resultsHref:`/admin/lmu-weekends/${data.race.id}/results`,weekendBase:'/admin/lmu-weekends',lineupAction:`/admin/lmu-weekends/${data.race.id}/lineup`,weekendSeries:'LMU',weekendVersion:data.version,selectionMode:context.manual?'manual':'automatic'};
}
function lineupBody(data,body){
 const regular={},reserves={};
 for(const row of data.regulars)regular['d'+row.driver.id]=field(body.regular,row.driver.id);
 for(const [key,input]of Object.entries(body.reserve||{}))reserves[key]={...input,selected:'on',seat:''};
 for(const row of data.regulars){const id=Number(regular['d'+row.driver.id].ReplacementDriverId);if(!id)continue;const entry=reserves['d'+id]||reserves[id];if(!entry)throw new Error('Bitte Ersatzfahrer zuerst im Pool hinzufügen.');if(entry.seat)throw new Error('Ein Ersatzfahrer kann nur ein Cockpit übernehmen.');entry.seat='d'+row.driver.id;}
 for(const [seat,id]of Object.entries(body.vacant||{})){if(!id)continue;const entry=reserves['d'+id]||reserves[id];if(!entry)throw new Error('Bitte Ersatzfahrer zuerst im Pool hinzufügen.');if(entry.seat)throw new Error('Ein Ersatzfahrer kann nur ein Cockpit übernehmen.');entry.seat=seat;}
 for(const [key,input]of Object.entries(reserves)){
  if(data.penalty.banned.has(Number(key.replace(/^d/,''))))throw new Error('Ein gesperrter Ersatzfahrer kann nicht eingesetzt werden.');
  if(input.seat&&!['anwesend','unsicher','auf_abruf'].includes(input.status))throw new Error('Nur angemeldete Ersatzfahrer können zugeordnet werden.');
  if(!input.seat&&input.status==='anwesend')input.status='auf_abruf';
  if(input.seat&&input.status==='auf_abruf')input.status='anwesend';
 }
 return {...body,regular,reserves};
}
function attendanceValues(data,body){
 const rows=new Map(data.entries.map(e=>[e.DriverId,{entry:e,values:{attendanceStatus:'abgemeldet',includeInResults:false,uncertainPresent:null,respondedInTime:null}}]));
 const used=new Set();
 function participation(entry){
  if(data.penalty.banned.has(entry.DriverId)||entry.status==='rennsperre')return {attendanceStatus:'abgemeldet',includeInResults:false};
  const input=field(body.attendance,entry.id);
  if(entry.status==='unsicher'){
   const uncertain=field(body.uncertain,entry.id);
   if(!['yes','no'].includes(uncertain.present)||!['yes','no'].includes(uncertain.respondedInTime))throw new Error(`${entry.driver.lmuDisplayName||entry.driver.name}: Teilnahme und Rückmeldung mit Ja oder Nein bestätigen.`);
   const present=uncertain.present==='yes',timely=uncertain.respondedInTime==='yes';
   const status=present?(input.status||'anwesend'):(timely?'rueckmeldung_unsicher':'fehlende_rueckmeldung_unsicher');
   if(present&&!['anwesend','zu_spaet_vorbesprechung'].includes(status))throw new Error('Bitte eine gültige Anwesenheit auswählen.');
   return {attendanceStatus:status,includeInResults:present,uncertainPresent:present,respondedInTime:timely};
  }
  const status=entry.vacantSeat?body.vacantAttendance?.['d'+entry.DriverId]:['abgemeldet','zu_spaet_abgemeldet'].includes(entry.status)?entry.status:input.status||'anwesend';
  if(!['anwesend','zu_spaet_vorbesprechung','abgemeldet','unabgemeldet','zu_spaet_abgemeldet'].includes(status))throw new Error('Bitte eine gültige Anwesenheit auswählen.');
  return {attendanceStatus:status,includeInResults:['anwesend','zu_spaet_vorbesprechung'].includes(status)};
 }
 function assign(entry,root,seen=new Set()){
  if(seen.has(entry.DriverId)||used.has(entry.DriverId))throw new Error('Ein Ersatzfahrer ist mehrfach zugeordnet.');seen.add(entry.DriverId);used.add(entry.DriverId);
  const row=rows.get(entry.DriverId),state=participation(entry);Object.assign(row.values,state);
  if(root&&entry.roleType==='reserve')Object.assign(row.values,{ReplacementForDriverId:root.DriverId,TeamId:root.TeamId,SeasonTeamId:root.SeasonTeamId,vacantSeat:null});
  if(state.includeInResults)return;
  const requested=Number(field(body.attendance,entry.id).ReplacementDriverId)||null;
  const replacement=requested?data.entries.find(e=>e.DriverId===requested&&e.roleType==='reserve'):data.entries.filter(e=>e.roleType==='reserve'&&e.ReplacementForDriverId===entry.DriverId).at(-1);
  if(requested&&!replacement)throw new Error('Der Ersatzfahrer ist nicht im Pool angemeldet.');
  if(replacement){if(!['anwesend','auf_abruf','unsicher'].includes(replacement.status)||data.penalty.banned.has(replacement.DriverId))throw new Error('Dieser Ersatzfahrer steht nicht für den Einsatz bereit.');assign(replacement,root||entry,seen);}
 }
 data.entries.filter(e=>e.roleType==='regular').forEach(e=>assign(e,null));
 for(const e of data.entries.filter(e=>e.vacantSeat))assign(e,null);
 return [...rows.values()];
}
module.exports={view,lineupBody,attendanceValues,name};
