const {Op}=require('sequelize');
const {createHash}=require('node:crypto');
const m=require('../models');
const s=require('./lmuSeason');
const {isRoundInStint,validateRegularStintSet}=require('./seasonDriverStints');
const display=d=>({...s.plain(d),name:d.lmuDisplayName||d.name});
function canonicalInput(input){
 const operation=input.operation;return {operation,round:String(input.round),team:operation==='retireReserve'?'':String(input.team||''),driver:String(input[operation==='fill'?'newDriver':operation==='release'?'oldDriver':'reserveDriver']||''),staysReserve:operation==='release'?String(input.staysReserve||'0'):'0'};
}
async function context(seasonId,transaction){
 const season=await s.seasonById(seasonId,transaction,Boolean(transaction));
 const [teams,stints,drivers,races]=await Promise.all([
 m.SeasonTeam.findAll({where:{SeasonId:season.id},transaction}),m.SeasonDriverStint.findAll({where:{SeasonId:season.id},include:[{association:'driver'},{association:'carryOvers'}],transaction}),m.Driver.findAll({where:s.lmuWhere,order:[['name','ASC']],transaction}),m.GrandPrixResult.findAll({where:{SeasonId:season.id,discipline:'lmu',raceType:'main'},include:[{association:'entries'},{association:'lineupEntries'}],order:[['sortOrder','ASC']],transaction})]);
 const completedRound=Math.max(0,...races.filter(r=>r.entries.length).map(r=>Number(r.sortOrder)));
 const ordered=rows=>rows.map(s.plain).sort((a,b)=>a.id-b.id);
 const version=createHash('sha256').update(JSON.stringify([s.plain(season),ordered(teams),ordered(drivers),ordered(stints).map(st=>({...st,carryOvers:ordered(st.carryOvers||[])})),ordered(races).map(r=>({...r,entries:ordered(r.entries),lineupEntries:ordered(r.lineupEntries)}))])).digest('hex');
 return {season,teams,stints,drivers,races,completedRound,version};
}
async function retirement(data,driver,round,transaction){
 if(data.season.status!=='active')return null;
 const date=data.races.find(r=>Number(r.sortOrder)===round)?.raceDate;
 if(!date)throw new Error('Bitte zuerst das Renndatum ergänzen.');
 const seasons=await m.Season.findAll({where:{leagueType:'lmu',status:'active'},order:[['id','ASC']],transaction});
 const scopes=[];
 for(const season of seasons){
  const scope=Number(season.id)===Number(data.season.id)?data:await context(season.id,transaction);
  if(scope.races.some(r=>!r.raceDate))throw new Error(`${season.name}: Bitte zuerst alle Renndaten ergänzen.`);
  const start=Number(season.id)===Number(data.season.id)?round:Number(scope.races.find(r=>r.raceDate&&String(r.raceDate)>=String(date))?.sortOrder);
  if(!start)continue;
  const periods=scope.stints.filter(st=>st.DriverId===driver.id&&st.roleType==='reserve'&&(st.toRound==null||st.toRound>=start));
  const driverPeriods=scope.stints.filter(st=>st.DriverId===driver.id);
  const latest=driverPeriods.filter(st=>st.fromRound<=start).sort((a,b)=>b.fromRound-a.fromRound)[0];
  if(!periods.length&&(driverPeriods.some(st=>st.roleType==='regular'&&isRoundInStint(st,start))||latest?.endReason==='left'&&latest.toRound<start))continue;
  if(start<=scope.completedRound)throw new Error(`${season.name}: Der Ausstieg würde bereits gefahrene Runden betreffen.`);
  if(scope.races.some(r=>r.sortOrder>=start&&r.lineupEntries.some(e=>e.attendanceStatus||e.includeInResults)))throw new Error(`${season.name}: Bitte die bestätigte Anwesenheit ab R${start} zuerst zurücksetzen.`);
  scopes.push({...scope,round:start,periods});
 }
 return {date,scopes};
}
async function plan(data,input,transaction){
 const round=s.number(input.round,'Runde');if(round<=data.completedRound||!data.races.some(r=>Number(r.sortOrder)===round))throw new Error('Bitte eine noch nicht gefahrene Runde auswählen.');
 const operation=input.operation;if(!['fill','release','retireReserve'].includes(operation))throw new Error('Bitte eine Aktion auswählen.');
 if(operation==='retireReserve'&&data.season.status!=='active')throw new Error('Der ligaübergreifende Ausstieg ist nur in aktuellen Saisons möglich.');
 const active=data.stints.filter(st=>st.roleType==='regular'&&isRoundInStint(st,round));
 const team=data.teams.find(t=>t.id===Number(input.team));
 const driver=data.drivers.find(d=>d.id===Number(operation==='fill'?input.newDriver:operation==='release'?input.oldDriver:input.reserveDriver));
 if(!driver)throw new Error('Bitte einen LMU-Fahrer auswählen.');
 const oldStint=active.find(st=>st.DriverId===driver.id&&st.SeasonTeamId===team?.id);
 if(operation!=='retireReserve'&&!team)throw new Error('Bitte ein Saisonteam auswählen.');
 if(operation==='release'&&!oldStint)throw new Error('Dieser Fahrer besitzt hier in dieser Runde kein Stammcockpit.');
 if(operation==='fill'&&(active.some(st=>st.DriverId===driver.id)||active.filter(st=>st.SeasonTeamId===team.id).length>=3))throw new Error('Der Fahrer hat bereits ein Cockpit oder das Team ist vollständig besetzt.');
 if(operation==='release'&&!['0','1'].includes(String(input.staysReserve)))throw new Error('Bitte auswählen, ob der Fahrer Ersatzfahrer bleibt.');
 if(operation==='retireReserve'&&(active.some(st=>st.DriverId===driver.id)||!driver.roleLmuReserve))throw new Error('Bitte einen aktuellen LMU-Ersatzfahrer auswählen.');
 if(data.stints.some(st=>st.DriverId===driver.id&&st.fromRound>round))throw new Error('Für diesen Fahrer gibt es bereits einen späteren Wechsel.');
 if(data.races.some(r=>r.sortOrder>=round&&r.lineupEntries.some(e=>e.attendanceStatus||e.includeInResults)))throw new Error('Bitte zuerst die bestätigte Anwesenheit der betroffenen zukünftigen Rennen zurücksetzen.');
 if(operation==='fill')validateRegularStintSet([...data.stints,{DriverId:driver.id,SeasonTeamId:team.id,roleType:'regular',fromRound:round,toRound:null}],3);
 const staysReserve=String(input.staysReserve)==='1';
 const carryHistory=operation==='fill'?data.races.filter(r=>r.sortOrder<round&&r.lineupEntries.some(e=>e.DriverId===driver.id&&e.roleType==='reserve'&&e.TeamId===team.sourceId&&e.includeInResults)).map(r=>({GrandPrixResultId:r.id,round:r.sortOrder,title:r.title,mainPoints:r.entries.filter(e=>e.DriverId===driver.id&&e.TeamId===team.sourceId).reduce((sum,e)=>sum+Number(e.points),0),sprintPoints:0})).map(r=>({...r,totalPoints:r.mainPoints})):[];
 const retire=operation==='retireReserve'||operation==='release'&&!staysReserve?await retirement(data,driver,round,transaction):null;
 const version=createHash('sha256').update(JSON.stringify([data.version,canonicalInput(input),retire?.scopes.map(scope=>scope.version)])).digest('hex');
 return {operation,effectiveRound:round,team,driver:display(driver),oldStint:oldStint?{...s.plain(oldStint),driver:display(driver)}:null,membership:{DriverId:driver.id,driver:display(driver)},staysReserve,carryHistory,reserveLeagueSlugs:[],retirement:retire,version,input};
}
async function save(seasonId,body){
 return m.sequelize.transaction(async transaction=>{
  const data=await context(seasonId,transaction);
  const input={operation:body.operation,round:String(body.effectiveRound),team:String(body.SeasonTeamId||''),oldDriver:String(body.OldDriverId||''),newDriver:String(body.NewDriverId||''),reserveDriver:String(body.ReserveDriverId||''),staysReserve:String(body.staysReserve||'0')};
  const preview=await plan(data,input,transaction);
  if(preview.version!==body.changeVersion)throw new Error('Die Zuordnung wurde inzwischen geändert. Bitte die Transaktion erneut prüfen.');
  const selected=[...new Set([].concat(body.carryResultIds||[]).map(Number))];
  if(selected.some(id=>!preview.carryHistory.some(r=>r.GrandPrixResultId===id)))throw new Error('Ein ausgewählter Ersatzeinsatz gehört nicht zu diesem Fahrer und Team.');
  if(preview.operation!=='retireReserve')await s.changeDriver(seasonId,{DriverId:preview.driver.id,fromRound:preview.effectiveRound,SeasonTeamId:preview.operation==='fill'?preview.team.id:'',retire:preview.operation==='release'&&!preview.staysReserve?'on':''},transaction);
  if(preview.retirement){
   for(const scope of preview.retirement.scopes){
    if(!scope.periods.length&&scope.round>1)await m.SeasonDriverStint.create({SeasonId:scope.season.id,DriverId:preview.driver.id,roleType:'reserve',SeasonTeamId:null,fromRound:1,toRound:scope.round-1,endReason:'left'},{transaction});
    for(const st of scope.periods){if(st.fromRound>=scope.round)await st.destroy({transaction});else await st.update({toRound:scope.round-1,endReason:'left'},{transaction});}
    await m.SeasonLineupEntry.destroy({where:{SeasonId:scope.season.id,DriverId:preview.driver.id,roleType:'reserve'},transaction});
    await m.F1RaceLineupEntry.destroy({where:{GrandPrixResultId:{[Op.in]:scope.races.filter(r=>r.sortOrder>=scope.round).map(r=>r.id)},DriverId:preview.driver.id,roleType:'reserve'},transaction});
   }
   if(preview.effectiveRound===data.completedRound+1){const driver=await m.Driver.findByPk(preview.driver.id,{transaction});await driver.update({roleFormerLmu:true},{transaction});}
  }
  if(preview.operation==='fill'&&selected.length){
   const stint=await m.SeasonDriverStint.findOne({where:{SeasonId:seasonId,DriverId:preview.driver.id,roleType:'regular',fromRound:preview.effectiveRound},transaction});
   await m.SeasonDriverCarryOver.bulkCreate(selected.map(GrandPrixResultId=>({SeasonId:seasonId,SeasonDriverStintId:stint.id,DriverId:preview.driver.id,SeasonTeamId:preview.team.id,GrandPrixResultId,selected:true})),{transaction});
  }
  await s.syncRanks(transaction);
 });
}
module.exports={context,plan,save,display};
