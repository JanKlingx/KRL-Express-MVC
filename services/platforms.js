const { Platform } = require('../models');
async function attachPlatforms(drivers) {
  if (!drivers.length) return;
  const platforms = await Platform.findAll();
  const byId = new Map(platforms.map((row) => [Number(row.id), row]));
  const byName = new Map(platforms.map((row) => [row.name, row]));
  drivers.forEach((driver) => {
    driver.platformRecord = byId.get(Number(driver.PlatformId)) || byName.get(driver.platform) || null;
  });
}
module.exports = { attachPlatforms };
