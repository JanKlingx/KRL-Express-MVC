function localDateTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).replace(' ', 'T');
}
function parseBerlinDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value))) throw new Error('Bitte ein gültiges Datum und eine Startzeit eingeben.');
  const target = Date.parse(value + ':00Z');
  if (!Number.isFinite(target)) throw new Error('Ungültiger Termin.');
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const displayed = Date.parse(localDateTime(new Date(instant)) + ':00Z');
    instant += target - displayed;
  }
  const date = new Date(instant);
  if (localDateTime(date) !== value) throw new Error('Dieser Termin existiert nicht, etwa wegen der Zeitumstellung. Bitte eine andere Uhrzeit wählen.');
  return date;
}
module.exports = { localDateTime, parseBerlinDateTime };
