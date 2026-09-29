// Edge-color sampling and gap-fill helpers.
// Pure pixel-data utilities (no DOM canvas access) used by the core bleed algorithm
// to figure out what color the extended bleed border should be, and to patch holes
// left behind by corner/side removal before the border is generated.

// Walk inward from an edge and return the first opaque pixel's colour.
function sampleEdgeColor(data, w, h, startX, startY, stepX, stepY) {
    let x = startX;
    let y = startY;

    while (x >= 0 && x < w && y >= 0 && y < h) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] === 255) {
            return { r: data[idx], g: data[idx + 1], b: data[idx + 2], a: 255 };
        }

        x += stepX;
        y += stepY;
    }

    return getNearestVisiblePixel(data, w, h, startX, startY);
}

function mixColors(from, to, t) {
    return {
        r: Math.round(from.r + (to.r - from.r) * t),
        g: Math.round(from.g + (to.g - from.g) * t),
        b: Math.round(from.b + (to.b - from.b) * t),
        a: 255
    };
}

// Sample the left edge for a row.
function getLeftEdgeRowColor(data, w, h, rowY) {
    return sampleEdgeColor(data, w, h, 0, rowY, 1, 0);
}

// Sample the right edge for a row.
function getRightEdgeRowColor(data, w, h, rowY) {
    return sampleEdgeColor(data, w, h, w - 1, rowY, -1, 0);
}

// Normalize the first few source columns so the original card edge is consistent.
function normalizeLeftEdgeSource(filledData, originalData, w, h, width) {
    for (let y = 0; y < h; y++) {
        let needsNormalization = false;

        for (let x = 0; x < Math.min(width, w); x++) {
            const originalIdx = (y * w + x) * 4;
            if (originalData[originalIdx + 3] < 255) {
                needsNormalization = true;
                break;
            }
        }

        if (!needsNormalization) {
            continue;
        }

        const leftEdgeColor = getLeftEdgeRowColor(filledData, w, h, y);
        for (let x = 0; x < Math.min(width, w); x++) {
            const idx = (y * w + x) * 4;
            filledData[idx] = leftEdgeColor.r;
            filledData[idx + 1] = leftEdgeColor.g;
            filledData[idx + 2] = leftEdgeColor.b;
            filledData[idx + 3] = leftEdgeColor.a;
        }
    }
}

// Sample the top edge for a column.
function getTopEdgeColumnColor(data, w, h, colX) {
    return sampleEdgeColor(data, w, h, colX, 0, 0, 1);
}

// Sample the bottom edge for a column.
function getBottomEdgeColumnColor(data, w, h, colX) {
    return sampleEdgeColor(data, w, h, colX, h - 1, 0, -1);
}

// Normalize the first few top rows so the original card edge is consistent.
function normalizeTopEdgeSource(filledData, originalData, w, h, height) {
    for (let x = 0; x < w; x++) {
        let needsNormalization = false;

        for (let y = 0; y < Math.min(height, h); y++) {
            const originalIdx = (y * w + x) * 4;
            if (originalData[originalIdx + 3] < 255) {
                needsNormalization = true;
                break;
            }
        }

        if (!needsNormalization) {
            continue;
        }

        const topEdgeColor = getTopEdgeColumnColor(filledData, w, h, x);
        for (let y = 0; y < Math.min(height, h); y++) {
            const idx = (y * w + x) * 4;
            filledData[idx] = topEdgeColor.r;
            filledData[idx + 1] = topEdgeColor.g;
            filledData[idx + 2] = topEdgeColor.b;
            filledData[idx + 3] = topEdgeColor.a;
        }
    }
}

// Normalize the last few bottom rows so the original card edge is consistent.
function normalizeBottomEdgeSource(filledData, originalData, w, h, height) {
    for (let x = 0; x < w; x++) {
        let needsNormalization = false;

        for (let y = h - Math.min(height, h); y < h; y++) {
            const originalIdx = (y * w + x) * 4;
            if (originalData[originalIdx + 3] < 255) {
                needsNormalization = true;
                break;
            }
        }

        if (!needsNormalization) {
            continue;
        }

        const bottomEdgeColor = getBottomEdgeColumnColor(filledData, w, h, x);
        for (let y = h - Math.min(height, h); y < h; y++) {
            const idx = (y * w + x) * 4;
            filledData[idx] = bottomEdgeColor.r;
            filledData[idx + 1] = bottomEdgeColor.g;
            filledData[idx + 2] = bottomEdgeColor.b;
            filledData[idx + 3] = bottomEdgeColor.a;
        }
    }
}

// Normalize the last few source columns so the original card edge is consistent.
function normalizeRightEdgeSource(filledData, originalData, w, h, width) {
    for (let y = 0; y < h; y++) {
        let needsNormalization = false;

        for (let x = w - Math.min(width, w); x < w; x++) {
            const originalIdx = (y * w + x) * 4;
            if (originalData[originalIdx + 3] < 255) {
                needsNormalization = true;
                break;
            }
        }

        if (!needsNormalization) {
            continue;
        }

        const rightEdgeColor = getRightEdgeRowColor(filledData, w, h, y);
        for (let x = w - Math.min(width, w); x < w; x++) {
            const idx = (y * w + x) * 4;
            filledData[idx] = rightEdgeColor.r;
            filledData[idx + 1] = rightEdgeColor.g;
            filledData[idx + 2] = rightEdgeColor.b;
            filledData[idx + 3] = rightEdgeColor.a;
        }
    }
}

// Replace transparent pixels with the nearest opaque pixel along their row or column,
// so removed side strips keep the artwork's variation instead of a single flat color.
function fillTransparentPixels(sourceData, w, h) {
    const filledData = new Uint8ClampedArray(sourceData);
    const FAR = 0x3fffffff;
    const count = w * h;
    const hDist = new Int32Array(count);
    const hSrc = new Int32Array(count);
    const vDist = new Int32Array(count);
    const vSrc = new Int32Array(count);

    for (let y = 0; y < h; y++) {
        let last = -1;
        for (let x = 0; x < w; x++) {
            const p = y * w + x;
            if (sourceData[p * 4 + 3] === 255) {
                last = x;
                hDist[p] = 0;
                hSrc[p] = x;
            } else {
                hDist[p] = last === -1 ? FAR : x - last;
                hSrc[p] = last;
            }
        }

        last = -1;
        for (let x = w - 1; x >= 0; x--) {
            const p = y * w + x;
            if (sourceData[p * 4 + 3] === 255) {
                last = x;
            } else if (last !== -1 && last - x < hDist[p]) {
                hDist[p] = last - x;
                hSrc[p] = last;
            }
        }
    }

    for (let x = 0; x < w; x++) {
        let last = -1;
        for (let y = 0; y < h; y++) {
            const p = y * w + x;
            if (sourceData[p * 4 + 3] === 255) {
                last = y;
                vDist[p] = 0;
                vSrc[p] = y;
            } else {
                vDist[p] = last === -1 ? FAR : y - last;
                vSrc[p] = last;
            }
        }

        last = -1;
        for (let y = h - 1; y >= 0; y--) {
            const p = y * w + x;
            if (sourceData[p * 4 + 3] === 255) {
                last = y;
            } else if (last !== -1 && last - y < vDist[p]) {
                vDist[p] = last - y;
                vSrc[p] = last;
            }
        }
    }

    const unresolved = [];

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p = y * w + x;
            if (sourceData[p * 4 + 3] === 255) {
                continue;
            }

            let sourceIdx = -1;
            if (hSrc[p] !== -1 && hDist[p] <= vDist[p]) {
                sourceIdx = (y * w + hSrc[p]) * 4;
            } else if (vSrc[p] !== -1) {
                sourceIdx = (vSrc[p] * w + x) * 4;
            }

            if (sourceIdx === -1) {
                unresolved.push(p);
                continue;
            }

            const idx = p * 4;
            filledData[idx] = sourceData[sourceIdx];
            filledData[idx + 1] = sourceData[sourceIdx + 1];
            filledData[idx + 2] = sourceData[sourceIdx + 2];
            filledData[idx + 3] = 255;
        }
    }

    // Pixels with no opaque neighbour in their row or column (e.g. where two removed
    // sides overlap) are resolved against the already-filled data.
    for (const p of unresolved) {
        const x = p % w;
        const y = (p - x) / w;
        const color = getNearestVisiblePixel(filledData, w, h, x, y);
        const idx = p * 4;
        filledData[idx] = color.r;
        filledData[idx + 1] = color.g;
        filledData[idx + 2] = color.b;
        filledData[idx + 3] = 255;
    }

    return filledData;
}

// Find the nearest opaque pixel around a transparent sample.
function getNearestVisiblePixel(data, w, h, x, y) {
    const maxRadius = Math.max(w, h);

    for (let radius = 1; radius < maxRadius; radius++) {
        let totalR = 0;
        let totalG = 0;
        let totalB = 0;
        let totalA = 0;
        let count = 0;

        for (let dx = -radius; dx <= radius; dx++) {
            const topX = x + dx;
            const topY = y - radius;
            const bottomY = y + radius;

            if (topX >= 0 && topX < w && topY >= 0 && topY < h) {
                const topIdx = (topY * w + topX) * 4;
                if (data[topIdx + 3] > 0) {
                    totalR += data[topIdx];
                    totalG += data[topIdx + 1];
                    totalB += data[topIdx + 2];
                    totalA += data[topIdx + 3];
                    count++;
                }
            }

            if (topX >= 0 && topX < w && bottomY >= 0 && bottomY < h) {
                const bottomIdx = (bottomY * w + topX) * 4;
                if (data[bottomIdx + 3] > 0) {
                    totalR += data[bottomIdx];
                    totalG += data[bottomIdx + 1];
                    totalB += data[bottomIdx + 2];
                    totalA += data[bottomIdx + 3];
                    count++;
                }
            }
        }

        for (let dy = -radius + 1; dy <= radius - 1; dy++) {
            const leftX = x - radius;
            const rightX = x + radius;
            const sampleY = y + dy;

            if (leftX >= 0 && leftX < w && sampleY >= 0 && sampleY < h) {
                const leftIdx = (sampleY * w + leftX) * 4;
                if (data[leftIdx + 3] > 0) {
                    totalR += data[leftIdx];
                    totalG += data[leftIdx + 1];
                    totalB += data[leftIdx + 2];
                    totalA += data[leftIdx + 3];
                    count++;
                }
            }

            if (rightX >= 0 && rightX < w && sampleY >= 0 && sampleY < h) {
                const rightIdx = (sampleY * w + rightX) * 4;
                if (data[rightIdx + 3] > 0) {
                    totalR += data[rightIdx];
                    totalG += data[rightIdx + 1];
                    totalB += data[rightIdx + 2];
                    totalA += data[rightIdx + 3];
                    count++;
                }
            }
        }

        if (count > 0) {
            return {
                r: Math.round(totalR / count),
                g: Math.round(totalG / count),
                b: Math.round(totalB / count),
                a: Math.round(totalA / count)
            };
        }
    }

    return { r: 0, g: 0, b: 0, a: 0 };
}
