// Shared layout logic used by both the live preview and the PDF export:
// reading the settings, turning pages into printed sheet sides (grid or
// saddle-stitch booklet order), page rotation, and cell border drawing.

function readConfig() {
  const v = (id) => document.getElementById(id).value;
  const f = (id) => parseFloat(v(id)) || 0;
  const mode = v('mode');
  const saddle = mode === 'saddle';
  return {
    mode,
    sheetW: f('sheetW'),
    sheetH: f('sheetH'),
    pageW: f('pageW'),
    pageH: f('pageH'),
    // A saddle-stitch sheet side always holds two pages next to each other.
    cols: saddle ? 2 : Math.max(1, parseInt(v('cols')) || 1),
    rows: saddle ? 1 : Math.max(1, parseInt(v('rows')) || 1),
    direction: saddle ? 'lr-tb' : v('direction'),
    borderStyle: v('borderStyle'),
    borderWidth: f('borderWidth'),
    borderColor: v('borderColor'),
    colGap: f('colGap'),
    rowGap: f('rowGap'),
    cropTop: f('cropTop'),
    cropBottom: f('cropBottom'),
    cropLeft: f('cropLeft'),
    cropRight: f('cropRight'),
    pageNumEnabled: v('pageNumEnabled') === 'on',
    pageNumPos: v('pageNumPos'),
    pageNumSize: f('pageNumSize'),
    pageNumStart: parseInt(v('pageNumStart')) || 0,
    pageNumColor: v('pageNumColor'),
    pageNumOffset: f('pageNumOffset'),
  };
}

// Grid position of every cell on a sheet side, in mm from the top-left.
function gridGeometry(cfg) {
  const gridW = cfg.cols * cfg.pageW + (cfg.cols - 1) * cfg.colGap;
  const gridH = cfg.rows * cfg.pageH + (cfg.rows - 1) * cfg.rowGap;
  return {
    gridW,
    gridH,
    offsetX: (cfg.sheetW - gridW) / 2,
    offsetY: (cfg.sheetH - gridH) / 2,
    overflows: gridW > cfg.sheetW + 0.01 || gridH > cfg.sheetH + 0.01,
    cellX: (col) => (cfg.sheetW - gridW) / 2 + col * (cfg.pageW + cfg.colGap),
    cellY: (row) => (cfg.sheetH - gridH) / 2 + row * (cfg.pageH + cfg.rowGap),
  };
}

// Largest cols × rows of the current page size that fit on the sheet.
function maxGridThatFits(cfg) {
  const fit = (sheet, page, gap) => Math.max(1, Math.floor((sheet + gap) / (page + gap)));
  return { cols: fit(cfg.sheetW, cfg.pageW, cfg.colGap), rows: fit(cfg.sheetH, cfg.pageH, cfg.rowGap) };
}

// Every printed side, in print order: [{ label, cells: [{ row, col, page }] }]
// where page is an index into state.pages, or null for a blank.
function buildSides(cfg, pageCount) {
  const sides = [];
  if (cfg.mode === 'saddle') {
    const n = Math.ceil(pageCount / 4) * 4;
    const real = (i) => (i < pageCount ? i : null);
    for (let s = 0; s < n / 4; s++) {
      sides.push({ label: `Sheet ${s + 1} · front`, cells: [
        { row: 0, col: 0, page: real(n - 1 - 2 * s) },
        { row: 0, col: 1, page: real(2 * s) },
      ] });
      sides.push({ label: `Sheet ${s + 1} · back`, cells: [
        { row: 0, col: 0, page: real(2 * s + 1) },
        { row: 0, col: 1, page: real(n - 2 - 2 * s) },
      ] });
    }
    return sides;
  }
  const order = getCellOrder(cfg.rows, cfg.cols, cfg.direction);
  const perSheet = order.length;
  const count = Math.ceil(pageCount / perSheet);
  for (let s = 0; s < count; s++) {
    const cells = [];
    order.forEach(([row, col], i) => {
      const page = s * perSheet + i;
      if (page < pageCount) cells.push({ row, col, page });
    });
    sides.push({ label: `Sheet ${s + 1}`, cells });
  }
  return sides;
}

// Grid cell order for the grid mode
function getCellOrder(r, c, direction) {
  const cells = [];
  if (direction === 'lr-tb') {
    for (let row = 0; row < r; row++)
      for (let col = 0; col < c; col++)
        cells.push([row, col]);
  } else if (direction === 'tb-lr') {
    for (let col = 0; col < c; col++)
      for (let row = 0; row < r; row++)
        cells.push([row, col]);
  } else if (direction === 'rl-tb') {
    for (let row = 0; row < r; row++)
      for (let col = c - 1; col >= 0; col--)
        cells.push([row, col]);
  } else if (direction === 'tb-rl') {
    for (let col = c - 1; col >= 0; col--)
      for (let row = 0; row < r; row++)
        cells.push([row, col]);
  }
  return cells;
}

// Copy of a canvas rotated clockwise by 0/90/180/270 degrees.
function rotateCanvas(src, rotation) {
  if (!rotation) return src;
  const out = document.createElement('canvas');
  const quarter = rotation % 180 !== 0;
  out.width = quarter ? src.height : src.width;
  out.height = quarter ? src.width : src.height;
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

// A page's thumbnail with its rotation applied, for the page strip.
function thumbSource(pg) {
  const rotation = pg.rotation || 0;
  if (!pg._thumb || pg._thumb.rotation !== rotation) {
    const canvas = rotateCanvas(pg.thumb, rotation);
    pg._thumb = { rotation, canvas, width: canvas.width, height: canvas.height };
  }
  return pg._thumb;
}

// Full-resolution source for an image page, with its rotation applied (cached).
function previewSource(pg) {
  const rotation = pg.rotation || 0;
  if (!pg._rotated || pg._rotated.rotation !== rotation) {
    const canvas = rotateCanvas(pg.canvas, rotation);
    pg._rotated = { rotation, canvas, width: canvas.width, height: canvas.height };
  }
  return pg._rotated;
}

// Recent PDF page renders for the preview, so paging back and forth doesn't
// re-render. Only a few are kept: a long PDF must not hold every page.
const RENDER_CACHE_SIZE = 12;
const renderCache = new Map(); // key -> Promise<{ canvas, width, height }>

// A page drawn at least `widthPx` wide (its full, uncropped width), rotated.
// Image pages use the image itself.
function pageSource(pg, widthPx) {
  if (!pg.pdfPage) return Promise.resolve(previewSource(pg));
  const rotation = pg.rotation || 0;
  const bucket = Math.max(256, Math.ceil(widthPx / 256) * 256); // don't re-render for small resizes
  const key = `${pg.src}:${pg.pageNo}:${rotation}:${bucket}`;
  let entry = renderCache.get(key);
  if (entry) {
    renderCache.delete(key); // most recently used goes last
  } else {
    entry = (async () => {
      const total = (pg.pdfPage.rotate + rotation) % 360;
      const base = pg.pdfPage.getViewport({ scale: 1, rotation: total });
      const vp = pg.pdfPage.getViewport({ scale: bucket / base.width, rotation: total });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await pg.pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      return { canvas, width: canvas.width, height: canvas.height };
    })();
    entry.catch(() => renderCache.delete(key)); // try again next time
  }
  renderCache.set(key, entry);
  // Dropped renders are freed once nothing draws them any more.
  while (renderCache.size > RENDER_CACHE_SIZE) renderCache.delete(renderCache.keys().next().value);
  return entry;
}

// Crop rectangle (source pixels) for a page drawn into a cell of the given size.
function cropRect(src, cfg) {
  const origW = cfg.pageW + cfg.cropLeft + cfg.cropRight;
  const origH = cfg.pageH + cfg.cropTop + cfg.cropBottom;
  return {
    sx: (cfg.cropLeft / origW) * src.width,
    sy: (cfg.cropTop / origH) * src.height,
    sw: (cfg.pageW / origW) * src.width,
    sh: (cfg.pageH / origH) * src.height,
  };
}

// Shared draw borders utility
function drawBorders(ctx, x, y, w, h, style, lineWidth, color, scale) {
  if (style === 'none') return;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth * scale;

  if (style === 'solid') {
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);
  } else if (style === 'dotted') {
    ctx.setLineDash([2 * scale, 2 * scale]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  } else if (style === 'double') {
    const offset = lineWidth * scale * 2;
    ctx.setLineDash([]);
    ctx.strokeRect(x, y, w, h);
    ctx.strokeRect(x + offset, y + offset, w - 2 * offset, h - 2 * offset);
  } else if (style === 'double-dotted') {
    const offset = lineWidth * scale * 2;
    ctx.setLineDash([2 * scale, 2 * scale]);
    ctx.strokeRect(x, y, w, h);
    ctx.strokeRect(x + offset, y + offset, w - 2 * offset, h - 2 * offset);
    ctx.setLineDash([]);
  }
}
