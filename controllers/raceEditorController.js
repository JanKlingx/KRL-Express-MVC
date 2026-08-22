const { Op } = require('sequelize');
const {
  sequelize, League, Team, TeamRoster, TeamRosterDriver, Driver, Season, RaceEvent, GrandPrixResult, GrandPrixResultEntry, F1RaceLineupEntry, F1CarProfile, PenaltyEntry
} = require('../models');
const { pointsForPosition, recalculateDriverRaceCounts } = require('../services/championship');
const seasonProgress = require('../services/seasonProgress');
const { regularStarts, reserveRoleField, reserveStarts } = require('../services/raceLineup');
const { loadSeasonStructure } = require('../services/f1Season');

const statuses = ['', 'DNF', 'DNS', 'DNQ', 'DSQ', 'DNA'];

async function getRaces(leagueId, seasonId) {
  return GrandPrixResult.findAll({
    where: { LeagueId: leagueId, SeasonId: seasonId, discipline: 'f1', raceType: 'main' },
    include: [
      { model: League, as: 'league', where: { type: 'f1' } },
      {
        model: RaceEvent,
        as: 'calendarEvent',
        required: true,
        where: { LeagueId: leagueId, SeasonId: seasonId },
        attributes: ['id', 'title', 'circuit', 'startsAt', 'isTestDay', 'sortOrder']
      }
    ],
    order: [[{ model: RaceEvent, as: 'calendarEvent' }, 'sortOrder', 'ASC'], ['raceDate', 'ASC']]
  });
}

function findDriverEntry(driver, entries) {
  const names = new Set([driver.name, ...(driver.aliases || []).map((alias) => alias.alias)]);
  return entries.find((entry) => entry.DriverId === driver.id || (!entry.DriverId && names.has(entry.driverName)));
}

async function loadTeams(leagueId, seasonId) {
  const structure = await loadSeasonStructure(seasonId);
  if (structure.teams.length) {
    return Promise.all(structure.teams.map(async (seasonTeam) => {
      let actualTeam = null;
      if (seasonTeam.sourceType === 'current') actualTeam = await Team.findByPk(seasonTeam.sourceId);
      else {
        const profile = await F1CarProfile.findByPk(seasonTeam.sourceId);
        if (profile?.BaseTeamId) actualTeam = await Team.findByPk(profile.BaseTeamId);
      }
      return {
        id: actualTeam?.id || null, seasonTeamId: seasonTeam.id, name: seasonTeam.name,
        accentColor: seasonTeam.accentColor, logoPath: seasonTeam.logoPath,
        drivers: seasonTeam.drivers.map((driver) => ({ driver, roleName: 'Stammfahrer' }))
      };
    }));
  }
  const rosters = await TeamRoster.findAll({
    where: { LeagueId: leagueId, discipline: 'f1' },
    include: [{ association: 'team' }, { association: 'assignments', include: [{ association: 'driver', include: [{ association: 'aliases' }] }] }],
    order: [['sortOrder', 'ASC'], ['id', 'ASC'], [{ model: TeamRosterDriver, as: 'assignments' }, 'sortOrder', 'ASC']]
  });
  return rosters.map((roster) => ({
    ...roster.team.toJSON(), rosterId: roster.id,
    drivers: roster.assignments
      .filter((assignment) => assignment.roleName !== 'Ersatzfahrer')
      .map((assignment) => ({ driver: assignment.driver, roleName: assignment.roleName }))
  })).filter((team) => team.drivers.length >= 2);
}

async function loadEligibleDrivers(teams, league, race) {
  const assigned = new Map();
  teams.forEach((team) => team.drivers.forEach(({ driver, roleName }) => {
    if (!assigned.has(driver.id)) assigned.set(driver.id, { driver, assignedTeam: team, isReserve: roleName === 'Ersatzfahrer' });
  }));
  const planEntries = race ? await F1RaceLineupEntry.findAll({
    where: { GrandPrixResultId: race.id },
    include: [{ association: 'driver', include: [{ association: 'aliases' }] }]
  }) : [];
  if (planEntries.length) {
    const attendanceManaged = planEntries.some((entry) => entry.attendanceStatus);
    if (attendanceManaged) {
      const rows = [];
      planEntries.filter((entry) => entry.includeInResults && entry.driver).forEach((entry) => {
        const direct = entry.roleType === 'regular' ? assigned.get(entry.DriverId) : assigned.get(entry.ReplacementForDriverId);
        const targetEntry = entry.roleType === 'reserve' ? planEntries.find((candidate) => candidate.DriverId === entry.ReplacementForDriverId) : null;
        const assignedTeam = direct?.assignedTeam || teams.find((team) => Number(team.id) === Number(entry.TeamId)) || null;
        if (!assignedTeam) return;
        rows.push({
          driver: entry.driver, assignedTeam,
          isReserve: entry.roleType === 'reserve', planned: true,
          replacesDriver: entry.roleType === 'reserve' ? (direct?.driver || targetEntry?.driver || null) : null
        });
      });
      return { rows, managed: true, attendanceManaged: true };
    }
    const regularPlan = new Map(planEntries.filter((entry) => entry.roleType === 'regular').map((entry) => [entry.DriverId, entry]));
    const reserveField = reserveRoleField(league?.slug);
    const reservePlan = planEntries.filter((entry) => entry.roleType === 'reserve' && entry.ReplacementForDriverId && entry.driver?.[reserveField]);
    const rows = [];
    assigned.forEach((row, driverId) => {
      const replacement = reservePlan.find((entry) => entry.ReplacementForDriverId === driverId);
      if (!replacement && regularStarts(regularPlan.get(driverId)?.status)) rows.push({ ...row, planned: true });
    });
    reservePlan.forEach((entry) => {
      const replaced = assigned.get(entry.ReplacementForDriverId);
      if (replaced && reserveStarts(entry.status)) rows.push({
        driver: entry.driver, assignedTeam: replaced.assignedTeam, isReserve: true, planned: true,
        replacesDriver: replaced.driver
      });
    });
    return { rows, managed: true };
  }
  const reserveField = reserveRoleField(league?.slug);
  const reserves = await Driver.findAll({ where: { [reserveField]: true }, include: [{ association: 'aliases' }], order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  reserves.forEach((driver) => { if (!assigned.has(driver.id)) assigned.set(driver.id, { driver, assignedTeam: null, isReserve: true }); });
  return { rows: [...assigned.values()], managed: false };
}

function requestedDriverIds(query, entries, sprintEntries) {
  const hasExplicitSelection = Object.prototype.hasOwnProperty.call(query, 'drivers');
  const raw = Array.isArray(query.drivers) ? query.drivers : query.drivers !== undefined ? [query.drivers] : [];
  const storedIds = hasExplicitSelection ? [] : [...entries.map((entry) => entry.DriverId), ...sprintEntries.map((entry) => entry.DriverId)];
  const ids = [...raw, query.addDriver, ...storedIds]
    .flatMap((value) => String(value || '').split(','))
    .map(Number).filter((value) => Number.isInteger(value) && value > 0);
  return [...new Set(ids)].slice(0, 20);
}

async function showEditor(req, res, currentOnly = false) {
  const leagues = await League.findAll({ where: { type: 'f1' }, order: [['sortOrder', 'ASC'], ['name', 'ASC']] });
  const selectedLeague = leagues.find((league) => league.id === Number(req.query.league)) || leagues[0] || null;
  const seasons = selectedLeague ? await Season.findAll({
    where: { leagueType: 'f1', scopeSlug: selectedLeague.slug, ...(currentOnly ? { status: 'active', isPublished: true } : { status: 'historical' }) },
    include: [{ association: 'category' }],
    order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']]
  }) : [];
  const selectedSeason = currentOnly
    ? seasons.find((season) => season.status === 'active') || null
    : seasons.find((season) => season.id === Number(req.query.season)) || seasons[0] || null;
  const races = selectedLeague && selectedSeason ? await getRaces(selectedLeague.id, selectedSeason.id) : [];
  const selectedRace = races.find((race) => race.id === Number(req.query.race)) || races[0] || null;
  const sprintRace = selectedRace ? await GrandPrixResult.findOne({
    where: {
      SeasonId: selectedRace.SeasonId, LeagueId: selectedRace.LeagueId,
      circuit: selectedRace.circuit, sortOrder: selectedRace.sortOrder, raceType: 'sprint'
    }
  }) : null;
  const teams = selectedLeague && selectedSeason ? await loadTeams(selectedLeague.id, selectedSeason.id) : [];
  let rows = [];
  let availableDrivers = [];
  let historicalDriverIds = [];
  let lineupManaged = false;
  if (selectedRace && selectedSeason) {
    const [entries, sprintEntries, raceBans] = await Promise.all([
      GrandPrixResultEntry.findAll({ where: { GrandPrixResultId: selectedRace.id }, order: [['sortOrder', 'ASC'], ['position', 'ASC']] }),
      sprintRace ? GrandPrixResultEntry.findAll({ where: { GrandPrixResultId: sprintRace.id }, order: [['sortOrder', 'ASC'], ['position', 'ASC']] }) : [],
      PenaltyEntry.findAll({ where: { GrandPrixResultId: selectedRace.id, isRaceBan: true } })
    ]);
    const bannedDriverIds = new Set(raceBans.map((entry) => entry.DriverId));
    let eligible;
    if (selectedSeason.status === 'historical') {
      const structure = await loadSeasonStructure(selectedSeason.id);
      availableDrivers = structure.allDrivers;
      historicalDriverIds = requestedDriverIds(req.query, entries, sprintEntries);
      if (!Object.prototype.hasOwnProperty.call(req.query, 'drivers') && !historicalDriverIds.length) historicalDriverIds = structure.allDrivers.map((driver) => driver.id).slice(0, 20);
      eligible = availableDrivers.filter((driver) => historicalDriverIds.includes(driver.id));
    } else {
      const lineup = await loadEligibleDrivers(teams, selectedLeague, selectedRace);
      eligible = lineup.rows;
      lineupManaged = lineup.managed;
    }
    rows = eligible.map((value) => {
      const wrapper = value.driver ? value : { driver: value, assignedTeam: null, isReserve: false };
      return {
        ...wrapper,
        entry: findDriverEntry(wrapper.driver, entries) || null,
        sprintEntry: findDriverEntry(wrapper.driver, sprintEntries) || null,
        raceBan: bannedDriverIds.has(wrapper.driver.id)
      };
    });
    rows.sort((left, right) => {
      const leftPosition = Number(left.entry?.position || left.sprintEntry?.position || Number.MAX_SAFE_INTEGER);
      const rightPosition = Number(right.entry?.position || right.sprintEntry?.position || Number.MAX_SAFE_INTEGER);
      return leftPosition - rightPosition || left.driver.name.localeCompare(right.driver.name, 'de');
    });
  }
  res.render('admin/race-editor', {
    title: 'Tabellarischer Saisonverlauf', leagues, selectedLeague, seasons, selectedSeason,
    races, selectedRace, sprintRace, teams, rows, statuses, availableDrivers, historicalDriverIds, lineupManaged, currentOnly
  });
}

exports.show = (req, res) => showEditor(req, res, false);
exports.showCurrent = (req, res) => showEditor(req, res, true);

exports.save = async (req, res) => {
  const race = await GrandPrixResult.findByPk(req.params.raceId, { include: [{ model: League, as: 'league' }, { model: Season, as: 'seasonRecord' }] });
  if (!race || race.discipline !== 'f1' || !race.seasonRecord) return res.status(404).render('errors/404', { title: 'Formel-1-Rennen nicht gefunden' });
  const teams = await loadTeams(race.LeagueId, race.SeasonId);
  const submittedDriverIds = Object.keys(req.body.rows || {}).map(Number).filter(Number.isInteger).slice(0, 20);
  let lineupManaged = false;
  let eligible;
  if (race.seasonRecord.status === 'historical') {
    eligible = await Driver.findAll({ where: { id: { [Op.in]: submittedDriverIds } }, include: [{ association: 'aliases' }], order: [['name', 'ASC']] });
  } else {
    const lineup = await loadEligibleDrivers(teams, race.league, race);
    eligible = lineup.rows;
    lineupManaged = lineup.managed;
  }
  const driverRows = eligible.map((value) => value.driver ? value : { driver: value, assignedTeam: null, isReserve: false });
  const driverIds = driverRows.map(({ driver }) => driver.id);
  const sprintRace = await GrandPrixResult.findOne({
    where: { SeasonId: race.SeasonId, LeagueId: race.LeagueId, circuit: race.circuit, sortOrder: race.sortOrder, raceType: 'sprint' }
  });
  const [existingEntries, existingSprintEntries] = await Promise.all([
    GrandPrixResultEntry.findAll({ where: { GrandPrixResultId: race.id } }),
    sprintRace ? GrandPrixResultEntry.findAll({ where: { GrandPrixResultId: sprintRace.id } }) : []
  ]);
  const submittedRows = req.body.rows || {};
  const requestedEditorPath = req.body._return === 'current' ? '/admin/current-season-progress' : '/admin/race-editor';
  for (const event of [{ race, field: 'position' }, ...(sprintRace ? [{ race: sprintRace, field: 'sprintPosition' }] : [])]) {
    if (event.race.pointsMode === 'manual') continue;
    const usedPositions = new Map();
    for (const { driver } of driverRows) {
      const submitted = submittedRows[String(driver.id)] || {};
      if (submitted.included !== 'on' || !submitted[event.field]) continue;
      const position = Number(submitted[event.field]);
      if (!Number.isInteger(position) || position < 1) {
        req.session.flash = { type: 'error', message: `${event.race.raceType === 'sprint' ? 'Sprint: ' : ''}${driver.name} benötigt einen gültigen Platz größer 0.` };
        return res.redirect(`${requestedEditorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`);
      }
      if (usedPositions.has(position)) {
        req.session.flash = { type: 'error', message: `${event.race.raceType === 'sprint' ? 'Sprint: ' : ''}Platz ${position} wurde doppelt vergeben (${usedPositions.get(position)} und ${driver.name}).` };
        return res.redirect(`${requestedEditorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`);
      }
      usedPositions.set(position, driver.name);
    }
  }

  try {
    await sequelize.transaction(async (transaction) => {
    if (race.seasonRecord.status === 'historical' || lineupManaged) {
      const omittedWhere = driverIds.length
        ? { [Op.or]: [{ DriverId: { [Op.notIn]: driverIds } }, { DriverId: null }] }
        : {};
      await GrandPrixResultEntry.destroy({ where: { GrandPrixResultId: race.id, ...omittedWhere }, transaction });
      if (sprintRace) await GrandPrixResultEntry.destroy({ where: { GrandPrixResultId: sprintRace.id, ...omittedWhere }, transaction });
    }
    for (const { driver, assignedTeam, isReserve } of driverRows) {
      const submitted = submittedRows[String(driver.id)] || {};
      const existing = findDriverEntry(driver, existingEntries);
      const existingSprint = findDriverEntry(driver, existingSprintEntries);
      if (submitted.included !== 'on') {
        if (existing) await existing.destroy({ transaction });
        if (existingSprint) await existingSprint.destroy({ transaction });
        await PenaltyEntry.destroy({
          where: { GrandPrixResultId: race.id, DriverId: driver.id, isRaceBan: true, reason: 'Rennsperre (Ergebnispflege)' }, transaction
        });
        continue;
      }
      const selectedTeam = teams.find((candidate) => Number(candidate.id) === Number(submitted.TeamId)) || null;
      const team = race.seasonRecord.status === 'historical' || isReserve ? selectedTeam : assignedTeam;
      if (!team) throw new Error(`${driver.name}: Bitte ein Team für dieses Rennen auswählen.`);
      const status = statuses.includes(submitted.status) ? submitted.status : '';
      const saveEvent = async (eventRace, current, prefix = '') => {
        if (!eventRace) return;
        const positionField = prefix ? `${prefix}Position` : 'position';
        const pointsField = prefix ? `${prefix}Points` : 'points';
        const fastestField = prefix ? `${prefix}FastestLap` : 'fastestLap';
        const position = eventRace.pointsMode === 'manual' ? null : (submitted[positionField] ? Number(submitted[positionField]) : null);
        const fastestLap = eventRace.pointsMode === 'database' && submitted[fastestField] === 'on';
        const points = eventRace.pointsMode === 'manual'
          ? Number(submitted[pointsField] || 0)
          : await pointsForPosition(position, { ...eventRace.toJSON(), fastestLap });
        const values = {
          GrandPrixResultId: eventRace.id, DriverId: driver.id, TeamId: team.id, driverName: driver.name, teamName: team.name,
          position, status: status || null, points, fastestLap,
          sortOrder: position || driver.sortOrder || 999
        };
        if (current) await current.update(values, { transaction });
        else await GrandPrixResultEntry.create(values, { transaction });
      };
      await saveEvent(race, existing);
      await saveEvent(sprintRace, existingSprint, 'sprint');
      const editorBan = await PenaltyEntry.findOne({
        where: { GrandPrixResultId: race.id, DriverId: driver.id, isRaceBan: true, reason: 'Rennsperre (Ergebnispflege)' }, transaction
      });
      if (submitted.raceBan === 'on') {
        if (!editorBan) {
          const awardedOn = race.raceDate || new Date().toISOString().slice(0, 10);
          const expires = new Date(`${awardedOn}T12:00:00Z`); expires.setUTCFullYear(expires.getUTCFullYear() + 1);
          await PenaltyEntry.create({
            LeagueId: race.LeagueId, DriverId: driver.id, GrandPrixResultId: race.id,
            points: 0, reason: 'Rennsperre (Ergebnispflege)', comment: race.title,
            awardedOn, expiresOn: expires.toISOString().slice(0, 10), isAutomatic: false, isRaceBan: true
          }, { transaction });
        }
      } else if (editorBan) await editorBan.destroy({ transaction });
    }
    });
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    const editorPath = req.body._return === 'current' ? '/admin/current-season-progress' : '/admin/race-editor';
    return res.redirect(`${editorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`);
  }
  await recalculateDriverRaceCounts();
  req.session.flash = { type: 'success', message: `${race.title}: Ergebnis, Punkte und WM wurden automatisch aktualisiert.` };
  const editorPath = req.body._return === 'current' ? '/admin/current-season-progress' : '/admin/race-editor';
  res.redirect(`${editorPath}?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}`);
};

function editorRedirect(values = {}) {
  const query = new URLSearchParams(Object.entries(values).filter(([, value]) => value));
  return `/admin/race-editor${query.size ? `?${query}` : ''}`;
}

exports.createSeason = async (req, res) => {
  try {
    const { season, league } = await seasonProgress.createSeason('f1', req.body);
    req.session.flash = { type: 'success', message: `${season.name} wurde direkt in der Formel-1-Saisonpflege angelegt.` };
    res.redirect(editorRedirect({ league: league.id, season: season.id }));
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    res.redirect(editorRedirect({ league: req.body.LeagueId }));
  }
};

exports.createRace = async (req, res) => {
  try {
    const { main } = await seasonProgress.createManualRace('f1', req.body);
    req.session.flash = { type: 'success', message: `${main.title} wurde angelegt. Die Renntabelle ist sofort bereit.` };
    res.redirect(editorRedirect({ league: main.LeagueId, season: main.SeasonId, race: main.id }));
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    res.redirect(editorRedirect({ league: req.body.LeagueId, season: req.body.SeasonId }));
  }
};

exports.importCalendar = async (req, res) => {
  try {
    const result = await seasonProgress.importCalendar('f1', req.body);
    req.session.flash = { type: 'success', message: `${result.imported} Rennen wurden aus dem F1-Rennkalender übernommen.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(editorRedirect({ league: req.body.LeagueId, season: req.body.SeasonId }));
};

exports.updateRace = async (req, res) => {
  try {
    const { main } = await seasonProgress.updateRaceSettings('f1', req.params.raceId, req.body);
    req.session.flash = { type: 'success', message: 'Rennmodus wurde aktualisiert.' };
    res.redirect(editorRedirect({ league: main.LeagueId, season: main.SeasonId, race: main.id }));
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    res.redirect(editorRedirect());
  }
};

exports.removeRace = async (req, res) => {
  try {
    const race = await GrandPrixResult.findByPk(req.params.raceId);
    const redirect = editorRedirect({ league: race?.LeagueId, season: race?.SeasonId });
    await seasonProgress.removeRaceEvent('f1', req.params.raceId);
    req.session.flash = { type: 'success', message: 'Rennen und zugehöriger Sprint wurden entfernt.' };
    res.redirect(redirect);
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    res.redirect(editorRedirect());
  }
};
