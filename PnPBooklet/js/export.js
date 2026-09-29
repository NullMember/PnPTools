// PDF export: builds the full multi-sheet PDF via jsPDF, one PDF page per
// printed sheet side (grid or saddle-stitch order, see geometry.js).

// Render a pdf.js page (with the user's extra rotation) so that its full
// width spans widthMm at the given DPI.
async function renderPdfPageAt(pdfPage, rotation, widthMm, dpi) {
  const total = (pdfPage.rotate + (rotation || 0)) % 360;
  const base = pdfPage.getViewport({ scale: 1, rotation: total });
  const vp = pdfPage.getViewport({ scale: (widthMm / 25.4 * dpi) / base.width, rotation: total });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  return { canvas, width: canvas.width, height: canvas.height };
}

async function downloadPDF() {
  showLoading('Generating PDF...');
  try {
    await buildPDF();
  } catch (err) {
    console.error(err);
    alert(`Could not generate the PDF: ${err.message}`);
  } finally {
    hideLoading();
  }
}

function drawPageNumber(pdf, cfg, numText, x_mm, y_mm) {
  pdf.setFontSize(cfg.pageNumSize);
  pdf.setTextColor(cfg.pageNumColor);
  let tx_mm, align;
  if (cfg.pageNumPos.endsWith('left')) {
    align = 'left';
    tx_mm = x_mm + cfg.pageNumOffset;
  } else if (cfg.pageNumPos.endsWith('right')) {
    align = 'right';
    tx_mm = x_mm + cfg.pageW - cfg.pageNumOffset;
  } else {
    align = 'center';
    tx_mm = x_mm + cfg.pageW / 2;
  }
  const fontH_mm = cfg.pageNumSize * 0.352778;
  const ty_mm = cfg.pageNumPos.startsWith('top')
    ? y_mm + cfg.pageNumOffset + fontH_mm
    : y_mm + cfg.pageH - cfg.pageNumOffset;
  pdf.text(numText, tx_mm, ty_mm, { align });
}

function drawPdfBorder(pdf, cfg, x_mm, y_mm) {
  if (cfg.borderStyle === 'none') return;
  const { pageW, pageH, borderStyle, borderWidth } = cfg;
  pdf.setDrawColor(cfg.borderColor);
  pdf.setLineWidth(borderWidth * 0.352778); // pt to mm
  const dotted = borderStyle === 'dotted' || borderStyle === 'double-dotted';
  pdf.setLineDashPattern(dotted ? [0.5, 0.5] : [], 0);
  pdf.rect(x_mm, y_mm, pageW, pageH, 'S');
  if (borderStyle === 'double' || borderStyle === 'double-dotted') {
    const off = borderWidth * 0.352778 * 2;
    pdf.rect(x_mm + off, y_mm + off, pageW - 2 * off, pageH - 2 * off, 'S');
  }
  pdf.setLineDashPattern([], 0);
}

async function buildPDF() {
  const cfg = readConfig();
  const geo = gridGeometry(cfg);
  const sides = buildSides(cfg, state.pages.length);
  const outputDpi = parseFloat(document.getElementById('outputDpi').value) || 300;
  const usePng = document.getElementById('imageFormat').value === 'png';

  const { jsPDF } = window.jspdf;
  const orientation = cfg.sheetW > cfg.sheetH ? 'l' : 'p';
  const pdf = new jsPDF({ orientation, unit: 'mm', format: [cfg.sheetW, cfg.sheetH] });

  for (let s = 0; s < sides.length; s++) {
    loadingText.textContent = `Building PDF page ${s + 1}/${sides.length}...`;
    if (s > 0) pdf.addPage([cfg.sheetW, cfg.sheetH], orientation);

    for (const { row, col, page } of sides[s].cells) {
      if (page === null) continue; // blank booklet page
      const x_mm = geo.cellX(col);
      const y_mm = geo.cellY(row);

      const pg = state.pages[page];
      const origW_mm = cfg.pageW + cfg.cropLeft + cfg.cropRight;
      const src = pg.pdfPage
        ? await renderPdfPageAt(pg.pdfPage, pg.rotation, origW_mm, outputDpi)
        : previewSource(pg); // image pages are kept at full resolution
      const { sx, sy, sw, sh } = cropRect(src, cfg);
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.max(1, Math.round(sw));
      cropCanvas.height = Math.max(1, Math.round(sh));
      cropCanvas.getContext('2d').drawImage(src.canvas, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);
      if (pg.pdfPage) src.canvas.width = 0; // release the high-res render
      const dataURL = usePng ? cropCanvas.toDataURL('image/png') : cropCanvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(dataURL, usePng ? 'PNG' : 'JPEG', x_mm, y_mm, cfg.pageW, cfg.pageH, undefined, 'FAST');

      if (cfg.pageNumEnabled) drawPageNumber(pdf, cfg, String(page + cfg.pageNumStart), x_mm, y_mm);
      drawPdfBorder(pdf, cfg, x_mm, y_mm);
    }

    await new Promise(r => setTimeout(r, 0));
  }

  const kind = cfg.mode === 'saddle' ? 'booklet.pdf' : 'sheets.pdf';
  PnP.downloadBlob(pdf.output('blob'), PnP.outputName(state.sourceFiles, kind));
}
