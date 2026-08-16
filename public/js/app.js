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

  document.querySelectorAll('[data-bulk-actions]').forEach((toolbar) => {
    const selectAll = toolbar.querySelector('[data-bulk-select-all]');
    const items = [...document.querySelectorAll('[data-bulk-item]')];
    const count = toolbar.querySelector('[data-bulk-count]');
    const submit = toolbar.querySelector('.bulk-delete-button');
    const update = () => {
      const selected = items.filter((item) => item.checked).length;
      count.textContent = String(selected);
      submit.disabled = selected === 0;
      selectAll.checked = items.length > 0 && selected === items.length;
      selectAll.indeterminate = selected > 0 && selected < items.length;
    };
    selectAll.addEventListener('change', () => {
      items.forEach((item) => { item.checked = selectAll.checked; });
      update();
    });
    items.forEach((item) => item.addEventListener('change', update));
    update();
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

  document.querySelectorAll('.season-picker select, .season-switcher select, .admin-filter select').forEach((select) => {
    select.addEventListener('change', () => select.form?.requestSubmit());
  });

  document.querySelectorAll('.lineup-selector select').forEach((select) => {
    select.addEventListener('change', () => select.form?.requestSubmit());
  });

  document.querySelectorAll('[data-driver-picker]').forEach((form) => {
    const search = form.querySelector('[data-driver-search]');
    const driverId = form.querySelector('[data-driver-id]');
    const options = [...form.querySelectorAll('datalist option')];
    const syncDriver = () => {
      const normalized = search.value.trim().toLocaleLowerCase('de-DE');
      const match = options.find((option) => option.value.toLocaleLowerCase('de-DE') === normalized);
      driverId.value = match?.dataset.driverId || '';
      search.setCustomValidity(match || !normalized ? '' : 'Bitte einen Fahrer aus der Namensliste auswählen.');
    };
    search.addEventListener('input', syncDriver);
    search.addEventListener('change', syncDriver);
    form.addEventListener('submit', syncDriver);
  });

  document.querySelectorAll('[data-lineup-status]').forEach((select) => {
    select.addEventListener('change', () => {
      [...select.classList].filter((name) => name.startsWith('status-')).forEach((name) => select.classList.remove(name));
      select.classList.add(`status-${select.value}`);
    });
  });

  const raceSelector = document.querySelector('.race-selector');
  if (raceSelector) {
    raceSelector.querySelector('[name="league"]')?.addEventListener('change', () => {
      raceSelector.elements.season.value = '';
      raceSelector.elements.race.value = '';
      raceSelector.requestSubmit();
    });
    raceSelector.querySelector('[name="season"]')?.addEventListener('change', () => {
      raceSelector.elements.race.value = '';
      raceSelector.requestSubmit();
    });
    raceSelector.querySelector('[name="race"]')?.addEventListener('change', () => raceSelector.requestSubmit());
  }

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

  const exportSlug = (value) => String(value || 'export').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const loadExportImage = (source) => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = source;
  });
  const fitText = (context, value, maximumWidth) => {
    let text = String(value || '–').replace(/\s+/g, ' ').trim();
    if (context.measureText(text).width <= maximumWidth) return text;
    while (text.length > 2 && context.measureText(`${text}…`).width > maximumWidth) text = text.slice(0, -1);
    return `${text}…`;
  };
  const drawContainedImage = (context, image, x, y, width, height) => {
    if (!image?.naturalWidth) return;
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const targetWidth = image.naturalWidth * scale;
    const targetHeight = image.naturalHeight * scale;
    context.drawImage(image, x + (width - targetWidth) / 2, y + (height - targetHeight) / 2, targetWidth, targetHeight);
  };
  const readExportTables = (target) => {
    const tables = target.matches('table') ? [target] : [...target.querySelectorAll('table')];
    return tables.map((table) => {
      const section = table.closest('[data-png-section]');
      const card = table.closest('article');
      return {
        title: section?.dataset.pngSection || card?.querySelector('h3')?.textContent.trim() || '',
        headers: [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim()),
        rows: [...table.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('th,td')].map((cell) => cell.textContent.trim()))
      };
    });
  };

  document.querySelectorAll('[data-png-export]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.querySelector(button.dataset.pngTarget);
      if (!target) return;
      const tables = readExportTables(target);
      const accent = /^#[0-9a-f]{6}$/i.test(button.dataset.pngAccent || '') ? button.dataset.pngAccent : '#6ef2f2';
      const headerHeight = 225;
      const tableHeaderHeight = 54;
      const sectionHeight = tables.length > 1 ? 58 : 0;
      const rowHeight = 52;
      const contentHeight = tables.reduce((height, table) => height + sectionHeight + tableHeaderHeight + Math.max(1, table.rows.length) * rowHeight + 28, 0);
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = Math.max(500, headerHeight + contentHeight + 70);
      const context = canvas.getContext('2d');
      context.fillStyle = '#070a0c';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = accent;
      context.fillRect(0, 0, 16, canvas.height);
      context.fillStyle = '#10171b';
      context.fillRect(46, 34, 1508, 150);
      const logo = await loadExportImage(button.dataset.pngLogo || '/images/krl-placeholder.svg');
      drawContainedImage(context, logo, 76, 52, 155, 112);
      context.fillStyle = '#f5f8fa';
      context.font = '700 50px Arial';
      context.fillText(fitText(context, button.dataset.pngTitle, 1220), 270, 96);
      context.fillStyle = '#9aa8b1';
      context.font = '28px Arial';
      context.fillText(fitText(context, button.dataset.pngSubtitle || 'Saison', 1220), 270, 140);

      let y = headerHeight;
      tables.forEach((table, tableIndex) => {
        if (tables.length > 1) {
          context.fillStyle = accent;
          context.fillRect(58, y, 1484, sectionHeight - 8);
          context.fillStyle = '#061012';
          context.font = '700 27px Arial';
          context.fillText(fitText(context, table.title || `Ergebnis ${tableIndex + 1}`, 1420), 80, y + 34);
          y += sectionHeight;
        }
        const columnCount = Math.max(1, table.headers.length, ...table.rows.map((row) => row.length));
        const availableWidth = 1484;
        const samples = Array.from({ length: columnCount }, (_, columnIndex) => [table.headers[columnIndex], ...table.rows.map((row) => row[columnIndex])]);
        const weights = samples.map((values) => Math.max(7, Math.min(28, Math.max(...values.map((value) => String(value || '').length)))));
        const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
        const widths = weights.map((weight) => availableWidth * weight / weightTotal);
        context.fillStyle = '#1b272e';
        context.fillRect(58, y, availableWidth, tableHeaderHeight);
        let x = 58;
        context.font = '700 22px Arial';
        context.fillStyle = accent;
        for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
          context.fillText(fitText(context, table.headers[columnIndex] || '', widths[columnIndex] - 28), x + 14, y + 35);
          x += widths[columnIndex];
        }
        y += tableHeaderHeight;
        const rows = table.rows.length ? table.rows : [['Keine Daten vorhanden']];
        rows.forEach((row, rowIndex) => {
          context.fillStyle = rowIndex % 2 ? '#0d1418' : '#121b20';
          context.fillRect(58, y, availableWidth, rowHeight - 2);
          x = 58;
          context.font = rowIndex < 3 ? '700 21px Arial' : '20px Arial';
          context.fillStyle = '#f5f8fa';
          for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
            context.fillText(fitText(context, row[columnIndex] || '', widths[columnIndex] - 28), x + 14, y + 33);
            x += widths[columnIndex];
          }
          y += rowHeight;
        });
        y += 28;
      });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${exportSlug(button.dataset.pngFilename)}-${exportSlug(button.dataset.pngSubtitle)}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }, 'image/png');
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
