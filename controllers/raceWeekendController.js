const { Op } = require('sequelize');
const {
  sequelize, League, Season, RaceEvent, GrandPrixResult, F1RaceLineupEntry,
  Driver, PenaltyRule, PenaltyEntry
} = require('../models');
const { ATTENDANCE_STATUSES, normalizeAttendanceStatus } = require('../services/raceLineup');
const { loadSeasonStructure } = require('../services/f1Season');

const attendanceReason = {
  unabgemeldet: 'Unabgemeldet',
  zu_spaet_abgemeldet: 'Zu spät abgemeldet',
  zu_spaet_vorbesprechung: 'Zu spät Vorbesprechung'
};
const ruleStatus = {
  unabgemeldet: 'unabgemeldet',
  zu_spaet_abgemeldet: 'late-cancellation',
  zu_spaet_vorbesprechung: 'late-briefing'
};

async function loadF1Data(query = {}) {
  const leagues = await League.findAll({ where: { type: 'f1', slug: { [Op.in]: ['freitag', 'samstag', 'sonntag'] } }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  const league = leagues.find((item) => item.id === Number(query.league)) || leagues[0] || null;
  const seasons = league ? await Season.findAll({ where: { scopeSlug: league.slug, leagueType: 'f1', status: 'active', isPublished: true }, order: [['id', 'DESC']] }) : [];
  const season = seasons.find((item) => item.id === Number(query.season)) || seasons[0] || null;
  const events = season ? await RaceEvent.findAll({ where: { LeagueId: league.id, SeasonId: season.id }, include: [{ association: 'grandPrixResult' }], order: [['sortOrder', 'ASC'], ['startsAt', 'ASC']] }) : [];
  const event = events.find((item) => item.id === Number(query.event))
    || events.find((item) => item.GrandPrixResultId === Number(query.race))
    || events[0] || null;
  const race = event?.grandPrixResult || (event?.GrandPrixResultId ? await GrandPrixResult.findByPk(event.GrandPrixResultId) : null);
  const [entries, structure] = await Promise.all([
    race ? F1RaceLineupEntry.findAll({
      where: { GrandPrixResultId: race.id },
      include: [{ association: 'driver' }, { association: 'replacementFor' }, { association: 'team' }],
      order: [['roleType', 'ASC'], ['sortOrder', 'ASC'], ['id', 'ASC']]
    }) : [],
    season ? loadSeasonStructure(season.id) : { unassignedDrivers: [] }
  ]);
  const seasonTeamByDriver = new Map();
  structure.teams?.forEach((team) => team.drivers.forEach((driver) => seasonTeamByDriver.set(driver.id, team)));
  const attendanceRows = entries.filter((entry) => (
    (entry.roleType === 'regular' && ['anwesend', 'unsicher'].includes(entry.status))
    || (entry.roleType === 'reserve' && entry.ReplacementForDriverId && entry.status !== 'abgemeldet')
  )).map((entry) => {
    const regularDriverId = entry.roleType === 'regular' ? entry.DriverId : entry.ReplacementForDriverId;
    return { entry, displayTeam: seasonTeamByDriver.get(regularDriverId) || entry.team };
  });
  const availableReplacements = structure.unassignedDrivers.filter((driver) => !entries.some((entry) => entry.DriverId === driver.id && entry.ReplacementForDriverId));
  return { leagues, league, seasons, season, events, event, race, entries, attendanceRows, availableReplacements };
}

exports.show = async (req, res) => {
  if (req.params.discipline !== 'f1') {
    req.session.flash = { type: 'error', message: 'Der neue Rennwochenenden-Assistent ist zunächst für Formel 1 verfügbar.' };
    return res.redirect('/admin');
  }
  const data = await loadF1Data(req.query);
  const lineupHref = `/admin/f1-race-lineup?league=${data.league?.id || ''}&race=${data.race?.id || ''}`;
  const resultsHref = `/admin/current-season-progress?league=${data.league?.id || ''}&race=${data.race?.id || ''}`;
  res.render('admin/race-weekend', {
    title: 'Rennwochenende Formel 1', requested: 'f1', ...data,
    attendanceStatuses: ATTENDANCE_STATUSES, lineupHref, resultsHref
  });
};

exports.saveAttendance = async (req, res) => {
  const race = await GrandPrixResult.findByPk(Number(req.params.raceId), { include: [{ association: 'seasonRecord' }, { association: 'league' }] });
  if (!race || race.discipline !== 'f1' || race.seasonRecord?.status !== 'active') throw new Error('Aktuelles Formel-1-Rennen wurde nicht gefunden.');
  const entries = await F1RaceLineupEntry.findAll({ where: { GrandPrixResultId: race.id } });
  const input = req.body.attendance || {};
  const rules = await PenaltyRule.findAll({ where: { discipline: 'f1' } });
  const ruleByStatus = new Map(rules.map((rule) => [rule.status, rule]));
  const structure = await loadSeasonStructure(race.SeasonId);
  const allowedReplacementIds = new Set(structure.unassignedDrivers.map((driver) => driver.id));
  const usedReplacementIds = new Set();

  await sequelize.transaction(async (transaction) => {
    for (const entry of entries) {
      const row = input[String(entry.id)];
      if (!row) continue;
      const attendanceStatus = normalizeAttendanceStatus(row.status);
      const mayStart = ['anwesend', 'zu_spaet_vorbesprechung'].includes(attendanceStatus);
      await entry.update({ attendanceStatus, includeInResults: mayStart && row.includeInResults === 'on' }, { transaction });

      const automaticReason = attendanceReason[attendanceStatus];
      const rule = ruleByStatus.get(ruleStatus[attendanceStatus]);
      const existingAutomatic = await PenaltyEntry.findOne({ where: { GrandPrixResultId: race.id, DriverId: entry.DriverId, isAutomatic: true }, transaction });
      if (automaticReason && rule && Number(rule.points) > 0) {
        const date = race.raceDate || new Date().toISOString().slice(0, 10);
        const expiry = new Date(`${date}T12:00:00Z`); expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
        const values = {
          LeagueId: race.LeagueId, DriverId: entry.DriverId, GrandPrixResultId: race.id,
          points: rule.points, reason: automaticReason, comment: `${race.title} · automatisch aus Anwesenheitskontrolle`,
          awardedOn: date, expiresOn: expiry.toISOString().slice(0, 10), isAutomatic: true, isRaceBan: false
        };
        if (existingAutomatic) await existingAutomatic.update(values, { transaction });
        else await PenaltyEntry.create(values, { transaction });
      } else if (existingAutomatic) await existingAutomatic.destroy({ transaction });

      const replacementId = Number(row.ReplacementDriverId || 0);
      if (!replacementId) continue;
      if (!['unabgemeldet', 'zu_spaet_abgemeldet'].includes(attendanceStatus)) throw new Error('Ein Ersatz in Schritt 2 ist nur bei unabgemeldet oder zu spät abgemeldet möglich.');
      if (!allowedReplacementIds.has(replacementId) || usedReplacementIds.has(replacementId)) throw new Error('Der gewählte Ersatzfahrer ist nicht verfügbar oder bereits zugeteilt.');
      const replacement = await Driver.findByPk(replacementId, { transaction });
      if (!replacement) throw new Error('Ersatzfahrer wurde nicht gefunden.');
      usedReplacementIds.add(replacementId);
      const existingTargetReplacement = entries.find((candidate) => candidate.ReplacementForDriverId === entry.DriverId && candidate.DriverId !== replacement.id);
      if (existingTargetReplacement) throw new Error('Für diesen Fahrer ist bereits ein Ersatz eingeteilt. Bitte zuerst Schritt 1 korrigieren.');
      const existingReserve = entries.find((candidate) => candidate.DriverId === replacement.id);
      const replacementValues = {
        ReplacementForDriverId: entry.DriverId, TeamId: entry.TeamId, roleType: 'reserve', status: 'anwesend',
        attendanceStatus: 'anwesend', includeInResults: true, sortOrder: entries.length + usedReplacementIds.size
      };
      if (existingReserve) {
        if (existingReserve.ReplacementForDriverId && existingReserve.ReplacementForDriverId !== entry.DriverId) throw new Error('Der Ersatzfahrer ist bereits einem anderen Fahrer zugeteilt.');
        await existingReserve.update(replacementValues, { transaction });
      } else {
        await F1RaceLineupEntry.create({ GrandPrixResultId: race.id, DriverId: replacement.id, ...replacementValues }, { transaction });
      }
    }
  });
  req.session.flash = { type: 'success', message: 'Anwesenheit, Ergebnisübernahme und automatische Strafpunkte wurden gespeichert.' };
  res.redirect(`/admin/race-weekend/f1?league=${race.LeagueId}&season=${race.SeasonId}&race=${race.id}#ergebnisse`);
};

module.exports.loadF1Data = loadF1Data;
