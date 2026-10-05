(() => {
  document.querySelectorAll('[data-alias-editor]').forEach(root=>{
    const stored=root.querySelector('textarea'),form=root.closest('form');
    const initial=root.querySelector('[data-alias-json]');
    let aliases=initial?.value?JSON.parse(initial.value):stored.value.split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean),editing=null;
    aliases=[...new Set(aliases)];
    const json=initial||document.createElement('input');json.type='hidden';json.disabled=false;json.name='aliasesJson';if(!initial)root.append(json);
    const list=document.createElement('div');list.className='alias-chips';root.append(list);
    const controls=document.createElement('div');controls.className='alias-chip-controls';
    const input=document.createElement('input');input.type='text';input.maxLength=255;input.placeholder='Alias eingeben';input.setAttribute('aria-label','Alias eingeben');
    const add=document.createElement('button');add.type='button';add.className='button button-small';add.textContent='+ Hinzufügen';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Abbrechen';cancel.hidden=true;
    const error=document.createElement('small');error.setAttribute('role','alert');
    controls.append(input,add,cancel);root.append(controls,error);stored.hidden=true;stored.removeAttribute('id');
    function render(){list.replaceChildren();aliases.forEach((alias,index)=>{
      const chip=document.createElement('span');chip.className='alias-chip';const text=document.createElement('span');text.textContent=alias;chip.append(text);
      for(const [symbol,label,action] of [['✎','bearbeiten',()=>{editing=index;input.value=alias;add.textContent='Übernehmen';cancel.hidden=false;input.focus();}],['×','löschen',()=>{aliases.splice(index,1);clear();render();}]]){
        const b=document.createElement('button');b.type='button';b.textContent=symbol;b.setAttribute('aria-label',`${alias} ${label}`);b.addEventListener('click',action);chip.append(b);
      }list.append(chip);
    });json.value=JSON.stringify(aliases);stored.value=aliases.join('\n');}
    function clear(){editing=null;input.value='';add.textContent='+ Hinzufügen';cancel.hidden=true;error.textContent='';}
    function commit(){const value=input.value.trim();if(!value){error.textContent='Bitte einen Namen eingeben.';return false;}if(aliases.some((a,i)=>i!==editing&&a.toLocaleLowerCase('de')===value.toLocaleLowerCase('de'))){error.textContent='Dieser Alias ist bereits vorhanden.';return false;}if(editing===null)aliases.push(value);else aliases[editing]=value;clear();render();return true;}
    add.addEventListener('click',()=>{commit();input.focus();});cancel.addEventListener('click',clear);
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commit();}if(event.key==='Escape')clear();});
    form.addEventListener('submit',event=>{if(input.value.trim()&&!commit()){event.preventDefault();input.focus();}});render();
  });
})();
