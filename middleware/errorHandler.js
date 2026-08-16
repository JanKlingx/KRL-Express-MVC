function notFound(req, res) {
  res.status(404).render('errors/404', {
    title: 'Seite nicht gefunden',
    currentPath: req.path || '',
    isAdmin: Boolean(req.session?.userId),
    adminRole: req.session?.role || null,
    adminHome: '/admin',
    flash: null
  });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  console.error(error);
  const status = error.status || (error.name === 'MulterError' ? 400 : 500);
  res.status(status).render('errors/500', {
    title: status === 400 ? 'Ungültige Eingabe' : 'Fehler',
    message: status === 400 ? error.message : 'Die Anfrage konnte nicht verarbeitet werden.',
    currentPath: req.path || '',
    isAdmin: Boolean(req.session?.userId),
    adminRole: req.session?.role || null,
    adminHome: '/admin',
    flash: null
  });
}

module.exports = { notFound, errorHandler };
