const resourceConfig = require('./resourceConfig');

const progressModules = [
    ['lmuCalendars', { group:'LMU Stammdaten', href:'/admin/lmu-calendars', title:'Zentrale LMU-Rennkalender', description:'Kalendervorlagen mit Rennterminen und Testtagen pflegen.' }],
    ['lmuGames', { group:'LMU Stammdaten', href:'/admin/lmu-games', title:'LMU-Spiel', description:'Spiel und Logo für den Saisonverlauf pflegen.' }],
    ['lmuSetup', { group:'LMU Operativer Bereich', href:'/admin/lmu-season-setup', title:'LMU-Saison erstellen', description:'Liga, Kalender, Punkte, Teams und Fahrer gemeinsam einrichten.' }],
    ['lmuSeasons', { group:'LMU Operativer Bereich', href:'/admin/lmu-seasons', title:'LMU-Saison bearbeiten / löschen', description:'Saison, Veröffentlichung, Spiel und Punktesystem verwalten.' }],
    ['lmuDriverChange', { group:'LMU Operativer Bereich', href:'/admin/lmu-driver-change', title:'LMU-Fahrerwechsel', description:'Stammplätze ab einer Runde vergeben, wechseln oder abgeben.' }],
    ['lmuRules', { group:'LMU Stammdaten', href:'/lmu/regelwerk?edit=1', title:'LMU-Regelwerk & Strafenkatalog', description:'Abschnitte, Regeln und Strafen direkt bearbeiten.' }],
    ['lmuNotes', { group:'LMU Stammdaten', href:'/admin/lmu-race-director-notes', title:'LMU Race-Director Notes', description:'PDFs für LMU veröffentlichen und archivieren.' }],
    ['lmuPenalties', { group:'LMU Operativer Bereich', href:'/admin/lmu-penalty-ledger', title:'LMU-Strafkartei', description:'Rundenmatrix, Zellfarben, Strafpunkte und Rennsperren wie bei Formel 1.' }],
    ['lmuCarAssignments', { group:'LMU Stammdaten', href:'/admin/lmu-car-assignments', title:'Fahrern LMU-Autos zuordnen', description:'Persönliche Autos und Marken für Stamm- und Ersatzfahrer.' }],
    ['teamGroups', { group: 'Unser-Team-Stammdaten', href: '/?editTeam=1#team', title: 'Unser Team bearbeiten', description: 'Gruppen auf der Startseite hinzufügen, bearbeiten und löschen.' }],
    ['f1Calendars', { group: 'Formel 1 Stammdaten', href: '/admin/f1-calendars', title: 'Zentrale F1-Rennkalender', description: 'Runden, Strecken, Sprint und Testtage einmal für Freitag, Samstag und Sonntag pflegen.' }],
    ['f1Games', { group: 'Formel 1 Stammdaten', href: '/admin/f1-games', title: 'F1-Spiele', description: 'Spielname, Logo, Aktivstatus und Reihenfolge zentral für alle F1-Saisons pflegen.' }],
    ['seasonManager', { group: 'Formel 1 Operativer Bereich', href: '/admin/season-manager', title: 'Saison bearbeiten / löschen', description: 'F1-Liga wählen, Saison bearbeiten, im Frontend ausblenden oder vollständig löschen.' }],
    ['tableHub', { group: 'Frontend', href: '/admin/table-hub', title: 'Tabellen-Hub', description: 'Alle Saisonverläufe, WM-Tabellen, GP-Results und Downloads zentral erreichen.' }],
    ['f1Setup', { group: 'Formel 1 Operativer Bereich', href: '/admin/season-setup', title: 'Saison erstellen', description: 'Acht Schritte: Liga, Saison, Kalender, Punkte, Fahrer, Teams, Line-up und Abschluss.' }],
    ['f1Rules', { group: 'Formel 1 Stammdaten', href: '/formel-1/regelwerk?edit=1', title: 'Regelwerk & Strafenkatalog', description: 'Strukturierte Regeln für die Freitags-, Samstags- und Sonntagsliga.' }],
    ['f1Notes', { group: 'Formel 1 Stammdaten', href: '/admin/race-director-notes', title: 'Race-Director Notes', description: 'PDFs hochladen, neueste Ausgabe hervorheben und das Archiv verwalten.' }],
    ['f1Weekend', { group: 'Formel 1 Operativer Bereich', href: '/admin/race-weekend/f1', title: 'Rennwochenende Formel 1', description: 'Schritt für Schritt: Aufstellung, Anwesenheit/Strafen und Ergebnisse.' }],
    ['f1DriverChange', { group: 'Formel 1 Operativer Bereich', href: '/admin/season-driver-change', title: 'Fahrerwechsel', description: 'Stammfahrerwechsel und Beförderungen historisch korrekt ab einer Runde durchführen.' }],
    ['wdlWeekend', { group: 'Operative Prozesse · WDL', href: '/admin/race-weekend/wdl', title: 'Rennwochenende WDL', description: 'Ligen kontrollieren, Anwesenheit dokumentieren und Ergebnisse eintragen.' }],
    ['lmuWeekend', { group: 'Operative Prozesse · LMU', href: '/admin/race-weekend/lmu', title: 'Rennwochenende LMU', description: 'Schritt für Schritt mit LMU-Fahrern, Autos und Ergebnissen.' }],
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
function favorites(value) {
  const allowed = new Set(modules().map(([key]) => key));
  return Array.isArray(value) ? [...new Set(value.filter(key => typeof key === 'string' && allowed.has(key)))] : [];
}

const defaultIds = ['f1', 'lmu', 'wdl', 'general'];
function layout(value) {
  const saved = Array.isArray(value?.categories) ? value.categories : [];
  const result = categories.map((name, i) => {
    const previous = saved.find(row => row?.id === defaultIds[i]);
    return { id: defaultIds[i], name: String(previous?.name || name).slice(0, 60), collapsed: previous?.collapsed === true };
  });
  for (const row of saved) {
    if (result.length >= 30) break;
    if (row && /^cat_[a-f0-9-]{36}$/.test(row.id) && typeof row.name === 'string' && row.name.trim() && !result.some(c => c.id === row.id)) result.push({ id: row.id, name: row.name.trim().slice(0, 60), collapsed: row.collapsed === true });
  }
  const placements = Object.fromEntries(modules().map(([key, config]) => {
    const chosen = value?.placements?.[key];
    return [key, result.some(c => c.id === chosen) ? chosen : defaultIds[categories.indexOf(category(key, config))]];
  }));
  return { categories: result, placements };
}
function applyLayout(value, action) {
  const current = layout(value);
  const target = current.categories.find(row => row.id === action.category);
  if (action.action === 'create' || action.action === 'rename') {
    const name = String(action.name || '').trim();
    if (!name || name.length > 60) throw new Error('Kategoriename: Bitte 1 bis 60 Zeichen eingeben.');
    if (current.categories.some(row => (action.action !== 'rename' || row.id !== target?.id) && row.name.toLocaleLowerCase('de') === name.toLocaleLowerCase('de'))) throw new Error('Dieser Kategoriename ist bereits vergeben.');
    if (action.action === 'create') {
      if (current.categories.length >= 30) throw new Error('Maximal 30 Kategorien sind möglich.');
      current.categories.push({ id: 'cat_' + require('node:crypto').randomUUID(), name, collapsed: false });
    } else { if (!target) throw new Error('Kategorie nicht gefunden.'); target.name = name; }
  } else if (action.action === 'move') {
    if (!target || !modules().some(([key]) => key === action.module)) throw new Error('Kategorie oder Transaktion nicht gefunden.');
    current.placements[action.module] = target.id;
  } else if (action.action === 'collapse') {
    if (!target || !['0', '1'].includes(action.collapsed)) throw new Error('Ungültige Kategorie.');
    target.collapsed = action.collapsed === '1';
  } else if (action.action === 'delete') {
    if (!target || defaultIds.includes(target.id)) throw new Error('Die vier Standardkategorien bleiben erhalten.');
    current.categories = current.categories.filter(row => row.id !== target.id);
    for (const [key, config] of modules()) if (current.placements[key] === target.id) current.placements[key] = defaultIds[categories.indexOf(category(key, config))];
  } else throw new Error('Ungültige Kategorieaktion.');
  return current;
}
function groups(value) {
  const current = layout(value), all = modules();
  return current.categories.map(row => ({ ...row, modules: all.filter(([key]) => current.placements[key] === row.id) }));
}
module.exports = { modules, groups, favorites, layout, applyLayout };
