const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'krl';
process.env.DB_USER ||= 'krl'; process.env.DB_PASSWORD ||= 'krl';
const models = require('../models');
const controller = require('../controllers/f1Controller');

function leagueMocks(t, status = 'historical') {
  const season = { id: 8, name: 'Archiv 2020', status, leagueType: 'f1', scopeSlug: 'freitag', isPublished: true, historicalGrid: { rows: [], lineup: [] } };
  season.toJSON = () => ({ ...season });
  const league = { id: 1, slug: 'freitag', name: 'Freitagsliga' };
  league.toJSON = () => ({ ...league });
  t.mock.method(models.League, 'findOne', async () => league);
  t.mock.method(models.Season, 'findAll', async () => [season]);
  for (const name of ['TeamRoster', 'GrandPrixResult', 'RaceEvent', 'SeasonF1CarAssignment', 'PenaltyEntry', 'SeasonDriver', 'SeasonTeam', 'SeasonLineupEntry', 'SeasonDriverStint', 'F1RaceLineupEntry', 'Driver']) {
    t.mock.method(models[name], 'findAll', async () => []);
  }
  t.mock.method(models.F1PenaltySetting, 'findOne', async () => null);
  return season;
}

for (const isAdmin of [true, false]) {
  test(`Ligaseite ohne aktuelle Saison lädt für ${isAdmin ? 'Admins' : 'Gäste'}`, async t => {
    const season = leagueMocks(t);
    const teams = [{ id: 3, name: 'Sauber', logoPath: '/sauber.png' }];
    const query = t.mock.method(models.Team, 'findAll', async options => {
      assert.deepEqual(options.where, { LeagueId: null, discipline: 'f1' });
      return teams;
    });
    let rendered;
    await controller.show({ params: { slug: 'freitag' }, query: {} }, {
      locals: { isAdmin }, render(view, data) { assert.equal(view, 'f1'); rendered = data; },
    });
    assert.equal(rendered.selectedSeason.id, season.id);
    assert.equal(rendered.selectedSeason.status, 'historical');
    assert.deepEqual(rendered.historicalEditor.grid, season.historicalGrid);
    assert.equal(query.mock.callCount(), isAdmin ? 1 : 0);
    assert.deepEqual(rendered.historicalEditor.teamCatalog, isAdmin ? teams : undefined);
  });
}

test('Aktuelle Saison benötigt keinen historischen Teamkatalog', async t => {
  leagueMocks(t, 'active');
  t.mock.method(models.Team, 'findAll', async () => assert.fail('Kein historischer Teamkatalog'));
  let rendered;
  await controller.show({ params: { slug: 'freitag' }, query: {} }, { locals: { isAdmin: true }, render(view, data) { rendered = data; } });
  assert.equal(rendered.selectedSeason.status, 'active');
  assert.ok(!rendered.historicalEditor);
});
