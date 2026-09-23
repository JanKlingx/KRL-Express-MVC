process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl'; process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const {JSDOM} = require('jsdom');
const models = require('../models');

test('Name check recognizes normalized names and excludes the edited profile', async t => {
  const {findDuplicate} = require('../services/driverName');
  t.mock.method(models.Driver, 'findOne', async ({where}) => where.id[require('sequelize').Op.ne] !== 1 && where[require('sequelize').Op.and].logic === 'mäx' ? {id:1,name:'  Mäx  '} : null);
  assert.equal((await findDuplicate('MÄX')).id, 1);
  assert.equal(await findDuplicate('mäx',1), null);
  assert.equal(await findDuplicate('Someone else'), null);
});

test('Driver wizard stops at existing name until explicit confirmation', async () => {
  const dom = new JSDOM(`<form data-driver-wizard data-name-check-url="/admin/drivers/check-name"><label><input name="name" value="Alpha" required></label><label><input type="checkbox" name="confirmDuplicateName"></label><fieldset data-driver-view-picker><legend>Views</legend><input type="checkbox" name="driverViews" value="f1"><span data-view-error hidden></span></fieldset><div class="form-actions"><button type="submit">Save</button></div></form>`,{runScripts:'outside-only'});
  dom.window.fetch = async () => ({ok:true,json:async()=>({duplicate:{id:1,name:'Alpha'}})});
  dom.window.eval(fs.readFileSync('public/js/driver-wizard.js','utf8'));
  await new Promise(resolve=>dom.window.addEventListener('DOMContentLoaded',resolve));
  const doc=dom.window.document, next=[...doc.querySelectorAll('button')].find(b=>b.textContent==='Weiter');
  next.click(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(doc.querySelector('[data-driver-view-picker]').hidden,true);
  assert.match(doc.querySelector('.driver-name-feedback').textContent,/existiert bereits/);
  doc.querySelector('[name="confirmDuplicateName"]').checked=true;
  next.click(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(doc.querySelector('[data-driver-view-picker]').hidden,false);
  dom.window.close();
});

test('Points step preserves game and constructor setting', async t => {
  let saved;
  t.mock.method(models.Season,'findByPk',async()=>({id:1,scopeSlug:'sun',leagueType:'f1',name:'S1',accentColor:'#123456',update:async values=>{saved=values;}}));
  t.mock.method(models.League,'findOne',async()=>({id:1}));
  t.mock.method(models.PointsScheme,'findByPk',async()=>({id:2,discipline:'f1'}));
  await require('../controllers/seasonSetupController').updateSeasonProfile({params:{seasonId:1},body:{PointsSchemeId:2},session:{}},{redirect:()=>{}});
  assert.equal(saved.PointsSchemeId,2);
  assert.equal(Object.hasOwn(saved,'F1GameId'),false);
  assert.equal(Object.hasOwn(saved,'reservePointsForConstructors'),false);
});

test('Historical calendar hides both current and previous time without hiding dates', () => {
  const template=fs.readFileSync('views/partials/race-calendar.ejs','utf8');
  const data={calendar:[{id:1,startsAt:'2020-04-05T16:00:00Z',previousStartsAt:'2020-04-04T16:00:00Z',calendarChanged:true,title:'Race',sortOrder:1}],league:{},emptyMessage:'Empty',selectedSeason:{status:'historical',hideCalendarTime:true}};
  const html=ejs.render(template,data);
  assert.doesNotMatch(html,/18:00|Uhr/); assert.match(html,/2020/); assert.match(html,/Sonntag/);
  data.selectedSeason.hideCalendarTime=false;
  assert.match(ejs.render(template,data),/18:00/);
  data.selectedSeason={status:'active',hideCalendarTime:true};
  assert.match(ejs.render(template,data),/18:00/);
});
