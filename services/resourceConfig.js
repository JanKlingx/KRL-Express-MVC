const models = require('../models');
const { Op } = require('sequelize');

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

async function prepareDriver(values) {
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
    if (!driver || driver.LeagueId !== Number(values.LeagueId)) throw new Error('Alle ausgewählten Cockpit-Fahrer müssen zur gewählten LMU-Liga gehören.');
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

module.exports = {
  statistics: {
    title: 'Startseiten-Statistiken', group: 'Startseite & Team',
    description: 'Kennzahlen auf der Startseite verwalten.', model: models.SiteStatistic,
    fields: [
      text('key', 'Technischer Schlüssel', true, { help: 'Einmaliger kurzer Name, z. B. aktive-fahrer.' }),
      text('label', 'Bezeichnung', true), text('value', 'Angezeigter Wert', true),
      text('icon', 'Symbol', false, { placeholder: '🏁' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  teamCategories: {
    title: 'Team-Kategorien', group: 'Startseite & Team',
    description: 'Bereiche wie Rennleitung oder Administration.', model: models.TeamCategory,
    fields: [text('name', 'Name', true), text('slug', 'Kurzname für die URL', true, { help: 'Kleinbuchstaben ohne Leerzeichen, z. B. rennleitung.' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })]
  },
  teamMembers: {
    title: 'Teammitglieder', group: 'Startseite & Team',
    description: 'Personen einer sichtbaren Team-Kategorie zuordnen.', model: models.TeamMember, upload: { field: 'imagePath', label: 'Personenbild' },
    fields: [
      relation('TeamCategoryId', 'Kategorie', models.TeamCategory, (row) => row.name, true),
      text('name', 'Name', true), text('role', 'Funktion', true), number('joinedYear', 'Eintrittsjahr', false, { min: 2000, step: 1 }),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  leagues: {
    title: 'Ligen', group: 'Ligen & Stammdaten',
    description: 'Grunddaten, Saison und Akzentfarbe einer Liga.', model: models.League, upload: { field: 'logoPath', label: 'Liga-Logo' },
    fields: [
      text('name', 'Name', true), text('slug', 'URL-Kurzname', true, { help: 'Beispiel: freitag oder sonntag.' }),
      select('type', 'Ligatyp', [['f1', 'Formel 1'], ['lmu', 'Le Mans Ultimate'], ['competition', 'Wettkampf der Ligen'], ['endurance', 'Endurance']], true),
      text('currentSeason', 'Aktuelle Saison', true, { placeholder: 'Saison 12' }), text('raceDay', 'Renntag'), text('raceTime', 'Startzeit', false, { placeholder: '20:00 Uhr' }),
      textarea('description', 'Beschreibung'), field('accentColor', 'Akzentfarbe', 'color', false),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  teams: {
    title: 'F1-Teams', group: 'F1 – Fahrer & Teams',
    description: 'Teams einer F1-Liga verwalten.', model: models.Team, upload: { field: 'logoPath', label: 'Teamlogo' }, getListWhere: listWhereForLeagueType('f1'),
    fields: [
      relation('LeagueId', 'Liga', models.League, (row) => `${row.name} · ${row.currentSeason}`, true, { where: { type: 'f1' } }),
      text('name', 'Teamname', true), text('car', 'Fahrzeug'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  drivers: {
    title: 'F1-Fahrer', group: 'F1 – Fahrer & Teams',
    description: 'F1-Stammfahrer je Liga verwalten und einem Team zuordnen.', model: models.Driver, filterByLeague: true, getListWhere: listWhereForLeagueType('f1'),
    upload: { field: 'avatarPath', label: 'Fahrerbild' },
    prepareValues: prepareDriver, prepareEntry: prepareDriverForForm, afterSave: syncDriverAliases,
    fields: [
      relation('LeagueId', 'Stammfahrer-Rolle', models.League, (row) => row.slug === 'freitag' ? 'Stamm Freitag' : row.slug === 'sonntag' ? 'Stamm Sonntag' : `Stamm ${row.name}`, true, { where: { type: 'f1' } }),
      relation('TeamId', 'Team', models.Team, (row) => row.name), text('name', 'Fahrername', true), aliasesField(),
      number('number', 'Startnummer', false, { min: 0, step: 1 }), platformField(), text('nationality', 'Nationalität'),
      text('car', 'Fahrzeug'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  lmuTeams: {
    title: 'LMU-Teams', group: 'LMU – Stammdaten',
    description: 'Teams und Fahrzeuge der LMU-Liga verwalten.', model: models.Team, upload: { field: 'logoPath', label: 'Teamlogo' }, getListWhere: listWhereForLeagueType('lmu'),
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      text('name', 'Teamname', true), text('car', 'Fahrzeug'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  lmuDrivers: {
    title: 'LMU-Fahrer', group: 'LMU – Stammdaten',
    description: 'LMU-Fahrer aus den Stammdaten Teams zuordnen.', model: models.Driver, filterByLeague: true, getListWhere: listWhereForLeagueType('lmu'),
    upload: { field: 'avatarPath', label: 'Fahrerbild' }, prepareValues: prepareDriver, prepareEntry: prepareDriverForForm, afterSave: syncDriverAliases,
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      relation('TeamId', 'LMU-Team', models.Team, (row) => row.name), text('name', 'Fahrername', true), aliasesField(),
      platformField(), text('nationality', 'Nationalität'), text('car', 'Fahrzeug'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  wdlDrivers: {
    title: 'WDL-Fahrer', group: 'Wettkampf der Ligen',
    description: 'WDL-Fahrer einer teilnehmenden Liga zuordnen.', model: models.Driver, getListWhere: listWhereForLeagueType('competition'),
    upload: { field: 'avatarPath', label: 'Fahrerbild' }, prepareValues: prepareDriver, prepareEntry: prepareDriverForForm, afterSave: syncDriverAliases,
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
    nextHref: '/admin/race-editor', nextLabel: 'Danach Saisonverlauf tabellarisch eingeben',
    fields: [
      relation('LeagueId', 'F1-Liga', models.League, (row) => row.name, true, { where: { type: 'f1' } }),
      text('title', 'Rennen', true), text('circuit', 'Strecke'), dateTime('startsAt', 'Startdatum und Uhrzeit', true),
      number('durationMinutes', 'Dauer in Minuten', false, { min: 1, step: 1 }), checkbox('isPublished', 'Auf Webseite anzeigen'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  lmuCalendar: {
    title: 'LMU-Rennkalender', group: 'Rennkalender',
    description: 'LMU-Termine pflegen; der nächste veröffentlichte Termin erscheint automatisch auf der Startseite.', model: models.RaceEvent, getListWhere: listWhereForLeagueType('lmu'),
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      text('title', 'Rennen', true), text('circuit', 'Strecke'), dateTime('startsAt', 'Startdatum und Uhrzeit', true),
      number('durationMinutes', 'Dauer in Minuten', false, { min: 1, step: 1 }), checkbox('isPublished', 'Auf Webseite anzeigen'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  lmuStandingImages: {
    title: 'LMU WM-Grafiken', group: 'LMU',
    description: 'Wertungen für die LMU-Seite hochladen.', model: models.LmuStandingImage, upload: { field: 'imagePath', label: 'WM-Grafik', required: true },
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      text('season', 'Saison', true), text('event', 'Rennevent'), text('title', 'Titel', true), textarea('description', 'Beschreibung'),
      text('altText', 'Bildbeschreibung', true, { help: 'Kurze Beschreibung für Screenreader.' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  participatingLeagues: {
    title: 'WDL-Teams / Ligen', group: 'Wettkampf der Ligen',
    description: 'Communities und Konstrukteure für den WDL verwalten.', model: models.ParticipatingLeague, upload: { field: 'logoPath', label: 'Liga-Logo' },
    fields: [
      text('name', 'Liganame', true), text('abbreviation', 'Kürzel', false, { placeholder: 'KRL' }), text('constructorName', 'Konstrukteur'),
      url('websiteUrl', 'Webseite'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  competitionStandings: {
    title: 'WDL-Teamstandings', group: 'Wettkampf der Ligen',
    description: 'Platzierung, Punkte und Fahrer aus den WDL-Stammdaten pflegen.', model: models.LeagueCompetitionStanding, prepareValues: prepareWdlStanding,
    fields: [
      relation('ParticipatingLeagueId', 'Teilnehmende Liga', models.ParticipatingLeague, (row) => row.abbreviation ? `${row.name} (${row.abbreviation})` : row.name, true),
      number('position', 'Position', true, { min: 1, step: 1 }),
      relation('Driver1Id', 'Fahrer 1', models.Driver, (row) => `#${row.id} · ${row.name} · ${row.platform}`),
      relation('Driver2Id', 'Fahrer 2', models.Driver, (row) => `#${row.id} · ${row.name} · ${row.platform}`),
      text('constructorName', 'Konstrukteur'), number('points', 'Punkte', true, { min: 0, step: 0.5 }),
      number('wins', 'Siege', false, { min: 0, step: 1 }), text('gap', 'Rückstand'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  }
};
