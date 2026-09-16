document.querySelector('[data-history-file]')?.addEventListener('change', event => {
  const file=event.target.files[0],message=document.querySelector('[data-history-file-message]');
  if(!file){message.textContent='';return;}
  if(file.size>2*1024*1024){message.textContent='Die Datei ist zu groß. Maximal 2 MB.';event.target.value='';return;}
  if(!/\.(xlsx|csv)$/i.test(file.name)){message.textContent='Bitte eine Excel-Datei (.xlsx) oder CSV auswählen.';event.target.value='';return;}
  message.textContent=`${file.name} ausgewählt. Jetzt Vorschau erstellen. Bei Excel wird nur das Blatt Ergebnisse gelesen.`;
});
