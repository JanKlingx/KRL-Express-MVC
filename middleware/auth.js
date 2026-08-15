function requireAdmin(req, res, next) {
  if (!req.session.userId || (req.session.role && req.session.role !== 'admin')) {
    req.session.flash = { type: 'error', message: 'Bitte zuerst anmelden.' };
    return res.redirect('/admin/login');
  }
  req.adminRole = 'admin';
  req.adminBasePath = '/admin';
  next();
}

function requireWdl(req, res, next) {
  if (!req.session.userId || !['admin', 'wdl'].includes(req.session.role)) {
    req.session.flash = { type: 'error', message: 'Bitte zuerst mit dem WDL-Zugang anmelden.' };
    return res.redirect('/wdl-admin/login');
  }
  // Auch ein Gesamtadmin sieht im WDL-Bereich bewusst nur WDL-Module.
  req.adminRole = 'wdl';
  req.adminBasePath = '/wdl-admin';
  next();
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session.userId) return res.redirect(req.session.role === 'wdl' ? '/wdl-admin' : '/admin');
  next();
}

module.exports = { requireAdmin, requireWdl, redirectIfAuthenticated };
