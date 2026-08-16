const { KrlIcon } = require('../models');

exports.show = async (req, res) => {
  const icons = await KrlIcon.findAll({
    include: [{ association: 'driver' }],
    order: [['sortOrder', 'ASC'], ['appointedAt', 'ASC'], ['id', 'ASC']]
  });
  res.render('icons', { title: 'KRL Icons', icons });
};
