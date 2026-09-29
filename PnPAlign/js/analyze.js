// Card analysis: silhouette/angle/size detection + paper color, from one downscaled render.

const Analyze = (() => {
  const ANALYZE_MAX_DIM = 500; // downscale target for analysis (speed; angle/size/color are scale-invariant)
  const PAPER_SATURATION_PERCENTILE = 0.35; // fraction of least-saturated pixels treated as the card's own paper/background tone

  // Mean RGB of the least-saturated pixels in the box — paper is near-neutral, printed content isn't.
  function estimatePaperColor(data, w, xMin, xMax, yMin, yMax) {
    const idx = [];
    const sat = [];
    for (let y = yMin; y < yMax; y++) {
      const rowOff = y * w;
      for (let x = xMin; x < xMax; x++) {
        const o = (rowOff + x) * 4;
        const r = data[o], g = data[o + 1], b = data[o + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        idx.push(o);
        sat.push(max > 0 ? (max - min) / max : 0);
      }
    }
    if (idx.length === 0) return [255, 255, 255];
    const order = idx.map((_, i) => i).sort((a, b) => sat[a] - sat[b]);
    const take = Math.max(20, Math.round(order.length * PAPER_SATURATION_PERCENTILE));
    const count = Math.min(take, order.length);
    let rs = 0, gs = 0, bs = 0;
    for (let k = 0; k < count; k++) {
      const o = idx[order[k]];
      rs += data[o]; gs += data[o + 1]; bs += data[o + 2];
    }
    return [rs / count, gs / count, bs / count];
  }

  function drawDownscaled(img, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas, ctx, w, h, scale };
  }

  function otsuThreshold(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, wF = 0, maxVar = 0, threshold = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > maxVar) {
        maxVar = varBetween;
        threshold = t;
      }
    }
    return threshold;
  }

  // Analyzes one card image. Returns:
  //   angle           — degrees to rotate the image to level the card
  //   cardSize        — {long, short} detected printed-card extent in FULL-RESOLUTION pixels (for scale matching)
  //   colorStats      — { paper:[r,g,b] } — the card's own background/paper tone, used as a white-balance anchor
  //   maskCoverage, maskReliable
  function analyzeCard(img) {
    const { ctx, w, h, scale } = drawDownscaled(img, ANALYZE_MAX_DIM);
    const data = ctx.getImageData(0, 0, w, h).data;
    const n = w * h;
    const gray = new Uint8ClampedArray(n);
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const g = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
      gray[i] = g;
      hist[g]++;
    }
    const threshold = otsuThreshold(hist, n);

    // Decide whether foreground is darker or lighter than background by sampling the outer border.
    let borderSum = 0, borderCount = 0;
    for (let x = 0; x < w; x++) {
      borderSum += gray[x] + gray[(h - 1) * w + x];
      borderCount += 2;
    }
    for (let y = 0; y < h; y++) {
      borderSum += gray[y * w] + gray[y * w + (w - 1)];
      borderCount += 2;
    }
    const borderMean = borderSum / borderCount;
    const foregroundIsDark = borderMean >= threshold;

    const isFg = (v) => (foregroundIsDark ? v < threshold : v >= threshold);

    // Boundary/silhouette points: per-row min/max x, per-column min/max y where foreground.
    const points = [];
    for (let y = 0; y < h; y++) {
      let minX = -1, maxX = -1;
      const rowOff = y * w;
      for (let x = 0; x < w; x++) {
        if (isFg(gray[rowOff + x])) {
          if (minX === -1) minX = x;
          maxX = x;
        }
      }
      if (minX !== -1) {
        points.push({ x: minX, y });
        if (maxX !== minX) points.push({ x: maxX, y });
      }
    }
    for (let x = 0; x < w; x++) {
      let minY = -1, maxY = -1;
      for (let y = 0; y < h; y++) {
        if (isFg(gray[y * w + x])) {
          if (minY === -1) minY = y;
          maxY = y;
        }
      }
      if (minY !== -1) {
        points.push({ x, y: minY });
        if (maxY !== minY) points.push({ x, y: maxY });
      }
    }

    let fgCount = 0;
    for (let i = 0; i < n; i++) if (isFg(gray[i])) fgCount++;
    const maskCoverage = fgCount / n;
    const useMask = maskCoverage > 0.02 && maskCoverage < 0.98;

    let angle = 0;
    let cardSize = null;
    // Bounding box of the foreground silhouette — sits safely inside the card, so it's a
    // safe region to sample paper color from without picking up the surrounding background.
    let box = null;
    if (points.length >= 3 && useMask) {
      let minX = w, maxX = 0, minY = h, maxY = 0;
      for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      box = { minX, maxX, minY, maxY };

      const rect = Geometry.minAreaRect(points);
      const rectAngleDeg = (rect.angle * 180) / Math.PI;
      const normalized = Geometry.normalizeAngleDeg(rectAngleDeg);
      angle = -normalized; // rotate image by this much to level the card
      // Full-resolution size, long/short so it's independent of which edge is "width".
      const long = Math.max(rect.width, rect.height) / scale;
      const short = Math.min(rect.width, rect.height) / scale;
      if (long > 0 && short > 0) cardSize = { long, short };
    }

    // Paper color from the interior box, inset 15% further since it's axis-aligned around a
    // possibly-rotated card and its corners can dip outside the printed content when skewed.
    let paper;
    if (box) {
      const bw = box.maxX - box.minX, bh = box.maxY - box.minY;
      const insetX = Math.round(bw * 0.15), insetY = Math.round(bh * 0.15);
      paper = estimatePaperColor(
        data, w,
        box.minX + insetX, box.maxX + 1 - insetX,
        box.minY + insetY, box.maxY + 1 - insetY
      );
    } else {
      paper = estimatePaperColor(data, w, 0, w, 0, h);
    }

    return {
      angle,
      cardSize,
      colorStats: { paper },
      maskCoverage,
      maskReliable: useMask,
    };
  }

  return { analyzeCard };
})();
