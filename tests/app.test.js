const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');
const { sequelize, GrandPrixResult, GrandPrixResultEntry } = require('../models');

const publicPages = [
  ['/', 'KATZES RACING LEAGUE'],
  ['/f1/freitag', 'FAHRERFELD'],
  ['/f1/sonntag', 'TEAM-WM'],
  ['/lmu', 'COCKPITS'],
  ['/wettkampf-der-ligen', 'TEAMSTANDINGS']
];

for (const [url, expected] of publicPages) {
  test(`GET ${url}`, async () => {
    const response = await request(app).get(url);
    assert.equal(response.status, 200);
    assert.match(response.text, new RegExp(expected));
  });
}

test('Adminbereich leitet nicht angemeldete Nutzer um', async () => {
  const response = await request(app).get('/admin');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/admin/login');
});

test('Admin kann sich anmelden und Dashboard öffnen', async () => {
  const agent = request.agent(app);
  const login = await agent.post('/admin/login').type('form').send({ email: 'admin@krl.test', password: 'TestPasswort123' });
  assert.equal(login.status, 302);
  assert.equal(login.headers.location, '/admin');
  const dashboard = await agent.get('/admin');
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /ADMIN-DASHBOARD/);
});

test('Grand Prix und Klassifikation werden ohne PNG verwaltet', async () => {
  const agent = request.agent(app);
  await agent.post('/admin/login').type('form').send({ email: 'admin@krl.test', password: 'TestPasswort123' });
  const title = `Render-Funktionstest-${Date.now()}`;
  const create = await agent.post('/admin/gpResults').type('form').send({
    LeagueId: 1,
    season: 'Saison 12',
    title,
    circuit: 'Teststrecke',
    raceDate: '2026-08-15',
    sortOrder: 99
  });
  assert.equal(create.status, 302);
  const grandPrix = await GrandPrixResult.findOne({ where: { title } });
  assert.ok(grandPrix);

  const classificationResponse = await agent.post('/admin/gpResultEntries').type('form').send({
    GrandPrixResultId: grandPrix.id,
    position: 1,
    driverName: 'Testfahrer',
    teamName: 'KRL Testteam',
    points: 26,
    fastestLap: 'on',
    sortOrder: 1
  });
  assert.equal(classificationResponse.status, 302);
  const classification = await GrandPrixResultEntry.findOne({ where: { GrandPrixResultId: grandPrix.id } });
  assert.equal(classification.driverName, 'Testfahrer');
  assert.equal(classification.fastestLap, true);

  const remove = await agent.delete(`/admin/gpResults/${grandPrix.id}`);
  assert.equal(remove.status, 302);
  assert.equal(await GrandPrixResult.findByPk(grandPrix.id), null);
  assert.equal(await GrandPrixResultEntry.findByPk(classification.id), null);
});

test.after(async () => {
  await sequelize.close();
});
