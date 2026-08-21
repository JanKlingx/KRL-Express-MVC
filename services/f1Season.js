const { Op } = require('sequelize');
const {
  SeasonDriver, SeasonTeam, SeasonLineupEntry, Driver, Team, F1CarProfile
} = require('../models');

const eligibleSeasonDriverWhere = {
  [Op.or]: [
    { roleF1Friday: true }, { roleF1Saturday: true }, { roleF1Sunday: true },
    { roleFormerF1: true }
  ]
};

async function loadEligibleSeasonDrivers() {
  return Driver.findAll({ where: eligibleSeasonDriverWhere, include: [{ association: 'aliases' }], order: [['name', 'ASC'], ['id', 'ASC']] });
}

async function loadSeasonStructure(seasonId) {
  if (!seasonId) return { teams: [], unassignedDrivers: [], allDrivers: [] };
  const [memberships, seasonTeams, lineup] = await Promise.all([
    SeasonDriver.findAll({ where: { SeasonId: seasonId }, include: [{ association: 'driver', include: [{ association: 'aliases' }] }], order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    SeasonTeam.findAll({ where: { SeasonId: seasonId }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    SeasonLineupEntry.findAll({ where: { SeasonId: seasonId }, include: [{ association: 'driver', include: [{ association: 'aliases' }] }], order: [['sortOrder', 'ASC'], ['id', 'ASC']] })
  ]);
  const byTeam = new Map(seasonTeams.map((team) => [team.id, { ...team.toJSON(), drivers: [] }]));
  lineup.forEach((entry) => {
    const team = byTeam.get(entry.SeasonTeamId);
    if (team) team.drivers.push({ ...entry.driver.toJSON(), roleType: entry.roleType, lineupEntryId: entry.id });
  });
  const assigned = new Set(lineup.filter((entry) => entry.SeasonTeamId).map((entry) => entry.DriverId));
  const allDrivers = memberships.map((membership) => membership.driver).filter(Boolean);
  return {
    teams: [...byTeam.values()],
    unassignedDrivers: allDrivers.filter((driver) => !assigned.has(driver.id)),
    allDrivers,
    lineup
  };
}

async function resolveTeamToken(token) {
  const [sourceType, rawId] = String(token || '').split(':');
  const sourceId = Number(rawId);
  if (!sourceId || !['current', 'historical'].includes(sourceType)) return null;
  if (sourceType === 'current') {
    const team = await Team.findOne({ where: { id: sourceId, LeagueId: null, discipline: 'f1' } });
    return team && { sourceType, sourceId, name: team.name, accentColor: team.accentColor, logoPath: team.logoPath };
  }
  const profile = await F1CarProfile.findByPk(sourceId, { include: [{ association: 'baseTeam' }] });
  return profile?.BaseTeamId ? { sourceType, sourceId, name: profile.name, accentColor: profile.accentColor, logoPath: profile.logoPath, BaseTeamId: profile.BaseTeamId } : null;
}

module.exports = { eligibleSeasonDriverWhere, loadEligibleSeasonDrivers, loadSeasonStructure, resolveTeamToken };
