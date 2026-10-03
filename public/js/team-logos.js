document.querySelectorAll('[data-team-logo-upload]').forEach(form => {
  const input = form.querySelector('[data-team-logo-files]');
  const previews = form.querySelector('[data-team-logo-previews]');
  const drop = form.querySelector('[data-team-logo-drop]');
  let urls = [];
  function refresh() {
    urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
    previews.replaceChildren(); input.setCustomValidity('');
    const files = [...input.files];
    const error = files.length > 12 ? 'Bitte höchstens 12 Bilder auf einmal wählen.' : files.some(file => !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) ? 'Bitte nur PNG, JPG oder WebP mit höchstens 10 MB je Bild auswählen.' : '';
    if (error) { input.setCustomValidity(error); previews.textContent = error; input.reportValidity(); return; }
    files.forEach(file => {
      const figure = document.createElement('figure');
      const img = document.createElement('img'); img.alt = ''; img.src = URL.createObjectURL(file); urls.push(img.src);
      const caption = document.createElement('figcaption'); caption.textContent = file.name;
      figure.append(img, caption); previews.append(figure);
    });
  }
  input.addEventListener('change', refresh);
  ['dragenter','dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('is-dragging'); }));
  ['dragleave','drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('is-dragging'); }));
  drop.addEventListener('drop', event => { if(event.dataTransfer?.files.length){ input.files=event.dataTransfer.files; refresh(); } });
  window.addEventListener('pagehide', () => urls.forEach(url => URL.revokeObjectURL(url)));
});
