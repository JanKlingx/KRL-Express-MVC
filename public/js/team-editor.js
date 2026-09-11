document.addEventListener('DOMContentLoaded', () => {
  const editor = document.querySelector('[data-team-editor]');
  if (!editor) return;
  const groups = editor.querySelector('[data-team-groups]');
  const orderForm = editor.querySelector('[data-team-order-form]');
  function refresh(changed = false) {
    const rows = [...groups.children];
    const inputs = orderForm.querySelector('[data-group-order-inputs]');
    inputs.replaceChildren();
    rows.forEach((row, index) => {
      row.querySelector('[data-group-move="up"]').disabled = index === 0;
      row.querySelector('[data-group-move="down"]').disabled = index === rows.length - 1;
      const input = document.createElement('input'); input.type = 'hidden'; input.name = 'groupIds'; input.value = row.dataset.groupId; inputs.append(input);
    });
    if (changed) orderForm.querySelector('[data-group-order-status]').textContent = 'Geändert – bitte Reihenfolge speichern.';
  }
  editor.addEventListener('click', (event) => {
    const button = event.target.closest('[data-group-move]'); if (!button) return;
    const row = button.closest('[data-team-group]');
    if (button.dataset.groupMove === 'up' && row.previousElementSibling) groups.insertBefore(row, row.previousElementSibling);
    if (button.dataset.groupMove === 'down' && row.nextElementSibling) groups.insertBefore(row.nextElementSibling, row);
    refresh(true); button.focus();
  });
  editor.querySelectorAll('.team-member-form').forEach((form) => {
    const search = form.querySelector('[data-member-search]');
    const select = form.querySelector('[data-member-select]');
    const options = select ? [...select.options].map((option) => option.cloneNode(true)) : [];
    search?.addEventListener('input', () => {
      const selected = select.value; const term = search.value.toLocaleLowerCase('de');
      select.replaceChildren(...options.filter((option) => !option.value || option.value === selected || option.textContent.toLocaleLowerCase('de').includes(term)).map((option) => option.cloneNode(true)));
      select.value = selected;
    });
    const input = form.querySelector('[data-member-image]');
    const drop = form.querySelector('[data-image-drop]');
    const preview = form.querySelector('[data-image-preview]');
    let previewUrl;
    function showImage() {
      input.setCustomValidity('');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      preview.hidden = true;
      const file = input.files?.[0]; if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { input.setCustomValidity('Bitte PNG, JPG oder WebP bis 10 MB auswählen.'); input.reportValidity(); return; }
      previewUrl = URL.createObjectURL(file); preview.src = previewUrl; preview.hidden = false;
    }
    input.addEventListener('change', showImage);
    drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('is-dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
    drop.addEventListener('drop', (event) => { event.preventDefault(); drop.classList.remove('is-dragover'); if (event.dataTransfer?.files.length === 1) { input.files = event.dataTransfer.files; showImage(); } });
  });
  refresh();
});
