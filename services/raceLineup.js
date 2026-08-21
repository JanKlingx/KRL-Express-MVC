const REGULAR_STATUSES = [
  { value: 'rennsperre', label: 'Rennsperre' },
  { value: 'abgemeldet', label: 'abgemeldet' },
  { value: 'unsicher', label: 'unsicher' },
  { value: 'anwesend', label: 'anwesend' }
];

const RESERVE_STATUSES = [
  { value: 'angefragt', label: 'angefragt' },
  { value: 'abgemeldet', label: 'abgemeldet' },
  { value: 'unsicher', label: 'unsicher' },
  { value: 'anwesend', label: 'anwesend' },
  { value: 'auf_abruf', label: 'auf Abruf' }
];

const ATTENDANCE_STATUSES = [
  { value: 'anwesend', label: 'Anwesend' },
  { value: 'unabgemeldet', label: 'Unabgemeldet' },
  { value: 'zu_spaet_abgemeldet', label: 'Zu spät abgemeldet' },
  { value: 'zu_spaet_vorbesprechung', label: 'Zu spät Vorbesprechung' }
];

const REGULAR_STATUS_VALUES = new Set(REGULAR_STATUSES.map((status) => status.value));
const RESERVE_STATUS_VALUES = new Set(RESERVE_STATUSES.map((status) => status.value));
const ATTENDANCE_STATUS_VALUES = new Set(ATTENDANCE_STATUSES.map((status) => status.value));

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

function normalizeAttendanceStatus(value) {
  return ATTENDANCE_STATUS_VALUES.has(value) ? value : 'anwesend';
}

function regularStarts(status) {
  return status === 'anwesend';
}

function reserveStarts(status) {
  return ['anwesend', 'auf_abruf'].includes(normalizeReserveStatus(status));
}

module.exports = {
  REGULAR_STATUSES,
  RESERVE_STATUSES,
  ATTENDANCE_STATUSES,
  normalizeAttendanceStatus,
  normalizeRegularStatus,
  normalizeReserveStatus,
  regularStarts,
  regularRoleField,
  reserveRoleField,
  reserveStarts
};
