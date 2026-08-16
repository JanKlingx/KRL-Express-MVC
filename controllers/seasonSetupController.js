const { Op } = require('sequelize');
const {
  sequelize, League, Season, PointsScheme, RaceEvent, Team,
  F1CarProfile, SeasonF1CarAssignment, GrandPrixResult
} = require('../models');
const { activateSeason, syncSeriesCalendarEvent } = require('../services/championship');

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
  if (league.type === 'f1') return `/admin/race-editor?league=${league.id}&season=${season.id}`;
  return `/admin/season-progress/${disciplineForLeague(league)}?season=${season.id}`;
}

async function loadData(query = {}) {
  const leagues = await League.findAll({
    where: { type: { [Op.in]: ['f1', 'lmu', 'competition'] } },
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
  const [pointsSchemes, calendar, f1Teams, carProfiles, carAssignments] = await Promise.all([
    discipline ? PointsScheme.findAll({ where: { discipline }, order: [['sortOrder', 'DESC'], ['id', 'DESC']] }) : [],
    selectedSeason ? RaceEvent.findAll({ where: { SeasonId: selectedSeason.id }, order: [['sortOrder', 'ASC'], ['startsAt', 'ASC'], ['id', 'ASC']] }) : [],
    selectedLeague?.type === 'f1' ? Team.findAll({ where: { LeagueId: null, discipline: 'f1' }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] }) : [],
    selectedLeague?.type === 'f1' ? F1CarProfile.findAll({ include: [{ association: 'baseTeam', required: false }], order: [['seasonLabel', 'DESC'], ['sortOrder', 'ASC'], ['id', 'ASC']] }) : [],
    selectedSeason && selectedLeague?.type === 'f1' ? SeasonF1CarAssignment.findAll({ where: { SeasonId: selectedSeason.id } }) : []
  ]);
  return {
    leagues, selectedLeague, discipline, seasons, selectedSeason, pointsSchemes,
    calendar, f1Teams, carProfiles,
    carAssignmentMap: Object.fromEntries(carAssignments.map((assignment) => [assignment.TeamId, assignment.F1CarProfileId])),
    defaultTime: extractTime(selectedLeague?.raceTime),
    progressHref: progressHref(selectedLeague, selectedSeason)
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
    if (!league || !['f1', 'lmu', 'competition'].includes(league.type)) throw new Error('Bitte eine gültige Liga auswählen.');
    const name = String(req.body.name || '').trim();
    if (!name) throw new Error('Bitte einen Saisonnamen eingeben.');
    const discipline = disciplineForLeague(league);
    const duplicate = await Season.findOne({ where: { leagueType: discipline, scopeSlug: league.slug, name } });
    if (duplicate) throw new Error(`Die Saison „${name}“ existiert für ${league.name} bereits.`);
    const pointsScheme = req.body.PointsSchemeId ? await PointsScheme.findByPk(req.body.PointsSchemeId) : null;
    if (pointsScheme && pointsScheme.discipline !== discipline) throw new Error('Das Punktesystem gehört nicht zur ausgewählten Liga.');
    const accentColor = /^#[0-9a-f]{6}$/i.test(req.body.accentColor || '') ? req.body.accentColor : league.accentColor;
    const season = await Season.create({
      name, leagueType: discipline, scopeSlug: league.slug,
      status: req.body.status === 'historical' ? 'historical' : 'active',
      calendarMode: 'manual', accentColor, PointsSchemeId: pointsScheme?.id || null
    });
    await activateSeason(season);
    req.session.flash = { type: 'success', message: `${season.name} wurde für ${league.name} angelegt. Als Nächstes kann der Rennkalender gepflegt werden.` };
    res.redirect(setupRedirect({ league: league.id, season: season.id }));
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    res.redirect(setupRedirect({ league: league?.id || req.body.LeagueId }));
  }
};

exports.updateSeasonProfile = async (req, res) => {
  const season = await Season.findByPk(req.params.seasonId);
  const league = season ? await League.findOne({ where: { slug: season.scopeSlug, type: season.leagueType === 'wdl' ? 'competition' : season.leagueType } }) : null;
  try {
    if (!season || !league) throw new Error('Saison oder Liga wurde nicht gefunden.');
    const pointsScheme = req.body.PointsSchemeId ? await PointsScheme.findByPk(req.body.PointsSchemeId) : null;
    if (pointsScheme && pointsScheme.discipline !== season.leagueType) throw new Error('Das Punktesystem gehört nicht zu dieser Liga.');
    const accentColor = /^#[0-9a-f]{6}$/i.test(req.body.accentColor || '') ? req.body.accentColor : season.accentColor || league.accentColor;
    await season.update({ PointsSchemeId: pointsScheme?.id || null, accentColor });
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
    const title = String(req.body.title || '').trim();
    const circuit = String(req.body.circuit || title).trim();
    const date = String(req.body.date || '').trim();
    if (!title || !date) throw new Error('Rennen und Datum sind Pflichtfelder.');
    const time = extractTime(req.body.time, extractTime(league.raceTime));
    const startsAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startsAt.getTime())) throw new Error('Datum oder Startzeit ist ungültig.');
    const event = await RaceEvent.create({
      SeasonId: season.id, LeagueId: league.id, title, circuit, startsAt,
      durationMinutes: Number(req.body.durationMinutes || 120),
      isPublished: season.status === 'active', isTestDay: req.body.isTestDay === 'on',
      sortOrder: Number(req.body.sortOrder || 0)
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

module.exports.loadData = loadData;
