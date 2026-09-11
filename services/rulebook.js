const { createHash } = require('node:crypto');
function rulebookVersion(sections) {
  return createHash('sha256').update(JSON.stringify(sections.map((s) => [s.id, s.sectionType, s.title, s.content, s.headingLevel || 2, Boolean(s.isPublished), s.sortOrder]))).digest('hex');
}
function parseRulebook(raw) {
  let rows;
  try { rows = JSON.parse(raw); } catch { throw new Error('Die Abschnitte konnten nicht gelesen werden. Bitte erneut öffnen.'); }
  if (!Array.isArray(rows) || rows.length > 300) throw new Error('Maximal 300 Abschnitte sind möglich.');
  const ids = new Set();
  return rows.map((row, sortOrder) => {
    const id = row.id === '' || row.id == null ? null : Number(row.id);
    if (id !== null && (!Number.isSafeInteger(id) || id < 1 || ids.has(id))) throw new Error('Ungültiger oder doppelter Abschnitt.');
    if (id) ids.add(id);
    const title = String(row.title || '').trim();
    const content = String(row.content || '').trim();
    if (!title || title.length > 255 || content.length > 50000) throw new Error('Jeder Abschnitt benötigt eine Überschrift (max. 255 Zeichen); Text maximal 50.000 Zeichen.');
    if (!['rule', 'penalty'].includes(row.sectionType) || ![2, 3, 4].includes(Number(row.headingLevel))) throw new Error('Bitte Bereich und Überschriftentyp auswählen.');
    return { id, title, content, sectionType: row.sectionType, headingLevel: Number(row.headingLevel), isPublished: row.isPublished === true, sortOrder };
  });
}
module.exports = { rulebookVersion, parseRulebook };
