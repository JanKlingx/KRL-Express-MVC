const { User, sequelize } = require('../models');
const dashboard = require('../services/adminDashboard');
exports.save = async (req, res) => {
  try {
    const layout = await sequelize.transaction(async transaction => {
      const user = await User.findByPk(req.session.userId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user) throw new Error('Bitte erneut anmelden.');
      const value = dashboard.applyLayout(user.dashboardLayout, req.body);
      await user.update({ dashboardLayout: value }, { transaction });
      return value;
    });
    return res.json({ layout });
  } catch (error) { return res.status(400).json({ error: error.message }); }
};
