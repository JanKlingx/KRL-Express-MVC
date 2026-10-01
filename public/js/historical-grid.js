(() => {
  const root = document.querySelector('[data-historical-editor]');
  if (!root) return;
  const data = JSON.parse(document.getElementById('historical-editor-data').textContent);
  const grid = data.grid;
  grid.rows.forEach((row,index)=>{row.rowId ||= `${row.role}:${row.driverId}:${index}`;});
  const original=JSON.stringify(grid);
  const savedStats=new Map();
  const initialCells=new Map(grid.rows.flatMap(row=>Object.entries(row.cells).map(([id,cell])=>[`${row.rowId}:${id}`,JSON.stringify(cell)])));
  const get=name=>root.querySelector(`[data-historical-${name}]`);
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;return node;};
  const name=id=>data.drivers.find(d=>Number(d.id)===Number(id))?.name||'Fahrer';
  const awards=['polePosition','fastestLap','driverOfTheDay'];
  const inactive=status=>['DSQ','DNS','DNA','S'].includes(status);
  const started=cell=>cell&&!inactive(cell.status)&&(cell.position||cell.points!=null||cell.status==='DNF');
  const button=(text,label,action)=>{const node=el('button',text);node.type='button';node.className='historical-inline-button';node.setAttribute('aria-label',label);node.title=label;node.addEventListener('click',action);return node;};
  const rounds=[...new Set(data.races.map(r=>Number(r.sortOrder)))].sort((a,b)=>a-b);
  let dirty=false,busy=false,editing=null,editingRow=null,addingRole=null;
  const selectedRows=new Set();
  const messages=[get('message'),...document.querySelectorAll('[data-historical-message-copy]')];
  const saveButtons=[get('save'),...document.querySelectorAll('[data-historical-save-copy]')];
  const message=text=>messages.forEach(node=>{node.textContent=text;});
  const mark=()=>{dirty=true;message('Ungespeicherte Änderungen. Mit „Änderungen speichern“ aktualisierst du WM, GP-Ergebnisse und Statistiken.');};
  function teamOptions(select,value){select.replaceChildren(new Option('Team auswählen',''));data.teams.forEach(t=>select.add(new Option(t.name,t.id)));select.value=value||'';}
  const dialog=get('dialog'),form=dialog.querySelector('form');
  function updateStatus(){
    const off=inactive(form.elements.status.value),regular=editing?.row.role==='regular';
    get('points-field').hidden=regular;
    form.elements.points.disabled=off||regular;
    form.elements.position.disabled=off;
    if(off){form.elements.points.value='';form.elements.position.value='';}
  }
  function openCell(row,race){
    editing={row,race};const cell=row.cells[race.id]||{};
    get('title').textContent=`${name(row.driverId)} · R${race.sortOrder} ${race.raceType==='sprint'?'Sprint':'GP'}`;
    form.elements.status.value=cell.status||'';form.elements.position.value=cell.position||'';form.elements.points.value=cell.points??'';
    teamOptions(form.elements.teamId,cell.teamId||row.teamId);
    get('cell-error').textContent='';updateStatus();dialog.showModal();
  }
  form.elements.status.addEventListener('change',updateStatus);
  form.addEventListener('submit',event=>{
    event.preventDefault();const status=form.elements.status.value,position=Number(form.elements.position.value)||null,teamId=Number(form.elements.teamId.value)||null;
    const points=form.elements.points.disabled||form.elements.points.value===''?null:Number(form.elements.points.value);
    if(!status&&!position&&points===null){get('cell-error').textContent='Bitte eine Platzierung oder einen Status eintragen.';return;}
    if((position||points!==null||['DNF','DSQ'].includes(status))&&!teamId){get('cell-error').textContent='Bitte das Team dieses Rennens auswählen.';return;}
    const cell={status,position,points,teamId};
    // Result edits retain statistics; an ineligible status clears its awards.
    awards.forEach(field=>{cell[field]=editing.race.raceType!=='sprint'&&started(cell)&&Boolean(editing.row.cells[editing.race.id]?.[field]);});
    const others=grid.rows.filter(row=>row!==editing.row).map(row=>({row,cell:row.cells[editing.race.id]})).filter(item=>item.cell);
    const starts=started(cell)||status==='DSQ';
    let error='';
    if(starts&&others.some(item=>item.row.driverId===editing.row.driverId&&(started(item.cell)||item.cell.status==='DSQ')))error='Dieser Fahrer hat in einer anderen Zeile bereits ein Ergebnis für dieses Rennen.';
    else if(position&&others.some(item=>Number(item.cell.position)===position))error=`Platz ${position} ist bereits vergeben.`;
    else if(starts&&others.filter(item=>(item.cell.teamId||item.row.teamId)===teamId&&(started(item.cell)||item.cell.status==='DSQ')).length>=2)error='Für dieses Team sind bereits zwei Fahrer in diesem Rennen eingetragen.';
    else if(awards.some(field=>cell[field]&&others.some(item=>item.cell[field])))error='Eine dieser Auszeichnungen ist bereits vergeben. Ändere sie im Bereich Rennstatistik.';
    if(error){get('cell-error').textContent=error;return;}
    editing.row.cells[editing.race.id]=cell;mark();dialog.close();render();
  });
  get('clear').addEventListener('click',()=>{delete editing.row.cells[editing.race.id];mark();dialog.close();render();});
  get('cancel').addEventListener('click',()=>dialog.close());
  const rowDialog=get('row-dialog'),rowForm=rowDialog.querySelector('form');
  [...rounds,Math.max(0,...rounds)+1].forEach(round=>rowForm.elements.retiredFromRound.add(new Option(`Ab R${round}`,round)));
  function openRow(row){editingRow=row;get('row-title').textContent=`${name(row.driverId)} · ${row.role==='regular'?'Stammfahrer':'Ersatzfahrer'}`;teamOptions(rowForm.elements.teamId,row.teamId);rowForm.elements.retiredFromRound.value=row.retiredFromRound||'';rowDialog.showModal();}
  rowForm.addEventListener('submit',event=>{event.preventDefault();editingRow.teamId=Number(rowForm.elements.teamId.value)||null;editingRow.retiredFromRound=Number(rowForm.elements.retiredFromRound.value)||null;mark();rowDialog.close();render();});
  get('row-cancel').addEventListener('click',()=>rowDialog.close());
  // One template per responsive table; new rows also work when a season has no participants yet.
  const tables=[...document.querySelectorAll('.season-sheet-table')].map(table=>{
    const template=table.querySelector('[data-history-driver]');
    return template?{body:table.tBodies[0],role:template.dataset.historyRole,template:template.cloneNode(true)}:null;
  }).filter(Boolean);
  function render(){
    tables.forEach(({body,role,template})=>{
      const rows=grid.rows.filter(row=>row.role===role);
      const existing=[...body.querySelectorAll('[data-history-driver]')];
      rows.forEach((row,index)=>{
        let tr=existing.find(tr=>tr.dataset.historyRow===row.rowId)||existing.find(tr=>!tr.dataset.historyRow&&Number(tr.dataset.historyDriver)===row.driverId);
        if(tr)tr.dataset.historyRow=row.rowId;
        if(!tr){tr=template.cloneNode(true);tr.dataset.historyRow=row.rowId;body.append(tr);}
        tr.hidden=false;tr.dataset.historyDriver=row.driverId;
        if(!savedStats.has(row.rowId))savedStats.set(row.rowId,[...tr.querySelectorAll('.sheet-total,.sheet-stat,.sheet-position')].map(td=>td.textContent));
        const driverCell=tr.querySelector('.sheet-driver');driverCell.replaceChildren();
        const link=el('a',name(row.driverId));link.href=`/krl-statistik?driver=${row.driverId}`;link.className='standing-profile-link';driverCell.append(link);
        const actions=el('div');actions.className='historical-driver-actions';
        const select=el('input');select.type='checkbox';select.dataset.historicalSelect=row.rowId;select.checked=selectedRows.has(row.rowId);select.setAttribute('aria-label',`${name(row.driverId)}: diese Zeile auswählen`);
        select.addEventListener('change',()=>{if(select.checked)selectedRows.add(row.rowId);else selectedRows.delete(row.rowId);syncSelection();});actions.append(select);
        actions.append(button('✎',`Team und Cockpitabgabe von ${name(row.driverId)} bearbeiten`,()=>openRow(row)),button('−',`${name(row.driverId)} aus dieser Wertung entfernen`,()=>{
          if(Object.keys(row.cells).length&&!confirm('Diese Zeile samt Ergebnissen entfernen? Erst Speichern übernimmt die Änderung.'))return;
          grid.rows.splice(grid.rows.indexOf(row),1);selectedRows.delete(row.rowId);mark();render();
        }));
        driverCell.append(actions);
        const team=data.teams.find(t=>Number(t.id)===row.teamId),teamCell=tr.querySelector('.sheet-team');
        if(teamCell){teamCell.replaceChildren();const b=button(team?team.name.slice(0,3):'＋',team?.name||'Team zuordnen',()=>openRow(row));if(team?.logoPath){const img=el('img');img.src=team.logoPath;img.alt=team.name;b.replaceChildren(img);}teamCell.append(b);}
        tr.classList.toggle('is-former-driver',Boolean(row.retiredFromRound));
        tr.querySelectorAll('.sheet-result').forEach(td=>{
          const race=data.races.find(r=>Number(r.sortOrder)===Number(td.dataset.round)&&(r.raceType==='sprint'?'sprint':'main')===td.dataset.raceType);if(!race)return;
          const cell=row.cells[race.id];let text='＋';
          if(cell){const persisted=race.entries.find(e=>Number(e.DriverId)===row.driverId);text=cell.status||(cell.points!=null?String(cell.points):persisted&&JSON.stringify(cell)===initialCells.get(`${row.rowId}:${race.id}`)?String(persisted.points):cell.position?`P${cell.position}`:'0');}
          const b=button(text,`${name(row.driverId)}, R${race.sortOrder} ${td.dataset.raceType==='sprint'?'Sprint':'GP'}: Ergebnis bearbeiten`,()=>openCell(row,race));b.classList.add('historical-cell-button');
          if(cell){b.dataset.status=cell.status||'';if(cell.position)b.dataset.position=cell.position;for(const [field,label] of [['fastestLap','F'],['polePosition','PL'],['driverOfTheDay','D']])if(cell[field]){const badge=el('small',label);badge.className=`historical-award-${field}`;b.append(badge);}}
          td.classList.toggle('is-historical-retired',Boolean(row.retiredFromRound&&Number(race.sortOrder)>=row.retiredFromRound));td.replaceChildren(b);
        });
        tr.querySelectorAll('.sheet-total,.sheet-stat,.sheet-position').forEach((td,index)=>{td.textContent=dirty?'–':savedStats.get(row.rowId)?.[index]||'–';td.title=dirty?'Wird beim Speichern neu berechnet':'';});
      });
      existing.filter(tr=>!rows.some(row=>row.rowId===tr.dataset.historyRow)).forEach(tr=>{tr.hidden=true;});
    });
    syncSelection();
    renderStatistics();
    document.querySelectorAll('[data-history-tab]').forEach(tab=>{const count=tab.querySelector('small');if(count)count.textContent=`${grid.rows.filter(row=>row.role===tab.dataset.historyTab).length} Zeilen`;});
  }
  function syncSelection(){
    document.querySelectorAll('[data-historical-select]').forEach(input=>{input.checked=selectedRows.has(input.dataset.historicalSelect);});
    for(const role of ['regular','reserve']){
      const rows=grid.rows.filter(row=>row.role===role),count=rows.filter(row=>selectedRows.has(row.rowId)).length;
      document.querySelectorAll(`[data-historical-select-all="${role}"]`).forEach(input=>{input.checked=rows.length>0&&count===rows.length;input.indeterminate=count>0&&count<rows.length;input.disabled=!rows.length;});
      document.querySelectorAll(`[data-historical-remove-selected="${role}"]`).forEach(b=>{b.disabled=!count;b.textContent=`Auswahl entfernen (${count})`;});
    }
  }
  document.querySelectorAll('[data-historical-select-all]').forEach(input=>input.addEventListener('change',()=>{
    grid.rows.filter(row=>row.role===input.dataset.historicalSelectAll).forEach(row=>{if(input.checked)selectedRows.add(row.rowId);else selectedRows.delete(row.rowId);});syncSelection();
  }));
  document.querySelectorAll('[data-historical-remove-selected]').forEach(b=>b.addEventListener('click',()=>{
    const rows=grid.rows.filter(row=>row.role===b.dataset.historicalRemoveSelected&&selectedRows.has(row.rowId));if(!rows.length)return;
    if(!confirm(`${rows.length} ausgewählte Zeile(n) samt Ergebnissen aus dieser Wertung entfernen? Die obere Teamaufstellung bleibt erhalten. Erst Speichern übernimmt die Änderung.`))return;
    const ids=new Set(rows.map(row=>row.rowId));grid.rows=grid.rows.filter(row=>!ids.has(row.rowId));ids.forEach(id=>selectedRows.delete(id));mark();render();
  }));
  const addDialog=get('add-dialog'),addForm=addDialog.querySelector('form');
  function driverOptions(){
    const query=get('add-search').value.trim().toLocaleLowerCase('de-DE'),previous=get('add').value;
    get('add').replaceChildren(new Option('Fahrer auswählen',''));
    data.drivers.filter(d=>d.name.toLocaleLowerCase('de-DE').includes(query)).forEach(d=>get('add').add(new Option(d.name,d.id)));
    get('add').value=[...get('add').options].some(option=>option.value===previous)?previous:'';
  }
  get('add-search').addEventListener('input',driverOptions);
  document.querySelectorAll('[data-historical-add-role]').forEach(b=>b.addEventListener('click',()=>{
    addingRole=b.dataset.historicalAddRole;get('add-title').textContent=addingRole==='regular'?'Stammfahrer hinzufügen':'Ersatzfahrer hinzufügen';
    addForm.reset();driverOptions();teamOptions(addForm.elements.teamId,null);addDialog.showModal();get('add-search').focus();
  }));
  addForm.addEventListener('submit',event=>{
    event.preventDefault();const driverId=Number(get('add').value),teamId=Number(addForm.elements.teamId.value);
    if(!driverId||!teamId||!addingRole)return;
    grid.rows.push({rowId:crypto.randomUUID(),driverId,role:addingRole,teamId,cells:{}});mark();render();addDialog.close();
  });
  get('add-cancel').addEventListener('click',()=>addDialog.close());
  const lineupDialog=get('lineup-dialog'),lineupForm=lineupDialog.querySelector('form');
  document.querySelectorAll('[data-historical-open]').forEach(b=>b.addEventListener('click',()=>{
    const fields=get('lineup-fields');fields.replaceChildren();get('lineup-error').textContent='';
    data.teams.forEach(team=>{
      const fieldset=el('fieldset'),legend=el('legend',team.name);fieldset.append(legend);
      for(let seat=0;seat<2;seat++){
        const label=el('label',`Fahrer ${seat+1}`),select=el('select');select.dataset.teamId=team.id;select.add(new Option('Freies Cockpit',''));data.drivers.forEach(d=>select.add(new Option(d.name,d.id)));
        select.value=grid.lineup?.filter(row=>row.teamId===Number(team.id))[seat]?.driverId||'';label.append(select);fieldset.append(label);
      }fields.append(fieldset);
    });lineupDialog.showModal();
  }));
  lineupForm.addEventListener('submit',event=>{
    event.preventDefault();const lineup=[...get('lineup-fields').querySelectorAll('select')].filter(s=>s.value).map(s=>({driverId:Number(s.value),teamId:Number(s.dataset.teamId)}));
    if(new Set(lineup.map(row=>row.driverId)).size!==lineup.length){get('lineup-error').textContent='Bitte jeden Fahrer nur einem Cockpit zuordnen.';return;}
    grid.lineup=lineup;mark();lineupDialog.close();get('save').scrollIntoView({block:'center',behavior:'smooth'});
  });
  get('lineup-cancel').addEventListener('click',()=>lineupDialog.close());
  const statsDialog=get('stats-dialog'),statsForm=statsDialog.querySelector('form');
  data.races.filter(r=>r.raceType!=='sprint').forEach(r=>statsForm.elements.raceId.add(new Option(`R${r.sortOrder} · ${r.title||'Grand Prix'}`,r.id)));
  function statsOptions(){
    const raceId=statsForm.elements.raceId.value,rows=grid.rows.filter(row=>started(row.cells[raceId]));
    get('stats-empty').hidden=rows.length>0;
    awards.forEach(field=>{const select=statsForm.elements[field];select.replaceChildren(new Option('Keine Auszeichnung',''));rows.forEach(row=>select.add(new Option(`${name(row.driverId)} · ${data.teams.find(t=>Number(t.id)===(row.cells[raceId].teamId||row.teamId))?.name||''}`,row.rowId)));select.value=rows.find(row=>row.cells[raceId][field])?.rowId||'';});
  }
  statsForm.elements.raceId.addEventListener('change',statsOptions);
  document.querySelectorAll('[data-historical-statistics-open]').forEach(b=>b.addEventListener('click',()=>{const race=data.races.find(r=>r.raceType!=='sprint'&&Number(r.sortOrder)===Number(b.dataset.historicalStatisticsOpen));if(!race)return;statsForm.elements.raceId.value=race.id;statsOptions();statsDialog.showModal();}));
  statsForm.addEventListener('submit',event=>{event.preventDefault();const id=statsForm.elements.raceId.value;grid.rows.forEach(row=>{if(!row.cells[id])return;awards.forEach(field=>{row.cells[id][field]=statsForm.elements[field].value===row.rowId;});if(row.role==='regular'&&row.cells[id].position)row.cells[id].points=null;});mark();statsDialog.close();render();});
  function renderStatistics(){
    document.querySelectorAll('[data-historical-statistics-round]').forEach(tr=>{
      const race=data.races.find(r=>r.raceType!=='sprint'&&Number(r.sortOrder)===Number(tr.dataset.historicalStatisticsRound));if(!race)return;
      awards.forEach(field=>{const td=tr.querySelector(`[data-historical-statistic="${field}"]`);if(td)td.textContent=grid.rows.filter(row=>row.cells[race.id]?.[field]).map(row=>name(row.driverId)).join(', ')||'–';});
    });
  }
  get('stats-cancel').addEventListener('click',()=>statsDialog.close());
  get('undo').addEventListener('click',()=>{if(dirty&&!confirm('Alle ungespeicherten Änderungen verwerfen?'))return;Object.assign(grid,JSON.parse(original));selectedRows.clear();dirty=false;render();message('Änderungen verworfen.');});
  saveButtons.forEach(b=>b.addEventListener('click',async()=>{
    if(busy)return;busy=true;saveButtons.forEach(b=>{b.disabled=true;});message('Ergebnisse werden gespeichert …');
    try{const response=await fetch(`/admin/historical-grid/${data.seasonId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grid,revision:data.revision})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Speichern fehlgeschlagen.');dirty=false;location.assign(result.url);}
    catch(error){message(error.message+' Deine Eingaben bleiben erhalten.');}
    finally{busy=false;saveButtons.forEach(b=>{b.disabled=false;});}
  }));
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});render();
})();
