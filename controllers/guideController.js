const {Guide}=require('../models');const {renderRichContent}=require('../services/richContent');const {saveImage,deleteUpload}=require('../services/imageStorage');
exports.index=async(req,res)=>res.render('guides',{title:'Anleitungen',guides:await Guide.findAll({order:[['title','ASC']]})});
exports.show=async(req,res)=>{
 const guide=await Guide.findOne({where:{slug:req.params.slug}});if(!guide)return res.status(404).render('errors/404',{title:'Anleitung nicht gefunden'});
 res.render('guide',{title:guide.title,guide,guideHtml:renderRichContent(guide.body),draft:req.session.guideDraft?.slug===guide.slug?req.session.guideDraft:null});
};
exports.save=async(req,res)=>{
 let image;
 try{const guide=await Guide.findOne({where:{slug:req.params.slug}});if(!guide)throw new Error('Anleitung nicht gefunden.');
 const title=String(req.body.title||'').trim();let body=String(req.body.body||'').trim();
 if(!title||title.length>180||!body||body.length>50000)throw new Error('Bitte Titel (max. 180 Zeichen) und Inhalt (max. 50.000 Zeichen) prüfen.');
 if(req.file){image=await saveImage(req.file);body+=`\n\n![Anleitungsbild](${image})`;}
 await guide.update({title,body});delete req.session.guideDraft;req.session.flash={type:'success',message:'Anleitung gespeichert.'};
 }catch(error){if(image)await deleteUpload(image);req.session.guideDraft={slug:req.params.slug,title:String(req.body.title||'').slice(0,180),body:String(req.body.body||'').slice(0,50000)};req.session.flash={type:'error',message:error.message};}
 res.redirect(`/anleitungen/${encodeURIComponent(req.params.slug)}`);
};
