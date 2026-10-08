const m=require('../models');
const {buildSeasonData}=require('../services/standings');
const {sendCsv}=require('../services/csv');
const {isRoundInStint}=require('../services/seasonDriverStints');
const plain=row=>row?.toJSON?row.toJSON():row;
async function loadData(requestedSeasonId,slug='lmu',canEdit=false){
 const league=await m.League.findOne({where:{slug:slug||'lmu',type:'lmu'}});if(!league)return null;
 const seasons=await m.Season.findAll({where:{leagueType:'lmu',scopeSlug:league.slug,...(canEdit?{}:{isPublished:true})},include:[{association:'category'},{association:'lmuGame'}],order:[['id','DESC']]});
 const selectedSeason=seasons.find(s=>s.id===Number(requestedSeasonId))||seasons.find(s=>s.status==='active')||seasons[0]||null;
 const [rosters,results,events,seasonTeams,stints,lineups,catalog]=await Promise.all([
  m.TeamRoster.findAll({where:{LeagueId:league.id,discipline:'lmu'},include:[{association:'team'},{association:'assignments',include:[{association:'driver',include:[{association:'aliases'},{association:'lmuCar'}]}]}],order:[['sortOrder','ASC'],['id','ASC']]}),
  selectedSeason?m.GrandPrixResult.findAll({where:{SeasonId:selectedSeason.id,LeagueId:league.id,discipline:'lmu'},include:[{association:'entries'}],order:[['sortOrder','ASC']]}):[],
  selectedSeason?m.RaceEvent.findAll({where:{SeasonId:selectedSeason.id,LeagueId:league.id,...(canEdit||selectedSeason.status==='historical'?{}:{isPublished:true})},order:[['sortOrder','ASC'],['startsAt','ASC']]}):[],
  selectedSeason?m.SeasonTeam.findAll({where:{SeasonId:selectedSeason.id},order:[['sortOrder','ASC'],['id','ASC']]}):[],
  selectedSeason?m.SeasonDriverStint.findAll({where:{SeasonId:selectedSeason.id},include:[{association:'seasonTeam'},{association:'driver',include:[{association:'aliases'},{association:'lmuCar'}]}]}):[],
  selectedSeason?m.F1RaceLineupEntry.findAll({include:[{association:'race',required:true,where:{SeasonId:selectedSeason.id,discipline:'lmu'}},{association:'driver'},{association:'team'}]}):[],
  m.Team.findAll({where:{discipline:'lmu',LeagueId:null}})
 ]);
 const gpResults=results.map(plain);const display=d=>({...plain(d),name:d.lmuDisplayName||d.name});
 const lastRound=Math.max(1,...gpResults.filter(r=>r.entries.length).map(r=>Number(r.sortOrder)));
 const nextRound=selectedSeason?.status==='historical'?lastRound:Math.max(1,...gpResults.filter(r=>r.entries.length).map(r=>Number(r.sortOrder)+1));
 const regulars=stints.filter(s=>s.roleType==='regular');
 const teams=selectedSeason?.lmuManaged?seasonTeams.map(t=>({...plain(t),id:t.sourceId,standingsColor:catalog.find(c=>c.id===t.sourceId)?.standingsColor||t.accentColor,drivers:regulars.filter(s=>s.SeasonTeamId===t.id&&isRoundInStint(s,nextRound)).map(s=>display(s.driver))})):rosters.map(r=>({...plain(r.team),drivers:r.assignments.filter(a=>a.roleName!=='Ersatzfahrer'&&a.driver).map(a=>display(a.driver))}));
 const driverMap=new Map();
 for(const stint of regulars)if(stint.driver)driverMap.set(stint.DriverId,{...display(stint.driver),team:plain(stint.seasonTeam)});
 if(!selectedSeason?.lmuManaged)for(const roster of rosters)for(const a of roster.assignments)if(a.driver&&a.roleName!=='Ersatzfahrer')driverMap.set(a.DriverId,{...display(a.driver),team:plain(roster.team)});
 // Legacy archives may have drivers no longer in the current roster.
 if(selectedSeason?.status==='historical'&&!selectedSeason.lmuManaged)for(const race of gpResults)for(const e of race.entries)if(e.DriverId&&!driverMap.has(e.DriverId))driverMap.set(e.DriverId,{id:e.DriverId,name:e.driverName,team:{name:e.teamName,logoPath:catalog.find(t=>t.id===e.TeamId)?.logoPath}});
 const leagueForSeason={...plain(league),currentSeason:selectedSeason?.name||league.currentSeason,seasonAccentColor:selectedSeason?.accentColor||league.accentColor};
 const data=buildSeasonData(leagueForSeason,gpResults,[...driverMap.values()],lineups,selectedSeason,stints);
 const calendar=events.length?events.map(event=>({...plain(event),sortOrder:gpResults.find(r=>r.id===event.GrandPrixResultId)?.sortOrder||event.sortOrder})):gpResults.filter(r=>r.raceDate).map(r=>({id:`result-${r.id}`,title:r.title,circuit:r.circuit,startsAt:new Date(r.raceDate+'T12:00:00Z')}));
 const publicResults=gpResults.map(r=>({...r,entries:r.entries.filter(e=>!['DNA','DNS','S'].includes(e.status)).sort((a,b)=>(a.position||999)-(b.position||999))}));
 const raceStatistics=gpResults.filter(r=>r.entries.length).map(r=>({round:r.sortOrder,country:r.title,date:r.raceDate,first:r.entries.find(e=>e.position===1)?.driverName,second:r.entries.find(e=>e.position===2)?.driverName,third:r.entries.find(e=>e.position===3)?.driverName,pole:r.entries.find(e=>e.polePosition)?.driverName,fastestLap:r.entries.find(e=>e.fastestLap)?.driverName,driverOfTheDay:r.entries.find(e=>e.driverOfTheDay)?.driverName}));
 return {...data,league:leagueForSeason,seasons,selectedSeason,teams,teamRosters:teams.map(team=>({team,drivers:team.drivers})),drivers:[...driverMap.values()],gpResults:publicResults,calendar,raceStatistics};
}
exports.show=async(req,res)=>{const data=await loadData(req.query.season,req.params.slug||req.query.league,Boolean(req.session?.userId&&(!req.session.role||req.session.role==='admin')));if(!data)return res.status(404).render('errors/404',{title:'LMU-Liga nicht gefunden'});res.render('lmu',{title:data.league.name,...data});};
exports.downloadStandings=async(req,res)=>{const data=await loadData(req.query.season,req.params.slug||req.query.league,Boolean(req.session?.userId&&(!req.session.role||req.session.role==='admin')));if(!data)return res.status(404).end();sendCsv(res,`lmu-${data.selectedSeason?.name||''}-wm.csv`,[['Position','Fahrer','Team','Punkte','Siege'],...data.driverStandings.map(r=>[r.position,r.driver.name,r.driver.team?.name||'',r.points,r.wins])]);};
exports.downloadResults=async(req,res)=>{const data=await loadData(req.query.season,req.params.slug||req.query.league,Boolean(req.session?.userId&&(!req.session.role||req.session.role==='admin')));if(!data)return res.status(404).end();sendCsv(res,`lmu-${data.selectedSeason?.name||''}-results.csv`,[['Rennen','Platz','Status','Fahrer','Team','Punkte'],...data.gpResults.flatMap(r=>r.entries.map(e=>[r.title,e.position||'',e.status||'',e.driverName,e.teamName||'',Number(e.points)]))]);};
exports.loadData=loadData;
