const {NewsPost,CommunitySetting}=require('../models');
function admin(req){return Boolean(req.session?.userId&&(!req.session.role||req.session.role==='admin'));}
exports.load=async req=>({
 newsPosts:await NewsPost.findAll({where:admin(req)?{}:{isPublished:true},order:[['publishedAt','DESC'],['id','DESC']],limit:30}),
 communitySettings:await CommunitySetting.findByPk(1)||{},communityEditing:admin(req),newsDraft:req.session?.newsDraft||null
});
exports.saveNews=async(req,res)=>{
 try{
  const title=String(req.body.title||'').trim(),body=String(req.body.body||'').trim();
  if(!title||title.length>180||!body||body.length>20000)throw new Error('Bitte einen Titel (bis 180 Zeichen) und Text (bis 20.000 Zeichen) eingeben.');
  const post=req.params.id?await NewsPost.findByPk(req.params.id):null;
  if(req.params.id&&!post)throw new Error('News nicht gefunden.');
  const isPublished=req.body.isPublished==='on';const values={title,body,isPublished,publishedAt:post?.publishedAt||(isPublished?new Date():null)};
  if(post)await post.update(values);else await NewsPost.create(values);
  delete req.session.newsDraft;req.session.flash={type:'success',message:isPublished?'News veröffentlicht.':'News als Entwurf gespeichert.'};
 }catch(error){req.session.newsDraft={id:req.params.id||'',title:String(req.body.title||'').slice(0,180),body:String(req.body.body||'').slice(0,20000),isPublished:req.body.isPublished==='on'};req.session.flash={type:'error',message:error.message};}
 res.redirect('/#news');
};
exports.deleteNews=async(req,res)=>{await NewsPost.destroy({where:{id:req.params.id}});res.redirect('/#news');};
function settings(body){
 const instagramPost=String(body.instagramPost||'').trim(),discordServerId=String(body.discordServerId||'').trim();
 if(instagramPost&&!/^https:\/\/www\.instagram\.com\/(?:p|reel)\/[\w-]+\/?$/.test(instagramPost))throw new Error('Bitte einen Instagram-Beitragslink ohne Zusatzparameter verwenden.');
 if(discordServerId&&!/^\d{17,22}$/.test(discordServerId))throw new Error('Bitte die numerische Discord-Server-ID eingeben.');
 return {instagramPost,discordServerId};
}
exports.settings=settings;
exports.saveSettings=async(req,res)=>{
 try{const values=settings(req.body);await CommunitySetting.upsert({id:1,...values});req.session.flash={type:'success',message:'Social-Media-Einstellungen gespeichert.'};}
 catch(error){req.session.flash={type:'error',message:error.message};}
 res.redirect('/#social');
};
