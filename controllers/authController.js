const bcrypt = require('bcrypt');
const { User } = require('../models');

exports.loginForm = (req, res) => res.render('admin/login', { title: 'Admin-Login', error: null });

exports.login = async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await User.findOne({ where: { email } });
  const valid = user && await bcrypt.compare(String(req.body.password || ''), user.passwordHash);
  if (!valid) return res.status(401).render('admin/login', { title: 'Admin-Login', error: 'E-Mail oder Passwort ist falsch.' });
  req.session.regenerate((error) => {
    if (error) return res.status(500).render('errors/500', { title: 'Fehler', message: 'Anmeldung fehlgeschlagen.' });
    req.session.userId = user.id;
    req.session.flash = { type: 'success', message: 'Erfolgreich angemeldet.' };
    res.redirect('/admin');
  });
};

exports.logout = (req, res) => req.session.destroy(() => res.redirect('/admin/login'));
