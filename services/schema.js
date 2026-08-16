const { DataTypes, Op } = require('sequelize');
const {
  sequelize, League, Team, TeamRoster, TeamRosterDriver, Driver, PointsRule, PointsScheme, PointAllocation,
  SeasonCategory, Season, GrandPrixResult, RaceEvent, LmuCockpit
} = require('../models');

async function addMissingColumn(table, description, name, definition) {
  if (!description[name]) await sequelize.getQueryInterface().addColumn(table, name, definition);
}

async function ensureSchema() {
  const queryInterface = sequelize.getQueryInterface();
  const driverTable = await queryInterface.describeTable('drivers');
  const hadFridayReserveRole = Boolean(driverTable.role_f1_reserve_friday);
  const hadSundayReserveRole = Boolean(driverTable.role_f1_reserve_sunday);
  await addMissingColumn('drivers', driverTable, 'platform', { type: DataTypes.STRING, allowNull: false, defaultValue: 'PC' });
  await addMissingColumn('drivers', driverTable, 'lmu_display_name', { type: DataTypes.STRING, allowNull: true });
  await addMissingColumn('drivers', driverTable, 'lmu_car_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('drivers', driverTable, 'participating_league_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('drivers', driverTable, 'f1_role', { type: DataTypes.STRING, allowNull: true });
  await addMissingColumn('drivers', driverTable, 'role_f1_friday', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('drivers', driverTable, 'role_f1_sunday', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('drivers', driverTable, 'role_f1_reserve', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('drivers', driverTable, 'role_f1_reserve_friday', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('drivers', driverTable, 'role_f1_reserve_sunday', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
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
  if (teamTable.league_id && teamTable.league_id.allowNull === false) {
    await queryInterface.changeColumn('teams', 'league_id', { type: DataTypes.INTEGER, allowNull: true });
  }
  await addMissingColumn('teams', teamTable, 'driver1_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('teams', teamTable, 'driver2_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('teams', teamTable, 'discipline', { type: DataTypes.STRING, allowNull: false, defaultValue: 'f1' });
  await addMissingColumn('teams', teamTable, 'accent_color', { type: DataTypes.STRING, allowNull: false, defaultValue: '#6ef2f2' });
  await addMissingColumn('teams', teamTable, 'lmu_car_id', { type: DataTypes.INTEGER, allowNull: true });

  const resultTable = await queryInterface.describeTable('grand_prix_results');
  await addMissingColumn('grand_prix_results', resultTable, 'season_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('grand_prix_results', resultTable, 'discipline', { type: DataTypes.STRING, allowNull: false, defaultValue: 'f1' });
  await addMissingColumn('grand_prix_results', resultTable, 'race_type', { type: DataTypes.STRING, allowNull: false, defaultValue: 'main' });
  await addMissingColumn('grand_prix_results', resultTable, 'points_mode', { type: DataTypes.STRING, allowNull: false, defaultValue: 'database' });
  await addMissingColumn('grand_prix_results', resultTable, 'is_historical', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  const resultEntryTable = await queryInterface.describeTable('grand_prix_result_entries');
  await addMissingColumn('grand_prix_result_entries', resultEntryTable, 'pole_position', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  const pointsSchemeTable = await queryInterface.describeTable('points_schemes');
  await addMissingColumn('points_schemes', pointsSchemeTable, 'pole_position_enabled', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('points_schemes', pointsSchemeTable, 'pole_position_points', { type: DataTypes.DECIMAL(10, 1), allowNull: false, defaultValue: 0 });

  const lmuCarTable = await queryInterface.describeTable('lmu_cars');
  await addMissingColumn('lmu_cars', lmuCarTable, 'additional_info', { type: DataTypes.STRING, allowNull: true });

  const participatingTable = await queryInterface.describeTable('participating_leagues');
  await addMissingColumn('participating_leagues', participatingTable, 'is_active', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
  await addMissingColumn('participating_leagues', participatingTable, 'f1_team_id', { type: DataTypes.INTEGER, allowNull: true });

  const f1RoundTable = await queryInterface.describeTable('f1_calendar_rounds');
  await addMissingColumn('f1_calendar_rounds', f1RoundTable, 'has_sprint', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('f1_calendar_rounds', f1RoundTable, 'is_test_day', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  const wdlResultTable = await queryInterface.describeTable('wdl_result_entries');
  await addMissingColumn('wdl_result_entries', wdlResultTable, 'fastest_lap_one', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addMissingColumn('wdl_result_entries', wdlResultTable, 'fastest_lap_two', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  const seasonTable = await queryInterface.describeTable('seasons');
  await addMissingColumn('seasons', seasonTable, 'season_category_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('seasons', seasonTable, 'points_scheme_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('seasons', seasonTable, 'accent_color', { type: DataTypes.STRING, allowNull: true });

  const f1CarProfileTable = await queryInterface.describeTable('f1_car_profiles');
  await addMissingColumn('f1_car_profiles', f1CarProfileTable, 'base_team_id', { type: DataTypes.INTEGER, allowNull: true });

  const krlAssignmentTable = await queryInterface.describeTable('krl_team_assignments');
  await addMissingColumn('krl_team_assignments', krlAssignmentTable, 'image_path', { type: DataTypes.STRING, allowNull: true });

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
    const legacyTeams = await Team.findAll({ where: { LeagueId: league.id }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
    for (const team of legacyTeams) {
      const [centralTeam] = await Team.findOrCreate({
        where: { LeagueId: null, name: team.name, discipline: 'f1' },
        defaults: { LeagueId: null, name: team.name, discipline: 'f1', accentColor: team.accentColor, logoPath: team.logoPath, car: team.car, sortOrder: team.sortOrder }
      });
      const centralChanges = {};
      if (!centralTeam.logoPath && team.logoPath) centralChanges.logoPath = team.logoPath;
      if (!centralTeam.car && team.car) centralChanges.car = team.car;
      if (Object.keys(centralChanges).length) await centralTeam.update(centralChanges);
      const [roster] = await TeamRoster.findOrCreate({
        where: { LeagueId: league.id, TeamId: centralTeam.id, discipline: 'f1' },
        defaults: { LeagueId: league.id, TeamId: centralTeam.id, discipline: 'f1', sortOrder: team.sortOrder }
      });
      for (const [index, driverId] of [team.Driver1Id, team.Driver2Id].filter(Boolean).entries()) {
        await TeamRosterDriver.findOrCreate({
          where: { TeamRosterId: roster.id, DriverId: driverId },
          defaults: { TeamRosterId: roster.id, DriverId: driverId, roleName: 'Stammfahrer', sortOrder: index }
        });
      }
    }
  }

  const entryTable = resultEntryTable;
  await addMissingColumn('grand_prix_result_entries', entryTable, 'driver_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('grand_prix_result_entries', entryTable, 'team_id', { type: DataTypes.INTEGER, allowNull: true });

  const existingLmuRosters = await TeamRoster.findAll({
    where: { discipline: 'lmu' }, include: [{ association: 'team' }]
  });
  for (const roster of existingLmuRosters) {
    if (roster.team?.discipline === 'lmu') continue;
    const [lmuTeam] = await Team.findOrCreate({
      where: { LeagueId: null, name: roster.team.name, discipline: 'lmu' },
      defaults: {
        LeagueId: null, name: roster.team.name, discipline: 'lmu',
        logoPath: roster.team.logoPath, car: roster.team.car, sortOrder: roster.team.sortOrder
      }
    });
    const targetRoster = await TeamRoster.findOne({
      where: { id: { [Op.ne]: roster.id }, LeagueId: roster.LeagueId, TeamId: lmuTeam.id, discipline: 'lmu' }
    });
    if (!targetRoster) {
      await roster.update({ TeamId: lmuTeam.id });
      continue;
    }
    const assignments = await TeamRosterDriver.findAll({ where: { TeamRosterId: roster.id } });
    for (const assignment of assignments) {
      await TeamRosterDriver.findOrCreate({
        where: { TeamRosterId: targetRoster.id, DriverId: assignment.DriverId },
        defaults: {
          TeamRosterId: targetRoster.id, DriverId: assignment.DriverId,
          roleName: assignment.roleName, sortOrder: assignment.sortOrder
        }
      });
    }
    await roster.destroy();
  }

  const cockpitTable = await queryInterface.describeTable('lmu_cockpits');
  await addMissingColumn('lmu_cockpits', cockpitTable, 'driver1_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('lmu_cockpits', cockpitTable, 'driver2_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('lmu_cockpits', cockpitTable, 'driver3_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('lmu_cockpits', cockpitTable, 'reserve_driver_id', { type: DataTypes.INTEGER, allowNull: true });
  const legacyCockpits = await LmuCockpit.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  for (const cockpit of legacyCockpits) {
    const [team] = await Team.findOrCreate({
      where: { LeagueId: null, name: cockpit.teamName, discipline: 'lmu' },
      defaults: { LeagueId: null, name: cockpit.teamName, discipline: 'lmu', logoPath: cockpit.logoPath, car: cockpit.car, sortOrder: cockpit.sortOrder }
    });
    const [roster] = await TeamRoster.findOrCreate({
      where: { LeagueId: cockpit.LeagueId, TeamId: team.id, discipline: 'lmu' },
      defaults: {
        LeagueId: cockpit.LeagueId, TeamId: team.id, discipline: 'lmu',
        vehicleClass: cockpit.vehicleClass, carNumber: cockpit.carNumber, sortOrder: cockpit.sortOrder
      }
    });
    const driverIds = [cockpit.Driver1Id, cockpit.Driver2Id, cockpit.Driver3Id, cockpit.ReserveDriverId].filter(Boolean);
    for (const [index, driverId] of driverIds.entries()) {
      await TeamRosterDriver.findOrCreate({
        where: { TeamRosterId: roster.id, DriverId: driverId },
        defaults: {
          TeamRosterId: roster.id, DriverId: driverId,
          roleName: driverId === cockpit.ReserveDriverId ? 'Ersatzfahrer' : 'Stammfahrer', sortOrder: index
        }
      });
    }
  }

  const participantsWithLegacyTeams = await sequelize.models.ParticipatingLeague.findAll({ where: { F1TeamId: { [Op.ne]: null } } });
  for (const participant of participantsWithLegacyTeams) {
    const linkedTeam = await Team.findByPk(participant.F1TeamId);
    if (!linkedTeam || linkedTeam.LeagueId === null) continue;
    const [centralTeam] = await Team.findOrCreate({
      where: { LeagueId: null, name: linkedTeam.name, discipline: 'f1' },
      defaults: { LeagueId: null, name: linkedTeam.name, discipline: 'f1', logoPath: linkedTeam.logoPath, car: linkedTeam.car, sortOrder: linkedTeam.sortOrder }
    });
    await participant.update({ F1TeamId: centralTeam.id });
  }

  const competitionTable = await queryInterface.describeTable('league_competition_standings');
  await addMissingColumn('league_competition_standings', competitionTable, 'driver1_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('league_competition_standings', competitionTable, 'driver2_id', { type: DataTypes.INTEGER, allowNull: true });

  const raceEventTable = await queryInterface.describeTable('race_events');
  await addMissingColumn('race_events', raceEventTable, 'grand_prix_result_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('race_events', raceEventTable, 'season_id', { type: DataTypes.INTEGER, allowNull: true });
  await addMissingColumn('race_events', raceEventTable, 'is_test_day', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

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
  if (!hadFridayReserveRole) await Driver.update({ roleF1ReserveFriday: true }, { where: { roleF1Reserve: true } });
  if (!hadSundayReserveRole) await Driver.update({ roleF1ReserveSunday: true }, { where: { roleF1Reserve: true } });

  const f1Rosters = await TeamRoster.findAll({ where: { discipline: 'f1' }, attributes: ['id'] });
  if (f1Rosters.length) await TeamRosterDriver.destroy({
    where: { TeamRosterId: { [Op.in]: f1Rosters.map((roster) => roster.id) }, roleName: 'Ersatzfahrer' }
  });
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

  const entriesWithoutTeam = await sequelize.models.GrandPrixResultEntry.findAll({
    where: { TeamId: null, teamName: { [Op.ne]: null } },
    include: [{ association: 'grandPrixResult' }]
  });
  for (const entry of entriesWithoutTeam) {
    const discipline = entry.grandPrixResult?.discipline === 'lmu' ? 'lmu' : 'f1';
    const team = await Team.findOne({ where: { LeagueId: null, discipline, name: entry.teamName } });
    if (team) await entry.update({ TeamId: team.id });
  }
}

module.exports = { ensureSchema };
