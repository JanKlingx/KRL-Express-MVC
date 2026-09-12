// Compatibility for old calendar entries; test days must never become GP results.
async function linkLegacyF1Events({ RaceEvent, League, GrandPrixResult }) {
  const events = await RaceEvent.findAll({
    where: { GrandPrixResultId: null },
    include: [{ model: League, as: 'league', where: { type: 'f1' } }]
  });
  for (const event of events) {
    if (event.isTestDay) continue;
    const [grandPrix] = await GrandPrixResult.findOrCreate({
      where: { LeagueId: event.LeagueId, season: event.league.currentSeason, title: event.title },
      defaults: { LeagueId: event.LeagueId, season: event.league.currentSeason, title: event.title,
        circuit: event.circuit, raceDate: event.startsAt, sortOrder: event.sortOrder }
    });
    await event.update({ GrandPrixResultId: grandPrix.id });
  }
}
module.exports = { linkLegacyF1Events };
