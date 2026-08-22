const workflowMap = {
  f1: {
    label: 'Formel 1',
    accent: '#00aaff',
    steps: [
      { label: 'Fahrereinteilung', href: '/admin/race-weekend/f1', description: 'Stammfahrer und Ersatzfahrer pro Rennen zuordnen.' },
      { label: 'Anwesenheitskontrolle', href: '/admin/race-weekend/f1', description: 'Anwesenheit und Strafpunkte kontrollieren.' },
      { label: 'Ergebnisse eintragen', href: '/admin/race-weekend/f1', description: 'Fahrerplatzierungen eintragen.' },
      { label: 'Saisonverlauf', href: '/admin/season-progress/f1', description: 'Gesamtsaisonverlauf bearbeiten.' }
    ]
  },
  wdl: {
    label: 'WDL',
    accent: '#7a5cff',
    steps: [
      { label: 'Ligen Kontrolle', href: '/admin/race-weekend/wdl', description: 'Ligenteilnahme prüfen.' },
      { label: 'Anwesenheitskontrolle', href: '/admin/race-weekend/wdl', description: 'Anwesenheit und Strafpunkte kontrollieren.' },
      { label: 'Ergebnisse eintragen', href: '/admin/race-weekend/wdl', description: 'Ligenergebnisse eintragen.' },
      { label: 'Saisonverlauf', href: '/admin/season-progress/wdl', description: 'Gesamtsaisonverlauf bearbeiten.' }
    ]
  },
  lmu: {
    label: 'LMU',
    accent: '#17c7a5',
    steps: [
      { label: 'Fahrereinteilung', href: '/admin/race-weekend/lmu', description: 'Stammfahrer und Ersatzfahrer pro Rennen zuordnen.' },
      { label: 'Anwesenheitskontrolle', href: '/admin/race-weekend/lmu', description: 'Anwesenheit und Strafpunkte kontrollieren.' },
      { label: 'Ergebnisse eintragen', href: '/admin/race-weekend/lmu', description: 'Fahrerplatzierungen eintragen.' },
      { label: 'Saisonverlauf', href: '/admin/season-progress/lmu', description: 'Gesamtsaisonverlauf bearbeiten.' }
    ]
  }
};

exports.show = async (req, res) => {
  const workflows = Object.entries(workflowMap).map(([key, workflow]) => ({
    key,
    label: workflow.label,
    accent: workflow.accent,
    steps: workflow.steps.map((step, index) => ({ ...step, number: index + 1 }))
  }));

  res.render('admin/process-overview', {
    title: 'Operative Prozesse',
    workflows,
    adminBasePath: req.adminBasePath || '/admin',
    dashboardEyebrow: 'KRL & WDL VERWALTUNG'
  });
};
