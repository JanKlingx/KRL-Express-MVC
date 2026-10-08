const { Op } = require('sequelize');
const m = require('../models');
const { isRoundInStint, validateRegularStintSet } = require('./seasonDriverStints');
const { parseBerlinDateTime } = require('./calendarTime');
const { createHash } = require('node:crypto');
const plain = row => row?.toJSON ? row.toJSON() : row;
const lmuWhere = { [Op.or]: [{ viewLmu: true }, { roleLmuRegular: true }, { roleLmuReserve: true }] };
function number(value, label, min = 1) { const n = Number(value); if (!Number.isInteger(n) || n < min) throw new Error(`${label}: Bitte eine ganze Zahl ab ${min} eingeben.`); return n; }
function color(value) { if (!/^#[0-9a-f]{6}$/i.test(value || '')) throw new Error('Bitte eine gültige Farbe wählen.'); return value; }
function roundsFrom(body) {
  const rows = Object.values(body || {}).filter(row => String(row.title || row.circuit || '').trim());
  if (!rows.length || rows.length > 100) throw new Error('Bitte 1 bis 100 Termine eintragen.');
  return rows.map((row, i) => {
    const title = String(row.title || '').trim(), circuit = String(row.circuit || '').trim();
    if (!title || !circuit || title.length > 255 || circuit.length > 255) throw new Error(`Termin ${i + 1}: Titel und Strecke sind erforderlich (max. 255 Zeichen).`);
    const startsAt = parseBerlinDateTime(row.startsAt);
    if (!startsAt || Number.isNaN(new Date(startsAt).getTime())) throw new Error(`Termin ${i + 1}: Datum und Uhrzeit prüfen.`);
    return { title, circuit, startsAt: new Date(startsAt).toISOString(), isTestDay: row.isTestDay === 'on' || row.isTestDay === true, sortOrder: i + 1 };
  });
}
function points(scheme, entry, testDay = false) {
  if (testDay || entry.status) return 0;
  const allocation = (scheme.allocations || []).find(row => row.raceType === 'main' && Number(row.position) === Number(entry.position));
  return Number(allocation?.points || 0) + (entry.fastestLap && scheme.fastestLapEnabled ? Number(scheme.fastestLapPoints || 0) : 0) + (entry.polePosition && scheme.polePositionEnabled ? Number(scheme.polePositionPoints || 0) : 0);
}
function revision(race, entries, results = []) {
  return createHash('sha256').update(JSON.stringify([race.updatedAt, entries.map(plain).sort((a,b)=>a.id-b.id), results.map(plain).sort((a,b)=>a.id-b.id)])).digest('hex');
}
async function seasonById(id, transaction, lock = false) {
  const season = await m.Season.findByPk(id, { transaction, ...(lock ? { lock: transaction.LOCK.UPDATE } : {}) });
  if (!season || season.leagueType !== 'lmu') throw new Error('LMU-Saison nicht gefunden.');
  return season;
}
async function nextRound(seasonId, transaction) {
  const races = await m.GrandPrixResult.findAll({ where: { SeasonId: seasonId, discipline: 'lmu' }, include: [{ association: 'entries' }], transaction });
  return Math.max(0, ...races.filter(r=>r.entries.length).map(r=>Number(r.sortOrder))) + 1;
}
async function syncRanks(transaction) {
  const seasons = await m.Season.findAll({ where: { leagueType: 'lmu', status: 'active' }, transaction });
  const regularIds = new Set(), retiredIds = new Set();
  for (const season of seasons) {
    const stints = await m.SeasonDriverStint.findAll({ where: { SeasonId: season.id }, transaction });
    const round = await nextRound(season.id, transaction);
    for(const id of new Set(stints.map(row=>row.DriverId))){const latest=stints.filter(row=>row.DriverId===id&&row.fromRound<=round).sort((a,b)=>b.fromRound-a.fromRound)[0];if(latest?.endReason==='left'&&latest.toRound<round)retiredIds.add(Number(id));}
    stints.filter(row=>row.roleType==='regular'&&isRoundInStint(row,round)).forEach(row=>regularIds.add(Number(row.DriverId)));
    if (!season.lmuManaged) {
      const league = await m.League.findOne({ where:{ type:'lmu',slug:season.scopeSlug }, transaction });
      const rosters = league ? await m.TeamRoster.findAll({where:{LeagueId:league.id,discipline:'lmu'},include:[{association:'assignments'}],transaction}) : [];
      rosters.flatMap(r=>r.assignments).filter(r=>r.roleName!=='Ersatzfahrer').forEach(r=>regularIds.add(Number(r.DriverId)));
    }
  }
  const drivers = await m.Driver.findAll({ where: { [Op.or]: [lmuWhere, { roleFormerLmu: true }, { viewFormerLmu: true }] }, transaction });
  for (const driver of drivers) {
    const regular = regularIds.has(Number(driver.id));
    const former = !regular && Boolean(retiredIds.has(Number(driver.id)) || driver.roleFormerLmu || driver.viewFormerLmu && !driver.viewLmu);
    await driver.update({ roleLmuRegular: regular, roleLmuReserve: !regular && !former, roleFormerLmu: former, ...(former ? {viewLmu:false,viewFormerLmu:true} : {}) }, { transaction });
  }
}
// Legacy results remain untouched. Create season-owned teams and dated driver periods.
// Past rounds come from their saved entries/plans; only future active rounds use today's roster.
async function ensureStructure(seasonId) {
  await m.sequelize.transaction(async transaction => {
    const season = await seasonById(seasonId, transaction, true);
    if (season.lmuManaged) return;
    const league = await m.League.findOne({ where: { type: 'lmu', slug: season.scopeSlug }, transaction });
    if (!league) throw new Error('Die LMU-Liga dieser Saison fehlt.');
    const races = await m.GrandPrixResult.findAll({ where: { SeasonId: season.id, discipline: 'lmu', raceType: 'main' }, include: [{ association: 'entries' }, { association: 'lineupEntries' }], order: [['sortOrder', 'ASC']], transaction });
    const existing = await m.SeasonDriverStint.findAll({ where: { SeasonId: season.id }, transaction });
    if (!existing.length) {
      const catalog = await m.Team.findAll({ where: { discipline: 'lmu' }, transaction });
      const teamMap = new Map();
      async function teamFor(id, name) {
        if (!id) return null;
        if (!teamMap.has(Number(id))) {
          const source = catalog.find(t => t.id === Number(id));
          const [team] = await m.SeasonTeam.findOrCreate({ where: { SeasonId: season.id, sourceType: 'lmu', sourceId: id }, defaults: { name: name || source?.name || 'LMU-Team', logoPath: source?.logoPath, accentColor: source?.accentColor || '#6ef2f2' }, transaction });
          teamMap.set(Number(id), team);
        }
        return teamMap.get(Number(id));
      }
      const periods = new Map();
      async function addPeriod(driverId, roleType, team, fromRound, toRound) {
        const rows = periods.get(Number(driverId)) || [];
        const previous = rows.at(-1);
        if (previous && previous.roleType === roleType && previous.SeasonTeamId === (team?.id || null) && previous.toRound + 1 === fromRound) previous.toRound = toRound;
        else rows.push({ SeasonId: season.id, DriverId: driverId, roleType, SeasonTeamId: team?.id || null, fromRound, toRound });
        periods.set(Number(driverId), rows);
      }
      for (const race of races.filter(r => r.entries.length || r.lineupEntries.length)) {
        const driverIds = new Set([...race.entries, ...race.lineupEntries].map(e => e.DriverId).filter(Boolean));
        for (const DriverId of driverIds) {
          const result = race.entries.find(e => e.DriverId === DriverId);
          const plan = race.lineupEntries.find(e => e.DriverId === DriverId);
          if (result?.status === 'DNA') continue;
          const team = await teamFor(plan?.TeamId || result?.TeamId, result?.teamName);
          const roleType = plan?.roleType || (team ? 'regular' : 'reserve');
          await addPeriod(DriverId, roleType, team, Number(race.sortOrder), Number(race.sortOrder));
        }
      }
      if (season.status === 'active') {
        const start = Math.max(0, ...races.filter(r => r.entries.length || r.lineupEntries.length).map(r => Number(r.sortOrder))) + 1;
        const rosters = await m.TeamRoster.findAll({ where: { LeagueId: league.id, discipline: 'lmu' }, include: [{ association: 'team' }, { association: 'assignments' }], transaction });
        const used = new Set();
        for (const roster of rosters) {
          if (!roster.team) continue;
          const team = await teamFor(roster.team.id, roster.team.name);
          for (const assignment of roster.assignments) {
            if (used.has(assignment.DriverId)) continue;
            used.add(assignment.DriverId);
            const roleType = assignment.roleName === 'Ersatzfahrer' ? 'reserve' : 'regular';
            await addPeriod(assignment.DriverId, roleType, roleType === 'regular' ? team : null, start, null);
          }
        }
      }
      for (const [DriverId, rows] of periods) {
        await m.SeasonDriver.findOrCreate({ where: { SeasonId: season.id, DriverId }, transaction });
        const last = rows.at(-1);
        await m.SeasonLineupEntry.findOrCreate({ where: { SeasonId: season.id, DriverId }, defaults: { roleType: last.roleType, SeasonTeamId: last.SeasonTeamId }, transaction });
        for (const row of rows) await m.SeasonDriverStint.create(row, { transaction });
      }
    }
    await season.update({ lmuManaged: true }, { transaction });
    await syncRanks(transaction);
  });
}
async function createSeason(body) {
  return m.sequelize.transaction(async transaction => {
    const league = await m.League.findByPk(body.LeagueId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!league || league.type !== 'lmu') throw new Error('Bitte eine LMU-Liga auswählen.');
    const name = String(body.name || '').trim(); if (!name || name.length > 255) throw new Error('Saisonname fehlt oder ist zu lang.');
    if (await m.Season.findOne({ where:{leagueType:'lmu',scopeSlug:league.slug,name},transaction })) throw new Error('Diese Saison existiert bereits.');
    const [calendar, game, scheme, teams, drivers] = await Promise.all([
      m.LmuCalendar.findByPk(body.LmuCalendarId, { transaction }), m.LmuGame.findByPk(body.LmuGameId, { transaction }),
      m.PointsScheme.findByPk(body.PointsSchemeId, { transaction }),
      m.Team.findAll({ where:{discipline:'lmu',LeagueId:null},transaction }), m.Driver.findAll({ where:lmuWhere,transaction })
    ]);
    if (!calendar?.rounds?.length || !game || !scheme || scheme.discipline !== 'lmu') throw new Error('Kalender, LMU-Spiel und LMU-Punktesystem sind erforderlich.');
    const ids = [...new Set([].concat(body.teamIds || []).map(Number))];
    if (!ids.length || ids.some(id=>!teams.some(t=>t.id===id))) throw new Error('Bitte mindestens ein gültiges LMU-Team auswählen.');
    const assignments = Object.entries(body.assignments || {}).map(([key,value])=>({DriverId:Number(key.replace(/^d/,'')),TeamId:Number(value.TeamId)||null}));
    if (assignments.some(a=>!drivers.some(d=>d.id===a.DriverId) || a.TeamId && !ids.includes(a.TeamId))) throw new Error('Die Fahrer-/Teamzuordnung passt nicht zu dieser Saison.');
    for (const id of ids) if (assignments.filter(a=>a.TeamId===id).length>3) throw new Error('Pro LMU-Team sind maximal drei Stammfahrer möglich.');
    const status = body.status === 'historical' ? 'historical' : 'active';
    const season = await m.Season.create({ name, scopeSlug:league.slug,leagueType:'lmu',status,isPublished:body.isPublished==='on',lmuManaged:true,calendarMode:'manual',LmuCalendarId:calendar.id,LmuGameId:game.id,gameName:game.name,PointsSchemeId:scheme.id,accentColor:color(body.accentColor),reservePointsForConstructors:body.reservePointsForConstructors==='on' },{transaction});
    const byId = new Map();
    for (const id of ids) { const team=teams.find(t=>t.id===id);byId.set(id,await m.SeasonTeam.create({SeasonId:season.id,sourceType:'lmu',sourceId:id,name:team.name,logoPath:team.logoPath,accentColor:team.accentColor},{transaction})); }
    for (const assignment of assignments) {
      const roleType=assignment.TeamId?'regular':'reserve',SeasonTeamId=byId.get(assignment.TeamId)?.id||null;
      await m.SeasonDriver.create({SeasonId:season.id,DriverId:assignment.DriverId},{transaction});
      await m.SeasonLineupEntry.create({SeasonId:season.id,DriverId:assignment.DriverId,SeasonTeamId,roleType},{transaction});
      await m.SeasonDriverStint.create({SeasonId:season.id,DriverId:assignment.DriverId,SeasonTeamId,roleType,fromRound:1},{transaction});
    }
    let round=0;
    for (const item of calendar.rounds) {
      const race = item.isTestDay ? null : await m.GrandPrixResult.create({SeasonId:season.id,LeagueId:league.id,discipline:'lmu',raceType:'main',title:item.title,circuit:item.circuit,raceDate:require('./raceWeekend').berlinDate(new Date(item.startsAt)),season:season.name,sortOrder:++round,pointsMode:'database',isHistorical:status==='historical'},{transaction});
      await m.RaceEvent.create({...item,SeasonId:season.id,LeagueId:league.id,GrandPrixResultId:race?.id||null,isPublished:status==='active'&&season.isPublished},{transaction});
    }
    await activate(season,league,transaction);await syncRanks(transaction);
    return season;
  });
}
async function activate(season, league, transaction) {
  if (season.status === 'active') {
    const others=await m.Season.findAll({where:{leagueType:'lmu',scopeSlug:league.slug,status:'active',id:{[Op.ne]:season.id}},transaction});
    for (const other of others) { await other.update({status:'historical'},{transaction});await m.GrandPrixResult.update({isHistorical:true},{where:{SeasonId:other.id},transaction});await m.RaceEvent.update({isPublished:false},{where:{SeasonId:other.id},transaction}); }
    await league.update({currentSeason:season.name},{transaction});
  }
  await m.GrandPrixResult.update({isHistorical:season.status==='historical',season:season.name},{where:{SeasonId:season.id,discipline:'lmu'},transaction});
  await m.RaceEvent.update({isPublished:season.status==='active'&&season.isPublished},{where:{SeasonId:season.id,LeagueId:league.id},transaction});
}
async function changeDriver(seasonId, body) {
  return m.sequelize.transaction(async transaction=>{
    const season=await seasonById(seasonId,transaction,true),round=number(body.fromRound,'Ab Runde');
    if (round < await nextRound(season.id,transaction)) throw new Error('Der Wechsel muss nach dem letzten gespeicherten Rennen liegen.');
    const race=await m.GrandPrixResult.findOne({where:{SeasonId:season.id,discipline:'lmu',sortOrder:round},transaction});
    if(!race)throw new Error('Diese Runde gibt es in der Saison nicht.');
    const driver=await m.Driver.findByPk(body.DriverId,{transaction});if(!driver||!(driver.viewLmu||driver.roleLmuRegular||driver.roleLmuReserve))throw new Error('Bitte einen LMU-Fahrer auswählen.');
    const stints=await m.SeasonDriverStint.findAll({where:{SeasonId:season.id},transaction});
    const driverStints=stints.filter(s=>s.DriverId===driver.id&&isRoundInStint(s,round));
    if(stints.some(s=>s.DriverId===driver.id&&s.fromRound>round))throw new Error('Für diesen Fahrer gibt es bereits einen späteren Wechsel. Bitte diesen zuerst prüfen.');
    const team=body.retire!=='on'&&body.SeasonTeamId?await m.SeasonTeam.findOne({where:{id:body.SeasonTeamId,SeasonId:season.id},transaction}):null;
    if(body.retire!=='on'&&body.SeasonTeamId&&!team)throw new Error('Das Team gehört nicht zur Saison.');
    const roleType=team?'regular':'reserve';
    const candidate={SeasonId:season.id,DriverId:driver.id,SeasonTeamId:team?.id||null,roleType,fromRound:round,toRound:null};
    validateRegularStintSet([...stints.filter(s=>!driverStints.includes(s)).map(plain),candidate],3);
    for(const stint of driverStints){if(stint.fromRound===round)await stint.destroy({transaction});else await stint.update({toRound:round-1,endReason:body.retire==='on'?'left':team?'team_change':'demoted'},{transaction});}
    if(body.retire!=='on')await m.SeasonDriverStint.create(candidate,{transaction});
    await m.SeasonDriver.findOrCreate({where:{SeasonId:season.id,DriverId:driver.id},transaction});
    const [lineup]=await m.SeasonLineupEntry.findOrCreate({where:{SeasonId:season.id,DriverId:driver.id},defaults:{roleType,SeasonTeamId:team?.id||null},transaction});
    await lineup.update({roleType,SeasonTeamId:team?.id||null},{transaction});
    if(body.retire==='on'&&season.status==='active'&&round===await nextRound(season.id,transaction))await driver.update({viewLmu:false,viewFormerLmu:true,roleFormerLmu:true,roleLmuRegular:false,roleLmuReserve:false},{transaction});
    const future=await m.GrandPrixResult.findAll({where:{SeasonId:season.id,discipline:'lmu',sortOrder:{[Op.gte]:round}},include:[{association:'entries'}],transaction});
    if(future.some(r=>r.entries.length))throw new Error('Nach diesem Wechsel liegen bereits Ergebnisse vor.');
    // Future plans are invalidated as a whole so replacement chains cannot reference a released cockpit.
    await m.F1RaceLineupEntry.destroy({where:{GrandPrixResultId:{[Op.in]:future.map(r=>r.id)}},transaction});
    await syncRanks(transaction);
  });
}
module.exports={plain,lmuWhere,number,color,roundsFrom,points,revision,seasonById,nextRound,syncRanks,ensureStructure,createSeason,activate,changeDriver};
