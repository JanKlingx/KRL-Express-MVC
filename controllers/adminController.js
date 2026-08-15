const resourceConfig = require('../services/resourceConfig');
const { saveImage, deleteUpload } = require('../services/imageStorage');

function getBasePath(req) {
  return req.adminBasePath || '/admin';
}

function getConfig(req, resource) {
  return resourceConfig[resource] || null;
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
  let preparedEntry = config.prepareEntry ? await config.prepareEntry(entry) : entry;
  if (preparedEntry && config.fields.some((field) => field.type === 'datetime-local')) {
    preparedEntry = typeof preparedEntry.toJSON === 'function' ? preparedEntry.toJSON() : { ...preparedEntry };
    config.fields.filter((field) => field.type === 'datetime-local').forEach((field) => {
      if (preparedEntry[field.name]) {
        preparedEntry[field.name] = new Intl.DateTimeFormat('sv-SE', {
          timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        }).format(new Date(preparedEntry[field.name])).replace(' ', 'T');
      }
    });
  }
  return res.status(status).render('admin/resource-form', {
    title: `${config.title}: ${entry && entry.id ? 'Bearbeiten' : 'Neu'}`,
    resource,
    config,
    entry: preparedEntry,
    error,
    fieldOptions,
    adminBasePath: getBasePath(req)
  });
}

function readValues(fields, body) {
  return fields.reduce((values, field) => {
    if (field.persist === false) return values;
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
  const modules = Object.entries(resourceConfig);
  const counts = Object.fromEntries(await Promise.all(modules.map(async ([key, config]) => [key, await config.model.count({ where: config.getListWhere ? await config.getListWhere() : {} })])));
  const groups = modules.reduce((result, [key, config]) => {
    const group = config.group || 'Weitere Inhalte';
    const existing = result.find((entry) => entry.name === group);
    if (existing) existing.modules.push([key, config]);
    else result.push({ name: group, modules: [[key, config]] });
    return result;
  }, []);
  res.render('admin/dashboard', {
    title: 'Admin-Dashboard',
    groups,
    counts,
    adminBasePath: getBasePath(req),
    dashboardTitle: 'ADMIN-DASHBOARD',
    dashboardEyebrow: 'KRL & WDL VERWALTUNG',
    dashboardDescription: 'Ein Login für alle Bereiche. Saisonverlauf, GP-Results und WM-Wertungen greifen auf dieselben Renndaten zu.'
  });
};

exports.list = async (req, res, next) => {
  const config = getConfig(req, req.params.resource);
  if (!config) return next();
  const where = config.getListWhere ? await config.getListWhere() : {};
  if (config.filterByLeague && req.query.league) where.LeagueId = Number(req.query.league);
  let entries = await config.model.findAll({ where, order: [['sortOrder', 'ASC'], ['id', 'ASC']].filter(([field]) => config.model.rawAttributes[field]) });
  if (config.prepareEntry) entries = await Promise.all(entries.map((entry) => config.prepareEntry(entry)));
  const fieldOptions = await getFieldOptions(config);
  res.render('admin/resource-list', {
    title: config.title,
    resource: req.params.resource,
    config,
    entries,
    fieldOptions,
    adminBasePath: getBasePath(req),
    selectedLeague: req.query.league || '',
    leagueOptions: config.filterByLeague ? await getFieldOptions({ fields: [config.fields.find((field) => field.name === 'LeagueId')] }).then((options) => options.LeagueId) : []
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
    if (config.prepareValues) await config.prepareValues(values, req.body);
    if (config.upload) {
      if (req.file) {
        uploadedPath = await saveImage(req.file);
        values[config.upload.field] = uploadedPath;
      } else if (config.upload.required) {
        throw new Error(`${config.upload.label || 'Bild'} muss hochgeladen werden.`);
      }
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
    if (config.prepareValues) await config.prepareValues(values, req.body, entry);
    if (config.upload && req.file) {
      newPath = await saveImage(req.file);
      values[config.upload.field] = newPath;
    }
    const oldPath = config.upload ? entry[config.upload.field] : null;
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
  const imagePath = config.upload ? entry[config.upload.field] : null;
  await entry.destroy();
  if (imagePath) await deleteUpload(imagePath);
  req.session.flash = { type: 'success', message: 'Eintrag wurde gelöscht.' };
  res.redirect(`${getBasePath(req)}/${req.params.resource}`);
};
