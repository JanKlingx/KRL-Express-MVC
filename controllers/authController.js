const bcrypt = require('bcrypt');
const { User } = require('../models');

function renderLogin(res, mode, error = null, status = 200) {
  const isWdl = mode === 'wdl';
  return res.status(status).render('admin/login', {
    title: isWdl ? 'WDL-Login' : 'Admin-Login',
    error,
    loginMode: mode,
    heading: isWdl ? 'WDL-LOGIN' : 'ADMIN-LOGIN',
    eyebrow: isWdl ? 'WETTKAMPF DER LIGEN' : 'GESCHÜTZTER BEREICH',
    description: isWdl
      ? 'Verwalte ausschließlich teilnehmende Ligen und WDL-Teamstandings.'
      : 'Verwalte Fahrerfelder, Tabellen, Rennklassifikationen und Saisonverläufe.',
    action: isWdl ? '/wdl-admin/login' : '/admin/login'
  });
}

function loginForRole(expectedRole, redirectTo) {
  return async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await User.findOne({ where: { email } });
    const valid = user && user.role === expectedRole && await bcrypt.compare(String(req.body.password || ''), user.passwordHash);
    if (!valid) return renderLogin(res, expectedRole, 'E-Mail oder Passwort ist für diesen Zugang nicht gültig.', 401);

    req.session.regenerate((error) => {
      if (error) return res.status(500).render('errors/500', { title: 'Fehler', message: 'Anmeldung fehlgeschlagen.' });
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.userEmail = user.email;
      req.session.flash = { type: 'success', message: 'Erfolgreich angemeldet.' };
      res.redirect(redirectTo);
    });
  };
}

exports.loginForm = (req, res) => renderLogin(res, 'admin');
exports.wdlLoginForm = (req, res) => renderLogin(res, 'wdl');
exports.login = loginForRole('admin', '/admin');
exports.wdlLogin = loginForRole('wdl', '/wdl-admin');

exports.logout = (req, res) => req.session.destroy(() => res.redirect('/admin/login'));
exports.wdlLogout = (req, res) => req.session.destroy(() => res.redirect('/wdl-admin/login'));
