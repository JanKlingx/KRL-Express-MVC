const models = require('../models');
const catalog = require('./f1Teams');

// Only called while the historical season is locked. Snapshot IDs remain stable on replacement.
async function reconcile(season, choices, inputGrid, existing, transaction) {
  if (season.status !== 'historical' || season.leagueType !== 'f1') throw new Error('Teams können hier nur für historische F1-Saisons geändert werden.');
  if (!Array.isArray(choices) || !choices.length || choices.length > 11) throw new Error('Bitte 1 bis 11 Teams auswählen.');
  if (!inputGrid || !Array.isArray(inputGrid.rows) || !Array.isArray(inputGrid.lineup)) throw new Error('Die Aufstellung ist unvollständig.');
  const teams = await models.Team.findAll({ where: catalog.central, transaction });
  const byId = new Map(existing.map(team => [Number(team.id), team]));
  const keys = new Set(), identities = new Set();
  const plan = choices.map(choice => {
    const id = Number(choice.id), sourceId = Number(choice.sourceId);
    if (!Number.isInteger(id) || !id || keys.has(id) || id > 0 && !byId.has(id)) throw new Error('Ein Saisonteam fehlt oder wurde doppelt ausgewählt. Bitte neu laden.');
    const definition = teams.find(team => Number(team.id) === sourceId);
    if (!definition || identities.has(sourceId)) throw new Error('Bitte jedes Formel-1-Team höchstens einmal auswählen.');
    keys.add(id); identities.add(sourceId);
    const old = byId.get(id);
    return { id, definition, old, changed: !old || Number(old.baseTeamId) !== sourceId };
  });
  const grid = JSON.parse(JSON.stringify(inputGrid));
  for (const old of existing.filter(team => !keys.has(Number(team.id)))) {
    const inGrid = grid.lineup.some(row => Number(row.teamId) === Number(old.id)) || grid.rows.some(row => Number(row.teamId) === Number(old.id) || Object.values(row.cells || {}).some(cell => Number(cell.teamId) === Number(old.id)));
    if (inGrid || await models.SeasonLineupEntry.count({ where: { SeasonTeamId: old.id }, transaction }) || await models.SeasonDriverStint.count({ where: { SeasonTeamId: old.id }, transaction }) || await models.F1RaceLineupEntry.count({ where: { SeasonTeamId: old.id }, transaction })) {
      throw new Error(`„${old.name}“ wird noch verwendet. Wähle auf der Teamkarte ein anderes Team, um die vorhandenen Zuordnungen zu erhalten.`);
    }
  }
  // Release unique source keys temporarily so two existing teams can be swapped atomically.
  for (const item of plan.filter(item => item.old && item.changed)) {
    await models.SeasonTeam.update({ sourceType: 'current', sourceId: -item.id }, { where: { id: item.id, SeasonId: season.id }, transaction });
  }
  for (const old of existing.filter(team => !keys.has(Number(team.id)))) {
    await models.SeasonTeam.destroy({ where: { id: old.id, SeasonId: season.id }, transaction });
  }
  const ids = new Map(), result = [];
  for (const [sortOrder, item] of plan.entries()) {
    const definition = item.definition;
    const values = item.changed ? { sourceType: 'current', sourceId: definition.id, name: definition.name, accentColor: definition.accentColor || '#6ef2f2', logoPath: definition.logoPath || null, sortOrder } : { sortOrder };
    let id = item.id;
    if (item.old) {
      await models.SeasonTeam.update(values, { where: { id, SeasonId: season.id }, transaction });
      if (item.changed) await models.F1RaceLineupEntry.update({ TeamId: definition.id }, { where: { SeasonTeamId: id }, transaction });
    } else {
      id = (await models.SeasonTeam.create({ ...values, SeasonId: season.id }, { transaction })).id;
    }
    ids.set(item.id, Number(id));
    result.push({ ...item.old, ...values, id: Number(id), baseTeamId: Number(definition.id) });
  }
  const remap = value => ids.get(Number(value)) || value;
  grid.lineup.forEach(row => { row.teamId = remap(row.teamId); });
  grid.rows.forEach(row => { row.teamId = remap(row.teamId); Object.values(row.cells || {}).forEach(cell => { cell.teamId = remap(cell.teamId); }); });
  return { grid, teams: result };
}
module.exports = { reconcile };
