const { Op } = require('sequelize');
const models = require('../models');
const central = { LeagueId: null, discipline: 'f1' };

function logosFor(team) {
  const logos = Array.isArray(team?.logoVariants)
    ? team.logoVariants.filter(logo => logo && typeof logo.path === 'string').map(logo => ({ ...logo }))
    : [];
  if (team?.logoPath && !logos.some(logo => logo.path === team.logoPath)) {
    logos.unshift({ path: team.logoPath, label: 'Standardlogo' });
  }
  return [...new Map(logos.map(logo => [logo.path, logo])).values()];
}

function addLogo(team, path, label) {
  const logos = logosFor(team);
  if (path && !logos.some(logo => logo.path === path)) {
    logos.push({ path, label: String(label || `Logo ${logos.length + 1}`).trim().slice(0, 100) });
  }
  return logos;
}

function descendantIds(teams, id) {
  const ids = new Set([Number(id)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const team of teams) {
      if (ids.has(Number(team.AggregationTeamId)) && !ids.has(Number(team.id))) {
        ids.add(Number(team.id));
        changed = true;
      }
    }
  }
  return [...ids];
}

function validateGraph(teams, teamId, targetId) {
  if (targetId == null || targetId === '') return null;
  const id = Number(targetId);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error('Bitte ein gültiges Formel-1-Team zur Punktesammlung wählen.');
  }
  const byId = new Map(teams.map(team => [Number(team.id), team]));
  const seen = new Set(teamId ? [Number(teamId)] : []);
  let cursor = id;
  while (cursor) {
    if (seen.has(cursor)) {
      throw new Error('Die Punktezuordnung darf weder auf sich selbst noch im Kreis verweisen.');
    }
    seen.add(cursor);
    const team = byId.get(cursor);
    if (!team) throw new Error('Das zugeordnete Team muss ein Formel-1-Team sein.');
    cursor = Number(team.AggregationTeamId) || null;
  }
  return id;
}

async function validateAggregation(teamId, targetId) {
  if (targetId == null || targetId === '') return null;
  return validateGraph(await models.Team.findAll({ where: central }), teamId, targetId);
}

async function saveTeam(values, entry) {
  return models.sequelize.transaction(async transaction => {
    // Serialize graph changes so concurrent updates cannot introduce a cycle.
    const teams = await models.Team.findAll({
      where: central, order: [['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE,
    });
    values.AggregationTeamId = validateGraph(teams, entry?.id, values.AggregationTeamId);
    return entry ? entry.update(values, { transaction }) : models.Team.create(values, { transaction });
  });
}

async function totalsFor(team) {
  const teams = await models.Team.findAll({ where: central });
  const ids = descendantIds(teams, team.id);
  const members = teams.filter(candidate => ids.includes(Number(candidate.id)));
  const entries = await models.GrandPrixResultEntry.findAll({
    where: { [Op.or]: [
      { TeamId: { [Op.in]: ids } },
      { TeamId: null, teamName: { [Op.in]: members.map(member => member.name) } },
    ] },
    attributes: ['points'],
    include: [{ association: 'grandPrixResult', where: { discipline: 'f1' }, attributes: [] }],
  });
  return {
    totalPoints: entries.reduce((sum, entry) => sum + Number(entry.points || 0), 0),
    aggregationMembers: members.filter(member => Number(member.id) !== Number(team.id)).map(member => member.name).join(', ') || 'Keine',
  };
}

async function identityFor(source, transaction) {
  if (source.sourceType === 'current') return Number(source.sourceId) || null;
  const profile = await models.F1CarProfile.findByPk(source.sourceId, { transaction });
  return Number(profile?.UnifiedTeamId || profile?.BaseTeamId) || null;
}

function chooseLogo(team, selection, fallback) {
  if (selection == null || selection === '') return fallback === undefined ? team.logoPath || null : fallback;
  if (selection === 'none') return null;
  if (fallback && selection === fallback) return fallback;
  const path = selection === 'default' ? team.logoPath : selection;
  if (path && !logosFor(team).some(logo => logo.path === path)) {
    throw new Error('Das gewählte Logo gehört nicht zu diesem Formel-1-Team.');
  }
  return path || null;
}

// Keep legacy profile IDs as aliases: season-team IDs, lineups and stored grids stay valid.
async function migrateLegacyTeams() {
  await models.sequelize.transaction(async transaction => {
    const profiles = await models.F1CarProfile.findAll({
      transaction, lock: transaction.LOCK.UPDATE, order: [['id', 'ASC']],
    });
    for (const profile of profiles) {
      if (profile.UnifiedTeamId) continue;
      let team = await models.Team.findOne({ where: { ...central, name: profile.name }, transaction });
      if (!team) {
        team = await models.Team.create({
          ...central,
          name: profile.name,
          accentColor: profile.accentColor,
          logoPath: profile.logoPath,
          logoVariants: addLogo(null, profile.logoPath, profile.seasonLabel || 'Bisheriges Logo'),
          AggregationTeamId: profile.BaseTeamId || null,
          sortOrder: profile.sortOrder || 0,
        }, { transaction });
      } else {
        await team.update({ logoVariants: addLogo(team, profile.logoPath, profile.seasonLabel || 'Bisheriges Logo') }, { transaction });
      }
      await profile.update({ UnifiedTeamId: team.id }, { transaction });

      // Prior entries stored the aggregation parent. Keep race points and names unchanged.
      const entries = await models.GrandPrixResultEntry.findAll({
        where: { teamName: profile.name },
        include: [{ association: 'grandPrixResult', where: { discipline: 'f1' }, required: true }],
        transaction,
      });
      for (const entry of entries) {
        if (entry.TeamId && Number(entry.TeamId) !== Number(profile.BaseTeamId) && Number(entry.TeamId) !== Number(team.id)) continue;
        await entry.update({ TeamId: team.id }, { transaction });
        await models.F1RaceLineupEntry.update({ TeamId: team.id }, {
          where: { GrandPrixResultId: entry.GrandPrixResultId, DriverId: entry.DriverId }, transaction,
        });
      }
      const seasonTeams = await models.SeasonTeam.findAll({
        where: { sourceType: 'historical', sourceId: profile.id }, transaction,
      });
      for (const snapshot of seasonTeams) {
        await models.F1RaceLineupEntry.update({ TeamId: team.id }, { where: { SeasonTeamId: snapshot.id }, transaction });
        if (snapshot.logoPath) {
          await team.update({ logoVariants: addLogo(team, snapshot.logoPath, 'Saisonlogo') }, { transaction });
        }
      }
    }
  });
}

module.exports = { central, logosFor, addLogo, descendantIds, validateGraph, validateAggregation, saveTeam, totalsFor, identityFor, chooseLogo, migrateLegacyTeams };
