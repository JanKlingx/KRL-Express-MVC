const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const uploadDirectory = path.join(__dirname, '..', 'public', 'uploads');

async function savePdf(file) {
  if (file?.mimetype !== 'application/pdf' || file.buffer?.subarray(0, 5).toString('ascii') !== '%PDF-') {
    const error = new Error('Bitte eine gültige PDF-Datei hochladen.');
    error.status = 400;
    throw error;
  }
  await fs.mkdir(uploadDirectory, { recursive: true });
  const filename = `${uuidv4()}.pdf`;
  await fs.writeFile(path.join(uploadDirectory, filename), file.buffer, { flag: 'wx' });
  return `/uploads/${filename}`;
}

async function deletePdf(documentPath) {
  if (!documentPath?.startsWith('/uploads/')) return;
  const filename = path.basename(documentPath);
  if (!/^[0-9a-f-]+\.pdf$/i.test(filename)) return;
  await fs.unlink(path.join(uploadDirectory, filename)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

module.exports = { savePdf, deletePdf };
