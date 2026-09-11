const { Op } = require('sequelize');
const { createHash } = require('node:crypto');
const { Season, SeasonDriverStint, SeasonLineupEntry, GrandPrixResult, F1RaceLineupEntry } = require('../models');
const { futureWeekendPlan, completedRoundForSeason } = require('./seasonDriverChange');

function retirementRound(races, date) {
  if (races.some((race) => !race.raceDate)) throw new Error('Bitte zuerst die fehlenden Renndaten im Kalender ergänzen.');
  return races.find((race) => String(race.raceDate).slice(0, 10) >= date)?.sortOrder ?? null;
}
function retirementRoles(driver) {
  const activeRegular = Boolean(driver.roleF1Friday || driver.roleF1Saturday || driver.roleF1Sunday);
  const slugs = [['roleF1Friday', 'friday'], ['roleF1Saturday', 'saturday'], ['roleF1Sunday', 'sunday']].filter(([field]) => driver[field]);
  return { roleF1Reserve: false, roleF1ReserveFriday: false, roleF1ReserveSaturday: false, roleF1ReserveSunday: false, roleFormerF1: !activeRegular, viewFormerF1: !activeRegular || Boolean(driver.viewFormerF1), f1Role: slugs.length === 1 ? slugs[0][1] : null };
}
async function planReserveRetirement({ driver, seasonId, effectiveRound, transaction }) {
  if (!driver?.roleF1Reserve) throw new Error('Der Fahrer besitzt keinen aktiven F1-Ersatzrang.');
  const seasons = await Season.findAll({ where: { leagueType: 'f1', status: 'active' }, order: [['id', 'ASC']], transaction });
  const reference = seasons.find((season) => Number(season.id) === Number(seasonId));
  if (!reference) throw new Error('Ein Ersatzfahrer-Ausstieg benötigt eine aktuelle Saison.');
  const referenceRace = await GrandPrixResult.findOne({ where: { SeasonId: seasonId, discipline: 'f1', raceType: 'main', sortOrder: effectiveRound }, transaction });
  if (!referenceRace?.raceDate) throw new Error('Bitte eine vorhandene Runde mit Datum auswählen.');
  if (Number(effectiveRound) <= await completedRoundForSeason(seasonId, transaction)) throw new Error('Der Ausstieg muss nach der letzten gefahrenen Runde liegen.');
  const date = String(referenceRace.raceDate).slice(0, 10);
  const scopes = [];
  for (const season of seasons) {
    const races = await GrandPrixResult.findAll({ where: { SeasonId: season.id, discipline: 'f1', raceType: 'main' }, order: [['sortOrder', 'ASC']], transaction });
    const stints = await SeasonDriverStint.findAll({ where: { SeasonId: season.id, DriverId: driver.id, roleType: 'reserve' }, transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
    const lineups = races.length ? await F1RaceLineupEntry.findAll({ where: { GrandPrixResultId: { [Op.in]: races.map((race) => race.id) }, DriverId: driver.id, roleType: 'reserve' }, transaction }) : [];
    const membership = await SeasonLineupEntry.findOne({ where: { SeasonId: season.id, DriverId: driver.id, roleType: 'reserve' }, transaction });
    if (!stints.length && !lineups.length && !membership) continue;
    const round = Number(season.id) === Number(seasonId) ? Number(effectiveRound) : Number(retirementRound(races, date));
    if (!round) continue; // Finished seasons keep their complete history.
    const plans = await futureWeekendPlan({ seasonId: season.id, effectiveRound: round, transaction });
    if (plans.some((plan) => plan.conflict)) throw new Error(`${season.name}: Ab R${round} sind bereits Rennwochenendendaten bestätigt. Bitte zuerst zurücksetzen oder einen späteren Ausstieg wählen.`);
    scopes.push({ season, round, stints, membership, plans, hadLegacyHistory: !stints.length && lineups.some((entry) => entry.includeInResults) });
  }
  const version = createHash('sha256').update(JSON.stringify([driver.id, date, scopes.map((scope) => [scope.season.id, scope.round, scope.stints.map((s) => [s.id, s.fromRound, s.toRound]), scope.plans.map((p) => [p.race.id, p.entries.map((e) => [e.id, e.DriverId, e.roleType])])])])).digest('hex');
  return { date, scopes, version };
}
async function applyReserveRetirement({ driver, plan, transaction }) {
  for (const scope of plan.scopes) {
    for (const stint of scope.stints) {
      if (stint.toRound != null && Number(stint.toRound) < scope.round) continue;
      if (Number(stint.fromRound) >= scope.round) await stint.destroy({ transaction });
      else await stint.update({ toRound: scope.round - 1, endReason: 'left' }, { transaction });
    }
    // Legacy reserves were recorded only in weekend lineups. Preserve their earlier results
    // and introduce the missing end boundary instead of changing results into DNA records.
    if (!scope.stints.length && scope.round > 1 && (scope.hadLegacyHistory || scope.membership)) {
      await SeasonDriverStint.create({ SeasonId: scope.season.id, DriverId: driver.id, SeasonTeamId: null, roleType: 'reserve', fromRound: 1, toRound: scope.round - 1, endReason: 'left', carryReservePoints: false }, { transaction });
    }
    await SeasonLineupEntry.destroy({ where: { SeasonId: scope.season.id, DriverId: driver.id, roleType: 'reserve' }, transaction });
    for (const { race } of scope.plans) {
      await F1RaceLineupEntry.destroy({ where: { GrandPrixResultId: race.id, DriverId: driver.id, roleType: 'reserve' }, transaction });
    }
  }
  await driver.update(retirementRoles(driver), { transaction });
}
module.exports = { retirementRound, retirementRoles, planReserveRetirement, applyReserveRetirement };
