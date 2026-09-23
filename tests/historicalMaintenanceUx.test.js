process.env.DB_HOST ||= 'localhost';process.env.DB_NAME ||= 'krl';process.env.DB_USER ||= 'krl';process.env.DB_PASSWORD ||= 'krl';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const models=require('../models');

test('Historical team logo replacement saves the new image; referenced season logos remain available',async t=>{
  const {saveImage,deleteUpload}=require('../services/imageStorage');
  const file={mimetype:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])};
  const oldPath=await saveImage(file);let newPath;
  t.after(async()=>{await fs.unlink(`public${oldPath}`).catch(()=>{});if(newPath)await fs.unlink(`public${newPath}`).catch(()=>{});});
  const entry={id:2,name:'Historic',BaseTeamId:1,accentColor:'#112233',logoPath:oldPath,toJSON(){return {...this};},async update(values){Object.assign(this,values);newPath=values.logoPath;}};
  t.mock.method(models.F1CarProfile,'findByPk',async()=>entry);
  t.mock.method(models.Team,'findOne',async()=>({id:1,name:'Current'}));
  t.mock.method(models.SeasonTeam,'count',async()=>1);
  let redirected;
  await require('../controllers/adminController').update({params:{resource:'f1CarProfiles',id:2},body:{name:'Historic',BaseTeamId:'1',accentColor:'#112233'},file,session:{}},{redirect:url=>{redirected=url;}},()=>{});
  assert.equal(redirected,'/admin/f1CarProfiles');assert.notEqual(newPath,oldPath);
  await fs.access(`public${newPath}`);await fs.access(`public${oldPath}`);
  await deleteUpload(oldPath);await fs.access(`public${oldPath}`);
});

test('Team search filters current and historical teams without changing selected teams',async t=>{
  const {JSDOM}=require('jsdom');
  const script=await fs.readFile('public/js/season-wizard.js','utf8');
  const dom=new JSDOM(`<div data-season-wizard data-current-step="6" data-available-step="6"><section data-setup-step="6"><div class="setup-panel-content"><form><input data-team-search><p data-team-search-empty hidden></p><label class="team-choice-card">Ferrari<input type="checkbox" name="teamTokens" checked></label><label class="team-choice-card">Renault<input type="checkbox" name="teamTokens"></label><output data-selection-count="teamTokens"></output></form></div></section></div>`,{url:'http://localhost/admin/season-setup',runScripts:'outside-only'});t.after(()=>dom.window.close());
  dom.window.eval(script);await new Promise(resolve=>dom.window.addEventListener('DOMContentLoaded',resolve));
  const d=dom.window.document,input=d.querySelector('[data-team-search]');input.value='ren';input.dispatchEvent(new dom.window.Event('input'));
  const cards=d.querySelectorAll('.team-choice-card');assert.equal(cards[0].hidden,true);assert.equal(cards[1].hidden,false);assert.equal(cards[0].querySelector('input').checked,true);assert.match(d.querySelector('output').textContent,/1 Teams/);
  input.value='missing';input.dispatchEvent(new dom.window.Event('input'));assert.equal(d.querySelector('[data-team-search-empty]').hidden,false);
});
