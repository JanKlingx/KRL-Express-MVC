(function () {
  "use strict";

  function initStandingsHistory() {
    const carousels = document.querySelectorAll(
      "[data-standings-history]"
    );

    carousels.forEach((carousel) => {
      /*
       * Nur Elemente dieses einen Carousels benutzen.
       */
      const slides = Array.from(
        carousel.querySelectorAll("[data-standings-slide]")
      );

      const prevButton = carousel.querySelector(
        "[data-standings-prev]"
      );

      const nextButton = carousel.querySelector(
        "[data-standings-next]"
      );

      const dots = Array.from(
        carousel.querySelectorAll("[data-standings-dot]")
      );

      if (!slides.length) {
        return;
      }

      /*
       * Aktuell aktiven Slide ermitteln.
       * Standard: letzter = neuester WM-Stand.
       */
      let currentIndex = slides.findIndex((slide) =>
        slide.classList.contains("is-active")
      );

      if (currentIndex < 0) {
        currentIndex = slides.length - 1;
      }

      function showSlide(nextIndex) {
        /*
         * Endlosschleife.
         */
        currentIndex =
          (nextIndex + slides.length) %
          slides.length;

        slides.forEach((slide, index) => {
          const active =
            index === currentIndex;

          slide.classList.toggle(
            "is-active",
            active
          );

          slide.setAttribute(
            "aria-hidden",
            active ? "false" : "true"
          );

          /*
           * Zusätzlich inline setzen.
           * Damit können alte CSS-Regeln
           * den Wechsel nicht verhindern.
           */
          slide.style.display =
            active ? "block" : "none";
        });

        dots.forEach((dot, index) => {
          dot.classList.toggle(
            "is-active",
            index === currentIndex
          );

          dot.setAttribute(
            "aria-current",
            index === currentIndex
              ? "true"
              : "false"
          );
        });
      }

      /*
       * LINKER PFEIL
       */
      if (prevButton) {
        prevButton.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();

            showSlide(
              currentIndex - 1
            );
          }
        );
      }

      /*
       * RECHTER PFEIL
       */
      if (nextButton) {
        nextButton.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();

            showSlide(
              currentIndex + 1
            );
          }
        );
      }

      /*
       * DOTS
       */
      dots.forEach((dot, index) => {
        dot.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();

            showSlide(index);
          }
        );
      });

      /*
       * TASTATUR
       */
      carousel.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();

            showSlide(
              currentIndex - 1
            );
          }

          if (event.key === "ArrowRight") {
            event.preventDefault();

            showSlide(
              currentIndex + 1
            );
          }
        }
      );

      /*
       * Initialzustand.
       */
      showSlide(currentIndex);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initStandingsHistory,
      { once: true }
    );
  } else {
    initStandingsHistory();
  }
})();