const resourceConfig = require('../services/resourceConfig');
const { savePng, deleteUpload } = require('../services/pngStorage');

function getConfig(resource) {
  return resourceConfig[resource] || null;
}

function readValues(fields, body) {
  return fields.reduce((values, field) => {
    const value = body[field.name];
    values[field.name] = value === '' || value === undefined ? null : value;
    return values;
  }, {});
}

exports.dashboard = async (req, res) => {
  const modules = Object.entries(resourceConfig);
  const counts = Object.fromEntries(await Promise.all(modules.map(async ([key, config]) => [key, await config.model.count()])));
  res.render('admin/dashboard', { title: 'Admin-Dashboard', modules, counts });
};

exports.list = async (req, res, next) => {
  const config = getConfig(req.params.resource);
  if (!config) return next();
  const entries = await config.model.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']].filter(([field]) => config.model.rawAttributes[field]) });
  res.render('admin/resource-list', { title: config.title, resource: req.params.resource, config, entries });
};

exports.createForm = (req, res, next) => {
  const config = getConfig(req.params.resource);
  if (!config) return next();
  res.render('admin/resource-form', { title: `${config.title}: Neu`, resource: req.params.resource, config, entry: null, error: null });
};

exports.create = async (req, res, next) => {
  const config = getConfig(req.params.resource);
  if (!config) return next();
  let uploadedPath;
  try {
    const values = readValues(config.fields, req.body);
    if (config.upload) {
      uploadedPath = await savePng(req.file);
      values[config.upload] = uploadedPath;
    }
    await config.model.create(values);
    req.session.flash = { type: 'success', message: 'Eintrag wurde gespeichert.' };
    res.redirect(`/admin/${req.params.resource}`);
  } catch (error) {
    if (uploadedPath) await deleteUpload(uploadedPath);
    res.status(400).render('admin/resource-form', { title: `${config.title}: Neu`, resource: req.params.resource, config, entry: req.body, error: error.message });
  }
};

exports.editForm = async (req, res, next) => {
  const config = getConfig(req.params.resource);
  if (!config) return next();
  const entry = await config.model.findByPk(req.params.id);
  if (!entry) return next();
  res.render('admin/resource-form', { title: `${config.title}: Bearbeiten`, resource: req.params.resource, config, entry, error: null });
};

exports.update = async (req, res, next) => {
  const config = getConfig(req.params.resource);
  if (!config) return next();
  const entry = await config.model.findByPk(req.params.id);
  if (!entry) return next();
  let newPath;
  try {
    const values = readValues(config.fields, req.body);
    if (config.upload && req.file) {
      newPath = await savePng(req.file);
      values[config.upload] = newPath;
    }
    const oldPath = config.upload ? entry[config.upload] : null;
    await entry.update(values);
    if (newPath && oldPath) await deleteUpload(oldPath);
    req.session.flash = { type: 'success', message: 'Änderungen wurden gespeichert.' };
    res.redirect(`/admin/${req.params.resource}`);
  } catch (error) {
    if (newPath) await deleteUpload(newPath);
    res.status(400).render('admin/resource-form', { title: `${config.title}: Bearbeiten`, resource: req.params.resource, config, entry: { ...entry.toJSON(), ...req.body }, error: error.message });
  }
};

exports.remove = async (req, res, next) => {
  const config = getConfig(req.params.resource);
  if (!config) return next();
  const entry = await config.model.findByPk(req.params.id);
  if (!entry) return next();
  const imagePath = config.upload ? entry[config.upload] : null;
  await entry.destroy();
  if (imagePath) await deleteUpload(imagePath);
  req.session.flash = { type: 'success', message: 'Eintrag wurde gelöscht.' };
  res.redirect(`/admin/${req.params.resource}`);
};
