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
      if (dots) [...dots.children].forEach((dot, i) => dot.classList.toggle('active', i === index));
    };
    slides.forEach((slide, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Ergebnis ${i + 1} anzeigen`);
      dot.addEventListener('click', () => show(i));
      dots?.appendChild(dot);
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

  document.querySelectorAll('.season-picker select').forEach((select) => {
    select.addEventListener('change', () => select.form?.requestSubmit());
  });

  const svgNamespace = 'http://www.w3.org/2000/svg';
  const createSvgElement = (name, attributes = {}) => {
    const element = document.createElementNS(svgNamespace, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  };

  document.querySelectorAll('[data-season-chart]').forEach((chart) => {
    const dataElement = chart.closest('.season-chart-card')?.querySelector('[data-season-chart-data]');
    const legend = chart.closest('.season-chart-card')?.querySelector('[data-season-legend]');
    if (!dataElement) return;

    let payload;
    try {
      payload = JSON.parse(dataElement.textContent);
    } catch (error) {
      chart.textContent = 'Der Saisonverlauf konnte nicht geladen werden.';
      return;
    }

    const races = payload.races || [];
    const drivers = payload.drivers || [];
    if (!races.length || !drivers.length) {
      chart.textContent = 'Für diese Saison sind noch keine Renndaten vorhanden.';
      return;
    }

    const width = Math.max(780, races.length * 76);
    const height = 430;
    const margin = { top: 25, right: 25, bottom: 65, left: 62 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const maximum = Math.max(1, ...drivers.flatMap((driver) => driver.results.map((result) => Number(result.cumulative) || 0)));
    const roundedMaximum = Math.ceil(maximum / 50) * 50 || maximum;
    const accent = getComputedStyle(chart.closest('.league-page')).getPropertyValue('--accent').trim() || '#6ef2f2';
    const colors = [accent, '#ff5f68', '#f0b74a', '#7aa8ff', '#b58cff', '#62d995', '#ff93d1', '#d5e66d'];
    const svg = createSvgElement('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-hidden': 'true' });

    for (let step = 0; step <= 5; step += 1) {
      const y = margin.top + (plotHeight * step) / 5;
      const value = Math.round(roundedMaximum * (1 - step / 5));
      svg.appendChild(createSvgElement('line', { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: 'chart-grid-line' }));
      const label = createSvgElement('text', { x: margin.left - 12, y: y + 4, class: 'chart-axis-label', 'text-anchor': 'end' });
      label.textContent = value;
      svg.appendChild(label);
    }

    races.forEach((race, index) => {
      const x = margin.left + (races.length === 1 ? plotWidth / 2 : (plotWidth * index) / (races.length - 1));
      svg.appendChild(createSvgElement('line', { x1: x, y1: margin.top, x2: x, y2: height - margin.bottom, class: 'chart-grid-line chart-grid-line-vertical' }));
      const code = createSvgElement('text', { x, y: height - 37, class: 'chart-race-code', 'text-anchor': 'middle' });
      code.textContent = race.code;
      svg.appendChild(code);
      const round = createSvgElement('text', { x, y: height - 18, class: 'chart-race-round', 'text-anchor': 'middle' });
      round.textContent = `R${race.round}`;
      svg.appendChild(round);
    });

    drivers.forEach((driver, driverIndex) => {
      const color = colors[driverIndex % colors.length];
      const points = driver.results.map((result, resultIndex) => {
        const x = margin.left + (races.length === 1 ? plotWidth / 2 : (plotWidth * resultIndex) / (races.length - 1));
        const y = margin.top + plotHeight - ((Number(result.cumulative) || 0) / roundedMaximum) * plotHeight;
        return { x, y };
      });
      svg.appendChild(createSvgElement('polyline', {
        points: points.map((point) => `${point.x},${point.y}`).join(' '),
        fill: 'none', stroke: color, 'stroke-width': driverIndex === 0 ? 4 : 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }));
      points.forEach((point) => svg.appendChild(createSvgElement('circle', { cx: point.x, cy: point.y, r: driverIndex === 0 ? 4.5 : 3.5, fill: '#0d1216', stroke: color, 'stroke-width': 2 })));

      if (legend) {
        const item = document.createElement('span');
        const swatch = document.createElement('i');
        swatch.style.backgroundColor = color;
        item.append(swatch, document.createTextNode(`${driver.position}. ${driver.name}`));
        legend.appendChild(item);
      }
    });

    chart.appendChild(svg);
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
