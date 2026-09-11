const VIEW_FIELDS = {
  f1: ['roleF1Friday', 'roleF1Saturday', 'roleF1Sunday', 'roleF1Reserve'],
  lmu: ['roleLmuRegular', 'roleLmuReserve', 'roleFormerLmu', 'lmuDisplayName', 'LmuCarId'],
  formerF1: ['roleFormerF1']
};
function driverFieldView(name) {
  if (VIEW_FIELDS.lmu.includes(name) || /Lmu$/.test(name)) return 'lmu';
  if (name === 'roleFormerF1') return 'formerF1';
  if (VIEW_FIELDS.f1.includes(name) || /F1$/.test(name)) return 'f1';
  return 'common';
}
function inferredViews(driver = {}) {
  return Object.keys(VIEW_FIELDS).filter((view) =>
    driver[{ f1: 'viewF1', lmu: 'viewLmu', formerF1: 'viewFormerF1' }[view]] ||
    VIEW_FIELDS[view].some((field) => Boolean(driver[field]))
  );
}
function applyDriverViews(values, body, existing = {}) {
  const views = [...new Set([].concat(body.driverViews || []))];
  if (!views.length || views.some((view) => !VIEW_FIELDS[view])) {
    throw new Error('Bitte mindestens eine gültige Sicht auswählen.');
  }
  for (const [view, fields] of Object.entries(VIEW_FIELDS)) {
    const flag = { f1: 'viewF1', lmu: 'viewLmu', formerF1: 'viewFormerF1' }[view];
    values[flag] = Boolean(existing[flag] || views.includes(view));
    if (!views.includes(view)) {
      for (const field of fields) values[field] = existing[field] ?? (field.startsWith('role') ? false : null);
    }
  }
  // Selecting a view never assigns a driver rank.
  return views;
}
module.exports = { VIEW_FIELDS, driverFieldView, inferredViews, applyDriverViews };
