const { KrlTeam, KrlTeamAssignment, sequelize } = require('../models');
const { krlTeams } = require('../services/resourceConfig');

exports.save = async (req, res) => {
  try {
    const team = req.params.id ? await KrlTeam.findByPk(req.params.id) : null;
    if (req.params.id && !team) throw new Error('Die Gruppe wurde nicht gefunden.');
    const values = { name: String(req.body.name || '').slice(0, 255), accentColor: req.body.accentColor, isVisible: req.body.isVisible === 'on' };
    await krlTeams.prepareValues(values, req.body, team);
    if (team) await team.update(values);
    else await KrlTeam.create(values);
    delete req.session.teamGroupDraft;
    req.session.flash = { type: 'success', message: 'Die Gruppe wurde gespeichert. Mitglieder können jetzt zugeordnet werden.' };
  } catch (error) {
    req.session.teamGroupDraft = { id: req.params.id || '', name: String(req.body.name || '').slice(0, 255), accentColor: /^#[0-9a-f]{6}$/i.test(req.body.accentColor || '') ? req.body.accentColor : '#6ef2f2', isVisible: req.body.isVisible === 'on' };
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect('/#team');
};

exports.remove = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const team = await KrlTeam.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!team) throw new Error('Die Gruppe wurde nicht gefunden.');
      await KrlTeamAssignment.destroy({ where: { KrlTeamId: team.id }, transaction });
      await team.destroy({ transaction });
    });
    req.session.flash = { type: 'success', message: 'Die Gruppe und ihre Zuordnungen wurden entfernt. Die Fahrer bleiben erhalten.' };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect('/#team');
};
