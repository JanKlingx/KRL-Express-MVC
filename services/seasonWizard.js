function wizardState(data, requestedStep) {
  const { selectedLeague: league, selectedSeason: season, calendar = [], structure = {} } = data;
  const drivers = structure.allDrivers || [];
  const regulars = (structure.lineup || []).filter((entry) => entry.roleType === 'regular');
  const assigned = new Set(regulars.map((entry) => Number(entry.DriverId)));
  const complete = [Boolean(league), Boolean(season), Boolean(calendar.length && calendar.every((row) => row.startsAt)), Boolean(season?.PointsSchemeId), Boolean(drivers.length), Boolean(structure.teams?.length), Boolean(drivers.length && drivers.every((driver) => assigned.has(Number(driver.id))) && assigned.size === drivers.length)];
  const firstMissing = complete.indexOf(false);
  const available = firstMissing < 0 ? 8 : firstMissing + 1;
  const requested = Number(requestedStep);
  return { available, current: Number.isInteger(requested) && requested >= 1 && requested <= available ? requested : available, complete };
}
module.exports = { wizardState };
