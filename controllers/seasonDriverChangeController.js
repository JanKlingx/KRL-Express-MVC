const { Op } = require('sequelize');
const {
  sequelize, League, Season, SeasonDriver, SeasonTeam, SeasonLineupEntry,
  SeasonDriverStint, Driver, GrandPrixResult
} = require('../models');
const {
  driverCanBecomeRegular, isRoundInStint, normalizeRound,
  regularRoleFields, seedSeasonDriverStints, validateRegularStintSet, validateStintValues
} = require('../services/seasonDriverStints');
const {
  actualTeamIdForSeasonTeam, completedRoundForSeason, futureWeekendPlan,
  reserveWeekendHistory, saveCarryOvers, syncFutureLineups
} = require('../services/seasonDriverChange');

const OPERATIONS = new Set(['replace', 'release', 'fill']);
const REASONS = [
  ['left', 'Fahrer hört auf'], ['promoted', 'Ersatzfahrer wird Stammfahrer'],
  ['replaced', 'Stammfahrer wird ersetzt'], ['team_change', 'Teamwechsel'], ['other', 'Sonstiges']
];
const REASON_VALUES = new Set(REASONS.map(([value]) => value));

function redirectUrl({ LeagueId, SeasonId, SeasonTeamId } = {}) {
  const query = new URLSearchParams();
  if (LeagueId) query.set('league', LeagueId);
  if (SeasonId) query.set('season', SeasonId);
  if (SeasonTeamId) query.set('team', SeasonTeamId);
  return `/admin/season-driver-change${query.size ? `?${query}` : ''}`;
}

function activeRegularsAt(stints, round, teamId = null) {
  return stints.filter((stint) =>
    stint.roleType === 'regular' &&
    (teamId == null || Number(stint.SeasonTeamId) === Number(teamId)) &&
    isRoundInStint(stint, round)
  );
}

async function loadPageData(query = {}) {
  const leagues = await League.findAll({
    where: { type: 'f1', slug: { [Op.in]: ['freitag', 'samstag', 'sonntag'] } },
    order: [['sortOrder', 'ASC'], ['id', 'ASC']]
  });
  const selectedLeague = leagues.find((row) => Number(row.id) === Number(query.league)) || leagues[0] || null;
  const seasons = selectedLeague ? await Season.findAll({
    where: { leagueType: 'f1', scopeSlug: selectedLeague.slug },
    order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']]
  }) : [];
  const selectedSeason = seasons.find((row) => Number(row.id) === Number(query.season)) ||
    seasons.find((row) => row.status === 'active') || seasons[0] || null;

  if (!selectedSeason) {
    return {
      leagues, seasons, selectedLeague, selectedSeason: null, teams: [], lineup: [], memberships: [],
      eligibleMemberships: [], stints: [], rounds: [], completedRound: 0, selectedRound: 1,
      selectedTeamId: null, teamSlots: [], preview: null, previewError: null
    };
  }

  await seedSeasonDriverStints(selectedSeason.id);
  const [teams, lineup, memberships, eligibleDrivers, stints, races, completedRound] = await Promise.all([
    SeasonTeam.findAll({ where: { SeasonId: selectedSeason.id }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] }),
    SeasonLineupEntry.findAll({
      where: { SeasonId: selectedSeason.id }, include: [{ association: 'driver' }],
      order: [['sortOrder', 'ASC'], ['id', 'ASC']]
    }),
    SeasonDriver.findAll({
      where: { SeasonId: selectedSeason.id }, include: [{ association: 'driver' }],
      order: [['sortOrder', 'ASC'], ['id', 'ASC']]
    }),
    Driver.findAll({
      where: { [Op.or]: regularRoleFields(selectedLeague.slug).map((field) => ({ [field]: true })) },
      order: [['name', 'ASC'], ['id', 'ASC']]
    }),
    SeasonDriverStint.findAll({
      where: { SeasonId: selectedSeason.id },
      include: [{ association: 'driver' }, { association: 'seasonTeam' }, { association: 'carryOvers' }],
      order: [['fromRound', 'ASC'], ['id', 'ASC']]
    }),
    GrandPrixResult.findAll({
      where: { SeasonId: selectedSeason.id, discipline: 'f1', raceType: 'main' },
      order: [['sortOrder', 'ASC']]
    }),
    completedRoundForSeason(selectedSeason.id)
  ]);
  const rounds = races.map((race) => ({ round: Number(race.sortOrder), title: race.title, raceDate: race.raceDate }));
  const requestedRound = Number(query.round);
  const selectedRound = Number.isInteger(requestedRound) && requestedRound > Number(completedRound)
    ? requestedRound : Number(completedRound) + 1;
  const teamSlots = teams.map((team) => {
    const regulars = activeRegularsAt(stints, selectedRound, team.id);
    return { team, regulars, freeSeats: Math.max(0, 2 - regulars.length) };
  });
  const membershipByDriver = new Map(memberships.map((membership) => [Number(membership.DriverId), membership]));
  const eligibleMemberships = eligibleDrivers.map((driver) =>
    membershipByDriver.get(Number(driver.id)) || { DriverId: driver.id, driver, isSeasonMember: false }
  );

  let preview = null;
  let previewError = null;
  if (query.check === '1') {
    try {
      const operation = OPERATIONS.has(query.operation) ? query.operation : 'replace';
      const team = teams.find((row) => Number(row.id) === Number(query.team));
      if (!team) throw new Error('Bitte ein Saisonteam auswählen.');
      const oldStint = ['replace', 'release'].includes(operation)
        ? activeRegularsAt(stints, selectedRound, team.id).find((row) => Number(row.DriverId) === Number(query.oldDriver))
        : null;
      if (['replace', 'release'].includes(operation) && !oldStint) {
        throw new Error('Der bisherige Fahrer besitzt in dieser Runde keinen Stammfahrer-Stint für dieses Team.');
      }
      const membership = ['replace', 'fill'].includes(operation)
        ? eligibleMemberships.find((row) => Number(row.DriverId) === Number(query.newDriver)) : null;
      if (['replace', 'fill'].includes(operation) && !membership) {
        throw new Error('Der neue Fahrer besitzt nicht die passende Stamm- oder Ersatzfahrerrolle dieser Liga.');
      }
      const freeSeats = Math.max(0, 2 - activeRegularsAt(stints, selectedRound, team.id).length);
      if (operation === 'fill' && freeSeats < 1) throw new Error('Dieses Team besitzt ab der ausgewählten Runde keinen freien Stammplatz.');
      const carryHistory = membership ? await reserveWeekendHistory({
        seasonId: selectedSeason.id, driverId: membership.DriverId, seasonTeam: team, beforeRound: selectedRound
      }) : [];
      preview = { operation, team, oldStint, membership, effectiveRound: selectedRound, carryHistory };
    } catch (error) { previewError = error.message; }
  }

  return {
    leagues, seasons, selectedLeague, selectedSeason, teams, lineup, memberships,
    eligibleMemberships, stints, rounds, completedRound: Number(completedRound) || 0,
    selectedRound, selectedTeamId: Number(query.team) || null, teamSlots, preview, previewError
  };
}

exports.show = async (req, res) => {
  const data = await loadPageData(req.query);
  res.render('admin/season-driver-change', { title: 'F1-Fahrerwechsel', reasons: REASONS, ...data });
};

exports.save = async (req, res) => {
  const operation = OPERATIONS.has(req.body.operation) ? req.body.operation : 'replace';
  const ids = {
    LeagueId: Number(req.body.LeagueId), SeasonId: Number(req.body.SeasonId),
    SeasonTeamId: Number(req.body.SeasonTeamId), OldDriverId: Number(req.body.OldDriverId) || null,
    NewDriverId: Number(req.body.NewDriverId) || null
  };
  try {
    const effectiveRound = normalizeRound(req.body.effectiveRound, 'Wirksam-ab-Runde');
    const endReason = String(req.body.endReason || (operation === 'release' ? 'left' : 'replaced'));
    const selectedCarryIds = [].concat(req.body.carryResultIds || []).map(Number).filter(Boolean);
    if (!REASON_VALUES.has(endReason)) throw new Error('Der Wechselgrund ist ungültig.');
    if (![ids.LeagueId, ids.SeasonId, ids.SeasonTeamId].every((value) => Number.isInteger(value) && value > 0)) {
      throw new Error('Liga, Saison und Team sind Pflichtfelder.');
    }
    if (['replace', 'release'].includes(operation) && !ids.OldDriverId) throw new Error('Bitte den bisherigen Stammfahrer auswählen.');
    if (['replace', 'fill'].includes(operation) && !ids.NewDriverId) throw new Error('Bitte den neuen Stammfahrer auswählen.');
    if (ids.OldDriverId && ids.OldDriverId === ids.NewDriverId) throw new Error('Alter und neuer Stammfahrer dürfen nicht identisch sein.');

    const [league, season, team, oldDriver, newDriver] = await Promise.all([
      League.findOne({ where: { id: ids.LeagueId, type: 'f1' } }), Season.findByPk(ids.SeasonId),
      SeasonTeam.findByPk(ids.SeasonTeamId), ids.OldDriverId ? Driver.findByPk(ids.OldDriverId) : null,
      ids.NewDriverId ? Driver.findByPk(ids.NewDriverId) : null
    ]);
    if (!league || !season || season.leagueType !== 'f1' || season.scopeSlug !== league.slug) throw new Error('Saison und Liga passen nicht zusammen.');
    if (!team || Number(team.SeasonId) !== Number(season.id)) throw new Error('Das ausgewählte Team gehört nicht zu dieser Saison.');
    if (ids.OldDriverId && !oldDriver) throw new Error('Der bisherige Fahrer wurde nicht gefunden.');
    if (ids.NewDriverId && (!newDriver || !driverCanBecomeRegular(newDriver, league.slug))) {
      throw new Error('Der neue Fahrer besitzt nicht die passende Stamm- oder Ersatzfahrerrolle dieser Liga.');
    }

    await sequelize.transaction(async (transaction) => {
      const [completedRound, stints, raceCount] = await Promise.all([
        completedRoundForSeason(season.id, transaction),
        SeasonDriverStint.findAll({
          where: { SeasonId: season.id }, transaction, lock: transaction.LOCK.UPDATE,
          order: [['fromRound', 'ASC'], ['id', 'ASC']]
        }),
        GrandPrixResult.count({
          where: { SeasonId: season.id, discipline: 'f1', raceType: 'main', sortOrder: effectiveRound }, transaction
        })
      ]);
      if (effectiveRound <= completedRound) throw new Error(`R${effectiveRound} wurde bereits gefahren. Der Wechsel ist frühestens ab R${completedRound + 1} möglich.`);
      if (!raceCount) throw new Error(`R${effectiveRound} existiert nicht im Rennkalender dieser Saison.`);
      if (ids.NewDriverId) {
        const membershipCount = await SeasonDriver.count({ where: { SeasonId: season.id }, transaction });
        await SeasonDriver.findOrCreate({
          where: { SeasonId: season.id, DriverId: ids.NewDriverId },
          defaults: { SeasonId: season.id, DriverId: ids.NewDriverId, sortOrder: membershipCount },
          transaction
        });
      }

      const teamRegulars = activeRegularsAt(stints, effectiveRound, team.id);
      const oldStint = ids.OldDriverId
        ? teamRegulars.find((stint) => Number(stint.DriverId) === Number(ids.OldDriverId)) : null;
      if (['replace', 'release'].includes(operation) && !oldStint) throw new Error('Der bisherige Fahrer ist ab dieser Runde kein Stammfahrer dieses Teams.');
      if (operation === 'fill' && teamRegulars.length >= 2) throw new Error('Das Zielteam besitzt ab dieser Runde keinen freien Stammplatz.');
      const overlappingNewRegular = ids.NewDriverId && stints.find((stint) =>
        stint.roleType === 'regular' && Number(stint.DriverId) === Number(ids.NewDriverId) &&
        (stint.toRound == null || Number(stint.toRound) >= effectiveRound)
      );
      if (overlappingNewRegular) throw new Error('Der neue Fahrer besitzt ab dieser Runde bereits einen überlappenden Stammfahrer-Stint.');

      const plans = await futureWeekendPlan({ seasonId: season.id, effectiveRound, transaction });
      const conflict = plans.find((plan) => plan.conflict);
      if (conflict) throw new Error(`R${conflict.race.sortOrder} besitzt bereits bestätigte Rennwochenenden-Daten. Der Fahrerwechsel kann erst ab R${Number(conflict.race.sortOrder) + 1} gelten oder das Rennwochenende muss zuerst kontrolliert zurückgesetzt werden.`);

      if (oldStint) {
        if (effectiveRound <= Number(oldStint.fromRound)) throw new Error(`Der bisherige Stint beginnt erst in R${oldStint.fromRound}.`);
        await oldStint.update({ toRound: effectiveRound - 1, endReason: operation === 'release' ? endReason : 'replaced' }, { transaction });
      }

      let newStint = null;
      if (ids.NewDriverId) {
        const reserveStint = stints.find((stint) =>
          stint.roleType === 'reserve' && Number(stint.DriverId) === Number(ids.NewDriverId) && isRoundInStint(stint, effectiveRound)
        ) || null;
        if (reserveStint) {
          if (effectiveRound <= Number(reserveStint.fromRound)) throw new Error(`Der Ersatzfahrer-Stint beginnt erst in R${reserveStint.fromRound}.`);
          await reserveStint.update({
            toRound: effectiveRound - 1,
            endReason: Number(reserveStint.SeasonTeamId) === Number(team.id) ? 'promoted' : 'team_change'
          }, { transaction });
        }
        validateStintValues({ roleType: 'regular', fromRound: effectiveRound, toRound: null, endReason: null });
        newStint = await SeasonDriverStint.create({
          SeasonId: season.id, SeasonTeamId: team.id, DriverId: ids.NewDriverId,
          roleType: 'regular', fromRound: effectiveRound, toRound: null, endReason: null,
          carryReservePoints: false, previousStintId: reserveStint?.id || null
        }, { transaction });
        const carryHistory = await reserveWeekendHistory({
          seasonId: season.id, driverId: ids.NewDriverId, seasonTeam: team,
          beforeRound: effectiveRound, transaction
        });
        const selectedCount = await saveCarryOvers({
          selectedRaceIds: selectedCarryIds, availableHistory: carryHistory,
          values: {
            SeasonId: season.id, DriverId: ids.NewDriverId, SeasonTeamId: team.id,
            SeasonDriverStintId: newStint.id
          }, transaction
        });
        if (selectedCount) await newStint.update({ carryReservePoints: true }, { transaction });
      } else if (selectedCarryIds.length) {
        throw new Error('Carry-over ist nur bei der Besetzung mit einem neuen Fahrer zulässig.');
      }

      const persistedStints = await SeasonDriverStint.findAll({ where: { SeasonId: season.id }, transaction });
      validateRegularStintSet(persistedStints);
      if (ids.OldDriverId) {
        await SeasonLineupEntry.destroy({
          where: { SeasonId: season.id, DriverId: ids.OldDriverId, roleType: 'regular' }, transaction
        });
      }
      if (ids.NewDriverId) {
        const [lineupEntry] = await SeasonLineupEntry.findOrCreate({
          where: { SeasonId: season.id, DriverId: ids.NewDriverId },
          defaults: {
            SeasonId: season.id, DriverId: ids.NewDriverId, SeasonTeamId: team.id,
            roleType: 'regular', sortOrder: 0
          }, transaction
        });
        await lineupEntry.update({ SeasonTeamId: team.id, roleType: 'regular' }, { transaction });
      }

      const actualTeamId = await actualTeamIdForSeasonTeam(team, transaction);
      if (!actualTeamId) throw new Error('Das Saisonteam kann keinem tatsächlichen Konstrukteursteam zugeordnet werden.');
      await syncFutureLineups({
        plans, operation, oldDriverId: ids.OldDriverId, newDriverId: ids.NewDriverId,
        actualTeamId, transaction
      });
    });

    const endingRound = Number(req.body.effectiveRound) - 1;
    const message = operation === 'release'
      ? `${oldDriver.name} endet nach R${endingRound}. Der Stammplatz ist danach frei.`
      : operation === 'fill'
        ? `${newDriver.name} besetzt den freien Stammplatz von ${team.name} ab R${req.body.effectiveRound}.`
        : `${oldDriver.name} endet nach R${endingRound}; ${newDriver.name} übernimmt ${team.name} ab R${req.body.effectiveRound}.`;
    req.session.flash = { type: 'success', message: `${message} Vergangene Ergebnisse und Punkte blieben unverändert.` };
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }
  return res.redirect(redirectUrl(ids));
};

exports.loadPageData = loadPageData;
exports.activeRegularsAt = activeRegularsAt;

