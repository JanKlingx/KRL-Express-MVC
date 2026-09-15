const { NavigationLayout, League, sequelize } = require('../models');
const fixedPages = [
 ['/', 'Start'], ['/formel-1/strafkartei', 'Strafkartei'], ['/formel-1/regelwerk', 'Regelwerk'],
 ['/formel-1/race-director-notes', 'Race-Director Notes'], ['/krl-statistik', 'KRL-Statistik'],
 ['/krl-icons', 'KRL Icons'], ['/#team', 'Unser Team']
].map(([url,label])=>({url,label}));
function catalog(leagues) {
 return [...fixedPages, ...leagues.map(league=>({label:league.name,type:league.type,url:`/ligen/${encodeURIComponent(league.slug)}`}))];
}
function defaults(pages) {
 const f1=pages.filter(page=>page.type==='f1'||page.url.startsWith('/formel-1/'));
 const rest=pages.filter(page=>!f1.includes(page)&&page.url!=='/');
 return [{label:'Start',url:'/'},...(f1.length?[{label:'F1 Liga',children:f1.map(({label,url})=>({label,url}))}]:[]),...rest.map(({label,url})=>({label,url}))];
}
function validate(input,pages) {
 if(!Array.isArray(input)||input.length>50) throw new Error('Bitte höchstens 50 Navigationseinträge verwenden.');
 const allowed=new Set(pages.map(p=>p.url)); const used=new Set();
 function link(item) {
  if(!allowed.has(item.url)||used.has(item.url)) throw new Error('Eine Seite fehlt oder ist mehrfach zugeordnet.');
  used.add(item.url);return {label:label(item.label),url:item.url};
 }
 function label(value) { if(typeof value!=='string'||!value.trim()||value.trim().length>60) throw new Error('Bitte einen Namen mit 1 bis 60 Zeichen eingeben.');return value.trim(); }
 return input.map(item=>Array.isArray(item.children)?{label:label(item.label),children:item.children.map(link)}:link(item));
}
exports.catalog=catalog;exports.validate=validate;
exports.locals=async(req,res,next)=>{
 const [leagues,layout]=await Promise.all([League.findAll({order:[['sortOrder','ASC'],['id','ASC']]}),NavigationLayout.findByPk(1)]);
 const pages=catalog(leagues);let items=layout?JSON.parse(layout.content):defaults(pages);
 // Deleted pages disappear without breaking the rest of the menu.
 const urls=new Set(pages.map(p=>p.url));items=items.map(item=>item.children?{...item,children:item.children.filter(child=>urls.has(child.url))}:item).filter(item=>item.children?item.children.length:urls.has(item.url));
 res.locals.navigationItems=items;res.locals.navigationPages=pages;res.locals.navigationVersion=layout?.content||'';next();
};
exports.save=async(req,res)=>{
 try {
  const pages=catalog(await League.findAll());const content=JSON.stringify(validate(JSON.parse(req.body.layout),pages));
  await sequelize.transaction(async transaction=>{
   // A stable league row also serializes the first layout creation.
   await League.findAll({attributes:['id'],order:[['id','ASC']],transaction,lock:transaction.LOCK.UPDATE});
   const current=await NavigationLayout.findByPk(1,{transaction,lock:transaction.LOCK.UPDATE});
   if((current?.content||'')!==String(req.body.version||''))throw new Error('Die Navigation wurde zwischenzeitlich geändert. Bitte neu laden.');
   if(current)await current.update({content},{transaction});else await NavigationLayout.create({id:1,content},{transaction});
  });
  res.json({ok:true});
 }catch(error){res.status(400).json({error:error.message});}
};
