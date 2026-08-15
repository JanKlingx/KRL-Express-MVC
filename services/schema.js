const { DataTypes } = require('sequelize');
const { sequelize, League, GrandPrixResult, RaceEvent } = require('../models');

async function addMissingColumn(table, description, name, definition) {
  if (!description[name]) await sequelize.getQueryInterface().addColumn(table, name, definition);
}

async function ensureSchema() {
  const queryInterface = sequelize.getQueryInterface();
  const driverTable = await queryInterface.describeTable('drivers');
  await addMissingColumn('drivers', driverTable, 'platform', { type: DataTypes.STRING, allowNull: false, defaultValue: 'PC' });
  await addMissingColumn('drivers', driverTable, 'participating_league_id', { type: DataTypes.INTEGER, allowNull: true });

  const entryTable = await queryInterface.describeTable('grand_prix_result_entries');
  await addMissingColumn('grand_prix_result_entries', entryTable, 'driver_id', { type: DataTypes.INTEGER, allowNull: true });

  const cockpitTable = await queryInterface.describeTable('lmu_cockpits');
  await addMissingColumn('lmu_cockpits', cockpitTable, 'driver1_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('lmu_cockpits', cockpitTable, 'driver2_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('lmu_cockpits', cockpitTable, 'driver3_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('lmu_cockpits', cockpitTable, 'reserve_driver_id', { type: DataTypes.INTEGER, allowNull: true });

  const competitionTable = await queryInterface.describeTable('league_competition_standings');
  await addMissingColumn('league_competition_standings', competitionTable, 'driver1_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('league_competition_standings', competitionTable, 'driver2_id', { type: DataTypes.INTEGER, allowNull: true });

  const raceEventTable = await queryInterface.describeTable('race_events');
  await addMissingColumn('race_events', raceEventTable, 'grand_prix_result_id', { type: DataTypes.INTEGER, allowNull: true });

  const unlinkedF1Events = await RaceEvent.findAll({
    where: { GrandPrixResultId: null },
    include: [{ model: League, as: 'league', where: { type: 'f1' } }]
  });
  for (const event of unlinkedF1Events) {
    const [grandPrix] = await GrandPrixResult.findOrCreate({
      where: { LeagueId: event.LeagueId, season: event.league.currentSeason, title: event.title },
      defaults: {
        LeagueId: event.LeagueId,
        season: event.league.currentSeason,
        title: event.title,
        circuit: event.circuit,
        raceDate: event.startsAt,
        sortOrder: event.sortOrder
      }
    });
    await event.update({ GrandPrixResultId: grandPrix.id });
  }
}

module.exports = { ensureSchema };
