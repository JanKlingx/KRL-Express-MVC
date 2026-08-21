const { Op } = require('sequelize');
const {
  sequelize, League, Season, PointsScheme, RaceEvent, Team,
  F1CarProfile, SeasonF1CarAssignment, GrandPrixResult, F1Track,
  SeasonDriver, SeasonTeam, SeasonLineupEntry, Driver
} = require('../models');
const { activateSeason, syncSeriesCalendarEvent } = require('../services/championship');
const { loadEligibleSeasonDrivers, loadSeasonStructure, resolveTeamToken } = require('../services/f1Season');

function disciplineForLeague(league) {
  return league?.type === 'competition' ? 'wdl' : league?.type;
}

function setupRedirect(values = {}) {
  const query = new URLSearchParams(Object.entries(values).filter(([, value]) => value));
  return `/admin/season-setup${query.size ? `?${query}` : ''}`;
}

function extractTime(value, fallback = '20:00') {
  return String(value || '').match(/\b([01]\d|2[0-3]):[0-5]\d\b/)?.[0] || fallback;
}

function progressHref(league, season) {
  if (!league || !season) return null;
  if (league.type === 'f1' && season.status === 'active') return `/admin/current-season-progress?league=${league.id}`;
  if (league.type === 'f1') return `/admin/race-editor?league=${league.id}&season=${season.id}`;
  return `/admin/season-progress/${disciplineForLeague(league)}?season=${season.id}`;
}

async function loadData(query = {}) {
  const leagues = await League.findAll({
    where: { type: 'f1', slug: { [Op.in]: ['freitag', 'samstag', 'sonntag'] } },
    order: [['type', 'ASC'], ['sortOrder', 'ASC'], ['id', 'ASC']]
  });
  const selectedLeague = leagues.find((league) => league.id === Number(query.league)) || leagues[0] || null;
  const discipline = disciplineForLeague(selectedLeague);
  const seasons = selectedLeague ? await Season.findAll({
    where: { leagueType: discipline, scopeSlug: selectedLeague.slug },
    include: [{ association: 'pointsScheme', required: false }],
    order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']]
  }) : [];
  const selectedSeason = seasons.find((season) => season.id === Number(query.season)) || seasons.find((season) => season.status === 'active') || seasons[0] || null;
  const [pointsSchemes, calendar, f1Teams, carProfiles, carAssignments, tracks, eligibleDrivers, structure] = await Promise.all([
    PointsScheme.findAll({ where: { discipline: 'f1' }, order: [['sortOrder', 'DESC'], ['id', 'DESC']] }),
    selectedSeason ? RaceEvent.findAll({ where: { SeasonId: selectedSeason.id }, include: [{ association: 'track', include: [{ association: 'countryRecord' }] }], order: [['sortOrder', 'ASC'], ['startsAt', 'ASC'], ['id', 'ASC']] }) : [],
    Team.findAll({ where: { LeagueId: null, discipline: 'f1' }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    F1CarProfile.findAll({ where: { BaseTeamId: { [Op.ne]: null } }, include: [{ association: 'baseTeam', required: true }], order: [['name', 'ASC'], ['id', 'ASC']] }),
    selectedSeason ? SeasonF1CarAssignment.findAll({ where: { SeasonId: selectedSeason.id } }) : [],
    F1Track.findAll({ include: [{ association: 'countryRecord' }], order: [['country', 'ASC'], ['name', 'ASC']] }),
    loadEligibleSeasonDrivers(),
    loadSeasonStructure(selectedSeason?.id)
  ]);
  return {
    leagues, selectedLeague, discipline, seasons, selectedSeason, pointsSchemes,
    calendar, f1Teams, carProfiles, tracks, eligibleDrivers, structure,
    carAssignmentMap: Object.fromEntries(carAssignments.map((assignment) => [assignment.TeamId, assignment.F1CarProfileId])),
    defaultTime: extractTime(selectedLeague?.raceTime),
    progressHref: progressHref(selectedLeague, selectedSeason),
    finishReady: Boolean(selectedSeason && calendar.length && selectedSeason.PointsSchemeId && structure.allDrivers.length && structure.teams.length && structure.teams.some((team) => team.drivers.length))
  };
}

exports.show = async (req, res) => {
  const data = await loadData(req.query);
  res.render('admin/season-setup', { title: 'Saison-Assistent', ...data });
};

exports.createSeason = async (req, res) => {
  let league;
  try {
    league = await League.findByPk(req.body.LeagueId);
    if (!league || league.type !== 'f1') throw new Error('Bitte eine gültige Formel-1-Liga auswählen.');
    const name = String(req.body.name || '').trim();
    if (!name) throw new Error('Bitte einen Saisonnamen eingeben.');
    const discipline = disciplineForLeague(league);
    const duplicate = await Season.findOne({ where: { leagueType: discipline, scopeSlug: league.slug, name } });
    if (duplicate) {
      const error = new Error(`Die Saison „${name}“ existiert für ${league.name} bereits.`);
      error.seasonManagerHref = `/admin/season-manager?league=${league.id}`;
      throw error;
    }
    if (!['active', 'historical'].includes(req.body.status)) throw new Error('Bitte den Saisonstatus aktuell oder historisch auswählen.');
    if (!/^#[0-9a-f]{6}$/i.test(req.body.accentColor || '')) throw new Error('Bitte eine gültige Saisonfarbe auswählen.');
    const accentColor = req.body.accentColor;
    const season = await Season.create({
      name, leagueType: discipline, scopeSlug: league.slug,
      status: req.body.status,
      calendarMode: 'manual', accentColor, PointsSchemeId: null, isPublished: false
    });
    req.session.flash = { type: 'success', message: `${season.name} wurde für ${league.name} angelegt. Als Nächstes kann der Rennkalender gepflegt werden.` };
    res.redirect(setupRedirect({ league: league.id, season: season.id }));
  } catch (error) {
    req.session.flash = {
      type: 'error', message: error.message,
      ...(error.seasonManagerHref ? { href: error.seasonManagerHref, linkLabel: 'Vorhandene Saison bearbeiten →' } : {})
    };
    res.redirect(setupRedirect({ league: league?.id || req.body.LeagueId }));
  }
};

exports.updateSeasonProfile = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season ? await League.findOne({ where: { slug: season.scopeSlug, type: season.leagueType === 'wdl' ? 'competition' : season.leagueType } }) : null;
  try {
    if (!season || !league) throw new Error('Saison oder Liga wurde nicht gefunden.');
    const pointsScheme = req.body.PointsSchemeId ? await PointsScheme.findByPk(req.body.PointsSchemeId) : null;
    if (!pointsScheme || pointsScheme.discipline !== 'f1') throw new Error('Bitte ein Formel-1-Punktesystem auswählen.');
    const accentColor = /^#[0-9a-f]{6}$/i.test(req.body.accentColor || '') ? req.body.accentColor : season.accentColor || league.accentColor;
    await season.update({ PointsSchemeId: pointsScheme.id, accentColor });
    req.session.flash = { type: 'success', message: `Farbprofil und Punktesystem von ${season.name} wurden gespeichert.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(setupRedirect({ league: league?.id, season: season?.id }));
};

exports.addCalendarEvent = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season ? await League.findOne({ where: { slug: season.scopeSlug, type: season.leagueType === 'wdl' ? 'competition' : season.leagueType } }) : null;
  try {
    if (!season || !league) throw new Error('Saison oder Liga wurde nicht gefunden.');
    const track = await F1Track.findByPk(req.body.F1TrackId, { include: [{ association: 'countryRecord' }] });
    if (!track) throw new Error('Bitte eine Strecke aus dem F1-Streckenstamm auswählen.');
    const title = `Großer Preis von ${track.countryRecord?.name || track.country}`;
    const circuit = track.name;
    const date = String(req.body.date || '').trim();
    if (!date) throw new Error('Datum ist ein Pflichtfeld.');
    const sortOrder = Number(req.body.sortOrder);
    if (!Number.isInteger(sortOrder) || sortOrder < 1) throw new Error('Die Rennen-Nr. muss größer als 0 sein.');
    const duplicateRound = await RaceEvent.findOne({ where: { SeasonId: season.id, sortOrder } });
    if (duplicateRound) throw new Error(`Rennen Nr. ${sortOrder} ist in dieser Saison bereits vergeben.`);
    const time = extractTime(league.raceTime);
    const startsAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startsAt.getTime())) throw new Error('Datum oder Startzeit ist ungültig.');
    const event = await RaceEvent.create({
      SeasonId: season.id, LeagueId: league.id, F1TrackId: track.id, title, circuit, startsAt,
      durationMinutes: null,
      isPublished: season.status === 'active' && season.isPublished, isTestDay: req.body.isTestDay === 'on',
      sortOrder
    });
    await syncSeriesCalendarEvent(event);
    if (season.leagueType === 'f1' && req.body.hasSprint === 'on') {
      await GrandPrixResult.findOrCreate({
        where: { SeasonId: season.id, LeagueId: league.id, circuit, raceType: 'sprint' },
        defaults: {
          SeasonId: season.id, LeagueId: league.id, season: season.name,
          title: `Sprint · ${circuit}`, circuit, raceDate: date,
          discipline: 'f1', raceType: 'sprint', pointsMode: 'database',
          isHistorical: season.status === 'historical', sortOrder: Number(req.body.sortOrder || 0)
        }
      });
    }
    req.session.flash = { type: 'success', message: `${title} wurde in den Kalender von ${season.name} übernommen.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(setupRedirect({ league: league?.id, season: season?.id }));
};

exports.assignF1Cars = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season ? await League.findOne({ where: { slug: season.scopeSlug, type: 'f1' } }) : null;
  try {
    if (!season || season.leagueType !== 'f1' || !league) throw new Error('Die Autozuweisung ist nur für eine Formel-1-Saison möglich.');
    const assignments = Object.entries(req.body.cars || {}).map(([teamId, profileId], index) => ({
      SeasonId: season.id, TeamId: Number(teamId), F1CarProfileId: Number(profileId), sortOrder: index
    })).filter((entry) => entry.TeamId && entry.F1CarProfileId);
    const teamIds = [...new Set(assignments.map((entry) => entry.TeamId))];
    const profileIds = [...new Set(assignments.map((entry) => entry.F1CarProfileId))];
    const validTeamCount = teamIds.length ? await Team.count({ where: { id: teamIds, LeagueId: null, discipline: 'f1' } }) : 0;
    const profiles = profileIds.length ? await F1CarProfile.findAll({ where: { id: profileIds } }) : [];
    if (validTeamCount !== teamIds.length || profiles.length !== profileIds.length) throw new Error('Mindestens eine Autozuweisung ist ungültig.');
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    if (assignments.some((assignment) => Number(profileById.get(assignment.F1CarProfileId)?.BaseTeamId) !== assignment.TeamId)) {
      throw new Error('Ein historisches Autoprofil darf nur seinem verknüpften aktuellen Formel-1-Team zugewiesen werden.');
    }
    await sequelize.transaction(async (transaction) => {
      await SeasonF1CarAssignment.destroy({ where: { SeasonId: season.id }, transaction });
      if (assignments.length) await SeasonF1CarAssignment.bulkCreate(assignments, { transaction });
    });
    req.session.flash = { type: 'success', message: `Die Formel-1-Autoprofile für ${season.name} wurden gespeichert.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(setupRedirect({ league: league?.id, season: season?.id }));
};

exports.assignDrivers = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season ? await League.findOne({ where: { slug: season.scopeSlug, type: 'f1' } }) : null;
  try {
    if (!season || !league) throw new Error('Saison oder Liga wurde nicht gefunden.');
    const ids = [...new Set([].concat(req.body.driverIds || []).map(Number).filter(Number.isInteger))].slice(0, 40);
    if (!ids.length) throw new Error('Bitte mindestens einen Fahrer auswählen.');
    const validDrivers = await Driver.findAll({ where: { id: { [Op.in]: ids } } });
    const eligible = validDrivers.filter((driver) => driver.roleF1Friday || driver.roleF1Saturday || driver.roleF1Sunday || driver.roleFormerF1);
    if (eligible.length !== ids.length) throw new Error('Mindestens ein Fahrer besitzt keinen zulässigen Formel-1-Rang.');
    await sequelize.transaction(async (transaction) => {
      await SeasonLineupEntry.destroy({ where: { SeasonId: season.id, DriverId: { [Op.notIn]: ids } }, transaction });
      await SeasonDriver.destroy({ where: { SeasonId: season.id }, transaction });
      await SeasonDriver.bulkCreate(ids.map((DriverId, index) => ({ SeasonId: season.id, DriverId, sortOrder: index })), { transaction });
    });
    req.session.flash = { type: 'success', message: `${ids.length} Fahrer wurden für ${season.name} übernommen.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(setupRedirect({ league: league?.id, season: season?.id }));
};

exports.assignTeams = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season ? await League.findOne({ where: { slug: season.scopeSlug, type: 'f1' } }) : null;
  try {
    if (!season || !league) throw new Error('Saison oder Liga wurde nicht gefunden.');
    const tokens = [...new Set([].concat(req.body.teamTokens || []).filter(Boolean))];
    if (!tokens.length || tokens.length > 11) throw new Error('Bitte zwischen 1 und maximal 11 Teams auswählen.');
    const sources = (await Promise.all(tokens.map(resolveTeamToken))).filter(Boolean);
    if (sources.length !== tokens.length) throw new Error('Mindestens ein ausgewähltes Team ist ungültig.');
    await sequelize.transaction(async (transaction) => {
      await SeasonLineupEntry.update({ SeasonTeamId: null, roleType: 'reserve' }, { where: { SeasonId: season.id }, transaction });
      await SeasonTeam.destroy({ where: { SeasonId: season.id }, transaction });
      await SeasonTeam.bulkCreate(sources.map((source, index) => ({
        SeasonId: season.id, sourceType: source.sourceType, sourceId: source.sourceId,
        name: source.name, accentColor: source.accentColor || '#6ef2f2', logoPath: source.logoPath || null, sortOrder: index
      })), { transaction });
    });
    req.session.flash = { type: 'success', message: `${sources.length} Saisonteams wurden gespeichert.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(setupRedirect({ league: league?.id, season: season?.id }));
};

exports.assignLineup = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season ? await League.findOne({ where: { slug: season.scopeSlug, type: 'f1' } }) : null;
  try {
    if (!season || !league) throw new Error('Saison oder Liga wurde nicht gefunden.');
    const [memberships, teams] = await Promise.all([
      SeasonDriver.findAll({ where: { SeasonId: season.id } }),
      SeasonTeam.findAll({ where: { SeasonId: season.id } })
    ]);
    const allowedDrivers = new Set(memberships.map((row) => row.DriverId));
    const allowedTeams = new Set(teams.map((row) => row.id));
    const assignments = [];
    const usedDrivers = new Set();
    const duplicateDrivers = new Set();
    Object.entries(req.body.lineup || {}).forEach(([teamId, rawIds]) => {
      const SeasonTeamId = Number(teamId);
      if (!allowedTeams.has(SeasonTeamId)) return;
      [].concat(rawIds || []).map(Number).filter(Number.isInteger).forEach((DriverId) => {
        if (!allowedDrivers.has(DriverId)) return;
        if (usedDrivers.has(DriverId)) { duplicateDrivers.add(DriverId); return; }
        usedDrivers.add(DriverId);
        assignments.push({ SeasonId: season.id, SeasonTeamId, DriverId, roleType: 'regular', sortOrder: assignments.length });
      });
    });
    if (duplicateDrivers.size) throw new Error('Ein Fahrer darf im Line-up nur einem Team zugeordnet werden. Bitte doppelte Auswahl entfernen.');
    if (!assignments.length) throw new Error('Bitte mindestens einen Fahrer einem Team zuordnen.');
    const reserves = [...allowedDrivers].filter((DriverId) => !usedDrivers.has(DriverId)).map((DriverId, index) => ({
      SeasonId: season.id, SeasonTeamId: null, DriverId, roleType: 'reserve', sortOrder: assignments.length + index
    }));
    await sequelize.transaction(async (transaction) => {
      await SeasonLineupEntry.destroy({ where: { SeasonId: season.id }, transaction });
      await SeasonLineupEntry.bulkCreate([...assignments, ...reserves], { transaction });
    });
    req.session.flash = { type: 'success', message: `Line-up gespeichert: ${assignments.length} Stammfahrer und ${reserves.length} verfügbare Ersatzfahrer.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(setupRedirect({ league: league?.id, season: season?.id }));
};

exports.finish = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season ? await League.findOne({ where: { slug: season.scopeSlug, type: 'f1' } }) : null;
  try {
    if (!season || !league) throw new Error('Saison oder Liga wurde nicht gefunden.');
    const [calendar, drivers, teams, lineup] = await Promise.all([
      RaceEvent.count({ where: { SeasonId: season.id } }), SeasonDriver.count({ where: { SeasonId: season.id } }),
      SeasonTeam.count({ where: { SeasonId: season.id } }), SeasonLineupEntry.count({ where: { SeasonId: season.id, roleType: 'regular' } })
    ]);
    if (!calendar || !season.PointsSchemeId || !drivers || !teams || !lineup) throw new Error('Der Assistent ist noch nicht vollständig. Bitte alle acht Schritte abschließen.');
    await season.update({ isPublished: true });
    if (season.status === 'active') await activateSeason(season);
    req.session.flash = { type: 'success', message: `${season.name} ist vollständig eingerichtet und im Frontend verfügbar.` };
    return res.redirect(`/admin/season-manager?league=${league.id}`);
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    return res.redirect(setupRedirect({ league: league?.id, season: season?.id }));
  }
};

module.exports.loadData = loadData;
