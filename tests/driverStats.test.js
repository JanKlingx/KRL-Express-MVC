const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_HOST ||= 'localhost';
process.env.DB_NAME ||= 'krl';
process.env.DB_USER ||= 'krl';
process.env.DB_PASSWORD ||= 'krl';

const { summarizeDriverEntries } = require('../services/driverStats');

test('Fahrerstatistiken trennen F1 und LMU und zählen Sprint nicht als Grand-Prix-Sieg', () => {
  const entries = [
    { position: 1, points: 25, status: null, grandPrixResult: { discipline: 'f1', raceType: 'main' } },
    { position: 2, points: 7, status: null, grandPrixResult: { discipline: 'f1', raceType: 'sprint' } },
    { position: 3, points: 15, status: null, grandPrixResult: { discipline: 'f1', raceType: 'main' } },
    { position: 1, points: 30, status: null, grandPrixResult: { discipline: 'lmu', raceType: 'main' } }
  ];
  const stats = summarizeDriverEntries(entries);
  assert.deepEqual(stats.f1, { points: 47, starts: 2, wins: 1, podium1: 1, podium2: 0, podium3: 1, winRate: 50 });
  assert.deepEqual(stats.lmu, { points: 30, starts: 1, wins: 1, podium1: 1, podium2: 0, podium3: 0, winRate: 100 });
});
