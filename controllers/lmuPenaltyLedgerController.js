const ledger = require('./penaltyLedgerController').forDiscipline('lmu');
const m = require('../models');
module.exports = ledger;
ledger.publicShow = async (req, res) => {
  const leagues = await m.League.findAll({ where: { type: 'lmu' }, order: [['sortOrder', 'ASC'], ['id', 'ASC']] });
  const all = await Promise.all(leagues.map(league => ledger.buildLeagueLedger(league, league.slug === req.query.liga ? req.query.kalender : null)));
  const visible = all.filter(row => row.setting?.publicVisible !== false);
  const selected = visible.find(row => row.league.slug === req.query.liga) || visible[0] || null;
  const global = await ledger.buildGlobalLedgers(visible, req.query.kalender);
  res.render('penalty-ledger-public', {
    title: 'LMU Strafkartei', discipline: 'lmu', publicPath: '/lmu/strafkartei',
    viewMode: ['ersatzfahrer', 'ehemalige'].includes(req.query.ansicht) ? req.query.ansicht : 'liga',
    league: selected?.league || null, selectedSeason: selected?.activeSeason || null,
    seasons: selected?.activeSeason ? [selected.activeSeason] : [], selectedLeagueSlug: selected?.league.slug || '',
    leagueTabs: visible.map(row => ({ slug: row.league.slug, label: row.league.name })),
    ledger: selected ? { threshold: selected.threshold, rounds: selected.rounds, rows: selected.groups.regular } : { threshold: 12, rounds: [], rows: [] },
    leagueCalendars: selected?.calendars || [], selectedLeagueCalendar: selected?.selectedCalendar || null, leagueCalendarWarning: selected?.calendarWarning || null,
    reserveLedger: global.reserve, formerLedger: global.former, globalCalendars: global.calendars, selectedGlobalCalendar: global.selectedCalendar,
    communityAccent: '#6ef2f2', communityLogoPath: '/images/krl-placeholder.svg',
  });
};
