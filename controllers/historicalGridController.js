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
  const extra=extraIds.length?await models.Driver.findAll({where:{id:{[Op.in]:extraIds}}}):[];
  const drivers=[...new Map([...members.map(member=>member.driver),...extra].filter(Boolean).map(driver=>[Number(driver.id),driver.toJSON()])).values()];
  const legacyLineups=season.historicalGrid?[]:await models.F1RaceLineupEntry.findAll({where:{GrandPrixResultId:{[Op.in]:races.map(race=>race.id)}}});
  const grid=season.historicalGrid?JSON.parse(JSON.stringify(season.historicalGrid)):gridService.initialGrid(drivers,teams,races,legacyLineups);
  for (const row of grid.rows) for (const [raceId,cell] of Object.entries(row.cells || {})) {
    if (cell.needsPosition) {
      const entry = races.find(race => Number(race.id) === Number(raceId))?.entries?.find(entry => Number(entry.DriverId) === Number(row.driverId));
      if (entry) { cell.points = Number(entry.points || 0); delete cell.needsPosition; }
    }
  }
  if (!Array.isArray(grid.lineup)) grid.lineup = grid.rows.filter(row => row.role === 'regular' && row.teamId).map(row => ({driverId: row.driverId, teamId: row.teamId}));
  return {grid,drivers,teams,races,revision:gridService.revision(season)};
}
exports.loadGridData=loadGridData;
exports.save=async(req,res)=>{
  const season=await models.Season.findByPk(req.params.seasonId);
  if(!season||season.leagueType!=='f1'||season.status!=='historical')return res.status(400).json({error:'Diese Tabelle ist ausschließlich für historische F1-Saisons.'});
  try {
    if(!season.PointsSchemeId)throw new Error('Bitte zuerst im Saison-Assistenten ein Punktesystem auswählen.');
    const data=await loadGridData(season);
    const grid=gridService.validateGrid(req.body.grid,data.drivers,data.teams,data.races);
    const pointCache=new Map();
    const calculatePoints=async(position,context)=>{
      const key=JSON.stringify([position,context.raceType,context.fastestLap,context.polePosition]);
      if(!pointCache.has(key))pointCache.set(key,await require('../services/championship').pointsForPosition(position,context));
      return pointCache.get(key);
    };
    const entries=await gridService.projectGrid(grid,data.races,data.drivers,data.teams,calculatePoints,season);
    await models.sequelize.transaction(async transaction=>{
      const locked=await models.Season.findByPk(season.id,{transaction,lock:transaction.LOCK.UPDATE});
      if(locked.status!=='historical'||gridService.revision(locked)!==req.body.revision)throw new Error('Die Saison wurde zwischenzeitlich geändert. Bitte deine Eingaben sichern und die Seite neu laden.');
      const ids=data.races.map(race=>race.id);
      await models.GrandPrixResultEntry.destroy({where:{GrandPrixResultId:{[Op.in]:ids}},transaction});
      if(entries.length)await models.GrandPrixResultEntry.bulkCreate(entries.map(({role,...entry})=>entry),{transaction});
      await models.GrandPrixResult.update({pointsMode:'database',isHistorical:true},{where:{id:{[Op.in]:ids}},transaction});
      for(const race of data.races.filter(race=>race.raceType!=='sprint'))await models.RaceEvent.update({isCompleted:entries.some(entry=>entry.GrandPrixResultId===race.id)},{where:{GrandPrixResultId:race.id,SeasonId:season.id},transaction});
      await locked.update({historicalGrid:grid},{transaction});
    });
    res.json({url:`/f1/${encodeURIComponent(season.scopeSlug)}?season=${season.id}#season-history`});
  }catch(error){res.status(422).json({error:error.message});}
};
