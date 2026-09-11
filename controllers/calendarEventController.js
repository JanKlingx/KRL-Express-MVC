const { Op } = require('sequelize');
const { sequelize, RaceEvent, F1Track, GrandPrixResult, GrandPrixResultEntry, F1RaceLineupEntry } = require('../models');
const { localDateTime, parseBerlinDateTime } = require('../services/calendarTime');
function returnHref(event) {
  return event.league.type === 'f1' ? `/f1/${encodeURIComponent(event.league.slug)}?season=${event.SeasonId}#f1-calendar` : `/lmu?season=${event.SeasonId}#lmu-calendar`;
}
async function loadEvent(id, transaction) {
  return RaceEvent.findByPk(id, { include: [{ association: 'league' }, { association: 'seasonRecord' }], transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}) });
}
async function render(res, event, values = event, error = null) {
  const sprint = event.GrandPrixResultId ? await GrandPrixResult.findOne({ where: { SeasonId: event.SeasonId, LeagueId: event.LeagueId, sortOrder: event.sortOrder, raceType: 'sprint' } }) : null;
  const tracks = event.league.type === 'f1' ? await F1Track.findAll({ order: [['name', 'ASC']] }) : [];
  return res.status(error ? 400 : 200).render('admin/calendar-event', { title: 'Renntermin bearbeiten', event, values, tracks, error, hasSprint: Boolean(sprint), startsAtValue: values.localStart || localDateTime(event.startsAt), returnHref: returnHref(event) });
}
exports.edit = async (req, res, next) => {
  const event = await loadEvent(req.params.eventId);
  if (!event || !['f1', 'lmu'].includes(event.league?.type)) return next();
  return render(res, event);
};
exports.update = async (req, res, next) => {
  let event = await loadEvent(req.params.eventId);
  if (!event || !['f1', 'lmu'].includes(event.league?.type)) return next();
  try {
    await sequelize.transaction(async (transaction) => {
      // Lock in the same order as race-control writes.
      if (event.GrandPrixResultId) await GrandPrixResult.findByPk(event.GrandPrixResultId, { transaction, lock: transaction.LOCK.UPDATE });
      event = await loadEvent(event.id, transaction);
      const startsAt = parseBerlinDateTime(req.body.localStart);
      const title = String(req.body.title || '').trim();
      if (!title || title.length > 255) throw new Error('Bitte einen Titel mit höchstens 255 Zeichen eingeben.');
      let circuit = String(req.body.circuit || '').trim();
      let track = null;
      if (event.league.type === 'f1') {
        track = await F1Track.findByPk(Number(req.body.F1TrackId), { transaction });
        if (!track) throw new Error('Bitte eine Strecke aus den Stammdaten auswählen.');
        circuit = track.name;
      }
      if (!circuit || circuit.length > 255) throw new Error('Bitte eine gültige Strecke eingeben.');
      const isTestDay = req.body.isTestDay === 'on';
      const hasSprint = !isTestDay && event.league.type === 'f1' && req.body.hasSprint === 'on';
      const main = event.GrandPrixResultId ? await GrandPrixResult.findByPk(event.GrandPrixResultId, { transaction }) : null;
      const sprint = main ? await GrandPrixResult.findOne({ where: { SeasonId: event.SeasonId, LeagueId: event.LeagueId, sortOrder: main.sortOrder, raceType: 'sprint' }, transaction }) : null;
      const ids = [main?.id, sprint?.id].filter(Boolean);
      const resultCount = ids.length ? await GrandPrixResultEntry.count({ where: { GrandPrixResultId: { [Op.in]: ids } }, transaction }) : 0;
      const lineupCount = main ? await F1RaceLineupEntry.count({ where: { GrandPrixResultId: main.id }, transaction }) : 0;
      if ((isTestDay !== Boolean(event.isTestDay) || hasSprint !== Boolean(sprint)) && (resultCount || lineupCount)) {
        throw new Error('Rennformat erst ändern, nachdem Aufstellung und Ergebnisse dieses Rennwochenendes zurückgesetzt wurden.');
      }
      const oldStart = event.startsAt;
      const raceValues = { title, circuit, raceDate: localDateTime(startsAt).slice(0, 10) };
      if (isTestDay) {
        await event.update({ GrandPrixResultId: null }, { transaction });
        if (ids.length) await GrandPrixResult.destroy({ where: { id: { [Op.in]: ids } }, transaction });
      } else {
        const activeMain = main || await GrandPrixResult.create({ ...raceValues, SeasonId: event.SeasonId, LeagueId: event.LeagueId, season: event.seasonRecord?.name || '', discipline: event.league.type, raceType: 'main', sortOrder: event.sortOrder, pointsMode: 'database', isHistorical: event.seasonRecord?.status === 'historical' }, { transaction });
        await activeMain.update(raceValues, { transaction });
        await event.update({ GrandPrixResultId: activeMain.id }, { transaction });
        if (hasSprint) {
          const sprintValues = { ...raceValues, title: `Sprint · ${circuit}` };
          if (sprint) await sprint.update(sprintValues, { transaction });
          else await GrandPrixResult.create({ ...sprintValues, SeasonId: event.SeasonId, LeagueId: event.LeagueId, season: event.seasonRecord?.name || '', discipline: 'f1', raceType: 'sprint', sortOrder: event.sortOrder, pointsMode: 'database', isHistorical: event.seasonRecord?.status === 'historical' }, { transaction });
        } else if (sprint) await sprint.destroy({ transaction });
      }
      await event.update({ title, circuit, startsAt, ...(track ? { F1TrackId: track.id } : {}), isTestDay, isPublished: req.body.isPublished === 'on', hasLocalOverride: true, calendarChanged: true, previousStartsAt: new Date(oldStart).getTime() !== startsAt.getTime() ? oldStart : event.previousStartsAt }, { transaction });
    });
    req.session.flash = { type: 'success', message: 'Der Termin dieser Liga und Saison wurde gespeichert.' };
    res.redirect(returnHref(event));
  } catch (error) { return render(res, event, req.body, error.message); }
};
