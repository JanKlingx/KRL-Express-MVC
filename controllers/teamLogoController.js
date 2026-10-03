const models = require('../models');
const catalog = require('../services/f1Teams');
const images = require('../services/imageStorage');

exports.upload = async (req, res) => {
  const uploaded = [];
  let committed = false;
  let returnHref = `/admin/teams/${encodeURIComponent(req.params.teamId)}/edit#team-logos`;
  try {
    if (!req.files?.length || req.files.length > 12) throw new Error('Bitte 1 bis 12 Bilder auswählen.');
    await models.sequelize.transaction(async transaction => {
      const team = await models.Team.findOne({ where: { ...catalog.central, id: req.params.teamId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!team) throw new Error('Formel-1-Team nicht gefunden.');
      let snapshot, season;
      if (req.body?.seasonTeamId) {
        if (req.files.length !== 1) throw new Error('Bitte genau ein Bild als Saisonlogo auswählen.');
        snapshot = await models.SeasonTeam.findByPk(req.body.seasonTeamId, { transaction });
        if (!snapshot || await catalog.identityFor(snapshot, transaction) !== Number(team.id)) throw new Error('Das Saisonteam gehört nicht zu diesem Formel-1-Team.');
        season = await models.Season.findByPk(snapshot.SeasonId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!season || season.leagueType !== 'f1') throw new Error('Formel-1-Saison nicht gefunden.');
        const league = await models.League.findOne({ where: { slug: season.scopeSlug, type: 'f1' }, transaction });
        returnHref = `/admin/season-setup?league=${league?.id || ''}&season=${season.id}&step=6#season-logos`;
      }
      let logoVariants = catalog.logosFor(team);
      const hadLogos = logoVariants.length > 0;
      for (const file of req.files) {
        const path = await images.saveImage(file);
        uploaded.push(path);
        const label = String(file.originalname || 'Teamlogo').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 100);
        logoVariants = catalog.addLogo({ logoVariants }, path, label);
      }
      await team.update({ logoVariants, ...(!hadLogos ? { logoPath: uploaded[0] } : {}) }, { transaction });
      if (snapshot) {
        await snapshot.update({ logoPath: uploaded[0] }, { transaction });
        season.changed('updatedAt', true); await season.save({ transaction });
      }
    });
    committed = true;
    req.session.flash = { type: 'success', message: req.body?.seasonTeamId ? 'Logo hochgeladen und für diese Saison gespeichert.' : `${uploaded.length} Logos hinzugefügt. Wähle bei Bedarf ein Standardlogo und speichere. Die Saisonlogos bleiben erhalten.` };
  } catch (error) {
    if (!committed) for (const path of uploaded) await images.deleteUpload(path);
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(returnHref);
};
