const { Op } = require('sequelize');
const {
  F1CarProfile,
  GrandPrixResult,
  GrandPrixResultEntry,
  F1RaceLineupEntry,
  SeasonDriverCarryOver
} = require('../models');

const REGULAR_ROLE_BY_SLUG = {
  freitag: 'roleF1Friday',
  samstag: 'roleF1Saturday',
  sonntag: 'roleF1Sunday'
};

const RESERVE_ROLE_BY_SLUG = {
  freitag: 'roleF1ReserveFriday',
  samstag: 'roleF1ReserveSaturday',
  sonntag: 'roleF1ReserveSunday'
};

function normalizedF1RoleValues(values) {
  const regularSlugs = Object.entries(REGULAR_ROLE_BY_SLUG)
    .filter(([, field]) => Boolean(values[field]))
    .map(([slug]) => slug);
  const reserveSlugs = Object.entries(RESERVE_ROLE_BY_SLUG)
    .filter(([, field]) => Boolean(values[field]))
    .map(([slug]) => slug);

  for (const slug of regularSlugs) {
    if (reserveSlugs.includes(slug)) {
      throw new Error(`Der Fahrer kann am ${slug} nicht gleichzeitig Stamm- und Ersatzfahrer sein.`);
    }
  }

  return {
    ...values,
    roleF1Reserve: reserveSlugs.length > 0,
    roleFormerF1: regularSlugs.length === 0 && reserveSlugs.length === 0,
    f1Role: reserveSlugs.length
      ? 'reserve'
      : regularSlugs.length === 1
        ? { freitag: 'friday', samstag: 'saturday', sonntag: 'sunday' }[regularSlugs[0]]
        : null
  };
}

function driverRoleValuesAfterPromotion(driver, leagueSlug) {
  const regularField = REGULAR_ROLE_BY_SLUG[leagueSlug];
  const reserveField = RESERVE_ROLE_BY_SLUG[leagueSlug];
  if (!regularField || !reserveField) throw new Error('Die F1-Liga ist ungültig.');
  return normalizedF1RoleValues({
    roleF1Friday: Boolean(driver.roleF1Friday),
    roleF1Saturday: Boolean(driver.roleF1Saturday),
    roleF1Sunday: Boolean(driver.roleF1Sunday),
    roleF1ReserveFriday: Boolean(driver.roleF1ReserveFriday),
    roleF1ReserveSaturday: Boolean(driver.roleF1ReserveSaturday),
    roleF1ReserveSunday: Boolean(driver.roleF1ReserveSunday),
    [regularField]: true,
    [reserveField]: false
  });
}

function driverRoleValuesAfterRelease(driver, leagueSlug, reserveSlugs = []) {
  const regularField = REGULAR_ROLE_BY_SLUG[leagueSlug];
  if (!regularField) throw new Error('Die F1-Liga ist ungültig.');
  const selected = new Set(reserveSlugs);
  if ([...selected].some((slug) => !RESERVE_ROLE_BY_SLUG[slug])) {
    throw new Error('Mindestens ein ausgewählter Ersatzfahrer-Tag ist ungültig.');
  }
  return normalizedF1RoleValues({
    roleF1Friday: Boolean(driver.roleF1Friday),
    roleF1Saturday: Boolean(driver.roleF1Saturday),
    roleF1Sunday: Boolean(driver.roleF1Sunday),
    roleF1ReserveFriday: selected.has('freitag'),
    roleF1ReserveSaturday: selected.has('samstag'),
    roleF1ReserveSunday: selected.has('sonntag'),
    [regularField]: false
  });
}

async function actualTeamIdForSeasonTeam(seasonTeam, transaction) {
  if (!seasonTeam) return null;
  if (seasonTeam.sourceType === 'current') return Number(seasonTeam.sourceId) || null;
  const profile = await F1CarProfile.findByPk(seasonTeam.sourceId, { transaction });
  return Number(profile?.BaseTeamId) || null;
}

async function completedRoundForSeason(seasonId, transaction) {
  const races = await GrandPrixResult.findAll({
    where: { SeasonId: seasonId, discipline: 'f1', raceType: 'main' },
    include: [{ model: GrandPrixResultEntry, as: 'entries', attributes: ['id'], required: false }],
    order: [['sortOrder', 'DESC']],
    transaction
  });
  return Number(races.find((race) => race.entries?.length)?.sortOrder) || 0;
}

async function reserveWeekendHistory({ seasonId, driverId, seasonTeam, beforeRound, transaction }) {
  const actualTeamId = await actualTeamIdForSeasonTeam(seasonTeam, transaction);
  if (!actualTeamId) return [];
  const mains = await GrandPrixResult.findAll({
    where: {
      SeasonId: seasonId,
      discipline: 'f1',
      raceType: 'main',
      sortOrder: { [Op.lt]: beforeRound }
    },
    include: [{
      model: GrandPrixResultEntry,
      as: 'entries',
      where: { DriverId: driverId, TeamId: actualTeamId },
      required: true
    }],
    order: [['sortOrder', 'ASC']],
    transaction
  });
  if (!mains.length) return [];
  const lineups = await F1RaceLineupEntry.findAll({
    where: {
      GrandPrixResultId: { [Op.in]: mains.map((race) => race.id) },
      DriverId: driverId,
      roleType: 'reserve',
      includeInResults: true
    },
    transaction
  });
  const reserveMainIds = new Set(lineups.map((entry) => Number(entry.GrandPrixResultId)));
  const eligibleMains = mains.filter((race) => reserveMainIds.has(Number(race.id)));
  if (!eligibleMains.length) return [];
  const sprints = await GrandPrixResult.findAll({
    where: {
      SeasonId: seasonId,
      discipline: 'f1',
      raceType: 'sprint',
      sortOrder: { [Op.in]: eligibleMains.map((race) => Number(race.sortOrder)) }
    },
    include: [{
      model: GrandPrixResultEntry,
      as: 'entries',
      where: { DriverId: driverId, TeamId: actualTeamId },
      required: false
    }],
    transaction
  });
  const sprintByRound = new Map(sprints.map((race) => [Number(race.sortOrder), race]));
  return eligibleMains.map((race) => {
    const sprint = sprintByRound.get(Number(race.sortOrder));
    const mainPoints = (race.entries || []).reduce((sum, entry) => sum + Number(entry.points || 0), 0);
    const sprintPoints = (sprint?.entries || []).reduce((sum, entry) => sum + Number(entry.points || 0), 0);
    return {
      GrandPrixResultId: Number(race.id),
      round: Number(race.sortOrder),
      title: race.title,
      raceDate: race.raceDate,
      mainPoints,
      sprintPoints,
      totalPoints: mainPoints + sprintPoints,
      roleType: 'reserve',
      teamName: seasonTeam.name
    };
  });
}

function hasConfirmedWeekendData(entry) {
  return Boolean(
    entry.includeInResults === true ||
    entry.attendanceStatus ||
    entry.ReplacementForDriverId != null ||
    String(entry.status || 'anwesend') !== 'anwesend' ||
    entry.uncertainPresent !== null && entry.uncertainPresent !== undefined ||
    entry.respondedInTime === true
  );
}

async function futureWeekendPlan({ seasonId, effectiveRound, transaction }) {
  const mains = await GrandPrixResult.findAll({
    where: {
      SeasonId: seasonId,
      discipline: 'f1',
      raceType: 'main',
      sortOrder: { [Op.gte]: effectiveRound }
    },
    include: [{ model: GrandPrixResultEntry, as: 'entries', attributes: ['id'], required: false }],
    order: [['sortOrder', 'ASC']],
    transaction,
    lock: transaction?.LOCK?.UPDATE
  });
  if (!mains.length) return [];
  const ids = mains.map((race) => Number(race.id));
  const rounds = mains.map((race) => Number(race.sortOrder));
  const [lineups, sprintResults] = await Promise.all([
    F1RaceLineupEntry.findAll({
      where: { GrandPrixResultId: { [Op.in]: ids } },
      transaction,
      lock: transaction?.LOCK?.UPDATE
    }),
    GrandPrixResult.findAll({
      where: { SeasonId: seasonId, discipline: 'f1', raceType: 'sprint', sortOrder: { [Op.in]: rounds } },
      include: [{ model: GrandPrixResultEntry, as: 'entries', attributes: ['id'], required: false }],
      transaction
    })
  ]);
  const lineupByRace = new Map();
  lineups.forEach((entry) => {
    const id = Number(entry.GrandPrixResultId);
    if (!lineupByRace.has(id)) lineupByRace.set(id, []);
    lineupByRace.get(id).push(entry);
  });
  const sprintByRound = new Map(sprintResults.map((race) => [Number(race.sortOrder), race]));
  return mains.map((race) => ({
    race,
    entries: lineupByRace.get(Number(race.id)) || [],
    conflict: Boolean(
      race.entries?.length ||
      sprintByRound.get(Number(race.sortOrder))?.entries?.length ||
      (lineupByRace.get(Number(race.id)) || []).some(hasConfirmedWeekendData)
    )
  }));
}

async function syncFutureLineups({ plans, operation, oldDriverId, newDriverId, actualTeamId, transaction }) {
  for (const plan of plans) {
    if (plan.conflict) {
      throw new Error(`R${plan.race.sortOrder} besitzt bereits bestätigte Rennwochenenden-Daten. Der Fahrerwechsel kann erst ab einer späteren freien Runde gelten oder das Rennwochenende muss zuerst kontrolliert zurückgesetzt werden.`);
    }
    if (!plan.entries.length) continue;
    const oldEntry = plan.entries.find((entry) =>
      entry.roleType === 'regular' && Number(entry.DriverId) === Number(oldDriverId)
    );
    const newEntry = plan.entries.find((entry) => Number(entry.DriverId) === Number(newDriverId));
    if (operation === 'release') {
      if (oldEntry) {
        await F1RaceLineupEntry.update(
          { ReplacementForDriverId: null, TeamId: null },
          { where: { GrandPrixResultId: plan.race.id, ReplacementForDriverId: oldDriverId }, transaction }
        );
        await oldEntry.destroy({ transaction });
      }
      continue;
    }
    if (operation === 'replace' && oldEntry) await oldEntry.destroy({ transaction });
    if (newEntry) {
      await newEntry.update({
        roleType: 'regular', status: 'anwesend', TeamId: actualTeamId,
        ReplacementForDriverId: null, attendanceStatus: null,
        includeInResults: false, uncertainPresent: null, respondedInTime: false
      }, { transaction });
    } else {
      await F1RaceLineupEntry.create({
        GrandPrixResultId: plan.race.id,
        DriverId: newDriverId,
        TeamId: actualTeamId,
        roleType: 'regular',
        status: 'anwesend',
        attendanceStatus: null,
        includeInResults: false,
        uncertainPresent: null,
        respondedInTime: false,
        sortOrder: oldEntry?.sortOrder || 0
      }, { transaction });
    }
  }
}

async function saveCarryOvers({ selectedRaceIds, availableHistory, values, transaction }) {
  const allowed = new Set(availableHistory.map((row) => Number(row.GrandPrixResultId)));
  const selected = [...new Set(selectedRaceIds.map(Number).filter((id) => allowed.has(id)))];
  if (selected.length !== new Set(selectedRaceIds.map(Number).filter(Boolean)).size) {
    throw new Error('Mindestens eine Carry-over-Auswahl verweist nicht auf einen echten Ersatzeinsatz dieses Fahrers und Teams.');
  }
  for (const GrandPrixResultId of selected) {
    await SeasonDriverCarryOver.create({ ...values, GrandPrixResultId, selected: true }, { transaction });
  }
  return selected.length;
}

module.exports = {
  actualTeamIdForSeasonTeam,
  completedRoundForSeason,
  driverRoleValuesAfterPromotion,
  driverRoleValuesAfterRelease,
  futureWeekendPlan,
  hasConfirmedWeekendData,
  reserveWeekendHistory,
  saveCarryOvers,
  syncFutureLineups
};

