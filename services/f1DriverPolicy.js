const { Op } = require('sequelize');
const REGULAR_FIELDS = { freitag: 'roleF1Friday', samstag: 'roleF1Saturday', sonntag: 'roleF1Sunday' };
const F1_RANK_FIELDS = [...Object.values(REGULAR_FIELDS), 'roleF1Reserve', 'roleFormerF1'];
const hasF1View = (driver) => Boolean(driver?.viewF1 || driver?.viewFormerF1 || F1_RANK_FIELDS.some((field) => driver?.[field]));
const f1ViewWhere = { [Op.or]: ['viewF1', 'viewFormerF1', ...F1_RANK_FIELDS].map((field) => ({ [field]: true })) };
function reserveEligible(driver, historical) {
  return historical ? F1_RANK_FIELDS.some((field) => Boolean(driver?.[field])) : Boolean(driver?.roleF1Reserve);
}
function reserveWhere(historical) {
  return historical ? { [Op.or]: F1_RANK_FIELDS.map((field) => ({ [field]: true })) } : { roleF1Reserve: true };
}
function seasonRankLabel(season) {
  const league = { freitag: 'Freitag', samstag: 'Samstag', sonntag: 'Sonntag' }[season.scopeSlug] || season.scopeSlug;
  return `Stamm ${league} · ${season.name}${season.status === 'historical' ? ' (historisch)' : ''}`;
}
async function syncActivatedSeasonRanks(season) {
  if (season.leagueType !== 'f1' || season.status !== 'active' || !season.isPublished) return;
  const { sequelize, Driver, SeasonDriverStint } = require('../models');
  const field = REGULAR_FIELDS[season.scopeSlug];
  if (!field) return;
  await sequelize.transaction(async (transaction) => {
    const stints = await SeasonDriverStint.findAll({ where: { SeasonId: season.id, roleType: 'regular', toRound: null }, transaction });
    const selected = new Set(stints.map((row) => Number(row.DriverId)));
    const drivers = await Driver.findAll({ where: { [Op.or]: [{ [field]: true }, { id: { [Op.in]: [...selected] } }] }, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
    for (const driver of drivers) {
      const values = { [field]: selected.has(Number(driver.id)) };
      const merged = { ...driver.toJSON(), ...values };
      const activeFields = Object.values(REGULAR_FIELDS).filter((key) => merged[key]);
      values.roleFormerF1 = !merged.roleF1Reserve && !activeFields.length;
      values.f1Role = merged.roleF1Reserve ? 'reserve' : activeFields.length === 1 ? { roleF1Friday: 'friday', roleF1Saturday: 'saturday', roleF1Sunday: 'sunday' }[activeFields[0]] : null;
      if (selected.has(Number(driver.id))) values.viewF1 = true;
      await driver.update(values, { transaction });
    }
  });
}
module.exports = { REGULAR_FIELDS, F1_RANK_FIELDS, hasF1View, f1ViewWhere, reserveEligible, reserveWhere, seasonRankLabel, syncActivatedSeasonRanks };
