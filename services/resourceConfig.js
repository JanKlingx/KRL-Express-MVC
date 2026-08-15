const models = require('../models');

const number = (name, label, required = false) => ({ name, label, type: 'number', required });
const text = (name, label, required = false) => ({ name, label, type: 'text', required });
const textarea = (name, label, required = false) => ({ name, label, type: 'textarea', required });
const date = (name, label, required = false) => ({ name, label, type: 'date', required });

module.exports = {
  statistics: {
    title: 'Startseiten-Statistiken', model: models.SiteStatistic,
    fields: [text('key', 'Technischer Schlüssel', true), text('label', 'Bezeichnung', true), text('value', 'Wert', true), text('icon', 'Symbol'), number('sortOrder', 'Sortierung')]
  },
  teamCategories: {
    title: 'Team-Kategorien', model: models.TeamCategory,
    fields: [text('name', 'Name', true), text('slug', 'Slug', true), number('sortOrder', 'Sortierung')]
  },
  teamMembers: {
    title: 'Teammitglieder', model: models.TeamMember,
    fields: [number('TeamCategoryId', 'Kategorie-ID', true), text('name', 'Name', true), text('role', 'Funktion', true), number('joinedYear', 'Eintrittsjahr'), text('imagePath', 'Bildpfad'), number('sortOrder', 'Sortierung')]
  },
  leagues: {
    title: 'Ligen', model: models.League,
    fields: [text('name', 'Name', true), text('slug', 'Slug', true), text('type', 'Typ', true), text('currentSeason', 'Aktuelle Saison', true), text('raceDay', 'Renntag'), text('raceTime', 'Startzeit'), textarea('description', 'Beschreibung'), text('accentColor', 'Akzentfarbe'), text('logoPath', 'Logopfad'), number('sortOrder', 'Sortierung')]
  },
  teams: {
    title: 'F1-Teams', model: models.Team,
    fields: [number('LeagueId', 'Liga-ID', true), text('name', 'Teamname', true), text('logoPath', 'Logopfad'), text('car', 'Fahrzeug'), number('sortOrder', 'Sortierung')]
  },
  drivers: {
    title: 'Fahrerfelder', model: models.Driver,
    fields: [number('LeagueId', 'Liga-ID', true), number('TeamId', 'Team-ID'), text('name', 'Fahrername', true), number('number', 'Startnummer'), text('gamerTag', 'Gamertag'), text('nationality', 'Nationalität'), text('avatarPath', 'Avatarpfad'), text('car', 'Fahrzeug'), number('sortOrder', 'Sortierung')]
  },
  driverStandings: {
    title: 'Fahrer-WM', model: models.DriverStanding,
    fields: [number('LeagueId', 'Liga-ID', true), number('DriverId', 'Fahrer-ID', true), text('season', 'Saison', true), number('position', 'Position', true), number('points', 'Punkte', true), number('wins', 'Siege'), text('gap', 'Rückstand'), number('sortOrder', 'Sortierung')]
  },
  teamStandings: {
    title: 'Team-WM', model: models.TeamStanding,
    fields: [number('LeagueId', 'Liga-ID', true), number('TeamId', 'Team-ID', true), text('season', 'Saison', true), number('position', 'Position', true), number('points', 'Punkte', true), number('wins', 'Siege'), text('gap', 'Rückstand'), number('sortOrder', 'Sortierung')]
  },
  gpResults: {
    title: 'F1 GP-Ergebnisse (PNG)', model: models.GrandPrixResult, upload: 'imagePath',
    fields: [number('LeagueId', 'Liga-ID', true), text('season', 'Saison', true), text('title', 'Grand Prix', true), text('circuit', 'Strecke'), date('raceDate', 'Renndatum'), text('altText', 'Alternativtext', true), number('sortOrder', 'Sortierung')]
  },
  cockpits: {
    title: 'LMU-Cockpits', model: models.LmuCockpit,
    fields: [number('LeagueId', 'LMU-Liga-ID', true), text('teamName', 'Teamname', true), text('logoPath', 'Logopfad'), text('car', 'Fahrzeug'), text('vehicleClass', 'Klasse'), text('carNumber', 'Startnummer'), text('driver1', 'Fahrer 1'), text('driver2', 'Fahrer 2'), text('driver3', 'Fahrer 3'), text('reserveDriver', 'Ersatzfahrer'), number('sortOrder', 'Sortierung')]
  },
  lmuStandingImages: {
    title: 'LMU WM-Grafiken (PNG)', model: models.LmuStandingImage, upload: 'imagePath',
    fields: [number('LeagueId', 'LMU-Liga-ID', true), text('season', 'Saison', true), text('event', 'Rennevent'), text('title', 'Titel', true), textarea('description', 'Beschreibung'), text('altText', 'Alternativtext', true), number('sortOrder', 'Sortierung')]
  },
  participatingLeagues: {
    title: 'Teilnehmende Ligen', model: models.ParticipatingLeague,
    fields: [text('name', 'Liganame', true), text('abbreviation', 'Kürzel'), text('constructorName', 'Konstrukteur'), text('logoPath', 'Logopfad'), text('websiteUrl', 'Webseite'), number('sortOrder', 'Sortierung')]
  },
  competitionStandings: {
    title: 'Wettkampf-Teamstandings', model: models.LeagueCompetitionStanding,
    fields: [number('ParticipatingLeagueId', 'Teilnehmende-Liga-ID', true), number('position', 'Position', true), text('drivers', 'Fahrer'), text('constructorName', 'Konstrukteur'), number('points', 'Punkte', true), number('wins', 'Siege'), text('gap', 'Rückstand'), number('sortOrder', 'Sortierung')]
  }
};
