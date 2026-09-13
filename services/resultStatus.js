function sessionResultStatus(submitted, current, raceType) {
  const key = raceType === 'sprint' ? 'sprintStatus' : 'status';
  const value = Object.prototype.hasOwnProperty.call(submitted, key) ? submitted[key] : current?.status || '';
  return ['', 'DNF', 'DSQ', 'DNS', 'DNA', 'DNQ'].includes(value) ? value : '';
}
module.exports = { sessionResultStatus };
