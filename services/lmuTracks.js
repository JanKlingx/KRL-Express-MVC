const m = require('../models');
async function prepare(values) {
  const country = await m.Country.findByPk(values.CountryId);
  if (!country) throw new Error('Bitte ein Land aus dem Länderstamm auswählen.');
  values.name = String(values.name || '').trim();
  if (!values.name || values.name.length > 255) throw new Error('Bitte einen Streckennamen mit höchstens 255 Zeichen eingeben.');
  values.country = country.name;
}
async function resolveRounds(input, transaction, legacy = []) {
  const rows = Object.values(input || {});
  for (const row of rows) {
    if (row.LmuTrackId) {
      const track = await m.LmuTrack.findByPk(Number(row.LmuTrackId), { transaction });
      if (!track) throw new Error('Eine ausgewählte LMU-Strecke existiert nicht mehr.');
      row.circuit = track.name;
      row.title = String(row.title || '').trim() || track.name;
    } else if (!legacy.some(old => old.circuit === row.circuit)) {
      throw new Error('Bitte für jeden neuen Termin eine LMU-Strecke auswählen.');
    }
  }
  return require('./lmuSeason').roundsFrom(rows);
}
async function beforeRemove(track) {
  const calendars = await m.LmuCalendar.findAll();
  if (calendars.some(c => (c.rounds || []).some(r => Number(r.LmuTrackId) === track.id)) || await m.RaceEvent.count({ where: { LmuTrackId: track.id } })) {
    throw new Error('Diese Strecke wird in einem Kalender verwendet und kann deshalb nicht gelöscht werden.');
  }
}
module.exports = { prepare, resolveRounds, beforeRemove };
