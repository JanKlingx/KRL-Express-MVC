const models = require('../models');
const { Op } = require('sequelize');
const {
  activateSeason,
  assignWdlPoints,
  ensureLmuEntries,
  ensureWdlEntries,
  pointsForPosition,
  recalculateAllPoints,
  recalculateDriverRaceCounts,
  removeF1CalendarRound,
  removeSeriesCalendarEvent,
  syncF1CalendarRound,
  syncSeriesCalendarEvent
} = require('./championship');
const { getDriverStatistics } = require('./driverStats');
const { centralTeamDriverIds } = require('./teamRosters');

const field = (name, label, type = 'text', required = false, options = {}) => ({
  name, label, type, required, ...options
});
const number = (name, label, required = false, options = {}) => field(name, label, 'number', required, { step: 'any', ...options });
const text = (name, label, required = false, options = {}) => field(name, label, 'text', required, options);
const textarea = (name, label, required = false, options = {}) => field(name, label, 'textarea', required, options);
const date = (name, label, required = false, options = {}) => field(name, label, 'date', required, options);
const dateTime = (name, label, required = false, options = {}) => field(name, label, 'datetime-local', required, options);
const url = (name, label, required = false, options = {}) => field(name, label, 'url', required, options);
const checkbox = (name, label, options = {}) => field(name, label, 'checkbox', false, options);
const select = (name, label, choices, required = false, options = {}) => field(name, label, 'select', required, { choices, ...options });
const relation = (name, label, model, formatOption, required = false, options = {}) => field(name, label, 'select', required, {
  relation: { model, formatOption, where: options.where },
  ...options,
  where: undefined
});

const NATIONALITY_CHOICES = [
  ['DE', 'Deutschland (DE)'], ['AT', 'Österreich (AT)'], ['CH', 'Schweiz (CH)'], ['AU', 'Australien (AU)'],
  ['BE', 'Belgien (BE)'], ['BR', 'Brasilien (BR)'], ['CA', 'Kanada (CA)'], ['DK', 'Dänemark (DK)'],
  ['ES', 'Spanien (ES)'], ['FI', 'Finnland (FI)'], ['FR', 'Frankreich (FR)'], ['GB', 'Großbritannien (GB)'],
  ['IT', 'Italien (IT)'], ['JP', 'Japan (JP)'], ['MX', 'Mexiko (MX)'], ['NL', 'Niederlande (NL)'],
  ['NO', 'Norwegen (NO)'], ['PL', 'Polen (PL)'], ['SE', 'Schweden (SE)'], ['US', 'USA (US)']
];

const DRIVER_RANKS = [
  { value: 'f1-friday', label: 'Stamm Freitag', where: { roleF1Friday: true }, matches: (driver) => Boolean(driver.roleF1Friday) },
  { value: 'f1-sunday', label: 'Stamm Sonntag', where: { roleF1Sunday: true }, matches: (driver) => Boolean(driver.roleF1Sunday) },
  { value: 'f1-reserve-friday', label: 'Ersatz Freitag', where: { roleF1ReserveFriday: true }, matches: (driver) => Boolean(driver.roleF1ReserveFriday) },
  { value: 'f1-reserve-sunday', label: 'Ersatz Sonntag', where: { roleF1ReserveSunday: true }, matches: (driver) => Boolean(driver.roleF1ReserveSunday) },
  { value: 'lmu-regular', label: 'LMU Stammfahrer', where: { roleLmuRegular: true }, matches: (driver) => Boolean(driver.roleLmuRegular) },
  { value: 'lmu-reserve', label: 'LMU Ersatzfahrer', where: { roleLmuReserve: true }, matches: (driver) => Boolean(driver.roleLmuReserve) },
  { value: 'former-f1', label: 'Ehemalige Formel-1-Fahrer', where: { roleFormerF1: true }, matches: (driver) => Boolean(driver.roleFormerF1) },
  { value: 'former-lmu', label: 'Ehemalige LMU-Fahrer', where: { roleFormerLmu: true }, matches: (driver) => Boolean(driver.roleFormerLmu) }
];

async function prepareDriver(values, body, existingDriver) {
  values.name = String(values.name || '').trim();
  const duplicateName = await models.Driver.findOne({
    where: {
      id: { [Op.ne]: existingDriver?.id || 0 },
      [Op.and]: models.sequelize.where(
        models.sequelize.fn('LOWER', models.sequelize.col('name')),
        values.name.toLocaleLowerCase('de-DE')
      )
    }
  });
  if (duplicateName) throw new Error(`Der Fahrername „${values.name}“ ist bereits vergeben. Verwende bei einer Namensänderung die Aliase im bestehenden Fahrerprofil.`);
  if (['roleF1Friday', 'roleF1Sunday', 'roleF1ReserveFriday', 'roleF1ReserveSunday'].some((name) => Object.prototype.hasOwnProperty.call(values, name))) {
    if (values.roleF1Friday && values.roleF1ReserveFriday) throw new Error('Ein Fahrer kann in der Freitagsliga nicht gleichzeitig Stamm- und Ersatzfahrer sein.');
    if (values.roleF1Sunday && values.roleF1ReserveSunday) throw new Error('Ein Fahrer kann in der Sonntagsliga nicht gleichzeitig Stamm- und Ersatzfahrer sein.');
    values.roleF1Reserve = Boolean(values.roleF1ReserveFriday || values.roleF1ReserveSunday);
    values.f1Role = values.roleF1Reserve ? 'reserve' : values.roleF1Friday && !values.roleF1Sunday ? 'friday' : values.roleF1Sunday && !values.roleF1Friday ? 'sunday' : null;
    if (values.roleF1Friday !== values.roleF1Sunday) {
      const slug = values.roleF1Friday ? 'freitag' : 'sonntag';
      const league = await models.League.findOne({ where: { slug, type: 'f1' } });
      values.LeagueId = league?.id || null;
    } else if (!values.roleLmuRegular && !values.roleLmuReserve) values.LeagueId = null;
  }
  if (values.TeamId) {
    const team = await models.Team.findByPk(values.TeamId);
    if (!team || team.LeagueId !== Number(values.LeagueId)) throw new Error('Das ausgewählte Team gehört nicht zur ausgewählten Liga.');
  }
  if (values.ParticipatingLeagueId) {
    const participant = await models.ParticipatingLeague.findByPk(values.ParticipatingLeagueId);
    if (!participant) throw new Error('Die ausgewählte WDL-Liga existiert nicht.');
  }
}

const listWhereForLeagueType = (type) => async () => {
  const leagues = await models.League.findAll({ where: { type }, attributes: ['id'] });
  return { LeagueId: { [Op.in]: leagues.map((league) => league.id) } };
};
const f1DriverWhere = () => ({
  [Op.or]: [
    { roleF1Friday: true }, { roleF1Sunday: true },
    { roleF1ReserveFriday: true }, { roleF1ReserveSunday: true },
    { roleLmuRegular: true }, { roleLmuReserve: true },
    { roleFormerF1: true }, { roleFormerLmu: true }
  ]
});
const hasF1Rank = (entry) => Boolean(entry?.roleF1Friday || entry?.roleF1Sunday || entry?.roleF1ReserveFriday || entry?.roleF1ReserveSunday || entry?.roleFormerF1);

const platformField = () => select('platform', 'Plattform', [['PC', 'PC'], ['PlayStation', 'PlayStation'], ['Xbox', 'Xbox']], true);
const nationalityField = () => select('nationality', 'Nationalität', NATIONALITY_CHOICES);
const aliasesField = () => textarea('aliasesText', 'Aliase / frühere Namen', false, { persist: false, help: 'Mehrere Namen mit Komma oder jeweils in einer neuen Zeile trennen.' });

async function prepareDriverForForm(entry) {
  if (!entry?.id) return entry;
  const values = typeof entry.toJSON === 'function' ? entry.toJSON() : { ...entry };
  const [aliases, stats] = await Promise.all([
    models.DriverAlias.findAll({ where: { DriverId: entry.id }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    getDriverStatistics(entry.id)
  ]);
  return {
    ...values,
    aliasesText: aliases.map((alias) => alias.alias).join(', '),
    pointsF1: stats.f1.points,
    winsF1: stats.f1.wins,
    winRateF1: stats.f1.winRate,
    podium1F1: stats.f1.podium1,
    podium2F1: stats.f1.podium2,
    podium3F1: stats.f1.podium3,
    pointsLmu: stats.lmu.points,
    winsLmu: stats.lmu.wins,
    winRateLmu: stats.lmu.winRate,
    podium1Lmu: stats.lmu.podium1,
    podium2Lmu: stats.lmu.podium2,
    podium3Lmu: stats.lmu.podium3
  };
}

async function syncDriverAliases(driver, body) {
  const aliases = [...new Set(String(body.aliasesText || '').split(/[,;\n]+/).map((alias) => alias.trim()).filter((alias) => alias && alias !== driver.name))];
  await models.sequelize.transaction(async (transaction) => {
    await models.DriverAlias.destroy({ where: { DriverId: driver.id }, transaction });
    if (aliases.length) await models.DriverAlias.bulkCreate(aliases.map((alias, index) => ({ DriverId: driver.id, alias, sortOrder: index })), { transaction });
  });
}

async function syncF1Driver(driver, body) {
  await syncDriverAliases(driver, body);
  const assignments = await models.TeamRosterDriver.findAll({
    where: { DriverId: driver.id },
    include: [{ association: 'roster', include: [{ association: 'league' }] }]
  });
  for (const assignment of assignments) {
    const roster = assignment.roster;
    if (roster?.discipline === 'f1') {
      const roleField = roster.league?.slug === 'freitag' ? 'roleF1Friday' : 'roleF1Sunday';
      if (!driver[roleField]) await assignment.destroy();
    } else if (roster?.discipline === 'lmu' && !driver.roleLmuRegular && !driver.roleLmuReserve) await assignment.destroy();
  }
}

async function prepareCentralTeam(discipline, values, body, existingTeam) {
  values.LeagueId = null;
  values.Driver1Id = null;
  values.Driver2Id = null;
  values.discipline = discipline;
  const duplicate = await models.Team.findOne({
    where: { id: { [Op.ne]: existingTeam?.id || 0 }, LeagueId: null, name: values.name, discipline }
  });
  if (duplicate) throw new Error(`Das ${discipline === 'lmu' ? 'LMU' : 'Formel-1'}-Team „${values.name}“ existiert bereits.`);
}

const prepareF1Team = (values, body, existingTeam) => prepareCentralTeam('f1', values, body, existingTeam);
async function prepareLmuTeam(values, body, existingTeam) {
  await prepareCentralTeam('lmu', values, body, existingTeam);
  const lmuCar = values.LmuCarId && await models.LmuCar.findByPk(values.LmuCarId);
  if (!lmuCar) throw new Error('Bitte ein vorhandenes LMU-Auto aus den Stammdaten auswählen.');
}

async function prepareTeamForForm(entry, discipline) {
  if (!entry?.id) return entry;
  const values = typeof entry.toJSON === 'function' ? entry.toJSON() : { ...entry };
  const resultEntries = await models.GrandPrixResultEntry.findAll({
    where: {
      [Op.or]: [
        { TeamId: entry.id },
        { TeamId: null, teamName: entry.name }
      ]
    },
    attributes: ['points'],
    include: [{ association: 'grandPrixResult', where: { discipline }, attributes: [] }]
  });
  return { ...values, totalPoints: resultEntries.reduce((sum, result) => sum + Number(result.points || 0), 0) };
}

async function syncF1Team(team) {
  const participants = await models.ParticipatingLeague.findAll({ where: { F1TeamId: team.id } });
  for (const participant of participants) await syncParticipatingLeague(participant);
  return team;
}

async function removeF1Team(team) {
  return team;
}

async function removeLmuCar(lmuCar) {
  await models.Team.update({ LmuCarId: null }, { where: { LmuCarId: lmuCar.id } });
}

async function removeF1Driver(driver) {
  await models.TeamRosterDriver.destroy({ where: { DriverId: driver.id } });
  const teams = await models.Team.findAll({ where: { [Op.or]: [{ Driver1Id: driver.id }, { Driver2Id: driver.id }] } });
  for (const team of teams) {
    const changes = {};
    if (team.Driver1Id === driver.id) changes.Driver1Id = null;
    if (team.Driver2Id === driver.id) changes.Driver2Id = null;
    await team.update(changes);
  }
}

async function syncCalendarGrandPrix(event) {
  const league = await models.League.findByPk(event.LeagueId);
  if (!league || league.type !== 'f1') return;
  let grandPrix = event.GrandPrixResultId && await models.GrandPrixResult.findByPk(event.GrandPrixResultId);
  if (!grandPrix) {
    grandPrix = await models.GrandPrixResult.create({ LeagueId: league.id, season: league.currentSeason, title: event.title, circuit: event.circuit, raceDate: event.startsAt, sortOrder: event.sortOrder });
    await event.update({ GrandPrixResultId: grandPrix.id });
  } else {
    await grandPrix.update({ LeagueId: league.id, season: league.currentSeason, title: event.title, circuit: event.circuit, raceDate: event.startsAt, sortOrder: event.sortOrder });
  }
}

async function removeCalendarGrandPrix(event) {
  if (!event.GrandPrixResultId) return;
  const grandPrix = await models.GrandPrixResult.findByPk(event.GrandPrixResultId);
  if (grandPrix) await grandPrix.destroy();
}

async function prepareRaceEntry(values, body, existingEntry) {
  const [race, driver] = await Promise.all([
    models.GrandPrixResult.findByPk(body.GrandPrixResultId),
    models.Driver.findByPk(body.DriverId, { include: [{ model: models.Team, as: 'team' }] })
  ]);
  if (!race || !driver) throw new Error('Grand Prix und Stammfahrer müssen ausgewählt werden.');
  if (race.LeagueId !== driver.LeagueId) throw new Error('Der Stammfahrer gehört nicht zur Liga dieses Grand Prix.');
  const duplicate = await models.GrandPrixResultEntry.findOne({
    where: { GrandPrixResultId: race.id, [Op.or]: [{ DriverId: driver.id }, { driverName: driver.name }] }
  });
  if (duplicate && duplicate.id !== existingEntry?.id) throw new Error('Für diesen Stammfahrer existiert bei diesem Grand Prix bereits ein Ergebnis.');
  values.driverName = driver.name;
  values.teamName = driver.team?.name || 'Privatteam';
  values.DriverId = driver.id;
}

async function prepareRaceEntryForForm(entry) {
  if (!entry?.driverName) return entry;
  const values = typeof entry.toJSON === 'function' ? entry.toJSON() : { ...entry };
  if (values.DriverId) return values;
  const race = await models.GrandPrixResult.findByPk(values.GrandPrixResultId);
  const driver = race && await models.Driver.findOne({ where: { LeagueId: race.LeagueId, name: values.driverName } });
  return { ...values, DriverId: driver?.id || '' };
}

async function prepareCockpit(values) {
  const mappings = [['Driver1Id', 'driver1'], ['Driver2Id', 'driver2'], ['Driver3Id', 'driver3'], ['ReserveDriverId', 'reserveDriver']];
  for (const [idField, nameField] of mappings) {
    if (!values[idField]) { values[nameField] = null; continue; }
    const driver = await models.Driver.findByPk(values[idField]);
    const hasRole = idField === 'ReserveDriverId' ? driver?.roleLmuReserve : driver?.roleLmuRegular;
    if (!driver || !hasRole) throw new Error(idField === 'ReserveDriverId' ? 'Der Ersatzfahrer benötigt den Rang „LMU Ersatzfahrer“.' : 'Cockpit-Fahrer benötigen den Rang „LMU Stammfahrer“.');
    values[nameField] = driver.name;
  }
}

async function prepareWdlStanding(values) {
  const participantId = Number(values.ParticipatingLeagueId);
  const selected = [];
  for (const fieldName of ['Driver1Id', 'Driver2Id']) {
    if (!values[fieldName]) continue;
    const driver = await models.Driver.findByPk(values[fieldName]);
    if (!driver || driver.ParticipatingLeagueId !== participantId) throw new Error('Die ausgewählten WDL-Fahrer müssen zur teilnehmenden Liga gehören.');
    selected.push(driver.name);
  }
  values.drivers = selected.join(' / ') || null;
}

async function prepareSeason(values) {
  const expectedScopes = { f1: ['freitag', 'sonntag'], lmu: ['lmu'], wdl: ['wettkampf'] };
  if (!expectedScopes[values.leagueType]?.includes(values.scopeSlug)) {
    throw new Error('Der Bereich passt nicht zum ausgewählten Ligatyp.');
  }
  if (values.status === 'active') values.calendarMode = 'automatic';
  if (values.SeasonCategoryId) {
    const category = await models.SeasonCategory.findByPk(values.SeasonCategoryId);
    if (!category || category.leagueType !== values.leagueType || category.scopeSlug !== values.scopeSlug) {
      throw new Error('Die Saison-Kategorie gehört nicht zum ausgewählten Ligabereich.');
    }
  } else {
    const category = await models.SeasonCategory.findOne({
      where: { name: values.status === 'active' ? 'Aktuelle Saison' : 'Ältere Saisons', leagueType: values.leagueType, scopeSlug: values.scopeSlug }
    });
    values.SeasonCategoryId = category?.id || null;
  }
}

async function preparePointsScheme(values, body, existingEntry) {
  if (values.validFrom && values.validUntil && values.validFrom > values.validUntil) {
    throw new Error('„Gültig von“ darf nicht nach „Gültig bis“ liegen.');
  }
  const overlaps = await models.PointsScheme.findOne({
    where: {
      id: { [Op.ne]: existingEntry?.id || 0 },
      discipline: values.discipline,
      [Op.and]: [
        { [Op.or]: [{ validFrom: null }, { validFrom: { [Op.lte]: values.validUntil || '9999-12-31' } }] },
        { [Op.or]: [{ validUntil: null }, { validUntil: { [Op.gte]: values.validFrom || '0001-01-01' } }] }
      ]
    }
  });
  if (overlaps) throw new Error(`Der Gültigkeitszeitraum überschneidet sich mit „${overlaps.name}“.`);
  if (!values.fastestLapEnabled) values.fastestLapPoints = 0;
}

async function preparePointAllocation(values, body, existingEntry) {
  const scheme = await models.PointsScheme.findByPk(values.PointsSchemeId);
  if (!scheme) throw new Error('Bitte ein Punktesystem auswählen.');
  if (scheme.discipline !== 'f1' && values.raceType === 'sprint') throw new Error('Sprintpunkte sind ausschließlich für Formel 1 möglich.');
  const duplicate = await models.PointAllocation.findOne({
    where: { PointsSchemeId: scheme.id, raceType: values.raceType, position: values.position }
  });
  if (duplicate && duplicate.id !== existingEntry?.id) throw new Error('Für diesen Platz existiert im gewählten Rennen bereits ein Punktewert.');
}

async function preparePointsSchemeForList(entry) {
  if (!entry?.id) return entry;
  const values = typeof entry.toJSON === 'function' ? entry.toJSON() : { ...entry };
  const allocations = await models.PointAllocation.findAll({
    where: { PointsSchemeId: entry.id },
    order: [['raceType', 'ASC'], ['position', 'ASC'], ['id', 'ASC']]
  });
  return { ...values, allocations: allocations.map((allocation) => allocation.toJSON()) };
}

async function prepareSeasonCategory(values) {
  const expectedScopes = { f1: ['freitag', 'sonntag'], lmu: ['lmu'], wdl: ['wettkampf'] };
  if (!expectedScopes[values.leagueType]?.includes(values.scopeSlug)) throw new Error('Kategorie und Ligabereich passen nicht zusammen.');
}

async function syncSeason(season) {
  await activateSeason(season);
}

async function prepareF1Round(values) {
  const activeSeasons = await models.Season.count({ where: { leagueType: 'f1', status: 'active', scopeSlug: { [Op.in]: ['freitag', 'sonntag'] } } });
  if (!activeSeasons) throw new Error('Lege zuerst mindestens eine aktive Formel-1-Saison an.');
  if (!values.fridayDate && !values.sundayDate) throw new Error('Mindestens ein Freitag- oder Sonntagsdatum ist erforderlich.');
}

async function prepareSeasonRace(values) {
  const [season, league] = await Promise.all([
    models.Season.findByPk(values.SeasonId),
    models.League.findByPk(values.LeagueId)
  ]);
  if (!season || !league) throw new Error('Saison und Liga müssen ausgewählt werden.');
  if (season.status === 'active' && season.calendarMode === 'automatic') throw new Error('Rennen einer aktiven automatischen Saison werden im jeweiligen Rennkalender angelegt.');
  const expectedType = season.leagueType === 'wdl' ? 'competition' : season.leagueType;
  if (league.type !== expectedType) throw new Error('Liga und Saison haben unterschiedliche Ligatypen.');
  values.season = season.name;
  values.discipline = season.leagueType;
  values.isHistorical = season.status === 'historical';
}

async function syncSeasonRace(race) {
  if (race.discipline === 'wdl') await ensureWdlEntries(race);
  if (race.discipline === 'lmu') await ensureLmuEntries(race);
}

async function prepareSeriesCalendar(values) {
  const [season, league] = await Promise.all([
    models.Season.findByPk(values.SeasonId),
    models.League.findByPk(values.LeagueId)
  ]);
  if (!season || !league) throw new Error('Saison und Liga sind erforderlich.');
  const expectedType = season.leagueType === 'wdl' ? 'competition' : season.leagueType;
  if (league.type !== expectedType) throw new Error('Der Kalender gehört nicht zum Ligatyp der Saison.');
}

async function prepareSeriesEntry(values, body, existingEntry) {
  const [race, driver] = await Promise.all([
    models.GrandPrixResult.findByPk(values.GrandPrixResultId, { include: [{ model: models.Season, as: 'seasonRecord' }] }),
    models.Driver.findByPk(values.DriverId, { include: [{ model: models.Team, as: 'team' }] })
  ]);
  if (!race || !driver || race.discipline !== 'lmu') throw new Error('LMU-Rennen und Fahrer müssen ausgewählt werden.');
  if (race.seasonRecord?.status !== 'historical' && !driver.roleLmuRegular) {
    throw new Error('In der aktiven LMU-Saison sind nur LMU-Stammfahrer automatisch zugelassen.');
  }
  const duplicate = await models.GrandPrixResultEntry.findOne({ where: { GrandPrixResultId: race.id, DriverId: driver.id } });
  if (duplicate && duplicate.id !== existingEntry?.id) throw new Error('Dieser Fahrer besitzt für das Rennen bereits ein Ergebnis.');
  values.driverName = driver.name;
  values.teamName = driver.team?.name || 'LMU-Team offen';
  values.points = await pointsForPosition(values.position, { ...race.toJSON(), fastestLap: values.fastestLap });
}

async function syncSeriesEntry() {
  await recalculateDriverRaceCounts();
}

async function prepareWdlResult(values, body, existingEntry) {
  const race = await models.GrandPrixResult.findByPk(values.GrandPrixResultId, { include: [{ model: models.Season, as: 'seasonRecord' }] });
  const league = await models.ParticipatingLeague.findByPk(values.ParticipatingLeagueId, { include: [{ association: 'f1Team' }] });
  if (!race || race.discipline !== 'wdl' || !league) throw new Error('WDL-Rennen und teilnehmende Liga sind erforderlich.');
  if (race.seasonRecord?.status !== 'historical' && !league.isActive) throw new Error('Inaktive Ligen sind nur in historischen Saisons auswählbar.');
  if (values.Driver1Id && values.Driver2Id && Number(values.Driver1Id) === Number(values.Driver2Id)) throw new Error('Eine Liga muss zwei unterschiedliche Fahrer stellen.');
  const teamDriverIds = new Set((await centralTeamDriverIds(league.F1TeamId)).map(Number));
  for (const driverId of [values.Driver1Id, values.Driver2Id].filter(Boolean)) {
    const driver = await models.Driver.findByPk(driverId);
    if (!driver || (Number(driver.ParticipatingLeagueId) !== league.id && !teamDriverIds.has(Number(driver.id)))) throw new Error('Die ausgewählten Fahrer müssen aus dem zugeordneten F1-Team oder der gewählten WDL-Liga stammen.');
  }
  const duplicate = await models.WdlResultEntry.findOne({ where: { GrandPrixResultId: race.id, ParticipatingLeagueId: league.id } });
  if (duplicate && duplicate.id !== existingEntry?.id) throw new Error('Für diese Liga existiert bereits eine Ergebniszeile.');
  values.pointsOne = await pointsForPosition(values.positionOne, { ...race.toJSON(), fastestLap: values.fastestLapOne });
  values.pointsTwo = await pointsForPosition(values.positionTwo, { ...race.toJSON(), fastestLap: values.fastestLapTwo });
  values.totalPoints = Number(values.pointsOne) + Number(values.pointsTwo);
}

async function syncWdlResult(entry) {
  await assignWdlPoints(entry);
}

async function syncParticipatingLeague(participant) {
  if (!participant.isActive) return;
  const activeSeason = await models.Season.findOne({ where: { leagueType: 'wdl', scopeSlug: 'wettkampf', status: 'active' } });
  if (!activeSeason) return;
  const races = await models.GrandPrixResult.findAll({ where: { SeasonId: activeSeason.id, discipline: 'wdl' } });
  if (!races.length) return;
  for (const race of races) await ensureWdlEntries(race);
  const freshParticipant = await models.ParticipatingLeague.findByPk(participant.id, { include: [{ association: 'f1Team' }] });
  if (!freshParticipant?.f1Team) return;
  const driverIds = await centralTeamDriverIds(freshParticipant.F1TeamId);
  const entries = await models.WdlResultEntry.findAll({
    where: { ParticipatingLeagueId: participant.id, GrandPrixResultId: { [Op.in]: races.map((race) => race.id) } }
  });
  for (const entry of entries) {
    const values = {};
    if (!entry.positionOne) values.Driver1Id = driverIds[0] || null;
    if (!entry.positionTwo) values.Driver2Id = driverIds[1] || null;
    if (Object.keys(values).length) await entry.update(values);
  }
}

async function prepareParticipatingLeague(values) {
  if (!values.F1TeamId) return;
  const team = await models.Team.findOne({ where: { id: values.F1TeamId, LeagueId: null, discipline: 'f1' } });
  if (!team) throw new Error('Bitte ein zentrales Formel-1-Team auswählen.');
  const driverIds = await centralTeamDriverIds(team.id);
  if (driverIds.length < 2) throw new Error(`${team.name} benötigt zuerst eine vollständige F1-Aufstellung mit mindestens zwei Fahrern.`);
}

async function prepareKrlAssignment(values, body, existingEntry) {
  if (Number(values.KrlTeamId) < 1 || Number(values.DriverId) < 1) throw new Error('Team und Fahrer sind erforderlich.');
  const duplicate = await models.KrlTeamAssignment.findOne({
    where: { KrlTeamId: values.KrlTeamId, DriverId: values.DriverId, roleName: values.roleName }
  });
  if (duplicate && duplicate.id !== existingEntry?.id) throw new Error('Diese Fahrer-Rolle ist im Team bereits vorhanden.');
}

module.exports = {
  statistics: {
    title: 'Startseiten-Statistiken', group: 'Startseite',
    description: 'Kennzahlen auf der Startseite verwalten.', model: models.SiteStatistic,
    fields: [
      text('key', 'Technischer Schlüssel', true, { help: 'Einmaliger kurzer Name, z. B. aktive-fahrer.' }),
      text('label', 'Bezeichnung', true), text('value', 'Angezeigter Wert', true),
      text('icon', 'Symbol', false, { placeholder: '🏁' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  teamCategories: {
    title: 'Team-Kategorien', group: 'Startseite & Team',
    description: 'Legacy-Teamkategorien.', model: models.TeamCategory, hidden: true,
    fields: [text('name', 'Name', true), text('slug', 'Kurzname für die URL', true, { help: 'Kleinbuchstaben ohne Leerzeichen, z. B. rennleitung.' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })]
  },
  teamMembers: {
    title: 'Teammitglieder', group: 'Startseite & Team',
    description: 'Legacy-Teammitglieder.', model: models.TeamMember, upload: { field: 'imagePath', label: 'Personenbild' }, hidden: true,
    fields: [
      relation('TeamCategoryId', 'Kategorie', models.TeamCategory, (row) => row.name, true),
      text('name', 'Name', true), text('role', 'Funktion', true), number('joinedYear', 'Eintrittsjahr', false, { min: 2000, step: 1 }),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  leagues: {
    title: 'Ligen-Seiten', group: 'Stammdaten',
    description: 'Name, URL, Ligatyp und Darstellung der öffentlichen Ligenseiten pflegen.', model: models.League, upload: { field: 'logoPath', label: 'Liga-Logo' },
    fields: [
      text('name', 'Name', true), text('slug', 'URL-Kurzname', true, { help: 'Beispiel: freitag oder sonntag.' }),
      select('type', 'Ligatyp', [['f1', 'Formel 1'], ['lmu', 'Le Mans Ultimate'], ['competition', 'Wettkampf der Ligen'], ['endurance', 'Endurance']], true),
      text('currentSeason', 'Aktuelle Saison', true, { placeholder: 'Saison 12' }), text('raceDay', 'Renntag'), text('raceTime', 'Startzeit', false, { placeholder: '20:00 Uhr' }),
      textarea('description', 'Beschreibung'), field('accentColor', 'Akzentfarbe', 'color', false),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  pointsRules: {
    title: 'Punktetabelle', group: 'Stammdaten',
    description: 'Legacy-Punktetabelle für bestehende Installationen.', model: models.PointsRule, afterSave: recalculateAllPoints, afterRemove: recalculateAllPoints, hidden: true,
    fields: [
      number('position', 'Platz', true, { min: 1, step: 1 }), number('points', 'Punktewert', true, { min: 0, step: 0.5 }),
      number('sortOrder', 'Reihenfolge', false, { min: 0, step: 1 })
    ]
  },
  pointsSchemes: {
    title: 'Punktesysteme', group: 'Stammdaten',
    description: 'Punktesystem und zugehörige Punkte je Platz gemeinsam verwalten. Hauptrennen und F1-Sprints sind direkt am jeweiligen System aufgelistet.', model: models.PointsScheme,
    prepareValues: preparePointsScheme, prepareEntry: preparePointsSchemeForList, afterSave: recalculateAllPoints, afterRemove: recalculateAllPoints,
    cardView: 'points-schemes',
    fields: [
      text('name', 'Bezeichnung', true, { placeholder: 'F1 ab Saison 2026' }),
      select('discipline', 'Bereich', [['f1', 'Formel 1'], ['lmu', 'LMU'], ['wdl', 'WDL']], true),
      date('validFrom', 'Gültig von'), date('validUntil', 'Gültig bis'),
      checkbox('fastestLapEnabled', 'Punkte für schnellste Runde'),
      number('fastestLapPoints', 'Punkte für schnellste Runde', false, { min: 0, step: 0.5 }),
      number('sortOrder', 'Priorität', false, { min: 0, step: 1 })
    ]
  },
  pointAllocations: {
    title: 'Punkte je Platz', group: 'Stammdaten',
    description: 'Punktewert direkt innerhalb des ausgewählten Punktesystems ergänzen oder bearbeiten.', model: models.PointAllocation,
    prepareValues: preparePointAllocation, afterSave: recalculateAllPoints, afterRemove: recalculateAllPoints,
    getCreateDefaults: (req) => ({ PointsSchemeId: req.query.scheme || '' }), returnHref: '/admin/pointsSchemes', hidden: true,
    fields: [
      relation('PointsSchemeId', 'Punktesystem', models.PointsScheme, (row) => `${row.name} · ${row.discipline.toUpperCase()}`, true),
      select('raceType', 'Rennentyp', [['main', 'Hauptrennen'], ['sprint', 'Sprintrennen']], true),
      number('position', 'Platz', true, { min: 1, step: 1 }),
      number('points', 'Punktewert', true, { min: 0, step: 0.5 }),
      number('sortOrder', 'Reihenfolge', false, { min: 0, step: 1 })
    ]
  },
  seasonCategories: {
    title: 'Saison-Kategorien', group: 'Saisonverwaltung',
    description: 'Saisons übersichtlich unter Kategorien wie „Aktuelle Saison“ oder „Ältere Saisons“ gruppieren.', model: models.SeasonCategory,
    prepareValues: prepareSeasonCategory, hidden: true,
    fields: [
      text('name', 'Kategoriename', true),
      select('leagueType', 'Ligatyp', [['f1', 'Formel 1'], ['lmu', 'LMU'], ['wdl', 'WDL']], true),
      select('scopeSlug', 'Bereich', [['freitag', 'F1 Freitag'], ['sonntag', 'F1 Sonntag'], ['lmu', 'LMU'], ['wettkampf', 'WDL']], true),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  seasons: {
    title: 'Saisons', group: 'Saisonverwaltung',
    description: 'Aktuelle und historische Saisons für Frontend, Kalender, Results und Wertungen verwalten.', model: models.Season,
    prepareValues: prepareSeason, afterSave: syncSeason, hidden: true,
    fields: [
      text('name', 'Saisonname', true, { placeholder: '2024, Season 8 oder WDL 2023' }),
      select('leagueType', 'Ligatyp', [['f1', 'Formel 1'], ['lmu', 'LMU'], ['wdl', 'WDL']], true),
      select('scopeSlug', 'Bereich / Ligenseite', [['freitag', 'F1 Freitag'], ['sonntag', 'F1 Sonntag'], ['lmu', 'LMU'], ['wettkampf', 'WDL']], true),
      select('status', 'Saisonstatus', [['active', 'Aktiv'], ['historical', 'Historisch']], true),
      select('calendarMode', 'Rennkalender-Modus', [['automatic', 'Automatisch aus Stammdaten'], ['manual', 'Manuell pflegen']], true),
      relation('SeasonCategoryId', 'Kategorie', models.SeasonCategory, (row) => `${row.name} · ${row.scopeSlug}`),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  teams: {
    title: 'Formel-1-Teams', group: 'Zentrale Rennteams',
    description: 'Bestehende Formel-1-Teams zentral mit Name, Farbcode und Upload-Logo pflegen. Die Teamfarbe gestaltet die Karten in den Ligaseiten.', model: models.Team, upload: { field: 'logoPath', label: 'Teamlogo' }, getListWhere: async () => ({ LeagueId: null, discipline: 'f1' }), prepareValues: prepareF1Team, prepareEntry: (entry) => prepareTeamForForm(entry, 'f1'), afterSave: syncF1Team, beforeRemove: removeF1Team,
    nextHref: '/admin/team-rosters/f1', nextLabel: 'Danach F1-Fahrerfelder zusammenstellen',
    listFields: ['name', 'accentColor', 'totalPoints'],
    fields: [
      text('name', 'Teamname', true),
      field('accentColor', 'Teamfarbe', 'color', true, { help: 'Färbt die Teamkarte in den F1-Ligaseiten. Der genaue Hex-Farbcode wird vom Farbwähler gespeichert.' }),
      number('totalPoints', 'Gesamte Punkte (automatisch)', false, { readonly: true, persist: false })
    ]
  },
  drivers: {
    title: 'Fahrer-Pflege', group: 'Stammdaten',
    description: 'Zentrale Fahrer-Stammdaten. Namen sind eindeutig, Rollen sind kombinierbar und erzeugen automatisch die Rang-Kategorien in der Übersicht.', model: models.Driver,
    listFields: ['name', 'aliasesText', 'platform', 'nationality'],
    prepareValues: prepareDriver, prepareEntry: prepareDriverForForm, afterSave: syncF1Driver, beforeRemove: removeF1Driver,
    rankFilters: DRIVER_RANKS, groupByRanks: true,
    fields: [
      text('name', 'Name', true), aliasesField(), platformField(),
      number('racesF1', 'Gefahrene Rennen F1', false, { min: 0, step: 1, readonly: true, persist: false, visibleWhen: hasF1Rank }),
      number('racesLmu', 'Gefahrene Rennen LMU', false, { min: 0, step: 1, readonly: true, persist: false, visibleWhen: (entry) => entry?.roleLmuRegular || entry?.roleLmuReserve || entry?.roleFormerLmu }),
      checkbox('roleF1Friday', 'Rang: Stamm Freitag'), checkbox('roleF1Sunday', 'Rang: Stamm Sonntag'),
      checkbox('roleF1ReserveFriday', 'Rang: Ersatz Freitag'), checkbox('roleF1ReserveSunday', 'Rang: Ersatz Sonntag'),
      checkbox('roleFormerF1', 'Rang: Ehemaliger Formel-1-Fahrer'),
      checkbox('roleLmuRegular', 'Rang: LMU Stammfahrer'), checkbox('roleLmuReserve', 'Rang: LMU Ersatzfahrer'),
      checkbox('roleFormerLmu', 'Rang: Ehemaliger LMU-Fahrer'), nationalityField(),
      number('pointsF1', 'F1-Punkte', false, { readonly: true, persist: false, visibleWhen: hasF1Rank }),
      number('winsF1', 'Siege F1', false, { readonly: true, persist: false, visibleWhen: hasF1Rank }),
      number('winRateF1', 'Siegesquote F1 (%)', false, { readonly: true, persist: false, visibleWhen: hasF1Rank }),
      number('podium1F1', 'Platz 1 F1', false, { readonly: true, persist: false, visibleWhen: hasF1Rank }),
      number('podium2F1', 'Platz 2 F1', false, { readonly: true, persist: false, visibleWhen: hasF1Rank }),
      number('podium3F1', 'Platz 3 F1', false, { readonly: true, persist: false, visibleWhen: hasF1Rank }),
      number('pointsLmu', 'LMU-Punkte', false, { readonly: true, persist: false, visibleWhen: (entry) => entry?.roleLmuRegular || entry?.roleLmuReserve || entry?.roleFormerLmu }),
      number('winsLmu', 'Siege LMU', false, { readonly: true, persist: false, visibleWhen: (entry) => entry?.roleLmuRegular || entry?.roleLmuReserve || entry?.roleFormerLmu }),
      number('winRateLmu', 'Siegesquote LMU (%)', false, { readonly: true, persist: false, visibleWhen: (entry) => entry?.roleLmuRegular || entry?.roleLmuReserve || entry?.roleFormerLmu }),
      number('podium1Lmu', 'Platz 1 LMU', false, { readonly: true, persist: false, visibleWhen: (entry) => entry?.roleLmuRegular || entry?.roleLmuReserve || entry?.roleFormerLmu }),
      number('podium2Lmu', 'Platz 2 LMU', false, { readonly: true, persist: false, visibleWhen: (entry) => entry?.roleLmuRegular || entry?.roleLmuReserve || entry?.roleFormerLmu }),
      number('podium3Lmu', 'Platz 3 LMU', false, { readonly: true, persist: false, visibleWhen: (entry) => entry?.roleLmuRegular || entry?.roleLmuReserve || entry?.roleFormerLmu })
    ]
  },
  lmuTeams: {
    title: 'LMU-Teams', group: 'Zentrale Rennteams',
    description: 'LMU-Team zentral mit Namen pflegen und ein Auto aus den LMU-Auto-Stammdaten zuordnen. Die Gesamtpunkte werden automatisch aus allen LMU-Saisonverläufen addiert.', model: models.Team, getListWhere: async () => ({ LeagueId: null, discipline: 'lmu' }), prepareValues: prepareLmuTeam, prepareEntry: (entry) => prepareTeamForForm(entry, 'lmu'),
    nextHref: '/admin/team-rosters/lmu', nextLabel: 'Danach LMU-Cockpits zusammenstellen',
    listFields: ['name', 'LmuCarId', 'totalPoints'],
    fields: [
      text('name', 'Teamname', true),
      relation('LmuCarId', 'LMU-Auto / Marke', models.LmuCar, (row) => `${row.manufacturer} · ${row.name}${row.vehicleClass ? ` · ${row.vehicleClass}` : ''}`, true),
      number('totalPoints', 'Gesamte Punkte (automatisch)', false, { readonly: true, persist: false })
    ]
  },
  lmuCars: {
    title: 'LMU-Autos & Marken', group: 'Zentrale Rennteams',
    description: 'LMU-Fahrzeuge einmalig als Stammdaten pflegen und anschließend den vorhandenen LMU-Teams zuordnen.', model: models.LmuCar,
    upload: { field: 'logoPath', label: 'Marken-/Fahrzeuglogo' }, beforeRemove: removeLmuCar,
    nextResource: 'lmuTeams', nextLabel: 'Danach vorhandenen LMU-Teams ein Auto zuordnen',
    listFields: ['manufacturer', 'name', 'vehicleClass'],
    fields: [
      text('manufacturer', 'Marke', true, { placeholder: 'Porsche' }),
      text('name', 'Auto / Modell', true, { placeholder: '963' }),
      text('vehicleClass', 'Klasse', false, { placeholder: 'Hypercar, LMP2 oder LMGT3' }),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  lmuDrivers: {
    title: 'LMU-Fahrer', group: 'LMU – Stammdaten',
    description: 'LMU-Fahrer aus den Stammdaten Teams zuordnen.', model: models.Driver, filterByLeague: true, getListWhere: listWhereForLeagueType('lmu'),
    upload: { field: 'avatarPath', label: 'Fahrerbild' }, prepareValues: prepareDriver, prepareEntry: prepareDriverForForm, afterSave: syncDriverAliases, hidden: true,
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      relation('TeamId', 'LMU-Team', models.Team, (row) => row.name), text('name', 'Fahrername', true), aliasesField(),
      platformField(), nationalityField(), text('car', 'Fahrzeug'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  wdlDrivers: {
    title: 'WDL-Fahrer', group: 'Wettkampf der Ligen',
    description: 'WDL-Fahrer einer teilnehmenden Liga zuordnen.', model: models.Driver, getListWhere: listWhereForLeagueType('competition'),
    upload: { field: 'avatarPath', label: 'Fahrerbild' }, prepareValues: prepareDriver, prepareEntry: prepareDriverForForm, afterSave: syncDriverAliases, hidden: true,
    fields: [
      relation('LeagueId', 'WDL-Wettbewerb', models.League, (row) => row.name, true, { where: { type: 'competition' } }),
      relation('ParticipatingLeagueId', 'Teilnehmende Liga / WDL-Team', models.ParticipatingLeague, (row) => row.abbreviation ? `${row.name} (${row.abbreviation})` : row.name, true),
      text('name', 'Fahrername', true), aliasesField(), platformField(), nationalityField(), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  gpResults: {
    title: 'Grand Prix & Rennposter', group: 'F1 – Saisonverlauf',
    description: 'Zuerst ein Rennen anlegen und optional das Rennposter hochladen.', model: models.GrandPrixResult,
    upload: { field: 'imagePath', label: 'Rennposter' }, hidden: true,
    nextResource: 'gpResultEntries', nextLabel: 'Danach Fahrer klassifizieren',
    fields: [
      relation('LeagueId', 'Liga', models.League, (row) => row.name, true, { where: { type: 'f1' } }),
      text('season', 'Saison', true), text('title', 'Grand Prix', true), text('circuit', 'Strecke'), date('raceDate', 'Renndatum'),
      number('sortOrder', 'Rennrunde', false, { min: 1, step: 1, help: 'Bestimmt die Reihenfolge im Ergebnis-Karussell.' })
    ]
  },
  gpResultEntries: {
    title: 'Saisonverlauf eintragen', group: 'F1 – Saisonverlauf',
    description: 'Hier pro Rennen die Stammfahrer, Positionen und Punkte erfassen. GP-Results sowie Fahrer- und Team-WM werden daraus automatisch erzeugt.', model: models.GrandPrixResultEntry,
    prepareValues: prepareRaceEntry, hidden: true,
    prepareEntry: prepareRaceEntryForForm,
    fields: [
      relation('GrandPrixResultId', 'Grand Prix', models.GrandPrixResult, (row) => `${row.season} · ${row.title}`, true),
      number('position', 'Platz', false, { min: 1, step: 1, help: 'Bei DNS/DNQ kann das Feld leer bleiben.' }),
      relation('DriverId', 'Stammfahrer', models.Driver, (row) => `#${row.id} · ${row.name} · ${row.platform}`, true),
      number('points', 'Punkte', true, { min: 0, step: 0.5 }),
      select('status', 'Rennstatus', [['', 'Gewertet / Zieleinlauf'], ['DNF', 'DNF – nicht beendet'], ['DNS', 'DNS – nicht gestartet'], ['DNQ', 'DNQ – nicht qualifiziert'], ['DSQ', 'DSQ – disqualifiziert'], ['DNA', 'DNA – nicht angetreten']], false),
      checkbox('fastestLap', 'Schnellste Runde'), number('sortOrder', 'Reihenfolge', false, { min: 0, step: 1 })
    ]
  },
  f1CalendarRounds: {
    title: 'F1-Rennkalender (aktuell)', group: 'Formel 1 Liga',
    description: 'Eine Strecke pflegen; Freitag und Sonntag werden automatisch als getrennte Rennen erzeugt.', model: models.F1CalendarRound,
    prepareValues: prepareF1Round, afterSave: syncF1CalendarRound, beforeRemove: removeF1CalendarRound, nextHref: '/admin/race-editor', nextLabel: 'Danach Saisonverlauf pflegen', cardView: 'calendar-f1',
    fields: [
      text('circuit', 'Strecke', true), date('sundayDate', 'Datum Sonntag'), date('fridayDate', 'Datum Freitag'),
      checkbox('hasSprint', 'Sprint-Event'),
      text('sundayTime', 'Startzeit Sonntag', false, { placeholder: '19:00' }), text('fridayTime', 'Startzeit Freitag', false, { placeholder: '19:30' }),
      number('sortOrder', 'Rennrunde', false, { min: 1, step: 1 })
    ]
  },
  seasonRaces: {
    title: 'Historische / manuelle Rennen', group: 'Saisonverwaltung',
    description: 'Rennen für historische Saisons oder manuelle Kalender anlegen.', model: models.GrandPrixResult,
    prepareValues: prepareSeasonRace, afterSave: syncSeasonRace, afterRemove: recalculateDriverRaceCounts, hidden: true,
    fields: [
      relation('SeasonId', 'Saison', models.Season, (row) => `${row.name} · ${row.scopeSlug}`, true),
      relation('LeagueId', 'Ligenseite', models.League, (row) => row.name, true),
      text('title', 'Rennen / GP', true), text('circuit', 'Strecke', true), date('raceDate', 'Datum', true),
      select('raceType', 'Rennentyp', [['main', 'Hauptrennen'], ['sprint', 'Sprintrennen']], true),
      number('sortOrder', 'Rennrunde', false, { min: 1, step: 1 })
    ]
  },
  lmuSeasonCalendar: {
    title: 'LMU-Rennkalender', group: 'LMU',
    description: 'Aktuelle LMU-Strecken mit Datum und Startzeit pflegen.', model: models.RaceEvent,
    prepareValues: prepareSeriesCalendar, afterSave: syncSeriesCalendarEvent, beforeRemove: removeSeriesCalendarEvent, cardView: 'calendar-series',
    fields: [
      relation('SeasonId', 'LMU-Saison', models.Season, (row) => row.name, true, { where: { leagueType: 'lmu' } }),
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      text('title', 'Rennen', true), text('circuit', 'Strecke', true), dateTime('startsAt', 'Datum und Startzeit', true),
      number('durationMinutes', 'Dauer in Minuten', false, { min: 1 }), checkbox('isPublished', 'Im Frontend anzeigen'),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  wdlSeasonCalendar: {
    title: 'WDL-Rennkalender', group: 'WDL',
    description: 'Aktuelle WDL-Strecken mit Datum und Startzeit pflegen.', model: models.RaceEvent,
    prepareValues: prepareSeriesCalendar, afterSave: syncSeriesCalendarEvent, beforeRemove: removeSeriesCalendarEvent, cardView: 'calendar-series',
    fields: [
      relation('SeasonId', 'WDL-Saison', models.Season, (row) => row.name, true, { where: { leagueType: 'wdl' } }),
      relation('LeagueId', 'WDL-Seite', models.League, (row) => row.name, true, { where: { type: 'competition' } }),
      text('title', 'Rennen', true), text('circuit', 'Strecke', true), dateTime('startsAt', 'Datum und Startzeit', true),
      checkbox('isPublished', 'Im Frontend anzeigen'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  lmuResultEntries: {
    title: 'LMU-Saisonverlauf', group: 'LMU',
    description: 'LMU-Platzierungen eintragen; Punkte, WM, GP-Results und Rennanzahl werden automatisch berechnet.', model: models.GrandPrixResultEntry,
    prepareValues: prepareSeriesEntry, afterSave: syncSeriesEntry, afterRemove: recalculateDriverRaceCounts, hidden: true,
    fields: [
      relation('GrandPrixResultId', 'LMU-Rennen', models.GrandPrixResult, (row) => `${row.season} · ${row.title}`, true, { where: { discipline: 'lmu' } }),
      relation('DriverId', 'Fahrer', models.Driver, (row) => `#${row.id} · ${row.name}`, true),
      number('position', 'Platz', false, { min: 1, step: 1 }),
      number('points', 'Punkte (automatisch)', false, { readonly: true, persist: false }),
      select('status', 'Status', [['', 'Gewertet'], ['DNF', 'DNF'], ['DNS', 'DNS'], ['DSQ', 'DSQ']], false),
      checkbox('fastestLap', 'Schnellste Runde'),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  wdlResultEntries: {
    title: 'WDL-Saisonverlauf', group: 'WDL',
    description: 'Zwei Fahrerplätze je Liga eintragen; Punkte, Liga-Standings, Results und Diagramm entstehen automatisch.', model: models.WdlResultEntry,
    prepareValues: prepareWdlResult, afterSave: syncWdlResult, hidden: true,
    fields: [
      relation('GrandPrixResultId', 'WDL-Rennen', models.GrandPrixResult, (row) => `${row.season} · ${row.title}`, true, { where: { discipline: 'wdl' } }),
      relation('ParticipatingLeagueId', 'WDL-Liga', models.ParticipatingLeague, (row) => row.name, true),
      relation('Driver1Id', 'Fahrer 1', models.Driver, (row) => `#${row.id} · ${row.name}`), number('positionOne', 'Platz Fahrer 1', false, { min: 1, step: 1 }),
      checkbox('fastestLapOne', 'Schnellste Runde Fahrer 1'),
      relation('Driver2Id', 'Fahrer 2', models.Driver, (row) => `#${row.id} · ${row.name}`), number('positionTwo', 'Platz Fahrer 2', false, { min: 1, step: 1 }),
      checkbox('fastestLapTwo', 'Schnellste Runde Fahrer 2'),
      number('totalPoints', 'Gesamtpunkte (automatisch)', false, { readonly: true, persist: false }),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  cockpits: {
    title: 'LMU-Cockpits', group: 'LMU',
    description: 'Fahrzeuge und Fahrerbesetzungen aus den LMU-Stammdaten auswählen.', model: models.LmuCockpit, upload: { field: 'logoPath', label: 'Cockpit-/Teamlogo' }, prepareValues: prepareCockpit, hidden: true,
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      text('teamName', 'Teamname', true), text('car', 'Fahrzeug'), text('vehicleClass', 'Klasse'), text('carNumber', 'Startnummer'),
      relation('Driver1Id', 'Fahrer 1', models.Driver, (row) => `#${row.id} · ${row.name} · ${row.platform}`),
      relation('Driver2Id', 'Fahrer 2', models.Driver, (row) => `#${row.id} · ${row.name} · ${row.platform}`),
      relation('Driver3Id', 'Fahrer 3', models.Driver, (row) => `#${row.id} · ${row.name} · ${row.platform}`),
      relation('ReserveDriverId', 'Ersatzfahrer', models.Driver, (row) => `#${row.id} · ${row.name} · ${row.platform}`),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  f1Calendar: {
    title: 'F1-Rennkalender', group: 'Rennkalender',
    description: 'Rennen anlegen und anschließend direkt den tabellarischen Saisonverlauf pflegen.', model: models.RaceEvent, getListWhere: listWhereForLeagueType('f1'), afterSave: syncCalendarGrandPrix, beforeRemove: removeCalendarGrandPrix,
    nextHref: '/admin/race-editor', nextLabel: 'Danach Saisonverlauf tabellarisch eingeben', hidden: true,
    fields: [
      relation('LeagueId', 'F1-Liga', models.League, (row) => row.name, true, { where: { type: 'f1' } }),
      text('title', 'Rennen', true), text('circuit', 'Strecke'), dateTime('startsAt', 'Startdatum und Uhrzeit', true),
      number('durationMinutes', 'Dauer in Minuten', false, { min: 1, step: 1 }), checkbox('isPublished', 'Auf Webseite anzeigen'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  lmuCalendar: {
    title: 'LMU-Rennkalender', group: 'Rennkalender',
    description: 'LMU-Termine pflegen; der nächste veröffentlichte Termin erscheint automatisch auf der Startseite.', model: models.RaceEvent, getListWhere: listWhereForLeagueType('lmu'), hidden: true,
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      text('title', 'Rennen', true), text('circuit', 'Strecke'), dateTime('startsAt', 'Startdatum und Uhrzeit', true),
      number('durationMinutes', 'Dauer in Minuten', false, { min: 1, step: 1 }), checkbox('isPublished', 'Auf Webseite anzeigen'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  lmuStandingImages: {
    title: 'LMU WM-Grafiken', group: 'LMU',
    description: 'Legacy-Wertungen für die LMU-Seite hochladen.', model: models.LmuStandingImage, upload: { field: 'imagePath', label: 'WM-Grafik', required: true }, hidden: true,
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      text('season', 'Saison', true), text('event', 'Rennevent'), text('title', 'Titel', true), textarea('description', 'Beschreibung'),
      text('altText', 'Bildbeschreibung', true, { help: 'Kurze Beschreibung für Screenreader.' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  participatingLeagues: {
    title: 'WDL-Ligen', group: 'WDL',
    description: 'WDL-Ligen mit Logo, Link, Aktivstatus und zugeordnetem zentralen Formel-1-Team verwalten.', model: models.ParticipatingLeague, upload: { field: 'logoPath', label: 'Liga-Logo' }, prepareValues: prepareParticipatingLeague, afterSave: syncParticipatingLeague,
    fields: [
      text('name', 'Liganame', true), text('abbreviation', 'Kürzel', false, { placeholder: 'KRL' }), text('constructorName', 'Konstrukteur'),
      url('websiteUrl', 'Link'), checkbox('isActive', 'Aktiv'),
      relation('F1TeamId', 'Zugeordnetes Formel-1-Team', models.Team, (row) => row.name, false, { where: { LeagueId: null, discipline: 'f1' } }),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  competitionStandings: {
    title: 'WDL-Teamstandings', group: 'Wettkampf der Ligen',
    description: 'Legacy-Tabelle; neue WDL-Standings werden aus dem Saisonverlauf berechnet.', model: models.LeagueCompetitionStanding, prepareValues: prepareWdlStanding, hidden: true,
    fields: [
      relation('ParticipatingLeagueId', 'Teilnehmende Liga', models.ParticipatingLeague, (row) => row.abbreviation ? `${row.name} (${row.abbreviation})` : row.name, true),
      number('position', 'Position', true, { min: 1, step: 1 }),
      relation('Driver1Id', 'Fahrer 1', models.Driver, (row) => `#${row.id} · ${row.name} · ${row.platform}`),
      relation('Driver2Id', 'Fahrer 2', models.Driver, (row) => `#${row.id} · ${row.name} · ${row.platform}`),
      text('constructorName', 'Konstrukteur'), number('points', 'Punkte', true, { min: 0, step: 0.5 }),
      number('wins', 'Siege', false, { min: 0, step: 1 }), text('gap', 'Rückstand'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  krlTeams: {
    title: 'Teams erstellen', group: 'Teams',
    description: 'Interne KRL-Teams anlegen; Fahrer-Rollen werden anschließend mit dem Plus-Bereich zugeordnet.', model: models.KrlTeam,
    nextResource: 'krlTeamAssignments', nextLabel: '+ Fahrer-Rolle hinzufügen',
    fields: [
      text('name', 'Name', true), text('slug', 'Kurzname für URL', true), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  krlTeamAssignments: {
    title: '+ Fahrer-Rollen', group: 'Teams',
    description: 'Einem KRL-Team per Plus-Zuordnung Fahrer und deren Funktion hinzufügen.', model: models.KrlTeamAssignment,
    prepareValues: prepareKrlAssignment,
    fields: [
      relation('KrlTeamId', 'KRL-Team', models.KrlTeam, (row) => row.name, true),
      relation('DriverId', 'Fahrer', models.Driver, (row) => `#${row.id} · ${row.name}`, true),
      text('roleName', 'Rolle / Funktion', true), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  krlIcons: {
    title: 'KRL Icons', group: 'KRL Icons',
    description: 'KRL-Icon aus Fahrer, Beschreibung und Ernennungsdatum pflegen.', model: models.KrlIcon,
    fields: [
      relation('DriverId', 'Fahrer', models.Driver, (row) => `#${row.id} · ${row.name}`, true),
      textarea('text', 'Text / Beschreibung', true), date('appointedAt', 'Ernennung'),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  }
};
