const models = require('../models');
const { Op } = require('sequelize');
const normalize = name => String(name || '').trim().toLocaleLowerCase('de-DE');
async function findDuplicate(name, excludeId = 0) {
  return models.Driver.findOne({
    attributes: ['id', 'name'],
    where: {
      id: { [Op.ne]: Number(excludeId) || 0 },
      [Op.and]: models.sequelize.where(models.sequelize.fn('LOWER', models.sequelize.fn('TRIM', models.sequelize.col('name'))), normalize(name)),
    },
  });
}
exports.normalize = normalize;
exports.findDuplicate = findDuplicate;
exports.check = async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name || name.length > 255) return res.status(400).json({ error: 'Bitte einen gültigen Fahrernamen eingeben.' });
  const duplicate = await findDuplicate(name, req.query.excludeId);
  res.set('Cache-Control', 'no-store').json({ duplicate: duplicate ? { id: duplicate.id, name: duplicate.name } : null });
};
