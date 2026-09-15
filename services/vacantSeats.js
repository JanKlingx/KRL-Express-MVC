function vacantSlots(teamCards, entries = []) {
  return teamCards.flatMap(card => Array.from({ length: Math.max(0, 2 - card.rows.length) }, (_, index) => {
    const slot = card.rows.length + index + 1;
    const key = `${card.team.seasonTeamId || `team-${card.team.id}`}:${slot}`;
    return { key, slot, team: card.team, entry: entries.find(entry => entry.vacantSeat === key) || null };
  })).filter(slot => slot.team.seasonTeamId || slot.team.id);
}
function applyVacantPlan(records, input, slots) {
  const used = new Set();
  records.forEach(record => { record.vacantSeat = null; record.SeasonTeamId = null; });
  for (const [key, rawId] of Object.entries(input || {})) {
    if (!rawId) continue;
    const slot = slots.find(item => item.key === key);
    const record = records.find(row => Number(row.DriverId) === Number(rawId) && row.roleType === 'reserve');
    if (!slot || !record || record.ReplacementForDriverId || used.has(Number(rawId))) throw new Error('Ein Ersatzfahrer darf nur einem tatsächlich freien Cockpit zugeordnet werden.');
    if (!slot.team.id) throw new Error(`${slot.team.name}: Bitte das Saisonauto zuerst einem Team im Teamstamm zuordnen.`);
    if (!['anwesend', 'auf_abruf'].includes(record.status)) throw new Error('Für ein freies Cockpit bitte einen angemeldeten oder auf Abruf verfügbaren Ersatzfahrer auswählen.');
    used.add(Number(rawId)); record.vacantSeat = key; record.SeasonTeamId = slot.team.seasonTeamId || null; record.TeamId = slot.team.id;
  }
}
async function saveVacantAttendance(entries, input, transaction) {
  for (const entry of entries.filter(row => row.vacantSeat)) {
    const value = input?.[`d${entry.DriverId}`];
    if (value == null) continue;
    if (!['anwesend', 'zu_spaet_vorbesprechung', 'abgemeldet', 'unabgemeldet', 'zu_spaet_abgemeldet'].includes(value)) throw new Error('Bitte die Anwesenheit des Ersatzfahrers im freien Cockpit auswählen.');
    await entry.update({ attendanceStatus: value, includeInResults: ['anwesend', 'zu_spaet_vorbesprechung'].includes(value), uncertainPresent: entry.status === 'unsicher' ? ['anwesend', 'zu_spaet_vorbesprechung'].includes(value) : null, respondedInTime: null }, { transaction });
  }
}
module.exports = { vacantSlots, applyVacantPlan, saveVacantAttendance };
