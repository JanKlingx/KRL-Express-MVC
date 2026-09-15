const { KrlTeam, KrlTeamAssignment, sequelize } = require('../models');
const { krlTeams } = require('../services/resourceConfig');

exports.save = async (req, res) => {
  try {
    const team = req.params.id ? await KrlTeam.findByPk(req.params.id) : null;
    if (req.params.id && !team) throw new Error('Die Gruppe wurde nicht gefunden.');
    const values = { name: String(req.body.name || '').slice(0, 255), accentColor: req.body.accentColor, isVisible: req.body.isVisible === 'on' };
    await krlTeams.prepareValues(values, req.body, team);
    if (team) await team.update(values);
    else {
      const highest = await KrlTeam.max('sortOrder');
      await KrlTeam.create({ ...values, sortOrder: Number(highest || 0) + 1 });
    }
    delete req.session.teamGroupDraft;
    req.session.flash = { type: 'success', message: 'Die Gruppe wurde gespeichert. Mitglieder können jetzt zugeordnet werden.' };
  } catch (error) {
    req.session.teamGroupDraft = { id: req.params.id || '', name: String(req.body.name || '').slice(0, 255), accentColor: /^#[0-9a-f]{6}$/i.test(req.body.accentColor || '') ? req.body.accentColor : '#6ef2f2', isVisible: req.body.isVisible === 'on' };
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect('/?editTeam=1#team');
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
  res.redirect('/?editTeam=1#team');
};

exports.reorder = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const groups = await KrlTeam.findAll({ order: [['sortOrder', 'ASC'], ['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
      const ids = [].concat(req.body.groupIds || []).map(Number);
      if (ids.length !== groups.length || new Set(ids).size !== groups.length || groups.some((group) => !ids.includes(Number(group.id)))) throw new Error('Die Gruppen haben sich geändert. Bitte neu laden.');
      if (req.body.version !== groups.map((group) => group.id).join(',')) throw new Error('Die Gruppenreihenfolge wurde zwischenzeitlich geändert. Bitte neu laden.');
      for (const [index, id] of ids.entries()) await groups.find((group) => Number(group.id) === id).update({ sortOrder: index }, { transaction });
    });
    req.session.flash = { type: 'success', message: 'Gruppenreihenfolge gespeichert.' };
  } catch (error) { req.session.flash = { type: 'error', message: error.message }; }
  res.redirect('/?editTeam=1#team');
};

exports.saveMember = async (req, res) => {
  const { Driver } = require('../models');
  const { saveImage, deleteUpload } = require('../services/imageStorage');
  let uploadedPath;
  try {
    const eaName = String(req.body.eaName || '').trim();
    const steamFriendCode = String(req.body.steamFriendCode || '').trim();
    if(eaName.length > 100 || (steamFriendCode && !/^\d{1,20}$/.test(steamFriendCode))) throw new Error('EA-Name maximal 100 Zeichen; Steam-Freundescode bitte nur als Zahl eingeben.');
    const roleName = String(req.body.roleName || '').trim();
    const description = String(req.body.description || '').trim();
    if (!roleName || roleName.length > 255 || description.length > 3000) throw new Error('Bitte Funktion (maximal 255 Zeichen) und Beschreibung (maximal 3000 Zeichen) prüfen.');
    await sequelize.transaction(async (transaction) => {
      const group = await KrlTeam.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!group) throw new Error('Die Gruppe wurde nicht gefunden.');
      const member = req.params.memberId ? await KrlTeamAssignment.findByPk(req.params.memberId, { transaction, lock: transaction.LOCK.UPDATE }) : null;
      if (req.params.memberId && (!member || Number(member.KrlTeamId) !== Number(group.id))) throw new Error('Dieses Mitglied gehört nicht zu dieser Gruppe.');
      const DriverId = member ? member.DriverId : Number(req.body.DriverId);
      if (!await Driver.findByPk(DriverId, { transaction })) throw new Error('Bitte ein vorhandenes Mitglied auswählen.');
      if (!member && await KrlTeamAssignment.findOne({ where: { KrlTeamId: group.id, DriverId }, transaction })) throw new Error('Diese Person ist bereits in der Gruppe. Bitte den bestehenden Eintrag bearbeiten.');
      if (req.file) uploadedPath = await saveImage(req.file);
      const values = { roleName, description, eaName, steamFriendCode, ...(uploadedPath ? { imagePath: uploadedPath } : req.body.removeImage === 'on' ? { imagePath: null } : {}) };
      if (member) await member.update(values, { transaction });
      else await KrlTeamAssignment.create({ ...values, DriverId, KrlTeamId: group.id }, { transaction });
    });
    delete req.session.teamMemberDraft;
    req.session.flash = { type: 'success', message: 'Mitglied gespeichert.' };
  } catch (error) {
    if (uploadedPath) await deleteUpload(uploadedPath);
    req.session.teamMemberDraft = { groupId: req.params.id, id: req.params.memberId || '', eaName:String(req.body.eaName || '').slice(0,100), steamFriendCode:String(req.body.steamFriendCode || '').slice(0,20), DriverId: Number(req.body.DriverId) || '', roleName: String(req.body.roleName || '').slice(0, 255), description: String(req.body.description || '').slice(0, 3000) };
    req.session.flash = { type: 'error', message: error.message + (req.file ? ' Bitte das Bild erneut auswählen.' : '') };
  }
  res.redirect('/?editTeam=1#team');
};

exports.removeMember = async (req, res) => {
  try {
    const member = await KrlTeamAssignment.findByPk(req.params.memberId);
    if (!member || Number(member.KrlTeamId) !== Number(req.params.id)) throw new Error('Dieses Mitglied gehört nicht zu dieser Gruppe.');
    await member.destroy();
    req.session.flash = { type: 'success', message: 'Person aus dieser Gruppe entfernt. Das Fahrerprofil bleibt erhalten.' };
  } catch (error) { req.session.flash = { type: 'error', message: error.message }; }
  res.redirect('/?editTeam=1#team');
};
