const REGULAR_STATUSES = [
  { value: 'rennsperre', label: 'Rennsperre' },
  { value: 'unabgemeldet', label: 'unabgemeldet' },
  { value: 'zu_spaet_abgemeldet', label: 'zu spät abgemeldet' },
  { value: 'abgemeldet', label: 'abgemeldet' },
  { value: 'unsicher', label: 'unsicher' },
  { value: 'anwesend', label: 'anwesend' },
  { value: 'zu_spaet_vorbesprechung', label: 'zu spät Vorbespr.' }
];

const RESERVE_STATUSES = [
  { value: 'angefragt', label: 'angefragt' },
  { value: 'abgemeldet', label: 'abgemeldet' },
  { value: 'unsicher', label: 'unsicher' },
  { value: 'anwesend', label: 'anwesend' },
  { value: 'auf_abruf', label: 'auf Abruf' }
];

const REGULAR_STATUS_VALUES = new Set(REGULAR_STATUSES.map((status) => status.value));
const RESERVE_STATUS_VALUES = new Set(RESERVE_STATUSES.map((status) => status.value));

function reserveRoleField(leagueSlug) {
  if (leagueSlug === 'freitag') return 'roleF1ReserveFriday';
  if (leagueSlug === 'samstag') return 'roleF1ReserveSaturday';
  return 'roleF1ReserveSunday';
}

function regularRoleField(leagueSlug) {
  if (leagueSlug === 'freitag') return 'roleF1Friday';
  if (leagueSlug === 'samstag') return 'roleF1Saturday';
  return 'roleF1Sunday';
}

function normalizeRegularStatus(value) {
  return REGULAR_STATUS_VALUES.has(value) ? value : 'anwesend';
}

function normalizeReserveStatus(value) {
  return RESERVE_STATUS_VALUES.has(value) ? value : 'auf_abruf';
}

function regularStarts(status) {
  return ['anwesend', 'zu_spaet_vorbesprechung'].includes(normalizeRegularStatus(status));
}

function reserveStarts(status) {
  return ['anwesend', 'auf_abruf'].includes(normalizeReserveStatus(status));
}

module.exports = {
  REGULAR_STATUSES,
  RESERVE_STATUSES,
  normalizeRegularStatus,
  normalizeReserveStatus,
  regularStarts,
  regularRoleField,
  reserveRoleField,
  reserveStarts
};
