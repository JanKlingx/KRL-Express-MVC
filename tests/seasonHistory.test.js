const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeGoogleSheetCsvUrl,
  parseHistoryText
} = require('../services/seasonHistory');

test('Google-Sheets-Bearbeitungslink wird in einen CSV-Link umgewandelt', () => {
  const url = normalizeGoogleSheetCsvUrl('https://docs.google.com/spreadsheets/d/abc_123/edit#gid=456');
  assert.equal(url, 'https://docs.google.com/spreadsheets/d/abc_123/export?format=csv&gid=456');
});

test('Fremde Hosts werden als Datenquelle abgelehnt', () => {
  assert.throws(
    () => normalizeGoogleSheetCsvUrl('https://example.com/tabelle.csv'),
    /docs\.google\.com/
  );
});

test('Markdown-Export wird in Rennen und kumulierte Fahrerwerte umgewandelt', () => {
  const markdown = `
| **1** | **2** | |
| **BHR** | **AUS** | |
| | | | | **Saison 2** |
| **Pos** | **Fahrer** | **Team** | | | | **∑ Punkte** |
| **1.** | Fahrer A | Team A | **26** | 18 | | **44** |
| **2.** | Fahrer B | Team B | 18 | DNF | | **18** |
`;
  const [season] = parseHistoryText(markdown, 'markdown');

  assert.equal(season.name, 'Saison 2');
  assert.deepEqual(season.races, [{ round: '1', code: 'BHR' }, { round: '2', code: 'AUS' }]);
  assert.equal(season.drivers[0].total, 44);
  assert.equal(season.drivers[0].results[1].cumulative, 44);
  assert.equal(season.drivers[0].results[0].fastestLap, true);
  assert.equal(season.drivers[1].results[1].value, 'DNF');
  assert.equal(season.drivers[1].results[1].status, 'DNF');
  assert.equal(season.drivers[1].results[1].cumulative, 18);
  assert.equal(season.drivers[0].gap, 0);
  assert.equal(season.drivers[1].gap, -26);
  assert.equal(season.drivers[0].average, 22);
});
