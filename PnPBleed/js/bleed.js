// Core bleed / image-processing algorithm: turns a trimmed card canvas into a canvas
// with extended-edge bleed, optionally after removing rounded corners and/or side strips.
// Depends on the helpers in sides.js (removeWhiteCorners) and edge.js
// (fillTransparentPixels, normalize*EdgeSource, sampleEdgeColor, mixColors).

// Convert mm to pixels based on card dimensions
function mmToPixels(mm, cardWidthMm, cardHeightMm, imageWidth, imageHeight) {
    // Calculate pixels per mm for width and height
    const pxPerMmWidth = imageWidth / cardWidthMm;
    const pxPerMmHeight = imageHeight / cardHeightMm;

    // Use average of both ratios for consistent scaling
    const avgPxPerMm = (pxPerMmWidth + pxPerMmHeight) / 2;
    return mm * avgPxPerMm;
}

// Add bleed to a card. Removed edge strips are cut off and become part of
// the bleed: the kept card is the source, and each side's bleed is the bleed
// amount plus what was removed there, so the output stays the image's size
// plus the bleed and the trim line stays at the image's edge. Removed corners
// are inside the card and are filled from their neighbours. Corner/edge trims
// are entered in mm and converted with pxPerMm (the image's resolution).
function addBleedToCard(sourceCanvas, bleedPx, pxPerMm) {
    // Shaped pieces get bleed around their outline; corner and edge removal
    // are for rectangular cards.
    if (elements.bleedMode.value === 'shape') return addShapeBleed(sourceCanvas, bleedPx);
    const W = sourceCanvas.width;
    const H = sourceCanvas.height;

    const trimPx = (checkbox, input) => (checkbox.checked ? Math.max(0, Math.round((parseFloat(input.value) || 0) * pxPerMm)) : 0);
    let left = trimPx(elements.removeLeftSideInput, elements.leftSideWidthInput);
    let right = trimPx(elements.removeRightSideInput, elements.rightSideWidthInput);
    let top = trimPx(elements.removeTopSideInput, elements.topSideHeightInput);
    let bottom = trimPx(elements.removeBottomSideInput, elements.bottomSideHeightInput);
    // Keep at least one pixel of card.
    if (left + right >= W) { left = Math.floor((W - 1) / 2); right = W - 1 - left; }
    if (top + bottom >= H) { top = Math.floor((H - 1) / 2); bottom = H - 1 - top; }
    const w = W - left - right;
    const h = H - top - bottom;

    // The kept card.
    let maskData = sourceCanvas.getContext('2d').getImageData(left, top, w, h).data;
    if (elements.removeWhiteCornersInput.checked) {
        const cornerSize = Math.max(1, Math.round((parseFloat(elements.cornerSizeInput.value) || 2.5) * pxPerMm));
        maskData = removeWhiteCorners(maskData, w, h, cornerSize);
    }
    // maskData still carries the holes, so it is the reference for what was removed.
    const sourceData = fillTransparentPixels(maskData, w, h);
    normalizeLeftEdgeSource(sourceData, maskData, w, h, 3);
    normalizeTopEdgeSource(sourceData, maskData, w, h, 3);
    normalizeBottomEdgeSource(sourceData, maskData, w, h, 3);
    normalizeRightEdgeSource(sourceData, maskData, w, h, 3);

    // Bleed on each side: the bleed amount plus the strip removed there.
    const pad = { left: bleedPx + left, right: bleedPx + right, top: bleedPx + top, bottom: bleedPx + bottom };
    const totalW = W + 2 * bleedPx;
    const totalH = H + 2 * bleedPx;
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = totalW;
    outputCanvas.height = totalH;
    const ctx = outputCanvas.getContext('2d');
    const outputImageData = ctx.createImageData(totalW, totalH);
    const outputData = outputImageData.data;

    // The kept card in place
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const srcIdx = (y * w + x) * 4;
            const destIdx = ((y + pad.top) * totalW + (x + pad.left)) * 4;
            outputData[destIdx] = sourceData[srcIdx];
            outputData[destIdx + 1] = sourceData[srcIdx + 1];
            outputData[destIdx + 2] = sourceData[srcIdx + 2];
            outputData[destIdx + 3] = sourceData[srcIdx + 3];
        }
    }

    const mode = elements.bleedMode.value;
    if (mode === 'mirror' || mode === 'solid') {
        fillBleedZone(outputData, totalW, totalH, pad, sourceData, w, h, mode);
        ctx.putImageData(outputImageData, 0, 0);
        return outputCanvas;
    }

    // Each row/column is extended with its own outermost pixel, so the bleed is an exact
    // continuation of the trim line and hard lines stay hard.
    const leftEdge = [];
    const rightEdge = [];
    for (let y = 0; y < h; y++) {
        leftEdge.push(sampleEdgeColor(sourceData, w, h, 0, y, 1, 0));
        rightEdge.push(sampleEdgeColor(sourceData, w, h, w - 1, y, -1, 0));
    }
    const topEdge = [];
    const bottomEdge = [];
    for (let x = 0; x < w; x++) {
        topEdge.push(sampleEdgeColor(sourceData, w, h, x, 0, 0, 1));
        bottomEdge.push(sampleEdgeColor(sourceData, w, h, x, h - 1, 0, -1));
    }

    const writeBleedPixel = (x, y, color) => {
        const idx = (y * totalW + x) * 4;
        outputData[idx] = color.r;
        outputData[idx + 1] = color.g;
        outputData[idx + 2] = color.b;
        outputData[idx + 3] = 255;
    };
    for (let y = 0; y < h; y++) {
        for (let i = 0; i < pad.left; i++) writeBleedPixel(pad.left - 1 - i, y + pad.top, leftEdge[y]);
        for (let i = 0; i < pad.right; i++) writeBleedPixel(pad.left + w + i, y + pad.top, rightEdge[y]);
    }
    for (let x = 0; x < w; x++) {
        for (let i = 0; i < pad.top; i++) writeBleedPixel(x + pad.left, pad.top - 1 - i, topEdge[x]);
        for (let i = 0; i < pad.bottom; i++) writeBleedPixel(x + pad.left, pad.top + h + i, bottomEdge[x]);
    }

    // Corners blend the two neighbouring edge colours by angle so they meet both bands.
    fillCornerBleed(outputData, totalW, 0, 0, pad.left, pad.top, 'top-left', topEdge[0], leftEdge[0]);
    fillCornerBleed(outputData, totalW, totalW - pad.right, 0, pad.right, pad.top, 'top-right', topEdge[w - 1], rightEdge[0]);
    fillCornerBleed(outputData, totalW, 0, totalH - pad.bottom, pad.left, pad.bottom, 'bottom-left', bottomEdge[0], leftEdge[h - 1]);
    fillCornerBleed(outputData, totalW, totalW - pad.right, totalH - pad.bottom, pad.right, pad.bottom, 'bottom-right', bottomEdge[w - 1], rightEdge[h - 1]);

    ctx.putImageData(outputImageData, 0, 0);
    return outputCanvas;
}

// Fill a corner bleed box (cw × ch at x0, y0) by blending the horizontal and
// vertical edge colours.
function fillCornerBleed(outputData, totalW, x0, y0, cw, ch, corner, verticalColor, horizontalColor) {
    const isLeft = corner === 'top-left' || corner === 'bottom-left';
    const isTop = corner === 'top-left' || corner === 'top-right';
    for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
            // Distances outside the card; the nearer band dominates.
            const horizontalOut = isLeft ? cw - x : x + 1;
            const verticalOut = isTop ? ch - y : y + 1;
            const color = mixColors(horizontalColor, verticalColor, verticalOut / (horizontalOut + verticalOut));
            const idx = ((y0 + y) * totalW + (x0 + x)) * 4;
            outputData[idx] = color.r;
            outputData[idx + 1] = color.g;
            outputData[idx + 2] = color.b;
            outputData[idx + 3] = 255;
        }
    }
}

// Mirror or solid-colour bleed: every pixel outside the trim area is either a
// reflection of the artwork across the nearest edge, or the chosen colour.
function fillBleedZone(outputData, totalW, totalH, pad, sourceData, w, h, mode) {
    const reflect = (i, n) => {
        if (i < 0) i = -i - 1;
        if (i >= n) i = 2 * n - i - 1;
        return Math.max(0, Math.min(n - 1, i));
    };
    const solid = hexToRgb(elements.bleedColor.value);
    for (let y = 0; y < totalH; y++) {
        for (let x = 0; x < totalW; x++) {
            const ix = x - pad.left, iy = y - pad.top;
            if (ix >= 0 && ix < w && iy >= 0 && iy < h) continue;
            const o = (y * totalW + x) * 4;
            if (mode === 'solid') {
                outputData[o] = solid.r;
                outputData[o + 1] = solid.g;
                outputData[o + 2] = solid.b;
            } else {
                const s = (reflect(iy, h) * w + reflect(ix, w)) * 4;
                outputData[o] = sourceData[s];
                outputData[o + 1] = sourceData[s + 1];
                outputData[o + 2] = sourceData[s + 2];
            }
            outputData[o + 3] = 255;
        }
    }
}

function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex) || [0, '00', '00', '00'];
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
