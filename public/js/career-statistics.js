(() => {
  const root = document.querySelector('[data-career-statistics]');
  if (!root) return;
  const drivers = JSON.parse(document.getElementById('career-data').textContent);
  const get = name => root.querySelector(`[data-career-${name}]`);
  const isTeam = root.dataset.careerEntity === 'team';
  const entity = isTeam ? 'Team' : 'Fahrer';
  const plural = isTeam ? 'Teams' : 'Fahrer';
  const aggregate = () => isTeam && Boolean(get('aggregate')?.checked);
  const selected = new Set();
  let focused = Number(new URLSearchParams(window.location.search).get(isTeam ? 'team' : 'driver')) || null;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const scopes = JSON.parse(document.getElementById('career-scopes')?.textContent || '[]');
  const labels = { points: 'Punkte', starts: 'Starts', wins: 'Siege', podium2: '2. Plätze', podium3: '3. Plätze', poles: 'Polepositions', fastestLaps: 'Schnellste Runden', driverOfTheDays: 'Driver of the Day', winRate: 'Siegesquote' };
  if (isTeam) { labels.points = 'Ergebnispunkte'; labels.starts = 'Fahrerstarts'; }
  if (!isTeam) { labels.averagePosition = 'Ø Endposition'; labels.averagePoints = 'Ø Punkte / Start'; }
  const fmt = value => value == null ? '–' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value);
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
  const options = (name, values) => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'de', { numeric: true })).forEach(value => { const option = el('option', value); option.value = value; get(name).append(option); });
  const seasons = [...scopes,...drivers.flatMap(driver => driver.seasons)];
  options('league', seasons.map(row => row.league));
  options('season', seasons.map(row => row.season));
  function filteredSeasons(driver, withAssignments = aggregate()) {
    return (withAssignments ? driver.aggregatedSeasons : driver.seasons).filter(row => (get('discipline').value === 'all' || row.discipline === get('discipline').value) && (get('league').value === 'all' || row.league === get('league').value) && (get('season').value === 'all' || row.season === get('season').value));
  }
  function total(rows) {
    const stats = Object.fromEntries([...Object.keys(labels), 'positionSum', 'classifiedFinishes', 'mainRacePoints'].map(key => [key, 0]));
    rows.forEach(row => Object.keys(stats).filter(key => !['winRate','averagePosition','averagePoints'].includes(key)).forEach(key => { stats[key] += Number(row[key] || 0); }));
    stats.averagePosition = stats.classifiedFinishes ? stats.positionSum / stats.classifiedFinishes : null;
    stats.averagePoints = stats.starts ? stats.mainRacePoints / stats.starts : null;
    stats.winRate = stats.starts ? stats.wins / stats.starts * 100 : 0;
    return stats;
  }
  function metrics(stats, animate = false) {
    const list = el('dl', null, 'career-metrics');
    Object.entries(labels).forEach(([key, label]) => {
      const item=el('div');const number=el('dd',fmt(stats[key])+(key==='winRate'?' %':''));
      if(['wins','podium2','podium3'].includes(key)){const image=el('img');image.src=`/images/stats/${key}.svg`;image.alt='';image.className='career-award';item.append(image);}
      item.append(el('dt',label),number);list.append(item);
      if(animate&&stats[key]!=null&&!key.startsWith('average')&&!reduceMotion&&window.requestAnimationFrame){const start=performance.now();const tick=now=>{if(!number.isConnected)return;const progress=Math.min(1,(now-start)/850);number.textContent=fmt(key==='winRate'?stats[key]*progress:Math.round(stats[key]*progress))+(key==='winRate'?' %':'');if(progress<1)requestAnimationFrame(tick);};requestAnimationFrame(tick);}
    });
    return list;
  }
  function aliasList(driver) {
    const section=el('section',null,'career-aliases');section.append(el('h3','Aliase / frühere Namen'));
    if(driver.aliases?.length){const list=el('ul');driver.aliases.forEach(alias=>list.append(el('li',alias)));section.append(list);}else section.append(el('p','Keine weiteren Aliase hinterlegt.','career-note'));
    return section;
  }
  function render() {
    const metric = get('metric').value;
    const all = drivers.map(driver => { const rows = filteredSeasons(driver); return { ...driver, rows, stats: total(rows) }; });
    const query = get('search').value.trim().toLocaleLowerCase('de');
    const visible = all.filter(driver => (get('discipline').value === 'all' && get('league').value === 'all' && get('season').value === 'all' || driver.rows.length || isTeam && get('league').value === 'all' && get('season').value === 'all') && [driver.name,...(driver.aliases||[])].some(name=>name.toLocaleLowerCase('de').includes(query))).sort((a, b) => (metric === 'averagePosition' ? (a.stats[metric] ?? Infinity) - (b.stats[metric] ?? Infinity) : (b.stats[metric] ?? -Infinity) - (a.stats[metric] ?? -Infinity)) || a.name.localeCompare(b.name, 'de'));
    get('count').textContent = `${visible.length} ${plural} · ${selected.size}/3 im Vergleich`;
    get('summary').replaceChildren();
    const sourceIds = new Set(visible.flatMap(driver => [driver.id, ...(aggregate() ? driver.includedTeamIds || [] : [])]));
    const sum = total(isTeam ? drivers.filter(driver => sourceIds.has(driver.id)).flatMap(driver => filteredSeasons(driver, false)) : visible.flatMap(driver => driver.rows));
    [[plural, visible.length], [labels.starts, sum.starts], ['Polepositions', sum.poles], ['Schnellste Runden', sum.fastestLaps]].forEach(([label, value]) => { const item = el('div'); item.append(el('strong', fmt(value)), el('span', label)); get('summary').append(item); });
    get('drivers').replaceChildren();
    if (!visible.length) get('drivers').append(el('p', `Keine ${plural} gefunden. Versuche einen anderen Namen.`));
    visible.forEach(driver => {
      const card = el('article', null, 'career-driver');
      const heading = el('div', null, 'career-section-heading');
      const button = el('button', selected.has(driver.id) ? '✓ Im Vergleich' : '+ Vergleichen', 'button button-small button-ghost');
      button.type = 'button'; button.setAttribute('aria-pressed', String(selected.has(driver.id)));
      button.setAttribute('aria-label', `${driver.name}: ${selected.has(driver.id) ? 'aus Vergleich entfernen' : 'vergleichen'}`);
      button.disabled = selected.size >= 3 && !selected.has(driver.id);
      button.addEventListener('click', () => { selected.has(driver.id) ? selected.delete(driver.id) : selected.add(driver.id); render(); });
      const open=el('button',`${entity} öffnen`,'button button-small');open.type='button';open.addEventListener('click',()=>{focused=driver.id;render();get('profile').scrollIntoView?.({behavior:reduceMotion?'instant':'smooth',block:'start'});});
      heading.append(el('h3', driver.name), open, button);
      if (isTeam && driver.logoPath) { const logo=el('img');logo.src=driver.logoPath;logo.alt='';logo.className='career-team-logo';card.append(logo); }
      card.append(heading, metrics(driver.stats));
      if(isTeam)card.append(el('p',aggregate()&&driver.includedTeams?.length?`Enthaltene Teams: ${driver.includedTeams.join(', ')}`:'Nur Ergebnisse dieses Teams.', 'career-note'));
      const ordered = [...driver.rows].sort((a, b) => (metric === 'averagePosition' ? (a[metric] ?? Infinity) - (b[metric] ?? Infinity) : (b[metric] ?? -Infinity) - (a[metric] ?? -Infinity)) || b.points - a.points || a.season.localeCompare(b.season));
      if (ordered.length) {
        const best = ordered[0];
        card.append(el('p', `Beste Saison nach ${labels[metric]}: ${best.season} · ${best.league} · ${fmt(best[metric])}${metric === 'winRate' ? ' %' : ''}`, 'career-best'));
        const details = el('details'); details.append(el('summary', `${ordered.length} Saisonwertungen ansehen`));
        ordered.forEach(row => { const item = el('div', null, 'career-season'); item.append(el('h4', `${row.season} · ${row.league}`), metrics(row)); details.append(item); }); card.append(details);
      } else card.append(el('p', 'Noch keine zugeordneten Ergebnisse für diese Auswahl.', 'career-note'));
      get('drivers').append(card);
    });
    const profile=get('profile');if(profile){profile.replaceChildren();const driver=all.find(driver=>driver.id===focused);profile.hidden=!driver;if(driver){profile.append(el('span',isTeam?'FORMEL 1 · TEAMPROFIL':'KRL · FAHRERPROFIL','eyebrow'),el('h2',driver.name),metrics(driver.stats,true));if(!isTeam)profile.append(aliasList(driver));}}
    const comparison = get('comparison'); comparison.replaceChildren();
    const choices = all.filter(driver => selected.has(driver.id));
    if (!choices.length) { comparison.append(el('p', `Dein Vergleich beginnt mit einem ${entity}.`)); return; }
    const table = el('table'); const head = el('thead'); const row = el('tr'); row.append(el('th', 'Kennzahl'));
    choices.forEach(driver => row.append(el('th', driver.name))); head.append(row); table.append(head);
    const body = el('tbody'); Object.entries(labels).forEach(([key, label]) => {
      const tr = el('tr'); const th = el('th', label); th.scope = 'row'; tr.append(th);
      const values = choices.map(driver => driver.stats[key]).filter(value => value != null);
      const max = key === 'averagePosition' ? Math.min(...values) : Math.max(...values);
      choices.forEach(driver => { const td = el('td', fmt(driver.stats[key]) + (key === 'winRate' ? ' %' : '')); if (max > 0 && driver.stats[key] === max) td.append(el('span', key === 'averagePosition' ? ' · Beste Position' : ' · Höchstwert', 'career-leader')); tr.append(td); }); body.append(tr);
    }); table.append(body); comparison.append(table);
  }
  ['search', 'discipline', 'league', 'season', 'metric'].forEach(name => get(name).addEventListener(name === 'search' ? 'input' : 'change', render));
  get('aggregate')?.addEventListener('change', render);
  get('clear').addEventListener('click', () => { selected.clear(); render(); });
  get('reset').addEventListener('click', () => { get('search').value = ''; ['league', 'season'].forEach(name => { get(name).value = 'all'; }); get('discipline').value=isTeam?'f1':'all'; get('season').replaceChildren(new Option('Alle Saisons','all')); options('season',seasons.map(row=>row.season)); focused=null; if(isTeam)get('aggregate').checked=true; get('metric').value = 'points'; selected.clear(); render(); });
  get('league').addEventListener('change',()=>{get('season').replaceChildren(new Option('Alle Saisons','all'));options('season',seasons.filter(row=>get('league').value==='all'||row.league===get('league').value).map(row=>row.season));render();});
  render();
})();
