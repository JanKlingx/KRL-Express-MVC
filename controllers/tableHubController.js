const { Op } = require('sequelize');
const { League, Season, GrandPrixResult } = require('../models');

function linksFor(league, season) {
  const seasonQuery = `?season=${season.id}`;
  if (league.type === 'f1') return {
    editor: `/admin/race-editor?league=${league.id}&season=${season.id}`,
    frontend: `/f1/${league.slug}${seasonQuery}`,
    downloads: [
      ['Fahrer-WM', `/f1/${league.slug}/download/fahrer-wm.csv${seasonQuery}`],
      ['Team-WM', `/f1/${league.slug}/download/team-wm.csv${seasonQuery}`],
      ['GP-Results', `/f1/${league.slug}/download/gp-results.csv${seasonQuery}`]
    ]
  };
  if (league.type === 'lmu') return {
    editor: `/admin/season-progress/lmu?season=${season.id}`,
    frontend: `/lmu${seasonQuery}`,
    downloads: [['Fahrer-WM', `/lmu/download/wm.csv${seasonQuery}`], ['Results', `/lmu/download/results.csv${seasonQuery}`]]
  };
  return {
    editor: `/admin/season-progress/wdl?season=${season.id}`,
    frontend: `/wettkampf-der-ligen${seasonQuery}`,
    downloads: [['Standings', `/wettkampf-der-ligen/download/standings.csv${seasonQuery}`], ['Results', `/wettkampf-der-ligen/download/results.csv${seasonQuery}`]]
  };
}

exports.show = async (req, res) => {
  const leagues = await League.findAll({ where: { type: { [Op.in]: ['f1', 'lmu', 'competition'] } }, order: [['type', 'ASC'], ['sortOrder', 'ASC'], ['id', 'ASC']] });
  const sections = [];
  for (const league of leagues) {
    const leagueType = league.type === 'competition' ? 'wdl' : league.type;
    const seasons = await Season.findAll({ where: { leagueType, scopeSlug: league.slug }, order: [['status', 'ASC'], ['sortOrder', 'DESC'], ['id', 'DESC']] });
    const seasonRows = [];
    for (const season of seasons) {
      const races = await GrandPrixResult.count({ where: { SeasonId: season.id, raceType: 'main' } });
      seasonRows.push({ season, races, ...linksFor(league, season) });
    }
    sections.push({ league, seasons: seasonRows });
  }
  res.render('admin/table-hub', { title: 'Tabellen-Hub', sections });
};

module.exports.linksFor = linksFor;
