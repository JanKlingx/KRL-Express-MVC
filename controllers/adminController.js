const resourceConfig = require('../services/resourceConfig');
const { savePng, deleteUpload } = require('../services/pngStorage');

function getBasePath(req) {
  return req.adminBasePath || '/admin';
}

function getRole(req) {
  return req.adminRole || req.session.role || 'admin';
}

function canAccess(config, role) {
  return !config.roles || config.roles.includes(role);
}

function getConfig(req, resource) {
  const config = resourceConfig[resource] || null;
  return config && canAccess(config, getRole(req)) ? config : null;
}

async function getFieldOptions(config) {
  const pairs = await Promise.all(config.fields.map(async (field) => {
    if (field.choices) {
      return [field.name, field.choices.map(([value, label]) => ({ value: String(value), label }))];
    }
    if (!field.relation) return [field.name, []];

    const order = [];
    if (field.relation.model.rawAttributes.sortOrder) order.push(['sortOrder', 'ASC']);
    order.push(['id', 'ASC']);
    const rows = await field.relation.model.findAll({ where: field.relation.where, order });
    return [field.name, rows.map((row) => ({
      value: String(row.id),
      label: field.relation.formatOption(row)
    }))];
  }));
  return Object.fromEntries(pairs);
}

async function renderForm(req, res, config, entry, error, status = 200) {
  const resource = req.params.resource;
  const fieldOptions = await getFieldOptions(config);
  return res.status(status).render('admin/resource-form', {
    title: `${config.title}: ${entry && entry.id ? 'Bearbeiten' : 'Neu'}`,
    resource,
    config,
    entry,
    error,
    fieldOptions,
    adminBasePath: getBasePath(req)
  });
}

function readValues(fields, body) {
  return fields.reduce((values, field) => {
    if (field.type === 'checkbox') {
      values[field.name] = body[field.name] === 'on' || body[field.name] === 'true' || body[field.name] === '1';
      return values;
    }
    const value = body[field.name];
    values[field.name] = value === '' || value === undefined ? null : value;
    return values;
  }, {});
}

exports.dashboard = async (req, res) => {
  const role = getRole(req);
  const modules = Object.entries(resourceConfig).filter(([, config]) => canAccess(config, role));
  const counts = Object.fromEntries(await Promise.all(modules.map(async ([key, config]) => [key, await config.model.count()])));
  const groups = modules.reduce((result, [key, config]) => {
    const group = config.group || 'Weitere Inhalte';
    const existing = result.find((entry) => entry.name === group);
    if (existing) existing.modules.push([key, config]);
    else result.push({ name: group, modules: [[key, config]] });
    return result;
  }, []);
  const isWdl = role === 'wdl';
  res.render('admin/dashboard', {
    title: isWdl ? 'WDL-Verwaltung' : 'Admin-Dashboard',
    groups,
    counts,
    adminBasePath: getBasePath(req),
    dashboardTitle: isWdl ? 'WDL-VERWALTUNG' : 'ADMIN-DASHBOARD',
    dashboardEyebrow: isWdl ? 'WETTKAMPF DER LIGEN' : 'KRL VERWALTUNG',
    dashboardDescription: isWdl
      ? 'Teilnehmende Ligen und Teamstandings an einer Stelle pflegen.'
      : 'Wähle einen Bereich. Verknüpfte Datensätze werden in Formularen automatisch als Namen angezeigt.'
  });
};

exports.list = async (req, res, next) => {
  const config = getConfig(req, req.params.resource);
  if (!config) return next();
  const entries = await config.model.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']].filter(([field]) => config.model.rawAttributes[field]) });
  const fieldOptions = await getFieldOptions(config);
  res.render('admin/resource-list', {
    title: config.title,
    resource: req.params.resource,
    config,
    entries,
    fieldOptions,
    adminBasePath: getBasePath(req)
  });
};

exports.createForm = async (req, res, next) => {
  const config = getConfig(req, req.params.resource);
  if (!config) return next();
  return renderForm(req, res, config, null, null);
};

exports.create = async (req, res, next) => {
  const config = getConfig(req, req.params.resource);
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
    res.redirect(`${getBasePath(req)}/${req.params.resource}`);
  } catch (error) {
    if (uploadedPath) await deleteUpload(uploadedPath);
    return renderForm(req, res, config, req.body, error.message, 400);
  }
};

exports.editForm = async (req, res, next) => {
  const config = getConfig(req, req.params.resource);
  if (!config) return next();
  const entry = await config.model.findByPk(req.params.id);
  if (!entry) return next();
  return renderForm(req, res, config, entry, null);
};

exports.update = async (req, res, next) => {
  const config = getConfig(req, req.params.resource);
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
    res.redirect(`${getBasePath(req)}/${req.params.resource}`);
  } catch (error) {
    if (newPath) await deleteUpload(newPath);
    return renderForm(req, res, config, { ...entry.toJSON(), ...req.body }, error.message, 400);
  }
};

exports.remove = async (req, res, next) => {
  const config = getConfig(req, req.params.resource);
  if (!config) return next();
  const entry = await config.model.findByPk(req.params.id);
  if (!entry) return next();
  const imagePath = config.upload ? entry[config.upload] : null;
  await entry.destroy();
  if (imagePath) await deleteUpload(imagePath);
  req.session.flash = { type: 'success', message: 'Eintrag wurde gelöscht.' };
  res.redirect(`${getBasePath(req)}/${req.params.resource}`);
};
