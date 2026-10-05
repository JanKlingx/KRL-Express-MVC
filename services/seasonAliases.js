const models = require('../models');
const { Op } = require('sequelize');
const scopes = ['history', 'lineup'];
const choices = driver => [...new Set([driver.name, ...(driver.aliases || []).map(a => a.alias)].filter(Boolean))];
function validate(value, drivers, historical) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ungültige Alias-Auswahl.');
  const result = { history: {}, lineup: {} };
  for (const scope of scopes) {
    const selected = value[scope] || {};
    if (typeof selected !== 'object' || Array.isArray(selected)) throw new Error('Ungültige Alias-Auswahl.');
    if (!historical && Object.keys(selected).length && scope === 'lineup') throw new Error('Die separate Teamaufstellung ist nur historisch verfügbar.');
    for (const [id, alias] of Object.entries(selected)) {
      const driver = drivers.find(d => String(d.id) === id);
      if (!driver || !choices(driver).includes(alias)) throw new Error('Der gewählte Name gehört nicht mehr zu diesem Fahrer. Bitte die Alias-Auswahl aktualisieren.');
      if (alias !== driver.name) result[scope][id] = alias;
    }
  }
  return result;
}
async function load(season, ids) {
  const drivers = ids.length ? await models.Driver.findAll({ where: { id: { [Op.in]: [...new Set(ids)] } }, include: [{ association: 'aliases' }] }) : [];
  const stored = season?.driverDisplayNames || {};
  const selected = { history: {}, lineup: {} };
  for (const scope of scopes) for (const driver of drivers) {
    const alias = stored[scope]?.[driver.id];
    if (alias && choices(driver).includes(alias)) selected[scope][driver.id] = alias;
  }
  const name = (id, fallback, scope = 'history') => selected[scope][id] || fallback;
  return { selected, name, drivers: drivers.map(d => ({ id: d.id, name: d.name, aliases: choices(d) })) };
}
function applyStandings(data, aliases) {
  const rename = row => ({ ...row, name: aliases.name(row.id, row.name), ...(row.driver ? { driver: { ...row.driver, name: aliases.name(row.driver.id, row.driver.name) } } : {}) });
  if (data.selectedHistory) for (const key of ['drivers', 'reserveDrivers']) data.selectedHistory[key] = (data.selectedHistory[key] || []).map(rename);
  for (const key of ['driverStandings', 'reserveStandings']) data[key] = (data[key] || []).map(rename);
  for (const round of data.standingsHistory || []) round.driverStandings = (round.driverStandings || []).map(rename);
}
exports.save = async (req, res) => {
  try {
    const id = Number(req.body.driverId), scope = req.body.scope;
    if (!Number.isSafeInteger(id) || !scopes.includes(scope)) throw new Error('Ungültiger Fahrer oder Bereich.');
    await models.sequelize.transaction(async transaction => {
      const season = await models.Season.findByPk(req.params.seasonId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!season || season.leagueType !== 'f1' || !['active', 'historical'].includes(season.status)) throw new Error('Diese Saison kann nicht bearbeitet werden.');
      if (season.status === 'historical') throw new Error('Bitte die Alias-Auswahl mit dem historischen Saisonverlauf speichern.');
      const member = await models.SeasonDriver.count({ where: { SeasonId: season.id, DriverId: id }, transaction }) || await models.SeasonDriverStint.count({ where: { SeasonId: season.id, DriverId: id }, transaction }) || await models.GrandPrixResultEntry.count({ where: { DriverId: id }, include: [{ association: 'grandPrixResult', where: { SeasonId: season.id }, required: true }], transaction });
      if (!member) throw new Error('Der Fahrer gehört nicht zu dieser Saison.');
      const driver = await models.Driver.findByPk(id, { include: [{ association: 'aliases' }], transaction });
      const change = validate({ [scope]: { [id]: req.body.alias } }, driver ? [driver] : [], false);
      const selected = JSON.parse(JSON.stringify(season.driverDisplayNames || {}));
      selected[scope] ||= {};
      delete selected[scope][id];
      Object.assign(selected[scope], change[scope]);
      await season.update({ driverDisplayNames: selected }, { transaction });
    });
    res.json({ ok: true });
  } catch (error) { res.status(422).json({ error: error.message }); }
};
module.exports = { ...exports, choices, validate, load, applyStandings };
