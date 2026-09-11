document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-rulebook-editor]');
  if (!form) return;
  const blocks = form.querySelector('[data-rulebook-blocks]');
  function refresh() {
    [...blocks.children].forEach((block, index) => {
      block.querySelector('legend').textContent = `Abschnitt ${index + 1}`;
      block.querySelector('[data-block-action="up"]').disabled = index === 0;
      block.querySelector('[data-block-action="down"]').disabled = index === blocks.children.length - 1;
    });
  }
  form.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add-rule]');
    if (add) {
      const block = form.querySelector('template').content.firstElementChild.cloneNode(true);
      block.querySelector('[data-field="sectionType"]').value = add.dataset.addRule;
      blocks.append(block); refresh(); block.querySelector('[data-field="title"]').focus();
    }
    const action = event.target.closest('[data-block-action]');
    if (!action) return;
    const block = action.closest('[data-rulebook-block]');
    if (action.dataset.blockAction === 'up' && block.previousElementSibling) blocks.insertBefore(block, block.previousElementSibling);
    if (action.dataset.blockAction === 'down' && block.nextElementSibling) blocks.insertBefore(block.nextElementSibling, block);
    if (action.dataset.blockAction === 'remove' && window.confirm('Diesen Abschnitt entfernen? Die Entfernung wird beim Speichern übernommen.')) block.remove();
    refresh();
  });
  form.addEventListener('submit', () => {
    form.querySelector('[data-rulebook-payload]').value = JSON.stringify([...blocks.children].map((block) => {
      const values = { id: block.dataset.id };
      block.querySelectorAll('[data-field]').forEach((field) => { values[field.dataset.field] = field.type === 'checkbox' ? field.checked : field.value; });
      return values;
    }));
  });
  refresh();
});
