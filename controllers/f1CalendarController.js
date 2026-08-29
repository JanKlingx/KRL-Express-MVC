const { Op } = require("sequelize");

const {
  sequelize,
  F1Calendar,
  F1CalendarRound,
  F1Track,
  RaceEvent,
  GrandPrixResult,
  GrandPrixResultEntry,
  Season,
} = require("../models");
const { syncLinkedRaceEvents } = require("../services/f1Calendar");

function redirect(calendarId) {
  return `/admin/f1-calendars${calendarId ? `?calendar=${calendarId}` : ""}`;
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

async function validateTrack(trackId, transaction) {
  const track = await F1Track.findByPk(trackId, { transaction });
  if (!track) throw new Error("Bitte eine Strecke aus dem F1-Streckenstamm auswählen.");
  return track;
}

async function validateRound(calendarId, value, excludedId, transaction) {
  const roundNumber = Number(value);
  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new Error("Die Rundennummer muss eine ganze Zahl ab 1 sein.");
  }
  const where = { F1CalendarId: calendarId, roundNumber };
  if (excludedId) where.id = { [Op.ne]: excludedId };
  if (await F1CalendarRound.findOne({ where, transaction })) {
    throw new Error(`R${roundNumber} ist in diesem Kalender bereits vorhanden.`);
  }
  return roundNumber;
}

async function nextSortOrder(calendarId, transaction) {
  const highest = await F1CalendarRound.max("sortOrder", {
    where: { F1CalendarId: calendarId },
    transaction,
  });
  return Number(highest || 0) + 1;
}

exports.index = async (req, res) => {
  const [calendars, tracks] = await Promise.all([
    F1Calendar.findAll({
      include: [{
        association: "rounds",
        required: false,
        include: [{ association: "track", include: [{ association: "countryRecord" }] }],
      }],
      order: [
        ["isActive", "DESC"],
        ["sortOrder", "ASC"],
        ["id", "DESC"],
        [{ model: F1CalendarRound, as: "rounds" }, "sortOrder", "ASC"],
      ],
    }),
    F1Track.findAll({
      include: [{ association: "countryRecord" }],
      order: [["country", "ASC"], ["name", "ASC"]],
    }),
  ]);
  const selectedCalendar = calendars.find((item) => item.id === Number(req.query.calendar)) || calendars[0] || null;
  res.render("admin/f1-calendars", {
    title: "Zentrale F1-Rennkalender",
    calendars,
    selectedCalendar,
    tracks,
  });
};

exports.create = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name) throw new Error("Bitte einen Kalendernamen eingeben.");
    const calendar = await sequelize.transaction(async (transaction) => F1Calendar.create({
      name,
      isActive: req.body.isActive === "on",
      sortOrder: Number(req.body.sortOrder || 0),
    }, {
      transaction,
    }));
    setFlash(req, "success", `Der Kalender „${calendar.name}“ wurde angelegt.`);
    return res.redirect(redirect(calendar.id));
  } catch (error) {
    setFlash(req, "error", error.message);
    return res.redirect(redirect());
  }
};

exports.update = async (req, res) => {
  const calendar = await F1Calendar.findByPk(req.params.calendarId);
  try {
    if (!calendar) throw new Error("Der Kalender wurde nicht gefunden.");
    const name = String(req.body.name || "").trim();
    if (!name) throw new Error("Bitte einen Kalendernamen eingeben.");
    await sequelize.transaction(async (transaction) => calendar.update({
      name,
      isActive: req.body.isActive === "on",
      sortOrder: Number(req.body.sortOrder || 0),
    }, { transaction }));
    setFlash(req, "success", "Kalenderdaten wurden gespeichert.");
  } catch (error) {
    setFlash(req, "error", error.message);
  }
  res.redirect(redirect(calendar?.id));
};

exports.remove = async (req, res) => {
  const calendar = await F1Calendar.findByPk(req.params.calendarId);
  try {
    if (!calendar) throw new Error("Der Kalender wurde nicht gefunden.");
    const [seasonCount, eventCount] = await Promise.all([
      Season.count({ where: { F1CalendarId: calendar.id } }),
      RaceEvent.count({
        include: [{ association: "calendarRound", where: { F1CalendarId: calendar.id }, required: true }],
      }),
    ]);
    if (seasonCount || eventCount) {
      throw new Error("Der Kalender wird bereits von Saisons oder RaceEvents verwendet und kann nicht gelöscht werden.");
    }
    await sequelize.transaction(async (transaction) => {
      await F1CalendarRound.destroy({ where: { F1CalendarId: calendar.id }, transaction });
      await calendar.destroy({ transaction });
    });
    setFlash(req, "success", "Der unbenutzte Kalender wurde gelöscht.");
  } catch (error) {
    setFlash(req, "error", error.message);
  }
  res.redirect(redirect());
};

exports.createRound = async (req, res) => {
  const calendar = await F1Calendar.findByPk(req.params.calendarId);
  try {
    if (!calendar) throw new Error("Der Kalender wurde nicht gefunden.");
    await sequelize.transaction(async (transaction) => {
      const track = await validateTrack(req.body.F1TrackId, transaction);
      const isTestDay = req.body.isTestDay === "on";
      const number = isTestDay
        ? null
        : await validateRound(calendar.id, req.body.roundNumber, null, transaction);
      await F1CalendarRound.create({
        F1CalendarId: calendar.id,
        F1TrackId: track.id,
        roundNumber: number,
        circuit: track.name,
        hasSprint: !isTestDay && req.body.hasSprint === "on",
        isTestDay,
        sortOrder: await nextSortOrder(calendar.id, transaction),
      }, { transaction });
    });
    setFlash(req, "success", req.body.isTestDay === "on"
      ? "Der Testtag wurde ohne offizielle Rennnummer hinzugefügt."
      : "Das Rennen wurde als neue Kalenderrunde hinzugefügt.");
  } catch (error) {
    setFlash(req, "error", error.message);
  }
  res.redirect(redirect(calendar?.id));
};

exports.updateRound = async (req, res) => {
  const round = await F1CalendarRound.findByPk(req.params.roundId);
  try {
    if (!round || Number(round.F1CalendarId) !== Number(req.params.calendarId)) {
      throw new Error("Die Kalenderrunde wurde nicht gefunden.");
    }
    const result = await sequelize.transaction(async (transaction) => {
      const track = await validateTrack(req.body.F1TrackId, transaction);
      const isTestDay = req.body.isTestDay === "on";
      const number = isTestDay
        ? null
        : await validateRound(round.F1CalendarId, req.body.roundNumber, round.id, transaction);
      await round.update({
        F1TrackId: track.id,
        roundNumber: number,
        circuit: track.name,
        hasSprint: !isTestDay && req.body.hasSprint === "on",
        isTestDay,
      }, { transaction });
      return syncLinkedRaceEvents(round, transaction);
    });
    setFlash(req, "success", result.skippedCompleted
      ? `Runde gespeichert; ${result.skippedCompleted} abgeschlossenes RaceEvent blieb historisch unverändert.`
      : "Runde und verknüpfte offene RaceEvents wurden gespeichert.");
  } catch (error) {
    setFlash(req, "error", error.message);
  }
  res.redirect(redirect(round?.F1CalendarId || req.params.calendarId));
};

exports.removeRound = async (req, res) => {
  const round = await F1CalendarRound.findByPk(req.params.roundId);
  try {
    if (!round || Number(round.F1CalendarId) !== Number(req.params.calendarId)) {
      throw new Error("Die Kalenderrunde wurde nicht gefunden.");
    }
    await sequelize.transaction(async (transaction) => {
      const linkedCount = await RaceEvent.count({
        where: { F1CalendarRoundId: round.id },
        transaction,
      });
      if (linkedCount) {
        throw new Error("Eine bereits verwendete Kalenderrunde kann nicht gelöscht werden.");
      }
      await round.destroy({ transaction });
    });
    setFlash(req, "success", "Die unbenutzte Runde wurde gelöscht.");
  } catch (error) {
    setFlash(req, "error", error.message);
  }
  res.redirect(redirect(round?.F1CalendarId || req.params.calendarId));
};

exports.reorder = async (req, res) => {
  const calendar = await F1Calendar.findByPk(req.params.calendarId);
  try {
    if (!calendar) throw new Error("Der Kalender wurde nicht gefunden.");
    const ids = [].concat(req.body.roundIds || []).map(Number).filter(Number.isInteger);
    const rounds = await F1CalendarRound.findAll({ where: { F1CalendarId: calendar.id } });
    if (ids.length !== rounds.length || new Set(ids).size !== rounds.length || rounds.some((round) => !ids.includes(round.id))) {
      throw new Error("Die übermittelte Reihenfolge ist unvollständig oder ungültig.");
    }
    const linkedEvents = await RaceEvent.findAll({
      where: { F1CalendarRoundId: { [Op.in]: ids } },
      attributes: ["GrandPrixResultId", "SeasonId", "sortOrder"],
    });
    const resultIds = (await GrandPrixResult.findAll({
      where: {
        SeasonId: { [Op.in]: [...new Set(linkedEvents.map((event) => event.SeasonId).filter(Boolean))] },
        sortOrder: { [Op.in]: [...new Set(linkedEvents.map((event) => event.sortOrder).filter(Boolean))] },
        discipline: "f1",
      },
      attributes: ["id"],
    })).map((result) => result.id);
    if (resultIds.length && await GrandPrixResultEntry.count({ where: { GrandPrixResultId: { [Op.in]: resultIds } } })) {
      throw new Error("Die Reihenfolge kann nach abgeschlossenen Rennen nicht mehr automatisch geändert werden.");
    }
    await sequelize.transaction(async (transaction) => {
      for (const round of rounds) await round.update({ roundNumber: null }, { transaction });
      let officialRoundNumber = 0;
      for (const [index, id] of ids.entries()) {
        const round = rounds.find((item) => item.id === id);
        if (!round.isTestDay) officialRoundNumber += 1;
        await round.update({
          roundNumber: round.isTestDay ? null : officialRoundNumber,
          sortOrder: index + 1,
        }, { transaction });
        await syncLinkedRaceEvents(round, transaction);
      }
    });
    setFlash(req, "success", "Die Reihenfolge wurde gespeichert. Testtage bleiben dabei ohne Rennnummer.");
  } catch (error) {
    setFlash(req, "error", error.message);
  }
  res.redirect(redirect(calendar?.id));
};
