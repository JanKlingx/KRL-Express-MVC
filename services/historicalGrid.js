const {createHash}=require('node:crypto');
const plain=value=>value?.toJSON?value.toJSON():value;
const key=row=>`${row.role}:${row.driverId}`;
const revision=season=>createHash('sha256').update(JSON.stringify([season.updatedAt,season.historicalGrid])).digest('hex');
function initialGrid(drivers,teams,races=[],lineups=[]) {
  const rows=drivers.flatMap(driver=>['regular','reserve'].map(role=>({driverId:Number(driver.id),role,teamId:null,cells:{}})));
  for(const race of races)for(const entry of race.entries||[]) {
    const role=lineups.find(row=>Number(row.DriverId)===Number(entry.DriverId)&&Number(row.GrandPrixResultId)===Number(race.id))?.roleType||'regular';
    const row=rows.find(row=>row.driverId===Number(entry.DriverId)&&row.role===role);if(!row)continue;
    const team=teams.find(team=>team.name===entry.teamName||team.sourceType==='current'&&Number(team.sourceId)===Number(entry.TeamId));
    row.teamId ||= team?.id||null;
    row.cells[race.id]={needsPosition:Boolean(Number(entry.points)&&!entry.position),position:entry.position||null,status:entry.status||'',teamId:team?.id||null,fastestLap:Boolean(entry.fastestLap),polePosition:Boolean(entry.polePosition),driverOfTheDay:Boolean(entry.driverOfTheDay)};
  }
  return {rows};
}
function validateGrid(value,drivers,teams,races) {
  if(!value||!Array.isArray(value.rows)||value.rows.length>400)throw new Error('Die Tabelle ist ungültig oder zu groß.');
  const driverIds=new Set(drivers.map(row=>Number(row.id))),teamIds=new Set(teams.map(row=>Number(row.id))),raceMap=new Map(races.map(row=>[String(row.id),row]));
  const rowKeys=new Set(),places=new Set(),starts=new Set(),awards=new Set();
  return {rows:value.rows.map(row=>{
    const driverId=Number(row.driverId),role=row.role,teamId=Number(row.teamId)||null;
    if(!driverIds.has(driverId)||!['regular','reserve'].includes(role)||rowKeys.has(key({driverId,role})))throw new Error('Fahrer oder Wertungszeile ist ungültig oder doppelt.');
    rowKeys.add(key({driverId,role}));if(teamId&&!teamIds.has(teamId))throw new Error('Bitte ein Team dieser Saison wählen.');
    const cells={};
    for(const [id,input] of Object.entries(row.cells||{})) {
      const race=raceMap.get(id);if(!race)throw new Error('Ein Rennen gehört nicht zu dieser Saison. Bitte neu laden.');
      const name=drivers.find(driver=>Number(driver.id)===driverId)?.name;
      const fail=message=>{throw new Error(`${name} · R${race.sortOrder} ${race.raceType==='sprint'?'Sprint':'GP'}: ${message}`);};
      const status=String(input.status||'').toUpperCase(),position=input.position==null||input.position===''?null:Number(input.position),assignedTeam=Number(input.teamId)||teamId;
      if(!['','DNF','DSQ','DNS','DNA','S'].includes(status))fail('Unbekannter Status.');
      if(position!==null&&(!Number.isInteger(position)||position<1||position>100))fail('Platz muss zwischen 1 und 100 liegen.');
      if(input.needsPosition&&!position&&!['DNA','DNS','DSQ','S'].includes(status))fail('Zu den vorhandenen Punkten fehlt eine Platzierung. Bitte diese Zelle vervollständigen.');
      if(!status&&!position)continue;
      if(['DSQ','DNS','DNA','S'].includes(status)&&position)fail('Dieser Status darf keine Platzierung haben.');
      const startsHere=Boolean(position||['DNF','DSQ'].includes(status));
      if(startsHere&&!teamIds.has(assignedTeam))fail('Bitte das Team für dieses Ergebnis wählen.');
      if(assignedTeam&&!teamIds.has(assignedTeam))fail('Das gewählte Team gehört nicht zur Saison.');
      if(startsHere){const token=`${id}:${driverId}`;if(starts.has(token))fail('Ein Fahrer darf im selben Rennen nur in einer Wertung starten.');starts.add(token);}
      if(position){const token=`${id}:${position}`;if(places.has(token))fail(`Platz ${position} ist bereits vergeben.`);places.add(token);}
      const cell={position,status,teamId:assignedTeam||null};
      for(const award of ['fastestLap','polePosition','driverOfTheDay']) {
        cell[award]=input[award]===true;
        if(cell[award]){if(race.raceType==='sprint'||!position||status==='DSQ')fail('Auszeichnungen benötigen eine GP-Platzierung.');const token=`${id}:${award}`;if(awards.has(token))fail('Diese Auszeichnung ist bereits vergeben.');awards.add(token);}
      }
      cells[id]=cell;
    }
    return {driverId,role,teamId,cells};
  })};
}
// All downstream sporting statistics read these normal GrandPrixResultEntry records.
async function projectGrid(grid,races,drivers,teams,pointsForPosition,season) {
  const entries=[];
  for(const race of races) {
    const choices=new Map();
    for(const row of grid.rows){const cell=row.cells[race.id];if(!cell||cell.status==='DNA')continue;
      const previous=choices.get(row.driverId),active=Boolean(cell.position||['DNF','DSQ'].includes(cell.status));
      if(!previous||active||!previous.active&&row.role==='regular')choices.set(row.driverId,{row,cell,active});
    }
    for(const {row,cell} of choices.values()) {
      const team=teams.find(team=>Number(team.id)===cell.teamId),driver=drivers.find(driver=>Number(driver.id)===row.driverId);
      entries.push({GrandPrixResultId:race.id,DriverId:row.driverId,TeamId:team?.baseTeamId||null,driverName:driver.name,teamName:team?.name||null,position:cell.position,status:cell.status,fastestLap:cell.fastestLap,polePosition:cell.polePosition,driverOfTheDay:cell.driverOfTheDay,
        points:cell.position?await pointsForPosition(cell.position,{...plain(race),PointsSchemeId:season.PointsSchemeId,fastestLap:cell.fastestLap,polePosition:cell.polePosition}):0,role:row.role});
    }
  }
  return entries;
}
function standingsForGrid(base,grid,races,drivers,teams,season={}) {
  const raceById=new Map(races.map(race=>[String(race.id),race]));
  const getResult=(row,race)=>{
    const cell=row.cells[race?.id];if(!cell)return {value:'–',points:0,unfilled:true};
    const entry=(race.entries||[]).find(entry=>Number(entry.DriverId)===row.driverId);
    const points=cell.position||cell.needsPosition?Number(entry?.points||0):0;
    return {...cell,points,value:cell.status||String(points),teamName:teams.find(team=>Number(team.id)===cell.teamId)?.name||''};
  };
  const rank=(role,round=Infinity)=>grid.rows.filter(row=>row.role===role).map(row=>{
    const sessions=[...raceById.values()].filter(race=>Number(race.sortOrder)<=round).map(race=>({race,result:getResult(row,race)}));
    const team=teams.find(team=>Number(team.id)===row.teamId);
    return {id:row.driverId,name:drivers.find(driver=>Number(driver.id)===row.driverId)?.name||'',team:team?.name||'',teamLogoPath:team?.logoPath||'',total:sessions.reduce((n,s)=>n+s.result.points,0),wins:sessions.filter(s=>s.race.raceType!=='sprint'&&s.result.position===1).length,dns:sessions.filter(s=>s.result.status==='DNS').length,starts:sessions.filter(s=>s.race.raceType!=='sprint'&&(s.result.position||['DNF','DSQ'].includes(s.result.status))).length,
      results:(base.selectedHistory?.races||[]).map(weekend=>{const weekendRaces=races.filter(race=>Number(race.sortOrder)===Number(weekend.round));const main=getResult(row,weekendRaces.find(r=>r.raceType!=='sprint'));const sprint=weekendRaces.some(r=>r.raceType==='sprint')?getResult(row,weekendRaces.find(r=>r.raceType==='sprint')):null;return {...main,main,sprint,hasSprint:Boolean(sprint),points:main.points+(sprint?.points||0)};})};
  }).sort((a,b)=>b.total-a.total||b.wins-a.wins||b.dns-a.dns||a.name.localeCompare(b.name,'de')).map((row,index,array)=>({...row,position:index+1,points:row.total,average:row.starts?row.total/row.starts:0,gap:index?`+${array[0].total-row.total}`:'Leader'}));
  const roles=new Map(lineupsForGrid(grid,races).map(entry=>[`${entry.GrandPrixResultId}:${entry.DriverId}`,entry.roleType]));
  function teamRanking(round=Infinity) {
    const totals=new Map(teams.map(team=>[team.name,{name:team.name,points:0,wins:0}]));
    for(const race of races.filter(race=>Number(race.sortOrder)<=round))for(const entry of race.entries||[]) {
      if(season.reservePointsForConstructors===false&&roles.get(`${race.id}:${entry.DriverId}`)==='reserve')continue;
      const row=totals.get(entry.teamName);if(!row)continue;row.points+=Number(entry.points||0);if(race.raceType!=='sprint'&&Number(entry.position)===1)row.wins++;
    }
    return [...totals.values()].sort((a,b)=>b.points-a.points||b.wins-a.wins||a.name.localeCompare(b.name,'de')).map((row,index,array)=>({...row,position:index+1,gap:index?`+${array[0].points-row.points}`:'Leader',team:{name:row.name}}));
  }
  base.teamStandings=teamRanking();
  const regular=rank('regular'),reserve=rank('reserve');
  if(base.selectedHistory){base.selectedHistory.drivers=regular;base.selectedHistory.reserveDrivers=reserve;}
  base.driverStandings=regular.map(row=>({...row,driver:{id:row.id,name:row.name,team:{name:row.team,logoPath:row.teamLogoPath}}}));
  base.reserveStandings=reserve.map(row=>({...row,driver:{id:row.id,name:row.name,team:{name:row.team,logoPath:row.teamLogoPath}}}));
  for (const round of [...new Set(races.filter(race=>(race.entries||[]).length).map(race=>Number(race.sortOrder)))]) {
    if(!base.standingsHistory.some(weekend=>Number(weekend.round)===round)) {
      const race=races.find(race=>Number(race.sortOrder)===round&&race.raceType!=='sprint')||races.find(race=>Number(race.sortOrder)===round);
      base.standingsHistory.push({round,title:race.title||'',circuit:race.circuit||'',raceDate:race.raceDate||null,hasSprint:races.some(race=>Number(race.sortOrder)===round&&race.raceType==='sprint')});
    }
  }
  base.standingsHistory.sort((a,b)=>Number(a.round)-Number(b.round));
  base.standingsHistory.forEach(weekend=>{weekend.driverStandings=rank('regular',Number(weekend.round));weekend.teamStandings=teamRanking(Number(weekend.round));});
  return base;
}
module.exports={initialGrid,validateGrid,projectGrid,standingsForGrid,revision};
function lineupsForGrid(grid,races) {
  return races.flatMap(race=>(race.entries||[]).map(entry=>{
    const candidates=grid.rows.filter(row=>row.driverId===Number(entry.DriverId)&&row.cells[race.id]);
    const row=candidates.find(row=>row.cells[race.id].position||['DNF','DSQ'].includes(row.cells[race.id].status))||candidates.find(row=>row.role==='regular')||candidates[0];
    return {GrandPrixResultId:race.id,DriverId:entry.DriverId,TeamId:entry.TeamId,roleType:row?.role||'regular',includeInResults:true};
  }));
}
module.exports.lineupsForGrid=lineupsForGrid;
