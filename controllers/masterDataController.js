exports.masterData = async (req, res) => {
  const resourceConfig = require('../services/resourceConfig');
  const modules = Object.entries(resourceConfig).filter(([, config]) => !config.hidden);
  const counts = Object.fromEntries(await Promise.all(modules.map(async ([key, config]) => [key, await config.model.count({ where: config.getListWhere ? await config.getListWhere() : {} })])));
  
  const groups = modules.reduce((result, [key, config]) => {
    const group = config.group || 'Weitere Inhalte';
    const existing = result.find((entry) => entry.name === group);
    if (existing) existing.modules.push([key, config]);
    else result.push({ name: group, modules: [[key, config]] });
    return result;
  }, []);

  // Master Data Modules - organized by section
  const masterDataModules = [
    // Frontend
    ['tableHub', { group: 'Frontend', href: '/admin/table-hub', title: 'Tabellen-Hub', description: 'Alle Saisonverläufe, WM-Tabellen, GP-Results und Downloads zentral erreichen.' }],
    
    // Unser-Team-Stammdaten
    ['ourTeamMembers', { group: 'Unser-Team-Stammdaten', href: '/admin/our-team-members', title: 'Teamstammdaten', description: 'Teams und Fahrer zuordnen.' }],
    
    // Stammdaten - general
    ['pointsSchemes', { group: 'Stammdaten', href: '/admin/point-schemes', title: 'Punktesystem-Pflege', description: 'Punktesysteme pro Disziplin definieren.' }],
    ['drivers', { group: 'Stammdaten', href: '/admin/drivers', title: 'Fahrerpflege', description: 'Fahrer pro Liga und Rang verwalten.' }],
    ['raceCalendarEditor', { group: 'Stammdaten', href: '/admin/race-calendar', title: 'Rennkalender bearbeiten', description: 'Liga, Saison, Termine bearbeiten.' }],
    
    // Formel 1 Stammdaten
    ['teams', { group: 'Formel 1 Stammdaten', href: '/admin/teams', title: 'Formel-1-Teams', description: 'Aktuelle F1-Teams mit Farben verwalten.' }],
    ['f1Tracks', { group: 'Formel 1 Stammdaten', href: '/admin/f1-tracks', title: 'F1 Strecken pflegen', description: 'Land und Streckennamen für Rennkalender.' }],
    
    // KRL F1 LIGA Stammdaten
    ['f1SeasonAssistant', { group: 'KRL F1 LIGA Stammdaten', href: '/admin/season-setup', title: 'Saison-Assistent F1', description: 'Spiel, Saison, Kalender, Fahrer, Teams, LINE UP.' }],
    ['f1SeasonEdit', { group: 'KRL F1 LIGA Stammdaten', href: '/admin/f1-season-edit', title: 'F1 Saison bearbeiten', description: 'Saisonname, Status, Farbe, Ausblenden.' }],
    ['f1CalendarEditor', { group: 'KRL F1 LIGA Stammdaten', href: '/admin/f1-calendar-editor', title: 'F1 Rennkalender bearbeiten/löschen', description: 'Liga → Saison → bearbeiten.' }],
    
    // Rennleitungsstammdaten F1
    ['f1PenaltySystem', { group: 'Rennleitungsstammdaten F1', href: '/admin/f1-penalty-system', title: 'Strafpunktesystem F1', description: 'Strafe zu Strafpunkten zuordnen.' }],
    
    // LMU Stammdaten
    ['lmuTeams', { group: 'LMU Stammdaten', href: '/admin/lmu-teams', title: 'LMU-Teams', description: 'LMU-Teams verwalten.' }],
    ['lmuCars', { group: 'LMU Stammdaten', href: '/admin/lmu-cars', title: 'LMU Auto & Marken', description: 'LMU-Fahrzeuge verwalten.' }],
    
    // Rennleitungsstammdaten LMU
    ['lmuPenaltySystem', { group: 'Rennleitungsstammdaten LMU', href: '/admin/lmu-penalty-system', title: 'Strafpunktesystem LMU', description: 'Strafe zu Strafpunkten, Rennsperren.' }],
    
    // WDL Stammdaten
    ['wdlSeasonAssistant', { group: 'WDL Stammdaten', href: '/admin/wdl-season-setup', title: 'Saison-Assistent WDL', description: 'Spiel, Saison, Kalender, Ligen, Teams.' }],
    ['wdlSeasonEdit', { group: 'WDL Stammdaten', href: '/admin/wdl-season-edit', title: 'WDL Saison bearbeiten', description: 'Saisonname, Status, Farbe, Ausblenden.' }],
    ['wdlCalendarEditor', { group: 'WDL Stammdaten', href: '/admin/wdl-calendar-editor', title: 'WDL Rennkalender bearbeiten/löschen', description: 'Spiel → Saison → bearbeiten.' }],
    
    // Rennleitungsstammdaten WDL
    ['wdlPenaltySystem', { group: 'Rennleitungsstammdaten WDL', href: '/admin/wdl-penalty-system', title: 'Strafpunktesystem WDL', description: 'Strafe zu Strafpunkten zuordnen.' }],
  ];

  masterDataModules.forEach(([key, config]) => {
    const group = groups.find((entry) => entry.name === config.group);
    if (group) group.modules.unshift([key, config]);
    else groups.push({ name: config.group, modules: [[key, config]] });
  });

  const groupOrder = [
    'Frontend',
    'Unser-Team-Stammdaten',
    'KRL Icons',
    'Stammdaten',
    'Formel 1 Stammdaten',
    'KRL F1 LIGA Stammdaten',
    'Rennleitungsstammdaten F1',
    'LMU Stammdaten',
    'Rennleitungsstammdaten LMU',
    'WDL Stammdaten',
    'Rennleitungsstammdaten WDL'
  ];
  
  groups.sort((left, right) => groupOrder.indexOf(left.name) - groupOrder.indexOf(right.name));
  const masterDataGroups = groups.filter((group) => groupOrder.includes(group.name));

  res.render('admin/master-data', {
    title: 'Stammdaten',
    groups: masterDataGroups,
    counts,
    adminBasePath: req.adminBasePath || '/admin',
    dashboardTitle: 'STAMMDATEN',
    dashboardEyebrow: 'KRL & WDL VERWALTUNG',
    dashboardDescription: 'Fahrer, Teams, Ligas und Saisonkalender zentral verwalten.'
  });
};
