const {
  sequelize,
  F1Calendar,
  F1CalendarRound,
  F1Track,
  RaceEvent,
  Season,
} = require("../models");
const { lockCalendar, orderedRounds, protectCompleted, numberRounds } = require("../services/calendarOrder");

function redirect(calendarId) {
  return `/admin/f1-calendars${calendarId ? `?calendar=${calendarId}` : ""}`;
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

async function validateName(value, excludedId) {
  const name = String(value || "").trim();
  if (!name || name.length > 255) throw new Error("Bitte einen Kalendernamen mit 1 bis 255 Zeichen eingeben.");
  const calendars = await F1Calendar.findAll({ attributes: ["id", "name"] });
  if (calendars.some((item) => Number(item.id) !== Number(excludedId) && item.name.trim().toLocaleLowerCase("de") === name.toLocaleLowerCase("de"))) {
    throw new Error("Ein Rennkalender mit diesem Namen existiert bereits.");
  }
  return name;
}

async function validateTrack(trackId, transaction) {
  const track = await F1Track.findByPk(trackId, { transaction });
  if (!track) throw new Error("Bitte eine Strecke aus dem F1-Streckenstamm auswählen.");
  return track;
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
        ["name", "ASC"],
        ["id", "DESC"],
        [{ model: F1CalendarRound, as: "rounds" }, "sortOrder", "ASC"],
      ],
    }),
    F1Track.findAll({
      include: [{ association: "countryRecord" }],
      order: [["country", "ASC"], ["name", "ASC"]],
    }),
  ]);
  const selectedCalendar = calendars.find((item) => item.id === Number(req.query.calendar)) || null;
  res.render("admin/f1-calendars", {
    title: "Zentrale F1-Rennkalender",
    calendars,
    selectedCalendar,
    tracks,
    creating: req.query.mode === "create",
    structureOpen: req.query.step === "structure",
    draftName: req.session.calendarDraftName || "",
  });
};

exports.create = async (req, res) => {
  try {
    const name = await validateName(req.body.name, req.params.calendarId);
    const calendar = await sequelize.transaction(async (transaction) => F1Calendar.create({
      name,
      isActive: req.body.isActive === "on",
    }, {
      transaction,
    }));
    delete req.session.calendarDraftName;
    setFlash(req, "success", `Der Kalender „${calendar.name}“ wurde angelegt.`);
    return res.redirect(redirect(calendar.id) + "&step=structure");
  } catch (error) {
    setFlash(req, "error", error.message);
    req.session.calendarDraftName = String(req.body.name || "").slice(0, 255);
    return res.redirect("/admin/f1-calendars?mode=create");
  }
};

exports.update = async (req, res) => {
  const calendar = await F1Calendar.findByPk(req.params.calendarId);
  try {
    if (!calendar) throw new Error("Der Kalender wurde nicht gefunden.");
    const name = await validateName(req.body.name, req.params.calendarId);
    await sequelize.transaction(async (transaction) => calendar.update({
      name,
      isActive: req.body.isActive === "on",
    }, { transaction }));
    setFlash(req, "success", "Kalenderdaten wurden gespeichert.");
  } catch (error) {
    setFlash(req, "error", error.message);
  }
  res.redirect(redirect(calendar?.id) + (req.session.flash.type === "success" ? "&step=structure" : ""));
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
  try {
    await sequelize.transaction(async (transaction) => {
      const rounds = await lockCalendar(req.params.calendarId, transaction);
      let expected = 0;
      const needsNormalization = rounds.some((round) => {
        const number = round.isTestDay ? null : ++expected;
        return round.roundNumber !== number;
      });
      if (needsNormalization) {
        await protectCompleted(rounds, transaction);
        await numberRounds(rounds, transaction);
      }
      const track = await validateTrack(req.body.F1TrackId, transaction);
      const isTestDay = req.body.isTestDay === "on";
      await F1CalendarRound.create({
        F1CalendarId: req.params.calendarId, F1TrackId: track.id, circuit: track.name,
        isTestDay, hasSprint: !isTestDay && req.body.hasSprint === "on",
        roundNumber: isTestDay ? null : rounds.filter((round) => !round.isTestDay).length + 1,
        sortOrder: Math.max(0, ...rounds.map((round) => Number(round.sortOrder))) + 1,
      }, { transaction });
    });
    setFlash(req, "success", "Kalendereintrag hinzugefügt. Die Rennnummer ergibt sich aus der Reihenfolge.");
  } catch (error) { setFlash(req, "error", error.message); }
  res.redirect(redirect(req.params.calendarId) + "&step=structure");
};

exports.saveStructure = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const rounds = await lockCalendar(req.params.calendarId, transaction);
      const ordered = orderedRounds(rounds, req.body.roundIds);
      await protectCompleted(rounds, transaction);
      for (const round of ordered) {
        const values = req.body.rounds?.[round.id];
        if (!values) throw new Error("Ein Kalendereintrag fehlt. Bitte neu laden.");
        const track = await validateTrack(values.F1TrackId, transaction);
        const isTestDay = values.isTestDay === "on";
        await round.update({ F1TrackId: track.id, circuit: track.name, isTestDay, hasSprint: !isTestDay && values.hasSprint === "on" }, { transaction });
      }
      await numberRounds(ordered, transaction);
    });
    setFlash(req, "success", "Kalenderstruktur und Reihenfolge gespeichert.");
  } catch (error) { setFlash(req, "error", error.message); }
  res.redirect(redirect(req.params.calendarId) + "&step=structure");
};

// Existing URLs remain supported; manual round numbers are never accepted.
exports.updateRound = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const rounds = await lockCalendar(req.params.calendarId, transaction);
      const round = rounds.find((row) => Number(row.id) === Number(req.params.roundId));
      if (!round) throw new Error("Die Kalenderrunde wurde nicht gefunden.");
      await protectCompleted(rounds, transaction);
      const track = await validateTrack(req.body.F1TrackId, transaction);
      const isTestDay = req.body.isTestDay === "on";
      await round.update({ F1TrackId: track.id, circuit: track.name, isTestDay, hasSprint: !isTestDay && req.body.hasSprint === "on" }, { transaction });
      await numberRounds(rounds, transaction);
    });
    setFlash(req, "success", "Kalendereintrag gespeichert.");
  } catch (error) { setFlash(req, "error", error.message); }
  res.redirect(redirect(req.params.calendarId) + "&step=structure");
};

exports.removeRound = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const rounds = await lockCalendar(req.params.calendarId, transaction);
      const round = rounds.find((row) => Number(row.id) === Number(req.params.roundId));
      if (!round) throw new Error("Die Kalenderrunde wurde nicht gefunden.");
      if (await RaceEvent.count({ where: { F1CalendarRoundId: round.id }, transaction })) throw new Error("Eine bereits verwendete Kalenderrunde kann nicht gelöscht werden.");
      await protectCompleted(rounds, transaction);
      await round.destroy({ transaction });
      await numberRounds(rounds.filter((row) => row !== round), transaction);
    });
    setFlash(req, "success", "Eintrag entfernt. Rennnummern wurden aktualisiert.");
  } catch (error) { setFlash(req, "error", error.message); }
  res.redirect(redirect(req.params.calendarId) + "&step=structure");
};

exports.reorder = async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      const rounds = await lockCalendar(req.params.calendarId, transaction);
      const ordered = orderedRounds(rounds, req.body.roundIds);
      await protectCompleted(rounds, transaction);
      await numberRounds(ordered, transaction);
    });
    setFlash(req, "success", "Reihenfolge gespeichert. Testtage bleiben ohne Rennnummer.");
  } catch (error) { setFlash(req, "error", error.message); }
  res.redirect(redirect(req.params.calendarId) + "&step=structure");
};
