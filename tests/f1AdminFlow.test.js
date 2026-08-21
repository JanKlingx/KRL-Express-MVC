const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

const views = path.join(__dirname, '..', 'views');
const layout = { currentPath: '/admin', isAdmin: true, adminRole: 'admin', adminHome: '/admin', flash: null };

test('Rennwochenende zeigt den dreistufigen F1-Prozess samt Ersatz in der Anwesenheit', async () => {
  const league = { id: 1, name: 'Freitagsliga', slug: 'freitag' };
  const season = { id: 2, name: 'Saison 14' };
  const race = { id: 3, title: 'Belgien GP' };
  const driver = { id: 4, name: 'Stammfahrer' };
  const team = { id: 5, name: 'Mercedes', logoPath: '/uploads/team.png' };
  const entry = { id: 6, DriverId: 4, roleType: 'regular', status: 'anwesend', attendanceStatus: null, includeInResults: false, driver, replacementFor: null };
  const html = await ejs.renderFile(path.join(views, 'admin', 'race-weekend.ejs'), {
    ...layout, title: 'Rennwochenende Formel 1', leagues: [league], league, seasons: [season], season,
    events: [{ id: 7, sortOrder: 1, title: race.title }], event: { id: 7 }, race, entries: [entry],
    attendanceRows: [{ entry, displayTeam: team }], availableReplacements: [{ id: 8, name: 'Ersatzfahrer' }],
    attendanceStatuses: [
      { value: 'anwesend', label: 'Anwesend' }, { value: 'unabgemeldet', label: 'Unabgemeldet' },
      { value: 'zu_spaet_abgemeldet', label: 'Zu spät abgemeldet' }, { value: 'zu_spaet_vorbesprechung', label: 'Zu spät Vorbesprechung' }
    ],
    lineupHref: '/admin/f1-race-lineup?league=1&race=3', resultsHref: '/admin/current-season-progress?league=1&race=3'
  });
  assert.match(html, /AUFSTELLUNG/);
  assert.match(html, /ANWESENHEITSKONTROLLE/);
  assert.match(html, /ERGEBNISSE EINTRAGEN/);
  assert.match(html, /Ersatzfahrer/);
  assert.match(html, /attendance\[6\]\[includeInResults\]/);
});

test('F1-Strafkartei rendert Stamm-, Ersatz- und ehemalige Fahrer ohne editierbaren Namen', async () => {
  const league = { id: 1, name: 'Freitagsliga', accentColor: '#00aaff' };
  const driver = {
    id: 2, name: 'Max Beispiel', team: { name: 'Mercedes', accentColor: '#00d2be', logoPath: null },
    penalties: [{ id: 9, points: 3, reason: 'Zu spät', isRaceBan: false }], points: 3, remaining: 9, suspended: false
  };
  const html = await ejs.renderFile(path.join(views, 'admin', 'penalty-ledger.ejs'), {
    ...layout, title: 'Formel 1 Strafkartei', ledgers: [{
      league, activeSeason: { name: 'Saison 14' }, races: [{ id: 4, sortOrder: 1, title: 'Belgien GP' }], threshold: 12,
      groups: { regular: [driver], reserve: [], former: [] }
    }]
  });
  assert.match(html, /STAMMFAHRER/);
  assert.match(html, /ERSATZFAHRER/);
  assert.match(html, /EHEMALIGE FAHRER MIT SP/);
  assert.match(html, /Rennsperre ab 12 SP/);
  assert.doesNotMatch(html, /name="driverName"/);
});

test('Kalenderbearbeitung lädt Strecke, Land und Flagge aus dem Stammsatz und unterstützt Drag-and-Drop', async () => {
  const league = { id: 1, name: 'Freitagsliga' };
  const season = { id: 2, name: 'Saison 14', status: 'active' };
  const country = { id: 3, name: 'Belgien', flagPath: '/uploads/be.png' };
  const track = { id: 4, name: 'Spa-Francorchamps', country: 'Belgien', countryRecord: country };
  const event = { id: 5, F1TrackId: 4, title: 'Belgien GP', circuit: track.name, startsAt: new Date('2026-09-04T20:00:00Z'), sortOrder: 1, isTestDay: false, hasSprint: true, track };
  const html = await ejs.renderFile(path.join(views, 'admin', 'season-calendar.ejs'), {
    ...layout, title: 'Rennkalender bearbeiten', leagues: [league], selectedLeague: league,
    seasons: [season], selectedSeason: season, events: [event], tracks: [track], defaultTime: '20:00'
  });
  assert.match(html, /data-sortable-calendar/);
  assert.match(html, /data-calendar-event="5"/);
  assert.match(html, /Spa-Francorchamps/);
  assert.match(html, /Belgien/);
  assert.match(html, /\/uploads\/be\.png/);
  assert.doesNotMatch(html, /Dauer/);
});

test('Regelwerk und Race-Director-Archiv sind öffentlich lesbar', async () => {
  const rules = await ejs.renderFile(path.join(views, 'f1-rules.ejs'), {
    ...layout, currentPath: '/formel-1/regelwerk', title: 'Regelwerk',
    sections: [{ id: 1, sectionType: 'rule', title: 'Startverfahren', content: 'Fair starten.', sortOrder: 1 }]
  });
  const notes = await ejs.renderFile(path.join(views, 'race-director-notes.ejs'), {
    ...layout, currentPath: '/formel-1/race-director-notes', title: 'Race-Director Notes',
    documents: [
      { id: 2, title: 'Belgien GP', publishedAt: '2026-09-01', documentPath: '/uploads/latest.pdf' },
      { id: 1, title: 'Monza GP', publishedAt: '2026-08-20', documentPath: '/uploads/old.pdf' }
    ]
  });
  assert.match(rules, /Startverfahren/);
  assert.match(notes, /NEUESTE AUSGABE/);
  assert.match(notes, /<iframe/);
  assert.match(notes, /ÄLTERE DOKUMENTE/);
});
