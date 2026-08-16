const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const commonSort = { sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 } };

const User = sequelize.define('User', {
  email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'admin' }
});

const SiteStatistic = sequelize.define('SiteStatistic', {
  key: { type: DataTypes.STRING, allowNull: false, unique: true },
  label: { type: DataTypes.STRING, allowNull: false },
  value: { type: DataTypes.STRING, allowNull: false },
  icon: { type: DataTypes.STRING, allowNull: false, defaultValue: '◆' },
  ...commonSort
});

const TeamCategory = sequelize.define('TeamCategory', {
  name: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, allowNull: false, unique: true },
  ...commonSort
});

const TeamMember = sequelize.define('TeamMember', {
  name: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, allowNull: false },
  joinedYear: DataTypes.INTEGER,
  imagePath: DataTypes.STRING,
  ...commonSort
});

const League = sequelize.define('League', {
  name: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, allowNull: false, unique: true },
  type: { type: DataTypes.STRING, allowNull: false },
  currentSeason: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Saison 1' },
  raceDay: DataTypes.STRING,
  raceTime: DataTypes.STRING,
  description: DataTypes.TEXT,
  accentColor: { type: DataTypes.STRING, allowNull: false, defaultValue: '#6ef2f2' },
  logoPath: DataTypes.STRING,
  ...commonSort
});

const LmuCar = sequelize.define('LmuCar', {
  manufacturer: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
  vehicleClass: DataTypes.STRING,
  logoPath: DataTypes.STRING,
  ...commonSort
});

const Team = sequelize.define('Team', {
  name: { type: DataTypes.STRING, allowNull: false },
  discipline: { type: DataTypes.STRING, allowNull: false, defaultValue: 'f1' },
  accentColor: { type: DataTypes.STRING, allowNull: false, defaultValue: '#6ef2f2', validate: { is: /^#[0-9a-f]{6}$/i } },
  logoPath: DataTypes.STRING,
  car: DataTypes.STRING,
  ...commonSort
});

const TeamRoster = sequelize.define('TeamRoster', {
  discipline: { type: DataTypes.STRING, allowNull: false },
  vehicleClass: DataTypes.STRING,
  carNumber: DataTypes.STRING,
  ...commonSort
}, { indexes: [{ unique: true, fields: ['league_id', 'team_id', 'discipline'] }] });

const TeamRosterDriver = sequelize.define('TeamRosterDriver', {
  roleName: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Stammfahrer' },
  ...commonSort
}, { indexes: [{ unique: true, fields: ['team_roster_id', 'driver_id'] }] });

const Driver = sequelize.define('Driver', {
  name: { type: DataTypes.STRING, allowNull: false },
  number: DataTypes.INTEGER,
  gamerTag: DataTypes.STRING,
  f1Role: DataTypes.STRING,
  roleF1Friday: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  roleF1Sunday: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  roleF1Reserve: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  roleF1ReserveFriday: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  roleF1ReserveSunday: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  roleFormerF1: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  roleLmuRegular: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  roleLmuReserve: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  roleFormerLmu: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  racesF1: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  racesLmu: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  platform: { type: DataTypes.STRING, allowNull: false, defaultValue: 'PC' },
  nationality: DataTypes.STRING,
  avatarPath: DataTypes.STRING,
  car: DataTypes.STRING,
  ...commonSort
});

const PointsRule = sequelize.define('PointsRule', {
  position: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  points: { type: DataTypes.DECIMAL(10, 1), allowNull: false },
  ...commonSort
});

const PointsScheme = sequelize.define('PointsScheme', {
  name: { type: DataTypes.STRING, allowNull: false },
  discipline: { type: DataTypes.STRING, allowNull: false },
  validFrom: DataTypes.DATEONLY,
  validUntil: DataTypes.DATEONLY,
  fastestLapEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  fastestLapPoints: { type: DataTypes.DECIMAL(10, 1), allowNull: false, defaultValue: 1 },
  ...commonSort
});

const PointAllocation = sequelize.define('PointAllocation', {
  raceType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'main' },
  position: { type: DataTypes.INTEGER, allowNull: false },
  points: { type: DataTypes.DECIMAL(10, 1), allowNull: false },
  ...commonSort
});

const SeasonCategory = sequelize.define('SeasonCategory', {
  name: { type: DataTypes.STRING, allowNull: false },
  leagueType: { type: DataTypes.STRING, allowNull: false },
  scopeSlug: { type: DataTypes.STRING, allowNull: false },
  ...commonSort
});

const Season = sequelize.define('Season', {
  name: { type: DataTypes.STRING, allowNull: false },
  leagueType: { type: DataTypes.STRING, allowNull: false },
  scopeSlug: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
  calendarMode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'automatic' },
  ...commonSort
});

const F1CalendarRound = sequelize.define('F1CalendarRound', {
  circuit: { type: DataTypes.STRING, allowNull: false },
  hasSprint: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  fridayDate: DataTypes.DATEONLY,
  sundayDate: DataTypes.DATEONLY,
  fridayTime: DataTypes.STRING,
  sundayTime: DataTypes.STRING,
  ...commonSort
});

const DriverAlias = sequelize.define('DriverAlias', {
  alias: { type: DataTypes.STRING, allowNull: false },
  ...commonSort
});

const DriverStanding = sequelize.define('DriverStanding', {
  season: { type: DataTypes.STRING, allowNull: false },
  position: { type: DataTypes.INTEGER, allowNull: false },
  points: { type: DataTypes.DECIMAL(10, 1), allowNull: false, defaultValue: 0 },
  wins: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  gap: DataTypes.STRING,
  ...commonSort
});

const TeamStanding = sequelize.define('TeamStanding', {
  season: { type: DataTypes.STRING, allowNull: false },
  position: { type: DataTypes.INTEGER, allowNull: false },
  points: { type: DataTypes.DECIMAL(10, 1), allowNull: false, defaultValue: 0 },
  wins: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  gap: DataTypes.STRING,
  ...commonSort
});

const GrandPrixResult = sequelize.define('GrandPrixResult', {
  season: { type: DataTypes.STRING, allowNull: false },
  title: { type: DataTypes.STRING, allowNull: false },
  circuit: DataTypes.STRING,
  raceDate: DataTypes.DATEONLY,
  discipline: { type: DataTypes.STRING, allowNull: false, defaultValue: 'f1' },
  raceType: { type: DataTypes.STRING, allowNull: false, defaultValue: 'main' },
  pointsMode: { type: DataTypes.STRING, allowNull: false, defaultValue: 'database' },
  isHistorical: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  // Legacy columns remain populated so existing MariaDB installations can be
  // upgraded without dropping the former PNG fields.
  imagePath: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  altText: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
  ...commonSort
});

const GrandPrixResultEntry = sequelize.define('GrandPrixResultEntry', {
  position: DataTypes.INTEGER,
  driverName: { type: DataTypes.STRING, allowNull: false },
  teamName: DataTypes.STRING,
  points: { type: DataTypes.DECIMAL(10, 1), allowNull: false, defaultValue: 0 },
  status: DataTypes.STRING,
  fastestLap: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  ...commonSort
});

const F1RaceLineupEntry = sequelize.define('F1RaceLineupEntry', {
  roleType: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false },
  ...commonSort
}, {
  indexes: [
    {
      unique: true,
      fields: ['grand_prix_result_id', 'driver_id']
    },
    {
      name: 'uq_f1_lineup_replacement',
      unique: true,
      fields: [
        'grand_prix_result_id',
        'replacement_for_driver_id'
      ]
    }
  ]
});
const RaceEvent = sequelize.define('RaceEvent', {
  title: { type: DataTypes.STRING, allowNull: false },
  circuit: DataTypes.STRING,
  startsAt: { type: DataTypes.DATE, allowNull: false },
  durationMinutes: DataTypes.INTEGER,
  isPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  ...commonSort
});

const LmuCockpit = sequelize.define('LmuCockpit', {
  teamName: { type: DataTypes.STRING, allowNull: false },
  logoPath: DataTypes.STRING,
  car: DataTypes.STRING,
  vehicleClass: DataTypes.STRING,
  carNumber: DataTypes.STRING,
  driver1: DataTypes.STRING,
  driver2: DataTypes.STRING,
  driver3: DataTypes.STRING,
  reserveDriver: DataTypes.STRING,
  ...commonSort
});

const LmuStandingImage = sequelize.define('LmuStandingImage', {
  season: { type: DataTypes.STRING, allowNull: false },
  event: DataTypes.STRING,
  title: { type: DataTypes.STRING, allowNull: false },
  description: DataTypes.TEXT,
  imagePath: { type: DataTypes.STRING, allowNull: false },
  altText: { type: DataTypes.STRING, allowNull: false },
  ...commonSort
});

const ParticipatingLeague = sequelize.define('ParticipatingLeague', {
  name: { type: DataTypes.STRING, allowNull: false },
  abbreviation: DataTypes.STRING,
  constructorName: DataTypes.STRING,
  logoPath: DataTypes.STRING,
  websiteUrl: DataTypes.STRING,
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  ...commonSort
});

const WdlResultEntry = sequelize.define('WdlResultEntry', {
  positionOne: DataTypes.INTEGER,
  positionTwo: DataTypes.INTEGER,
  fastestLapOne: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  fastestLapTwo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  pointsOne: { type: DataTypes.DECIMAL(10, 1), allowNull: false, defaultValue: 0 },
  pointsTwo: { type: DataTypes.DECIMAL(10, 1), allowNull: false, defaultValue: 0 },
  totalPoints: { type: DataTypes.DECIMAL(10, 1), allowNull: false, defaultValue: 0 },
  ...commonSort
});

const KrlTeam = sequelize.define('KrlTeam', {
  name: { type: DataTypes.STRING, allowNull: false },
  slug: { type: DataTypes.STRING, allowNull: false, unique: true },
  ...commonSort
});

const KrlTeamAssignment = sequelize.define('KrlTeamAssignment', {
  roleName: { type: DataTypes.STRING, allowNull: false },
  ...commonSort
});

const KrlIcon = sequelize.define('KrlIcon', {
  text: { type: DataTypes.TEXT, allowNull: false },
  appointedAt: DataTypes.DATEONLY,
  ...commonSort
});

const LeagueCompetitionStanding = sequelize.define('LeagueCompetitionStanding', {
  position: { type: DataTypes.INTEGER, allowNull: false },
  drivers: DataTypes.STRING,
  constructorName: DataTypes.STRING,
  points: { type: DataTypes.DECIMAL(10, 1), allowNull: false, defaultValue: 0 },
  wins: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  gap: DataTypes.STRING,
  ...commonSort
});

TeamCategory.hasMany(TeamMember, { as: 'members', foreignKey: { name: 'TeamCategoryId', allowNull: false }, onDelete: 'CASCADE' });
TeamMember.belongsTo(TeamCategory, { as: 'category', foreignKey: { name: 'TeamCategoryId', allowNull: false } });
LmuCar.hasMany(Team, { as: 'teams', foreignKey: { name: 'LmuCarId', allowNull: true }, onDelete: 'SET NULL' });
Team.belongsTo(LmuCar, { as: 'lmuCar', foreignKey: { name: 'LmuCarId', allowNull: true }, onDelete: 'SET NULL' });
League.hasMany(Team, { as: 'legacyTeams', foreignKey: { name: 'LeagueId', allowNull: true }, onDelete: 'SET NULL' });
Team.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: true } });
League.hasMany(TeamRoster, { as: 'teamRosters', foreignKey: { name: 'LeagueId', allowNull: false }, onDelete: 'CASCADE' });
TeamRoster.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: false } });
Team.hasMany(TeamRoster, { as: 'rosters', foreignKey: { name: 'TeamId', allowNull: false }, onDelete: 'CASCADE' });
TeamRoster.belongsTo(Team, { as: 'team', foreignKey: { name: 'TeamId', allowNull: false } });
TeamRoster.hasMany(TeamRosterDriver, { as: 'assignments', foreignKey: { name: 'TeamRosterId', allowNull: false }, onDelete: 'CASCADE' });
TeamRosterDriver.belongsTo(TeamRoster, { as: 'roster', foreignKey: { name: 'TeamRosterId', allowNull: false } });
Driver.hasMany(TeamRosterDriver, { as: 'teamRosterAssignments', foreignKey: { name: 'DriverId', allowNull: false }, onDelete: 'CASCADE' });
TeamRosterDriver.belongsTo(Driver, { as: 'driver', foreignKey: { name: 'DriverId', allowNull: false } });
League.hasMany(Driver, { as: 'drivers', foreignKey: { name: 'LeagueId', allowNull: true }, onDelete: 'CASCADE' });
Driver.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: true } });
Team.hasMany(Driver, { as: 'drivers', foreignKey: { name: 'TeamId', allowNull: true }, onDelete: 'SET NULL' });
Driver.belongsTo(Team, { as: 'team', foreignKey: { name: 'TeamId', allowNull: true } });
Team.belongsTo(Driver, { as: 'driverOne', foreignKey: { name: 'Driver1Id', allowNull: true }, constraints: false });
Team.belongsTo(Driver, { as: 'driverTwo', foreignKey: { name: 'Driver2Id', allowNull: true }, constraints: false });
Season.hasMany(F1CalendarRound, { as: 'f1Rounds', foreignKey: { name: 'SeasonId', allowNull: true }, onDelete: 'SET NULL' });
F1CalendarRound.belongsTo(Season, { as: 'season', foreignKey: { name: 'SeasonId', allowNull: true } });
PointsScheme.hasMany(PointAllocation, { as: 'allocations', foreignKey: { name: 'PointsSchemeId', allowNull: false }, onDelete: 'CASCADE' });
PointAllocation.belongsTo(PointsScheme, { as: 'scheme', foreignKey: { name: 'PointsSchemeId', allowNull: false } });
SeasonCategory.hasMany(Season, { as: 'seasons', foreignKey: { name: 'SeasonCategoryId', allowNull: true }, onDelete: 'SET NULL' });
Season.belongsTo(SeasonCategory, { as: 'category', foreignKey: { name: 'SeasonCategoryId', allowNull: true } });
Driver.hasMany(DriverAlias, { as: 'aliases', foreignKey: { name: 'DriverId', allowNull: false }, onDelete: 'CASCADE' });
DriverAlias.belongsTo(Driver, { as: 'driver', foreignKey: { name: 'DriverId', allowNull: false } });
League.hasMany(DriverStanding, { as: 'driverStandings', foreignKey: { name: 'LeagueId', allowNull: false }, onDelete: 'CASCADE' });
DriverStanding.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: false } });
Driver.hasMany(DriverStanding, { as: 'standings', foreignKey: { name: 'DriverId', allowNull: false }, onDelete: 'CASCADE' });
DriverStanding.belongsTo(Driver, { as: 'driver', foreignKey: { name: 'DriverId', allowNull: false } });
League.hasMany(TeamStanding, { as: 'teamStandings', foreignKey: { name: 'LeagueId', allowNull: false }, onDelete: 'CASCADE' });
TeamStanding.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: false } });
Team.hasMany(TeamStanding, { as: 'standings', foreignKey: { name: 'TeamId', allowNull: false }, onDelete: 'CASCADE' });
TeamStanding.belongsTo(Team, { as: 'team', foreignKey: { name: 'TeamId', allowNull: false } });
League.hasMany(GrandPrixResult, { as: 'gpResults', foreignKey: { name: 'LeagueId', allowNull: false }, onDelete: 'CASCADE' });
GrandPrixResult.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: false } });
Season.hasMany(GrandPrixResult, { as: 'raceResults', foreignKey: { name: 'SeasonId', allowNull: true }, onDelete: 'SET NULL' });
GrandPrixResult.belongsTo(Season, { as: 'seasonRecord', foreignKey: { name: 'SeasonId', allowNull: true } });
GrandPrixResult.hasMany(GrandPrixResultEntry, { as: 'entries', foreignKey: { name: 'GrandPrixResultId', allowNull: false }, onDelete: 'CASCADE' });
GrandPrixResultEntry.belongsTo(GrandPrixResult, { as: 'grandPrixResult', foreignKey: { name: 'GrandPrixResultId', allowNull: false } });
Driver.hasMany(GrandPrixResultEntry, { as: 'raceEntries', foreignKey: { name: 'DriverId', allowNull: true }, onDelete: 'SET NULL' });
GrandPrixResultEntry.belongsTo(Driver, { as: 'driver', foreignKey: { name: 'DriverId', allowNull: true } });
Team.hasMany(GrandPrixResultEntry, { as: 'raceEntries', foreignKey: { name: 'TeamId', allowNull: true }, onDelete: 'SET NULL' });
GrandPrixResultEntry.belongsTo(Team, { as: 'team', foreignKey: { name: 'TeamId', allowNull: true } });
GrandPrixResult.hasMany(F1RaceLineupEntry, { as: 'lineupEntries', foreignKey: { name: 'GrandPrixResultId', allowNull: false }, onDelete: 'CASCADE' });
F1RaceLineupEntry.belongsTo(GrandPrixResult, { as: 'race', foreignKey: { name: 'GrandPrixResultId', allowNull: false } });
Driver.hasMany(F1RaceLineupEntry, { as: 'raceLineups', foreignKey: { name: 'DriverId', allowNull: false }, onDelete: 'CASCADE' });
F1RaceLineupEntry.belongsTo(Driver, { as: 'driver', foreignKey: { name: 'DriverId', allowNull: false } });
Driver.hasMany(F1RaceLineupEntry, { as: 'replacementLineups', foreignKey: { name: 'ReplacementForDriverId', allowNull: true }, onDelete: 'SET NULL' });
F1RaceLineupEntry.belongsTo(Driver, { as: 'replacementFor', foreignKey: { name: 'ReplacementForDriverId', allowNull: true } });
Team.hasMany(F1RaceLineupEntry, { as: 'plannedDrivers', foreignKey: { name: 'TeamId', allowNull: true }, onDelete: 'SET NULL' });
F1RaceLineupEntry.belongsTo(Team, { as: 'team', foreignKey: { name: 'TeamId', allowNull: true } });
League.hasMany(RaceEvent, { as: 'raceEvents', foreignKey: { name: 'LeagueId', allowNull: false }, onDelete: 'CASCADE' });
RaceEvent.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: false } });
Season.hasMany(RaceEvent, { as: 'raceEvents', foreignKey: { name: 'SeasonId', allowNull: true }, onDelete: 'SET NULL' });
RaceEvent.belongsTo(Season, { as: 'seasonRecord', foreignKey: { name: 'SeasonId', allowNull: true } });
GrandPrixResult.hasOne(RaceEvent, { as: 'calendarEvent', foreignKey: { name: 'GrandPrixResultId', allowNull: true }, onDelete: 'SET NULL' });
RaceEvent.belongsTo(GrandPrixResult, { as: 'grandPrixResult', foreignKey: { name: 'GrandPrixResultId', allowNull: true } });
League.hasMany(LmuCockpit, { as: 'cockpits', foreignKey: { name: 'LeagueId', allowNull: false }, onDelete: 'CASCADE' });
LmuCockpit.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: false } });
LmuCockpit.belongsTo(Driver, { as: 'driverOne', foreignKey: { name: 'Driver1Id', allowNull: true }, onDelete: 'SET NULL' });
LmuCockpit.belongsTo(Driver, { as: 'driverTwo', foreignKey: { name: 'Driver2Id', allowNull: true }, onDelete: 'SET NULL' });
LmuCockpit.belongsTo(Driver, { as: 'driverThree', foreignKey: { name: 'Driver3Id', allowNull: true }, onDelete: 'SET NULL' });
LmuCockpit.belongsTo(Driver, { as: 'reserve', foreignKey: { name: 'ReserveDriverId', allowNull: true }, onDelete: 'SET NULL' });
League.hasMany(LmuStandingImage, { as: 'lmuStandingImages', foreignKey: { name: 'LeagueId', allowNull: false }, onDelete: 'CASCADE' });
LmuStandingImage.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: false } });
ParticipatingLeague.hasMany(LeagueCompetitionStanding, { as: 'standings', foreignKey: { name: 'ParticipatingLeagueId', allowNull: false }, onDelete: 'CASCADE' });
LeagueCompetitionStanding.belongsTo(ParticipatingLeague, { as: 'participatingLeague', foreignKey: { name: 'ParticipatingLeagueId', allowNull: false } });
LeagueCompetitionStanding.belongsTo(Driver, { as: 'driverOne', foreignKey: { name: 'Driver1Id', allowNull: true }, onDelete: 'SET NULL' });
LeagueCompetitionStanding.belongsTo(Driver, { as: 'driverTwo', foreignKey: { name: 'Driver2Id', allowNull: true }, onDelete: 'SET NULL' });
ParticipatingLeague.hasMany(Driver, { as: 'drivers', foreignKey: { name: 'ParticipatingLeagueId', allowNull: true }, onDelete: 'SET NULL' });
Driver.belongsTo(ParticipatingLeague, { as: 'participatingLeague', foreignKey: { name: 'ParticipatingLeagueId', allowNull: true } });
ParticipatingLeague.belongsTo(Team, { as: 'f1Team', foreignKey: { name: 'F1TeamId', allowNull: true }, onDelete: 'SET NULL' });
GrandPrixResult.hasMany(WdlResultEntry, { as: 'wdlEntries', foreignKey: { name: 'GrandPrixResultId', allowNull: false }, onDelete: 'CASCADE' });
WdlResultEntry.belongsTo(GrandPrixResult, { as: 'race', foreignKey: { name: 'GrandPrixResultId', allowNull: false } });
ParticipatingLeague.hasMany(WdlResultEntry, { as: 'raceEntries', foreignKey: { name: 'ParticipatingLeagueId', allowNull: false }, onDelete: 'CASCADE' });
WdlResultEntry.belongsTo(ParticipatingLeague, { as: 'participatingLeague', foreignKey: { name: 'ParticipatingLeagueId', allowNull: false } });
WdlResultEntry.belongsTo(Driver, { as: 'driverOne', foreignKey: { name: 'Driver1Id', allowNull: true }, onDelete: 'SET NULL' });
WdlResultEntry.belongsTo(Driver, { as: 'driverTwo', foreignKey: { name: 'Driver2Id', allowNull: true }, onDelete: 'SET NULL' });
KrlTeam.hasMany(KrlTeamAssignment, { as: 'assignments', foreignKey: { name: 'KrlTeamId', allowNull: false }, onDelete: 'CASCADE' });
KrlTeamAssignment.belongsTo(KrlTeam, { as: 'krlTeam', foreignKey: { name: 'KrlTeamId', allowNull: false } });
Driver.hasMany(KrlTeamAssignment, { as: 'krlTeamRoles', foreignKey: { name: 'DriverId', allowNull: false }, onDelete: 'CASCADE' });
KrlTeamAssignment.belongsTo(Driver, { as: 'driver', foreignKey: { name: 'DriverId', allowNull: false } });
Driver.hasMany(KrlIcon, { as: 'icons', foreignKey: { name: 'DriverId', allowNull: false }, onDelete: 'CASCADE' });
KrlIcon.belongsTo(Driver, { as: 'driver', foreignKey: { name: 'DriverId', allowNull: false } });

module.exports = {
  sequelize,
  User,
  SiteStatistic,
  TeamCategory,
  TeamMember,
  League,
  LmuCar,
  Team,
  TeamRoster,
  TeamRosterDriver,
  Driver,
  DriverAlias,
  PointsRule,
  PointsScheme,
  PointAllocation,
  SeasonCategory,
  Season,
  F1CalendarRound,
  DriverStanding,
  TeamStanding,
  GrandPrixResult,
  GrandPrixResultEntry,
  F1RaceLineupEntry,
  RaceEvent,
  LmuCockpit,
  LmuStandingImage,
  ParticipatingLeague,
  LeagueCompetitionStanding,
  WdlResultEntry,
  KrlTeam,
  KrlTeamAssignment,
  KrlIcon
};
