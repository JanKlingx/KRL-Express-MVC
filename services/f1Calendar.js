const { Op } = require("sequelize");

const {
  F1Calendar,
  F1CalendarRound,
  GrandPrixResult,
  GrandPrixResultEntry,
  RaceEvent,
} = require("../models");

function extractLeagueTime(value, fallback = "20:00") {
  return String(value || "").match(/\b([01]\d|2[0-3]):[0-5]\d\b/)?.[0] || fallback;
}

function roundNumber(round) {
  return Number(round.roundNumber || round.sortOrder || 0);
}

function eventSortOrder(round) {
  if (round.isTestDay && Number.isInteger(Number(round.sortOrder))) {
    return Number(round.sortOrder);
  }
  return roundNumber(round);
}

function titleForRound(round) {
  const country = round.track?.countryRecord?.name || round.track?.country;
  return `Großer Preis von ${country || round.track?.name || round.circuit}`;
}

function dateAndLeagueTime(date, league) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    throw new Error("Für jede Kalenderrunde ist ein gültiges Datum erforderlich.");
  }
  const startsAt = new Date(`${date}T${extractLeagueTime(league.raceTime)}:00`);
  if (Number.isNaN(startsAt.getTime())) throw new Error("Datum oder Startzeit ist ungültig.");
  return startsAt;
}

async function loadCalendar(calendarId, transaction) {
  return F1Calendar.findByPk(calendarId, {
    include: [{
      association: "rounds",
      required: false,
      include: [{ association: "track", include: [{ association: "countryRecord" }] }],
    }],
    order: [[{ model: F1CalendarRound, as: "rounds" }, "sortOrder", "ASC"]],
    transaction,
  });
}

async function resultHasEntries(resultId, transaction) {
  if (!resultId) return false;
  return Boolean(await GrandPrixResultEntry.count({
    where: { GrandPrixResultId: resultId },
    transaction,
  }));
}

async function weekendHasEntries(season, league, round, event, transaction) {
  const results = await GrandPrixResult.findAll({
    where: {
      SeasonId: season.id,
      LeagueId: league.id,
      sortOrder: roundNumber(round),
      raceType: { [Op.in]: ["main", "sprint"] },
    },
    attributes: ["id"],
    transaction,
  });
  const ids = [...new Set([
    event?.GrandPrixResultId,
    ...results.map((result) => result.id),
  ].filter(Boolean))];
  return ids.length ? Boolean(await GrandPrixResultEntry.count({
    where: { GrandPrixResultId: { [Op.in]: ids } },
    transaction,
  })) : false;
}

async function findRaceResult(season, league, round, event, raceType, transaction) {
  if (raceType === "main" && event?.GrandPrixResultId) {
    const linked = await GrandPrixResult.findByPk(event.GrandPrixResultId, { transaction });
    if (linked) return linked;
  }
  const order = roundNumber(round);
  const matches = await GrandPrixResult.findAll({
    where: {
      SeasonId: season.id,
      LeagueId: league.id,
      raceType,
      [Op.or]: [
        { sortOrder: order },
        { circuit: round.track.name },
      ],
    },
    order: [["id", "ASC"]],
    transaction,
  });
  if (matches.length > 1) {
    throw new Error(`R${order} besitzt mehrere ${raceType === "sprint" ? "Sprint-" : "Haupt"}ergebnisse.`);
  }
  return matches[0] || null;
}

async function findRaceEvent(season, round, transaction) {
  const linked = await RaceEvent.findAll({
    where: { SeasonId: season.id, F1CalendarRoundId: round.id },
    transaction,
  });
  if (linked.length > 1) throw new Error(`R${roundNumber(round)} besitzt doppelte RaceEvents.`);
  if (linked[0]) return linked[0];

  const fallback = await RaceEvent.findAll({
    where: { SeasonId: season.id, sortOrder: eventSortOrder(round) },
    order: [["id", "ASC"]],
    transaction,
  });
  if (fallback.length > 1) throw new Error(`R${roundNumber(round)} besitzt doppelte Legacy-RaceEvents.`);
  return fallback[0] || null;
}

async function syncSeasonRound({ season, league, round, date, transaction }) {
  const order = roundNumber(round);
  if (!Number.isInteger(order) || order < 1 || !round.track) {
    throw new Error("Der zentrale Kalender enthält eine ungültige Runde oder Strecke.");
  }

  const startsAt = dateAndLeagueTime(date, league);
  const values = {
    SeasonId: season.id,
    LeagueId: league.id,
    F1CalendarRoundId: round.id,
    F1TrackId: round.F1TrackId,
    title: titleForRound(round),
    circuit: round.track.name,
    startsAt,
    isPublished: season.status === "active" && season.isPublished,
    isTestDay: Boolean(round.isTestDay),
    sortOrder: eventSortOrder(round),
  };

  let event = await findRaceEvent(season, round, transaction);
  const completed = event && await weekendHasEntries(season, league, round, event, transaction);
  if (!event) event = await RaceEvent.create(values, { transaction });
  else if (!completed) {
    const oldStart = new Date(event.startsAt).getTime();
    const dateChanged = oldStart !== startsAt.getTime();
    const orderChanged = Number(event.sortOrder) !== eventSortOrder(round);
    await event.update({
      ...values,
      previousStartsAt: dateChanged ? event.startsAt : event.previousStartsAt,
      previousSortOrder: orderChanged ? event.sortOrder : event.previousSortOrder,
      calendarChanged: Boolean(event.calendarChanged || dateChanged || orderChanged),
    }, { transaction });
  }
  else if (!event.F1CalendarRoundId) {
    await event.update({ F1CalendarRoundId: round.id }, { transaction });
  }

  if (round.isTestDay) return event;

  let main = await findRaceResult(season, league, round, event, "main", transaction);
  const mainValues = {
    SeasonId: season.id,
    LeagueId: league.id,
    season: season.name,
    title: values.title,
    circuit: values.circuit,
    raceDate: date,
    discipline: "f1",
    raceType: "main",
    pointsMode: main?.pointsMode || "database",
    isHistorical: season.status === "historical",
    sortOrder: order,
  };
  if (!main) main = await GrandPrixResult.create(mainValues, { transaction });
  else if (!(await resultHasEntries(main.id, transaction))) await main.update(mainValues, { transaction });
  if (event.GrandPrixResultId !== main.id) {
    await event.update({ GrandPrixResultId: main.id }, { transaction });
  }

  let sprint = await findRaceResult(season, league, round, event, "sprint", transaction);
  if (round.hasSprint) {
    const sprintValues = { ...mainValues, title: `Sprint · ${values.circuit}`, raceType: "sprint" };
    if (!sprint) sprint = await GrandPrixResult.create(sprintValues, { transaction });
    else if (!(await resultHasEntries(sprint.id, transaction))) await sprint.update(sprintValues, { transaction });
  }
  // Vorhandene Sprint-Ergebnisdatensätze werden bei einer späteren
  // Vorlagenänderung niemals automatisch gelöscht.
  return event;
}

async function syncSeasonCalendar({ season, league, calendarId, dates, transaction }) {
  const calendar = await loadCalendar(calendarId, transaction);
  if (!calendar || !calendar.isActive) throw new Error("Bitte einen gültigen aktiven F1-Kalender auswählen.");
  if (!calendar.rounds.length) throw new Error("Der zentrale F1-Kalender enthält noch keine Runden.");

  const seen = new Set();
  for (const round of calendar.rounds) {
    const number = roundNumber(round);
    if (!Number.isInteger(number) || number < 1 || !round.F1TrackId || !round.track) {
      throw new Error("Der zentrale F1-Kalender enthält eine ungültige Runde oder Strecke.");
    }
    if (seen.has(number)) throw new Error(`R${number} ist im zentralen Kalender doppelt vorhanden.`);
    seen.add(number);
    await syncSeasonRound({ season, league, round, date: dates[round.id], transaction });
  }
  await season.update({ F1CalendarId: calendar.id, calendarMode: "automatic" }, { transaction });
  return calendar;
}

async function validateSeasonCalendar(calendarId, transaction) {
  const calendar = await loadCalendar(calendarId, transaction);
  if (!calendar || !calendar.isActive) {
    throw new Error("Bitte einen gültigen aktiven F1-Kalender auswählen.");
  }
  if (!calendar.rounds.length) {
    throw new Error("Der zentrale F1-Kalender enthält noch keine Runden.");
  }
  const seen = new Set();
  for (const round of calendar.rounds) {
    const number = roundNumber(round);
    if (!Number.isInteger(number) || number < 1 || !round.F1TrackId || !round.track) {
      throw new Error("Jede Kalenderrunde benötigt eine eindeutige Rundennummer und eine F1-Strecke.");
    }
    if (seen.has(number)) {
      throw new Error(`R${number} ist im zentralen Kalender doppelt vorhanden.`);
    }
    seen.add(number);
  }
  return calendar;
}

async function linkExistingSeasonCalendar({ season, league, calendarId, transaction }) {
  const calendar = await validateSeasonCalendar(calendarId, transaction);
  const events = await RaceEvent.findAll({
    where: { SeasonId: season.id, LeagueId: league.id },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  let linked = 0;
  let unmatched = 0;
  for (const round of calendar.rounds) {
    const matches = events.filter((event) =>
      Number(event.sortOrder) === roundNumber(round) &&
      Number(event.F1TrackId) === Number(round.F1TrackId));
    if (matches.length > 1) {
      throw new Error(`R${roundNumber(round)} besitzt mehrere RaceEvents mit derselben Strecke.`);
    }
    const event = matches[0] || null;
    if (!event) {
      unmatched += 1;
      continue;
    }
    if (Number(event.F1CalendarRoundId) !== Number(round.id)) {
      await event.update({ F1CalendarRoundId: round.id }, { transaction });
    }
    linked += 1;
  }
  await season.update({ F1CalendarId: calendar.id, calendarMode: "automatic" }, { transaction });
  return { calendar, linked, unmatched, eventCount: events.length };
}

async function syncSeasonDates({ season, league, calendarId, dates, transaction }) {
  if (Number(season.F1CalendarId) !== Number(calendarId)) {
    throw new Error("Der gespeicherte Saisonkalender stimmt nicht mit der Anfrage überein.");
  }
  const calendar = await validateSeasonCalendar(calendarId, transaction);
  const events = await RaceEvent.findAll({
    where: { SeasonId: season.id, LeagueId: league.id },
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!events.length) {
    await syncSeasonCalendar({ season, league, calendarId, dates, transaction });
    return { calendar, created: calendar.rounds.length, updated: 0, skippedCompleted: 0, unmatched: 0 };
  }

  let updated = 0;
  let skippedCompleted = 0;
  let unmatched = 0;
  for (const round of calendar.rounds) {
    const startsAt = dateAndLeagueTime(dates[round.id], league);
    const linked = events.filter((event) => Number(event.F1CalendarRoundId) === Number(round.id));
    const exact = events.filter((event) =>
      Number(event.sortOrder) === roundNumber(round) &&
      Number(event.F1TrackId) === Number(round.F1TrackId));
    const candidates = linked.length ? linked : exact;
    if (candidates.length > 1) {
      throw new Error(`R${roundNumber(round)} kann nicht eindeutig einem bestehenden RaceEvent zugeordnet werden.`);
    }
    const event = candidates[0] || null;
    if (!event) {
      unmatched += 1;
      continue;
    }
    if (await weekendHasEntries(season, league, round, event, transaction)) {
      skippedCompleted += 1;
      continue;
    }
    const oldStart = new Date(event.startsAt).getTime();
    const dateChanged = oldStart !== startsAt.getTime();
    await event.update({
      F1CalendarRoundId: round.id,
      startsAt,
      previousStartsAt: dateChanged ? event.startsAt : event.previousStartsAt,
      calendarChanged: Boolean(event.calendarChanged || dateChanged),
    }, { transaction });
    updated += 1;
  }
  return { calendar, created: 0, updated, skippedCompleted, unmatched };
}

async function syncLinkedRaceEvents(round, transaction) {
  const hydrated = await F1CalendarRound.findByPk(round.id, {
    include: [{ association: "track", include: [{ association: "countryRecord" }] }],
    transaction,
  });
  const events = await RaceEvent.findAll({
    where: { F1CalendarRoundId: round.id },
    include: [{ association: "seasonRecord" }, { association: "league" }],
    transaction,
  });
  let skippedCompleted = 0;
  for (const event of events) {
    if (!event.seasonRecord || !event.league) {
      skippedCompleted += 1;
      continue;
    }
    if (await weekendHasEntries(event.seasonRecord, event.league, hydrated, event, transaction)) {
      skippedCompleted += 1;
      continue;
    }
    const date = new Date(event.startsAt).toISOString().slice(0, 10);
    await syncSeasonRound({
      season: event.seasonRecord,
      league: event.league,
      round: hydrated,
      date,
      transaction,
    });
  }
  return { updated: events.length - skippedCompleted, skippedCompleted };
}

module.exports = {
  extractLeagueTime,
  loadCalendar,
  roundNumber,
  linkExistingSeasonCalendar,
  syncLinkedRaceEvents,
  syncSeasonCalendar,
  syncSeasonDates,
  titleForRound,
  validateSeasonCalendar,
};
