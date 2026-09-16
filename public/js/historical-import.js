document.querySelector('[data-history-file]')?.addEventListener('change', async event => {
  const file=event.target.files[0],message=document.querySelector('[data-history-file-message]');
  if (!file) return;
  if (file.size>500000) {message.textContent='Die Datei ist zu groß. Maximal 500 KB.';return;}
  try {document.querySelector('[data-history-csv]').value=await file.text();message.textContent=`${file.name} geladen. Bitte jetzt die Vorschau erstellen.`;}
  catch {message.textContent='Die Datei konnte nicht gelesen werden. Bitte erneut auswählen.';}
});
