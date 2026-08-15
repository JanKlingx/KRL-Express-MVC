const multer = require('multer');

module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (file.mimetype !== 'image/png' || !file.originalname.toLowerCase().endsWith('.png')) {
      return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
    }
    callback(null, true);
  }
});
