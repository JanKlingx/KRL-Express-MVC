const { Op } = require("sequelize");
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
} = require("../models");
const {
  ATTENDANCE_STATUSES,
  REGULAR_STATUSES,
  RESERVE_STATUSES,
  normalizeAttendanceStatus,
} = require("../services/raceLineup");
const { loadSeasonStructure } = require("../services/f1Season");
const f1RaceLineupController = require("./f1RaceLineupController");

const STARTING_ATTENDANCE = new Set(["anwesend", "zu_spaet_vorbesprechung"]);
const ABSENT_ATTENDANCE = new Set([
  "abgemeldet",
  "unabgemeldet",
  "zu_spaet_abgemeldet",

  /*
   * Systemstatus aus der Auflösung
   * eines Unsicher-Falls.
   */
  "rueckmeldung_unsicher",
  "fehlende_rueckmeldung_unsicher",
]);
const ELIGIBLE_RESERVE_STATUS = new Set(["anwesend", "unsicher", "auf_abruf"]);

const attendanceReason = {
  unabgemeldet: "Unabgemeldet",
  zu_spaet_abgemeldet: "Zu spät abgemeldet",
  zu_spaet_vorbesprechung: "Zu spät Vorbesprechung",
};

const ruleStatus = {
  unabgemeldet: "unabgemeldet",
  zu_spaet_abgemeldet: "late-cancellation",
  zu_spaet_vorbesprechung: "late-briefing",
};

function berlinDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function selectCurrentEvent(events, now = new Date()) {
  const normalEvents = events.filter((event) => !event.isTestDay);
  if (!normalEvents.length) return null;
  const today = berlinDateKey(now);
  const todayEvent = normalEvents.find(
    (event) => berlinDateKey(event.startsAt) === today,
  );
  if (todayEvent) return todayEvent;
  const future = normalEvents
    .filter((event) => new Date(event.startsAt).getTime() > now.getTime())
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
  if (future.length) return future[0];
  return normalEvents
    .slice()
    .sort(
      (left, right) => new Date(right.startsAt) - new Date(left.startsAt),
    )[0];
}

async function syncAutomaticAttendancePenalty({
  race,
  entry,
  attendanceStatus,
  ruleByStatus,
  transaction,
}) {
  const automaticReason = attendanceReason[attendanceStatus];
  const rule = ruleByStatus.get(ruleStatus[attendanceStatus]);
  const existing = await PenaltyEntry.findOne({
    where: {
      GrandPrixResultId: race.id,
      DriverId: entry.DriverId,
      isAutomatic: true,
    },
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
    where: { type: "f1", slug: { [Op.in]: ["freitag", "samstag", "sonntag"] } },
    order: [
      ["sortOrder", "ASC"],
      ["id", "ASC"],
    ],
  });
  const league =
    leagues.find((item) => Number(item.id) === Number(query.league)) ||
    leagues[0] ||
    null;
  const seasons = league
    ? await Season.findAll({
        where: {
          scopeSlug: league.slug,
          leagueType: "f1",
          status: "active",
          isPublished: true,
        },
        order: [["id", "DESC"]],
      })
    : [];
  const season =
    seasons.find((item) => Number(item.id) === Number(query.season)) ||
    seasons[0] ||
    null;
  const events = season
    ? await RaceEvent.findAll({
        where: { LeagueId: league.id, SeasonId: season.id },
        include: [
          { association: "grandPrixResult" },
          {
            association: "track",
            required: false,
            include: [{ association: "countryRecord", required: false }],
          },
        ],
        order: [
          ["sortOrder", "ASC"],
          ["startsAt", "ASC"],
        ],
      })
    : [];

  const manuallySelected =
    events.find((item) => Number(item.id) === Number(query.event)) ||
    events.find(
      (item) => Number(item.GrandPrixResultId) === Number(query.race),
    );
  const event =
    manuallySelected || selectCurrentEvent(events) || events[0] || null;
  const race =
    event?.grandPrixResult ||
    (event?.GrandPrixResultId
      ? await GrandPrixResult.findByPk(event.GrandPrixResultId)
      : null);

  const [entries, structure] = await Promise.all([
    race
      ? F1RaceLineupEntry.findAll({
          where: { GrandPrixResultId: race.id },
          include: [
            { association: "driver" },
            { association: "replacementFor" },
            { association: "team" },
          ],
          order: [
            ["roleType", "ASC"],
            ["sortOrder", "ASC"],
            ["id", "ASC"],
          ],
        })
      : [],
    season
      ? loadSeasonStructure(season.id)
      : { teams: [], unassignedDrivers: [] },
  ]);

  const teamsByDriver = displayTeamMap(structure);
  const regularEntries = entries.filter(
    (entry) => entry.roleType === "regular",
  );
  const regularById = new Map(
    regularEntries.map((entry) => [Number(entry.DriverId), entry]),
  );
  const replacementByRegular = new Map(
    entries
      .filter(
        (entry) => entry.roleType === "reserve" && entry.ReplacementForDriverId,
      )
      .map((entry) => [Number(entry.ReplacementForDriverId), entry]),
  );

  const attendanceRows = regularEntries
    .filter((entry) => entry.status !== "rennsperre")
    .map((entry) => ({
      entry,
      displayTeam: teamsByDriver.get(Number(entry.DriverId)) || entry.team,
      plannedReplacement:
        replacementByRegular.get(Number(entry.DriverId)) || null,
    }));

  const excludedAttendanceRows = entries
    .filter((entry) => ABSENT_ATTENDANCE.has(entry.attendanceStatus))
    .map((entry) => ({
      entry,
      displayTeam:
        teamsByDriver.get(
          Number(
            entry.roleType === "regular"
              ? entry.DriverId
              : entry.ReplacementForDriverId,
          ),
        ) || entry.team,
      currentReplacement:
        entries.find(
          (candidate) =>
            candidate.roleType === "reserve" &&
            Number(candidate.ReplacementForDriverId) === Number(entry.DriverId),
        ) || null,
    }));

  const availableReplacements = entries
    .filter((entry) => {
      if (
        entry.roleType !== "reserve" ||
        !ELIGIBLE_RESERVE_STATUS.has(entry.status) ||
        entry.includeInResults
      )
        return false;
      if (!entry.ReplacementForDriverId) return true;
      const regular = regularById.get(Number(entry.ReplacementForDriverId));
      return (
        regular?.status === "unsicher" && regular.uncertainPresent === true
      );
    })
    .map((entry) => ({
      id: Number(entry.DriverId),
      entryId: Number(entry.id),
      name: entry.driver?.name || `Fahrer ${entry.DriverId}`,
      status: entry.status,
    }))
    .sort((left, right) => {
      const rank = (status) =>
        status === "auf_abruf" ? 0 : status === "anwesend" ? 1 : 2;
      return (
        rank(left.status) - rank(right.status) ||
        left.name.localeCompare(right.name, "de")
      );
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
    selectionMode: manuallySelected ? "manual" : "automatic",
  };
}

exports.show = async (req, res) => {
  if (req.params.discipline !== "f1") {
    req.session.flash = {
      type: "error",
      message:
        "Der Rennwochenenden-Assistent ist aktuell für Formel 1 verfügbar.",
    };
    return res.redirect("/admin");
  }

  const data = await loadF1Data(req.query);
  const planning =
    data.league && data.race
      ? await f1RaceLineupController.loadPlanningRows(data.league, data.race)
      : { teamCards: [], reserveRows: [], hasSavedPlan: false };
  const resultCount = data.race
    ? await GrandPrixResultEntry.count({
        where: { GrandPrixResultId: data.race.id },
      })
    : 0;

  return res.render("admin/race-weekend", {
    title: "Rennwochenende Formel 1",
    requested: "f1",
    ...data,
    attendanceStatuses: ATTENDANCE_STATUSES,
    regularStatuses: REGULAR_STATUSES,
    reserveStatuses: RESERVE_STATUSES,
    selectedRace: data.race,
    resultCount,
    ...planning,
    resultsHref: `/admin/current-season-progress?league=${data.league?.id || ""}&race=${data.race?.id || ""}`,
  });
};

function formRow(collection, entryId) {
  return collection?.[`d${entryId}`] || collection?.[String(entryId)] || {};
}

function parseUncertainDecision(uncertainInput, entry) {
  const value = formRow(uncertainInput, entry.id).present;
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function parseRespondedInTime(uncertainInput, entry) {
  const value = formRow(uncertainInput, entry.id).respondedInTime;
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function absenceStatusFromResponse(
  respondedInTime
) {
  /*
   * Diese Funktion wird ausschließlich
   * bei der Auflösung eines UNSICHER-Falls
   * verwendet.
   *
   * Deshalb hier ausdrücklich NICHT
   * "abgemeldet" oder "unabgemeldet".
   */

  return respondedInTime
    ? "rueckmeldung_unsicher"
    : "fehlende_rueckmeldung_unsicher";
}

exports.saveAttendance = async (req, res) => {
  const race = await GrandPrixResult.findByPk(Number(req.params.raceId), {
    include: [{ association: "seasonRecord" }, { association: "league" }],
  });

  if (
    !race ||
    race.discipline !== "f1" ||
    race.seasonRecord?.status !== "active"
  ) {
    throw new Error("Aktuelles Formel-1-Rennen wurde nicht gefunden.");
  }

  const entries = await F1RaceLineupEntry.findAll({
    where: { GrandPrixResultId: race.id },
    include: [{ association: "driver" }],
    order: [
      ["roleType", "ASC"],
      ["sortOrder", "ASC"],
      ["id", "ASC"],
    ],
  });

  const attendanceInput = req.body.attendance || {};
  const correctionInput = req.body.correction || {};
  const uncertainInput = req.body.uncertain || {};
  const rules = await PenaltyRule.findAll({ where: { discipline: "f1" } });
  const ruleByStatus = new Map(rules.map((rule) => [rule.status, rule]));

  try {
    await sequelize.transaction(async (transaction) => {
      if (Object.keys(correctionInput).length) {
        for (const entry of entries) {
          const correction = formRow(correctionInput, entry.id);
          if (!correction.status) continue;

          const status =
            correction.status === "abgemeldet"
              ? "abgemeldet"
              : normalizeAttendanceStatus(correction.status);

          if (
            ![...STARTING_ATTENDANCE, ...ABSENT_ATTENDANCE].includes(status)
          ) {
            throw new Error("Ungültiger Korrekturstatus.");
          }

          await entry.update(
            {
              attendanceStatus: status,
              includeInResults: STARTING_ATTENDANCE.has(status),
            },
            { transaction },
          );

          if (STARTING_ATTENDANCE.has(status)) {
            const replacements = entries.filter(
              (candidate) =>
                candidate.roleType === "reserve" &&
                Number(candidate.ReplacementForDriverId) ===
                  Number(entry.DriverId),
            );

            for (const replacement of replacements) {
              await replacement.update(
                {
                  ReplacementForDriverId: null,
                  TeamId: null,
                  attendanceStatus: null,
                  includeInResults: false,
                  uncertainPresent: null,
                  respondedInTime: null,
                },
                { transaction },
              );
            }
          }

          await syncAutomaticAttendancePenalty({
            race,
            entry,
            attendanceStatus: status,
            ruleByStatus,
            transaction,
          });
        }

        return;
      }

      const regularEntries = entries.filter(
        (entry) => entry.roleType === "regular",
      );
      const reserveEntries = entries.filter(
        (entry) => entry.roleType === "reserve",
      );
      const reserveByDriver = new Map(
        reserveEntries.map((entry) => [Number(entry.DriverId), entry]),
      );
      const plannedByRegular = new Map(
        reserveEntries
          .filter((entry) => entry.ReplacementForDriverId)
          .map((entry) => [Number(entry.ReplacementForDriverId), entry]),
      );

      const regularDecision = new Map();
      const regularResponse = new Map();
      const releasedReserveIds = new Set();

      for (const regular of regularEntries.filter(
        (entry) => entry.status === "unsicher",
      )) {
        const present = parseUncertainDecision(uncertainInput, regular);
        const respondedInTime = parseRespondedInTime(uncertainInput, regular);

        if (present === null) {
          throw new Error(
            `${regular.driver?.name || "Ein Stammfahrer"}: Bitte „Ist der Fahrer da?“ mit Ja oder Nein beantworten.`,
          );
        }

        if (respondedInTime === null) {
          throw new Error(
            `${regular.driver?.name || "Ein Stammfahrer"}: Bitte „Rechtzeitig zurückgemeldet?“ mit Ja oder Nein beantworten.`,
          );
        }

        regularDecision.set(Number(regular.id), present);
        regularResponse.set(Number(regular.id), respondedInTime);

        const planned = plannedByRegular.get(Number(regular.DriverId));

        if (present && planned) {
          if (
            planned.includeInResults &&
            STARTING_ATTENDANCE.has(planned.attendanceStatus)
          ) {
            throw new Error(
              `${planned.driver?.name || "Der Ersatzfahrer"} ist bereits als Starter bestätigt. Bitte zuerst eine ausdrückliche Anwesenheitskorrektur durchführen.`,
            );
          }

          releasedReserveIds.add(Number(planned.DriverId));
        }
      }

      const usedReserveIds = new Set();
      const finalReserveDrivers = new Set();
      let followUpRequired = false;

      async function storeAttendance(entry, status) {
        const normalized =
          status === "abgemeldet"
            ? "abgemeldet"
            : normalizeAttendanceStatus(status);

        if (
          ![...STARTING_ATTENDANCE, ...ABSENT_ATTENDANCE].includes(normalized)
        ) {
          throw new Error(
            `${entry.driver?.name || "Fahrer"}: Ungültiger Anwesenheitsstatus.`,
          );
        }

        await entry.update(
          {
            attendanceStatus: normalized,
            includeInResults: STARTING_ATTENDANCE.has(normalized),
          },
          { transaction },
        );

        await syncAutomaticAttendancePenalty({
          race,
          entry,
          attendanceStatus: normalized,
          ruleByStatus,
          transaction,
        });

        return normalized;
      }

      function requestedReplacement(entry) {
        return (
          Number(formRow(attendanceInput, entry.id).ReplacementDriverId || 0) ||
          null
        );
      }

      function ensureReserveAvailable(reserve, rootRegular) {
        if (
          !reserve ||
          reserve.roleType !== "reserve" ||
          !ELIGIBLE_RESERVE_STATUS.has(reserve.status)
        ) {
          throw new Error("Der gewählte Ersatzfahrer ist nicht verfügbar.");
        }

        if (usedReserveIds.has(Number(reserve.DriverId))) {
          throw new Error(
            `${reserve.driver?.name || "Der Ersatzfahrer"} ist in diesem Rennwochenende bereits eingesetzt.`,
          );
        }

        const currentTarget = Number(reserve.ReplacementForDriverId || 0);

        if (
          reserve.includeInResults &&
          currentTarget &&
          currentTarget !== Number(rootRegular.DriverId)
        ) {
          throw new Error(
            `${reserve.driver?.name || "Der Ersatzfahrer"} ist bereits als Starter für ein anderes Cockpit bestätigt.`,
          );
        }

        if (
          currentTarget &&
          currentTarget !== Number(rootRegular.DriverId) &&
          !releasedReserveIds.has(Number(reserve.DriverId))
        ) {
          throw new Error(
            `${reserve.driver?.name || "Der Ersatzfahrer"} ist für einen anderen unsicheren Fahrer reserviert.`,
          );
        }
      }

      async function resolveReserve(
        startReserve,
        rootRegular,
        freshlySelected = false,
      ) {
        let reserve = startReserve;
        let isFresh = freshlySelected;
        const chain = new Set();

        while (reserve) {
          ensureReserveAvailable(reserve, rootRegular);

          if (chain.has(Number(reserve.DriverId))) {
            throw new Error(
              "Die Ersatzfahrerkette enthält eine ungültige Schleife.",
            );
          }

          chain.add(Number(reserve.DriverId));
          usedReserveIds.add(Number(reserve.DriverId));
          finalReserveDrivers.add(Number(reserve.DriverId));

          await reserve.update(
            {
              ReplacementForDriverId: rootRegular.DriverId,
              TeamId: rootRegular.TeamId,
              ...(reserve.status === "auf_abruf" ? { status: "anwesend" } : {}),
            },
            { transaction },
          );

          if (reserve.status === "unsicher") {
            const present = parseUncertainDecision(uncertainInput, reserve);
            const respondedInTime = parseRespondedInTime(
              uncertainInput,
              reserve,
            );

            if (present === null || respondedInTime === null) {
              if (!isFresh) {
                const missing =
                  present === null
                    ? "„Ist der Fahrer da?“"
                    : "„Rechtzeitig zurückgemeldet?“";

                throw new Error(
                  `${reserve.driver?.name || "Der Ersatzfahrer"}: Bitte ${missing} beantworten.`,
                );
              }

              await reserve.update(
                {
                  attendanceStatus: null,
                  includeInResults: false,
                },
                { transaction },
              );

              followUpRequired = true;
              return null;
            }

            await reserve.update(
              {
                uncertainPresent: present,
                respondedInTime,
              },
              { transaction },
            );

            if (!present) {
              const absentStatus = absenceStatusFromResponse(respondedInTime);

              await storeAttendance(reserve, absentStatus);
              await reserve.update(
                { includeInResults: false },
                { transaction },
              );

              const nextId = requestedReplacement(reserve);

              if (!nextId) return null;

              finalReserveDrivers.delete(Number(reserve.DriverId));

              await reserve.update(
                {
                  ReplacementForDriverId: null,
                  TeamId: null,
                },
                { transaction },
              );

              reserve = reserveByDriver.get(nextId);
              isFresh = true;
              continue;
            }
          }

          const submittedStatus =
            formRow(attendanceInput, reserve.id).status || "anwesend";

          if (!STARTING_ATTENDANCE.has(submittedStatus)) {
            throw new Error(
              `${reserve.driver?.name || "Ersatzfahrer"}: Wenn der Fahrer da ist, ist nur „Anwesend“ oder „Zu spät Vorbesprechung“ zulässig.`,
            );
          }

          const status = await storeAttendance(reserve, submittedStatus);

          if (STARTING_ATTENDANCE.has(status)) return reserve;
        }

        return null;
      }

      for (const regular of regularEntries) {
        const planned = plannedByRegular.get(Number(regular.DriverId)) || null;

        if (regular.status === "rennsperre") {
          await regular.update(
            {
              attendanceStatus: null,
              includeInResults: false,
            },
            { transaction },
          );
          continue;
        }

        if (regular.status === "abgemeldet") {
          await regular.update(
            {
              attendanceStatus: "abgemeldet",
              includeInResults: false,
              uncertainPresent: false,
            },
            { transaction },
          );

          await syncAutomaticAttendancePenalty({
            race,
            entry: regular,
            attendanceStatus: "abgemeldet",
            ruleByStatus,
            transaction,
          });

          if (planned) {
            await resolveReserve(planned, regular, false);
          } else {
            const spontaneousId = requestedReplacement(regular);

            if (spontaneousId) {
              await resolveReserve(
                reserveByDriver.get(spontaneousId),
                regular,
                true,
              );
            }
          }

          continue;
        }

        if (regular.status === "anwesend") {
          const submittedStatus =
            formRow(attendanceInput, regular.id).status || "anwesend";

          if (
            !STARTING_ATTENDANCE.has(submittedStatus) &&
            !ABSENT_ATTENDANCE.has(submittedStatus)
          ) {
            throw new Error(
              `${regular.driver?.name || "Stammfahrer"}: Ungültiger Anwesenheitsstatus.`,
            );
          }

          const storedStatus = await storeAttendance(regular, submittedStatus);

          /*
           * Fahrer ist kurzfristig doch nicht da:
           * freien Ersatz aus Schritt 2 einsetzen.
           */
          if (ABSENT_ATTENDANCE.has(storedStatus)) {
            const spontaneousId = requestedReplacement(regular);

            if (spontaneousId) {
              await resolveReserve(
                reserveByDriver.get(spontaneousId),
                regular,
                true,
              );
            }
          }

          continue;
        }

        const regularTakesSeat = regularDecision.get(Number(regular.id));
        const respondedInTime = regularResponse.get(Number(regular.id));

        await regular.update(
          {
            uncertainPresent: regularTakesSeat,
            respondedInTime,
          },
          { transaction },
        );

        if (regularTakesSeat) {
          const submittedStatus =
            formRow(attendanceInput, regular.id).status || "anwesend";

          if (!STARTING_ATTENDANCE.has(submittedStatus)) {
            throw new Error(
              `${regular.driver?.name || "Stammfahrer"}: Wenn der Fahrer da ist, ist nur „Anwesend“ oder „Zu spät Vorbesprechung“ zulässig.`,
            );
          }

          await storeAttendance(regular, submittedStatus);

          if (planned && !planned.includeInResults) {
            releasedReserveIds.add(Number(planned.DriverId));
          }

          continue;
        }

        const absentStatus = absenceStatusFromResponse(respondedInTime);

        await storeAttendance(regular, absentStatus);

        await regular.update({ includeInResults: false }, { transaction });

        if (planned) {
          await resolveReserve(planned, regular, false);
        } else {
          const spontaneousId = requestedReplacement(regular);

          if (spontaneousId) {
            await resolveReserve(
              reserveByDriver.get(spontaneousId),
              regular,
              true,
            );
          }
        }
      }

      for (const reserve of reserveEntries) {
        if (
          !releasedReserveIds.has(Number(reserve.DriverId)) ||
          finalReserveDrivers.has(Number(reserve.DriverId))
        ) {
          continue;
        }

        if (
          reserve.includeInResults &&
          STARTING_ATTENDANCE.has(reserve.attendanceStatus)
        ) {
          throw new Error(
            `${reserve.driver?.name || "Ein Ersatzfahrer"} ist bereits bestätigt und kann nicht stillschweigend freigegeben werden.`,
          );
        }

        await reserve.update(
          {
            ReplacementForDriverId: null,
            TeamId: null,
            attendanceStatus: null,
            includeInResults: false,
            uncertainPresent: null,
            respondedInTime: null,
          },
          { transaction },
        );
      }

      if (followUpRequired) {
        req.session.flash = {
          type: "warning",
          message:
            "Ein neu gewählter Ersatzfahrer ist unsicher. Bitte seine Anwesenheit und Rückmeldung jetzt vollständig prüfen.",
        };
      }
    });

    if (!req.session.flash) {
      req.session.flash = {
        type: "success",
        message: Object.keys(correctionInput).length
          ? "Anwesenheitskorrekturen wurden gespeichert."
          : "Anwesenheitskontrolle gespeichert. Nur bestätigte Starter werden in Schritt 3 übernommen.",
      };
    }
  } catch (error) {
    req.session.flash = {
      type: "error",
      message: error.message,
    };
  }

  return res.redirect(
    `/admin/race-weekend/f1?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}#anwesenheit`,
  );
};

/*
 * =========================================================
 * RENNWOCHENENDE RESET
 * =========================================================
 */

async function loadResetRace(raceId) {
  const race = await GrandPrixResult.findByPk(Number(raceId), {
    include: [{ association: "seasonRecord" }, { association: "league" }],
  });

  if (!race || race.discipline !== "f1") {
    throw new Error("Formel-1-Rennen wurde nicht gefunden.");
  }

  return race;
}

function raceWeekendRedirect(race, hash = "") {
  return (
    `/admin/race-weekend/f1` +
    `?league=${race.LeagueId}` +
    `&season=${race.SeasonId}` +
    `&race=${race.id}` +
    hash
  );
}

/*
 * =========================================================
 * SCHRITT 3 RESETTEN
 *
 * Aufstellung bleibt
 * Anwesenheit bleibt
 * Ergebnis wird gelöscht
 * =========================================================
 */

exports.resetResults = async (req, res) => {
  const race = await loadResetRace(req.params.raceId);

  try {
    await sequelize.transaction(async (transaction) => {
      await GrandPrixResultEntry.destroy({
        where: {
          GrandPrixResultId: race.id,
        },
        transaction,
      });
    });

    req.session.flash = {
      type: "success",
      message:
        "Schritt 3 wurde zurückgesetzt. Das Rennergebnis wurde gelöscht.",
    };
  } catch (error) {
    req.session.flash = {
      type: "error",
      message: `Ergebnis konnte nicht zurückgesetzt werden: ${error.message}`,
    };
  }

  return res.redirect(raceWeekendRedirect(race, "#ergebnisse"));
};

/*
 * =========================================================
 * SCHRITT 2 RESETTEN
 *
 * Aufstellung bleibt
 * Anwesenheit wird zurückgesetzt
 * automatische Anwesenheitsstrafen weg
 * Ergebnis weg
 * =========================================================
 */

exports.resetAttendance = async (req, res) => {
  const race = await loadResetRace(req.params.raceId);

  try {
    await sequelize.transaction(async (transaction) => {
      const entries = await F1RaceLineupEntry.findAll({
        where: {
          GrandPrixResultId: race.id,
        },
        transaction,
      });

      /*
       * Anwesenheitsdaten vollständig
       * zurücksetzen.
       */

      for (const entry of entries) {
        await entry.update(
          {
            attendanceStatus: null,
            includeInResults: false,
            uncertainPresent: null,
            respondedInTime: null,
          },
          {
            transaction,
          },
        );
      }

      /*
       * Automatisch aus der
       * Anwesenheitskontrolle erzeugte
       * Strafpunkte entfernen.
       *
       * Manuell eingetragene Strafen
       * bleiben erhalten.
       */

      await PenaltyEntry.destroy({
        where: {
          GrandPrixResultId: race.id,

          isAutomatic: true,
        },

        transaction,
      });

      /*
       * Ergebnis hängt von der
       * Anwesenheit ab und muss deshalb
       * ebenfalls zurückgesetzt werden.
       */

      await GrandPrixResultEntry.destroy({
        where: {
          GrandPrixResultId: race.id,
        },

        transaction,
      });
    });

    req.session.flash = {
      type: "success",

      message:
        "Schritt 2 wurde zurückgesetzt. Aufstellung bleibt erhalten; Anwesenheit und Ergebnis wurden zurückgesetzt.",
    };
  } catch (error) {
    req.session.flash = {
      type: "error",

      message: `Anwesenheit konnte nicht zurückgesetzt werden: ${error.message}`,
    };
  }

  return res.redirect(raceWeekendRedirect(race, "#anwesenheit"));
};

/*
 * =========================================================
 * SCHRITT 1 RESETTEN
 *
 * komplette operative Aufstellung weg
 * dadurch auch Anwesenheit + Ergebnis weg
 * =========================================================
 */

exports.resetLineup = async (req, res) => {
  const race = await loadResetRace(req.params.raceId);

  try {
    await sequelize.transaction(async (transaction) => {
      /*
       * Zuerst davon abhängige
       * Ergebnisdaten entfernen.
       */

      await GrandPrixResultEntry.destroy({
        where: {
          GrandPrixResultId: race.id,
        },

        transaction,
      });

      /*
       * Automatische Anwesenheitsstrafen
       * dieses Rennens entfernen.
       */

      await PenaltyEntry.destroy({
        where: {
          GrandPrixResultId: race.id,

          isAutomatic: true,
        },

        transaction,
      });

      /*
       * Aufstellung vollständig entfernen.
       *
       * Beim erneuten Öffnen wird Schritt 1
       * wieder aus dem Saison-Lineup aufgebaut.
       */

      await F1RaceLineupEntry.destroy({
        where: {
          GrandPrixResultId: race.id,
        },

        transaction,
      });
    });

    req.session.flash = {
      type: "success",

      message:
        "Schritt 1 wurde zurückgesetzt. Aufstellung, Anwesenheit und Ergebnis sind wieder offen.",
    };
  } catch (error) {
    req.session.flash = {
      type: "error",

      message: `Aufstellung konnte nicht zurückgesetzt werden: ${error.message}`,
    };
  }

  return res.redirect(raceWeekendRedirect(race, "#aufstellung"));
};

/*
 * =========================================================
 * ALLES RESETTEN
 *
 * RaceEvent / Saison / Stammdaten bleiben bestehen.
 * =========================================================
 */

exports.resetAll = async (req, res) => {
  const race = await loadResetRace(req.params.raceId);

  try {
    await sequelize.transaction(async (transaction) => {
      /*
       * 1. Ergebnis
       */

      await GrandPrixResultEntry.destroy({
        where: {
          GrandPrixResultId: race.id,
        },

        transaction,
      });

      /*
       * 2. automatisch erzeugte
       * Anwesenheitsstrafen
       */

      await PenaltyEntry.destroy({
        where: {
          GrandPrixResultId: race.id,

          isAutomatic: true,
        },

        transaction,
      });

      /*
       * 3. komplette operative
       * Rennaufstellung
       */

      await F1RaceLineupEntry.destroy({
        where: {
          GrandPrixResultId: race.id,
        },

        transaction,
      });
    });

    req.session.flash = {
      type: "success",

      message: "Das Rennwochenende wurde vollständig zurückgesetzt.",
    };
  } catch (error) {
    req.session.flash = {
      type: "error",

      message: `Rennwochenende konnte nicht zurückgesetzt werden: ${error.message}`,
    };
  }

  return res.redirect(raceWeekendRedirect(race, "#aufstellung"));
};

module.exports.loadF1Data = loadF1Data;
module.exports.selectCurrentEvent = selectCurrentEvent;
