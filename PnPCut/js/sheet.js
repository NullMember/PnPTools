(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LAYER_COLORS = { cut: '#c0392b', score: '#e08e0b', emboss: '#2e8b57' };
  const GUIDE_COLOR = '#2b6cb0';

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
    canvasWrap: $('canvasWrap'),
    projectDrop: $('projectDrop'),
    projectInput: $('projectInput'),
    outlineMode: $('outlineMode'),
    radiusGroup: $('radiusGroup'),
    prevPageBtn: $('prevPageBtn'),
    nextPageBtn: $('nextPageBtn'),
    pageLabel: $('pageLabel'),
    addPageBtn: $('addPageBtn'),
    dupPageBtn: $('dupPageBtn'),
    deletePageBtn: $('deletePageBtn'),
    placeAllBtn: $('placeAllBtn'),
    placeAllHint: $('placeAllHint'),
    exportPagesGroup: $('exportPagesGroup'),
    exportPages: $('exportPages'),
    projectList: $('projectList'),
    cellAssignment: $('cellAssignment'),
    fillAllRow: $('fillAllRow'),
    fillAllSelect: $('fillAllSelect'),
    fillAllBtn: $('fillAllBtn'),
    mirrorSheet: $('mirrorSheet'),
    exportAllBtn: $('exportAllBtn'),
    exportCutBtn: $('exportCutBtn'),
    exportScoreBtn: $('exportScoreBtn'),
    exportEmbossBtn: $('exportEmbossBtn'),
    cutOffsetX: $('cutOffsetX'),
    cutOffsetY: $('cutOffsetY'),
  };

  const PAPER_PRESETS = {
    a4: { w: 210, h: 297 },
    letter: { w: 215.9, h: 279.4 },
  };

  // Card references are "filename::index" (the index-th card of a project).
  const state = {
    projects: {},                   // filename -> { cardW, cardH, layerColors, cards: [{ name, shapes }] }
    pages: [{ assignments: {} }],   // assignments: "row-col" -> card reference
    current: 0,                     // page shown and edited
  };

  let gapTouched = false;
  let edgeMarginTouched = false;

  function num(el) {
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : 0;
  }

  // Numbers are rounded; text attributes (polygon points, path data) pass through.
  function round(n) {
    return typeof n === 'number' ? Math.round(n * 1000) / 1000 : n;
  }

  function cellKey(cell) {
    return `${cell.row}-${cell.col}`;
  }

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const cardRef = (filename, index) => `${filename}::${index}`;

  function resolveRef(ref) {
    if (!ref) return null;
    const cut = ref.lastIndexOf('::');
    const project = state.projects[ref.slice(0, cut)];
    const card = project && project.cards[+ref.slice(cut + 2)];
    return card ? { project, card } : null;
  }

  // Every card of every project, in project order.
  function allCardRefs() {
    return Object.keys(state.projects).flatMap((name) => state.projects[name].cards.map((_, i) => cardRef(name, i)));
  }

  function cardLabel(ref) {
    const cut = ref.lastIndexOf('::');
    const name = ref.slice(0, cut);
    const project = state.projects[name];
    return project.cards.length > 1 ? `${name} › ${project.cards[+ref.slice(cut + 2)].name}` : name;
  }

  const page = () => state.pages[state.current];

  // Card editor projects: version 2 lists cards; version 1 is a single card
  // with its shapes at the top level. Reference images are not needed here.
  function normalizeProject(data, filename) {
    const list = Array.isArray(data.cards)
      ? data.cards
      : [{ name: filename.replace(/\.[^.]+$/, ''), shapes: data.shapes }];
    return {
      cardW: +data.cardW || 0,
      cardH: +data.cardH || 0,
      layerColors: data.layerColors || null,
      cards: list.map((c, i) => ({ name: c.name || `Card ${i + 1}`, shapes: Array.isArray(c.shapes) ? c.shapes : [] })),
    };
  }

  // ---------- grid params (mirrors app.js) ----------

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
    return { ...layout, radius: num(els.radius) };
  }

  // ---------- shape markup ----------

  // Shapes become flat paths with position, rotation, mirroring and the
  // registration offset baked in (`place` maps sheet mm to file coordinates):
  // Cricut Design Space mis-scales anything under a transform attribute.
  function shapeMarkup(shape, layerColors, place) {
    const path = PathGeom.shapePath(shape);
    if (!path) return '';
    const d = PathGeom.toD(PathGeom.mapPath(path, place), round);
    const color = (layerColors && layerColors[shape.layer]) || LAYER_COLORS[shape.layer];
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="0.15"/>`;
  }

  function cutRectMarkup(cell, cardW, cardH, radius, place) {
    const r = Math.max(0, Math.min(radius, cardW / 2, cardH / 2));
    // Place both corners: mirroring swaps which one is on the left.
    const a = place({ x: cell.x, y: cell.y });
    const b = place({ x: cell.x + cardW, y: cell.y + cardH });
    return `<rect x="${round(Math.min(a.x, b.x))}" y="${round(Math.min(a.y, b.y))}" width="${round(cardW)}" height="${round(cardH)}" rx="${round(r)}" ry="${round(r)}" fill="none" stroke="${LAYER_COLORS.cut}" stroke-width="0.1"/>`;
  }

  // ---------- sheet body assembly ----------

  // A loaded project's shapes were drawn against ITS OWN cardW/cardH (whatever
  // the card editor had at save time). The sheet's own Card panel can be set
  // to a different size — the project list even flags that mismatch with a
  // ⚠ — but shapes were still only translated into place, never rescaled to
  // match, so any mismatch silently drew everything at the wrong size versus
  // the cut outline. Scale each shape into the sheet's own card size (a
  // no-op, sx=sy=1, whenever the sizes already match).
  function scaleShapeToCard(shape, sx, sy) {
    const scaled = {
      ...shape,
      x: shape.x * sx,
      y: shape.y * sy,
      w: shape.w * sx,
      h: shape.h * sy,
    };
    if (typeof shape.radius === 'number') scaled.radius = shape.radius * Math.min(sx, sy);
    return scaled;
  }

  // The outline cut is the uniform rounded rectangle, the card's own Cut
  // lines standing in for it ("auto": when the card has any), or nothing.
  // A card's own lines on the requested layers are always drawn.
  function buildBodyMarkup(layout, pg, layers, place = (p) => p) {
    const mode = els.outlineMode.value;
    let content = '';
    layout.cards.forEach((cell) => {
      const found = resolveRef(pg.assignments[cellKey(cell)]);
      const shapes = found ? found.card.shapes : [];
      const ownCut = shapes.some((s) => s.layer === 'cut');
      if (layers.includes('cut') && (mode === 'rect' || (mode === 'auto' && !ownCut))) {
        content += cutRectMarkup(cell, layout.cardW, layout.cardH, layout.radius, place) + '\n';
      }
      if (!found) return;
      const { project } = found;
      const sx = project.cardW ? layout.cardW / project.cardW : 1;
      const sy = project.cardH ? layout.cardH / project.cardH : 1;
      shapes
        .filter((s) => layers.includes(s.layer))
        .forEach((s) => {
          const scaled = scaleShapeToCard(s, sx, sy);
          const shifted = { ...scaled, x: scaled.x + cell.x, y: scaled.y + cell.y };
          content += shapeMarkup(shifted, project.layerColors, place) + '\n';
        });
    });
    return content;
  }

  function buildExportSVG(layout, pg, layers, mirror) {
    const guideRect = `<rect x="0" y="0" width="${round(layout.guideW)}" height="${round(layout.guideH)}" fill="none" stroke="${GUIDE_COLOR}" stroke-width="0.1"/>\n`;
    // Registration correction moves every line relative to the guide frame.
    const ox = num(els.cutOffsetX), oy = num(els.cutOffsetY);
    const place = ({ x, y }) => ({ x: (mirror ? layout.guideW - x : x) + ox, y: y + oy });
    const body = buildBodyMarkup(layout, pg, layers, place);
    return `<svg xmlns="${SVG_NS}" ${PnP.svgSize(layout.guideW, layout.guideH)}>\n${guideRect}${body}</svg>`;
  }

  // ---------- rendering ----------

  function renderCanvas(layout) {
    const body = buildBodyMarkup(layout, page(), ['cut', 'score', 'emboss']);
    const guideRect = `<rect x="0" y="0" width="${round(layout.guideW)}" height="${round(layout.guideH)}" fill="none" stroke="${GUIDE_COLOR}" stroke-width="0.1"/>`;
    els.canvasWrap.innerHTML =
      `<svg xmlns="${SVG_NS}" ${PnP.svgSize(layout.guideW, layout.guideH)}>` +
      guideRect + body + `</svg>`;
  }

  function renderWarning(layout) {
    els.warning.hidden = !layout.overflow;
    if (layout.overflow) {
      els.warning.textContent =
        `Grid (${layout.gridW.toFixed(1)} × ${layout.gridH.toFixed(1)} mm) is larger than the usable guide area ` +
        `(${layout.guideW.toFixed(1)} × ${layout.guideH.toFixed(1)} mm). Reduce columns/rows or spacing.`;
    }
  }

  function renderProjectList() {
    const names = Object.keys(state.projects);
    if (names.length === 0) {
      els.projectList.innerHTML = '<p class="props-empty">No projects loaded.</p>';
      return;
    }
    els.projectList.innerHTML = names.map((name) => {
      const p = state.projects[name];
      const mismatch = Math.abs(p.cardW - num(els.cardW)) > 0.5 || Math.abs(p.cardH - num(els.cardH)) > 0.5;
      const n = p.cards.length;
      return `<div class="project-row${mismatch ? ' mismatch' : ''}">` +
        `<span class="project-name" title="${esc(name)}">${esc(name)}</span>` +
        `<span class="project-cards">${n} card${n === 1 ? '' : 's'}</span>` +
        `<span class="project-size">${round(p.cardW)}×${round(p.cardH)}mm${mismatch ? ' ⚠' : ''}</span>` +
        `<button type="button" class="remove-btn" data-remove="${esc(name)}" aria-label="Remove ${esc(name)}">&times;</button>` +
        `</div>`;
    }).join('');
  }

  // Options for a card picker: one group per multi-card project.
  function cardOptions(selected) {
    return Object.keys(state.projects).map((name) => {
      const p = state.projects[name];
      const opts = p.cards.map((c, i) => {
        const ref = cardRef(name, i);
        const label = p.cards.length > 1 ? c.name : name;
        return `<option value="${esc(ref)}"${ref === selected ? ' selected' : ''}>${esc(label)}</option>`;
      }).join('');
      return p.cards.length > 1 ? `<optgroup label="${esc(name)}">${opts}</optgroup>` : opts;
    }).join('');
  }

  function renderCellAssignment(layout) {
    const hasCards = allCardRefs().length > 0;
    els.cellAssignment.innerHTML = layout.cards.map((cell) => {
      const key = cellKey(cell);
      const current = page().assignments[key] || '';
      return `<div class="cell-row">` +
        `<span class="cell-label">Cell ${cell.row + 1},${cell.col + 1}</span>` +
        `<select data-cell="${key}"><option value="">— none —</option>${cardOptions(current)}</select>` +
        `</div>`;
    }).join('');

    els.fillAllRow.hidden = !hasCards;
    els.fillAllSelect.innerHTML = cardOptions(els.fillAllSelect.value);
  }

  function renderPages() {
    const n = state.pages.length;
    els.pageLabel.textContent = `Page ${state.current + 1} of ${n}`;
    els.prevPageBtn.disabled = state.current === 0;
    els.nextPageBtn.disabled = state.current === n - 1;
    els.deletePageBtn.disabled = n === 1;
    const hasCards = allCardRefs().length > 0;
    els.placeAllBtn.hidden = !hasCards;
    els.placeAllHint.hidden = !hasCards;
    els.exportPagesGroup.hidden = n === 1;
    els.radiusGroup.hidden = els.outlineMode.value === 'none';
  }

  // Forget assignments to cards that no longer exist, and cells the grid lost.
  function pruneAssignments(layout) {
    const cells = new Set(layout.cards.map(cellKey));
    state.pages.forEach((pg) => {
      Object.keys(pg.assignments).forEach((key) => {
        if (!cells.has(key) || !resolveRef(pg.assignments[key])) delete pg.assignments[key];
      });
    });
  }

  function render() {
    const layout = computeLayout();
    pruneAssignments(layout);
    renderWarning(layout);
    renderCanvas(layout);
    renderProjectList();
    renderCellAssignment(layout);
    renderPages();
    return layout;
  }

  // ---------- project upload ----------

  async function addProjects(files) {
    for (const file of files) {
      try {
        state.projects[file.name] = normalizeProject(JSON.parse(await file.text()), file.name);
      } catch (e) {
        PnP.toast(`Could not read ${file.name}: ${e.message}`, 'error');
      }
    }
    render();
  }

  PnP.dropzone(els.projectDrop, { input: els.projectInput, accept: ['application/json', '.json'], onFiles: addProjects });

  els.projectList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    delete state.projects[btn.dataset.remove];
    render();
  });

  els.cellAssignment.addEventListener('change', (e) => {
    const select = e.target.closest('select[data-cell]');
    if (!select) return;
    if (select.value) page().assignments[select.dataset.cell] = select.value;
    else delete page().assignments[select.dataset.cell];
    render();
  });

  els.fillAllBtn.addEventListener('click', () => {
    const ref = els.fillAllSelect.value;
    if (!ref) return;
    const layout = computeLayout();
    layout.cards.forEach((cell) => {
      const key = cellKey(cell);
      if (!page().assignments[key]) page().assignments[key] = ref;
    });
    render();
  });

  // ---------- pages ----------

  function showPage(index) {
    state.current = Math.max(0, Math.min(state.pages.length - 1, index));
    render();
  }

  els.prevPageBtn.addEventListener('click', () => showPage(state.current - 1));
  els.nextPageBtn.addEventListener('click', () => showPage(state.current + 1));

  els.addPageBtn.addEventListener('click', () => {
    state.pages.splice(state.current + 1, 0, { assignments: {} });
    showPage(state.current + 1);
  });

  els.dupPageBtn.addEventListener('click', () => {
    state.pages.splice(state.current + 1, 0, { assignments: { ...page().assignments } });
    showPage(state.current + 1);
  });

  els.deletePageBtn.addEventListener('click', () => {
    if (state.pages.length === 1) return;
    state.pages.splice(state.current, 1);
    showPage(state.current);
  });

  // Each card no page uses yet goes into the next empty cell, from the first
  // page on; pages are added until every card has a place.
  function placeEveryCard() {
    const used = new Set(state.pages.flatMap((pg) => Object.values(pg.assignments)));
    const todo = allCardRefs().filter((ref) => !used.has(ref));
    if (!todo.length) {
      PnP.toast('Every card is already on a page.', 'info');
      return;
    }
    const cells = computeLayout().cards.map(cellKey);
    let placed = 0;
    let firstTouched = -1;
    for (let p = 0; todo.length; p++) {
      if (!state.pages[p]) state.pages.push({ assignments: {} });
      const { assignments } = state.pages[p];
      cells.forEach((key) => {
        if (!todo.length || assignments[key]) return;
        assignments[key] = todo.shift();
        placed++;
        if (firstTouched === -1) firstTouched = p;
      });
    }
    PnP.toast(`Placed ${placed} card${placed === 1 ? '' : 's'} on ${state.pages.length} page${state.pages.length === 1 ? '' : 's'}.`, 'success');
    showPage(firstTouched);
  }

  els.placeAllBtn.addEventListener('click', placeEveryCard);

  // ---------- grid param wiring (mirrors app.js) ----------

  els.paperPreset.addEventListener('change', () => { applyPaperPreset(); render(); });

  ['paperW', 'paperH'].forEach((id) => {
    els[id].addEventListener('input', () => { els.paperPreset.value = 'custom'; render(); });
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

  ['cardW', 'cardH', 'radius', 'outlineMode', 'landscape', 'machineMargin', 'cols', 'rowsInput'].forEach((id) => {
    els[id].addEventListener('input', render);
    els[id].addEventListener('change', render);
  });

  // ---------- export ----------

  // One SVG for the page shown, or a zip with one SVG per page.
  async function exportLayers(layers, suffix) {
    const layout = computeLayout();
    const mirror = els.mirrorSheet.checked;
    // Named after the card project when there is one, otherwise after the project.
    const base = PnP.outputName(Object.keys(state.projects), `sheet_${round(layout.cardW)}x${round(layout.cardH)}mm_${layout.cols}x${layout.rows}`);
    const svgBlob = (markup) => new Blob([markup], { type: 'image/svg+xml' });
    if (state.pages.length === 1 || els.exportPages.value === 'current') {
      const pageSuffix = state.pages.length === 1 ? '' : `_p${state.current + 1}`;
      PnP.downloadBlob(svgBlob(buildExportSVG(layout, page(), layers, mirror)), `${base}${pageSuffix}_${suffix}.svg`);
      return;
    }
    const entries = state.pages.map((pg, i) => ({
      name: `${base}_p${i + 1}_${suffix}.svg`,
      data: buildExportSVG(layout, pg, layers, mirror),
    }));
    PnP.downloadBlob(await PnP.zip.create(entries), `${base}_${state.pages.length}pages_${suffix}.zip`);
  }

  els.exportAllBtn.addEventListener('click', () => exportLayers(['cut', 'score', 'emboss'], 'all'));
  els.exportCutBtn.addEventListener('click', () => exportLayers(['cut'], 'cut'));
  els.exportScoreBtn.addEventListener('click', () => exportLayers(['score'], 'score'));
  els.exportEmbossBtn.addEventListener('click', () => exportLayers(['emboss'], 'emboss'));

  // ---------- init ----------

  applyPaperPreset();
  render();

  // ---------- Shared PnPTools wiring ----------

  PnP.bindPreset($('cardPreset'), els.cardW, els.cardH, 'card');
  PnP.bindMachinePreset($('machinePreset'), els.machineMargin);
  PnP.init({
    tool: 'PnPCut',
    settingsKey: 'PnPCut-grid', // shared with the grid tool
    project: {
      fileName: () => 'PnPCut-sheet',
      getState: () => ({ projects: state.projects, pages: state.pages }),
      // Older saves held raw single-card projects and one page of
      // assignments naming a project file.
      setState: (saved) => {
        const projects = (saved && saved.projects) || {};
        state.projects = {};
        Object.keys(projects).forEach((name) => { state.projects[name] = normalizeProject(projects[name], name); });
        const pages = (saved && saved.pages) || [{ assignments: (saved && saved.assignments) || {} }];
        state.pages = pages.map((pg) => {
          const assignments = {};
          Object.entries(pg.assignments || {}).forEach(([key, ref]) => {
            if (ref) assignments[key] = ref.includes('::') ? ref : cardRef(ref, 0);
          });
          return { assignments };
        });
        if (!state.pages.length) state.pages.push({ assignments: {} });
        state.current = 0;
        render();
      },
    },
    hasUnsavedWork: () => Object.keys(state.projects).length > 0,
  });

  // Cards sent from the card editor ("Open in sheet assembler").
  PnP.handoff.receive(async (items) => {
    await addProjects(PnP.itemsToFiles(items));
    placeEveryCard();
  });
})();
