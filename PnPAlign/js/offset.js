// Position alignment: coarse-to-fine search for the pixel shift that best overlaps two
// grayscale buffers (mean-absolute-difference). Pure/DOM-free, like geometry.js.

const Offset = (() => {
  // Crops `gray` (srcW x srcH) to a centered w x h window.
  function cropCentered(gray, srcW, srcH, w, h) {
    const x0 = Math.floor((srcW - w) / 2);
    const y0 = Math.floor((srcH - h) / 2);
    const out = new Float64Array(w * h);
    for (let y = 0; y < h; y++) {
      const srcRow = (y + y0) * srcW;
      const dstRow = y * w;
      for (let x = 0; x < w; x++) {
        out[dstRow + x] = gray[srcRow + x + x0];
      }
    }
    return out;
  }

  // Mean absolute diff over the overlapping region when card is shifted by (dx, dy);
  // rejects overlaps under 20% of the frame as too unreliable to trust.
  function scoreAt(ref, w, h, card, dx, dy) {
    const xStart = Math.max(0, dx), xEnd = Math.min(w, w + dx);
    const yStart = Math.max(0, dy), yEnd = Math.min(h, h + dy);
    if (xEnd <= xStart || yEnd <= yStart) return Infinity;
    let sum = 0, count = 0;
    for (let y = yStart; y < yEnd; y++) {
      const refRow = y * w;
      const cardRow = (y - dy) * w;
      for (let x = xStart; x < xEnd; x++) {
        sum += Math.abs(ref[refRow + x] - card[cardRow + (x - dx)]);
        count++;
      }
    }
    if (count < w * h * 0.2) return Infinity;
    return sum / count;
  }

  function searchBest(ref, w, h, card, cx, cy, range, step) {
    let best = { dx: cx, dy: cy, score: Infinity };
    for (let dy = cy - range; dy <= cy + range; dy += step) {
      for (let dx = cx - range; dx <= cx + range; dx += step) {
        const s = scoreAt(ref, w, h, card, dx, dy);
        if (s < best.score) best = { dx, dy, score: s };
      }
    }
    return best;
  }

  // maxShiftFrac: max shift to search, as a fraction of the shorter shared dimension.
  // Returns { dx, dy }: the shift to draw `card` at so it lines up with `ref`.
  function computeOffset(refGray, refW, refH, cardGray, cardW, cardH, maxShiftFrac = 0.12) {
    const w = Math.min(refW, cardW);
    const h = Math.min(refH, cardH);
    if (w < 8 || h < 8) return { dx: 0, dy: 0 };
    const ref = cropCentered(refGray, refW, refH, w, h);
    const card = cropCentered(cardGray, cardW, cardH, w, h);
    const maxShift = Math.round(Math.min(w, h) * maxShiftFrac);
    if (maxShift < 1) return { dx: 0, dy: 0 };

    let coarseStep = Math.max(2, Math.round(maxShift / 12));
    let best = searchBest(ref, w, h, card, 0, 0, maxShift, coarseStep);
    let step = coarseStep;
    while (step > 1) {
      const nextStep = Math.max(1, Math.floor(step / 3));
      best = searchBest(ref, w, h, card, best.dx, best.dy, step, nextStep);
      step = nextStep;
    }
    return { dx: best.dx, dy: best.dy };
  }

  return { computeOffset, cropCentered, scoreAt };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Offset;
}
