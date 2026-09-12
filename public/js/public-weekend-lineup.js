document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-public-weekends]').forEach((board) => {
    const select = board.querySelector('[data-weekend-select]');
    if (!select) return;
    const panels = [...board.querySelectorAll('[data-weekend-panel]')];
    const previous = board.querySelector('[data-weekend-prev]');
    const next = board.querySelector('[data-weekend-next]');
    function show(index) {
      const current = Math.max(0, Math.min(panels.length - 1, index));
      select.value = String(current);
      panels.forEach((panel, i) => { panel.hidden = i !== current; });
      previous.disabled = current === 0;
      next.disabled = current === panels.length - 1;
    }
    select.addEventListener('change', () => show(Number(select.value)));
    previous.addEventListener('click', () => show(Number(select.value) - 1));
    next.addEventListener('click', () => show(Number(select.value) + 1));
    show(Number(select.value));
  });
});
