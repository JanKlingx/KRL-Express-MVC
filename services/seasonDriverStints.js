const {
  SeasonLineupEntry,
  SeasonDriverStint,
  GrandPrixResult,
  GrandPrixResultEntry,
  F1RaceLineupEntry
} = require('../models');

const ROLE_TYPES = new Set(['regular', 'reserve']);
const END_REASONS = new Set([
  'left',
  'promoted',
  'demoted',
  'team_change',
  'replaced',
  'other'
]);

function normalizeRound(value, label = 'Runde') {
  const round = Number(value);
  if (!Number.isInteger(round) || round < 1) {
    throw new Error(`${label} muss eine ganze Zahl größer als 0 sein.`);
  }
  return round;
}

function validateStintRange(fromRound, toRound) {
  const start = normalizeRound(fromRound, 'Startrunde');
  if (toRound === null || toRound === undefined || toRound === '') return;
  const end = normalizeRound(toRound, 'Endrunde');
  if (start > end) {
    throw new Error('Die Startrunde darf nicht nach der Endrunde liegen.');
  }
}

function isRoundInStint(stint, roundValue) {
  const round = Number(roundValue);
  if (!Number.isFinite(round)) return false;
  return round >= Number(stint.fromRound) &&
    (stint.toRound === null || stint.toRound === undefined || round <= Number(stint.toRound));
}

function regularRoleFields(leagueSlug) {
  if (leagueSlug === 'freitag') return ['roleF1Friday', 'roleF1ReserveFriday', 'roleFormerF1'];
  if (leagueSlug === 'samstag') return ['roleF1Saturday', 'roleF1ReserveSaturday', 'roleFormerF1'];
  if (leagueSlug === 'sonntag') return ['roleF1Sunday', 'roleF1ReserveSunday', 'roleFormerF1'];
  return [];
}

function driverCanBecomeRegular(driver, leagueSlug) {
  return regularRoleFields(leagueSlug).some((field) => driver?.[field] === true);
}

function stintRangesOverlap(left, right) {
  const leftEnd = left.toRound == null ? Number.POSITIVE_INFINITY : Number(left.toRound);
  const rightEnd = right.toRound == null ? Number.POSITIVE_INFINITY : Number(right.toRound);
  return Number(left.fromRound) <= rightEnd && Number(right.fromRound) <= leftEnd;
}

function validateRegularStintSet(stints, maximumTeamSeats = 2) {
  const regulars = stints.filter((stint) => stint.roleType === 'regular');
  for (let index = 0; index < regulars.length; index += 1) {
    const left = regulars[index];
    for (let candidateIndex = index + 1; candidateIndex < regulars.length; candidateIndex += 1) {
      const right = regulars[candidateIndex];
      if (!stintRangesOverlap(left, right)) continue;
      if (Number(left.DriverId) === Number(right.DriverId)) {
        throw new Error('Ein Fahrer darf in derselben Runde nicht mehrere Stammfahrer-Stints besitzen.');
      }
    }
  }
  const boundaries = new Set(regulars.flatMap((stint) => [
    Number(stint.fromRound),
    ...(stint.toRound == null ? [] : [Number(stint.toRound) + 1])
  ]));
  for (const round of boundaries) {
    const counts = new Map();
    regulars.filter((stint) => isRoundInStint(stint, round)).forEach((stint) => {
      const teamId = Number(stint.SeasonTeamId);
      counts.set(teamId, (counts.get(teamId) || 0) + 1);
    });
    if ([...counts.values()].some((count) => count > maximumTeamSeats)) {
      throw new Error('Ein Saisonteam darf pro Runde höchstens zwei aktive Stammfahrer besitzen.');
    }
  }
}

async function seasonLineupIsProtected(season, transaction) {
  if (!season) return false;
  if (season.isPublished || season.status === 'historical') return true;
  const [stints, resultIds] = await Promise.all([
    SeasonDriverStint.findAll({
      where: { SeasonId: season.id },
      attributes: ['fromRound', 'toRound'],
      transaction,
      raw: true
    }),
    GrandPrixResult.findAll({ where: { SeasonId: season.id }, attributes: ['id'], transaction, raw: true })
  ]);
  if (stints.some((stint) => Number(stint.fromRound) > 1 || stint.toRound != null)) return true;
  const ids = resultIds.map((row) => Number(row.id)).filter(Boolean);
  if (!ids.length) return false;
  const [results, weekends] = await Promise.all([
    GrandPrixResultEntry.count({ where: { GrandPrixResultId: ids }, transaction }),
    F1RaceLineupEntry.count({ where: { GrandPrixResultId: ids }, transaction })
  ]);
  return Boolean(results || weekends);
}

function canCarryReservePoints(reserveStint, regularTeamId) {
  return Boolean(
    reserveStint &&
    reserveStint.roleType === 'reserve' &&
    Number(reserveStint.SeasonTeamId) === Number(regularTeamId)
  );
}

function validateStintValues(values) {
  if (!ROLE_TYPES.has(values.roleType)) {
    throw new Error('Die Fahrerrolle ist ungültig.');
  }
  if (values.endReason && !END_REASONS.has(values.endReason)) {
    throw new Error('Der Wechselgrund ist ungültig.');
  }
  validateStintRange(values.fromRound, values.toRound);
}

async function seedSeasonDriverStints(seasonId, transaction) {
  const lineup = await SeasonLineupEntry.findAll({
    where: { SeasonId: seasonId },
    order: [['sortOrder', 'ASC'], ['id', 'ASC']],
    transaction
  });

  let created = 0;
  for (const entry of lineup) {
    const activeStint = await SeasonDriverStint.findOne({
      where: {
        SeasonId: Number(seasonId),
        DriverId: Number(entry.DriverId),
        roleType: entry.roleType,
        toRound: null
      },
      transaction
    });

    if (activeStint) {
      if (!activeStint.SeasonTeamId && entry.SeasonTeamId) {
        await activeStint.update({ SeasonTeamId: entry.SeasonTeamId }, { transaction });
      }
      continue;
    }

    const latestStint = await SeasonDriverStint.findOne({
      where: {
        SeasonId: Number(seasonId),
        DriverId: Number(entry.DriverId),
        roleType: entry.roleType
      },
      order: [['fromRound', 'DESC'], ['id', 'DESC']],
      transaction
    });
    const fromRound = latestStint
      ? Number(latestStint.toRound || latestStint.fromRound) + 1
      : 1;

    const [stint, wasCreated] = await SeasonDriverStint.findOrCreate({
      where: {
        SeasonId: Number(seasonId),
        DriverId: Number(entry.DriverId),
        roleType: entry.roleType,
        fromRound
      },
      defaults: {
        SeasonId: Number(seasonId),
        DriverId: Number(entry.DriverId),
        SeasonTeamId: entry.SeasonTeamId || null,
        roleType: entry.roleType,
        fromRound,
        toRound: null,
        endReason: null,
        carryReservePoints: false
      },
      transaction
    });

    if (wasCreated) {
      created += 1;
    } else if (!stint.SeasonTeamId && entry.SeasonTeamId) {
      await stint.update({ SeasonTeamId: entry.SeasonTeamId }, { transaction });
    }
  }

  return created;
}

module.exports = {
  END_REASONS,
  canCarryReservePoints,
  driverCanBecomeRegular,
  isRoundInStint,
  normalizeRound,
  regularRoleFields,
  seasonLineupIsProtected,
  seedSeasonDriverStints,
  stintRangesOverlap,
  validateRegularStintSet,
  validateStintRange,
  validateStintValues
};

