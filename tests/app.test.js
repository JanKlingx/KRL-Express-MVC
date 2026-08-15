const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const app = require('../app');
const { sequelize, GrandPrixResult } = require('../models');

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

test('Ungültige PNG-Signatur wird abgelehnt und nicht gespeichert', async () => {
  const agent = request.agent(app);
  await agent.post('/admin/login').type('form').send({ email: 'admin@krl.test', password: 'TestPasswort123' });
  const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
  const before = fs.readdirSync(uploadDir).length;
  const response = await agent.post('/admin/gpResults')
    .field('LeagueId', '1').field('season', 'Saison 12').field('title', 'Ungültig')
    .field('altText', 'Ungültige Testdatei').field('sortOrder', '99')
    .attach('image', Buffer.from('keine png datei'), { filename: 'test.png', contentType: 'image/png' });
  assert.equal(response.status, 400);
  assert.equal(fs.readdirSync(uploadDir).length, before);
});

test('Gültige PNG-Datei wird gespeichert und beim Löschen entfernt', async () => {
  const agent = request.agent(app);
  await agent.post('/admin/login').type('form').send({ email: 'admin@krl.test', password: 'TestPasswort123' });
  const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const create = await agent.post('/admin/gpResults')
    .field('LeagueId', '1').field('season', 'Saison 12').field('title', 'Upload-Funktionstest')
    .field('altText', 'Ein Pixel als Upload-Funktionstest').field('sortOrder', '99')
    .attach('image', onePixelPng, { filename: 'ergebnis.png', contentType: 'image/png' });
  assert.equal(create.status, 302);
  const entry = await GrandPrixResult.findOne({ where: { title: 'Upload-Funktionstest' } });
  assert.ok(entry);
  const absolutePath = path.join(__dirname, '..', 'public', entry.imagePath);
  assert.equal(fs.existsSync(absolutePath), true);
  const remove = await agent.delete(`/admin/gpResults/${entry.id}`);
  assert.equal(remove.status, 302);
  assert.equal(await GrandPrixResult.findByPk(entry.id), null);
  assert.equal(fs.existsSync(absolutePath), false);
});

test.after(async () => {
  await sequelize.close();
});
