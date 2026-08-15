const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { gunzip } = require('zlib');

const gunzipAsync = promisify(gunzip);

const MAX_SHEET_BYTES = 2 * 1024 * 1024;
const CACHE_MILLISECONDS = 5 * 60 * 1000;
const sheetCache = new Map();

function cleanCell(value = '') {
  return String(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\\_/g, '_')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNumber(value) {
  const normalized = cleanCell(value).replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

function parseMarkdownTable(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.trim().slice(1, -1).split('|').map((cell) => cell.trim()))
    .filter((row) => !row.every((cell) => /^\s*:?-+:?\s*$/.test(cell)));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

function parseHistoryRows(rows) {
  const seasons = [];

  for (let index = 0; index < rows.length; index += 1) {
    const season = rows[index].map(cleanCell).find((cell) => /^Saison\s+\d+$/i.test(cell));
    if (!season) continue;

    const raceNumberRow = rows[index - 2] || [];
    const raceCodeRow = rows[index - 1] || [];
    const races = [];
    for (let column = 0; column < raceCodeRow.length; column += 1) {
      const code = cleanCell(raceCodeRow[column]).toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) break;
      races.push({
        round: cleanCell(raceNumberRow[column]) || String(column + 1),
        code
      });
    }

    let headerIndex = index + 1;
    while (headerIndex < rows.length) {
      const header = rows[headerIndex].map(cleanCell);
      if (header.includes('Fahrer') && header.some((cell) => cell === 'Pos' || cell === 'Pos.')) break;
      headerIndex += 1;
    }
    if (headerIndex >= rows.length || !races.length) continue;

    const header = rows[headerIndex].map(cleanCell);
    const totalIndex = header.findIndex((cell) => /Punkte/i.test(cell) && (cell.includes('∑') || cell.toLowerCase().includes('summe')));
    const gapIndex = header.findIndex((cell) => /(?:Δ|Rückstand).*Punkte|Punkte.*(?:Δ|Rückstand)/i.test(cell));
    const averageIndex = header.findIndex((cell) => /(?:Ø|Durchschnitt).*Punkte|Punkte.*(?:Ø|Durchschnitt)/i.test(cell));
    const drivers = [];

    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const sourceRow = rows[rowIndex];
      if (sourceRow.map(cleanCell).some((cell) => /^Saison\s+\d+$/i.test(cell))) break;

      const positionMatch = cleanCell(sourceRow[0]).match(/^(\d+)\.?$/);
      if (!positionMatch) continue;
      const position = Number(positionMatch[1]);
      const name = cleanCell(sourceRow[1]);
      if (!name || /^\d+(?:\s*SP)?$/i.test(name) || position >= 90 || /^(Ersatzfahrer|Summe)$/i.test(name)) continue;

      let cumulative = 0;
      const results = races.map((race, raceIndex) => {
        const rawCell = sourceRow[raceIndex + 3] || '';
        const value = cleanCell(rawCell);
        const points = parseNumber(value);
        if (points !== null) cumulative += points;
        return {
          value,
          points: points === null ? 0 : points,
          cumulative,
          fastestLap: /\*\*/.test(rawCell),
          status: /^(DNF|DNS|DNQ|DSQ|DNA)$/i.test(value) ? value.toUpperCase() : null
        };
      });

      const total = totalIndex >= 0 ? parseNumber(sourceRow[totalIndex]) : null;
      const gap = gapIndex >= 0 ? parseNumber(sourceRow[gapIndex]) : null;
      const average = averageIndex >= 0 ? parseNumber(sourceRow[averageIndex]) : null;
      drivers.push({
        position,
        name,
        team: cleanCell(sourceRow[2]),
        total: total === null ? cumulative : total,
        gap,
        average,
        results
      });
    }

    if (drivers.length) {
      let completedRaceCount = races.length;
      while (completedRaceCount > 0 && drivers.every((driver) => !driver.results[completedRaceCount - 1].value)) {
        completedRaceCount -= 1;
      }
      const completedRaces = races.slice(0, completedRaceCount);
      drivers.forEach((driver) => { driver.results = driver.results.slice(0, completedRaceCount); });
      const leaderTotal = Math.max(...drivers.map((driver) => driver.total));
      drivers.forEach((driver) => {
        if (driver.gap === null) driver.gap = driver.total - leaderTotal;
        if (driver.average === null) driver.average = completedRaceCount ? driver.total / completedRaceCount : 0;
      });
      seasons.push({
        name: season.replace(/\s+/g, ' '),
        races: completedRaces,
        drivers: drivers.sort((left, right) => left.position - right.position)
      });
    }
  }

  return seasons.sort((left, right) => {
    const leftNumber = Number(left.name.match(/\d+/)?.[0] || 0);
    const rightNumber = Number(right.name.match(/\d+/)?.[0] || 0);
    return rightNumber - leftNumber;
  });
}

function parseHistoryText(text, format = 'csv') {
  const rows = format === 'markdown' ? parseMarkdownTable(text) : parseCsv(text);
  return parseHistoryRows(rows);
}

function normalizeGoogleSheetCsvUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') {
    throw new Error('Es sind nur öffentliche HTTPS-Links von docs.google.com erlaubt.');
  }

  const gid = url.searchParams.get('gid') || new URLSearchParams(url.hash.slice(1)).get('gid') || '0';
  const publishedMatch = url.pathname.match(/^\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)/);
  if (publishedMatch) {
    const csvUrl = new URL(`https://docs.google.com/spreadsheets/d/e/${publishedMatch[1]}/pub`);
    csvUrl.searchParams.set('output', 'csv');
    csvUrl.searchParams.set('gid', gid);
    return csvUrl.toString();
  }

  const documentMatch = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!documentMatch) throw new Error('Der Google-Sheets-Link enthält keine gültige Tabellen-ID.');
  const csvUrl = new URL(`https://docs.google.com/spreadsheets/d/${documentMatch[1]}/export`);
  csvUrl.searchParams.set('format', 'csv');
  csvUrl.searchParams.set('gid', gid);
  return csvUrl.toString();
}

async function fetchGoogleSheetHistory(sheetUrl) {
  const csvUrl = normalizeGoogleSheetCsvUrl(sheetUrl);
  const cached = sheetCache.get(csvUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.seasons;

  const response = await fetch(csvUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: { accept: 'text/csv,text/plain;q=0.9' }
  });
  if (!response.ok) throw new Error(`Google Sheets antwortet mit HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength && contentLength > MAX_SHEET_BYTES) throw new Error('Die Google-Sheets-Datei ist größer als 2 MB.');

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_SHEET_BYTES) throw new Error('Die Google-Sheets-Datei ist größer als 2 MB.');
  const seasons = parseHistoryText(text, 'csv');
  if (!seasons.length) throw new Error('Im Google Sheet wurden keine Zeilen im erwarteten Saisonformat gefunden.');

  sheetCache.set(csvUrl, { seasons, expiresAt: Date.now() + CACHE_MILLISECONDS });
  return seasons;
}

async function readBundledHistory(slug) {
  if (!/^[a-z0-9-]+$/.test(slug)) return [];
  const filePath = path.join(__dirname, '..', 'data', 'season-history', `${slug}.json.gz`);
  try {
    const compressed = await fs.readFile(filePath);
    const content = await gunzipAsync(compressed);
    return JSON.parse(content.toString('utf8')).seasons || [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function getLeagueHistory(league, historySource) {
  if (historySource?.sheetUrl) {
    try {
      const seasons = await fetchGoogleSheetHistory(historySource.sheetUrl);
      return { seasons, sourceLabel: historySource.label || 'Google Sheets', warning: null };
    } catch (error) {
      const seasons = await readBundledHistory(league.slug);
      return {
        seasons,
        sourceLabel: seasons.length ? 'Gespeicherter Tabellenstand' : null,
        warning: `Google Sheets konnte nicht aktualisiert werden: ${error.message}`
      };
    }
  }

  const seasons = await readBundledHistory(league.slug);
  return { seasons, sourceLabel: seasons.length ? 'Google-Sheets-Export' : null, warning: null };
}

module.exports = {
  getLeagueHistory,
  normalizeGoogleSheetCsvUrl,
  parseCsv,
  parseHistoryRows,
  parseHistoryText,
  parseMarkdownTable
};
