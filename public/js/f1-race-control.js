document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-f1-attendance]');
  if (!form) return;

  const feedback = form.querySelector('[data-attendance-feedback]');
  const absentStatuses = new Set(['unabgemeldet', 'zu_spaet_abgemeldet']);

  function directPanels(host) {
    return [...host.children].filter((child) => child.matches?.('[data-present-panel]'));
  }

  function setPanelEnabled(panel, enabled) {
    panel.hidden = !enabled;
    panel.querySelectorAll('select, input, button').forEach((control) => {
      control.disabled = !enabled;
    });
  }

  function updateUncertainCase(caseNode) {
    const selected = caseNode.querySelector('[data-uncertain-present]:checked')?.value || '';
    const host = caseNode.parentElement;
    directPanels(host).forEach((panel) => setPanelEnabled(panel, panel.dataset.presentPanel === selected));

    if (host.matches('[data-seat-row]')) {
      host.querySelectorAll(':scope > [data-visible-when-regular-absent]').forEach((replacement) => {
        replacement.hidden = selected !== 'no';
        replacement.querySelectorAll('select, input, button').forEach((control) => {
          control.disabled = selected !== 'no';
        });
        if (selected === 'no') {
          replacement.querySelectorAll('[data-uncertain-case]').forEach(updateUncertainCase);
        }
      });
    }
  }

  function updateReplacementPanel(statusSelect) {
    statusSelect.dataset.status = statusSelect.value;
    const person = statusSelect.closest('[data-present-panel]');
    const panel = person?.querySelector('[data-spontaneous-replacement]');
    if (!panel) return;
    const visible = absentStatuses.has(statusSelect.value);
    panel.hidden = !visible;
    panel.querySelectorAll('select, input').forEach((control) => { control.disabled = !visible || person.hidden; });
    const replacementSelect = panel.querySelector('select');
    if (!visible && replacementSelect) replacementSelect.value = '';
  }

  function updateReplacementAvailability() {
    const selects = [...form.querySelectorAll('[data-replacement-choice]')].filter((select) => !select.disabled && !select.closest('[hidden]'));
    const used = new Set(selects.map((select) => select.value).filter(Boolean));
    selects.forEach((select) => {
      const own = select.value;
      [...select.options].forEach((option) => {
        if (!option.value) return;
        const blocked = used.has(option.value) && option.value !== own;
        option.hidden = blocked;
        option.disabled = blocked;
      });
    });
  }

  form.querySelectorAll('[data-uncertain-case]').forEach((caseNode) => {
    caseNode.querySelectorAll('[data-uncertain-present]').forEach((radio) => {
      radio.addEventListener('change', () => {
        updateUncertainCase(caseNode);
        form.querySelectorAll('[data-attendance-status]').forEach(updateReplacementPanel);
        updateReplacementAvailability();
      });
    });
    updateUncertainCase(caseNode);
  });

  form.querySelectorAll('[data-attendance-status]').forEach((select) => {
    select.addEventListener('change', () => {
      updateReplacementPanel(select);
      updateReplacementAvailability();
    });
    updateReplacementPanel(select);
  });

  form.querySelectorAll('[data-replacement-choice]').forEach((select) => {
    select.addEventListener('change', updateReplacementAvailability);
  });

  form.addEventListener('submit', (event) => {
    const unresolved = [...form.querySelectorAll('[data-uncertain-case]')].filter((caseNode) => {
      if (caseNode.closest('[hidden]')) return false;
      return !caseNode.querySelector('[data-uncertain-present]:checked');
    });
    const activeReplacementSelects = [...form.querySelectorAll('[data-replacement-choice]')]
      .filter((select) => !select.disabled && !select.closest('[hidden]') && select.value);
    const values = activeReplacementSelects.map((select) => select.value);
    const duplicate = values.find((value, index) => values.indexOf(value) !== index);

    if (!unresolved.length && !duplicate) return;
    event.preventDefault();
    feedback.classList.add('is-error');
    feedback.textContent = unresolved.length
      ? `${unresolved.length} unsichere Teilnahme(n) müssen noch mit Ja oder Nein geklärt werden.`
      : 'Ein Ersatzfahrer wurde mehrfach ausgewählt.';
    (unresolved[0] || feedback).scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  updateReplacementAvailability();
});
