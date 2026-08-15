function requireAdmin(req, res, next) {
  if (!req.session.userId || (req.session.role && req.session.role !== 'admin')) {
    req.session.flash = { type: 'error', message: 'Bitte zuerst anmelden.' };
    return res.redirect('/admin/login');
  }
  req.adminRole = 'admin';
  req.adminBasePath = '/admin';
  next();
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session.userId) return res.redirect('/admin');
  next();
}

module.exports = { requireAdmin, redirectIfAuthenticated };
