const { Op } = require('sequelize');
const {
  sequelize, League, Driver, Season, GrandPrixResult, GrandPrixResultEntry,
  ParticipatingLeague, WdlResultEntry, LmuCockpit
} = require('../models');
const { pointsForPosition, recalculateDriverRaceCounts } = require('../services/championship');

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

async function lmuRows(base) {
  if (!base.selectedRace) return { rows: [] };
  const driverWhere = base.selectedSeason.status === 'historical' ? {} : {
    [Op.or]: [{ roleLmuRegular: true }, { roleLmuReserve: true }]
  };
  const [drivers, entries, cockpits] = await Promise.all([
    Driver.findAll({ where: driverWhere, order: [['name', 'ASC'], ['id', 'ASC']] }),
    GrandPrixResultEntry.findAll({ where: { GrandPrixResultId: base.selectedRace.id } }),
    LmuCockpit.findAll({ where: { LeagueId: base.league.id } })
  ]);
  const teamNames = new Map();
  cockpits.forEach((cockpit) => {
    [cockpit.Driver1Id, cockpit.Driver2Id, cockpit.Driver3Id, cockpit.ReserveDriverId]
      .filter(Boolean).forEach((driverId) => teamNames.set(Number(driverId), cockpit.teamName));
  });
  return {
    rows: drivers.map((driver) => ({
      driver,
      teamName: teamNames.get(driver.id) || 'LMU-Team offen',
      entry: entries.find((entry) => entry.DriverId === driver.id) || null
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
  return {
    drivers,
    rows: participants.map((participant) => ({
      participant,
      entry: entries.find((entry) => entry.ParticipatingLeagueId === participant.id) || null,
      allowedDriverIds: base.selectedSeason.status === 'historical'
        ? drivers.map((driver) => driver.id)
        : [participant.f1Team?.Driver1Id, participant.f1Team?.Driver2Id].filter(Boolean).map(Number)
    }))
  };
}

exports.show = async (req, res, next) => {
  const base = await loadBase(req.params.discipline, req.query);
  if (!base) return next();
  const data = req.params.discipline === 'lmu' ? await lmuRows(base) : await wdlRows(base);
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
  const data = discipline === 'lmu' ? await lmuRows(base) : await wdlRows(base);
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
      if (row.included === 'on') claimPosition(row.position, driver.name);
    });
    else data.rows.forEach(({ participant }) => {
      const row = submittedRows[String(participant.id)] || {};
      claimPosition(row.positionOne, `${participant.name} Fahrer 1`);
      claimPosition(row.positionTwo, `${participant.name} Fahrer 2`);
    });
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
    return res.redirect(redirectFor(discipline, race));
  }

  try {
    await sequelize.transaction(async (transaction) => {
    if (discipline === 'lmu') {
      for (const { driver, teamName, entry } of data.rows) {
        const row = submittedRows[String(driver.id)] || {};
        if (row.included !== 'on') { if (entry) await entry.destroy({ transaction }); continue; }
        const values = {
          GrandPrixResultId: race.id, DriverId: driver.id, driverName: driver.name,
          teamName: row.teamName?.trim() || teamName, position: row.position ? Number(row.position) : null,
          status: row.status || null, fastestLap: row.fastestLap === 'on', sortOrder: row.position || driver.sortOrder || 999
        };
        values.points = await pointsForPosition(values.position, { ...race.toJSON(), fastestLap: values.fastestLap });
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
          positionOne: row.positionOne ? Number(row.positionOne) : null,
          positionTwo: row.positionTwo ? Number(row.positionTwo) : null,
          fastestLapOne: row.fastestLapOne === 'on', fastestLapTwo: row.fastestLapTwo === 'on', sortOrder: participant.sortOrder
        };
        values.pointsOne = await pointsForPosition(values.positionOne, { ...race.toJSON(), fastestLap: values.fastestLapOne });
        values.pointsTwo = await pointsForPosition(values.positionTwo, { ...race.toJSON(), fastestLap: values.fastestLapTwo });
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
