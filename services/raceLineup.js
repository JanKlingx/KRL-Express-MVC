// Stammfahrer
const REGULAR_STATUSES = [
  { value: "rennsperre", label: "Rennsperre" },
  { value: "abgemeldet", label: "Abgemeldet" },
  { value: "unsicher", label: "Unsicher" },
  { value: "zu_spaet_abgemeldet", label: "Zu spät abgemeldet" },
  { value: "anwesend", label: "Anwesend" },
];

// Ersatzfahrer
const RESERVE_STATUSES = [
  { value: "angefragt", label: "Angefragt" },
  { value: "abgemeldet", label: "Abgemeldet" },
  { value: "unsicher", label: "Unsicher" },
  { value: "anwesend", label: "Anwesend" },
  { value: "zu_spaet_abgemeldet", label: "Zu spät abgemeldet" },
  { value: "auf_abruf", label: "Auf Abruf" },
];

// Tatsächliche Anwesenheit
const ATTENDANCE_STATUSES = [
  { value: "anwesend", label: "Anwesend" },
  { value: "unabgemeldet", label: "Unabgemeldet" },
  { value: "zu_spaet_abgemeldet", label: "Zu spät abgemeldet" },
  { value: "zu_spaet_vorbesprechung", label: "Zu spät Vorbesprechung" },
  { value: "unsicher", label: "Unsicher" },
];

const REGULAR_STATUS_VALUES = new Set(
  REGULAR_STATUSES.map((status) => status.value),
);

const RESERVE_STATUS_VALUES = new Set(
  RESERVE_STATUSES.map((status) => status.value),
);

const ATTENDANCE_STATUS_VALUES = new Set(
  ATTENDANCE_STATUSES.map((status) => status.value),
);

/*
 * Diese Werte werden intern durch die
 * Unsicher-Auflösung erzeugt.
 *
 * Sie sollen NICHT als Dropdown-Einträge
 * angezeigt werden, müssen aber gültige
 * attendanceStatus-Werte bleiben.
 */
const INTERNAL_ATTENDANCE_STATUS_VALUES = new Set([
  "abgemeldet",
  "rueckmeldung_unsicher",
  "fehlende_rueckmeldung_unsicher",
]);

function reserveRoleField() {
  return "roleF1Reserve";
}

function regularRoleField(leagueSlug) {
  if (leagueSlug === "freitag") return "roleF1Friday";
  if (leagueSlug === "samstag") return "roleF1Saturday";
  return "roleF1Sunday";
}

function normalizeRegularStatus(value) {
  return REGULAR_STATUS_VALUES.has(value)
    ? value
    : "anwesend";
}

function normalizeReserveStatus(value) {
  return RESERVE_STATUS_VALUES.has(value)
    ? value
    : "auf_abruf";
}

function normalizeAttendanceStatus(value) {
  if (INTERNAL_ATTENDANCE_STATUS_VALUES.has(value)) {
    return value;
  }

  return ATTENDANCE_STATUS_VALUES.has(value)
    ? value
    : "anwesend";
}

function regularStarts(status) {
  return status === "anwesend";
}

function reserveStarts(status) {
  return ["anwesend", "auf_abruf"].includes(
    normalizeReserveStatus(status),
  );
}

// Only this race's saved entries and explicitly selected candidates are planned.
function selectWeekendReserves(candidates, savedEntries, input = {}, historical = false) {
  const savedIds = new Set(savedEntries.map((entry) => Number(entry.DriverId)));
  const requestedIds = Object.keys(input).map((key) => Number(key.replace(/^d/, '')));
  const allowedIds = new Set(candidates.filter((driver) =>
    require('./f1DriverPolicy').reserveEligible(driver, historical)
  ).map((driver) => Number(driver.id)));
  if (requestedIds.some((id) => !allowedIds.has(id))) {
    throw new Error(historical ? 'Historische Ersatzfahrer benötigen einen F1-Rang und dürfen im selben Rennen kein Stammcockpit belegen.' : 'Neue Ersatzfahrer müssen den Rang „F1 Ersatz“ besitzen und dürfen hier kein Stammcockpit belegen.');
  }
  const selectedIds = new Set([...savedIds, ...requestedIds]);
  return candidates.filter((driver) => selectedIds.has(Number(driver.id)));
}

module.exports = {
  selectWeekendReserves,
  REGULAR_STATUSES,
  RESERVE_STATUSES,
  ATTENDANCE_STATUSES,
  normalizeAttendanceStatus,
  normalizeRegularStatus,
  normalizeReserveStatus,
  regularStarts,
  regularRoleField,
  reserveRoleField,
  reserveStarts,
};