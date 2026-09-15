(()=>{document.querySelectorAll('[data-content-editor]').forEach(editor=>{const text=editor.querySelector('textarea');editor.querySelectorAll('[data-insert]').forEach(button=>button.addEventListener('click',()=>{
 let value='',type=button.dataset.insert;const selected=text.value.slice(text.selectionStart,text.selectionEnd);
 if(type==='heading')value=`\n\n## ${selected||'Überschrift'}\n\n`;
 else {const url=prompt(type==='video'?'YouTube-Videolink':type==='image'?'Bildlink oder /uploads/…':'Linkziel (https://… oder /…)');if(!url)return;if(type==='video')value=`\n\n${url}\n\n`;else {const label=prompt(type==='image'?'Bildbeschreibung':'Linktext',selected||'')||'';value=`${type==='image'?'\n\n!':''}[${label}](${url})${type==='image'?'\n\n':''}`;}}
 text.setRangeText(value,text.selectionStart,text.selectionEnd,'end');text.focus();
}));});})();
