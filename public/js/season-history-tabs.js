document.addEventListener("DOMContentLoaded", () => {
  const switches =
    document.querySelectorAll(".season-history-switch");

  switches.forEach((switchElement) => {
    const container =
      switchElement.closest(".season-history-section");

    if (!container) {
      return;
    }

    const buttons =
      switchElement.querySelectorAll(
        "[data-history-tab]"
      );

    const panels =
      container.querySelectorAll(
        "[data-history-panel]"
      );

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const selected =
          button.dataset.historyTab;

        buttons.forEach((currentButton) => {
          currentButton.classList.toggle(
            "is-active",
            currentButton === button
          );
        });

        panels.forEach((panel) => {
          panel.hidden =
            panel.dataset.historyPanel !== selected;
        });
      });
    });
  });
});