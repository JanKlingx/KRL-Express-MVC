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

const Team = sequelize.define('Team', {
  name: { type: DataTypes.STRING, allowNull: false },
  logoPath: DataTypes.STRING,
  car: DataTypes.STRING,
  ...commonSort
});

const Driver = sequelize.define('Driver', {
  name: { type: DataTypes.STRING, allowNull: false },
  number: DataTypes.INTEGER,
  gamerTag: DataTypes.STRING,
  nationality: DataTypes.STRING,
  avatarPath: DataTypes.STRING,
  car: DataTypes.STRING,
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
League.hasMany(Team, { as: 'teams', foreignKey: { name: 'LeagueId', allowNull: false }, onDelete: 'CASCADE' });
Team.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: false } });
League.hasMany(Driver, { as: 'drivers', foreignKey: { name: 'LeagueId', allowNull: false }, onDelete: 'CASCADE' });
Driver.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: false } });
Team.hasMany(Driver, { as: 'drivers', foreignKey: { name: 'TeamId', allowNull: true }, onDelete: 'SET NULL' });
Driver.belongsTo(Team, { as: 'team', foreignKey: { name: 'TeamId', allowNull: true } });
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
GrandPrixResult.hasMany(GrandPrixResultEntry, { as: 'entries', foreignKey: { name: 'GrandPrixResultId', allowNull: false }, onDelete: 'CASCADE' });
GrandPrixResultEntry.belongsTo(GrandPrixResult, { as: 'grandPrixResult', foreignKey: { name: 'GrandPrixResultId', allowNull: false } });
League.hasMany(LmuCockpit, { as: 'cockpits', foreignKey: { name: 'LeagueId', allowNull: false }, onDelete: 'CASCADE' });
LmuCockpit.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: false } });
League.hasMany(LmuStandingImage, { as: 'lmuStandingImages', foreignKey: { name: 'LeagueId', allowNull: false }, onDelete: 'CASCADE' });
LmuStandingImage.belongsTo(League, { as: 'league', foreignKey: { name: 'LeagueId', allowNull: false } });
ParticipatingLeague.hasMany(LeagueCompetitionStanding, { as: 'standings', foreignKey: { name: 'ParticipatingLeagueId', allowNull: false }, onDelete: 'CASCADE' });
LeagueCompetitionStanding.belongsTo(ParticipatingLeague, { as: 'participatingLeague', foreignKey: { name: 'ParticipatingLeagueId', allowNull: false } });

module.exports = {
  sequelize,
  User,
  SiteStatistic,
  TeamCategory,
  TeamMember,
  League,
  Team,
  Driver,
  DriverStanding,
  TeamStanding,
  GrandPrixResult,
  GrandPrixResultEntry,
  LmuCockpit,
  LmuStandingImage,
  ParticipatingLeague,
  LeagueCompetitionStanding
};
