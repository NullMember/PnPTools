// Live canvas preview: one sheet side at a time, with navigation between
// sides and a warning when the grid doesn't fit the sheet.

let previewTimer = null;
let previewSide = 0;

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 80);
}

function updatePreview() {
  updateModeUI();
  if (state.pages.length === 0) return;
  generatePreviewSheet().catch((err) => {
    console.error(err);
    PnP.toast(`Could not draw the preview: ${err.message}`, 'error');
  });
}

// Grid-only controls are hidden in booklet mode.
function updateModeUI() {
  const saddle = document.getElementById('mode').value === 'saddle';
  document.getElementById('gridPanel').hidden = saddle;
  document.getElementById('directionPanel').hidden = saddle;
}

// PDF pages are rendered for each preview, so a newer preview can start
// before an older one finishes; only the newest is shown.
let previewToken = 0;

async function generatePreviewSheet() {
  const token = ++previewToken;
  const cfg = readConfig();
  const geo = gridGeometry(cfg);
  const sides = buildSides(cfg, state.pages.length);
  previewSide = Math.min(previewSide, sides.length - 1);
  const side = sides[previewSide];

  const previewScale = Math.min((previewArea.clientWidth - 56) / (cfg.sheetW * MM_TO_PX), 1.5);
  const canvasW = Math.round(cfg.sheetW * MM_TO_PX * previewScale);
  const canvasH = Math.round(cfg.sheetH * MM_TO_PX * previewScale);
  const pxPerMM = canvasW / cfg.sheetW;

  // Render the side's pages at the size they're drawn (sharper on HiDPI).
  const fullW = (cfg.pageW + cfg.cropLeft + cfg.cropRight) * pxPerMM * (window.devicePixelRatio || 1);
  const sources = await Promise.all(side.cells.map(({ page }) => (page === null ? null : pageSource(state.pages[page], fullW))));
  if (token !== previewToken) return;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  side.cells.forEach(({ row, col, page }, i) => {
    const x = geo.cellX(col) * pxPerMM;
    const y = geo.cellY(row) * pxPerMM;
    const w = cfg.pageW * pxPerMM;
    const h = cfg.pageH * pxPerMM;

    if (page === null) {
      // Blank page added to complete the booklet
      ctx.save();
      ctx.strokeStyle = '#d0d4e4';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#9aa0b8';
      ctx.font = `${Math.max(10, 12 * previewScale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('blank', x + w / 2, y + h / 2);
      ctx.restore();
      return;
    }

    const src = sources[i];
    const { sx, sy, sw, sh } = cropRect(src, cfg);
    ctx.drawImage(src.canvas, sx, sy, sw, sh, x, y, w, h);
    drawBorders(ctx, x, y, w, h, cfg.borderStyle, cfg.borderWidth, cfg.borderColor, pxPerMM / MM_TO_PT);

    if (cfg.pageNumEnabled) {
      const fontSize = cfg.pageNumSize * (pxPerMM / MM_TO_PT);
      const offsetPx = cfg.pageNumOffset * pxPerMM;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = cfg.pageNumColor;
      ctx.textBaseline = cfg.pageNumPos.startsWith('top') ? 'top' : 'bottom';
      let tx;
      if (cfg.pageNumPos.endsWith('left')) {
        ctx.textAlign = 'left';
        tx = x + offsetPx;
      } else if (cfg.pageNumPos.endsWith('right')) {
        ctx.textAlign = 'right';
        tx = x + w - offsetPx;
      } else {
        ctx.textAlign = 'center';
        tx = x + w / 2;
      }
      const ty = cfg.pageNumPos.startsWith('top') ? y + offsetPx : y + h - offsetPx;
      ctx.fillText(String(page + cfg.pageNumStart), tx, ty);
    }
  });

  // Show where the sheet ends when the grid spills over it.
  if (geo.overflows) {
    ctx.save();
    ctx.strokeStyle = '#e03131';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvasW - 2, canvasH - 2);
    ctx.restore();
  }

  previewArea.innerHTML = '';
  emptyState.style.display = 'none';
  const stack = document.createElement('div');
  stack.className = 'preview-stack';

  const nav = document.createElement('div');
  nav.className = 'preview-nav';
  const prev = navButton('‹', 'Previous side', previewSide > 0, () => { previewSide--; updatePreview(); });
  const next = navButton('›', 'Next side', previewSide < sides.length - 1, () => { previewSide++; updatePreview(); });
  const info = document.createElement('span');
  info.textContent = `${side.label} · ${previewSide + 1} of ${sides.length} side(s)`;
  nav.append(prev, info, next);
  stack.appendChild(nav);

  if (geo.overflows) {
    const warn = document.createElement('div');
    warn.className = 'status error';
    warn.textContent = `The pages don't fit the sheet. Reduce the grid, gaps or page size${cfg.mode === 'grid' ? ', or use “Fit grid to sheet”' : ''}.`;
    stack.appendChild(warn);
  }
  if (cfg.mode === 'saddle') {
    const hint = document.createElement('div');
    hint.className = 'input-hint';
    const blanks = Math.ceil(state.pages.length / 4) * 4 - state.pages.length;
    hint.textContent = `Print double-sided (short edge), fold and staple.${blanks ? ` ${blanks} blank page(s) added.` : ''}`;
    stack.appendChild(hint);
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'preview-page';
  wrapper.appendChild(canvas);
  stack.appendChild(wrapper);
  previewArea.appendChild(stack);
}

function navButton(text, label, enabled, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn-secondary btn-small';
  b.textContent = text;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.disabled = !enabled;
  b.addEventListener('click', onClick);
  return b;
}

window.addEventListener('resize', schedulePreview);
