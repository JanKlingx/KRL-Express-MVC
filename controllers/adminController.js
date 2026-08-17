const resourceConfig = require('../services/resourceConfig');
const { saveImage, deleteUpload } = require('../services/imageStorage');
const { Op } = require('sequelize');

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
    error: typeof error === 'string' ? error : error?.message || null,
    duplicateDriver: typeof error === 'object' ? error?.duplicateDriver || null : null,
    fieldOptions,
    adminBasePath: getBasePath(req),
    returnHref: config.returnHref || `${getBasePath(req)}/${resource}`
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

async function destroyEntry(config, entry) {
  const imagePath = config.upload ? entry[config.upload.field] : null;
  if (config.beforeRemove) await config.beforeRemove(entry);
  await entry.destroy();
  if (config.afterRemove) await config.afterRemove(entry);
  if (imagePath) await deleteUpload(imagePath);
}

exports.dashboard = async (req, res) => {
  const modules = Object.entries(resourceConfig).filter(([, config]) => !config.hidden);
  const counts = Object.fromEntries(await Promise.all(modules.map(async ([key, config]) => [key, await config.model.count({ where: config.getListWhere ? await config.getListWhere() : {} })])));
  const groups = modules.reduce((result, [key, config]) => {
    const group = config.group || 'Weitere Inhalte';
    const existing = result.find((entry) => entry.name === group);
    if (existing) existing.modules.push([key, config]);
    else result.push({ name: group, modules: [[key, config]] });
    return result;
  }, []);
  const progressModules = [
    ['seasonManager', { group: 'Stammdaten', href: '/admin/season-manager', title: 'Saisons verwalten / löschen', description: 'Liga wählen, Saison bearbeiten, im Frontend ausblenden oder sicher mit Kalender und Ergebnissen löschen.' }],
    ['seasonCalendar', { group: 'Stammdaten', href: '/admin/season-calendar', title: 'Rennkalender bearbeiten / löschen', description: 'Erst Liga, dann Saison: Termine inklusive Sprint und Testtag klar bearbeiten.' }],
    ['tableHub', { group: 'Frontend', href: '/admin/table-hub', title: 'Tabellen-Hub', description: 'Alle Saisonverläufe, WM-Tabellen, GP-Results und Downloads zentral erreichen.' }],
    ['f1Setup', { group: 'KRL F1 LIGA Stammdaten', href: '/admin/season-setup', title: 'Saison-Assistent F1', description: 'Spiel, Saison, Punktesystem, Kalender, Teams und Line-up schrittweise einrichten.' }],
    ['f1Rosters', { group: 'KRL F1 LIGA Stammdaten', href: '/admin/team-rosters/f1', title: 'F1-Fahrerfeld', description: 'Teams der Liga wählen und ihre Fahrer grafisch zuordnen.' }],
    ['lmuRosters', { group: 'LMU Stammdaten', href: '/admin/team-rosters/lmu', title: 'LMU-Fahrerfeld', description: 'Teams auswählen; die zugeordneten LMU-Fahrer erscheinen klar pro Team.' }],
    ['f1Weekend', { group: 'Operative Prozesse · Formel 1', href: '/admin/race-weekend/f1', title: 'Rennwochenende F1', description: 'Schritt für Schritt: Aufstellung, Anwesenheit/Strafen und Ergebnisse.' }],
    ['f1SeasonProgress', { group: 'Operative Prozesse · Formel 1', href: '/admin/race-editor', title: 'Saisonverlauf bearbeiten', description: 'Liga, Saison und Rennen wählen; historische Ergebnisse in Tabellenform pflegen.' }],
    ['wdlWeekend', { group: 'Operative Prozesse · WDL', href: '/admin/race-weekend/wdl', title: 'Rennwochenende WDL', description: 'Ligen kontrollieren, Anwesenheit dokumentieren und Ergebnisse eintragen.' }],
    ['lmuWeekend', { group: 'Operative Prozesse · LMU', href: '/admin/race-weekend/lmu', title: 'Rennwochenende LMU', description: 'Schritt für Schritt mit LMU-Fahrern, Autos und Ergebnissen.' }],
    ['lmuSeasonProgress', { group: 'Operative Prozesse · LMU', href: '/admin/season-progress/lmu', title: 'Saisonverlauf LMU', description: 'Rennen und Ergebnisse tabellarisch und saisonbezogen pflegen.' }],
    ['penaltyLedger', { group: 'Rennleitungsstammdaten', href: '/admin/penalty-ledger', title: 'Rennleitungstabelle / Strafkartei', description: 'Strafpunkte, Ablauf nach einem Jahr und Rennsperren zentral kontrollieren.' }]
  ];
  progressModules.forEach(([key, config]) => {
    const group = groups.find((entry) => entry.name === config.group);
    if (group) group.modules.unshift([key, config]);
    else groups.push({ name: config.group, modules: [[key, config]] });
  });
  const groupOrder = ['Frontend', 'Unser-Team-Stammdaten', 'KRL Icons', 'Stammdaten', 'Formel 1 Stammdaten', 'KRL F1 LIGA Stammdaten', 'LMU Stammdaten', 'Rennleitungsstammdaten', 'Operative Prozesse · Formel 1', 'Operative Prozesse · WDL', 'Operative Prozesse · LMU', 'Startseite', 'Teams', 'KRL Icons'];
  groups.sort((left, right) => groupOrder.indexOf(left.name) - groupOrder.indexOf(right.name));
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
  const selectedRank = config.rankFilters?.find((rank) => rank.value === req.query.rank);
  if (selectedRank) {
    const existingAnd = where[Op.and];
    where[Op.and] = [...(Array.isArray(existingAnd) ? existingAnd : existingAnd ? [existingAnd] : []), selectedRank.where];
  }
  let entries = await config.model.findAll({ where, order: [['sortOrder', 'ASC'], ['id', 'ASC']].filter(([field]) => config.model.rawAttributes[field]) });
  if (config.prepareEntry) entries = await Promise.all(entries.map((entry) => config.prepareEntry(entry)));
  let rankGroups = [];
  if (config.groupByRanks && config.rankFilters) {
    const ranks = selectedRank ? [selectedRank] : config.rankFilters;
    rankGroups = ranks.map((rank) => ({ ...rank, entries: entries.filter(rank.matches) })).filter((group) => group.entries.length);
    if (!selectedRank) {
      const unranked = entries.filter((entry) => !config.rankFilters.some((rank) => rank.matches(entry)));
      if (unranked.length) rankGroups.push({ value: 'unranked', label: 'Ohne Rang', entries: unranked });
    }
  }
  const fieldOptions = await getFieldOptions(config);
  res.render('admin/resource-list', {
    title: config.title,
    resource: req.params.resource,
    config,
    entries,
    fieldOptions,
    adminBasePath: getBasePath(req),
    selectedLeague: req.query.league || '',
    leagueOptions: config.filterByLeague ? await getFieldOptions({ fields: [config.fields.find((field) => field.name === 'LeagueId')] }).then((options) => options.LeagueId) : [],
    selectedRank: selectedRank?.value || '',
    rankGroups
  });
};

exports.createForm = async (req, res, next) => {
  const config = getConfig(req, req.params.resource);
  if (!config) return next();
  const defaults = config.getCreateDefaults ? await config.getCreateDefaults(req) : null;
  return renderForm(req, res, config, defaults, null);
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
    const entry = await config.model.create(values);
    if (config.afterSave) await config.afterSave(entry, req.body);
    req.session.flash = { type: 'success', message: 'Eintrag wurde gespeichert.' };
    res.redirect(config.returnHref || `${getBasePath(req)}/${req.params.resource}`);
  } catch (error) {
    if (uploadedPath) await deleteUpload(uploadedPath);
    return renderForm(req, res, config, req.body, error, 400);
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
    if (config.afterSave) await config.afterSave(entry, req.body);
    if (newPath && oldPath) await deleteUpload(oldPath);
    req.session.flash = { type: 'success', message: 'Änderungen wurden gespeichert.' };
    res.redirect(config.returnHref || `${getBasePath(req)}/${req.params.resource}`);
  } catch (error) {
    if (newPath) await deleteUpload(newPath);
    return renderForm(req, res, config, { ...entry.toJSON(), ...req.body }, error, 400);
  }
};

exports.remove = async (req, res, next) => {
  const config = getConfig(req, req.params.resource);
  if (!config) return next();
  const entry = await config.model.findByPk(req.params.id);
  if (!entry) return next();
  await destroyEntry(config, entry);
  req.session.flash = { type: 'success', message: 'Eintrag wurde gelöscht.' };
  res.redirect(config.returnHref || `${getBasePath(req)}/${req.params.resource}`);
};

exports.bulkRemove = async (req, res, next) => {
  const config = getConfig(req, req.params.resource);
  if (!config || config.bulkDelete === false) return next();
  const ids = [...new Set([].concat(req.body.ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  const returnHref = config.returnHref || `${getBasePath(req)}/${req.params.resource}`;
  if (!ids.length) {
    req.session.flash = { type: 'error', message: 'Bitte mindestens einen Eintrag zum Löschen auswählen.' };
    return res.redirect(returnHref);
  }
  const entries = await config.model.findAll({ where: { id: { [Op.in]: ids } }, order: [['id', 'ASC']] });
  for (const entry of entries) await destroyEntry(config, entry);
  req.session.flash = { type: 'success', message: `${entries.length} Einträge wurden gelöscht.` };
  res.redirect(returnHref);
};
