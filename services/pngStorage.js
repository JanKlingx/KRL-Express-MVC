const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const uploadDirectory = path.join(__dirname, '..', 'public', 'uploads');
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buffer) {
  return buffer && buffer.length >= 8 && buffer.subarray(0, 8).equals(pngSignature);
}

async function savePng(file) {
  if (!file || file.mimetype !== 'image/png' || !isPng(file.buffer)) {
    const error = new Error('Bitte ausschließlich eine gültige PNG-Datei hochladen.');
    error.status = 400;
    throw error;
  }
  await fs.mkdir(uploadDirectory, { recursive: true });
  const filename = `${uuidv4()}.png`;
  await fs.writeFile(path.join(uploadDirectory, filename), file.buffer, { flag: 'wx' });
  return `/uploads/${filename}`;
}

async function deleteUpload(imagePath) {
  if (!imagePath || !imagePath.startsWith('/uploads/')) return;
  const filename = path.basename(imagePath);
  if (!/^[0-9a-f-]+\.png$/i.test(filename)) return;
  await fs.unlink(path.join(uploadDirectory, filename)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

module.exports = { savePng, deleteUpload };
