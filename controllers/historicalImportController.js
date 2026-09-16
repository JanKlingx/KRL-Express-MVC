const { randomUUID } = require('node:crypto');
const models = require('../models');
const { HEADERS, validateImport, createHistoricalSeason } = require('../services/historicalSeasonImport');
async function masters() {
  const [drivers,teams,tracks,leagues] = await Promise.all([
    models.Driver.findAll({attributes:['id','name','viewF1','roleFormerF1'],order:[['name','ASC']]}),
    models.Team.findAll({where:{discipline:'f1'},order:[['name','ASC']]}),
    models.F1Track.findAll({order:[['country','ASC'],['name','ASC']]}),
    models.League.findAll({where:{type:'f1'},order:[['name','ASC']]})
  ]);
  return {drivers:drivers.filter(driver=>driver.viewF1||driver.roleFormerF1),teams,tracks,leagues};
}
async function render(req,res,error=null,preview=null) {
  res.status(error?422:200).render('admin/historical-import',{title:'Historische F1-Saison importieren',masters:await masters(),draft:req.session.historicalImport||{},error,preview});
}
exports.show = (req,res)=>render(req,res);
exports.template = async (req,res)=>{
  const rows=require('../services/historicalWorkbook').exampleRows(await masters(),false);
  if(!rows.length)return res.status(422).send('Für die Muster-CSV bitte zuerst zwei F1-Fahrer, ein F1-Team und eine Strecke anlegen.');
  require('../services/csv').sendCsv(res,'historische-saison-muster.csv',[HEADERS,...rows]);
};
exports.workbook = async (req,res)=>{
  const buffer=await require('../services/historicalWorkbook').buildTemplate(await masters());
  res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition','attachment; filename="KRL-Saison-Vorlage.xlsx"');
  res.send(Buffer.from(buffer));
};
exports.preview = async (req,res) => {
  const draft = {name:String(req.body.name||'').trim(),leagueId:Number(req.body.leagueId),csv:String(req.body.csv||''),reservePointsForConstructors:req.body.reservePointsForConstructors==='1'};
  if (Buffer.byteLength(draft.csv)>500000) return render(req,res,'Die CSV darf höchstens 500 KB groß sein.');
  req.session.historicalImport=draft;
  try {
    if(req.importError)throw new Error(req.importError);
    if(req.file){
      if(/\.xlsx$/i.test(req.file.originalname))draft.csv=await require('../services/historicalWorkbook').workbookToCsv(req.file.buffer);
      else if(/\.csv$/i.test(req.file.originalname))draft.csv=req.file.buffer.toString('utf8');
      else throw new Error('Bitte eine .xlsx- oder .csv-Datei auswählen.');
    }
    if (!draft.name || draft.name.length>100) throw new Error('Bitte einen Saisonnamen mit 1 bis 100 Zeichen eingeben.');
    const catalog = await masters();
    if (!catalog.leagues.some(league=>Number(league.id)===draft.leagueId)) throw new Error('Bitte eine F1-Liga auswählen.');
    const plan = validateImport(draft.csv,catalog);
    const league = catalog.leagues.find(league=>Number(league.id)===draft.leagueId);
    const seasons = await models.Season.findAll({where:{leagueType:'f1',scopeSlug:league.slug}});
    if (seasons.some(season=>season.name.trim().toLocaleLowerCase('de')===draft.name.toLocaleLowerCase('de'))) throw new Error('Dieser Saisonname ist in der Liga bereits vergeben.');
    draft.token=randomUUID();draft.expiresAt=Date.now()+30*60*1000;
    return render(req,res,null,plan);
  } catch(error) { return render(req,res,error.message); }
};
exports.confirm = async (req,res) => {
  const draft=req.session.historicalImport;
  if (!draft?.token || req.body.token!==draft.token || draft.expiresAt<Date.now()) return render(req,res,'Bitte die CSV erneut prüfen. Die Vorschau ist abgelaufen oder ungültig.');
  try {
    const catalog=await masters(); const plan=validateImport(draft.csv,catalog);
    const league=catalog.leagues.find(league=>Number(league.id)===draft.leagueId);
    if (!league) throw new Error('Die Liga ist nicht mehr verfügbar.');
    const season=await models.sequelize.transaction(transaction=>createHistoricalSeason({...draft,league,plan,masters:catalog},models,transaction));
    delete req.session.historicalImport;
    req.session.flash={type:'success',message:'Historische Saison mit Kalender, Ergebnissen und Fahrerwechseln importiert.'};
    return res.redirect(`/f1/${encodeURIComponent(league.slug)}?season=${season.id}`);
  } catch(error) { return render(req,res,error.message); }
};
