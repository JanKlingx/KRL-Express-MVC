const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const uploadDirectory = path.join(__dirname, '..', 'public', 'uploads');
const formats = [
  { mime: 'image/png', extension: 'png', matches: (buffer) => buffer?.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', extension: 'jpg', matches: (buffer) => buffer?.[0] === 0xff && buffer?.[1] === 0xd8 && buffer?.[2] === 0xff },
  { mime: 'image/webp', extension: 'webp', matches: (buffer) => buffer?.subarray(0, 4).toString() === 'RIFF' && buffer?.subarray(8, 12).toString() === 'WEBP' }
];

async function saveImage(file) {
  const format = formats.find((candidate) => candidate.mime === file?.mimetype && candidate.matches(file.buffer));
  if (!format) {
    const error = new Error('Bitte eine gültige PNG-, JPG- oder WebP-Bilddatei hochladen.');
    error.status = 400;
    throw error;
  }
  await fs.mkdir(uploadDirectory, { recursive: true });
  const filename = `${uuidv4()}.${format.extension}`;
  await fs.writeFile(path.join(uploadDirectory, filename), file.buffer, { flag: 'wx' });
  return `/uploads/${filename}`;
}

async function deleteUpload(imagePath) {
  if (!imagePath || !imagePath.startsWith('/uploads/')) return;
  const filename = path.basename(imagePath);
  if (!/^[0-9a-f-]+\.(?:png|jpe?g|webp)$/i.test(filename)) return;
  await fs.unlink(path.join(uploadDirectory, filename)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

module.exports = { saveImage, deleteUpload };
