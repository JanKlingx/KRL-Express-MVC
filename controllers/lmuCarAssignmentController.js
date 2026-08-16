const { sequelize, Driver, LmuCar } = require('../models');

async function loadData() {
  const [drivers, cars] = await Promise.all([
    Driver.findAll({
      where: { roleLmuRegular: true },
      include: [{ association: 'lmuCar', required: false }],
      order: [['lmuDisplayName', 'ASC'], ['name', 'ASC'], ['id', 'ASC']]
    }),
    LmuCar.findAll({ order: [['manufacturer', 'ASC'], ['name', 'ASC'], ['id', 'ASC']] })
  ]);
  return { drivers, cars };
}

exports.show = async (req, res) => {
  res.render('admin/lmu-car-assignments', { title: 'LMU-Autos zuordnen', ...(await loadData()) });
};

exports.save = async (req, res) => {
  const input = req.body.assignments || {};
  const { drivers, cars } = await loadData();
  const carIds = new Set(cars.map((car) => car.id));
  try {
    await sequelize.transaction(async (transaction) => {
      await Promise.all(drivers.map((driver) => {
        const rawCarId = input[String(driver.id)]?.LmuCarId;
        const carId = rawCarId ? Number(rawCarId) : null;
        if (carId && !carIds.has(carId)) throw new Error('Mindestens ein ausgewähltes LMU-Auto existiert nicht mehr.');
        return driver.update({ LmuCarId: carId }, { transaction });
      }));
    });
    req.session.flash = { type: 'success', message: 'Die persönlichen LMU-Autos der Stammfahrer wurden gespeichert.' };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect('/admin/lmu-car-assignments');
};
