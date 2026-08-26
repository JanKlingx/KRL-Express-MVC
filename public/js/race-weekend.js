document.addEventListener("DOMContentLoaded", () => {
  const selector = document.querySelector("[data-race-weekend-selector]");

  selector?.querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", () => selector.requestSubmit());
  });

  const form = document.querySelector("[data-f1-attendance]");
  if (!form) return;

  const feedback = form.querySelector("[data-attendance-feedback]");

  function choiceValue(uncertainCase, name) {
    return (
      uncertainCase?.querySelector(
        `input[data-uncertain-${name}]:checked`
      )?.value || ""
    );
  }

  function setPanelState(uncertainCase) {
    const seat = uncertainCase.closest(
      "[data-seat-row], [data-planned-replacement]"
    );
    if (!seat) return;

    const present = choiceValue(uncertainCase, "present");

    const yesPanel = seat.querySelector(
      ":scope > [data-present-panel='yes']"
    );
    const noPanel = seat.querySelector(
      ":scope > [data-present-panel='no']"
    );

    if (yesPanel) {
      yesPanel.hidden = present !== "yes";
      yesPanel.querySelectorAll("select, input").forEach((control) => {
        control.disabled = present !== "yes";
      });
    }

    if (noPanel) {
      noPanel.hidden = present !== "no";
      noPanel.querySelectorAll("select, input").forEach((control) => {
        control.disabled = present !== "no";
      });
    }

    if (seat.matches("[data-seat-row]")) {
      seat
        .querySelectorAll(":scope > [data-visible-when-regular-absent]")
        .forEach((replacement) => {
          replacement.hidden = present !== "no";
        });
    }
  }

  form.querySelectorAll("[data-uncertain-case]").forEach((uncertainCase) => {
    uncertainCase.querySelectorAll("input[type='radio']").forEach((input) => {
      input.addEventListener("change", () => setPanelState(uncertainCase));
    });

    setPanelState(uncertainCase);
  });


  /*
   * Normale Fahrer:
   * bei Unabgemeldet / Zu spät abgemeldet
   * spontanen Ersatz einblenden.
   */
  form.querySelectorAll("[data-attendance-status]").forEach((select) => {
    const person = select.closest(".f1-attendance-person");
    const replacement = person?.querySelector("[data-spontaneous-replacement]");

    if (!replacement) return;

    function updateReplacementVisibility() {
      replacement.hidden = ![
        "unabgemeldet",
        "zu_spaet_abgemeldet",
      ].includes(select.value);
    }

    select.addEventListener("change", updateReplacementVisibility);
    updateReplacementVisibility();
  });


  form.addEventListener("submit", (event) => {
    const incomplete = [];

    form.querySelectorAll("[data-uncertain-case]").forEach((uncertainCase) => {
      const replacementHost = uncertainCase.closest("[data-planned-replacement]");

      if (replacementHost && replacementHost.hidden) {
        return;
      }

      const present = choiceValue(uncertainCase, "present");
      const responded = choiceValue(uncertainCase, "responded");

      uncertainCase.classList.remove("has-required-error");

      const localError = uncertainCase.querySelector(
        "[data-uncertain-required-error]"
      );

      if (present && responded) {
        if (localError) localError.hidden = true;
        return;
      }

      incomplete.push({ uncertainCase, present, responded });
      uncertainCase.classList.add("has-required-error");

      if (localError) {
        localError.hidden = false;

        if (!present && !responded) {
          localError.textContent =
            "Bitte Anwesenheit und Rückmeldung auswählen.";
        } else if (!present) {
          localError.textContent =
            "Bitte angeben, ob der Fahrer da ist.";
        } else {
          localError.textContent =
            "Bitte angeben, ob sich der Fahrer rechtzeitig zurückgemeldet hat.";
        }
      }
    });

    if (!incomplete.length) return;

    event.preventDefault();

    if (feedback) {
      feedback.classList.add("is-error");
      feedback.textContent =
        "Anwesenheit nicht gespeichert: Bitte bei allen unsicheren Fahrern beide Pflichtfragen beantworten.";
    }

    incomplete[0].uncertainCase.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
});
