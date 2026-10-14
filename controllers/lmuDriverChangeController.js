const s=require('../services/lmuSeason');
const change=require('../services/lmuDriverChange');
const {isRoundInStint}=require('../services/seasonDriverStints');
exports.show=async(req,res)=>{
 const base=await require('./lmuAdminController').context(req.query);
 const selectedSeason=req.query.season?base.season:null;
 let data={teams:[],stints:[],drivers:[],races:[],completedRound:0};
 if(selectedSeason){await s.ensureStructure(selectedSeason.id);data=await change.context(selectedSeason.id);}
 let preview=null,previewError=null;
 if(selectedSeason&&req.query.check==='1')try{preview=await change.plan(data,{operation:req.query.operation,round:String(req.query.round||''),team:String(req.query.team||''),oldDriver:String(req.query.oldDriver||''),newDriver:String(req.query.newDriver||''),reserveDriver:String(req.query.reserveDriver||''),staysReserve:String(req.query.staysReserve||'0')});}catch(error){previewError=error.message;}
 const selectedRound=Number(req.query.round)||data.completedRound+1;
 res.render('admin/season-driver-change',{title:'LMU-Fahrerwechsel',driverChangeBase:'/admin/lmu-driver-change',driverChangeSeries:'LMU',leagues:base.leagues,seasons:base.seasons,selectedLeague:base.league,selectedSeason,completedRound:data.completedRound,selectedRound,selectedTeamId:Number(req.query.team)||null,rounds:data.races.map(r=>({round:Number(r.sortOrder),title:r.title})),stints:data.stints.map(st=>({...s.plain(st),driver:st.driver?change.display(st.driver):null})),memberships:[],eligibleMemberships:data.drivers.map(d=>({DriverId:d.id,driver:change.display(d)})),reserveDrivers:data.drivers.filter(d=>d.roleLmuReserve).map(change.display),teamSlots:data.teams.map(team=>({team,freeSeats:Math.max(0,3-data.stints.filter(st=>st.SeasonTeamId===team.id&&st.roleType==='regular'&&isRoundInStint(st,selectedRound)).length)})),preview,previewError});
};
exports.save=async(req,res)=>{try{await change.save(Number(req.body.SeasonId),req.body);req.session.flash={type:'success',message:'Fahrerwechsel gespeichert. Frühere Ergebnisse bleiben unverändert.'};}catch(error){req.session.flash={type:'error',message:error.message};}res.redirect(`/admin/lmu-driver-change?league=${Number(req.body.LeagueId)||''}&season=${Number(req.body.SeasonId)||''}`);};
