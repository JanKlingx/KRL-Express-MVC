const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

test('GP-Ergebnis markiert Podium und DNF getrennt', async () => {
  const template = path.join(__dirname, '..', 'views', 'partials', 'gp-results.ejs');
  const html = await ejs.renderFile(template, {
    label: 'Testergebnis',
    items: [{
      season: 'Saison 12',
      title: 'Test GP',
      circuit: 'Teststrecke',
      sortOrder: 1,
      entries: [
        { position: 1, driverName: 'Sieger', teamName: 'Team A', points: 25, status: '', sortOrder: 1 },
        { position: 2, driverName: 'Zweiter', teamName: 'Team B', points: 18, status: '', sortOrder: 2 },
        { position: 3, driverName: 'Dritter', teamName: 'Team C', points: 15, status: '', sortOrder: 3 },
        { position: null, driverName: 'Ausfall', teamName: 'Team D', points: 0, status: 'DNF', sortOrder: 4 }
      ]
    }]
  });

  assert.match(html, /position-1/);
  assert.match(html, /position-2/);
  assert.match(html, /position-3/);
  assert.match(html, /status-dnf/);
  assert.match(html, />DNF</);
});

test('Saisonverlauf markiert die Top 3 in jeder Rennspalte', async () => {
  const template = path.join(__dirname, '..', 'views', 'partials', 'season-history.ejs');
  const results = [1, 2, 3].map((position) => ({ value: `P${position}`, position, points: 0, cumulative: 0, status: null, fastestLap: false }));
  const html = await ejs.renderFile(template, {
    league: { slug: 'freitag' },
    isAdmin: false,
    history: { seasons: [{}], sourceLabel: 'Admin-Saisonverlauf', warning: null },
    selectedHistory: {
      name: 'Saison 12',
      races: [{ round: 1, code: 'BHR' }],
      drivers: results.map((result, index) => ({ position: index + 1, name: `Fahrer ${index + 1}`, team: 'KRL', total: 0, gap: 0, average: 0, results: [result] }))
    }
  });
  assert.match(html, /season-race-position-1/);
  assert.match(html, /season-race-position-2/);
  assert.match(html, /season-race-position-3/);
});

test('Saisonverlauf kennzeichnet ehemalige und beförderte Fahrer verständlich', async () => {
  const template = path.join(__dirname, '..', 'views', 'partials', 'season-history.ejs');
  const dns = { value: 'DNS', position: null, points: 0, cumulative: 0, status: 'DNS', fastestLap: false };
  const html = await ejs.renderFile(template, {
    league: { slug: 'sonntag' },
    isAdmin: false,
    history: { seasons: [{}], warning: null },
    selectedHistory: {
      name: 'Saison 14',
      races: [{ round: 5, code: 'MON', hasSprint: false }],
      drivers: [{ position: 1, name: 'Marcel', team: 'Mercedes', total: 20, gap: 0, average: 4, isFormerDriver: true, regularToRound: 4, results: [{ main: dns, sprint: null }] }],
      reserveDrivers: [{ position: 1, name: 'Tobi', team: 'Mercedes', total: 16, gap: 0, average: 8, promotedToRegular: true, promotedFromRound: 5, results: [{ main: dns, sprint: null }] }]
    }
  });
  assert.match(html, /is-former-driver/);
  assert.match(html, /Ehemalig · bis R4/);
  assert.match(html, /ab R5 Stammfahrer/);
});
