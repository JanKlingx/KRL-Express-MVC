require('dotenv').config();
const bcrypt = require('bcrypt');
const {
  sequelize, User, SiteStatistic, TeamCategory, TeamMember, League, Team, Driver,
  DriverStanding, TeamStanding, GrandPrixResult, GrandPrixResultEntry, RaceEvent, Season, LmuCockpit, LmuStandingImage,
  ParticipatingLeague, LeagueCompetitionStanding
} = require('../models');
const { ensureSchema } = require('../services/schema');

async function seedF1(league, season, prefix) {
  const teamData = [
    { name: `${prefix} Apex Motorsport`, car: 'Ferrari' },
    { name: `${prefix} Velocity Racing`, car: 'McLaren' },
    { name: `${prefix} Nightshift GP`, car: 'Mercedes' },
    { name: `${prefix} Horizon Racing`, car: 'Red Bull' }
  ];
  const teams = [];
  for (let i = 0; i < teamData.length; i += 1) {
    const [team] = await Team.findOrCreate({ where: { LeagueId: league.id, name: teamData[i].name }, defaults: { ...teamData[i], LeagueId: league.id, sortOrder: i } });
    teams.push(team);
  }
  const drivers = [];
  for (let i = 0; i < 8; i += 1) {
    const [driver] = await Driver.findOrCreate({
      where: { LeagueId: league.id, name: `KRL Fahrer ${i + 1}` },
      defaults: { LeagueId: league.id, TeamId: teams[Math.floor(i / 2)].id, f1Role: league.slug === 'freitag' ? 'friday' : 'sunday', roleF1Friday: league.slug === 'freitag', roleF1Sunday: league.slug === 'sonntag', name: `KRL Fahrer ${i + 1}`, number: 11 + i * 3, nationality: i % 2 ? 'DE' : 'AT', sortOrder: i }
    });
    drivers.push(driver);
    await driver.update({ f1Role: league.slug === 'freitag' ? 'friday' : 'sunday', roleF1Friday: league.slug === 'freitag', roleF1Sunday: league.slug === 'sonntag' });
    await DriverStanding.findOrCreate({ where: { LeagueId: league.id, DriverId: driver.id, season: league.currentSeason }, defaults: { LeagueId: league.id, DriverId: driver.id, season: league.currentSeason, position: i + 1, points: 164 - i * 15, wins: Math.max(0, 4 - i), gap: i === 0 ? 'Leader' : `+${i * 15}`, sortOrder: i } });
  }
  for (let i = 0; i < teams.length; i += 1) {
    const assignedIds = [drivers[i * 2]?.id, drivers[i * 2 + 1]?.id].filter(Boolean);
    await teams[i].update({ Driver1Id: assignedIds[0] || null, Driver2Id: assignedIds[1] || null });
    await Driver.update({ TeamId: null }, { where: { TeamId: teams[i].id } });
    if (assignedIds.length) await Driver.update({ TeamId: teams[i].id }, { where: { id: assignedIds } });
  }
  for (let i = 0; i < teams.length; i += 1) {
    await TeamStanding.findOrCreate({ where: { LeagueId: league.id, TeamId: teams[i].id, season: league.currentSeason }, defaults: { LeagueId: league.id, TeamId: teams[i].id, season: league.currentSeason, position: i + 1, points: 290 - i * 58, wins: 5 - i * 2, gap: i === 0 ? 'Leader' : `+${i * 58}`, sortOrder: i } });
  }
  const [grandPrix] = await GrandPrixResult.findOrCreate({
    where: { LeagueId: league.id, season: league.currentSeason, title: 'Großer Preis von Spa' },
    defaults: { LeagueId: league.id, SeasonId: season.id, season: league.currentSeason, title: 'Großer Preis von Spa', circuit: 'Circuit de Spa-Francorchamps', raceDate: '2026-08-01', discipline: 'f1', sortOrder: 1 }
  });
  await grandPrix.update({ SeasonId: season.id, discipline: 'f1', isHistorical: false });
  const pointsByPosition = [25, 18, 15, 12, 10, 8, 6, 4];
  for (let i = 0; i < drivers.length; i += 1) {
    const [entry] = await GrandPrixResultEntry.findOrCreate({
      where: { GrandPrixResultId: grandPrix.id, driverName: drivers[i].name },
      defaults: {
        GrandPrixResultId: grandPrix.id,
        DriverId: drivers[i].id,
        position: i + 1,
        driverName: drivers[i].name,
        teamName: teams[Math.floor(i / 2)].name,
        points: pointsByPosition[i],
        fastestLap: i === 0,
        sortOrder: i
      }
    });
    if (!entry.DriverId) await entry.update({ DriverId: drivers[i].id });
  }
}

async function run() {
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL und ADMIN_PASSWORD müssen in der .env-Datei gesetzt sein.');
  }
  await sequelize.sync();
  await ensureSchema();
  const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  const adminEmail = process.env.ADMIN_EMAIL.toLowerCase();
  const [admin, created] = await User.findOrCreate({ where: { email: adminEmail }, defaults: { email: adminEmail, passwordHash, role: 'admin' } });
  if (!created) await admin.update({ passwordHash, role: 'admin' });

  const statistics = [
    ['seasons', 'gefahrene Saisons', '12', '🏁'], ['drivers', 'aktive Fahrer', '96', '◉'],
    ['leagues', 'KRL-Ligen', '5', '◆'], ['followers', 'Twitch-Follower', '1.8K', '⚡']
  ];
  for (let i = 0; i < statistics.length; i += 1) {
    const [key, label, value, icon] = statistics[i];
    await SiteStatistic.findOrCreate({ where: { key }, defaults: { key, label, value, icon, sortOrder: i } });
  }

  const categoryData = [
    ['Planungsgruppe', 'planung', ['Ligaleitung', 'Eventplanung', 'Community']],
    ['Administration', 'administration', ['Technik', 'Discord', 'Webseite']],
    ['Rennleitung', 'rennleitung', ['Rennleitung Freitag', 'Rennleitung Sonntag']],
    ['Kommentatoren', 'kommentatoren', ['Freitagsliga', 'Sonntagsliga', 'LMU']]
  ];
  for (let i = 0; i < categoryData.length; i += 1) {
    const [name, slug, roles] = categoryData[i];
    const [category] = await TeamCategory.findOrCreate({ where: { slug }, defaults: { name, slug, sortOrder: i } });
    for (let j = 0; j < roles.length; j += 1) {
      await TeamMember.findOrCreate({ where: { TeamCategoryId: category.id, role: roles[j] }, defaults: { TeamCategoryId: category.id, name: `KRL Team ${i + 1}.${j + 1}`, role: roles[j], joinedYear: 2024 + (j % 2), sortOrder: j } });
    }
  }

  const leagueData = [
    { name: 'KRL Freitagsliga', slug: 'freitag', type: 'f1', currentSeason: 'Saison 12', raceDay: 'Freitag', raceTime: '20:00 Uhr', description: 'Der schnelle Start ins Rennwochenende mit fairen F1-Rennen.', accentColor: '#6ef2f2', sortOrder: 1 },
    { name: 'KRL Sonntagsliga', slug: 'sonntag', type: 'f1', currentSeason: 'Saison 10', raceDay: 'Sonntag', raceTime: '19:30 Uhr', description: 'Das Sonntags-Highlight mit Strategie, Spannung und Live-Kommentar.', accentColor: '#6ef2f2', sortOrder: 2 },
    { name: 'KRL LMU Liga', slug: 'lmu', type: 'lmu', currentSeason: 'Saison 3', raceDay: 'Samstag', raceTime: '19:00 Uhr', description: 'Multiclass-Langstrecke mit festen Cockpits und echtem Teamwork.', accentColor: '#ff343f', sortOrder: 3 },
    { name: 'Wettkampf der Ligen', slug: 'wettkampf', type: 'competition', currentSeason: '2026', raceDay: 'Sonntag', raceTime: '19:30 Uhr', description: 'Communities treten für ihre Liga gegeneinander an.', accentColor: '#ff343f', sortOrder: 4 },
    { name: 'KRL Endurance', slug: 'endurance', type: 'endurance', currentSeason: '2026', raceDay: 'Eventkalender', raceTime: '', description: 'Besondere Langstrecken-Events für eingespielte Teams.', accentColor: '#f0b74a', sortOrder: 5 }
  ];
  const leagues = {};
  for (const data of leagueData) {
    const [league] = await League.findOrCreate({ where: { slug: data.slug }, defaults: data });
    leagues[data.slug] = league;
  }
  const seasons = {};
  for (const league of Object.values(leagues)) {
    if (!['f1', 'lmu', 'competition'].includes(league.type)) continue;
    const leagueType = league.type === 'competition' ? 'wdl' : league.type;
    const [season] = await Season.findOrCreate({ where: { name: league.currentSeason, leagueType, scopeSlug: league.slug }, defaults: { name: league.currentSeason, leagueType, scopeSlug: league.slug, status: 'active', calendarMode: 'automatic', sortOrder: 1 } });
    seasons[league.slug] = season;
  }
  await seedF1(leagues.freitag, seasons.freitag, 'FR');
  await seedF1(leagues.sonntag, seasons.sonntag, 'SO');

  const calendarData = [
    [leagues.freitag, 'Großer Preis von Spa', 'Circuit de Spa-Francorchamps', '2026-09-04T18:00:00.000Z'],
    [leagues.sonntag, 'Großer Preis von Monza', 'Autodromo Nazionale Monza', '2026-09-06T17:30:00.000Z'],
    [leagues.lmu, '6 Stunden von Fuji', 'Fuji Speedway', '2026-09-12T17:00:00.000Z']
  ];
  for (let index = 0; index < calendarData.length; index += 1) {
    const [league, title, circuit, startsAt] = calendarData[index];
    const [event] = await RaceEvent.findOrCreate({
      where: { LeagueId: league.id, title },
      defaults: { LeagueId: league.id, SeasonId: seasons[league.slug]?.id || null, title, circuit, startsAt, durationMinutes: league.type === 'lmu' ? 360 : 120, isPublished: true, sortOrder: index + 1 }
    });
    if (seasons[league.slug] && event.SeasonId !== seasons[league.slug].id) await event.update({ SeasonId: seasons[league.slug].id });
    if (league.type === 'f1') {
      const [grandPrix] = await GrandPrixResult.findOrCreate({
        where: { LeagueId: league.id, season: league.currentSeason, title },
        defaults: { LeagueId: league.id, SeasonId: seasons[league.slug]?.id || null, season: league.currentSeason, title, circuit, raceDate: startsAt, discipline: 'f1', sortOrder: index + 1 }
      });
      await grandPrix.update({ SeasonId: seasons[league.slug]?.id || null, discipline: 'f1', isHistorical: false });
      if (event.GrandPrixResultId !== grandPrix.id) await event.update({ GrandPrixResultId: grandPrix.id });
    }
  }

  const cockpitData = [
    ['KRL Hyperion', 'BMW M Hybrid V8', 'Hypercar', '21'],
    ['KRL Nordlicht', 'Porsche 963', 'Hypercar', '37'],
    ['KRL Vortex', 'Ferrari 499P', 'Hypercar', '88']
  ];
  for (let i = 0; i < cockpitData.length; i += 1) {
    const [teamName, car, vehicleClass, carNumber] = cockpitData[i];
    await LmuCockpit.findOrCreate({ where: { LeagueId: leagues.lmu.id, teamName }, defaults: { LeagueId: leagues.lmu.id, teamName, car, vehicleClass, carNumber, driver1: `LMU Fahrer ${i * 3 + 1}`, driver2: `LMU Fahrer ${i * 3 + 2}`, driver3: `LMU Fahrer ${i * 3 + 3}`, sortOrder: i } });
  }
  await LmuStandingImage.findOrCreate({ where: { LeagueId: leagues.lmu.id, season: leagues.lmu.currentSeason, title: 'Gesamtwertung nach Spa' }, defaults: { LeagueId: leagues.lmu.id, season: leagues.lmu.currentSeason, event: '6 Stunden von Spa', title: 'Gesamtwertung nach Spa', description: 'Beispielgrafik – im Adminbereich durch eine PNG ersetzen.', imagePath: '/images/krl-placeholder.svg', altText: 'Platzhalter für die LMU-Gesamtwertung', sortOrder: 1 } });

  const participants = [
    ['Katzes Racing League', 'KRL', 'Ferrari'], ['Virtual Apex League', 'VAL', 'McLaren'],
    ['German Sim Grid', 'GSG', 'Mercedes'], ['Racing Community One', 'RCO', 'Red Bull']
  ];
  for (let i = 0; i < participants.length; i += 1) {
    const [name, abbreviation, constructorName] = participants[i];
    const [league] = await ParticipatingLeague.findOrCreate({ where: { abbreviation }, defaults: { name, abbreviation, constructorName, sortOrder: i } });
    await LeagueCompetitionStanding.findOrCreate({ where: { ParticipatingLeagueId: league.id }, defaults: { ParticipatingLeagueId: league.id, position: i + 1, drivers: `Fahrer ${i * 2 + 1} / Fahrer ${i * 2 + 2}`, constructorName, points: 120 - i * 17, wins: Math.max(0, 3 - i), gap: i === 0 ? 'Leader' : `+${i * 17}`, sortOrder: i } });
  }

  console.log('Setup abgeschlossen. Datenbank, Beispieldaten und Admin wurden erstellt.');
  await sequelize.close();
}

run().catch(async (error) => {
  console.error(error.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
