document.addEventListener('DOMContentLoaded', () => {
  const selector = document.querySelector('[data-race-weekend-selector]');
  selector?.querySelectorAll('select').forEach((select) => {
    select.addEventListener('change', () => selector.requestSubmit());
  });
});
