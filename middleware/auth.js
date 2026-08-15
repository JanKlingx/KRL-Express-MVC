function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    req.session.flash = { type: 'error', message: 'Bitte zuerst anmelden.' };
    return res.redirect('/admin/login');
  }
  next();
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session.userId) return res.redirect('/admin');
  next();
}

module.exports = { requireAdmin, redirectIfAuthenticated };
