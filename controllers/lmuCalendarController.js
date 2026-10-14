const m=require('../models');
const service=require('../services/lmuCalendar');
const base='/admin/lmu-calendars';
const flash=(req,type,message)=>req.session.flash={type,message};
exports.index=async(req,res)=>{
 const [calendars,tracks]=await Promise.all([m.LmuCalendar.findAll({order:[['isActive','DESC'],['name','ASC']]}),m.LmuTrack.findAll({include:[{association:'countryRecord'}],order:[['country','ASC'],['name','ASC']]})]);
 const selected=calendars.find(c=>c.id===Number(req.query.calendar));
 const selectedCalendar=selected?{...require('../services/lmuSeason').plain(selected),rounds:service.rounds(selected).map(r=>({...r,track:tracks.find(t=>t.id===Number(r.LmuTrackId))}))}:null;
 res.render('admin/f1-calendars',{title:'Zentrale LMU-Rennkalender',calendars,tracks,selectedCalendar,creating:req.query.mode==='create',structureOpen:req.query.step==='structure',draftName:req.session.lmuCalendarDraftName||'',calendarBase:base,calendarSeries:'LMU',calendarTrackField:'LmuTrackId',calendarSetup:'/admin/lmu-season-setup',calendarSprint:false,calendarVersion:selected?service.version(selected):''});
};
exports.save=async(req,res)=>{
 let id=req.params.id;
 try{const name=String(req.body.name||'').trim();if(!name||name.length>255)throw new Error('Bitte einen Kalendernamen mit 1 bis 255 Zeichen eingeben.');
 const all=await m.LmuCalendar.findAll({attributes:['id','name']});if(all.some(c=>Number(c.id)!==Number(id)&&c.name.trim().toLowerCase()===name.toLowerCase()))throw new Error('Ein Rennkalender mit diesem Namen existiert bereits.');
 await m.sequelize.transaction(async transaction=>{const values={name,isActive:req.body.isActive==='on'};if(id){const c=await m.LmuCalendar.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});if(!c)throw new Error('Kalender nicht gefunden.');await c.update(values,{transaction});}else{id=(await m.LmuCalendar.create({...values,rounds:[]},{transaction})).id;}});
 delete req.session.lmuCalendarDraftName;flash(req,'success','Kalender gespeichert.');
 }catch(error){flash(req,'error',error.message);req.session.lmuCalendarDraftName=req.body.name;}
 res.redirect(id?`${base}?calendar=${id}&step=structure`:`${base}?mode=create`);
};
for(const [handler,operation]of [['structure','structure'],['add','add'],['removeRound','delete']])exports[handler]=async(req,res)=>{try{await service.edit(req.params.id,{...req.body,roundId:req.params.roundId},operation);flash(req,'success','Kalenderstruktur gespeichert. Bereits erstellte Saisons behalten ihre Termine.');}catch(error){flash(req,'error',error.message);}res.redirect(`${base}?calendar=${req.params.id}&step=structure`);};
