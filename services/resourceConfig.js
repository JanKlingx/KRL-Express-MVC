const models = require('../models');

const field = (name, label, type = 'text', required = false, options = {}) => ({
  name, label, type, required, ...options
});
const number = (name, label, required = false, options = {}) => field(name, label, 'number', required, { step: 'any', ...options });
const text = (name, label, required = false, options = {}) => field(name, label, 'text', required, options);
const textarea = (name, label, required = false, options = {}) => field(name, label, 'textarea', required, options);
const date = (name, label, required = false, options = {}) => field(name, label, 'date', required, options);
const url = (name, label, required = false, options = {}) => field(name, label, 'url', required, options);
const checkbox = (name, label, options = {}) => field(name, label, 'checkbox', false, options);
const select = (name, label, choices, required = false, options = {}) => field(name, label, 'select', required, { choices, ...options });
const relation = (name, label, model, formatOption, required = false, options = {}) => field(name, label, 'select', required, {
  relation: { model, formatOption, where: options.where },
  ...options,
  where: undefined
});

async function prepareDriver(values) {
  if (!values.TeamId) return;
  const team = await models.Team.findByPk(values.TeamId);
  if (!team || team.LeagueId !== Number(values.LeagueId)) throw new Error('Das ausgewählte Team gehört nicht zur ausgewählten Liga.');
}

async function prepareRaceEntry(values, body, existingEntry) {
  const [race, driver] = await Promise.all([
    models.GrandPrixResult.findByPk(body.GrandPrixResultId),
    models.Driver.findByPk(body.DriverId, { include: [{ model: models.Team, as: 'team' }] })
  ]);
  if (!race || !driver) throw new Error('Grand Prix und Stammfahrer müssen ausgewählt werden.');
  if (race.LeagueId !== driver.LeagueId) throw new Error('Der Stammfahrer gehört nicht zur Liga dieses Grand Prix.');
  const duplicate = await models.GrandPrixResultEntry.findOne({
    where: { GrandPrixResultId: race.id, driverName: driver.name }
  });
  if (duplicate && duplicate.id !== existingEntry?.id) throw new Error('Für diesen Stammfahrer existiert bei diesem Grand Prix bereits ein Ergebnis.');
  values.driverName = driver.name;
  values.teamName = driver.team?.name || 'Privatteam';
}

async function prepareRaceEntryForForm(entry) {
  if (!entry?.driverName) return entry;
  const values = typeof entry.toJSON === 'function' ? entry.toJSON() : { ...entry };
  const race = await models.GrandPrixResult.findByPk(values.GrandPrixResultId);
  const driver = race && await models.Driver.findOne({ where: { LeagueId: race.LeagueId, name: values.driverName } });
  return { ...values, DriverId: driver?.id || '' };
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
    description: 'Teams einer F1-Liga verwalten.', model: models.Team, upload: { field: 'logoPath', label: 'Teamlogo' },
    fields: [
      relation('LeagueId', 'Liga', models.League, (row) => `${row.name} · ${row.currentSeason}`, true, { where: { type: 'f1' } }),
      text('name', 'Teamname', true), text('car', 'Fahrzeug'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  drivers: {
    title: 'Stammfahrer-Verwaltung', group: 'F1 – Fahrer & Teams',
    description: 'Stammfahrer je F1-Liga verwalten und einem Team zuordnen.', model: models.Driver, filterByLeague: true,
    upload: { field: 'avatarPath', label: 'Fahrerbild' },
    prepareValues: prepareDriver,
    fields: [
      relation('LeagueId', 'Liga', models.League, (row) => row.name, true, { where: { type: 'f1' } }),
      relation('TeamId', 'Team', models.Team, (row) => `${row.name} · Liga #${row.LeagueId}`), text('name', 'Fahrername', true),
      number('number', 'Startnummer', false, { min: 0, step: 1 }), text('gamerTag', 'Gamertag'), text('nationality', 'Nationalität'),
      text('car', 'Fahrzeug'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  gpResults: {
    title: 'Grand Prix & Rennposter', group: 'F1 – Saisonverlauf',
    description: 'Zuerst ein Rennen anlegen und optional das Rennposter hochladen.', model: models.GrandPrixResult,
    upload: { field: 'imagePath', label: 'Rennposter' },
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
    prepareValues: prepareRaceEntry,
    prepareEntry: prepareRaceEntryForForm,
    fields: [
      relation('GrandPrixResultId', 'Grand Prix', models.GrandPrixResult, (row) => `${row.season} · ${row.title}`, true),
      number('position', 'Platz', false, { min: 1, step: 1, help: 'Bei DNS/DNQ kann das Feld leer bleiben.' }),
      relation('DriverId', 'Stammfahrer', models.Driver, (row) => `${row.name} · Liga #${row.LeagueId}`, true, { persist: false }),
      number('points', 'Punkte', true, { min: 0, step: 0.5 }),
      select('status', 'Rennstatus', [['', 'Gewertet / Zieleinlauf'], ['DNF', 'DNF – nicht beendet'], ['DNS', 'DNS – nicht gestartet'], ['DNQ', 'DNQ – nicht qualifiziert'], ['DSQ', 'DSQ – disqualifiziert'], ['DNA', 'DNA – nicht angetreten']], false),
      checkbox('fastestLap', 'Schnellste Runde'), number('sortOrder', 'Reihenfolge', false, { min: 0, step: 1 })
    ]
  },
  cockpits: {
    title: 'LMU-Cockpits', group: 'LMU',
    description: 'Fahrzeuge und Fahrerbesetzungen verwalten.', model: models.LmuCockpit, upload: { field: 'logoPath', label: 'Cockpit-/Teamlogo' },
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      text('teamName', 'Teamname', true), text('car', 'Fahrzeug'), text('vehicleClass', 'Klasse'),
      text('carNumber', 'Startnummer'), text('driver1', 'Fahrer 1'), text('driver2', 'Fahrer 2'), text('driver3', 'Fahrer 3'),
      text('reserveDriver', 'Ersatzfahrer'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
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
    title: 'Teilnehmende Ligen', group: 'Wettkampf der Ligen',
    description: 'Communities und Konstrukteure für den WDL verwalten.', model: models.ParticipatingLeague, upload: { field: 'logoPath', label: 'Liga-Logo' },
    fields: [
      text('name', 'Liganame', true), text('abbreviation', 'Kürzel', false, { placeholder: 'KRL' }), text('constructorName', 'Konstrukteur'),
      url('websiteUrl', 'Webseite'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  competitionStandings: {
    title: 'WDL-Teamstandings', group: 'Wettkampf der Ligen',
    description: 'Platzierung und Punkte der teilnehmenden Ligen pflegen.', model: models.LeagueCompetitionStanding,
    fields: [
      relation('ParticipatingLeagueId', 'Teilnehmende Liga', models.ParticipatingLeague, (row) => row.abbreviation ? `${row.name} (${row.abbreviation})` : row.name, true),
      number('position', 'Position', true, { min: 1, step: 1 }), text('drivers', 'Fahrer', false, { placeholder: 'Fahrer 1 / Fahrer 2' }),
      text('constructorName', 'Konstrukteur'), number('points', 'Punkte', true, { min: 0, step: 0.5 }),
      number('wins', 'Siege', false, { min: 0, step: 1 }), text('gap', 'Rückstand'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  }
};
