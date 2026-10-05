(() => {
  const source=document.getElementById('season-alias-data');if(!source)return;
  const data=JSON.parse(source.textContent),original=JSON.stringify(data.selected);
  const driver=id=>data.drivers.find(d=>Number(d.id)===Number(id));
  function createSelect(id,scope='history') {
    const d=driver(id);if(!d)return null;
    const select=document.createElement('select');select.className='season-alias-select';select.dataset.aliasDriver=id;select.dataset.aliasScope=scope;
    select.setAttribute('aria-label',`Anzeigename für ${d.name}`);select.title='Anzeigename für diese Saison';
    d.aliases.forEach(alias=>select.add(new Option(alias,alias)));select.value=data.selected[scope]?.[id]||d.name;
    select.addEventListener('change',async()=>{
      const previous=data.selected[scope]?.[id]||d.name,value=select.value;
      if(data.historical){data.selected[scope]||={};if(value===d.name)delete data.selected[scope][id];else data.selected[scope][id]=value;document.dispatchEvent(new CustomEvent('season-alias-change'));refresh();return;}
      select.disabled=true;
      try{const response=await fetch(`/admin/season-aliases/${data.seasonId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({driverId:Number(id),scope,alias:value})});const result=await response.json();if(!response.ok)throw Error(result.error||'Speichern fehlgeschlagen');location.reload();}
      catch(error){select.value=previous;let note=select.parentElement.querySelector('[data-alias-error]');if(!note){note=document.createElement('small');note.dataset.aliasError='';note.setAttribute('role','alert');select.after(note);}note.textContent=error.message;select.disabled=false;}
    });return select;
  }
  function refresh(){
    document.querySelectorAll('[data-alias-driver]').forEach(select=>{const d=driver(select.dataset.aliasDriver);if(d)select.value=data.selected[select.dataset.aliasScope]?.[d.id]||d.name;});
    document.querySelectorAll('[data-lineup-alias-driver]').forEach(node=>{const d=driver(node.dataset.lineupAliasDriver);if(d)node.querySelector('strong').textContent=data.selected.lineup?.[d.id]||d.name;});
  }
  window.SeasonAliases={createSelect,selection:()=>data.selected,name:(id,fallback,scope='history')=>data.selected[scope]?.[id]||fallback,reset:()=>{data.selected=JSON.parse(original);refresh();}};
  document.querySelectorAll('[data-history-driver]').forEach(row=>{if(Number(row.dataset.historyDriver)>0){const select=createSelect(row.dataset.historyDriver);if(select)row.querySelector('.sheet-driver')?.append(select);}});
  document.querySelectorAll('[data-lineup-alias-driver]').forEach(node=>{const select=createSelect(node.dataset.lineupAliasDriver,'lineup');if(select)node.append(select);});
})();
