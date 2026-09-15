(() => {
 const dialog=document.querySelector('[data-navigation-editor]');if(!dialog)return;
 const state=JSON.parse(dialog.querySelector('[data-navigation-state]').value);
 const pages=JSON.parse(dialog.querySelector('[data-navigation-pages]').value);
 const list=dialog.querySelector('[data-navigation-list]'),select=dialog.querySelector('[data-navigation-page]');let dragging=null;
 dialog.querySelector('[data-navigation-close]').addEventListener('click',()=>dialog.close());
 document.querySelector('[data-navigation-open]').addEventListener('click',()=>dialog.showModal());
 function button(text,action,label=text){const b=document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('aria-label',label);b.addEventListener('click',action);return b;}
 function render(){
  list.replaceChildren();const used=new Set(state.flatMap(item=>item.children||[item]).map(item=>item.url));select.replaceChildren();
  pages.filter(p=>!used.has(p.url)).forEach(p=>{const option=new Option(p.label,p.url);select.add(option);});
  function rows(items,parent){items.forEach((item,index)=>{
   const card=document.createElement('div');card.className='navigation-editor-card';card.draggable=true;
   card.addEventListener('dragstart',event=>{event.stopPropagation();dragging={items,item};event.dataTransfer.setData('text/plain',item.label);});
   card.addEventListener('dragover',event=>event.preventDefault());
   card.addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();if(!dragging||dragging.item===item||dragging.item.children&&items!==state)return;dragging.items.splice(dragging.items.indexOf(dragging.item),1);items.splice(items.indexOf(item),0,dragging.item);dragging=null;render();});
   const input=document.createElement('input');input.value=item.label;input.maxLength=60;input.setAttribute('aria-label',item.children?'Gruppenname':'Seitenname');input.addEventListener('input',()=>item.label=input.value);card.append(input);
   for(const [text,delta] of [['↑',-1],['↓',1]]){const b=button(text,()=>{items.splice(index,1);items.splice(index+delta,0,item);render();},`${item.label} ${delta<0?'nach oben':'nach unten'}`);b.disabled=index+delta<0||index+delta>=items.length;card.append(b);}
   card.append(button('×',()=>{if(item.children?.length&&!confirm('Gruppe und ihre Navigationseinträge entfernen? Die Seiten bleiben erhalten.'))return;items.splice(index,1);render();},`${item.label} aus Navigation entfernen`));
   if(item.children){const children=document.createElement('div');children.className='navigation-editor-children';children.textContent=item.children.length?'':'Seiten hierher ziehen';children.addEventListener('dragover',e=>e.preventDefault());children.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();if(!dragging||dragging.item.children)return;dragging.items.splice(dragging.items.indexOf(dragging.item),1);item.children.push(dragging.item);dragging=null;render();});rows(item.children,children);card.append(children);}
   else {const group=document.createElement('select');group.setAttribute('aria-label',`${item.label}: Gruppe auswählen`);group.add(new Option('Direkt in der Navigation',''));state.filter(s=>s.children).forEach((g,i)=>group.add(new Option(g.label,String(state.indexOf(g)))));group.value=items===state?'':String(state.findIndex(g=>g.children===items));group.addEventListener('change',()=>{const target=group.value===''?state:state[Number(group.value)].children;items.splice(items.indexOf(item),1);target.push(item);render();});card.append(group);}
   parent.append(card);
  });}rows(state,list);
 }
 dialog.querySelector('[data-navigation-add]').addEventListener('click',()=>{const page=pages.find(p=>p.url===select.value);if(page)state.push({...page});render();});
 dialog.querySelector('[data-navigation-group]').addEventListener('click',()=>{state.push({label:'Neue Gruppe',children:[]});render();});
 dialog.querySelector('[data-navigation-save]').addEventListener('click',async()=>{const message=dialog.querySelector('[data-navigation-message]');try{const response=await fetch('/admin/navigation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({layout:JSON.stringify(state),version:dialog.querySelector('[data-navigation-version]').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Speichern fehlgeschlagen.');location.reload();}catch(error){message.textContent=error.message;}});render();
})();
