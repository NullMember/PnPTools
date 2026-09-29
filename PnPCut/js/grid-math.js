// Shared grid-layout math used by index.html (grid tool) and sheet.html (sheet assembler).
// Both tools must agree on cell positions or cut/score/emboss layers won't align on the sheet.

function computeGridLayout(params) {
  const {
    cardW, cardH, bleed, gap, edgeMargin, machineMargin,
    paperW, paperH, autoFit, colsOverride, rowsOverride,
  } = params;

  const guideW = Math.max(0, paperW - 2 * machineMargin);
  const guideH = Math.max(0, paperH - 2 * machineMargin);

  let cols, rows;
  if (autoFit) {
    cols = Math.max(1, Math.floor((guideW - 2 * edgeMargin + gap) / (cardW + gap)) || 1);
    rows = Math.max(1, Math.floor((guideH - 2 * edgeMargin + gap) / (cardH + gap)) || 1);
  } else {
    cols = Math.max(1, Math.round(colsOverride) || 1);
    rows = Math.max(1, Math.round(rowsOverride) || 1);
  }

  const gridW = 2 * edgeMargin + cols * cardW + (cols - 1) * gap;
  const gridH = 2 * edgeMargin + rows * cardH + (rows - 1) * gap;
  const offsetX = (guideW - gridW) / 2;
  const offsetY = (guideH - gridH) / 2;
  const overflow = gridW > guideW + 1e-6 || gridH > guideH + 1e-6;

  const cards = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cards.push({
        row: r,
        col: c,
        x: offsetX + edgeMargin + c * (cardW + gap),
        y: offsetY + edgeMargin + r * (cardH + gap),
      });
    }
  }

  return {
    cardW, cardH, bleed, gap, edgeMargin, machineMargin,
    paperW, paperH, guideW, guideH, cols, rows, gridW, gridH,
    offsetX, offsetY, overflow, cards,
  };
}

if (typeof module !== 'undefined') module.exports = computeGridLayout;
