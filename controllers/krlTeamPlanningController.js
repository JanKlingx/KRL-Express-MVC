const { Op } = require('sequelize');
const { KrlTeam, KrlTeamAssignment, Driver, sequelize } = require('../models');

exports.show = async (req, res) => {
  const [teams, drivers] = await Promise.all([
    KrlTeam.findAll({
      include: [{ association: 'assignments', include: [{ association: 'driver' }] }],
      order: [['sortOrder', 'ASC'], ['id', 'ASC'], [{ model: KrlTeamAssignment, as: 'assignments' }, 'sortOrder', 'ASC']]
    }),
    Driver.findAll({ order: [['name', 'ASC'], ['id', 'ASC']] })
  ]);
  res.render('admin/krl-team-planning', {
    title: 'Mitglieder in Teams pflegen', teams, drivers,
    selectedTeamId: Number(req.query.team) || null
  });
};

exports.assign = async (req, res) => {
  const team = await KrlTeam.findByPk(Number(req.body.KrlTeamId));
  const driverIds = [...new Set([].concat(req.body.driverIds || req.body.DriverId || []).map(Number).filter(Number.isInteger))];
  const roleName = String(req.body.roleName || 'Teammitglied').trim();
  if (!team || !driverIds.length || !roleName) throw new Error('Team, mindestens ein Mitglied und eine Rolle sind erforderlich.');
  const drivers = await Driver.findAll({ where: { id: { [Op.in]: driverIds } } });
  if (drivers.length !== driverIds.length) throw new Error('Mindestens ein ausgewähltes Mitglied existiert nicht mehr.');
  await sequelize.transaction(async (transaction) => {
    for (const [index, DriverId] of driverIds.entries()) {
      const [assignment] = await KrlTeamAssignment.findOrCreate({
        where: { KrlTeamId: team.id, DriverId },
        defaults: { KrlTeamId: team.id, DriverId, roleName, sortOrder: index }, transaction
      });
      if (!assignment.isNewRecord) await assignment.update({ roleName }, { transaction });
    }
  });
  req.session.flash = { type: 'success', message: `${driverIds.length} Mitglied${driverIds.length === 1 ? '' : 'er'} wurde${driverIds.length === 1 ? '' : 'n'} ${team.name} zugeordnet.` };
  res.redirect(`/admin/krl-team-planning?team=${team.id}`);
};

exports.move = async (req, res) => {
  const [assignment, team] = await Promise.all([
    KrlTeamAssignment.findByPk(Number(req.params.assignmentId)),
    KrlTeam.findByPk(Number(req.body.KrlTeamId))
  ]);
  if (!assignment || !team) throw new Error('Zuordnung oder Zielteam wurde nicht gefunden.');
  await assignment.update({ KrlTeamId: team.id });
  req.session.flash = { type: 'success', message: `Mitglied wurde nach ${team.name} verschoben.` };
  res.redirect(`/admin/krl-team-planning?team=${team.id}`);
};

exports.remove = async (req, res) => {
  const assignment = await KrlTeamAssignment.findByPk(Number(req.params.assignmentId));
  if (assignment) await assignment.destroy();
  req.session.flash = { type: 'success', message: 'Mitglied wurde aus der Planungsgruppe entfernt.' };
  res.redirect('/admin/krl-team-planning');
};
