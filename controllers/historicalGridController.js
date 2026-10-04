const models=require('../models');
const {Op}=require('sequelize');
const gridService=require('../services/historicalGrid');
async function loadGridData(season,raceValues=null) {
  const [members,teamValues,raceModels]=await Promise.all([
    models.SeasonDriver.findAll({where:{SeasonId:season.id},include:[{association:'driver'}]}),
    models.SeasonTeam.findAll({where:{SeasonId:season.id},order:[['sortOrder','ASC'],['id','ASC']]}),
    raceValues||models.GrandPrixResult.findAll({where:{SeasonId:season.id,discipline:'f1'},include:[{association:'entries'},{association:'calendarEvent'}],order:[['sortOrder','ASC'],['id','ASC']]})
  ]);
  const rawRaces=raceModels.map(row=>row.toJSON?row.toJSON():row);
  const events=rawRaces.map(race=>race.calendarEvent).filter(Boolean);
  const races=rawRaces.filter(row=>!require('../services/publicRaceWeekend').isTestDayResult(row,events,rawRaces));
  const teams=await Promise.all(teamValues.map(async value=>{const row=value.toJSON();const definition=await require('../services/f1Season').resolveTeamToken(`${row.sourceType}:${row.sourceId}`);return {...row,baseTeamId:row.sourceType==='current'?row.sourceId:definition?.BaseTeamId||null};}));
  const extraIds=[...new Set(races.flatMap(race=>(race.entries||[]).map(entry=>entry.DriverId)).filter(Boolean))];
  const availableDrivers=await models.Driver.findAll({order:[['name','ASC']]});
  const drivers=[...new Map([...members.map(member=>member.driver),...availableDrivers].filter(Boolean).map(driver=>[Number(driver.id),driver.toJSON()])).values()];
  const legacyLineups=season.historicalGrid?[]:await models.F1RaceLineupEntry.findAll({where:{GrandPrixResultId:{[Op.in]:races.map(race=>race.id)}}});
  const existingDrivers=drivers.filter(driver=>members.some(member=>Number(member.driver?.id)===Number(driver.id))||extraIds.includes(driver.id));
  const grid=season.historicalGrid?JSON.parse(JSON.stringify(season.historicalGrid)):gridService.initialGrid(existingDrivers,teams,races,legacyLineups);
  grid.rows.forEach((row,index)=>{row.rowId ||= `${row.role}:${row.driverId}:${index}`;});
  for (const row of grid.rows) for (const [raceId,cell] of Object.entries(row.cells || {})) {
    if (cell.needsPosition) {
      const entry = races.find(race => Number(race.id) === Number(raceId))?.entries?.find(entry => Number(entry.DriverId) === Number(row.driverId));
      if (entry) { cell.points = Number(entry.points || 0); delete cell.needsPosition; }
    }
  }
  if (!Array.isArray(grid.lineup)) {
    const seen=new Set(), seats=new Map();
    grid.lineup=grid.rows.filter(row=>row.role==='regular'&&row.teamId&&!seen.has(row.driverId)&&(seats.get(row.teamId)||0)<2&&(seen.add(row.driverId),seats.set(row.teamId,(seats.get(row.teamId)||0)+1))).map(row=>({driverId:row.driverId,teamId:row.teamId}));
  }
  return {grid,drivers,teams,races,revision:gridService.revision(season)};
}
exports.loadGridData=loadGridData;
exports.save=async(req,res)=>{
  const season=await models.Season.findByPk(req.params.seasonId);
  if(!season||season.leagueType!=='f1'||season.status!=='historical')return res.status(400).json({error:'Diese Tabelle ist ausschließlich für historische F1-Saisons.'});
  try {
    if(!season.PointsSchemeId)throw new Error('Bitte zuerst im Saison-Assistenten ein Punktesystem auswählen.');
    const data=await loadGridData(season);
    const pointCache=new Map();
    const calculatePoints=async(position,context)=>{
      const key=JSON.stringify([position,context.raceType,context.fastestLap,context.polePosition]);
      if(!pointCache.has(key))pointCache.set(key,await require('../services/championship').pointsForPosition(position,context));
      return pointCache.get(key);
    };
    await models.sequelize.transaction(async transaction=>{
      const locked=await models.Season.findByPk(season.id,{transaction,lock:transaction.LOCK.UPDATE});
      if(locked.status!=='historical'||gridService.revision(locked)!==req.body.revision)throw new Error('Die Saison wurde zwischenzeitlich geändert. Bitte deine Eingaben sichern und die Seite neu laden.');
      const prepared=req.body.teams===undefined ? {grid:req.body.grid,teams:data.teams} : await require('../services/historicalTeams').reconcile(locked,req.body.teams,req.body.grid,data.teams,transaction);
      const grid=gridService.validateGrid(prepared.grid,data.drivers,prepared.teams,data.races);
      const entries=await gridService.projectGrid(grid,data.races,data.drivers,prepared.teams,calculatePoints,locked);
      const ids=data.races.map(race=>race.id);
      await models.GrandPrixResultEntry.destroy({where:{GrandPrixResultId:{[Op.in]:ids}},transaction});
      if(entries.length)await models.GrandPrixResultEntry.bulkCreate(entries.map(({role,...entry})=>entry),{transaction});
      await models.GrandPrixResult.update({pointsMode:'database',isHistorical:true},{where:{id:{[Op.in]:ids}},transaction});
      for(const race of data.races.filter(race=>race.raceType!=='sprint'))await models.RaceEvent.update({isCompleted:entries.some(entry=>entry.GrandPrixResultId===race.id)},{where:{GrandPrixResultId:race.id,SeasonId:season.id},transaction});
      // A team-only correction must also invalidate other open editors.
      if(req.body.teams!==undefined)locked.changed('historicalGrid',true);
      await locked.update({historicalGrid:grid},{transaction});
    });
    res.json({url:`/f1/${encodeURIComponent(season.scopeSlug)}?season=${season.id}#season-history`});
  }catch(error){res.status(422).json({error:error.message});}
};
