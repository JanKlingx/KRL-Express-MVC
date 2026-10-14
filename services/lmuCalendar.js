const { createHash } = require('node:crypto');
const m = require('../models');
const { parseBerlinDateTime, localDateTime } = require('./calendarTime');
const { extractLeagueTime } = require('./f1Calendar');
function rounds(calendar) {
  return [...(calendar?.rounds || [])].sort((a,b) => a.sortOrder-b.sortOrder).map((row,index) => ({...row,id:row.id || index+1}));
}
const version = calendar => createHash('sha256').update(JSON.stringify([calendar.id,calendar.name,calendar.isActive,calendar.rounds])).digest('hex');
async function track(id, transaction) {
  const item = await m.LmuTrack.findByPk(Number(id),{transaction,include:[{association:'countryRecord'}]});
  if (!item) throw new Error('Bitte eine Strecke aus dem LMU-Streckenstamm auswählen.');
  return item;
}
function values(item,isTestDay) { return {LmuTrackId:item.id,circuit:item.name,title:item.countryRecord?.name || item.country || item.name,isTestDay}; }
async function edit(id,body,operation) {
  return m.sequelize.transaction(async transaction => {
    const calendar=await m.LmuCalendar.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});
    if(!calendar)throw new Error('Der Kalender wurde nicht gefunden.');
    if(body.version!==version(calendar))throw new Error('Der Kalender wurde inzwischen geändert. Bitte neu laden.');
    const existing=rounds(calendar); let updated=existing;
    if(operation==='add') {
      const item=await track(body.LmuTrackId,transaction);
      updated=[...existing,{id:Math.max(0,...existing.map(r=>Number(r.id)))+1,...values(item,body.isTestDay==='on')}];
    } else if(operation==='delete') {
      if(!existing.some(r=>String(r.id)===String(body.roundId)))throw new Error('Kalendereintrag nicht gefunden.');
      updated=existing.filter(r=>String(r.id)!==String(body.roundId));
    } else {
      const ids=[].concat(body.roundIds||[]).map(String);
      if(ids.length!==existing.length||new Set(ids).size!==ids.length||ids.some(id=>!existing.some(r=>String(r.id)===id)))throw new Error('Die Kalendereinträge wurden geändert. Bitte neu laden.');
      updated=[];
      for(const id of ids){
        const old=existing.find(r=>String(r.id)===id),input=body.rounds?.['r'+id];
        if(!input)throw new Error('Ein Kalendereintrag fehlt.');
        if(!input.LmuTrackId&&!old.LmuTrackId){ updated.push({...old,isTestDay:input.isTestDay==='on'});continue; }
        const item=await track(input.LmuTrackId,transaction);
        updated.push({...old,...values(item,input.isTestDay==='on')});
      }
    }
    let race=0;updated=updated.map((row,index)=>({...row,sortOrder:index+1,roundNumber:row.isTestDay?null:++race}));
    // LMU seasons own snapshots: changing a template never reorders an existing season.
    await calendar.update({rounds:updated},{transaction});
  });
}
function seasonRounds(calendar,body,league) {
  return rounds(calendar).map(row=>{
    const supplied=body.dates?.['r'+row.id];
    const startsAt=supplied!==undefined?parseBerlinDateTime(`${supplied}T${extractLeagueTime(league.raceTime)}`):row.startsAt;
    if(!startsAt||!Number.isFinite(new Date(startsAt).getTime()))throw new Error(`Bitte für ${row.circuit} ein gültiges Datum in Schritt 3 auswählen.`);
    return {...row,startsAt:new Date(startsAt).toISOString()};
  });
}
module.exports={rounds,version,edit,seasonRounds,localDateTime};
