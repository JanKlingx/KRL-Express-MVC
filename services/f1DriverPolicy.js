const { Op } = require('sequelize');
const REGULAR_FIELDS = { freitag: 'roleF1Friday', samstag: 'roleF1Saturday', sonntag: 'roleF1Sunday' };
const F1_RANK_FIELDS = [...Object.values(REGULAR_FIELDS), 'roleF1Reserve', 'roleFormerF1'];
const hasF1View = (driver) => Boolean(driver?.viewF1 || driver?.viewFormerF1 || F1_RANK_FIELDS.some((field) => driver?.[field]));
const f1ViewWhere = { [Op.or]: ['viewF1', 'viewFormerF1', ...F1_RANK_FIELDS].map((field) => ({ [field]: true })) };
function reserveEligible(driver, historical) {
  return historical ? F1_RANK_FIELDS.some((field) => Boolean(driver?.[field])) : Boolean(driver?.roleF1Reserve || Object.values(REGULAR_FIELDS).some((field) => driver?.[field]));
}
function reserveWhere(historical) {
  return historical ? { [Op.or]: F1_RANK_FIELDS.map((field) => ({ [field]: true })) } : { [Op.or]: ['roleF1Reserve', ...Object.values(REGULAR_FIELDS)].map((field) => ({ [field]: true })) };
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
      const values = { [field]: selected.has(Number(driver.id)), ...(selected.has(Number(driver.id)) ? { roleF1Reserve: false } : {}) };
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


function defaultF1Values(driver, regularSlugs, reserveSlugs = []) {
  const values = Object.fromEntries(Object.entries(REGULAR_FIELDS).map(([slug, field]) => [field, regularSlugs.includes(slug)]));
  const retired = Boolean(driver.roleFormerF1 && !regularSlugs.length);
  values.roleF1Reserve = !retired && (!regularSlugs.length || reserveSlugs.some((slug) => !regularSlugs.includes(slug)));
  values.roleFormerF1 = retired;
  values.viewF1 = Boolean(driver.viewF1 || !retired);
  values.f1Role = values.roleF1Reserve ? 'reserve' : regularSlugs.length === 1 ? { freitag: 'friday', samstag: 'saturday', sonntag: 'sunday' }[regularSlugs[0]] : null;
  return values;
}

// Source of current ranks: active season seats, never legacy standalone rank flags.
async function reconcileF1Ranks() {
  const { sequelize, Driver, Season, SeasonDriverStint, F1RaceLineupEntry } = require('../models');
  await sequelize.transaction(async (transaction) => {
    const seasons = await Season.findAll({ where: { leagueType: 'f1', status: 'active' }, transaction });
    const seasonMap = new Map(seasons.map((season) => [Number(season.id), season.scopeSlug]));
    const stints = await SeasonDriverStint.findAll({ where: { SeasonId: { [Op.in]: [...seasonMap.keys()] }, roleType: 'regular', toRound: null }, transaction });
    const reserveStints = await SeasonDriverStint.findAll({ where: { SeasonId: { [Op.in]: [...seasonMap.keys()] }, roleType: 'reserve' }, transaction });
    const reserves = await F1RaceLineupEntry.findAll({ where: { roleType: 'reserve' }, include: [{ association: 'race', required: true, where: { SeasonId: { [Op.in]: [...seasonMap.keys()] } } }], transaction });
    const drivers = await Driver.findAll({ where: { [Op.or]: [f1ViewWhere, { f1Role: { [Op.in]: ['friday', 'saturday', 'sunday', 'reserve'] } }, { id: { [Op.in]: stints.map((row) => row.DriverId) } }] }, transaction, lock: transaction.LOCK.UPDATE });
    for (const driver of drivers) {
      const regularSlugs = [...new Set(stints.filter((row) => Number(row.DriverId) === Number(driver.id)).map((row) => seasonMap.get(Number(row.SeasonId))).filter(Boolean))];
      const reserveSlugs = reserves.filter((row) => {
        if (Number(row.DriverId) !== Number(driver.id)) return false;
        const periods = reserveStints.filter((stint) => Number(stint.DriverId) === Number(driver.id) && Number(stint.SeasonId) === Number(row.race.SeasonId));
        return !periods.length || periods.some((stint) => stint.toRound == null);
      }).map((row) => seasonMap.get(Number(row.race.SeasonId))).filter(Boolean);
      await driver.update(defaultF1Values(driver, regularSlugs, reserveSlugs), { transaction });
    }
  });
}
function seasonDriverEligible(driver, season, selectedIds = []) {
  return selectedIds.includes(Number(driver.id)) || (season?.status === 'historical' ? hasF1View(driver) : Boolean(driver.roleF1Reserve));
}
module.exports.defaultF1Values = defaultF1Values;
module.exports.reconcileF1Ranks = reconcileF1Ranks;
module.exports.seasonDriverEligible = seasonDriverEligible;
