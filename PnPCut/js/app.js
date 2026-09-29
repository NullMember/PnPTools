(() => {
  const $ = (id) => document.getElementById(id);

  const els = {
    cardW: $('cardW'),
    cardH: $('cardH'),
    radius: $('radius'),
    bleed: $('bleed'),
    gap: $('gap'),
    edgeMargin: $('edgeMargin'),
    paperPreset: $('paperPreset'),
    paperW: $('paperW'),
    paperH: $('paperH'),
    landscape: $('landscape'),
    machineMargin: $('machineMargin'),
    autoFit: $('autoFit'),
    cols: $('cols'),
    rowsInput: $('rowsInput'),
    warning: $('warning'),
    summary: $('summary'),
    svgWrap: $('svgWrap'),
    downloadBtn: $('downloadBtn'),
    cutOffsetX: $('cutOffsetX'),
    cutOffsetY: $('cutOffsetY'),
  };

  const PAPER_PRESETS = {
    a4: { w: 210, h: 297 },
    letter: { w: 215.9, h: 279.4 },
  };

  let gapTouched = false;
  let edgeMarginTouched = false;

  function num(el) {
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : 0;
  }

  function applyPaperPreset() {
    const preset = els.paperPreset.value;
    if (preset === 'custom') return;
    const { w, h } = PAPER_PRESETS[preset];
    els.paperW.value = w;
    els.paperH.value = h;
  }

  function getPaperSize() {
    let w = num(els.paperW);
    let h = num(els.paperH);
    if (els.landscape.checked && w < h) [w, h] = [h, w];
    if (!els.landscape.checked && w > h) [w, h] = [h, w];
    return { w, h };
  }

  function computeLayout() {
    const radius = num(els.radius);
    const { w: paperW, h: paperH } = getPaperSize();

    const layout = computeGridLayout({
      cardW: num(els.cardW),
      cardH: num(els.cardH),
      bleed: num(els.bleed),
      gap: num(els.gap),
      edgeMargin: num(els.edgeMargin),
      machineMargin: num(els.machineMargin),
      paperW, paperH,
      autoFit: els.autoFit.checked,
      colsOverride: num(els.cols),
      rowsOverride: num(els.rowsInput),
    });

    if (els.autoFit.checked) {
      els.cols.value = layout.cols;
      els.rowsInput.value = layout.rows;
    }

    return { ...layout, radius };
  }

  function buildSVG(layout) {
    const { guideW, guideH, cardW, cardH, radius, cards } = layout;
    const fmt = (n) => Math.round(n * 1000) / 1000;

    const ox = num(els.cutOffsetX);
    const oy = num(els.cutOffsetY);
    // The registration offset is baked into the coordinates: Cricut Design
    // Space mis-scales anything under a transform attribute.
    const cardRects = cards.map(({ x, y }) =>
      `  <rect x="${fmt(x + ox)}" y="${fmt(y + oy)}" width="${fmt(cardW)}" height="${fmt(cardH)}" rx="${fmt(radius)}" ry="${fmt(radius)}" fill="none" stroke="#c0392b" stroke-width="0.1"/>`
    ).join('\n');

    return `<svg xmlns="http://www.w3.org/2000/svg" ${PnP.svgSize(guideW, guideH)}>
  <rect x="0" y="0" width="${fmt(guideW)}" height="${fmt(guideH)}" fill="none" stroke="#2b6cb0" stroke-width="0.1"/>
${cardRects}
</svg>`;
  }

  function render() {
    const layout = computeLayout();
    const svgMarkup = buildSVG(layout);

    els.svgWrap.innerHTML = svgMarkup;

    els.warning.hidden = !layout.overflow;
    if (layout.overflow) {
      els.warning.textContent =
        `Grid (${layout.gridW.toFixed(1)} × ${layout.gridH.toFixed(1)} mm) is larger than the usable guide area ` +
        `(${layout.guideW.toFixed(1)} × ${layout.guideH.toFixed(1)} mm). Reduce columns/rows or spacing.`;
    }

    els.summary.innerHTML =
      `${layout.cols} × ${layout.rows} = ${layout.cols * layout.rows} cards<br>` +
      `Guide area: ${layout.guideW.toFixed(1)} × ${layout.guideH.toFixed(1)} mm<br>` +
      `Paper: ${layout.paperW.toFixed(1)} × ${layout.paperH.toFixed(1)} mm`;

    els.downloadBtn.dataset.svg = svgMarkup;
  }

  function downloadSVG() {
    const svgMarkup = els.downloadBtn.dataset.svg;
    if (!svgMarkup) return;
    const name = `card-grid_${num(els.cardW)}x${num(els.cardH)}mm_${num(els.cols)}x${num(els.rowsInput)}.svg`;
    PnP.downloadBlob(new Blob([svgMarkup], { type: 'image/svg+xml' }), PnP.outputName([], name));
  }

  els.paperPreset.addEventListener('change', () => {
    applyPaperPreset();
    render();
  });

  ['paperW', 'paperH'].forEach((id) => {
    els[id].addEventListener('input', () => {
      els.paperPreset.value = 'custom';
      render();
    });
  });

  els.bleed.addEventListener('input', () => {
    if (!gapTouched) els.gap.value = num(els.bleed) * 2;
    if (!edgeMarginTouched) els.edgeMargin.value = num(els.bleed);
    render();
  });

  els.gap.addEventListener('input', () => { gapTouched = true; render(); });
  els.edgeMargin.addEventListener('input', () => { edgeMarginTouched = true; render(); });

  els.autoFit.addEventListener('change', () => {
    const manual = !els.autoFit.checked;
    els.cols.disabled = !manual;
    els.rowsInput.disabled = !manual;
    render();
  });

  els.downloadBtn.addEventListener('click', downloadSVG);

  // ---------- registration test sheet ----------

  // Five targets (corners and centre of the guide area). Each is a 20 mm
  // square to cut, with printed tick rows straddling every edge (0.5 mm
  // steps, ±3 mm) so the cut's offset from the print can be read off directly.
  function buildRegistrationSVG() {
    const { guideW, guideH } = computeLayout();
    const fmt = (n) => Math.round(n * 1000) / 1000;
    const S = 20, inset = 18;
    const centres = [
      [inset + S / 2, inset + S / 2], [guideW - inset - S / 2, inset + S / 2],
      [guideW / 2, guideH / 2],
      [inset + S / 2, guideH - inset - S / 2], [guideW - inset - S / 2, guideH - inset - S / 2],
    ];
    let print = '', cut = '';
    centres.forEach(([cx, cy]) => {
      const x0 = cx - S / 2, y0 = cy - S / 2, x1 = cx + S / 2, y1 = cy + S / 2;
      print += `  <rect x="${fmt(x0)}" y="${fmt(y0)}" width="${S}" height="${S}" fill="none" stroke="#000" stroke-width="0.15"/>\n`;
      for (let t = -3; t <= 3.001; t += 0.5) {
        const major = Math.abs(t % 1) < 1e-6;
        const len = major ? 3 : 1.6;
        const sw = t === 0 ? 0.25 : 0.12;
        // A row of vertical ticks straddling the left/right edges: the cut
        // edge falls between two ticks, which reads the horizontal offset.
        [[x0, cy], [x1, cy]].forEach(([x, y]) => {
          print += `  <line x1="${fmt(x + t)}" y1="${fmt(y - 4 - len)}" x2="${fmt(x + t)}" y2="${fmt(y - 4)}" stroke="#000" stroke-width="${sw}"/>\n`;
        });
        // Horizontal ticks straddling the top/bottom edges read the vertical offset.
        [[cx, y0], [cx, y1]].forEach(([x, y]) => {
          print += `  <line x1="${fmt(x - 4 - len)}" y1="${fmt(y + t)}" x2="${fmt(x - 4)}" y2="${fmt(y + t)}" stroke="#000" stroke-width="${sw}"/>\n`;
        });
      }
      cut += `  <rect x="${fmt(x0)}" y="${fmt(y0)}" width="${S}" height="${S}" fill="none" stroke="#c0392b" stroke-width="0.1"/>\n`;
    });
    const note = `<text x="${fmt(guideW / 2)}" y="${fmt(guideH - 6)}" font-family="sans-serif" font-size="3" text-anchor="middle" fill="#000">PnPCut registration test — ticks every 0.5 mm, long ticks every 1 mm, thick tick = no offset</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" ${PnP.svgSize(guideW, guideH)}>
  <rect x="0" y="0" width="${fmt(guideW)}" height="${fmt(guideH)}" fill="none" stroke="#2b6cb0" stroke-width="0.1"/>
  <g id="print">
${print}  ${note}
  </g>
  <g id="cut">
${cut}  </g>
</svg>`;
  }

  $('registrationTestBtn').addEventListener('click', () => {
    PnP.downloadBlob(new Blob([buildRegistrationSVG()], { type: 'image/svg+xml' }), 'registration-test.svg');
  });

  ['cardW', 'cardH', 'radius', 'landscape', 'machineMargin', 'cols', 'rowsInput', 'cutOffsetX', 'cutOffsetY'].forEach((id) => {
    els[id].addEventListener('input', render);
    els[id].addEventListener('change', render);
  });

  applyPaperPreset();
  render();

  // ---------- Shared PnPTools wiring ----------

  // The grid tool and the sheet assembler share one settings scope, so the
  // same card/paper/grid is used on both pages.
  PnP.bindPreset($('cardPreset'), els.cardW, els.cardH, 'card');
  PnP.bindMachinePreset($('machinePreset'), els.machineMargin);
  PnP.init({
    tool: 'PnPCut',
    settingsKey: 'PnPCut-grid',
    project: {},
  });
})();
