// "Follow the shape" bleed, for images with a transparent background (tokens,
// coins, odd shapes): the colours at the shape's edge are pushed outward by
// bleedPx all round its outline, into the transparent surroundings. Pixels
// further out stay transparent, so the result keeps the shape.

const SHAPE_ALPHA = 128; // alpha at or above this is part of the shape

function addShapeBleed(sourceCanvas, bleedPx) {
    bleedPx = Math.max(0, Math.round(bleedPx));
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const W = w + 2 * bleedPx;
    const H = h + 2 * bleedPx;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(sourceCanvas, bleedPx, bleedPx);
    if (!bleedPx) return out;

    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    // origin[i]: the nearest shape pixel found so far (-1 = none). Growing ring
    // by ring and keeping the nearest origin gives a round (Euclidean) bleed
    // edge; each bleed pixel takes its origin's colour.
    const origin = new Int32Array(W * H).fill(-1);
    let frontier = [];
    for (let i = 0; i < W * H; i++) {
        if (d[i * 4 + 3] >= SHAPE_ALPHA) {
            origin[i] = i;
            frontier.push(i);
        }
    }
    const maxD2 = (bleedPx + 0.5) * (bleedPx + 0.5);
    const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    const filled = new Uint8Array(W * H);
    while (frontier.length) {
        const next = [];
        for (const i of frontier) {
            const x = i % W, y = (i - x) / W;
            const o = origin[i];
            const ox = o % W, oy = (o - ox) / W;
            for (const [dx, dy] of offsets) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const j = ny * W + nx;
                const d2 = (nx - ox) * (nx - ox) + (ny - oy) * (ny - oy);
                if (d2 > maxD2) continue;
                const cur = origin[j];
                if (cur === j) continue; // a shape pixel
                if (cur >= 0) {
                    const cx = cur % W, cy = (cur - cx) / W;
                    if ((nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) <= d2) continue;
                }
                origin[j] = o;
                next.push(j);
                filled[j] = 1;
            }
        }
        frontier = next;
    }
    for (let i = 0; i < W * H; i++) {
        if (!filled[i]) continue;
        const o = origin[i];
        d[i * 4] = d[o * 4];
        d[i * 4 + 1] = d[o * 4 + 1];
        d[i * 4 + 2] = d[o * 4 + 2];
        d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.drawImage(sourceCanvas, bleedPx, bleedPx); // soft (half-transparent) edges on top
    return out;
}
