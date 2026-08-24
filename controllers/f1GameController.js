const { Op } = require('sequelize');
const { F1Game, Season } = require('../models');
const { saveImage, deleteUpload } = require('../services/imageStorage');

function valuesFrom(body) {
  return {
    name: String(body.name || '').trim(),
    isActive: body.isActive === 'on',
    sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0
  };
}

async function renderPage(req, res, status = 200, form = null, error = null) {
  const games = await F1Game.findAll({
    include: [{ association: 'seasons', attributes: ['id', 'name', 'scopeSlug'], required: false }],
    order: [['sortOrder', 'ASC'], ['name', 'ASC']]
  });
  return res.status(status).render('admin/f1-games', {
    title: 'F1-Spiele pflegen',
    games,
    form,
    error
  });
}

exports.index = async (req, res) => {
  const form = req.query.edit ? await F1Game.findByPk(req.query.edit) : null;
  return renderPage(req, res, 200, form);
};

exports.create = async (req, res) => {
  let uploadedPath = null;
  try {
    const values = valuesFrom(req.body);
    if (!values.name) throw new Error('Bitte einen Namen für das F1-Spiel eingeben.');
    const duplicate = await F1Game.findOne({ where: { name: { [Op.eq]: values.name } } });
    if (duplicate) throw new Error(`Das F1-Spiel „${values.name}“ ist bereits vorhanden.`);
    if (req.file) uploadedPath = await saveImage(req.file);
    await F1Game.create({ ...values, logoPath: uploadedPath });
    req.session.flash = { type: 'success', message: `${values.name} wurde angelegt.` };
    return res.redirect('/admin/f1-games');
  } catch (error) {
    if (uploadedPath) await deleteUpload(uploadedPath);
    return renderPage(req, res, 422, { ...valuesFrom(req.body), id: null }, error.message);
  }
};

exports.update = async (req, res) => {
  const game = await F1Game.findByPk(req.params.id);
  if (!game) return res.status(404).render('errors/404', { title: 'F1-Spiel nicht gefunden' });
  let uploadedPath = null;
  try {
    const values = valuesFrom(req.body);
    if (!values.name) throw new Error('Bitte einen Namen für das F1-Spiel eingeben.');
    const duplicate = await F1Game.findOne({
      where: { name: values.name, id: { [Op.ne]: game.id } }
    });
    if (duplicate) throw new Error(`Das F1-Spiel „${values.name}“ ist bereits vorhanden.`);
    if (req.file) uploadedPath = await saveImage(req.file);
    const oldLogoPath = game.logoPath;
    await game.update({ ...values, logoPath: uploadedPath || oldLogoPath });
    if (uploadedPath && oldLogoPath) await deleteUpload(oldLogoPath);
    req.session.flash = { type: 'success', message: `${values.name} wurde aktualisiert.` };
    return res.redirect('/admin/f1-games');
  } catch (error) {
    if (uploadedPath) await deleteUpload(uploadedPath);
    return renderPage(req, res, 422, { ...game.toJSON(), ...valuesFrom(req.body) }, error.message);
  }
};

exports.remove = async (req, res) => {
  const game = await F1Game.findByPk(req.params.id);
  try {
    if (!game) throw new Error('Das F1-Spiel wurde nicht gefunden.');
    const seasonCount = await Season.count({ where: { F1GameId: game.id } });
    if (seasonCount) {
      throw new Error(`„${game.name}“ wird noch von ${seasonCount} Saison${seasonCount === 1 ? '' : 's'} verwendet und kann nicht gelöscht werden.`);
    }
    const logoPath = game.logoPath;
    await game.destroy();
    if (logoPath) await deleteUpload(logoPath);
    req.session.flash = { type: 'success', message: `${game.name} wurde gelöscht.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  return res.redirect('/admin/f1-games');
};
