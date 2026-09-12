// Numeric bracket keys are compacted by URL-encoded form parsers. Prefix database IDs.
function formRecord(records, id, prefix = 'r') {
  if (!records || typeof records !== 'object') return undefined;
  return records[`${prefix}${id}`] ?? (!Array.isArray(records) ? records[id] : undefined);
}
function dateRecords(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) return {};
  return Object.fromEntries(Object.entries(records).filter(([key, value]) => /^r?\d+$/.test(key) && typeof value === 'string').map(([key, value]) => [key.replace(/^r/, ''), value]));
}
module.exports = { formRecord, dateRecords };
