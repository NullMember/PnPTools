// Piece images: loading (with DPI detection and transparent-border trimming),
// finding the piece inside bleed the image already has, the alpha mask, the
// traced cut outline and the rotated/dilated packing footprints. Layout
// doesn't add bleed: that's Bleed's job.

const ALPHA_THRESHOLD = 128; // alpha at or above this counts as part of the piece
const DEFAULT_DPI = 300;
const OUTLINE_MAX_DIM = 1200; // outlines are traced on a copy no larger than this

// ---- DPI metadata -------------------------------------------------------------

// DPI stored in the image file (shared/pnp-shared.js); null if absent.
function readImageDpi(file) {
    return PnP.readImageDpi(file);
}

// ---- Loading ---------------------------------------------------------------------

function loadBitmap(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read ${file.name}`)); };
        img.src = url;
    });
}

// A "face" is one side of a piece: the trimmed image plus derived data.
async function loadFace(file) {
    const [img, dpi, bleedNote] = await Promise.all([loadBitmap(file), readImageDpi(file), PnP.readPngText(file, 'PnPTools:bleed')]);
    const full = document.createElement('canvas');
    full.width = img.naturalWidth;
    full.height = img.naturalHeight;
    const fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.drawImage(img, 0, 0);
    const data = fctx.getImageData(0, 0, full.width, full.height).data;

    // Trim fully transparent borders so the size refers to the visible piece.
    let x0 = full.width, y0 = full.height, x1 = -1, y1 = -1;
    for (let y = 0; y < full.height; y++) {
        for (let x = 0; x < full.width; x++) {
            if (data[(y * full.width + x) * 4 + 3] > 0) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    if (x1 < 0) throw new Error(`${file.name} is completely transparent.`);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(full, x0, y0, w, h, 0, 0, w, h);

    // bleedMm: the bleed Bleed recorded in the image (null if none recorded).
    const bleedMm = bleedNote !== null && Number.isFinite(parseFloat(bleedNote)) ? parseFloat(bleedNote) : null;
    const face = { file, full: canvas, dpi: dpi || null, bleedMm, preview: scaledCopy(canvas, 400) };
    setFaceInset(face, 0);
    return face;
}

// Images that already include bleed: `insetPx` is trimmed off all round to
// get the piece itself (its size, mask, cut outline, footprint). A card
// loses a strip from each side; a shape (bleed that follows its outline)
// shrinks by that much all round. The whole image, bleed included, is still
// what gets printed (see faceComposite).
function setFaceInset(face, insetPx) {
    const full = fullFace(face);
    const limit = Math.floor((Math.min(full.w, full.h) - 2) / 2);
    insetPx = Math.max(0, Math.min(limit, Math.round(insetPx)));
    let canvas = face.full;
    if (insetPx) {
        canvas = document.createElement('canvas');
        canvas.width = full.w - 2 * insetPx;
        canvas.height = full.h - 2 * insetPx;
        canvas.getContext('2d', { willReadFrequently: true }).drawImage(face.full, -insetPx, -insetPx);
    }
    Object.assign(face, { inset: insetPx, canvas, w: canvas.width, h: canvas.height, cache: new Map() });
    if (insetPx && !full.isRect) {
        // The shape inside its bleed: the whole image's mask eroded by the inset.
        const eroded = erodeMask(full.mask, full.w, full.h, insetPx);
        const mask = new Uint8Array(face.w * face.h);
        for (let y = 0; y < face.h; y++) {
            mask.set(eroded.subarray((y + insetPx) * full.w + insetPx, (y + insetPx) * full.w + insetPx + face.w), y * face.w);
        }
        buildMask(face, mask);
    } else {
        buildMask(face);
    }
    face.outline = traceOutline(face);
}

// The whole image (transparent border trimmed), as a face of its own. Made once.
function fullFace(face) {
    if (!face._full) {
        face._full = { canvas: face.full, w: face.full.width, h: face.full.height };
        buildMask(face._full);
    }
    return face._full;
}

// Mask pixels further than r from the shape's edge (two-pass 3-4 chamfer
// distance, within a few percent of the true distance).
function erodeMask(mask, w, h, r) {
    const INF = 1e9;
    const d = new Float64Array(w * h);
    for (let i = 0; i < w * h; i++) d[i] = mask[i] ? INF : 0;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (!d[i]) continue;
            d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
        }
    }
    for (let y = h - 1; y >= 0; y--) {
        for (let x = w - 1; x >= 0; x--) {
            const i = y * w + x;
            if (!d[i]) continue;
            d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
        }
    }
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = d[i] > 3 * r ? 1 : 0;
    return out;
}

function scaledCopy(src, maxDim) {
    const s = Math.min(1, maxDim / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * s));
    c.height = Math.max(1, Math.round(src.height * s));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
}

// ---- Mask ------------------------------------------------------------------------

// face.mask: Uint8Array (1 = piece) and face.maskCanvas: black where the
// piece is. The mask comes from the image's alpha unless one is given.
function buildMask(face, given = null) {
    const { w, h, canvas } = face;
    let mask = given;
    if (!mask) {
        const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
        mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] >= ALPHA_THRESHOLD) mask[i] = 1;
    }
    let transparent = 0;
    for (let i = 0; i < w * h; i++) if (!mask[i]) transparent++;
    face.mask = mask;
    face.isRect = transparent === 0;
    face.area = w * h - transparent;

    const mc = document.createElement('canvas');
    mc.width = w;
    mc.height = h;
    const mctx = mc.getContext('2d');
    const img = mctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) img.data[i * 4 + 3] = mask[i] ? 255 : 0;
    mctx.putImageData(img, 0, 0);
    face.maskCanvas = mc;
}

// ---- Outline tracing -------------------------------------------------------------

// Outer boundary of the largest connected region, as a polygon in face
// pixels (origin top-left). Rectangles short-circuit to their corners.
function traceOutline(face) {
    if (face.isRect) return [[0, 0], [face.w, 0], [face.w, face.h], [0, face.h]];

    // Work on a bounded-size copy of the mask.
    const s = Math.min(1, OUTLINE_MAX_DIM / Math.max(face.w, face.h));
    const W = Math.max(1, Math.round(face.w * s));
    const H = Math.max(1, Math.round(face.h * s));
    let mask = face.mask;
    if (s < 1) {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(face.maskCanvas, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        mask = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) mask[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
    }

    // Label connected regions (4-connected) and keep the largest.
    const labels = new Int32Array(W * H);
    let bestLabel = 0, bestSize = 0, bestStart = -1, label = 0;
    const stack = [];
    for (let i = 0; i < W * H; i++) {
        if (!mask[i] || labels[i]) continue;
        label++;
        let size = 0;
        stack.push(i);
        labels[i] = label;
        while (stack.length) {
            const j = stack.pop();
            size++;
            const x = j % W, y = (j - x) / W;
            if (x > 0 && mask[j - 1] && !labels[j - 1]) { labels[j - 1] = label; stack.push(j - 1); }
            if (x < W - 1 && mask[j + 1] && !labels[j + 1]) { labels[j + 1] = label; stack.push(j + 1); }
            if (y > 0 && mask[j - W] && !labels[j - W]) { labels[j - W] = label; stack.push(j - W); }
            if (y < H - 1 && mask[j + W] && !labels[j + W]) { labels[j + W] = label; stack.push(j + W); }
        }
        if (size > bestSize) { bestSize = size; bestLabel = label; bestStart = i; }
    }
    if (bestStart < 0) return [[0, 0], [face.w, 0], [face.w, face.h], [0, face.h]];

    // Walk the region's outer boundary along pixel edges (the first pixel in
    // raster order is on the outer boundary, with its top edge exposed).
    const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && labels[y * W + x] === bestLabel;
    const sx = bestStart % W, sy = (bestStart - sx) / W;
    // Directions: 0 right, 1 down, 2 left, 3 up. We walk corners with the region on our right.
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    let x = sx, y = sy, dir = 0;
    const pts = [[x, y]];
    const limit = 4 * (W + 1) * (H + 1);
    for (let n = 0; n < limit; n++) {
        // Pixels ahead-left and ahead-right of the current corner, facing dir.
        const aheadRight = pixelAt(x, y, dir, true);
        const aheadLeft = pixelAt(x, y, dir, false);
        if (inside(...aheadLeft)) dir = (dir + 3) % 4;        // turn left
        else if (!inside(...aheadRight)) dir = (dir + 1) % 4; // turn right
        x += DX[dir];
        y += DY[dir];
        if (x === sx && y === sy) break;
        pts.push([x, y]);
    }

    // Pixel staircases -> smooth polygon, then back to full-resolution pixels.
    // Smoothing works on every unit step: averaging after merging straight
    // runs used to cut whole corners off shapes with long straight edges.
    const simplified = simplifyPolygon(smoothPolygon(pts), 0.6);
    return simplified.map(([px, py]) => [px / s, py / s]);

    // The pixel whose corner we stand on, ahead of us and to one side.
    function pixelAt(cx, cy, d, right) {
        // Corner (cx, cy) touches pixels (cx-1|cx, cy-1|cy).
        switch (d) {
            case 0: return right ? [cx, cy] : [cx, cy - 1];
            case 1: return right ? [cx - 1, cy] : [cx, cy];
            case 2: return right ? [cx - 1, cy - 1] : [cx - 1, cy];
            default: return right ? [cx, cy - 1] : [cx - 1, cy - 1];
        }
    }
}

// Midpoint smoothing turns 1-pixel staircases into diagonals.
function smoothPolygon(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    }
    return out;
}

// Douglas–Peucker on a closed polygon.
function simplifyPolygon(pts, tolerance) {
    if (pts.length < 8) return pts;
    const dp = (list) => {
        if (list.length < 3) return list;
        const [ax, ay] = list[0], [bx, by] = list[list.length - 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        let maxD = -1, idx = 0;
        for (let i = 1; i < list.length - 1; i++) {
            const d = Math.abs((by - ay) * list[i][0] - (bx - ax) * list[i][1] + bx * ay - by * ax) / len;
            if (d > maxD) { maxD = d; idx = i; }
        }
        if (maxD <= tolerance) return [list[0], list[list.length - 1]];
        return dp(list.slice(0, idx + 1)).slice(0, -1).concat(dp(list.slice(idx)));
    };
    // Split at the point farthest from the start so both halves are open chains.
    let far = 0, farD = -1;
    pts.forEach((p, i) => {
        const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
        if (d > farD) { farD = d; far = i; }
    });
    const first = dp(pts.slice(0, far + 1));
    const second = dp(pts.slice(far).concat([pts[0]]));
    return first.slice(0, -1).concat(second.slice(0, -1));
}

// ---- Packing footprints ------------------------------------------------------------

// Footprints for the allowed rotations of a piece at the given physical size.
// Each covers the shape at `cell` mm resolution, dilated by `pad` cells.
function buildFootprints(face, widthMm, heightMm, cellMm, pad, angles) {
    const key = `fp:${widthMm}:${heightMm}:${cellMm}:${pad}:${angles.join(',')}`;
    if (face.cache.has(key)) return face.cache.get(key);

    const seen = new Set();
    const footprints = [];
    const disk = [];
    for (let dy = -pad; dy <= pad; dy++) {
        for (let dx = -pad; dx <= pad; dx++) if (dx * dx + dy * dy <= pad * pad + pad) disk.push([dx, dy]);
    }

    for (const angle of angles) {
        const rad = (angle * Math.PI) / 180;
        const wc = widthMm / cellMm;
        const hc = heightMm / cellMm;
        const bw = Math.abs(wc * Math.cos(rad)) + Math.abs(hc * Math.sin(rad));
        const bh = Math.abs(wc * Math.sin(rad)) + Math.abs(hc * Math.cos(rad));
        const W = Math.ceil(bw) + 2 * pad + 2;
        const H = Math.ceil(bh) + 2 * pad + 2;

        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.translate(W / 2, H / 2);
        ctx.rotate(rad);
        ctx.drawImage(face.maskCanvas, -wc / 2, -hc / 2, wc, hc);
        const alpha = ctx.getImageData(0, 0, W, H).data;

        // Any coverage counts (conservative), then dilate by the half-gap.
        const base = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) base[i] = alpha[i * 4 + 3] > 8 ? 1 : 0;
        let cells = base;
        if (pad > 0) {
            cells = new Uint8Array(W * H);
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    if (!base[y * W + x]) continue;
                    for (const [dx, dy] of disk) {
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && ny >= 0 && nx < W && ny < H) cells[ny * W + nx] = 1;
                    }
                }
            }
        }

        // Crop to used rows/cols and convert to spans.
        let x0 = W, y0 = H, x1 = -1, y1 = -1, area = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (cells[y * W + x]) {
                    area++;
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    if (y > y1) y1 = y;
                }
            }
        }
        if (x1 < 0) continue;
        const spans = [];
        for (let y = y0; y <= y1; y++) {
            let x = x0;
            while (x <= x1) {
                while (x <= x1 && !cells[y * W + x]) x++;
                if (x > x1) break;
                const start = x;
                while (x <= x1 && cells[y * W + x]) x++;
                spans.push(y - y0, start - x0, x - x0);
            }
        }
        // Rotations that give the exact same footprint (circles, squares…) add nothing.
        const sig = `${x1 - x0}x${y1 - y0}:${spans.join(',')}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        footprints.push({
            angle,
            w: x1 - x0 + 1,
            h: y1 - y0 + 1,
            cx: W / 2 - x0,
            cy: H / 2 - y0,
            area,
            spans: Int32Array.from(spans),
        });
    }
    footprints.sort((a, b) => a.angle - b.angle);
    face.cache.set(key, footprints);
    return footprints;
}
