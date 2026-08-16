const { Op } = require('sequelize');
const {
  sequelize, League, Driver, Season, GrandPrixResult, GrandPrixResultEntry,
  ParticipatingLeague, WdlResultEntry, TeamRoster, TeamRosterDriver, Team,
  F1RaceLineupEntry
} = require('../models');
const { pointsForPosition, recalculateDriverRaceCounts } = require('../services/championship');
const seasonProgress = require('../services/seasonProgress');
const { centralTeamDriverIds } = require('../services/teamRosters');
const { regularStarts, reserveStarts } = require('../services/raceLineup');

const disciplines = {
  lmu: { scopeSlug: 'lmu', leagueType: 'lmu', title: 'LMU-Saisonverlauf' },
  wdl: { scopeSlug: 'wettkampf', leagueType: 'wdl', title: 'WDL-Saisonverlauf' }
};

async function loadBase(discipline, query) {
  const config = disciplines[discipline];
  if (!config) return null;
  const leagueType = discipline === 'wdl' ? 'competition' : 'lmu';
  const league = await League.findOne({ where: { slug: config.scopeSlug, type: leagueType } });
  if (!league) return { config, league: null, seasons: [], selectedSeason: null, races: [], selectedRace: null };
  const seasons = await Season.findAll({
    where: { leagueType: config.leagueType, scopeSlug: config.scopeSlug },
    include: [{ association: 'category' }],
    order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']]
  });
  const selectedSeason = seasons.find((season) => season.id === Number(query.season)) || seasons.find((season) => season.status === 'active') || seasons[0] || null;
  const races = selectedSeason ? await GrandPrixResult.findAll({
    where: { SeasonId: selectedSeason.id, discipline },
    order: [['sortOrder', 'ASC'], ['raceDate', 'ASC'], ['id', 'ASC']]
  }) : [];
  const selectedRace = races.find((race) => race.id === Number(query.race)) || races[0] || null;
  return { config, league, seasons, selectedSeason, races, selectedRace };
}

function selectedHistoricalDriverIds(query, entries) {
  const hasExplicitSelection = query && Object.prototype.hasOwnProperty.call(query, 'drivers');
  const raw = Array.isArray(query?.drivers) ? query.drivers : query?.drivers !== undefined ? [query.drivers] : [];
  const storedIds = hasExplicitSelection ? [] : entries.map((entry) => entry.DriverId);
  return [...new Set([...raw, query?.addDriver, ...storedIds]
    .flatMap((value) => String(value || '').split(',')).map(Number)
    .filter((value) => Number.isInteger(value) && value > 0))].slice(0, 20);
}

async function lmuRows(base, query = {}) {
  if (!base.selectedRace) return { rows: [], availableDrivers: [], historicalDriverIds: [], hasLineupPlan: false };
  const [entries, rosters, planEntries] = await Promise.all([
    GrandPrixResultEntry.findAll({ where: { GrandPrixResultId: base.selectedRace.id } }),
    TeamRoster.findAll({
      where: { LeagueId: base.league.id, discipline: 'lmu' },
      include: [{ association: 'team' }, { association: 'assignments', include: [{ association: 'driver' }] }],
      order: [['sortOrder', 'ASC'], ['id', 'ASC'], [{ model: TeamRosterDriver, as: 'assignments' }, 'sortOrder', 'ASC']]
    }),
    base.selectedSeason.status === 'active'
      ? F1RaceLineupEntry.findAll({ where: { GrandPrixResultId: base.selectedRace.id } })
      : []
  ]);
  const teamNames = new Map();
  const teamIds = new Map();
  const defaultDriverIds = new Set();
  const assignedDrivers = new Map();
  rosters.filter((roster) => roster.assignments.length >= 3).forEach((roster) => roster.assignments.forEach((assignment) => {
    teamNames.set(assignment.DriverId, roster.team.name);
    teamIds.set(assignment.DriverId, roster.team.id);
    assignedDrivers.set(assignment.DriverId, assignment.driver);
    if (assignment.roleName !== 'Ersatzfahrer') defaultDriverIds.add(assignment.DriverId);
  }));
  let drivers;
  let availableDrivers = [];
  let historicalDriverIds = [];
  if (base.selectedSeason.status === 'historical') {
    availableDrivers = await Driver.findAll({ include: [{ association: 'aliases' }], order: [['name', 'ASC'], ['id', 'ASC']] });
    historicalDriverIds = selectedHistoricalDriverIds(query, entries);
    drivers = availableDrivers.filter((driver) => historicalDriverIds.includes(driver.id));
  } else {
    const reserves = await Driver.findAll({ where: { roleLmuReserve: true }, include: [{ association: 'lmuCar' }], order: [['name', 'ASC'], ['id', 'ASC']] });
    reserves.forEach((driver) => { if (!assignedDrivers.has(driver.id)) assignedDrivers.set(driver.id, driver); });
    if (planEntries.length) {
      defaultDriverIds.clear();
      const regularEntries = new Map(planEntries.filter((entry) => entry.roleType === 'regular').map((entry) => [entry.DriverId, entry]));
      const startingReplacementFor = new Set(planEntries
        .filter((entry) => entry.roleType === 'reserve' && entry.ReplacementForDriverId && reserveStarts(entry.status))
        .map((entry) => entry.ReplacementForDriverId));
      planEntries.filter((entry) => entry.roleType === 'regular').forEach((entry) => {
        if (regularStarts(entry.status) && !startingReplacementFor.has(entry.DriverId)) defaultDriverIds.add(entry.DriverId);
      });
      planEntries.filter((entry) => entry.roleType === 'reserve' && entry.ReplacementForDriverId && reserveStarts(entry.status)).forEach((entry) => {
        defaultDriverIds.add(entry.DriverId);
        const regular = regularEntries.get(entry.ReplacementForDriverId);
        if (regular?.TeamId) {
          const replacementTeamName = [...rosters].find((roster) => roster.team.id === regular.TeamId)?.team.name;
          teamIds.set(entry.DriverId, regular.TeamId);
          if (replacementTeamName) teamNames.set(entry.DriverId, replacementTeamName);
        }
      });
    }
    drivers = [...assignedDrivers.values()];
  }
  return {
    availableDrivers,
    historicalDriverIds,
    hasLineupPlan: planEntries.length > 0,
    rows: drivers.map((driver) => ({
      driver,
      teamName: teamNames.get(driver.id) || 'LMU-Team offen',
      teamId: teamIds.get(driver.id) || null,
      entry: entries.find((entry) => entry.DriverId === driver.id) || null,
      defaultIncluded: defaultDriverIds.has(driver.id)
    }))
  };
}

async function wdlRows(base) {
  if (!base.selectedRace) return { rows: [], drivers: [] };
  const where = base.selectedSeason.status === 'historical' ? {} : { isActive: true };
  const [participants, entries, drivers] = await Promise.all([
    ParticipatingLeague.findAll({ where, include: [{ association: 'f1Team' }], order: [['sortOrder', 'ASC'], ['id', 'ASC']], limit: base.selectedSeason.status === 'historical' ? undefined : 11 }),
    WdlResultEntry.findAll({ where: { GrandPrixResultId: base.selectedRace.id } }),
    Driver.findAll({ order: [['name', 'ASC'], ['id', 'ASC']] })
  ]);
  const allowedByParticipant = await Promise.all(participants.map((participant) => centralTeamDriverIds(participant.F1TeamId)));
  return {
    drivers,
    rows: participants.map((participant, index) => ({
      participant,
      entry: entries.find((entry) => entry.ParticipatingLeagueId === participant.id) || null,
      allowedDriverIds: base.selectedSeason.status === 'historical'
        ? drivers.map((driver) => driver.id)
        : allowedByParticipant[index]
    }))
  };
}

exports.show = async (req, res, next) => {
  const base = await loadBase(req.params.discipline, req.query);
  if (!base) return next();
  const data = req.params.discipline === 'lmu' ? await lmuRows(base, req.query) : await wdlRows(base);
  res.render('admin/series-editor', { title: base.config.title, discipline: req.params.discipline, ...base, ...data });
};

function redirectFor(discipline, race) {
  return `/admin/season-progress/${discipline}?season=${race.SeasonId}&race=${race.id}`;
}

exports.save = async (req, res, next) => {
  const discipline = req.params.discipline;
  if (!disciplines[discipline]) return next();
  const race = await GrandPrixResult.findByPk(req.params.raceId, { include: [{ association: 'seasonRecord' }] });
  if (!race || race.discipline !== discipline) return res.status(404).render('errors/404', { title: 'Rennen nicht gefunden' });
  const base = { selectedRace: race, selectedSeason: race.seasonRecord, league: await League.findByPk(race.LeagueId) };
  const data = discipline === 'lmu' ? await lmuRows(base, { drivers: Object.keys(req.body.rows || {}) }) : await wdlRows(base);
  const submittedRows = req.body.rows || {};
  const usedPositions = new Map();
  const claimPosition = (positionValue, label) => {
    if (!positionValue) return;
    const position = Number(positionValue);
    if (usedPositions.has(position)) throw new Error(`Platz ${position} wurde doppelt vergeben (${usedPositions.get(position)} und ${label}).`);
    usedPositions.set(position, label);
  };
  try {
    if (discipline === 'lmu') data.rows.forEach(({ driver }) => {
      const row = submittedRows[String(driver.id)] || {};
      if (race.pointsMode === 'database' && row.included === 'on') claimPosition(row.position, driver.name);
    });
    else data.rows.forEach(({ participant }) => {
      const row = submittedRows[String(participant.id)] || {};
      if (race.pointsMode === 'database') {
        claimPosition(row.positionOne, `${participant.name} Fahrer 1`);
        claimPosition(row.positionTwo, `${participant.name} Fahrer 2`);
      }
    });
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    return res.redirect(redirectFor(discipline, race));
  }

  try {
    await sequelize.transaction(async (transaction) => {
    if (discipline === 'lmu') {
      if (race.seasonRecord.status === 'historical') {
        const selectedIds = data.rows.map(({ driver }) => driver.id);
        const omittedWhere = selectedIds.length ? { DriverId: { [Op.notIn]: selectedIds } } : {};
        await GrandPrixResultEntry.destroy({ where: { GrandPrixResultId: race.id, ...omittedWhere }, transaction });
      }
      for (const { driver, teamName, teamId, entry } of data.rows) {
        const row = submittedRows[String(driver.id)] || {};
        if (row.included !== 'on') { if (entry) await entry.destroy({ transaction }); continue; }
        const savedTeamName = row.teamName?.trim() || teamName;
        const matchedTeam = teamId ? null : await Team.findOne({ where: { LeagueId: null, discipline: 'lmu', name: savedTeamName }, transaction });
        const values = {
          GrandPrixResultId: race.id, DriverId: driver.id, driverName: driver.lmuDisplayName || driver.name,
          TeamId: teamId || matchedTeam?.id || null,
          teamName: savedTeamName,
          position: race.pointsMode === 'manual' ? null : (row.position ? Number(row.position) : null),
          status: row.status || null,
          fastestLap: race.pointsMode === 'database' && row.fastestLap === 'on',
          polePosition: race.pointsMode === 'database' && row.polePosition === 'on',
          sortOrder: row.position || driver.sortOrder || 999
        };
        values.points = race.pointsMode === 'manual'
          ? Number(row.points || 0)
          : await pointsForPosition(values.position, { ...race.toJSON(), fastestLap: values.fastestLap, polePosition: values.polePosition });
        if (entry) await entry.update(values, { transaction });
        else await GrandPrixResultEntry.create(values, { transaction });
      }
    } else {
      for (const { participant, entry, allowedDriverIds } of data.rows) {
        const row = submittedRows[String(participant.id)] || {};
        const driverOneId = row.Driver1Id ? Number(row.Driver1Id) : null;
        const driverTwoId = row.Driver2Id ? Number(row.Driver2Id) : null;
        if (driverOneId && driverTwoId && driverOneId === driverTwoId) throw new Error(`${participant.name}: Bitte zwei unterschiedliche Fahrer auswählen.`);
        if (race.seasonRecord.status !== 'historical' && [driverOneId, driverTwoId].filter(Boolean).some((id) => !allowedDriverIds.includes(id))) {
          throw new Error(`${participant.name}: Fahrer müssen aus dem zugeordneten F1-Team stammen.`);
        }
        const values = {
          GrandPrixResultId: race.id, ParticipatingLeagueId: participant.id,
          Driver1Id: driverOneId, Driver2Id: driverTwoId,
          positionOne: race.pointsMode === 'manual' ? null : (row.positionOne ? Number(row.positionOne) : null),
          positionTwo: race.pointsMode === 'manual' ? null : (row.positionTwo ? Number(row.positionTwo) : null),
          fastestLapOne: race.pointsMode === 'database' && row.fastestLapOne === 'on',
          fastestLapTwo: race.pointsMode === 'database' && row.fastestLapTwo === 'on', sortOrder: participant.sortOrder
        };
        values.pointsOne = race.pointsMode === 'manual'
          ? Number(row.pointsOne || 0)
          : await pointsForPosition(values.positionOne, { ...race.toJSON(), fastestLap: values.fastestLapOne });
        values.pointsTwo = race.pointsMode === 'manual'
          ? Number(row.pointsTwo || 0)
          : await pointsForPosition(values.positionTwo, { ...race.toJSON(), fastestLap: values.fastestLapTwo });
        values.totalPoints = values.pointsOne + values.pointsTwo;
        if (entry) await entry.update(values, { transaction });
        else await WdlResultEntry.create(values, { transaction });
      }
    }
    });
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    return res.redirect(redirectFor(discipline, race));
  }
  if (discipline === 'lmu') await recalculateDriverRaceCounts();
  req.session.flash = { type: 'success', message: `${race.title}: Das vollständige Rennergebnis wurde gespeichert und neu berechnet.` };
  res.redirect(redirectFor(discipline, race));
};

function progressRedirect(discipline, values = {}) {
  const query = new URLSearchParams(Object.entries(values).filter(([, value]) => value));
  return `/admin/season-progress/${discipline}${query.size ? `?${query}` : ''}`;
}

exports.createSeason = async (req, res, next) => {
  const discipline = req.params.discipline;
  if (!disciplines[discipline]) return next();
  try {
    const { season } = await seasonProgress.createSeason(discipline, req.body);
    req.session.flash = { type: 'success', message: `${season.name} wurde direkt in der ${discipline.toUpperCase()}-Pflege angelegt.` };
    res.redirect(progressRedirect(discipline, { season: season.id }));
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    res.redirect(progressRedirect(discipline));
  }
};

exports.createRace = async (req, res, next) => {
  const discipline = req.params.discipline;
  if (!disciplines[discipline]) return next();
  try {
    const { main } = await seasonProgress.createManualRace(discipline, req.body);
    req.session.flash = { type: 'success', message: `${main.title} wurde angelegt. Die Renntabelle ist sofort bereit.` };
    res.redirect(progressRedirect(discipline, { season: main.SeasonId, race: main.id }));
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    res.redirect(progressRedirect(discipline, { season: req.body.SeasonId }));
  }
};

exports.importCalendar = async (req, res, next) => {
  const discipline = req.params.discipline;
  if (!disciplines[discipline]) return next();
  try {
    const result = await seasonProgress.importCalendar(discipline, req.body);
    req.session.flash = { type: 'success', message: `${result.imported} Rennen wurden aus dem ${discipline.toUpperCase()}-Rennkalender übernommen.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  res.redirect(progressRedirect(discipline, { season: req.body.SeasonId }));
};

exports.updateRace = async (req, res, next) => {
  const discipline = req.params.discipline;
  if (!disciplines[discipline]) return next();
  try {
    const { main } = await seasonProgress.updateRaceSettings(discipline, req.params.raceId, req.body);
    req.session.flash = { type: 'success', message: 'Eingabemodus wurde aktualisiert.' };
    res.redirect(progressRedirect(discipline, { season: main.SeasonId, race: main.id }));
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    res.redirect(progressRedirect(discipline));
  }
};

exports.removeRace = async (req, res, next) => {
  const discipline = req.params.discipline;
  if (!disciplines[discipline]) return next();
  try {
    const race = await GrandPrixResult.findByPk(req.params.raceId);
    const redirect = progressRedirect(discipline, { season: race?.SeasonId });
    await seasonProgress.removeRaceEvent(discipline, req.params.raceId);
    req.session.flash = { type: 'success', message: 'Rennen wurde entfernt.' };
    res.redirect(redirect);
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    res.redirect(progressRedirect(discipline));
  }
};
