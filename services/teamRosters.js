const { TeamRoster, TeamRosterDriver } = require('../models');

async function centralTeamDriverIds(teamId, discipline = 'f1', minimum = discipline === 'lmu' ? 3 : 2) {
  if (!teamId) return [];
  const rosters = await TeamRoster.findAll({
    where: { TeamId: teamId, discipline },
    include: [{ association: 'assignments' }],
    order: [['sortOrder', 'ASC'], ['id', 'ASC'], [{ model: TeamRosterDriver, as: 'assignments' }, 'sortOrder', 'ASC']]
  });
  return [...new Set(rosters
    .filter((roster) => roster.assignments.length >= minimum)
    .flatMap((roster) => roster.assignments.map((assignment) => assignment.DriverId)))];
}

module.exports = { centralTeamDriverIds };
