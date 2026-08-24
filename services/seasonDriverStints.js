const {
  SeasonLineupEntry,
  SeasonDriverStint
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
  isRoundInStint,
  normalizeRound,
  seedSeasonDriverStints,
  validateStintRange,
  validateStintValues
};
