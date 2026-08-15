const { DataTypes, Op } = require('sequelize');
const {
  sequelize, League, Driver, PointsRule, PointsScheme, PointAllocation,
  SeasonCategory, Season, GrandPrixResult, RaceEvent
} = require('../models');

async function addMissingColumn(table, description, name, definition) {
  if (!description[name]) await sequelize.getQueryInterface().addColumn(table, name, definition);
}

async function ensureSchema() {
  const queryInterface = sequelize.getQueryInterface();
  const driverTable = await queryInterface.describeTable('drivers');
  await addMissingColumn('drivers', driverTable, 'platform', { type: DataTypes.STRING, allowNull: false, defaultValue: 'PC' });
  await addMissingColumn('drivers', driverTable, 'participating_league_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('drivers', driverTable, 'f1_role', { type: DataTypes.STRING, allowNull: true });
  await addMissingColumn('drivers', driverTable, 'role_f1_friday', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('drivers', driverTable, 'role_f1_sunday', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('drivers', driverTable, 'role_f1_reserve', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('drivers', driverTable, 'role_former_f1', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('drivers', driverTable, 'role_lmu_regular', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('drivers', driverTable, 'role_lmu_reserve', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('drivers', driverTable, 'role_former_lmu', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('drivers', driverTable, 'races_f1', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  await addMissingColumn('drivers', driverTable, 'races_lmu', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
  if (driverTable.league_id && driverTable.league_id.allowNull === false) {
    await queryInterface.changeColumn('drivers', 'league_id', { type: DataTypes.INTEGER, allowNull: true });
  }

  const teamTable = await queryInterface.describeTable('teams');
  await addMissingColumn('teams', teamTable, 'driver1_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('teams', teamTable, 'driver2_id', { type: DataTypes.INTEGER, allowNull: true });

  const resultTable = await queryInterface.describeTable('grand_prix_results');
  await addMissingColumn('grand_prix_results', resultTable, 'season_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('grand_prix_results', resultTable, 'discipline', { type: DataTypes.STRING, allowNull: false, defaultValue: 'f1' });
  await addMissingColumn('grand_prix_results', resultTable, 'race_type', { type: DataTypes.STRING, allowNull: false, defaultValue: 'main' });
  await addMissingColumn('grand_prix_results', resultTable, 'is_historical', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  const participatingTable = await queryInterface.describeTable('participating_leagues');
  await addMissingColumn('participating_leagues', participatingTable, 'is_active', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
  await addMissingColumn('participating_leagues', participatingTable, 'f1_team_id', { type: DataTypes.INTEGER, allowNull: true });

  const f1RoundTable = await queryInterface.describeTable('f1_calendar_rounds');
  await addMissingColumn('f1_calendar_rounds', f1RoundTable, 'has_sprint', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  const wdlResultTable = await queryInterface.describeTable('wdl_result_entries');
  await addMissingColumn('wdl_result_entries', wdlResultTable, 'fastest_lap_one', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('wdl_result_entries', wdlResultTable, 'fastest_lap_two', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  const seasonTable = await queryInterface.describeTable('seasons');
  await addMissingColumn('seasons', seasonTable, 'season_category_id', { type: DataTypes.INTEGER, allowNull: true });

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
  await addMissingColumn('race_events', raceEventTable, 'season_id', { type: DataTypes.INTEGER, allowNull: true });

  const standardPoints = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  for (let index = 0; index < standardPoints.length; index += 1) {
    await PointsRule.findOrCreate({ where: { position: index + 1 }, defaults: { position: index + 1, points: standardPoints[index], sortOrder: index + 1 } });
  }

  for (const discipline of ['f1', 'lmu', 'wdl']) {
    const [scheme] = await PointsScheme.findOrCreate({
      where: { name: `Standard ${discipline.toUpperCase()}`, discipline },
      defaults: { name: `Standard ${discipline.toUpperCase()}`, discipline, fastestLapEnabled: false, fastestLapPoints: 1, sortOrder: 1 }
    });
    for (let index = 0; index < standardPoints.length; index += 1) {
      await PointAllocation.findOrCreate({
        where: { PointsSchemeId: scheme.id, raceType: 'main', position: index + 1 },
        defaults: { PointsSchemeId: scheme.id, raceType: 'main', position: index + 1, points: standardPoints[index], sortOrder: index + 1 }
      });
    }
    if (discipline === 'f1') {
      const sprintPoints = [8, 7, 6, 5, 4, 3, 2, 1];
      for (let index = 0; index < sprintPoints.length; index += 1) {
        await PointAllocation.findOrCreate({
          where: { PointsSchemeId: scheme.id, raceType: 'sprint', position: index + 1 },
          defaults: { PointsSchemeId: scheme.id, raceType: 'sprint', position: index + 1, points: sprintPoints[index], sortOrder: index + 1 }
        });
      }
    }
  }

  const leagues = await League.findAll();
  const activeSeasons = new Map();
  for (const league of leagues.filter((entry) => ['f1', 'lmu', 'competition'].includes(entry.type))) {
    const leagueType = league.type === 'competition' ? 'wdl' : league.type;
    const [season] = await Season.findOrCreate({
      where: { name: league.currentSeason, leagueType, scopeSlug: league.slug },
      defaults: { name: league.currentSeason, leagueType, scopeSlug: league.slug, status: 'active', calendarMode: 'automatic', sortOrder: 1 }
    });
    if (season.status !== 'active') await season.update({ status: 'active', calendarMode: 'automatic' });
    await Season.update({ status: 'historical' }, {
      where: { id: { [Op.ne]: season.id }, leagueType, scopeSlug: league.slug, status: 'active' }
    });
    activeSeasons.set(league.id, season);
    const [currentCategory] = await SeasonCategory.findOrCreate({
      where: { name: 'Aktuelle Saison', leagueType, scopeSlug: league.slug },
      defaults: { name: 'Aktuelle Saison', leagueType, scopeSlug: league.slug, sortOrder: 0 }
    });
    if (!season.SeasonCategoryId) await season.update({ SeasonCategoryId: currentCategory.id });
    await SeasonCategory.findOrCreate({
      where: { name: 'Ältere Saisons', leagueType, scopeSlug: league.slug },
      defaults: { name: 'Ältere Saisons', leagueType, scopeSlug: league.slug, sortOrder: 10 }
    });
  }

  const legacyResults = await GrandPrixResult.findAll({ include: [{ model: League, as: 'league' }] });
  for (const result of legacyResults) {
    const leagueType = result.league?.type === 'competition' ? 'wdl' : result.league?.type || 'f1';
    const activeSeason = activeSeasons.get(result.LeagueId);
    const isActive = activeSeason?.name === result.season;
    const [season] = isActive ? [activeSeason] : await Season.findOrCreate({
      where: { name: result.season, leagueType, scopeSlug: result.league?.slug || leagueType },
      defaults: { name: result.season, leagueType, scopeSlug: result.league?.slug || leagueType, status: 'historical', calendarMode: 'manual', sortOrder: 0 }
    });
    if (season && !season.SeasonCategoryId) {
      const category = await SeasonCategory.findOne({ where: { name: isActive ? 'Aktuelle Saison' : 'Ältere Saisons', leagueType, scopeSlug: result.league?.slug || leagueType } });
      if (category) await season.update({ SeasonCategoryId: category.id });
    }
    await result.update({ SeasonId: season?.id || null, discipline: leagueType, isHistorical: !isActive });
  }

  const uncategorizedSeasons = await Season.findAll({ where: { SeasonCategoryId: null } });
  for (const season of uncategorizedSeasons) {
    const category = await SeasonCategory.findOne({
      where: {
        name: season.status === 'active' ? 'Aktuelle Saison' : 'Ältere Saisons',
        leagueType: season.leagueType,
        scopeSlug: season.scopeSlug
      }
    });
    if (category) await season.update({ SeasonCategoryId: category.id });
  }

  const legacyEvents = await RaceEvent.findAll();
  for (const event of legacyEvents) {
    if (!event.SeasonId && activeSeasons.has(event.LeagueId)) await event.update({ SeasonId: activeSeasons.get(event.LeagueId).id });
  }

  await Driver.update({ roleF1Friday: true }, { where: { f1Role: 'friday' } });
  await Driver.update({ roleF1Sunday: true }, { where: { f1Role: 'sunday' } });
  await Driver.update({ roleF1Reserve: true }, { where: { f1Role: 'reserve' } });
  const lmuLeague = leagues.find((league) => league.type === 'lmu');
  if (lmuLeague) await Driver.update({ roleLmuRegular: true }, { where: { LeagueId: lmuLeague.id, roleLmuRegular: false, roleLmuReserve: false } });

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
