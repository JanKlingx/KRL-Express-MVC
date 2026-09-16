(() => {
  const root = document.querySelector('[data-career-statistics]');
  if (!root) return;
  const drivers = JSON.parse(document.getElementById('career-data').textContent);
  const get = name => root.querySelector(`[data-career-${name}]`);
  const selected = new Set();
  let focused = Number(new URLSearchParams(window.location.search).get('driver')) || null;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const scopes = JSON.parse(document.getElementById('career-scopes')?.textContent || '[]');
  const labels = { points: 'Punkte', starts: 'Starts', wins: 'Siege', podium2: '2. Plätze', podium3: '3. Plätze', poles: 'Polepositions', fastestLaps: 'Schnellste Runden', driverOfTheDays: 'Driver of the Day', winRate: 'Siegesquote' };
  const fmt = value => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(value);
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
  const options = (name, values) => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'de', { numeric: true })).forEach(value => { const option = el('option', value); option.value = value; get(name).append(option); });
  const seasons = [...scopes,...drivers.flatMap(driver => driver.seasons)];
  options('league', seasons.map(row => row.league));
  options('season', seasons.map(row => row.season));
  function filteredSeasons(driver) {
    return driver.seasons.filter(row => (get('discipline').value === 'all' || row.discipline === get('discipline').value) && (get('league').value === 'all' || row.league === get('league').value) && (get('season').value === 'all' || row.season === get('season').value));
  }
  function total(rows) {
    const stats = Object.fromEntries(Object.keys(labels).map(key => [key, 0]));
    rows.forEach(row => Object.keys(stats).filter(key => key !== 'winRate').forEach(key => { stats[key] += Number(row[key] || 0); }));
    stats.winRate = stats.starts ? stats.wins / stats.starts * 100 : 0;
    return stats;
  }
  function metrics(stats, animate = false) {
    const list = el('dl', null, 'career-metrics');
    Object.entries(labels).forEach(([key, label]) => {
      const item=el('div');const number=el('dd',fmt(stats[key])+(key==='winRate'?' %':''));
      if(['wins','podium2','podium3'].includes(key)){const image=el('img');image.src=`/images/stats/${key}.svg`;image.alt='';image.className='career-award';item.append(image);}
      item.append(el('dt',label),number);list.append(item);
      if(animate&&!reduceMotion&&window.requestAnimationFrame){const start=performance.now();const tick=now=>{if(!number.isConnected)return;const progress=Math.min(1,(now-start)/850);number.textContent=fmt(key==='winRate'?stats[key]*progress:Math.round(stats[key]*progress))+(key==='winRate'?' %':'');if(progress<1)requestAnimationFrame(tick);};requestAnimationFrame(tick);}
    });
    return list;
  }
  function render() {
    const metric = get('metric').value;
    const all = drivers.map(driver => { const rows = filteredSeasons(driver); return { ...driver, rows, stats: total(rows) }; });
    const query = get('search').value.trim().toLocaleLowerCase('de');
    const visible = all.filter(driver => (get('league').value === 'all' && get('season').value === 'all' || driver.rows.length) && driver.name.toLocaleLowerCase('de').includes(query)).sort((a, b) => b.stats[metric] - a.stats[metric] || a.name.localeCompare(b.name, 'de'));
    get('count').textContent = `${visible.length} Fahrer · ${selected.size}/3 im Vergleich`;
    get('summary').replaceChildren();
    const sum = total(visible.flatMap(driver => driver.rows));
    [['Fahrer', visible.length], ['Starts', sum.starts], ['Polepositions', sum.poles], ['Schnellste Runden', sum.fastestLaps]].forEach(([label, value]) => { const item = el('div'); item.append(el('strong', fmt(value)), el('span', label)); get('summary').append(item); });
    get('drivers').replaceChildren();
    if (!visible.length) get('drivers').append(el('p', 'Keine Fahrer gefunden. Versuche einen anderen Namen.'));
    visible.forEach(driver => {
      const card = el('article', null, 'career-driver');
      const heading = el('div', null, 'career-section-heading');
      const button = el('button', selected.has(driver.id) ? '✓ Im Vergleich' : '+ Vergleichen', 'button button-small button-ghost');
      button.type = 'button'; button.setAttribute('aria-pressed', String(selected.has(driver.id)));
      button.setAttribute('aria-label', `${driver.name}: ${selected.has(driver.id) ? 'aus Vergleich entfernen' : 'vergleichen'}`);
      button.disabled = selected.size >= 3 && !selected.has(driver.id);
      button.addEventListener('click', () => { selected.has(driver.id) ? selected.delete(driver.id) : selected.add(driver.id); render(); });
      const open=el('button','Fahrer öffnen','button button-small');open.type='button';open.addEventListener('click',()=>{focused=driver.id;render();get('profile').scrollIntoView?.({behavior:reduceMotion?'instant':'smooth',block:'start'});});
      heading.append(el('h3', driver.name), open, button); card.append(heading, metrics(driver.stats));
      const ordered = [...driver.rows].sort((a, b) => b[metric] - a[metric] || b.points - a.points || a.season.localeCompare(b.season));
      if (ordered.length) {
        const best = ordered[0];
        card.append(el('p', `Beste Saison nach ${labels[metric]}: ${best.season} · ${best.league} · ${fmt(best[metric])}${metric === 'winRate' ? ' %' : ''}`, 'career-best'));
        const details = el('details'); details.append(el('summary', `${ordered.length} Saisonwertungen ansehen`));
        ordered.forEach(row => { const item = el('div', null, 'career-season'); item.append(el('h4', `${row.season} · ${row.league}`), metrics(row)); details.append(item); }); card.append(details);
      } else card.append(el('p', 'Noch keine zugeordneten Ergebnisse für diese Auswahl.', 'career-note'));
      get('drivers').append(card);
    });
    const profile=get('profile');if(profile){profile.replaceChildren();const driver=all.find(driver=>driver.id===focused);profile.hidden=!driver;if(driver){profile.append(el('span','FORMEL 1 · FAHRERPROFIL','eyebrow'),el('h2',driver.name),metrics(driver.stats,true));}}
    const comparison = get('comparison'); comparison.replaceChildren();
    const choices = all.filter(driver => selected.has(driver.id));
    if (!choices.length) { comparison.append(el('p', 'Dein Vergleich beginnt mit einem Fahrer.')); return; }
    const table = el('table'); const head = el('thead'); const row = el('tr'); row.append(el('th', 'Kennzahl'));
    choices.forEach(driver => row.append(el('th', driver.name))); head.append(row); table.append(head);
    const body = el('tbody'); Object.entries(labels).forEach(([key, label]) => {
      const tr = el('tr'); const th = el('th', label); th.scope = 'row'; tr.append(th);
      const max = Math.max(...choices.map(driver => driver.stats[key]));
      choices.forEach(driver => { const td = el('td', fmt(driver.stats[key]) + (key === 'winRate' ? ' %' : '')); if (max > 0 && driver.stats[key] === max) td.append(el('span', ' · Höchstwert', 'career-leader')); tr.append(td); }); body.append(tr);
    }); table.append(body); comparison.append(table);
  }
  ['search', 'discipline', 'league', 'season', 'metric'].forEach(name => get(name).addEventListener(name === 'search' ? 'input' : 'change', render));
  get('clear').addEventListener('click', () => { selected.clear(); render(); });
  get('reset').addEventListener('click', () => { get('search').value = ''; ['league', 'season'].forEach(name => { get(name).value = 'all'; }); get('discipline').value='f1'; get('season').replaceChildren(new Option('Alle Saisons','all')); options('season',seasons.map(row=>row.season)); focused=null; get('metric').value = 'points'; selected.clear(); render(); });
  get('league').addEventListener('change',()=>{get('season').replaceChildren(new Option('Alle Saisons','all'));options('season',seasons.filter(row=>get('league').value==='all'||row.league===get('league').value).map(row=>row.season));render();});
  render();
})();
