const { DataTypes } = require('sequelize');
const { sequelize } = require('../models');

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
}

module.exports = { ensureSchema };
