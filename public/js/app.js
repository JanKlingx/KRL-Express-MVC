(() => {
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.main-nav');
  menuButton?.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
  });

  document.querySelectorAll('.nav-group > button').forEach((button) => {
    button.addEventListener('click', () => {
      const open = button.parentElement.classList.toggle('open');
      button.setAttribute('aria-expanded', String(open));
    });
  });

  document.querySelectorAll('[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm)) event.preventDefault();
    });
  });

  document.querySelectorAll('[data-carousel]').forEach((carousel) => {
    const slides = [...carousel.querySelectorAll('.carousel-slide')];
    const dots = carousel.querySelector('.carousel-dots');
    let index = 0;
    let touchStart = null;
    const show = (next) => {
      index = (next + slides.length) % slides.length;
      slides.forEach((slide, i) => {
        slide.classList.toggle('active', i === index);
        slide.setAttribute('aria-hidden', String(i !== index));
      });
      [...dots.children].forEach((dot, i) => dot.classList.toggle('active', i === index));
    };
    slides.forEach((slide, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Ergebnis ${i + 1} anzeigen`);
      dot.addEventListener('click', () => show(i));
      dots.appendChild(dot);
    });
    carousel.querySelector('.prev')?.addEventListener('click', () => show(index - 1));
    carousel.querySelector('.next')?.addEventListener('click', () => show(index + 1));
    carousel.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') show(index - 1);
      if (event.key === 'ArrowRight') show(index + 1);
    });
    carousel.addEventListener('touchstart', (event) => { touchStart = event.changedTouches[0].clientX; }, { passive: true });
    carousel.addEventListener('touchend', (event) => {
      if (touchStart === null) return;
      const delta = event.changedTouches[0].clientX - touchStart;
      if (Math.abs(delta) > 45) show(index + (delta < 0 ? 1 : -1));
      touchStart = null;
    }, { passive: true });
    show(0);
  });

  document.querySelectorAll('[data-lightbox]').forEach((button) => {
    button.addEventListener('click', () => {
      const box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.innerHTML = `<button type="button" aria-label="Bild schließen">×</button><img src="${button.dataset.lightbox}" alt="">`;
      const close = () => { box.remove(); button.focus(); };
      box.querySelector('button').addEventListener('click', close);
      box.addEventListener('click', (event) => { if (event.target === box) close(); });
      document.addEventListener('keydown', function escape(event) {
        if (event.key === 'Escape') { close(); document.removeEventListener('keydown', escape); }
      });
      document.body.appendChild(box);
      box.querySelector('button').focus();
    });
  });

  const countdown = document.querySelector('[data-countdown]');
  if (countdown) {
    const update = () => {
      const milliseconds = Math.max(0, new Date(countdown.dataset.countdown) - new Date());
      const days = Math.floor(milliseconds / 86400000);
      const hours = Math.floor(milliseconds / 3600000) % 24;
      const minutes = Math.floor(milliseconds / 60000) % 60;
      countdown.textContent = `${String(days).padStart(2, '0')}T : ${String(hours).padStart(2, '0')}H : ${String(minutes).padStart(2, '0')}M`;
    };
    update();
    setInterval(update, 60000);
  }
})();
