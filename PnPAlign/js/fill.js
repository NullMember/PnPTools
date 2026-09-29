// Fills a canvas's outer margins by extending interior edge pixels outward instead of cropping.

const Fill = (() => {
  function mixColors(from, to, t) {
    return {
      r: Math.round(from.r + (to.r - from.r) * t),
      g: Math.round(from.g + (to.g - from.g) * t),
      b: Math.round(from.b + (to.b - from.b) * t),
    };
  }

  function fillCorner(data, w, x0, y0, cw, ch, isLeft, isTop, horizontalColor, verticalColor) {
    for (let y = 0; y < ch; y++) {
      const verticalOut = (isTop ? ch - y : y + 1) / ch;
      for (let x = 0; x < cw; x++) {
        const horizontalOut = (isLeft ? cw - x : x + 1) / cw;
        const color = mixColors(horizontalColor, verticalColor, verticalOut / (horizontalOut + verticalOut));
        const idx = ((y0 + y) * w + (x0 + x)) * 4;
        data[idx] = color.r;
        data[idx + 1] = color.g;
        data[idx + 2] = color.b;
        data[idx + 3] = 255;
      }
    }
  }

  // margins: {top,right,bottom,left} pixel amounts, in this canvas's own pixel space, to
  // replace with content extended from the surviving interior rather than trim away.
  function fillMargins(canvas, margins) {
    const w = canvas.width, h = canvas.height;
    const left = Math.max(0, Math.min(margins.left, w));
    const right = Math.max(0, Math.min(margins.right, w - left));
    const top = Math.max(0, Math.min(margins.top, h));
    const bottom = Math.max(0, Math.min(margins.bottom, h - top));
    const iw = w - left - right;
    const ih = h - top - bottom;
    if (iw <= 0 || ih <= 0 || (left === 0 && right === 0 && top === 0 && bottom === 0)) {
      return canvas;
    }

    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    const colorAt = (x, y) => {
      const idx = (y * w + x) * 4;
      return { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
    };
    const writePixel = (x, y, color) => {
      const idx = (y * w + x) * 4;
      data[idx] = color.r;
      data[idx + 1] = color.g;
      data[idx + 2] = color.b;
      data[idx + 3] = 255;
    };

    // Each row/column of a margin is extended with its own nearest interior-edge pixel, so
    // straight edges of the printed content stay straight and hard lines stay hard.
    const leftEdge = [], rightEdge = [];
    for (let y = 0; y < ih; y++) {
      leftEdge.push(colorAt(left, top + y));
      rightEdge.push(colorAt(w - right - 1, top + y));
    }
    const topEdge = [], bottomEdge = [];
    for (let x = 0; x < iw; x++) {
      topEdge.push(colorAt(left + x, top));
      bottomEdge.push(colorAt(left + x, h - bottom - 1));
    }

    for (let y = 0; y < ih; y++) {
      const rowY = top + y;
      for (let x = 0; x < left; x++) writePixel(x, rowY, leftEdge[y]);
      for (let x = 0; x < right; x++) writePixel(w - right + x, rowY, rightEdge[y]);
    }
    for (let x = 0; x < iw; x++) {
      const colX = left + x;
      for (let y = 0; y < top; y++) writePixel(colX, y, topEdge[x]);
      for (let y = 0; y < bottom; y++) writePixel(colX, h - bottom + y, bottomEdge[x]);
    }

    // Corners blend the two neighbouring edge colours by relative distance so they meet
    // both bands smoothly instead of leaving a hard seam.
    if (top > 0 && left > 0) fillCorner(data, w, 0, 0, left, top, true, true, leftEdge[0], topEdge[0]);
    if (top > 0 && right > 0) fillCorner(data, w, w - right, 0, right, top, false, true, rightEdge[0], topEdge[iw - 1]);
    if (bottom > 0 && left > 0) fillCorner(data, w, 0, h - bottom, left, bottom, true, false, leftEdge[ih - 1], bottomEdge[0]);
    if (bottom > 0 && right > 0) fillCorner(data, w, w - right, h - bottom, right, bottom, false, false, rightEdge[ih - 1], bottomEdge[iw - 1]);

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  return { fillMargins };
})();
