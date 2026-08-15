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
  await addMissingColumn('drivers', driverTable, 'f1_role', { type: DataTypes.STRING, allowNull: true });
  if (driverTable.league_id && driverTable.league_id.allowNull === false) {
    await queryInterface.changeColumn('drivers', 'league_id', { type: DataTypes.INTEGER, allowNull: true });
  }

  const teamTable = await queryInterface.describeTable('teams');
  await addMissingColumn('teams', teamTable, 'driver1_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('teams', teamTable, 'driver2_id', { type: DataTypes.INTEGER, allowNull: true });

  const f1Leagues = await League.findAll({ where: { type: 'f1' } });
  for (const league of f1Leagues) {
    const f1Role = league.slug === 'freitag' ? 'friday' : 'sunday';
    await sequelize.models.Driver.update({ f1Role }, { where: { LeagueId: league.id, f1Role: null } });
    const teams = await sequelize.models.Team.findAll({ where: { LeagueId: league.id } });
    for (const team of teams) {
      if (team.Driver1Id || team.Driver2Id) continue;
      const drivers = await sequelize.models.Driver.findAll({ where: { TeamId: team.id }, order: [['sortOrder', 'ASC'], ['id', 'ASC']], limit: 2 });
      await team.update({ Driver1Id: drivers[0]?.id || null, Driver2Id: drivers[1]?.id || null });
    }
  }

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
