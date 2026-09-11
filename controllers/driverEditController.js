const { Op } = require('sequelize');
const { Driver } = require('../models');
exports.show = async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 100);
  const drivers = query ? await Driver.findAll({
    where: { name: { [Op.substring]: query } },
    order: [['name', 'ASC'], ['id', 'ASC']], limit: 50,
    include: [{ association: 'platformRecord', required: false }]
  }) : [];
  res.render('admin/driver-edit', { title: 'Fahrer bearbeiten', query, drivers });
};
