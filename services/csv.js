function escapeCell(value) {
  const text = String(value ?? '');
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createCsv(rows) {
  return `\uFEFF${rows.map((row) => row.map(escapeCell).join(';')).join('\r\n')}\r\n`;
}

function sendCsv(res, filename, rows) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename.replace(/[^a-z0-9._-]/gi, '-')}"`);
  res.send(createCsv(rows));
}

module.exports = { createCsv, sendCsv };
