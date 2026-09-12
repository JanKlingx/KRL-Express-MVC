const { Driver, SeasonDriverStint, F1RaceLineupEntry } = require('../models');
async function registerReserveParticipation(race, records, historical, transaction) {
  const ids = [...new Set(records.filter((row) => row.roleType === 'reserve').map((row) => Number(row.DriverId)))];
  for (const id of ids) {
    // Driver lock serializes registrations of this driver across race weekends.
    const driver = await Driver.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!driver) throw new Error('Ersatzfahrer wurde nicht gefunden.');
    const stints = await SeasonDriverStint.findAll({ where: { SeasonId: race.SeasonId, DriverId: id, roleType: 'reserve' }, order: [['fromRound', 'ASC']], transaction });
    const round = Number(race.sortOrder);
    if (!Number.isInteger(round) || round < 1) throw new Error('Ungültige Rennnummer für Ersatzfahrereinsatz.');
    const covered = stints.some((stint) => round >= Number(stint.fromRound) && (stint.toRound == null || round <= Number(stint.toRound)));
    if (!covered) {
      const prior = await F1RaceLineupEntry.findAll({ where: { DriverId: id, roleType: 'reserve' }, include: [{ association: 'race', required: true, where: { SeasonId: race.SeasonId } }], transaction });
      const start = stints.length ? round : Math.min(round, ...prior.map((row) => Number(row.race.sortOrder)).filter((value) => value > 0));
      const next = stints.find((stint) => Number(stint.fromRound) > start);
      await SeasonDriverStint.create({ SeasonId: race.SeasonId, DriverId: id, SeasonTeamId: null, roleType: 'reserve', fromRound: start, toRound: next ? Number(next.fromRound) - 1 : null }, { transaction });
    }
    const ownRegularField = require('./f1DriverPolicy').REGULAR_FIELDS[race.league?.slug];
    if (!historical && !driver[ownRegularField]) await driver.update({ roleF1Reserve: true, roleFormerF1: false, viewF1: true, f1Role: 'reserve' }, { transaction });
  }
}
module.exports = { registerReserveParticipation };
