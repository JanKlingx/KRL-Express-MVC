const resourceConfig = require('./resourceConfig');

const progressModules = [
    ['teamGroups', { group: 'Unser-Team-Stammdaten', href: '/?editTeam=1#team', title: 'Unser Team bearbeiten', description: 'Gruppen auf der Startseite hinzufügen, bearbeiten und löschen.' }],
    ['f1Calendars', { group: 'Formel 1 Stammdaten', href: '/admin/f1-calendars', title: 'Zentrale F1-Rennkalender', description: 'Runden, Strecken, Sprint und Testtage einmal für Freitag, Samstag und Sonntag pflegen.' }],
    ['f1Games', { group: 'Formel 1 Stammdaten', href: '/admin/f1-games', title: 'F1-Spiele', description: 'Spielname, Logo, Aktivstatus und Reihenfolge zentral für alle F1-Saisons pflegen.' }],
    ['seasonManager', { group: 'Formel 1 Operativer Bereich', href: '/admin/season-manager', title: 'Saison bearbeiten / löschen', description: 'F1-Liga wählen, Saison bearbeiten, im Frontend ausblenden oder vollständig löschen.' }],
    ['tableHub', { group: 'Frontend', href: '/admin/table-hub', title: 'Tabellen-Hub', description: 'Alle Saisonverläufe, WM-Tabellen, GP-Results und Downloads zentral erreichen.' }],
    ['f1Setup', { group: 'Formel 1 Operativer Bereich', href: '/admin/season-setup', title: 'Saison erstellen', description: 'Acht Schritte: Liga, Saison, Kalender, Punkte, Fahrer, Teams, Line-up und Abschluss.' }],
    ['f1Rules', { group: 'Formel 1 Stammdaten', href: '/formel-1/regelwerk?edit=1', title: 'Regelwerk & Strafenkatalog', description: 'Strukturierte Regeln für die Freitags-, Samstags- und Sonntagsliga.' }],
    ['f1Notes', { group: 'Formel 1 Stammdaten', href: '/admin/race-director-notes', title: 'Race-Director Notes', description: 'PDFs hochladen, neueste Ausgabe hervorheben und das Archiv verwalten.' }],
    ['lmuRosters', { group: 'LMU Stammdaten', href: '/admin/team-rosters/lmu', title: 'LMU-Fahrerfeld', description: 'Teams auswählen; die zugeordneten LMU-Fahrer erscheinen klar pro Team.' }],
    ['f1Weekend', { group: 'Formel 1 Operativer Bereich', href: '/admin/race-weekend/f1', title: 'Rennwochenende Formel 1', description: 'Schritt für Schritt: Aufstellung, Anwesenheit/Strafen und Ergebnisse.' }],
    ['f1DriverChange', { group: 'Formel 1 Operativer Bereich', href: '/admin/season-driver-change', title: 'Fahrerwechsel', description: 'Stammfahrerwechsel und Beförderungen historisch korrekt ab einer Runde durchführen.' }],
    ['wdlWeekend', { group: 'Operative Prozesse · WDL', href: '/admin/race-weekend/wdl', title: 'Rennwochenende WDL', description: 'Ligen kontrollieren, Anwesenheit dokumentieren und Ergebnisse eintragen.' }],
    ['lmuWeekend', { group: 'Operative Prozesse · LMU', href: '/admin/race-weekend/lmu', title: 'Rennwochenende LMU', description: 'Schritt für Schritt mit LMU-Fahrern, Autos und Ergebnissen.' }],
    ['lmuSeasonProgress', { group: 'Operative Prozesse · LMU', href: '/admin/season-progress/lmu', title: 'Saisonverlauf LMU', description: 'Rennen und Ergebnisse tabellarisch und saisonbezogen pflegen.' }],
    ['penaltyLedger', { group: 'Formel 1 Operativer Bereich', href: '/admin/penalty-ledger', title: 'Formel 1 Strafkartei', description: 'Alle drei Ligen, Strafpunkte, Jahresablauf und rennbezogene Sperren.' }]
  ];

const categories = ['Formel 1', 'LMU', 'WDL', 'Allgemein'];
function category(key, config) {
  const label = `${config.group || ''} ${key}`;
  if (/lmu/i.test(label)) return 'LMU';
  if (/wdl|wettkampf/i.test(label)) return 'WDL';
  if (/formel|f1/i.test(label)) return 'Formel 1';
  return 'Allgemein';
}
function modules() {
  return [...progressModules, ...Object.entries(resourceConfig).filter(([, config]) => !config.hidden)];
}
function groups() {
  const all = modules();
  return categories.map(name => ({ name, modules: all.filter(([key, config]) => category(key, config) === name) }));
}
function favorites(value) {
  const allowed = new Set(modules().map(([key]) => key));
  return Array.isArray(value) ? [...new Set(value.filter(key => typeof key === 'string' && allowed.has(key)))] : [];
}
module.exports = { modules, groups, favorites };
