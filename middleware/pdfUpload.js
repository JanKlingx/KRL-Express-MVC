const multer = require('multer');

module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (file.mimetype !== 'application/pdf') return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'document'));
    callback(null, true);
  }
});
