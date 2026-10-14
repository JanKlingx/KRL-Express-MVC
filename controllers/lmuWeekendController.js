const m=require('../models');
const s=require('../services/lmuSeason');
const weekend=require('../services/lmuWeekend');
const form=require('../services/lmuWeekendForm');
exports.show=async(req,res)=>{
 const context=await require('./lmuAdminController').context(req.query);if(context.season)await s.ensureStructure(context.season.id);
 const races=context.season?await m.GrandPrixResult.findAll({where:{SeasonId:context.season.id,discipline:'lmu',raceType:'main'},order:[['sortOrder','ASC']]}):[];
 const calendar=context.season?await m.RaceEvent.findAll({where:{SeasonId:context.season.id,isTestDay:false},include:[{association:'lmuTrack',include:[{association:'countryRecord'}]}],order:[['sortOrder','ASC']]}):[];
 const events=races.map(r=>{const e=calendar.find(e=>e.GrandPrixResultId===r.id);return {...s.plain(e||r),id:r.id,sortOrder:r.sortOrder,track:e?.lmuTrack};});
 const current=races.find(r=>r.id===Number(req.query.event||req.query.race))||races.find(r=>!r.raceDate||r.raceDate>=require('../services/raceWeekend').berlinDate())||races.at(-1);
 const details=current?await weekend.load(current.id):null;
 res.render('admin/race-weekend',{title:'Rennwochenende LMU',...form.view(details,{...context,races,events,event:events.find(e=>e.id===current?.id),manual:Boolean(req.query.event||req.query.race)}),regularStatuses:require('../services/raceLineup').REGULAR_STATUSES,reserveStatuses:require('../services/raceLineup').RESERVE_STATUSES});
};
exports.results=async(req,res)=>{const details=await weekend.load(req.params.id);res.render('admin/lmu-results',{title:'LMU-Ergebnisse eintragen',details,displayName:driver=>driver?.lmuDisplayName||driver?.name||'Fahrer'});};
exports.manage=async(req,res)=>{
 let race;
 try{await m.sequelize.transaction(async transaction=>{
  const data=await weekend.load(req.params.id,transaction,true);race=data.race;
  if(data.version!==req.body.version)throw new Error('Das Rennwochenende wurde geändert. Bitte neu laden.');
  const action=req.params.action;
  if(req.params.driverId){const entry=data.entries.find(e=>e.roleType==='reserve'&&e.DriverId===Number(req.params.driverId));if(!entry)throw new Error('Ersatzfahrer nicht gefunden.');await entry.destroy({transaction});}
  await m.GrandPrixResultEntry.destroy({where:{GrandPrixResultId:data.race.id},transaction});
  if(action==='reset-lineup')await m.F1RaceLineupEntry.destroy({where:{GrandPrixResultId:data.race.id},transaction});
  else if(action!=='reset-results')await m.F1RaceLineupEntry.update({attendanceStatus:null,includeInResults:false,uncertainPresent:null,respondedInTime:null},{where:{GrandPrixResultId:data.race.id},transaction});
  await m.RaceEvent.update({isCompleted:false},{where:{GrandPrixResultId:data.race.id,SeasonId:data.season.id},transaction});await s.syncRanks(transaction);
 });await require('../services/championship').recalculateDriverRaceCounts();req.session.flash={type:'success',message:'Rennwochenende zur Bearbeitung geöffnet.'};}catch(error){req.session.flash={type:'error',message:error.message};}
 res.redirect(`/admin/race-weekend/lmu?season=${race?.SeasonId||''}&event=${req.params.id}`);
};
