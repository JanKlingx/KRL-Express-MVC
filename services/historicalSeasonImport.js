const HEADERS = ['runde','datum','strecke_id','fahrer_id','team_id','rolle','session','platz','punkte','status','fl','pole','dotd'];
function parseCsv(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 500000) throw new Error('Die CSV darf höchstens 500 KB groß sein.');
  text = text.replace(/^\uFEFF/, '');
  const delimiter = text.split(/\r?\n/, 1)[0].includes(';') ? ';' : ',';
  const rows = []; let row = [], value = '', quoted = false, closed = false;
  const cell = () => { row.push(value.trim()); value = ''; closed = false; };
  const line = () => { cell(); if (row.some(Boolean)) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i+1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } } else value += c; }
    else if (c === delimiter) cell();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; line(); }
    else if (c === '"' && !value && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error('Ungültige Anführungszeichen in der CSV.'); value += c; }
  }
  if (quoted) throw new Error('Ein Anführungszeichen in der CSV wurde nicht geschlossen.');
  if (value || row.length) line();
  if (rows.length < 2 || rows.length > 5001) throw new Error('Bitte 1 bis 5000 Ergebniszeilen hochladen.');
  if (rows[0].join(';').toLowerCase() !== HEADERS.join(';')) throw new Error(`Die Spalten müssen der Vorlage entsprechen: ${HEADERS.join(';')}`);
  return rows.slice(1).map((values, index) => {
    if (values.length !== HEADERS.length) throw new Error(`Zeile ${index+2}: Falsche Spaltenanzahl.`);
    return { line: index+2, ...Object.fromEntries(HEADERS.map((key, i) => [key, values[i]])) };
  });
}
function validateImport(text, masters) {
  const rows = parseCsv(text); const seen = new Set(), sessions = new Map(), rounds = new Map();
  const ids = key => new Map(masters[key].map(row => [Number(row.id), row]));
  const drivers = ids('drivers'), teams = ids('teams'), tracks = ids('tracks');
  const fail = (row, message) => { throw new Error(`Zeile ${row.line}: ${message}`); };
  for (const row of rows) {
    for (const key of ['runde','strecke_id','fahrer_id','team_id']) { if (!/^\d+$/.test(row[key]) || Number(row[key]) < 1) fail(row, `${key} muss eine positive ganze Zahl sein.`); row[key] = Number(row[key]); }
    if (row.runde > 100) fail(row, 'Es sind höchstens 100 Runden möglich.');
    const driver = drivers.get(row.fahrer_id);
    if (!driver || !(driver.viewF1 || driver.roleFormerF1)) fail(row, 'Fahrer fehlt oder hat weder F1-Sicht noch den Rang Ehemaliger Formel-1-Fahrer.');
    if (!teams.has(row.team_id) || !tracks.has(row.strecke_id)) fail(row, 'Team oder Strecke ist nicht im F1-Stamm vorhanden.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.datum) || !Number.isFinite(Date.parse(row.datum)) || new Date(row.datum).toISOString().slice(0,10) !== row.datum) fail(row, 'Datum muss ein gültiges Datum im Format JJJJ-MM-TT sein.');
    row.rolle = row.rolle.toLowerCase(); row.session = row.session.toLowerCase(); row.status = row.status.toUpperCase();
    if (!['stamm','ersatz'].includes(row.rolle)) fail(row, 'Rolle muss stamm oder ersatz sein.');
    if (!['gp','sprint'].includes(row.session)) fail(row, 'Session muss gp oder sprint sein.');
    if (!['','DNF','DSQ','DNS','DNA','S'].includes(row.status)) fail(row, 'Unbekannter Ergebnisstatus.');
    if (row.status === 'DNA' && row.rolle === 'stamm') fail(row, 'Stammfahrer außerhalb ihrer Einsatzzeit bitte weglassen; Abwesenheit im bestehenden Cockpit als DNS erfassen.');
    if (row.status === 'S' && row.rolle !== 'stamm') fail(row, 'Rennsperre S ist für Stammfahrer vorgesehen.');
    if (row.platz && (!/^\d+$/.test(row.platz) || Number(row.platz) < 1 || Number(row.platz)>100)) fail(row, 'Platz muss leer oder eine Zahl von 1 bis 100 sein.');
    row.platz = row.platz ? Number(row.platz) : null;
    if (!/^-?\d+(?:[.,]\d)?$/.test(row.punkte)) fail(row, 'Punkte müssen eine Zahl mit höchstens einer Nachkommastelle sein.');
    row.punkte = Number(row.punkte.replace(',','.'));
    if (Math.abs(row.punkte)>100000) fail(row, 'Punkte liegen außerhalb des zulässigen Bereichs.');
    if (!row.status && !row.platz) fail(row, 'Für ein gewertetes Ergebnis fehlt der Platz.');
    if (['DNS','DNA','S','DSQ'].includes(row.status) && (row.platz || row.punkte)) fail(row, 'DNS, DNA, S und DSQ dürfen weder Platz noch Punkte haben.');
    for (const key of ['fl','pole','dotd']) { if (!['','0','1'].includes(row[key])) fail(row, `${key}: Bitte 0 oder 1 verwenden.`); row[key] = row[key] === '1'; }
    if (row.session === 'sprint' && (row.fl || row.pole || row.dotd)) fail(row, 'Auszeichnungen werden nur im Hauptrennen vergeben.');
    if (['DNA','DNS','S','DSQ'].includes(row.status) && (row.fl || row.pole || row.dotd)) fail(row, 'Ein Fahrer ohne Wertung kann keine Auszeichnung erhalten.');
    const key = `${row.runde}:${row.session}:${row.fahrer_id}`;
    if (seen.has(key)) fail(row, 'Fahrer ist in dieser Session doppelt enthalten.'); seen.add(key);
    const calendar = rounds.get(row.runde);
    if (calendar && (calendar.datum !== row.datum || calendar.strecke_id !== row.strecke_id)) fail(row, 'Datum und Strecke müssen innerhalb eines Rennwochenendes übereinstimmen.');
    rounds.set(row.runde,row);
    const sessionKey = `${row.runde}:${row.session}`;
    if (!sessions.has(sessionKey)) sessions.set(sessionKey,[]); sessions.get(sessionKey).push(row);
  }
  const maxRound = Math.max(...rounds.keys());
  for (let round=1;round<=maxRound;round++) {
    const gp = sessions.get(`${round}:gp`);
    if (!gp) throw new Error(`Runde ${round}: Hauptrennen fehlt. Runden müssen lückenlos bei 1 beginnen.`);
    const sprint = sessions.get(`${round}:sprint`);
    if (round>1 && rounds.get(round).datum < rounds.get(round-1).datum) throw new Error(`Runde ${round}: Datum liegt vor der vorherigen Runde.`);
    if (sprint && (sprint.length !== gp.length || sprint.some(row => !gp.some(main => main.fahrer_id===row.fahrer_id && main.team_id===row.team_id && main.rolle===row.rolle)))) throw new Error(`Runde ${round}: Sprint und GP benötigen dieselben Fahrer und Teamrollen; Nichtstarter bitte mit DNS erfassen.`);
    if (sprint && sprint.some(row => (row.status==='S') !== (gp.find(main=>main.fahrer_id===row.fahrer_id)?.status==='S'))) throw new Error(`Runde ${round}: Rennsperre S muss für das gesamte Wochenende gelten.`);
    const regularCount = new Map();
    gp.filter(row=>row.rolle==='stamm').forEach(row=>regularCount.set(row.team_id,(regularCount.get(row.team_id)||0)+1));
    if ([...regularCount.values()].some(count=>count>2)) throw new Error(`Runde ${round}: Mehr als zwei Stammfahrer in einem Team.`);
  }
  for (const session of sessions.values()) {
    const places = session.map(row=>row.platz).filter(Boolean);
    if (new Set(places).size !== places.length) fail(session[0], 'Eine Platzierung wurde mehrfach vergeben.');
    for (const award of ['fl','pole','dotd']) if (session.filter(row=>row[award]).length>1) fail(session[0], `${award} wurde mehrfach vergeben.`);
  }
  // Every regular row declares cockpit ownership, even DNS/S. Missing rows end the stint.
  const stints = [];
  for (const driverId of new Set(rows.map(row=>row.fahrer_id))) {
    const appearances = rows.filter(row=>row.session==='gp' && row.fahrer_id===driverId).sort((a,b)=>a.runde-b.runde);
    let current;
    for (const row of appearances) {
      if (!current || current.toRound !== row.runde-1 || current.role !== row.rolle || current.teamId !== row.team_id) {
        current = { driverId, teamId:row.team_id, role:row.rolle, fromRound:row.runde, toRound:row.runde }; stints.push(current);
      } else current.toRound = row.runde;
    }
  }
  return { rows, stints, rounds: [...rounds.values()].sort((a,b)=>a.runde-b.runde), driverCount:new Set(rows.map(row=>row.fahrer_id)).size, teamCount:new Set(rows.map(row=>row.team_id)).size };
}
module.exports = { HEADERS, parseCsv, validateImport };

async function createHistoricalSeason({ name, league, plan, masters, reservePointsForConstructors }, models, transaction) {
  const options = { transaction };
  // Serialize imports for this league; never replace an existing season or alter current ranks.
  await models.League.findByPk(league.id, { ...options, lock: transaction.LOCK.UPDATE });
  const existing = await models.Season.findAll({ where: { leagueType:'f1', scopeSlug:league.slug }, ...options });
  if (existing.some(season=>season.name.trim().toLocaleLowerCase('de')===name.toLocaleLowerCase('de'))) throw new Error('In dieser Liga existiert bereits eine Saison mit diesem Namen.');
  const season = await models.Season.create({ name, leagueType:'f1', scopeSlug:league.slug, status:'historical', calendarMode:'manual', isPublished:true, reservePointsForConstructors, accentColor:league.accentColor },options);
  const teamMap = new Map();
  for (const id of new Set(plan.rows.map(row=>row.team_id))) {
    const team = masters.teams.find(team=>Number(team.id)===id);
    teamMap.set(id, await models.SeasonTeam.create({ SeasonId:season.id, sourceType:'current', sourceId:id, name:team.name, logoPath:team.logoPath, accentColor:team.accentColor },options));
  }
  for (const id of new Set(plan.rows.map(row=>row.fahrer_id))) {
    await models.SeasonDriver.create({ SeasonId:season.id, DriverId:id },options);
    const first = plan.stints.find(stint=>stint.driverId===id);
    await models.SeasonLineupEntry.create({ SeasonId:season.id, DriverId:id, SeasonTeamId:teamMap.get(first.teamId).id, roleType:first.role==='stamm'?'regular':'reserve' },options);
  }
  for (const stint of plan.stints) await models.SeasonDriverStint.create({ SeasonId:season.id, DriverId:stint.driverId, SeasonTeamId:teamMap.get(stint.teamId).id, roleType:stint.role==='stamm'?'regular':'reserve', fromRound:stint.fromRound, toRound:stint.toRound, endReason:stint.toRound<plan.rounds.length?'other':null },options);
  for (const weekend of plan.rounds) {
    const track = masters.tracks.find(track=>Number(track.id)===weekend.strecke_id);
    let main;
    for (const session of ['gp','sprint']) {
      const entries = plan.rows.filter(row=>row.runde===weekend.runde && row.session===session);
      if (!entries.length) continue;
      const race = await models.GrandPrixResult.create({ SeasonId:season.id, LeagueId:league.id, season:name, title:track.country, circuit:track.name, raceDate:weekend.datum, raceType:session==='gp'?'main':'sprint', sortOrder:weekend.runde, discipline:'f1', pointsMode:'manual', isHistorical:true },options);
      if (session==='gp') main = race;
      for (const row of entries) {
        const driver = masters.drivers.find(driver=>Number(driver.id)===row.fahrer_id);
        const team = teamMap.get(row.team_id);
        await models.GrandPrixResultEntry.create({ GrandPrixResultId:race.id, DriverId:row.fahrer_id, TeamId:row.team_id, driverName:driver.name, teamName:team.name, position:row.platz, points:row.punkte, status:row.status, fastestLap:row.fl, polePosition:row.pole, driverOfTheDay:row.dotd },options);
        if (session==='gp') await models.F1RaceLineupEntry.create({ GrandPrixResultId:race.id, DriverId:row.fahrer_id, TeamId:row.team_id, SeasonTeamId:team.id, roleType:row.rolle==='stamm'?'regular':'reserve', status:row.status==='S'?'rennsperre':row.status==='DNS'?'abgemeldet':'anwesend', includeInResults:!['DNA','DNS','S'].includes(row.status) },options);
      }
    }
    await models.RaceEvent.create({ SeasonId:season.id, LeagueId:league.id, GrandPrixResultId:main.id, F1TrackId:track.id, title:track.country, circuit:track.name, startsAt:new Date(`${weekend.datum}T12:00:00Z`), sortOrder:weekend.runde, isCompleted:true, hasLocalOverride:true },options);
  }
  return season;
}
module.exports.createHistoricalSeason = createHistoricalSeason;
