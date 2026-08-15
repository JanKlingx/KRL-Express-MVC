function notFound(req, res) {
  res.status(404).render('errors/404', { title: 'Seite nicht gefunden' });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  console.error(error);
  const status = error.status || (error.name === 'MulterError' ? 400 : 500);
  res.status(status).render('errors/500', {
    title: status === 400 ? 'Ungültige Eingabe' : 'Fehler',
    message: status === 400 ? error.message : 'Die Anfrage konnte nicht verarbeitet werden.'
  });
}

module.exports = { notFound, errorHandler };
