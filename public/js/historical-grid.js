(() => {
  const root = document.querySelector('[data-historical-editor]');
  if (!root) return;
  const data = JSON.parse(document.getElementById('historical-editor-data').textContent);
  const grid = data.grid, original = JSON.stringify(grid);
  const initialCells = new Map(grid.rows.flatMap(row => Object.entries(row.cells).map(([id,cell]) => [`${row.role}:${row.driverId}:${id}`,JSON.stringify(cell)])));
  const get = name => root.querySelector(`[data-historical-${name}]`);
  const el = (tag, text) => { const node = document.createElement(tag); if (text != null) node.textContent = text; return node; };
  const name = id => data.drivers.find(d => Number(d.id) === Number(id))?.name || 'Fahrer';
  const button = (text, label, action) => { const node=el('button',text);node.type='button';node.className='historical-inline-button';node.setAttribute('aria-label',label);node.title=label;node.addEventListener('click',action);return node; };
  const rounds = [...new Set(data.races.map(r => Number(r.sortOrder)))].sort((a,b)=>a-b);
  let dirty=false, busy=false, editing=null, editingRow=null;
  const mark = () => { dirty=true; get('message').textContent='Ungespeicherte Änderungen. Mit „Änderungen speichern“ aktualisierst du WM, GP-Ergebnisse und Statistiken.'; };
  function teamOptions(select, value) { select.replaceChildren(new Option('Kein Team',''));data.teams.forEach(t=>select.add(new Option(t.name,t.id)));select.value=value||''; }
  const dialog=get('dialog'), form=dialog.querySelector('form');
  function updateStatus() {
    const inactive=['DSQ','DNS','DNA','S'].includes(form.elements.status.value);
    for (const field of ['points','position']) { form.elements[field].disabled=inactive;if(inactive)form.elements[field].value=''; }
    get('awards').hidden=editing?.race.raceType==='sprint'||inactive;
    if(get('awards').hidden)for(const field of ['fastestLap','polePosition','driverOfTheDay'])form.elements[field].checked=false;
  }
  function openCell(row,race) {
    editing={row,race};const cell=row.cells[race.id]||{};
    get('title').textContent=`${name(row.driverId)} · R${race.sortOrder} ${race.raceType==='sprint'?'Sprint':'GP'}`;
    form.elements.status.value=cell.status||''; form.elements.position.value=cell.position||'';
    form.elements.points.value=cell.points??(cell.needsPosition?race.entries.find(e=>Number(e.DriverId)===row.driverId)?.points??'':'');
    teamOptions(form.elements.teamId,cell.teamId||row.teamId);
    for(const field of ['fastestLap','polePosition','driverOfTheDay'])form.elements[field].checked=Boolean(cell[field]);
    get('cell-error').textContent=''; updateStatus();dialog.showModal();
  }
  form.elements.status.addEventListener('change',updateStatus);
  form.addEventListener('submit',event=>{
    event.preventDefault();const status=form.elements.status.value, position=Number(form.elements.position.value)||null, teamId=Number(form.elements.teamId.value)||null;
    const points=form.elements.points.value===''?null:Number(form.elements.points.value);
    if(!status&&!position&&points===null){get('cell-error').textContent='Bitte Punkte (auch 0), Platzierung oder einen Status eintragen.';return;}
    if((position||points!==null||['DNF','DSQ'].includes(status))&&!teamId){get('cell-error').textContent='Bitte das Team dieses Rennens auswählen.';return;}
    const cell={status,position,points,teamId};for(const field of ['fastestLap','polePosition','driverOfTheDay'])cell[field]=form.elements[field].checked;
    editing.row.cells[editing.race.id]=cell; mark();dialog.close();render();
  });
  get('clear').addEventListener('click',()=>{delete editing.row.cells[editing.race.id];mark();dialog.close();render();});
  get('cancel').addEventListener('click',()=>dialog.close());
  const rowDialog=get('row-dialog'), rowForm=rowDialog.querySelector('form');
  [...rounds,Math.max(0,...rounds)+1].forEach(round=>rowForm.elements.retiredFromRound.add(new Option(`Ab R${round}`,round)));
  function openRow(row){editingRow=row;get('row-title').textContent=`${name(row.driverId)} · ${row.role==='regular'?'Stammfahrer':'Ersatzfahrer'}`;teamOptions(rowForm.elements.teamId,row.teamId);rowForm.elements.retiredFromRound.value=row.retiredFromRound||'';rowDialog.showModal();}
  rowForm.addEventListener('submit',event=>{event.preventDefault();editingRow.teamId=Number(rowForm.elements.teamId.value)||null;editingRow.retiredFromRound=Number(rowForm.elements.retiredFromRound.value)||null;mark();rowDialog.close();render();});
  get('row-cancel').addEventListener('click',()=>rowDialog.close());
  const sheets=[...document.querySelectorAll('[data-history-driver]')];
  function render(){
    sheets.forEach(tr=>{
      const row=grid.rows.find(r=>r.role===tr.dataset.historyRole&&r.driverId===Number(tr.dataset.historyDriver));
      tr.hidden=!row;if(!row)return;
      const driverCell=tr.querySelector('.sheet-driver');driverCell.querySelectorAll('.historical-inline-button').forEach(b=>b.remove());
      driverCell.append(button('−',`${name(row.driverId)} aus ${row.role==='regular'?'Stammfahrerwertung':'Ersatzfahrerwertung'} entfernen`,()=>{
        if(Object.keys(row.cells).length&&!confirm('Diese Zeile samt Ergebnissen aus dieser Wertung entfernen? Erst Speichern übernimmt die Änderung.'))return;
        grid.rows.splice(grid.rows.indexOf(row),1);mark();render();
      }),button('✎',`Team und Cockpitabgabe von ${name(row.driverId)} bearbeiten`,()=>openRow(row)));
      const team=data.teams.find(t=>Number(t.id)===row.teamId), teamCell=tr.querySelector('.sheet-team');
      if(teamCell){teamCell.replaceChildren();const b=button(team?team.name.slice(0,3):'＋',team?.name||'Team zuordnen',()=>openRow(row));if(team?.logoPath){const image=el('img');image.src=team.logoPath;image.alt=team.name;b.replaceChildren(image);}teamCell.append(b);}
      tr.classList.toggle('is-former-driver',Boolean(row.retiredFromRound));
      tr.querySelectorAll('.sheet-result').forEach(td=>{
        const race=data.races.find(r=>Number(r.sortOrder)===Number(td.dataset.round)&&(r.raceType==='sprint'?'sprint':'main')===td.dataset.raceType);if(!race)return;
        const cell=row.cells[race.id];let text='＋';
        if(cell){const persisted=race.entries.find(e=>Number(e.DriverId)===row.driverId);text=cell.status||(cell.points!=null?`${cell.points}`:persisted&&JSON.stringify(cell)===initialCells.get(`${row.role}:${row.driverId}:${race.id}`)?String(persisted.points):cell.position?`P${cell.position}`:persisted?.points??'＋');}
        const b=button(text,`${name(row.driverId)}, R${race.sortOrder} ${td.dataset.raceType==='sprint'?'Sprint':'GP'}: Ergebnis bearbeiten`,()=>openCell(row,race));b.classList.add('historical-cell-button');
        if(cell){b.dataset.status=cell.status||'';if(cell.position)b.dataset.position=cell.position;for(const [key,label] of [['fastestLap','FL'],['polePosition','Pole'],['driverOfTheDay','DotD']])if(cell[key]){const badge=el('small',label);badge.className=`historical-award-${key}`;b.append(badge);}}
        td.classList.toggle('is-historical-retired',Boolean(row.retiredFromRound&&Number(race.sortOrder)>=row.retiredFromRound));td.replaceChildren(b);
      });
    });
    document.querySelectorAll('[data-history-tab]').forEach(tab => {const count=tab.querySelector('small');if(count)count.textContent=`${grid.rows.filter(row=>row.role===tab.dataset.historyTab).length} Fahrer`;});
    const role=get('role').value,add=get('add');add.replaceChildren(new Option('Fahrer auswählen',''));
    data.drivers.filter(d=>!grid.rows.some(r=>r.role===role&&r.driverId===Number(d.id))).forEach(d=>add.add(new Option(d.name,d.id)));
    get('add-button').disabled=add.options.length<2;
  }
  get('role').addEventListener('change',render);
  get('add-button').addEventListener('click',()=>{
    const driverId=Number(get('add').value),role=get('role').value;if(!driverId)return;
    grid.rows.push({driverId,role,teamId:null,cells:{}});
    mark();render();
  });
  const lineupDialog=get('lineup-dialog'),lineupForm=lineupDialog.querySelector('form');
  document.querySelectorAll('[data-historical-open]').forEach(b=>b.addEventListener('click',()=>{
    const fields=get('lineup-fields');fields.replaceChildren();data.drivers.forEach(driver=>{const label=el('label',driver.name),select=el('select');select.dataset.driverId=driver.id;teamOptions(select,grid.lineup?.find(r=>r.driverId===Number(driver.id))?.teamId);label.append(select);fields.append(label);});lineupDialog.showModal();
  }));
  lineupForm.addEventListener('submit',event=>{event.preventDefault();grid.lineup=[...get('lineup-fields').querySelectorAll('select')].filter(s=>s.value).map(s=>({driverId:Number(s.dataset.driverId),teamId:Number(s.value)}));mark();lineupDialog.close();get('save').scrollIntoView({block:'center',behavior:'smooth'});});
  get('lineup-cancel').addEventListener('click',()=>lineupDialog.close());
  get('undo').addEventListener('click',()=>{if(dirty&&!confirm('Alle ungespeicherten Änderungen verwerfen?'))return;Object.assign(grid,JSON.parse(original));dirty=false;render();get('message').textContent='Änderungen verworfen.';});
  get('save').addEventListener('click',async()=>{
    if(busy)return;busy=true;get('save').disabled=true;get('message').textContent='Ergebnisse werden gespeichert …';
    try{const response=await fetch(`/admin/historical-grid/${data.seasonId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grid,revision:data.revision})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Speichern fehlgeschlagen.');dirty=false;location.assign(result.url);}
    catch(error){get('message').textContent=error.message+' Deine Eingaben bleiben erhalten.';}
    finally{busy=false;get('save').disabled=false;}
  });
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});render();
})();
