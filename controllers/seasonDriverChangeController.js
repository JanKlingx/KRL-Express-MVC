const { Op } = require('sequelize');
const {
  sequelize,
  League,
  Season,
  SeasonDriver,
  SeasonTeam,
  SeasonLineupEntry,
  SeasonDriverStint,
  Driver,
  GrandPrixResult,
  GrandPrixResultEntry,
  F1RaceLineupEntry
} = require('../models');
const {
  canCarryReservePoints,
  normalizeRound,
  seedSeasonDriverStints,
  validateStintValues
} = require('../services/seasonDriverStints');

const REASONS = [
  ['left', 'Fahrer hört auf'],
  ['promoted', 'Ersatzfahrer wird Stammfahrer'],
  ['replaced', 'Stammfahrer wird ersetzt'],
  ['team_change', 'Teamwechsel'],
  ['other', 'Sonstiges']
];
const REASON_VALUES = new Set(REASONS.map(([value]) => value));

function redirectUrl({ LeagueId, SeasonId, SeasonTeamId } = {}) {
  const query = new URLSearchParams();
  if (LeagueId) query.set('league', LeagueId);
  if (SeasonId) query.set('season', SeasonId);
  if (SeasonTeamId) query.set('team', SeasonTeamId);
  return `/admin/season-driver-change${query.size ? `?${query}` : ''}`;
}

async function completedRoundForSeason(seasonId) {
  const races = await GrandPrixResult.findAll({
    where: { SeasonId: seasonId, discipline: 'f1', raceType: 'main' },
    include: [{ model: GrandPrixResultEntry, as: 'entries', attributes: ['id'], required: false }],
    order: [['sortOrder', 'DESC']],
  });
  return races.find((race) => race.entries?.length)?.sortOrder || 0;
}

async function reserveHistoryMatchesTeam(seasonId, driverId, seasonTeam, beforeRound) {
  const [results, mains] = await Promise.all([
    GrandPrixResult.findAll({
      where: {
        SeasonId: seasonId,
        discipline: 'f1',
        sortOrder: { [Op.lt]: beforeRound }
      },
      include: [{
        model: GrandPrixResultEntry,
        as: 'entries',
        where: { DriverId: driverId },
        required: true
      }]
    }),
    GrandPrixResult.findAll({
      where: {
        SeasonId: seasonId,
        discipline: 'f1',
        raceType: 'main',
        sortOrder: { [Op.lt]: beforeRound }
      },
      attributes: ['id', 'sortOrder']
    })
  ]);
  if (!mains.length) return false;
  const reserveLineups = await F1RaceLineupEntry.findAll({
    where: {
      GrandPrixResultId: { [Op.in]: mains.map((race) => race.id) },
      DriverId: driverId,
      roleType: 'reserve'
    }
  });
  const reserveMainIds = new Set(reserveLineups.map((row) => Number(row.GrandPrixResultId)));
  const reserveRounds = new Set(
    mains.filter((race) => reserveMainIds.has(Number(race.id))).map((race) => Number(race.sortOrder))
  );
  const entries = results
    .filter((race) => race.raceType === 'main'
      ? reserveMainIds.has(Number(race.id))
      : reserveRounds.has(Number(race.sortOrder)))
    .flatMap((race) => race.entries || []);
  if (!entries.length) return false;
  return entries.every((entry) => {
    if (entry.teamName && seasonTeam.name) {
      return String(entry.teamName).trim().toLowerCase() ===
        String(seasonTeam.name).trim().toLowerCase();
    }
    return seasonTeam.sourceType === 'current' &&
      Number(entry.TeamId) === Number(seasonTeam.sourceId);
  });
}

async function loadPageData(query = {}) {
  const leagues = await League.findAll({
    where: { type: 'f1', slug: { [Op.in]: ['freitag', 'samstag', 'sonntag'] } },
    order: [['sortOrder', 'ASC'], ['id', 'ASC']]
  });
  const selectedLeague = leagues.find((row) => Number(row.id) === Number(query.league)) || null;
  const seasons = selectedLeague ? await Season.findAll({
    where: { leagueType: 'f1', scopeSlug: selectedLeague.slug },
    order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']]
  }) : [];
  const selectedSeason = seasons.find((row) => Number(row.id) === Number(query.season)) || null;

  if (!selectedSeason) {
    return {
      leagues,
      seasons,
      selectedLeague,
      selectedSeason: null,
      teams: [],
      lineup: [],
      memberships: [],
      stints: [],
      completedRound: 0,
      selectedTeamId: null
    };
  }

  await seedSeasonDriverStints(selectedSeason.id);
  const [teams, lineup, memberships, stints, completedRound] = await Promise.all([
    SeasonTeam.findAll({
      where: { SeasonId: selectedSeason.id },
      order: [['sortOrder', 'ASC'], ['id', 'ASC']]
    }),
    SeasonLineupEntry.findAll({
      where: { SeasonId: selectedSeason.id },
      include: [{ association: 'driver' }],
      order: [['sortOrder', 'ASC'], ['id', 'ASC']]
    }),
    SeasonDriver.findAll({
      where: { SeasonId: selectedSeason.id },
      include: [{ association: 'driver' }],
      order: [['sortOrder', 'ASC'], ['id', 'ASC']]
    }),
    SeasonDriverStint.findAll({
      where: { SeasonId: selectedSeason.id },
      include: [{ association: 'driver' }, { association: 'seasonTeam' }],
      order: [['fromRound', 'ASC'], ['id', 'ASC']]
    }),
    completedRoundForSeason(selectedSeason.id)
  ]);

  return {
    leagues,
    seasons,
    selectedLeague,
    selectedSeason,
    teams,
    lineup,
    memberships,
    stints,
    completedRound: Number(completedRound) || 0,
    selectedTeamId: Number(query.team) || null
  };
}

exports.show = async (req, res) => {
  const data = await loadPageData(req.query);
  res.render('admin/season-driver-change', {
    title: 'F1-Fahrerwechsel',
    reasons: REASONS,
    ...data
  });
};

exports.save = async (req, res) => {
  const ids = {
    LeagueId: Number(req.body.LeagueId),
    SeasonId: Number(req.body.SeasonId),
    SeasonTeamId: Number(req.body.SeasonTeamId),
    OldDriverId: Number(req.body.OldDriverId),
    NewDriverId: Number(req.body.NewDriverId)
  };

  try {
    const effectiveRound = normalizeRound(req.body.effectiveRound, 'Wirksam-ab-Runde');
    const endReason = String(req.body.endReason || 'other');
    const carryRequested = req.body.carryReservePoints === 'on';
    if (!REASON_VALUES.has(endReason)) throw new Error('Der Wechselgrund ist ungültig.');
    if (!Object.values(ids).every((value) => Number.isInteger(value) && value > 0)) {
      throw new Error('Liga, Saison, Team sowie alter und neuer Fahrer sind Pflichtfelder.');
    }
    if (ids.OldDriverId === ids.NewDriverId) {
      throw new Error('Alter und neuer Stammfahrer dürfen nicht identisch sein.');
    }

    const [league, season, team, oldDriver, newDriver, membership, completedRound] = await Promise.all([
      League.findOne({ where: { id: ids.LeagueId, type: 'f1' } }),
      Season.findByPk(ids.SeasonId),
      SeasonTeam.findByPk(ids.SeasonTeamId),
      Driver.findByPk(ids.OldDriverId),
      Driver.findByPk(ids.NewDriverId),
      SeasonDriver.findOne({ where: { SeasonId: ids.SeasonId, DriverId: ids.NewDriverId } }),
      completedRoundForSeason(ids.SeasonId)
    ]);

    if (!league || !season || season.leagueType !== 'f1' || season.scopeSlug !== league.slug) {
      throw new Error('Saison und Liga passen nicht zusammen.');
    }
    if (!team || Number(team.SeasonId) !== Number(season.id)) {
      throw new Error('Das ausgewählte Team gehört nicht zu dieser Saison.');
    }
    if (!oldDriver || !newDriver) throw new Error('Mindestens ein Fahrer wurde nicht gefunden.');
    if (!membership) throw new Error('Der neue Fahrer gehört nicht zum Fahrerpool dieser Saison.');
    if (effectiveRound <= Number(completedRound)) {
      throw new Error(`Runde ${effectiveRound} wurde bereits gefahren. Der Wechsel ist frühestens ab Runde ${Number(completedRound) + 1} möglich.`);
    }
    const inferredSameTeamReserve = await reserveHistoryMatchesTeam(
      season.id,
      newDriver.id,
      team,
      effectiveRound
    );

    await sequelize.transaction(async (transaction) => {
      const oldLineup = await SeasonLineupEntry.findOne({
        where: {
          SeasonId: season.id,
          SeasonTeamId: team.id,
          DriverId: oldDriver.id,
          roleType: 'regular'
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!oldLineup) throw new Error('Der alte Fahrer ist aktuell kein Stammfahrer dieses Teams.');

      let oldStint = await SeasonDriverStint.findOne({
        where: {
          SeasonId: season.id,
          SeasonTeamId: team.id,
          DriverId: oldDriver.id,
          roleType: 'regular',
          toRound: null
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!oldStint) {
        oldStint = await SeasonDriverStint.create({
          SeasonId: season.id,
          SeasonTeamId: team.id,
          DriverId: oldDriver.id,
          roleType: 'regular',
          fromRound: 1,
          toRound: null,
          carryReservePoints: false
        }, { transaction });
      }
      if (effectiveRound <= Number(oldStint.fromRound)) {
        throw new Error(`Der bisherige Stint beginnt erst in Runde ${oldStint.fromRound}. Bitte eine spätere Wechselrunde wählen.`);
      }

      const duplicateRegular = await SeasonDriverStint.findOne({
        where: {
          SeasonId: season.id,
          DriverId: newDriver.id,
          roleType: 'regular',
          toRound: null
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (duplicateRegular) throw new Error('Der neue Fahrer besitzt bereits einen aktiven Stammfahrer-Stint.');

      const reserveStint = await SeasonDriverStint.findOne({
        where: {
          SeasonId: season.id,
          DriverId: newDriver.id,
          roleType: 'reserve',
          toRound: null
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (reserveStint && !reserveStint.SeasonTeamId && inferredSameTeamReserve) {
        await reserveStint.update({ SeasonTeamId: team.id }, { transaction });
      }
      const sameTeamPromotion = canCarryReservePoints(reserveStint, team.id);
      if (carryRequested && !sameTeamPromotion) {
        throw new Error('Ersatzfahrer-Punkte können nur bei einer Beförderung im selben Saisonteam übernommen werden.');
      }

      validateStintValues({
        roleType: 'regular',
        fromRound: effectiveRound,
        toRound: null,
        endReason: null
      });

      await oldStint.update({
        toRound: effectiveRound - 1,
        endReason: endReason === 'promoted' ? 'replaced' : endReason
      }, { transaction });

      if (reserveStint) {
        if (effectiveRound <= Number(reserveStint.fromRound)) {
          throw new Error(`Der Ersatzfahrer-Stint beginnt erst in Runde ${reserveStint.fromRound}.`);
        }
        await reserveStint.update({
          toRound: effectiveRound - 1,
          endReason: sameTeamPromotion ? 'promoted' : 'team_change'
        }, { transaction });
      }

      await SeasonDriverStint.create({
        SeasonId: season.id,
        SeasonTeamId: team.id,
        DriverId: newDriver.id,
        roleType: 'regular',
        fromRound: effectiveRound,
        toRound: null,
        endReason: null,
        carryReservePoints: carryRequested && sameTeamPromotion,
        previousStintId: reserveStint?.id || null
      }, { transaction });

      const newLineup = await SeasonLineupEntry.findOne({
        where: { SeasonId: season.id, DriverId: newDriver.id },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const lineupSortOrder = oldLineup.sortOrder;
      await oldLineup.destroy({ transaction });
      if (newLineup) {
        await newLineup.update({
          SeasonTeamId: team.id,
          roleType: 'regular',
          sortOrder: lineupSortOrder
        }, { transaction });
      } else {
        await SeasonLineupEntry.create({
          SeasonId: season.id,
          SeasonTeamId: team.id,
          DriverId: newDriver.id,
          roleType: 'regular',
          sortOrder: lineupSortOrder
        }, { transaction });
      }
    });

    req.session.flash = {
      type: 'success',
      message: `${oldDriver.name} wurde ab Runde ${effectiveRound} durch ${newDriver.name} ersetzt. Vergangene Ergebnisse bleiben unverändert.`
    };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }

  return res.redirect(redirectUrl(ids));
};

exports.loadPageData = loadPageData;
