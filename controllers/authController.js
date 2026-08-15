const bcrypt = require('bcrypt');
const { User } = require('../models');

function renderLogin(res, error = null, status = 200) {
  return res.status(status).render('admin/login', {
    title: 'Admin-Login',
    error,
    heading: 'ADMIN- & WDL-LOGIN',
    eyebrow: 'EIN ACCOUNT · ALLE BEREICHE',
    description: 'Verwalte KRL-Ligen, Saisonverläufe und den Wettkampf der Ligen mit demselben Account.',
    action: '/admin/login'
  });
}

exports.loginForm = (req, res) => renderLogin(res);

exports.login = async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await User.findOne({ where: { email, role: 'admin' } });
  const valid = user && await bcrypt.compare(String(req.body.password || ''), user.passwordHash);
  if (!valid) return renderLogin(res, 'E-Mail oder Passwort ist falsch.', 401);

  req.session.regenerate((error) => {
    if (error) return res.status(500).render('errors/500', { title: 'Fehler', message: 'Anmeldung fehlgeschlagen.' });
    req.session.userId = user.id;
    req.session.role = 'admin';
    req.session.userEmail = user.email;
    req.session.flash = { type: 'success', message: 'Erfolgreich angemeldet.' };
    res.redirect('/admin');
  });
};

exports.logout = (req, res) => req.session.destroy(() => res.redirect('/admin/login'));
