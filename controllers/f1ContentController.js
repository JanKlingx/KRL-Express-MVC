const { F1RuleSection, RaceDirectorDocument } = require('../models');
const { savePdf, deletePdf } = require('../services/documentStorage');

exports.rules = async (req, res) => {
  const canEdit = Boolean(req.session?.userId && (!req.session.role || req.session.role === 'admin'));
  const editing = canEdit && req.query.edit === '1';
  const sections = await F1RuleSection.findAll({ where: canEdit ? {} : { isPublished: true }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  const { rulebookVersion } = require('../services/rulebook');
  const draft = editing ? req.session.rulebookDraft : null;
  if (editing) delete req.session.rulebookDraft;
  res.render('f1-rules', { title: 'Formel 1 Regelwerk', sections, editing, rulebookVersion: draft?.version || rulebookVersion(sections), draftSections: draft?.sections || null });
};

exports.documents = async (req, res) => {
  const documents = await RaceDirectorDocument.findAll({ order: [['publishedAt', 'DESC'], ['id', 'DESC']] });
  res.render('race-director-notes', { title: 'Race-Director Notes', documents });
};

exports.manageDocuments = async (req, res) => {
  const documents = await RaceDirectorDocument.findAll({ order: [['publishedAt', 'DESC'], ['id', 'DESC']] });
  res.render('admin/race-director-documents', { title: 'Race-Director Notes pflegen', documents });
};

exports.uploadDocument = async (req, res) => {
  if (!req.file) {
    const error = new Error('Eine PDF-Datei ist erforderlich.');
    error.status = 400;
    throw error;
  }
  const title = String(req.body.title || '').trim();
  const publishedAt = req.body.publishedAt;
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt || '')) throw new Error('Titel und Veröffentlichungsdatum sind erforderlich.');
  const documentPath = await savePdf(req.file);
  try {
    await RaceDirectorDocument.create({ title, publishedAt, documentPath });
  } catch (error) {
    await deletePdf(documentPath);
    throw error;
  }
  req.session.flash = { type: 'success', message: 'Race-Director Note wurde veröffentlicht.' };
  res.redirect('/admin/race-director-notes');
};

exports.removeDocument = async (req, res) => {
  const document = await RaceDirectorDocument.findByPk(Number(req.params.id));
  if (document) {
    const file = document.documentPath;
    await document.destroy();
    await deletePdf(file);
  }
  req.session.flash = { type: 'success', message: 'Dokument wurde gelöscht.' };
  res.redirect('/admin/race-director-notes');
};
