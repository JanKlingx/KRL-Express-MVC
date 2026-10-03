const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 12 },
  fileFilter(req, file, done) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) return done(new Error('Ungültiges Bildformat.'));
    done(null, true);
  },
}).array('images', 12);
module.exports = (req, res, next) => upload(req, res, error => {
  if (!error) return next();
  req.session.flash = { type: 'error', message: 'Bitte höchstens 12 PNG-, JPG- oder WebP-Bilder mit maximal 10 MB je Bild hochladen.' };
  res.redirect(`/admin/teams/${encodeURIComponent(req.params.teamId)}/edit#team-logo-upload`);
});
