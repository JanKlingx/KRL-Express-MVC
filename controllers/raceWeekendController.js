const { Op } = require('sequelize');
const {
  sequelize,
  League,
  Season,
  RaceEvent,
  GrandPrixResult,
  GrandPrixResultEntry,
  F1RaceLineupEntry,
  PenaltyRule,
  PenaltyEntry,
} = require('../models');
const {
  ATTENDANCE_STATUSES,
  REGULAR_STATUSES,
  RESERVE_STATUSES,
  normalizeAttendanceStatus,
} = require('../services/raceLineup');
const { loadSeasonStructure } = require('../services/f1Season');
const f1RaceLineupController = require('./f1RaceLineupController');

const STARTING_ATTENDANCE = new Set(['anwesend', 'zu_spaet_vorbesprechung']);
const ABSENT_ATTENDANCE = new Set(['unabgemeldet', 'zu_spaet_abgemeldet']);
const ELIGIBLE_RESERVE_STATUS = new Set(['anwesend', 'unsicher', 'auf_abruf']);

const attendanceReason = {
  unabgemeldet: 'Unabgemeldet',
  zu_spaet_abgemeldet: 'Zu spät abgemeldet',
  zu_spaet_vorbesprechung: 'Zu spät Vorbesprechung',
};

const ruleStatus = {
  unabgemeldet: 'unabgemeldet',
  zu_spaet_abgemeldet: 'late-cancellation',
  zu_spaet_vorbesprechung: 'late-briefing',
};

function berlinDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function selectCurrentEvent(events, now = new Date()) {
  const normalEvents = events.filter((event) => !event.isTestDay);
  if (!normalEvents.length) return null;
  const today = berlinDateKey(now);
  const todayEvent = normalEvents.find((event) => berlinDateKey(event.startsAt) === today);
  if (todayEvent) return todayEvent;
  const future = normalEvents
    .filter((event) => new Date(event.startsAt).getTime() > now.getTime())
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
  if (future.length) return future[0];
  return normalEvents
    .slice()
    .sort((left, right) => new Date(right.startsAt) - new Date(left.startsAt))[0];
}

async function syncAutomaticAttendancePenalty({ race, entry, attendanceStatus, ruleByStatus, transaction }) {
  const automaticReason = attendanceReason[attendanceStatus];
  const rule = ruleByStatus.get(ruleStatus[attendanceStatus]);
  const existing = await PenaltyEntry.findOne({
    where: { GrandPrixResultId: race.id, DriverId: entry.DriverId, isAutomatic: true },
    transaction,
  });

  if (automaticReason && rule && Number(rule.points) > 0) {
    const awardedOn = race.raceDate || new Date().toISOString().slice(0, 10);
    const expiry = new Date(`${awardedOn}T12:00:00Z`);
    expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
    const values = {
      LeagueId: race.LeagueId,
      DriverId: entry.DriverId,
      GrandPrixResultId: race.id,
      points: rule.points,
      reason: automaticReason,
      comment: `${race.title} · automatisch aus Anwesenheitskontrolle`,
      awardedOn,
      expiresOn: expiry.toISOString().slice(0, 10),
      isAutomatic: true,
      isRaceBan: false,
    };
    if (existing) await existing.update(values, { transaction });
    else await PenaltyEntry.create(values, { transaction });
    return;
  }

  if (existing) await existing.destroy({ transaction });
}

function displayTeamMap(structure) {
  const result = new Map();
  structure.teams?.forEach((team) => {
    team.drivers.forEach((driver) => result.set(Number(driver.id), team));
  });
  return result;
}

async function loadF1Data(query = {}) {
  const leagues = await League.findAll({
    where: { type: 'f1', slug: { [Op.in]: ['freitag', 'samstag', 'sonntag'] } },
    order: [['sortOrder', 'ASC'], ['id', 'ASC']],
  });
  const league = leagues.find((item) => Number(item.id) === Number(query.league)) || leagues[0] || null;
  const seasons = league
    ? await Season.findAll({
        where: { scopeSlug: league.slug, leagueType: 'f1', status: 'active', isPublished: true },
        order: [['id', 'DESC']],
      })
    : [];
  const season = seasons.find((item) => Number(item.id) === Number(query.season)) || seasons[0] || null;
  const events = season
    ? await RaceEvent.findAll({
        where: { LeagueId: league.id, SeasonId: season.id },
        include: [
          { association: 'grandPrixResult' },
          { association: 'track', required: false, include: [{ association: 'countryRecord', required: false }] },
        ],
        order: [['sortOrder', 'ASC'], ['startsAt', 'ASC']],
      })
    : [];

  const manuallySelected = events.find((item) => Number(item.id) === Number(query.event)) ||
    events.find((item) => Number(item.GrandPrixResultId) === Number(query.race));
  const event = manuallySelected || selectCurrentEvent(events) || events[0] || null;
  const race = event?.grandPrixResult || (event?.GrandPrixResultId ? await GrandPrixResult.findByPk(event.GrandPrixResultId) : null);

  const [entries, structure] = await Promise.all([
    race
      ? F1RaceLineupEntry.findAll({
          where: { GrandPrixResultId: race.id },
          include: [
            { association: 'driver' },
            { association: 'replacementFor' },
            { association: 'team' },
          ],
          order: [['roleType', 'ASC'], ['sortOrder', 'ASC'], ['id', 'ASC']],
        })
      : [],
    season ? loadSeasonStructure(season.id) : { teams: [], unassignedDrivers: [] },
  ]);

  const teamsByDriver = displayTeamMap(structure);
  const regularEntries = entries.filter((entry) => entry.roleType === 'regular');
  const regularById = new Map(regularEntries.map((entry) => [Number(entry.DriverId), entry]));
  const replacementByRegular = new Map(
    entries
      .filter((entry) => entry.roleType === 'reserve' && entry.ReplacementForDriverId)
      .map((entry) => [Number(entry.ReplacementForDriverId), entry]),
  );

  const attendanceRows = regularEntries
    .filter((entry) => entry.status !== 'rennsperre')
    .map((entry) => ({
      entry,
      displayTeam: teamsByDriver.get(Number(entry.DriverId)) || entry.team,
      plannedReplacement: replacementByRegular.get(Number(entry.DriverId)) || null,
    }));

  const excludedAttendanceRows = entries
    .filter((entry) => ABSENT_ATTENDANCE.has(entry.attendanceStatus))
    .map((entry) => ({
      entry,
      displayTeam: teamsByDriver.get(Number(entry.roleType === 'regular' ? entry.DriverId : entry.ReplacementForDriverId)) || entry.team,
      currentReplacement: entries.find(
        (candidate) => candidate.roleType === 'reserve' && Number(candidate.ReplacementForDriverId) === Number(entry.DriverId),
      ) || null,
    }));

  const availableReplacements = entries
    .filter((entry) => {
      if (entry.roleType !== 'reserve' || !ELIGIBLE_RESERVE_STATUS.has(entry.status) || entry.includeInResults) return false;
      if (!entry.ReplacementForDriverId) return true;
      const regular = regularById.get(Number(entry.ReplacementForDriverId));
      return regular?.status === 'unsicher' && regular.uncertainPresent === true;
    })
    .map((entry) => ({
      id: Number(entry.DriverId),
      entryId: Number(entry.id),
      name: entry.driver?.name || `Fahrer ${entry.DriverId}`,
      status: entry.status,
    }))
    .sort((left, right) => {
      const rank = (status) => status === 'auf_abruf' ? 0 : status === 'anwesend' ? 1 : 2;
      return rank(left.status) - rank(right.status) || left.name.localeCompare(right.name, 'de');
    });

  return {
    leagues,
    league,
    seasons,
    season,
    events,
    event,
    race,
    entries,
    attendanceRows,
    excludedAttendanceRows,
    availableReplacements,
    selectionMode: manuallySelected ? 'manual' : 'automatic',
  };
}

exports.show = async (req, res) => {
  if (req.params.discipline !== 'f1') {
    req.session.flash = { type: 'error', message: 'Der Rennwochenenden-Assistent ist aktuell für Formel 1 verfügbar.' };
    return res.redirect('/admin');
  }

  const data = await loadF1Data(req.query);
  const planning = data.league && data.race
    ? await f1RaceLineupController.loadPlanningRows(data.league, data.race)
    : { teamCards: [], reserveRows: [], hasSavedPlan: false };
  const resultCount = data.race
    ? await GrandPrixResultEntry.count({ where: { GrandPrixResultId: data.race.id } })
    : 0;

  return res.render('admin/race-weekend', {
    title: 'Rennwochenende Formel 1',
    requested: 'f1',
    ...data,
    attendanceStatuses: ATTENDANCE_STATUSES,
    regularStatuses: REGULAR_STATUSES,
    reserveStatuses: RESERVE_STATUSES,
    selectedRace: data.race,
    resultCount,
    ...planning,
    resultsHref: `/admin/current-season-progress?league=${data.league?.id || ''}&race=${data.race?.id || ''}`,
  });
};

function formRow(collection, entryId) {
  return collection?.[`d${entryId}`] || collection?.[String(entryId)] || {};
}

function parseUncertainDecision(uncertainInput, entry) {
  const value = formRow(uncertainInput, entry.id).present;
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

exports.saveAttendance = async (req, res) => {
  const race = await GrandPrixResult.findByPk(Number(req.params.raceId), {
    include: [{ association: 'seasonRecord' }, { association: 'league' }],
  });
  if (!race || race.discipline !== 'f1' || race.seasonRecord?.status !== 'active') {
    throw new Error('Aktuelles Formel-1-Rennen wurde nicht gefunden.');
  }

  const entries = await F1RaceLineupEntry.findAll({
    where: { GrandPrixResultId: race.id },
    include: [{ association: 'driver' }],
    order: [['roleType', 'ASC'], ['sortOrder', 'ASC'], ['id', 'ASC']],
  });
  const attendanceInput = req.body.attendance || {};
  const correctionInput = req.body.correction || {};
  const uncertainInput = req.body.uncertain || {};
  const rules = await PenaltyRule.findAll({ where: { discipline: 'f1' } });
  const ruleByStatus = new Map(rules.map((rule) => [rule.status, rule]));

  try {
    await sequelize.transaction(async (transaction) => {
      if (Object.keys(correctionInput).length) {
        for (const entry of entries) {
          const correction = formRow(correctionInput, entry.id);
          if (!correction.status) continue;
          const status = normalizeAttendanceStatus(correction.status);
          if (![...STARTING_ATTENDANCE, ...ABSENT_ATTENDANCE].includes(status)) {
            throw new Error('Ungültiger Korrekturstatus.');
          }
          await entry.update({ attendanceStatus: status, includeInResults: STARTING_ATTENDANCE.has(status) }, { transaction });
          if (STARTING_ATTENDANCE.has(status)) {
            const replacements = entries.filter(
              (candidate) => candidate.roleType === 'reserve' && Number(candidate.ReplacementForDriverId) === Number(entry.DriverId),
            );
            for (const replacement of replacements) {
              await replacement.update({
                ReplacementForDriverId: null,
                TeamId: null,
                attendanceStatus: null,
                includeInResults: false,
                uncertainPresent: null,
                respondedInTime: null,
              }, { transaction });
            }
          }
          await syncAutomaticAttendancePenalty({ race, entry, attendanceStatus: status, ruleByStatus, transaction });
        }
        return;
      }

      const regularEntries = entries.filter((entry) => entry.roleType === 'regular');
      const reserveEntries = entries.filter((entry) => entry.roleType === 'reserve');
      const reserveByDriver = new Map(reserveEntries.map((entry) => [Number(entry.DriverId), entry]));
      const plannedByRegular = new Map(
        reserveEntries.filter((entry) => entry.ReplacementForDriverId)
          .map((entry) => [Number(entry.ReplacementForDriverId), entry]),
      );
      const regularDecision = new Map();
      const releasedReserveIds = new Set();

      for (const regular of regularEntries.filter((entry) => entry.status === 'unsicher')) {
        const decision = parseUncertainDecision(uncertainInput, regular);
        if (decision === null) throw new Error(`${regular.driver?.name || 'Ein Stammfahrer'}: Bitte „Ist der Fahrer da?“ mit Ja oder Nein beantworten.`);
        regularDecision.set(Number(regular.id), decision);
        const planned = plannedByRegular.get(Number(regular.DriverId));
        if (decision && planned) {
          if (planned.includeInResults && STARTING_ATTENDANCE.has(planned.attendanceStatus)) {
            throw new Error(`${planned.driver?.name || 'Der Ersatzfahrer'} ist bereits als Starter bestätigt. Bitte zuerst eine ausdrückliche Anwesenheitskorrektur durchführen.`);
          }
          releasedReserveIds.add(Number(planned.DriverId));
        }
      }

      const usedReserveIds = new Set();
      const finalReserveDrivers = new Set();
      let followUpRequired = false;

      async function storeAttendance(entry, status) {
        const normalized = normalizeAttendanceStatus(status);
        if (![...STARTING_ATTENDANCE, ...ABSENT_ATTENDANCE].includes(normalized)) {
          throw new Error(`${entry.driver?.name || 'Fahrer'}: Ungültiger Anwesenheitsstatus.`);
        }
        await entry.update({ attendanceStatus: normalized, includeInResults: STARTING_ATTENDANCE.has(normalized) }, { transaction });
        await syncAutomaticAttendancePenalty({ race, entry, attendanceStatus: normalized, ruleByStatus, transaction });
        return normalized;
      }

      function requestedReplacement(entry) {
        return Number(formRow(attendanceInput, entry.id).ReplacementDriverId || 0) || null;
      }

      function ensureReserveAvailable(reserve, rootRegular) {
        if (!reserve || reserve.roleType !== 'reserve' || !ELIGIBLE_RESERVE_STATUS.has(reserve.status)) {
          throw new Error('Der gewählte Ersatzfahrer ist nicht verfügbar.');
        }
        if (usedReserveIds.has(Number(reserve.DriverId))) {
          throw new Error(`${reserve.driver?.name || 'Der Ersatzfahrer'} ist in diesem Rennwochenende bereits eingesetzt.`);
        }
        const currentTarget = Number(reserve.ReplacementForDriverId || 0);
        if (reserve.includeInResults && currentTarget && currentTarget !== Number(rootRegular.DriverId)) {
          throw new Error(`${reserve.driver?.name || 'Der Ersatzfahrer'} ist bereits als Starter für ein anderes Cockpit bestätigt.`);
        }
        if (currentTarget && currentTarget !== Number(rootRegular.DriverId) && !releasedReserveIds.has(Number(reserve.DriverId))) {
          throw new Error(`${reserve.driver?.name || 'Der Ersatzfahrer'} ist für einen anderen unsicheren Fahrer reserviert.`);
        }
      }

      async function resolveReserve(startReserve, rootRegular, freshlySelected = false) {
        let reserve = startReserve;
        let isFresh = freshlySelected;
        const chain = new Set();

        while (reserve) {
          ensureReserveAvailable(reserve, rootRegular);
          if (chain.has(Number(reserve.DriverId))) throw new Error('Die Ersatzfahrerkette enthält eine ungültige Schleife.');
          chain.add(Number(reserve.DriverId));
          usedReserveIds.add(Number(reserve.DriverId));
          finalReserveDrivers.add(Number(reserve.DriverId));

          await reserve.update({
            ReplacementForDriverId: rootRegular.DriverId,
            TeamId: rootRegular.TeamId,
            ...(reserve.status === 'auf_abruf' ? { status: 'anwesend' } : {}),
          }, { transaction });

          if (reserve.status === 'unsicher') {
            const present = parseUncertainDecision(uncertainInput, reserve);
            if (present === null) {
              if (!isFresh) throw new Error(`${reserve.driver?.name || 'Der Ersatzfahrer'} ist unsicher und muss vor der Ergebnisübernahme geprüft werden.`);
              await reserve.update({ attendanceStatus: null, includeInResults: false }, { transaction });
              followUpRequired = true;
              return null;
            }
            await reserve.update({
              uncertainPresent: present,
              respondedInTime: formRow(uncertainInput, reserve.id).respondedInTime === 'on',
            }, { transaction });
            if (!present) {
              await storeAttendance(reserve, formRow(attendanceInput, reserve.id).status || 'unabgemeldet');
              await reserve.update({ includeInResults: false }, { transaction });
              const nextId = requestedReplacement(reserve);
              if (!nextId) return null;
              finalReserveDrivers.delete(Number(reserve.DriverId));
              await reserve.update({ ReplacementForDriverId: null, TeamId: null }, { transaction });
              reserve = reserveByDriver.get(nextId);
              isFresh = true;
              continue;
            }
          }

          const status = await storeAttendance(reserve, formRow(attendanceInput, reserve.id).status || 'anwesend');
          if (STARTING_ATTENDANCE.has(status)) return reserve;

          const nextId = requestedReplacement(reserve);
          if (!nextId) return null;
          finalReserveDrivers.delete(Number(reserve.DriverId));
          await reserve.update({ ReplacementForDriverId: null, TeamId: null }, { transaction });
          reserve = reserveByDriver.get(nextId);
          isFresh = true;
        }
        return null;
      }

      for (const regular of regularEntries) {
        const planned = plannedByRegular.get(Number(regular.DriverId)) || null;
        if (regular.status === 'rennsperre') {
          await regular.update({ attendanceStatus: null, includeInResults: false }, { transaction });
          continue;
        }

        let regularTakesSeat = regular.status === 'anwesend';
        if (regular.status === 'unsicher') {
          regularTakesSeat = regularDecision.get(Number(regular.id));
          await regular.update({
            uncertainPresent: regularTakesSeat,
            respondedInTime: formRow(uncertainInput, regular.id).respondedInTime === 'on',
          }, { transaction });
        }

        if (regularTakesSeat) {
          const status = await storeAttendance(regular, formRow(attendanceInput, regular.id).status || 'anwesend');
          if (STARTING_ATTENDANCE.has(status)) {
            if (planned && !planned.includeInResults) releasedReserveIds.add(Number(planned.DriverId));
            continue;
          }
          const spontaneousId = requestedReplacement(regular);
          if (spontaneousId) await resolveReserve(reserveByDriver.get(spontaneousId), regular, true);
          continue;
        }

        await regular.update({
          includeInResults: false,
          ...(regular.status === 'abgemeldet' ? { attendanceStatus: null } : {}),
        }, { transaction });
        if (regular.status === 'unsicher') {
          const absentStatus = formRow(attendanceInput, regular.id).status || 'unabgemeldet';
          if (!ABSENT_ATTENDANCE.has(absentStatus)) {
            throw new Error(`${regular.driver?.name || 'Stammfahrer'}: Bei „Nein“ muss „Nicht erschienen“ oder „Zu spät abgemeldet“ gewählt werden.`);
          }
          await storeAttendance(regular, absentStatus);
        }

        if (planned) {
          await resolveReserve(planned, regular, false);
        } else {
          const spontaneousId = requestedReplacement(regular);
          if (spontaneousId) await resolveReserve(reserveByDriver.get(spontaneousId), regular, true);
        }
      }

      for (const reserve of reserveEntries) {
        if (!releasedReserveIds.has(Number(reserve.DriverId)) || finalReserveDrivers.has(Number(reserve.DriverId))) continue;
        if (reserve.includeInResults && STARTING_ATTENDANCE.has(reserve.attendanceStatus)) {
          throw new Error(`${reserve.driver?.name || 'Ein Ersatzfahrer'} ist bereits bestätigt und kann nicht stillschweigend freigegeben werden.`);
        }
        await reserve.update({
          ReplacementForDriverId: null,
          TeamId: null,
          attendanceStatus: null,
          includeInResults: false,
          uncertainPresent: null,
          respondedInTime: null,
        }, { transaction });
      }

      if (followUpRequired) {
        req.session.flash = {
          type: 'warning',
          message: 'Ein neu gewählter Ersatzfahrer ist unsicher. Bitte seine Ja/Nein-Prüfung jetzt abschließen.',
        };
      }
    });

    if (!req.session.flash) {
      req.session.flash = {
        type: 'success',
        message: Object.keys(correctionInput).length
          ? 'Anwesenheitskorrekturen wurden gespeichert.'
          : 'Anwesenheitskontrolle gespeichert. Nur bestätigte Starter werden in Schritt 3 übernommen.',
      };
    }
  } catch (error) {
    req.session.flash = { type: 'error', message: error.message };
  }

  return res.redirect(`/admin/race-weekend/f1?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}#anwesenheit`);
};

module.exports.loadF1Data = loadF1Data;
module.exports.selectCurrentEvent = selectCurrentEvent;
