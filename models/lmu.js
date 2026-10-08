module.exports = (sequelize, DataTypes, commonSort) => {
  const LmuGame = sequelize.define('LmuGame', { name: { type: DataTypes.STRING, allowNull: false, unique: true }, logoPath: DataTypes.STRING, isActive: { type: DataTypes.BOOLEAN, defaultValue: true }, ...commonSort });
  const LmuCalendar = sequelize.define('LmuCalendar', { name: { type: DataTypes.STRING, allowNull: false, unique: true }, rounds: { type: DataTypes.JSON, allowNull: false }, isActive: { type: DataTypes.BOOLEAN, defaultValue: true }, ...commonSort });
  const LmuRuleSection = sequelize.define('LmuRuleSection', { headingLevel: { type: DataTypes.INTEGER, defaultValue: 2 }, title: { type: DataTypes.STRING, allowNull: false }, content: { type: DataTypes.TEXT, allowNull: false }, sectionType: { type: DataTypes.STRING, defaultValue: 'rule' }, isPublished: { type: DataTypes.BOOLEAN, defaultValue: true }, ...commonSort });
  const LmuRaceDirectorDocument = sequelize.define('LmuRaceDirectorDocument', { title: { type: DataTypes.STRING, allowNull: false }, documentPath: { type: DataTypes.STRING, allowNull: false }, publishedAt: { type: DataTypes.DATEONLY, allowNull: false }, ...commonSort });
  return { LmuGame, LmuCalendar, LmuRuleSection, LmuRaceDirectorDocument };
};
