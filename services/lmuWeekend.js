const { Op } = require('sequelize');
const m = require('../models');
const s = require('./lmuSeason');
const { isRoundInStint } = require('./seasonDriverStints');
const { REGULAR_STATUSES, RESERVE_STATUSES } = require('./raceLineup');
const regularStatuses=new Set(REGULAR_STATUSES.map(r=>r.value)),reserveStatuses=new Set(RESERVE_STATUSES.map(r=>r.value));
const include=[{association:'driver',include:[{association:'lmuCar'}]},{association:'team'},{association:'replacementFor'}];
async function penalties(leagueId, race, transaction) {
  const rows=await m.PenaltyEntry.findAll({where:{LeagueId:leagueId},transaction});
  const setting=await m.F1PenaltySetting.findOne({where:{LeagueId:leagueId},transaction});
  const date=race.raceDate||require('./raceWeekend').berlinDate();const totals=new Map(),banned=new Set();
  for(const row of rows){
    if(row.isRaceBan){if(Number(row.SeasonId)===Number(race.SeasonId)&&Number(row.roundNumber)===Number(race.sortOrder))banned.add(Number(row.DriverId));continue;}
    if(row.awardedOn&&row.awardedOn<=date&&(!row.expiresOn||row.expiresOn>=date))totals.set(Number(row.DriverId),(totals.get(Number(row.DriverId))||0)+Number(row.points));
  }
  return {rows,totals,banned,limit:setting?.pointsLimit||12};
}
async function load(raceId, transaction, lock=false) {
  if(lock){const record=await m.GrandPrixResult.findByPk(raceId,{transaction});if(record?.discipline!=='lmu')throw new Error('LMU-Rennen nicht gefunden.');await s.seasonById(record.SeasonId,transaction,true);}
  const race=await m.GrandPrixResult.findByPk(raceId,{include:[{association:'seasonRecord'},{association:'league'}],transaction,...(lock?{lock:transaction.LOCK.UPDATE}:{})});
  if(!race||race.discipline!=='lmu'||race.raceType!=='main'||race.seasonRecord?.leagueType!=='lmu')throw new Error('LMU-Rennen nicht gefunden.');
  const stints=await m.SeasonDriverStint.findAll({where:{SeasonId:race.SeasonId},transaction});
  const [teams,drivers,entries,results,scheme,penalty]=await Promise.all([
    m.SeasonTeam.findAll({where:{SeasonId:race.SeasonId},transaction}),
    m.Driver.findAll({where:{[Op.or]:[s.lmuWhere,{roleFormerLmu:true},{id:{[Op.in]:stints.map(row=>row.DriverId)}}]},include:[{association:'lmuCar'}],order:[['name','ASC']],transaction}),
    m.F1RaceLineupEntry.findAll({where:{GrandPrixResultId:race.id},include,order:[['sortOrder','ASC'],['id','ASC']],transaction}),
    m.GrandPrixResultEntry.findAll({where:{GrandPrixResultId:race.id},transaction}),
    m.PointsScheme.findByPk(race.seasonRecord.PointsSchemeId,{include:[{association:'allocations'}],transaction}),penalties(race.LeagueId,race,transaction)
  ]);
  const regulars=stints.filter(stint=>stint.roleType==='regular'&&isRoundInStint(stint,race.sortOrder)).map(stint=>({stint,driver:drivers.find(d=>d.id===stint.DriverId),team:teams.find(t=>t.id===stint.SeasonTeamId)})).filter(row=>row.driver&&row.team);
  const reserves=drivers.filter(d=>!regulars.some(r=>r.driver.id===d.id)&&(race.seasonRecord.status==='historical'||!d.roleFormerLmu));
  const vacancy=[];for(const team of teams){const used=regulars.filter(row=>row.team.id===team.id).length;for(let slot=used+1;slot<=3;slot++)vacancy.push({key:`${team.id}:${slot}`,team,label:`${team.name} · freier Platz ${slot}`});}
  return {race,season:race.seasonRecord,league:race.league,teams,regulars,reserves,vacancy,entries,results,scheme,penalty,version:s.revision({updatedAt:JSON.stringify([race.updatedAt,race.seasonRecord.updatedAt,stints.map(s.plain)])},entries,results)};
}
function verify(data,version){if(data.version!==version)throw new Error('Das Rennwochenende wurde inzwischen geändert. Bitte neu laden.');}
async function saveLineup(id,body){
 return m.sequelize.transaction(async transaction=>{
  const data=await load(id,transaction,true);verify(data,body.version);if(data.results.length)throw new Error('Bitte zuerst die Ergebnisse zurücksetzen.');
  const records=[],used=new Set(),seats=new Set();
  for(const row of data.regulars){const input=body.regular?.[`d${row.driver.id}`]||{};const status=data.penalty.banned.has(row.driver.id)?'rennsperre':input.status||'anwesend';if(!regularStatuses.has(status))throw new Error('Ungültiger Stammfahrerstatus.');
    records.push({DriverId:row.driver.id,TeamId:row.team.sourceId,SeasonTeamId:row.team.id,roleType:'regular',status});used.add(row.driver.id);
    if(status==='anwesend'||status==='unsicher'||status==='rennsperre')seats.add(`d${row.driver.id}`);
  }
  for(const [key,input]of Object.entries(body.reserves||{})){
    if(input.selected!=='on')continue;const driver=data.reserves.find(d=>d.id===Number(key.replace(/^d/,'')));if(!driver||used.has(driver.id))throw new Error('Ungültiger oder mehrfach ausgewählter Ersatzfahrer.');used.add(driver.id);
    const status=input.status||'auf_abruf';if(!reserveStatuses.has(status))throw new Error('Ungültiger Ersatzfahrerstatus.');
    let team=null,replacement=null,vacantSeat=null;
    if(input.seat?.startsWith('d')){replacement=data.regulars.find(r=>r.driver.id===Number(input.seat.slice(1)));if(!replacement)throw new Error('Dieser Stammplatz existiert nicht.');team=replacement.team;}
    else if(input.seat){const vacancy=data.vacancy.find(v=>v.key===input.seat);if(!vacancy)throw new Error('Dieser freie Platz existiert nicht.');team=vacancy.team;vacantSeat=vacancy.key;}
    if(input.seat&&seats.has(input.seat))throw new Error('Ein Platz ist doppelt belegt, noch unsicher oder durch eine Rennsperre blockiert.');
    if(input.seat)seats.add(input.seat);
    records.push({DriverId:driver.id,TeamId:team?.sourceId||null,SeasonTeamId:team?.id||null,ReplacementForDriverId:replacement?.driver.id||null,vacantSeat,roleType:'reserve',status});
  }
  if(!records.length)throw new Error('Bitte zunächst Fahrer zur Saison zuordnen.');
  await m.F1RaceLineupEntry.destroy({where:{GrandPrixResultId:data.race.id},transaction});
  await m.F1RaceLineupEntry.bulkCreate(records.map((row,index)=>({...row,GrandPrixResultId:data.race.id,sortOrder:index,includeInResults:false})),{transaction});
 });
}
async function saveAttendance(id,body){
 return m.sequelize.transaction(async transaction=>{
  const data=await load(id,transaction,true);verify(data,body.version);if(data.results.length)throw new Error('Bitte zuerst die Ergebnisse zurücksetzen.');if(!data.entries.length)throw new Error('Bitte zuerst die Aufstellung speichern.');
  const occupied=new Set();
  for(const entry of data.entries){const input=body.attendance?.[`d${entry.DriverId}`]||{};const banned=entry.status==='rennsperre'||data.penalty.banned.has(entry.DriverId);let attendance=banned?'abgemeldet':input.status;
    if(!['anwesend','zu_spaet_vorbesprechung','abgemeldet','unabgemeldet','zu_spaet_abgemeldet'].includes(attendance))throw new Error('Bitte die tatsächliche Anwesenheit für jeden Fahrer bestätigen.');
    const includeInResults=!banned&&['anwesend','zu_spaet_vorbesprechung'].includes(attendance)&&(entry.roleType==='regular'||Boolean(entry.ReplacementForDriverId||entry.vacantSeat));
    if(includeInResults){const seat=entry.roleType==='regular'?`d${entry.DriverId}`:entry.vacantSeat||`d${entry.ReplacementForDriverId}`;if(occupied.has(seat))throw new Error('Stamm- und Ersatzfahrer können nicht gleichzeitig denselben Platz nutzen.');occupied.add(seat);}
    await entry.update({attendanceStatus:attendance,includeInResults,uncertainPresent:entry.status==='unsicher'?includeInResults:null},{transaction});
  }
 });
}
function resultRows(data,body){
 if(!data.scheme||data.scheme.discipline!=='lmu')throw new Error('Bitte der Saison ein LMU-Punktesystem zuordnen.');
 if(!data.entries.length||data.entries.some(entry=>!entry.attendanceStatus))throw new Error('Bitte zuerst Aufstellung und Anwesenheit abschließen.');
 const positions=new Set(),awards={fastestLap:0,polePosition:0,driverOfTheDay:0};
 const rows=data.entries.map(entry=>{
   const input=body.results?.[`d${entry.DriverId}`]||{},participates=entry.includeInResults&&!data.penalty.banned.has(entry.DriverId);
   let status=entry.status==='rennsperre'||data.penalty.banned.has(entry.DriverId)?'S':participates?String(input.status||''):'DNS';
   if(participates&&!['','DNF','DSQ'].includes(status)||!['','DNF','DSQ','DNS','S'].includes(status))throw new Error('Ungültiger Ergebnisstatus.');
   let position=null;if(!status){position=s.number(input.position,'Platzierung');if(positions.has(position))throw new Error(`Platz ${position} ist doppelt vergeben.`);positions.add(position);}
   const row={GrandPrixResultId:data.race.id,DriverId:entry.DriverId,TeamId:entry.TeamId,driverName:entry.driver.lmuDisplayName||entry.driver.name,teamName:data.teams.find(t=>t.id===entry.SeasonTeamId)?.name||entry.team?.name||null,position,status,points:0};
   for(const key of Object.keys(awards)){row[key]=participates&&status!=='DSQ'&&input[key]==='on';if(row[key]&&++awards[key]>1)throw new Error('Pole, schnellste Runde und Driver of the Day dürfen jeweils nur einmal vergeben werden.');}
   row.points=s.points(data.scheme,row);return row;
 });
 return rows;
}
async function saveResults(id,body){return m.sequelize.transaction(async transaction=>{const data=await load(id,transaction,true);verify(data,body.version);const rows=resultRows(data,body);await m.GrandPrixResultEntry.destroy({where:{GrandPrixResultId:id},transaction});await m.GrandPrixResultEntry.bulkCreate(rows,{transaction});await m.RaceEvent.update({isCompleted:true},{where:{GrandPrixResultId:id,SeasonId:data.season.id},transaction});await s.syncRanks(transaction);});}
async function reset(id,body){return m.sequelize.transaction(async transaction=>{const data=await load(id,transaction,true);verify(data,body.version);const step=s.number(body.step,'Schritt');if(step>3)throw new Error('Ungültiger Schritt.');await m.GrandPrixResultEntry.destroy({where:{GrandPrixResultId:id},transaction});if(step===1)await m.F1RaceLineupEntry.destroy({where:{GrandPrixResultId:id},transaction});else if(step===2)await m.F1RaceLineupEntry.update({attendanceStatus:null,includeInResults:false},{where:{GrandPrixResultId:id},transaction});await m.RaceEvent.update({isCompleted:false},{where:{GrandPrixResultId:id},transaction});await s.syncRanks(transaction);});}
module.exports={load,penalties,saveLineup,saveAttendance,saveResults,resultRows,reset};
