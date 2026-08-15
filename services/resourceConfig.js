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

const adminOnly = ['admin'];
const wdlAccess = ['admin', 'wdl'];

module.exports = {
  statistics: {
    title: 'Startseiten-Statistiken', group: 'Startseite & Team', roles: adminOnly,
    description: 'Kennzahlen auf der Startseite verwalten.', model: models.SiteStatistic,
    fields: [
      text('key', 'Technischer Schlüssel', true, { help: 'Einmaliger kurzer Name, z. B. aktive-fahrer.' }),
      text('label', 'Bezeichnung', true), text('value', 'Angezeigter Wert', true),
      text('icon', 'Symbol', false, { placeholder: '🏁' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  teamCategories: {
    title: 'Team-Kategorien', group: 'Startseite & Team', roles: adminOnly,
    description: 'Bereiche wie Rennleitung oder Administration.', model: models.TeamCategory,
    fields: [text('name', 'Name', true), text('slug', 'Kurzname für die URL', true, { help: 'Kleinbuchstaben ohne Leerzeichen, z. B. rennleitung.' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })]
  },
  teamMembers: {
    title: 'Teammitglieder', group: 'Startseite & Team', roles: adminOnly,
    description: 'Personen einer sichtbaren Team-Kategorie zuordnen.', model: models.TeamMember,
    fields: [
      relation('TeamCategoryId', 'Kategorie', models.TeamCategory, (row) => row.name, true),
      text('name', 'Name', true), text('role', 'Funktion', true), number('joinedYear', 'Eintrittsjahr', false, { min: 2000, step: 1 }),
      text('imagePath', 'Bildpfad', false, { placeholder: '/images/teammembers/name.jpg' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  leagues: {
    title: 'Ligen', group: 'Ligen & Stammdaten', roles: adminOnly,
    description: 'Grunddaten, Saison und Akzentfarbe einer Liga.', model: models.League,
    fields: [
      text('name', 'Name', true), text('slug', 'URL-Kurzname', true, { help: 'Beispiel: freitag oder sonntag.' }),
      select('type', 'Ligatyp', [['f1', 'Formel 1'], ['lmu', 'Le Mans Ultimate'], ['competition', 'Wettkampf der Ligen'], ['endurance', 'Endurance']], true),
      text('currentSeason', 'Aktuelle Saison', true, { placeholder: 'Saison 12' }), text('raceDay', 'Renntag'), text('raceTime', 'Startzeit', false, { placeholder: '20:00 Uhr' }),
      textarea('description', 'Beschreibung'), field('accentColor', 'Akzentfarbe', 'color', false),
      text('logoPath', 'Logopfad', false, { placeholder: '/images/logo.png' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  teams: {
    title: 'F1-Teams', group: 'F1 – Fahrer & Teams', roles: adminOnly,
    description: 'Teams einer F1-Liga verwalten.', model: models.Team,
    fields: [
      relation('LeagueId', 'Liga', models.League, (row) => `${row.name} · ${row.currentSeason}`, true, { where: { type: 'f1' } }),
      text('name', 'Teamname', true), text('logoPath', 'Logopfad'), text('car', 'Fahrzeug'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  drivers: {
    title: 'Fahrerfelder', group: 'F1 – Fahrer & Teams', roles: adminOnly,
    description: 'Fahrer anlegen und ohne ID-Suche einem Team zuordnen.', model: models.Driver,
    fields: [
      relation('LeagueId', 'Liga', models.League, (row) => row.name, true, { where: { type: 'f1' } }),
      relation('TeamId', 'Team', models.Team, (row) => row.name), text('name', 'Fahrername', true),
      number('number', 'Startnummer', false, { min: 0, step: 1 }), text('gamerTag', 'Gamertag'), text('nationality', 'Nationalität'),
      text('avatarPath', 'Avatarpfad'), text('car', 'Fahrzeug'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  driverStandings: {
    title: 'Fahrer-WM', group: 'F1 – Wertungen', roles: adminOnly,
    description: 'Aktuellen WM-Stand pro Fahrer pflegen.', model: models.DriverStanding,
    fields: [
      relation('LeagueId', 'Liga', models.League, (row) => row.name, true, { where: { type: 'f1' } }),
      relation('DriverId', 'Fahrer', models.Driver, (row) => row.gamerTag ? `${row.name} (${row.gamerTag})` : row.name, true),
      text('season', 'Saison', true, { placeholder: 'Saison 12' }), number('position', 'Position', true, { min: 1, step: 1 }),
      number('points', 'Punkte', true, { min: 0, step: 0.5 }), number('wins', 'Siege', false, { min: 0, step: 1 }),
      text('gap', 'Rückstand', false, { placeholder: 'Leader oder +25' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  teamStandings: {
    title: 'Team-WM', group: 'F1 – Wertungen', roles: adminOnly,
    description: 'Konstrukteurswertung pro Saison pflegen.', model: models.TeamStanding,
    fields: [
      relation('LeagueId', 'Liga', models.League, (row) => row.name, true, { where: { type: 'f1' } }),
      relation('TeamId', 'Team', models.Team, (row) => row.name, true), text('season', 'Saison', true),
      number('position', 'Position', true, { min: 1, step: 1 }), number('points', 'Punkte', true, { min: 0, step: 0.5 }),
      number('wins', 'Siege', false, { min: 0, step: 1 }), text('gap', 'Rückstand'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  gpResults: {
    title: 'Grand Prix', group: 'F1 – Rennergebnisse', roles: adminOnly,
    description: 'Zuerst ein Rennen anlegen, danach die Klassifikation hinzufügen.', model: models.GrandPrixResult,
    nextResource: 'gpResultEntries', nextLabel: 'Danach Fahrer klassifizieren',
    fields: [
      relation('LeagueId', 'Liga', models.League, (row) => row.name, true, { where: { type: 'f1' } }),
      text('season', 'Saison', true), text('title', 'Grand Prix', true), text('circuit', 'Strecke'), date('raceDate', 'Renndatum'),
      number('sortOrder', 'Rennrunde', false, { min: 1, step: 1, help: 'Bestimmt die Reihenfolge im Ergebnis-Karussell.' })
    ]
  },
  gpResultEntries: {
    title: 'GP-Klassifikationen', group: 'F1 – Rennergebnisse', roles: adminOnly,
    description: 'Fahrerposition, Rennstatus und Punkte für ein Rennen erfassen.', model: models.GrandPrixResultEntry,
    fields: [
      relation('GrandPrixResultId', 'Grand Prix', models.GrandPrixResult, (row) => `${row.season} · ${row.title}`, true),
      number('position', 'Platz', false, { min: 1, step: 1, help: 'Bei DNS/DNQ kann das Feld leer bleiben.' }),
      text('driverName', 'Fahrer', true), text('teamName', 'Team'), number('points', 'Punkte', true, { min: 0, step: 0.5 }),
      select('status', 'Rennstatus', [['', 'Gewertet / Zieleinlauf'], ['DNF', 'DNF – nicht beendet'], ['DNS', 'DNS – nicht gestartet'], ['DNQ', 'DNQ – nicht qualifiziert'], ['DSQ', 'DSQ – disqualifiziert'], ['DNA', 'DNA – nicht angetreten']], false),
      checkbox('fastestLap', 'Schnellste Runde'), number('sortOrder', 'Reihenfolge', false, { min: 0, step: 1 })
    ]
  },
  historySources: {
    title: 'Saisonverlauf', group: 'F1 – Rennergebnisse', roles: adminOnly,
    description: 'Öffentliches Google Sheet als Quelle für die Saisonmatrix.', model: models.LeagueHistorySource,
    fields: [
      relation('LeagueId', 'Liga', models.League, (row) => row.name, true, { where: { type: 'f1' } }),
      text('label', 'Quellenname', true, { placeholder: 'Google Sheets – Freitagsliga' }),
      url('sheetUrl', 'Öffentlicher Google-Sheets-Link', true, { help: 'Normaler Freigabe- oder Veröffentlichungslink von docs.google.com.' }),
      number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  cockpits: {
    title: 'LMU-Cockpits', group: 'LMU', roles: adminOnly,
    description: 'Fahrzeuge und Fahrerbesetzungen verwalten.', model: models.LmuCockpit,
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      text('teamName', 'Teamname', true), text('logoPath', 'Logopfad'), text('car', 'Fahrzeug'), text('vehicleClass', 'Klasse'),
      text('carNumber', 'Startnummer'), text('driver1', 'Fahrer 1'), text('driver2', 'Fahrer 2'), text('driver3', 'Fahrer 3'),
      text('reserveDriver', 'Ersatzfahrer'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  lmuStandingImages: {
    title: 'LMU WM-Grafiken', group: 'LMU', roles: adminOnly,
    description: 'PNG-Wertungen für die LMU-Seite hochladen.', model: models.LmuStandingImage, upload: 'imagePath',
    fields: [
      relation('LeagueId', 'LMU-Liga', models.League, (row) => row.name, true, { where: { type: 'lmu' } }),
      text('season', 'Saison', true), text('event', 'Rennevent'), text('title', 'Titel', true), textarea('description', 'Beschreibung'),
      text('altText', 'Bildbeschreibung', true, { help: 'Kurze Beschreibung für Screenreader.' }), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  participatingLeagues: {
    title: 'Teilnehmende Ligen', group: 'Wettkampf der Ligen', roles: wdlAccess,
    description: 'Communities und Konstrukteure für den WDL verwalten.', model: models.ParticipatingLeague,
    fields: [
      text('name', 'Liganame', true), text('abbreviation', 'Kürzel', false, { placeholder: 'KRL' }), text('constructorName', 'Konstrukteur'),
      text('logoPath', 'Logopfad'), url('websiteUrl', 'Webseite'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  },
  competitionStandings: {
    title: 'WDL-Teamstandings', group: 'Wettkampf der Ligen', roles: wdlAccess,
    description: 'Platzierung und Punkte der teilnehmenden Ligen pflegen.', model: models.LeagueCompetitionStanding,
    fields: [
      relation('ParticipatingLeagueId', 'Teilnehmende Liga', models.ParticipatingLeague, (row) => row.abbreviation ? `${row.name} (${row.abbreviation})` : row.name, true),
      number('position', 'Position', true, { min: 1, step: 1 }), text('drivers', 'Fahrer', false, { placeholder: 'Fahrer 1 / Fahrer 2' }),
      text('constructorName', 'Konstrukteur'), number('points', 'Punkte', true, { min: 0, step: 0.5 }),
      number('wins', 'Siege', false, { min: 0, step: 1 }), text('gap', 'Rückstand'), number('sortOrder', 'Reihenfolge', false, { min: 0 })
    ]
  }
};
