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

async function prepareDriver(values, body) {
  if (Object.prototype.hasOwnProperty.call(body, 'roleF1Friday') || Object.prototype.hasOwnProperty.call(body, 'roleF1Sunday') || Object.prototype.hasOwnProperty.call(body, 'roleF1Reserve')) {
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
  [Op.or]: [{ roleF1Friday: true }, { roleF1Sunday: true }, { roleF1Reserve: true }, { roleLmuRegular: true }, { roleLmuReserve: true }]
});

const platformField = () => select('platform', 'Plattform', [['PC', 'PC'], ['PlayStation', 'PlayStation'], ['Xbox', 'Xbox']], true);
const aliasesField = () => textarea('aliasesText', 'Aliase / frühere Namen', false, { persist: false, help: 'Mehrere Namen mit Komma oder jeweils in einer neuen Zeile trennen.' });

async function prepareDriverForForm(entry) {
  if (!entry?.id) return entry;
  const values = typeof entry.toJSON === 'function' ? entry.toJSON() : { ...entry };
  const aliases = await models.DriverAlias.findAll({ where: { DriverId: entry.id }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  return { ...values, aliasesText: aliases.map((alias) => alias.alias).join(', ') };
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
  const assignments = await models.Team.findAll({
    where: { [Op.or]: [{ Driver1Id: driver.id }, { Driver2Id: driver.id }] },
    include: [{ model: models.League, as: 'league' }]
  });
  for (const team of assignments) {
    const roleField = team.league?.slug === 'freitag' ? 'roleF1Friday' : 'roleF1Sunday';
    if (!driver[roleField]) {
      const changes = {};
      if (team.Driver1Id === driver.id) changes.Driver1Id = null;
      if (team.Driver2Id === driver.id) changes.Driver2Id = null;
      await team.update(changes);
    }
  }
}

async function prepareF1Team(values, body, existingTeam) {
  if (values.Driver1Id && values.Driver2Id && Number(values.Driver1Id) === Number(values.Driver2Id)) {
    throw new Error('Fahrer A und Fahrer B müssen unterschiedliche Fahrer sein.');
  }
  const league = await models.League.findByPk(values.LeagueId);
  if (!league || league.type !== 'f1') throw new Error('Bitte eine F1-Liga auswählen.');
  const expectedRoleField = league.slug === 'freitag' ? 'roleF1Friday' : 'roleF1Sunday';
  for (const fieldName of ['Driver1Id', 'Driver2Id']) {
    if (!values[fieldName]) continue;
    const driver = await models.Driver.findByPk(values[fieldName]);
    if (!driver || !driver[expectedRoleField]) {
      throw new Error(`Für ${league.name} können nur Fahrer mit der passenden Stammfahrer-Rolle ausgewählt werden.`);
    }
    const otherTeam = await models.Team.findOne({
      where: {
        id: { [Op.ne]: existingTeam?.id || 0 },
        LeagueId: league.id,
        [Op.or]: [{ Driver1Id: driver.id }, { Driver2Id: driver.id }]
      }
    });
    if (otherTeam) throw new Error(`${driver.name} ist bereits einem anderen F1-Team zugeordnet.`);
  }
}

async function syncF1Team(team) {
  const participants = await models.ParticipatingLeague.findAll({ where: { F1TeamId: team.id } });
  for (const participant of participants) await syncParticipatingLeague(participant);
  return team;
}

async function removeF1Team(team) {
  return team;
}

async function removeF1Driver(driver) {
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
  values.points = await pointsForPosition(values.position);
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
  for (const driverId of [values.Driver1Id, values.Driver2Id].filter(Boolean)) {
    const driver = await models.Driver.findByPk(driverId);
    const teamDriverIds = [league.f1Team?.Driver1Id, league.f1Team?.Driver2Id].filter(Boolean).map(Number);
    if (!driver || (Number(driver.ParticipatingLeagueId) !== league.id && !teamDriverIds.includes(Number(driver.id)))) throw new Error('Die ausgewählten Fahrer müssen aus dem zugeordneten F1-Team oder der gewählten WDL-Liga stammen.');
  }
  const duplicate = await models.WdlResultEntry.findOne({ where: { GrandPrixResultId: race.id, ParticipatingLeagueId: league.id } });
  if (duplicate && duplicate.id !== existingEntry?.id) throw new Error('Für diese Liga existiert bereits eine Ergebniszeile.');
  values.pointsOne = await pointsForPosition(values.positionOne);
  values.pointsTwo = await pointsForPosition(values.positionTwo);
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
  const entries = await models.WdlResultEntry.findAll({
    where: { ParticipatingLeagueId: participant.id, GrandPrixResultId: { [Op.in]: races.map((race) => race.id) } }
  });
  for (const entry of entries) {
    const values = {};
    if (!entry.positionOne) values.Driver1Id = freshParticipant.f1Team.Driver1Id || null;
    if (!entry.positionTwo) values.Driver2Id = freshParticipant.f1Team.Driver2Id || null;
    if (Object.keys(values).length) await entry.update(values);
  }
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
    description: 'Globale Punkte je Platzierung. Änderungen gelten sofort für F1, LMU und WDL.', model: models.PointsRule, afterSave: recalculateAllPoints, afterRemove: recalculateAllPoints,
    fields: [
      number('position', 'Platz', true, { min: 1, step: 1 }), number('points', 'Punktewert', true, { min: 0, step: 0.5 }),
      number('sortOrder', 'Reihenfolge', false, { min: 0, step: 1 })
    ]
  },
  seasons: {
    title: 'Saisons', group: 'Saisonverwaltung',
    description: 'Aktuelle und historische Saisons für Frontend, Kalender, Results und Wertungen verwalten.', model: models.Season,
    prepareValues: prepareSeason, afterSave: syncSeason,
    fields: [
      text('name', 'Saisonname', true, { placeholder: '2024, Season 8 oder WDL 2023' }),
      select('leagueType', 'Ligatyp', [['f1', 'Formel 1'], ['lmu', 'LMU'], ['wdl', 'WDL']], true),
      select('scopeSlug', 'Bereich / Ligenseite', [['freitag', 'F1 Freitag'], ['sonntag', 'F1 Sonntag'], ['lmu', 'LMU'], ['wettkampf', 'WDL']], true),
      select('status', 'Saisonstatus', [['active', 'Aktiv'], ['historical', 'Historisch']], true),
      select('calendarMode', 'Rennkalender-Modus', [['automatic', 'Automatisch aus Stammdaten'], ['manual', 'Manuell pflegen']], true),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  teams: {
    title: 'F1-Teams', group: 'Formel 1 Liga',
    description: 'Teams getrennt für Freitag und Sonntag pflegen und jeweils Fahrer A und Fahrer B zuordnen.', model: models.Team, upload: { field: 'logoPath', label: 'Teamlogo' }, getListWhere: listWhereForLeagueType('f1'), filterByLeague: true, filterLabel: 'Teampflege nach Liga', prepareValues: prepareF1Team, afterSave: syncF1Team, beforeRemove: removeF1Team,
    fields: [
      relation('LeagueId', 'Liga', models.League, (row) => `${row.name} · ${row.currentSeason}`, true, { where: { type: 'f1' } }),
      text('name', 'Teamname', true), text('car', 'Fahrzeug'),
      relation('Driver1Id', 'Fahrer A', models.Driver, (row) => `#${row.id} · ${row.name}`, false, { where: { [Op.or]: [{ roleF1Friday: true }, { roleF1Sunday: true }] } }),
      relation('Driver2Id', 'Fahrer B', models.Driver, (row) => `#${row.id} · ${row.name}`, false, { where: { [Op.or]: [{ roleF1Friday: true }, { roleF1Sunday: true }] } }),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  drivers: {
    title: 'Fahrer-Pflege', group: 'Stammdaten',
    description: 'Zentrale Fahrer-Stammdaten. Rollen sind kombinierbar; gefahrene F1-/LMU-Rennen werden automatisch gezählt.', model: models.Driver,
    upload: { field: 'avatarPath', label: 'Fahrerbild' },
    prepareValues: prepareDriver, prepareEntry: prepareDriverForForm, afterSave: syncF1Driver, beforeRemove: removeF1Driver,
    fields: [
      text('name', 'Name', true), aliasesField(), platformField(),
      number('racesF1', 'Gefahrene Rennen F1', false, { min: 0, step: 1, readonly: true, persist: false }),
      number('racesLmu', 'Gefahrene Rennen LMU', false, { min: 0, step: 1, readonly: true, persist: false }),
      checkbox('roleF1Friday', 'Rang: Stamm Freitag'), checkbox('roleF1Sunday', 'Rang: Stamm Sonntag'),
      checkbox('roleF1Reserve', 'Rang: F1 Ersatz'), checkbox('roleLmuRegular', 'Rang: LMU Stammfahrer'),
      checkbox('roleLmuReserve', 'Rang: LMU Ersatzfahrer'),
      number('number', 'Startnummer', false, { min: 0, step: 1 }), text('nationality', 'Nationalität'),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  lmuTeams: {
    title: 'LMU-Teams', group: 'LMU',
    description: 'Teams und Fahrzeuge der LMU-Liga verwalten.', model: models.Team, upload: { field: 'logoPath', label: 'Teamlogo' }, getListWhere: listWhereForLeagueType('lmu'),
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      text('name', 'Teamname', true), text('car', 'Fahrzeug'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  lmuDrivers: {
    title: 'LMU-Fahrer', group: 'LMU – Stammdaten',
    description: 'LMU-Fahrer aus den Stammdaten Teams zuordnen.', model: models.Driver, filterByLeague: true, getListWhere: listWhereForLeagueType('lmu'),
    upload: { field: 'avatarPath', label: 'Fahrerbild' }, prepareValues: prepareDriver, prepareEntry: prepareDriverForForm, afterSave: syncDriverAliases, hidden: true,
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      relation('TeamId', 'LMU-Team', models.Team, (row) => row.name), text('name', 'Fahrername', true), aliasesField(),
      platformField(), text('nationality', 'Nationalität'), text('car', 'Fahrzeug'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  wdlDrivers: {
    title: 'WDL-Fahrer', group: 'Wettkampf der Ligen',
    description: 'WDL-Fahrer einer teilnehmenden Liga zuordnen.', model: models.Driver, getListWhere: listWhereForLeagueType('competition'),
    upload: { field: 'avatarPath', label: 'Fahrerbild' }, prepareValues: prepareDriver, prepareEntry: prepareDriverForForm, afterSave: syncDriverAliases, hidden: true,
    fields: [
      relation('LeagueId', 'WDL-Wettbewerb', models.League, (row) => row.name, true, { where: { type: 'competition' } }),
      relation('ParticipatingLeagueId', 'Teilnehmende Liga / WDL-Team', models.ParticipatingLeague, (row) => row.abbreviation ? `${row.name} (${row.abbreviation})` : row.name, true),
      text('name', 'Fahrername', true), aliasesField(), platformField(), text('nationality', 'Nationalität'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
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
    prepareValues: prepareF1Round, afterSave: syncF1CalendarRound, beforeRemove: removeF1CalendarRound, nextHref: '/admin/race-editor', nextLabel: 'Danach Saisonverlauf pflegen',
    fields: [
      text('circuit', 'Strecke', true), date('sundayDate', 'Datum Sonntag'), date('fridayDate', 'Datum Freitag'),
      text('sundayTime', 'Startzeit Sonntag', false, { placeholder: '19:00' }), text('fridayTime', 'Startzeit Freitag', false, { placeholder: '19:30' }),
      number('sortOrder', 'Rennrunde', false, { min: 1, step: 1 })
    ]
  },
  seasonRaces: {
    title: 'Historische / manuelle Rennen', group: 'Saisonverwaltung',
    description: 'Rennen für historische Saisons oder manuelle Kalender anlegen.', model: models.GrandPrixResult,
    prepareValues: prepareSeasonRace, afterSave: syncSeasonRace, afterRemove: recalculateDriverRaceCounts,
    fields: [
      relation('SeasonId', 'Saison', models.Season, (row) => `${row.name} · ${row.scopeSlug}`, true),
      relation('LeagueId', 'Ligenseite', models.League, (row) => row.name, true),
      text('title', 'Rennen / GP', true), text('circuit', 'Strecke', true), date('raceDate', 'Datum', true),
      number('sortOrder', 'Rennrunde', false, { min: 1, step: 1 })
    ]
  },
  lmuSeasonCalendar: {
    title: 'LMU-Rennkalender', group: 'LMU',
    description: 'Aktuelle LMU-Strecken mit Datum und Startzeit pflegen.', model: models.RaceEvent,
    prepareValues: prepareSeriesCalendar, afterSave: syncSeriesCalendarEvent, beforeRemove: removeSeriesCalendarEvent,
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
    prepareValues: prepareSeriesCalendar, afterSave: syncSeriesCalendarEvent, beforeRemove: removeSeriesCalendarEvent,
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
    prepareValues: prepareSeriesEntry, afterSave: syncSeriesEntry, afterRemove: recalculateDriverRaceCounts,
    fields: [
      relation('GrandPrixResultId', 'LMU-Rennen', models.GrandPrixResult, (row) => `${row.season} · ${row.title}`, true, { where: { discipline: 'lmu' } }),
      relation('DriverId', 'Fahrer', models.Driver, (row) => `#${row.id} · ${row.name}`, true),
      number('position', 'Platz', false, { min: 1, step: 1 }),
      number('points', 'Punkte (automatisch)', false, { readonly: true, persist: false }),
      select('status', 'Status', [['', 'Gewertet'], ['DNF', 'DNF'], ['DNS', 'DNS'], ['DSQ', 'DSQ']], false),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  wdlResultEntries: {
    title: 'WDL-Saisonverlauf', group: 'WDL',
    description: 'Zwei Fahrerplätze je Liga eintragen; Punkte, Liga-Standings, Results und Diagramm entstehen automatisch.', model: models.WdlResultEntry,
    prepareValues: prepareWdlResult, afterSave: syncWdlResult,
    fields: [
      relation('GrandPrixResultId', 'WDL-Rennen', models.GrandPrixResult, (row) => `${row.season} · ${row.title}`, true, { where: { discipline: 'wdl' } }),
      relation('ParticipatingLeagueId', 'WDL-Liga', models.ParticipatingLeague, (row) => row.name, true),
      relation('Driver1Id', 'Fahrer 1', models.Driver, (row) => `#${row.id} · ${row.name}`), number('positionOne', 'Platz Fahrer 1', false, { min: 1, step: 1 }),
      relation('Driver2Id', 'Fahrer 2', models.Driver, (row) => `#${row.id} · ${row.name}`), number('positionTwo', 'Platz Fahrer 2', false, { min: 1, step: 1 }),
      number('totalPoints', 'Gesamtpunkte (automatisch)', false, { readonly: true, persist: false }),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  cockpits: {
    title: 'LMU-Cockpits', group: 'LMU',
    description: 'Fahrzeuge und Fahrerbesetzungen aus den LMU-Stammdaten auswählen.', model: models.LmuCockpit, upload: { field: 'logoPath', label: 'Cockpit-/Teamlogo' }, prepareValues: prepareCockpit,
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
    description: 'WDL-Ligen mit Logo, Link, Aktivstatus und zugeordnetem Formel-1-Team verwalten.', model: models.ParticipatingLeague, upload: { field: 'logoPath', label: 'Liga-Logo' }, afterSave: syncParticipatingLeague,
    fields: [
      text('name', 'Liganame', true), text('abbreviation', 'Kürzel', false, { placeholder: 'KRL' }), text('constructorName', 'Konstrukteur'),
      url('websiteUrl', 'Link'), checkbox('isActive', 'Aktiv'),
      relation('F1TeamId', 'Zugeordnetes Formel-1-Team', models.Team, (row) => row.name, false),
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
