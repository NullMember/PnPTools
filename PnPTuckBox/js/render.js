// Placing box pieces on paper, and drawing them: preview canvas, PDF (art as
// one raster per page + vector cut/fold lines) and SVG cut file.

const MM_TO_PT = 72 / 25.4;
const MIN_PIECE_GAP = 6; // mm between pieces sharing a page (grows with the bleed)

// ---- Page placement -------------------------------------------------------------------

// A piece on a page: x, y = top-left of its (possibly rotated) bounding box.
function placedSize(piece, rot) {
    return rot ? { w: piece.height, h: piece.width } : { w: piece.width, h: piece.height };
}

// Pieces in one row or column, each optionally turned 90°, on as few pages as
// possible. A piece that fits no page orientation is still placed, and flagged.
function layoutPages(pieces, paper, margin, bleed = 0) {
    const PIECE_GAP = Math.max(MIN_PIECE_GAP, 2 * bleed + 3);
    const aw = paper.w - 2 * margin;
    const ah = paper.h - 2 * margin;
    const fits = (s) => s.w <= aw + 0.01 && s.h <= ah + 0.01;

    // Try all pieces together (≤ 2 pieces in practice).
    const combos = [];
    const n = pieces.length;
    for (let mask = 0; mask < 1 << n; mask++) {
        const sizes = pieces.map((p, i) => placedSize(p, (mask >> i) & 1));
        const row = { w: sizes.reduce((a, s) => a + s.w, 0) + PIECE_GAP * (n - 1), h: Math.max(...sizes.map((s) => s.h)) };
        const col = { w: Math.max(...sizes.map((s) => s.w)), h: sizes.reduce((a, s) => a + s.h, 0) + PIECE_GAP * (n - 1) };
        if (fits(row)) combos.push({ mask, dir: 'row', size: row, sizes });
        if (fits(col)) combos.push({ mask, dir: 'col', size: col, sizes });
    }
    if (combos.length) {
        const c = combos[0];
        let cx = margin + (aw - c.size.w) / 2;
        let cy = margin + (ah - c.size.h) / 2;
        const items = pieces.map((piece, i) => {
            const s = c.sizes[i];
            const item = {
                piece,
                rot: (c.mask >> i) & 1,
                x: c.dir === 'row' ? cx : margin + (aw - s.w) / 2,
                y: c.dir === 'col' ? cy : margin + (ah - s.h) / 2,
                fits: true,
            };
            if (c.dir === 'row') cx += s.w + PIECE_GAP; else cy += s.h + PIECE_GAP;
            return item;
        });
        return [{ items }];
    }

    // One piece per page, in whichever orientation fits (or the better one).
    return pieces.map((piece) => {
        let rot = fits(placedSize(piece, 0)) ? 0 : fits(placedSize(piece, 1)) ? 1 : null;
        const ok = rot !== null;
        if (!ok) {
            // Neither fits: keep the orientation that overflows least.
            const over = (s) => Math.max(0, s.w - aw) + Math.max(0, s.h - ah);
            rot = over(placedSize(piece, 1)) < over(placedSize(piece, 0)) ? 1 : 0;
        }
        const s = placedSize(piece, rot);
        return { items: [{ piece, rot, x: margin + (aw - s.w) / 2, y: margin + (ah - s.h) / 2, fits: ok }] };
    });
}

// Piece coordinates -> page coordinates (mm).
function toPage(item) {
    return ([x, y]) => (item.rot ? [item.x + item.piece.height - y, item.y + x] : [item.x + x, item.y + y]);
}

// Canvas transform equivalent of toPage, for drawing in piece coordinates.
function applyPieceTransform(ctx, item) {
    ctx.translate(item.x, item.y);
    if (item.rot) {
        ctx.translate(item.piece.height, 0);
        ctx.rotate(Math.PI / 2);
    }
}

function polyPath(points) {
    const p = new Path2D();
    points.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    return p;
}

// ---- Artwork ---------------------------------------------------------------------------

function isWhite(hex) {
    return /^#?f{6}$/i.test(hex);
}

// Draw background + panel artwork for one piece, in piece mm coordinates.
function drawPieceArt(ctx, piece, art, opts) {
    // Background: the outline filled and stroked 2 × bleed wide, which grows
    // the shape by the bleed on every side (with rounded corners).
    if (!isWhite(opts.bgColor) || opts.forceBackground) {
        ctx.save();
        ctx.fillStyle = opts.bgColor;
        ctx.strokeStyle = opts.bgColor;
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(0.01, 2 * opts.bleed);
        piece.cuts.forEach((loop) => {
            const path = polyPath(loop);
            ctx.fill(path);
            if (opts.bleed > 0) ctx.stroke(path);
        });
        ctx.restore();
    }

    const withArt = piece.panels
        .map((panel) => ({ panel, a: panel.slot && art[panel.slot] }))
        .filter(({ a }) => a);
    const b = Math.max(0, opts.bleed);

    // Artwork inside its panel.
    withArt.forEach(({ panel, a }) => drawPanelArt(ctx, panel, a, polyPath(panel.poly), b));

    // Artwork bleed: each panel's art continues past the cut line, but never
    // over another part of the piece (flaps keep the background). Corners go
    // first so that where two panels meet, the edge strips win.
    if (b > 0 && withArt.length) {
        const outside = new Path2D();
        outside.rect(-1e4, -1e4, 2e4, 2e4);
        piece.cuts.forEach((loop) => outside.addPath(polyPath(loop)));
        const grown = ({ x, y, w, h }) => {
            const p = new Path2D();
            p.rect(x - b, y - b, w + 2 * b, h + 2 * b);
            return p;
        };
        const strips = ({ x, y, w, h }) => {
            const p = new Path2D();
            p.rect(x, y - b, w, h + 2 * b);
            p.rect(x - b, y, w + 2 * b, h);
            return p;
        };
        [grown, strips].forEach((region) => withArt.forEach(({ panel, a }) => {
            ctx.save();
            ctx.clip(outside, 'evenodd');
            drawPanelArt(ctx, panel, a, region(panel.box), b);
            ctx.restore();
        }));
    }
}

// One panel's art, clipped to `clip`, covering the panel box plus `bleed`.
function drawPanelArt(ctx, panel, a, clip, bleed) {
    const { x, y, w, h } = panel.box;
    const rot = ((panel.artRot || 0) + (a.rot || 0)) % 360;
    ctx.save();
    ctx.clip(clip);
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((rot * Math.PI) / 180);
    // In the rotated frame the target box is swapped for 90/270.
    const tw = rot % 180 ? h : w;
    const th = rot % 180 ? w : h;
    drawFitted(ctx, a.img, tw, th, a, bleed);
    ctx.restore();
}

// Draw `img` into a tw × th box centred on the origin. a: { mode, crop, zoom, dx, dy }
//   mode     fill: cover the box, cropping the excess · fit: the whole image
//            inside the box · stretch: exactly the box · extend: fit, then
//            stretch the image's outermost pixels out to the box edges
//   crop     the part of the image used, as fractions { x, y, w, h } (whole image if absent)
//   zoom     scale on top of the mode (1 = as the mode sizes it)
//   dx, dy   pan, as fractions of the box size
// Wherever the art reaches a box edge (always, for extend), it continues
// `bleed` further out: with the image itself if it overflows, else by
// stretching its edge pixels.
function drawFitted(ctx, img, tw, th, a = {}, bleed = 0) {
    const mode = a.mode || 'fill';
    const src = croppedSource(img, a.crop);
    const iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
    let dw = tw, dh = th;
    if (mode !== 'stretch') {
        const s = mode === 'fill' ? Math.max(tw / iw, th / ih) : Math.min(tw / iw, th / ih);
        dw = iw * s;
        dh = ih * s;
    }
    const zoom = a.zoom > 0 ? a.zoom : 1;
    dw *= zoom;
    dh *= zoom;
    const cx = (a.dx || 0) * tw, cy = (a.dy || 0) * th;
    const L = cx - dw / 2, R = cx + dw / 2, T = cy - dh / 2, B = cy + dh / 2;
    const eps = 1e-3;
    // How far the art reaches on one side: past the box edge by the bleed if
    // it touches that edge, else just its own edge (the background shows).
    const reach = (edge, boxEdge, dir) => {
        const touches = mode === 'extend' || (dir < 0 ? edge <= boxEdge + eps : edge >= boxEdge - eps);
        if (!touches) return edge;
        const target = boxEdge + dir * bleed;
        return dir < 0 ? Math.min(edge, target) : Math.max(edge, target);
    };
    const xL = reach(L, -tw / 2, -1), xR = reach(R, tw / 2, 1);
    const yT = reach(T, -th / 2, -1), yB = reach(B, th / 2, 1);
    const gl = L - xL, gr = xR - R, gt = T - yT, gb = yB - B;
    if (gl > eps || gr > eps || gt > eps || gb > eps) {
        const e = edgeStrips(src);
        const o = Math.min(0.5, dw / 2, dh / 2); // overlap under the image so no anti-aliased seam shows
        if (gl > eps) ctx.drawImage(e.left, xL, T, gl + o, dh);
        if (gr > eps) ctx.drawImage(e.right, R - o, T, gr + o, dh);
        if (gt > eps) ctx.drawImage(e.top, L, yT, dw, gt + o);
        if (gb > eps) ctx.drawImage(e.bottom, L, B - o, dw, gb + o);
        if (gl > eps && gt > eps) ctx.drawImage(e.tl, xL, yT, gl + o, gt + o);
        if (gr > eps && gt > eps) ctx.drawImage(e.tr, R - o, yT, gr + o, gt + o);
        if (gl > eps && gb > eps) ctx.drawImage(e.bl, xL, B - o, gl + o, gb + o);
        if (gr > eps && gb > eps) ctx.drawImage(e.br, R - o, B - o, gr + o, gb + o);
    }
    ctx.drawImage(src, L, T, dw, dh);
}

// The kept part of a cropped image, as its own canvas, so scaling and edge
// strips only ever see those pixels. Cached per image and crop.
const cropCache = new WeakMap();
function croppedSource(img, crop) {
    if (!crop || (crop.x <= 0 && crop.y <= 0 && crop.w >= 1 && crop.h >= 1)) return img;
    let cache = cropCache.get(img);
    if (!cache) cropCache.set(img, (cache = new Map()));
    const key = [crop.x, crop.y, crop.w, crop.h].map((v) => v.toFixed(4)).join(',');
    let c = cache.get(key);
    if (!c) {
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        const sx = Math.round(crop.x * iw), sy = Math.round(crop.y * ih);
        const sw = Math.max(1, Math.round(crop.w * iw)), sh = Math.max(1, Math.round(crop.h * ih));
        c = document.createElement('canvas');
        c.width = sw;
        c.height = sh;
        c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        if (cache.size >= 8) cache.clear(); // crops change while editing; keep only recent ones
        cache.set(key, c);
    }
    return c;
}

// One-pixel edge rows/columns (and corner pixels) of an image as their own canvases, so stretching
// them never samples neighbouring pixels. Cached per image.
const edgeStripCache = new WeakMap();
function edgeStrips(img) {
    let e = edgeStripCache.get(img);
    if (e) return e;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const strip = (sx, sy, sw, sh) => {
        const c = document.createElement('canvas');
        c.width = sw;
        c.height = sh;
        c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        return c;
    };
    e = {
        left: strip(0, 0, 1, ih), right: strip(iw - 1, 0, 1, ih), top: strip(0, 0, iw, 1), bottom: strip(0, ih - 1, iw, 1),
        tl: strip(0, 0, 1, 1), tr: strip(iw - 1, 0, 1, 1), bl: strip(0, ih - 1, 1, 1), br: strip(iw - 1, ih - 1, 1, 1),
    };
    edgeStripCache.set(img, e);
    return e;
}

// ---- Preview ---------------------------------------------------------------------------

function drawPagePreview(canvas, page, ctxInfo) {
    const { paper, art, opts, maxWidth, showLabels } = ctxInfo;
    const k = maxWidth / paper.w;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(paper.w * k * dpr);
    canvas.height = Math.round(paper.h * k * dpr);
    canvas.style.width = `${Math.round(paper.w * k)}px`;
    canvas.style.height = `${Math.round(paper.h * k)}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr * k, dpr * k);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, paper.w, paper.h);

    // Printable area
    ctx.save();
    ctx.strokeStyle = '#c9d3ff';
    ctx.lineWidth = 0.4;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(opts.margin, opts.margin, paper.w - 2 * opts.margin, paper.h - 2 * opts.margin);
    ctx.restore();

    page.items.forEach((item) => {
        ctx.save();
        applyPieceTransform(ctx, item);
        drawPieceArt(ctx, item.piece, art, opts);

        // Glue areas
        ctx.fillStyle = 'rgba(64, 192, 87, 0.28)';
        item.piece.panels.filter((p) => p.glue).forEach((p) => ctx.fill(polyPath(p.poly)));

        // Fold lines
        ctx.strokeStyle = '#2b6cb0';
        ctx.lineWidth = 0.35;
        ctx.setLineDash([2, 1.2]);
        item.piece.folds.forEach(([a, b]) => {
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.stroke();
        });
        // Cut lines
        ctx.setLineDash([]);
        ctx.strokeStyle = item.fits ? '#e03131' : '#ff00aa';
        ctx.lineWidth = 0.4;
        item.piece.cuts.forEach((loop) => ctx.stroke(polyPath(loop)));
        item.piece.slits.forEach(([a, b]) => {
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.stroke();
        });

        if (showLabels) {
            // Dark text with a light halo stays readable on any artwork.
            ctx.fillStyle = 'rgba(20, 24, 40, 0.85)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.lineJoin = 'round';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            item.piece.panels.forEach((p) => {
                const { x, y, w, h } = p.box;
                const size = Math.min(4, Math.max(1.6, Math.min(w, h) / 5));
                ctx.font = `600 ${size}px sans-serif`;
                ctx.save();
                ctx.translate(x + w / 2, y + h / 2);
                if (h > w * 1.6 && w < 25) ctx.rotate(-Math.PI / 2);
                ctx.lineWidth = size * 0.3;
                ctx.strokeText(p.name, 0, 0);
                ctx.fillText(p.name, 0, 0);
                ctx.restore();
            });
        }
        ctx.restore();
    });
    return k;
}

// Which artwork slot is under a point (page mm)? Used for drag-and-drop.
function slotAt(page, xMm, yMm) {
    const ctx = document.createElement('canvas').getContext('2d');
    for (const item of page.items) {
        const map = toPage(item);
        for (const panel of item.piece.panels) {
            if (!panel.slot) continue;
            if (ctx.isPointInPath(polyPath(panel.poly.map(map)), xMm, yMm)) return panel.slot;
        }
    }
    return null;
}

// ---- PDF ---------------------------------------------------------------------------------

async function buildPdf(pages, paper, art, opts, onProgress) {
    const pdf = await PDFLib.PDFDocument.create();
    const W = paper.w * MM_TO_PT;
    const H = paper.h * MM_TO_PT;
    const lineColor = (() => {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(opts.lineColor);
        return PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
    })();
    const hasArt = Object.keys(art).length > 0 || !isWhite(opts.bgColor);

    for (let i = 0; i < pages.length; i++) {
        onProgress && onProgress(`Building page ${i + 1} of ${pages.length}…`);
        const page = pdf.addPage([W, H]);
        const pagePath = (points) => points.map(([x, y], j) => `${j ? 'L' : 'M'}${(x * MM_TO_PT).toFixed(2)} ${(y * MM_TO_PT).toFixed(2)}`).join(' ');

        if (hasArt) {
            // Artwork for the whole page as one image at the chosen resolution.
            const k = opts.dpi / 25.4;
            const c = document.createElement('canvas');
            c.width = Math.round(paper.w * k);
            c.height = Math.round(paper.h * k);
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.scale(k, k);
            pages[i].items.forEach((item) => {
                ctx.save();
                applyPieceTransform(ctx, item);
                drawPieceArt(ctx, item.piece, art, opts);
                ctx.restore();
            });
            const blob = await PnP.canvasToBlob(c, 'image/jpeg', 0.92);
            c.width = 0;
            const img = await pdf.embedJpg(await blob.arrayBuffer());
            page.drawImage(img, { x: 0, y: 0, width: W, height: H });
        }

        pages[i].items.forEach((item) => {
            const map = toPage(item);
            if (opts.printFold) {
                item.piece.folds.forEach(([a, b]) => {
                    const [ax, ay] = map(a), [bx, by] = map(b);
                    page.drawLine({
                        start: { x: ax * MM_TO_PT, y: H - ay * MM_TO_PT },
                        end: { x: bx * MM_TO_PT, y: H - by * MM_TO_PT },
                        thickness: 0.5,
                        color: lineColor,
                        dashArray: [4, 3],
                    });
                });
            }
            if (opts.printCut) {
                item.piece.cuts.forEach((loop) => {
                    page.drawSvgPath(`${pagePath(loop.map(map))} Z`, { x: 0, y: H, borderColor: lineColor, borderWidth: 0.5 });
                });
                item.piece.slits.forEach((line) => {
                    page.drawSvgPath(pagePath(line.map(map)), { x: 0, y: H, borderColor: lineColor, borderWidth: 0.5 });
                });
            }
        });
    }
    return pdf.save();
}

// ---- SVG cut file -------------------------------------------------------------------------

// Sized to the machine's reachable area (paper minus dead margin) with a
// paper guide around it; see PnP.cutSvg.
function buildSvg(page, paper, machineMargin) {
    // Score is orange like PnPCut's, so it doesn't share the guide's blue.
    // Solid, not dashed: the machine scores it either way.
    return PnP.cutSvg({
        paperW: paper.w,
        paperH: paper.h,
        margin: machineMargin,
        content: (toGuide) => {
            const cut = [];
            const score = [];
            page.items.forEach((item) => {
                const toPagePoint = toPage(item);
                const map = (p) => toGuide(toPagePoint(p));
                item.piece.cuts.forEach((loop) => cut.push(PnP.cutPath(loop.map(map), '#e03131')));
                item.piece.slits.forEach((line) => cut.push(PnP.cutPath(line.map(map), '#e03131', false)));
                item.piece.folds.forEach(([a, b]) => score.push(PnP.cutPath([map(a), map(b)], '#e08e0b', false)));
            });
            return cut.concat(score).join('\n');
        },
    });
}

// True if any cut or fold line on the page reaches into the machine's dead margin.
function linesInDeadMargin(page, paper, machineMargin) {
    return page.items.some((item) => {
        const map = toPage(item);
        const points = item.piece.cuts.flat().concat(item.piece.folds.flat(), item.piece.slits.flat()).map(map);
        return PnP.inDeadMargin(points, paper.w, paper.h, machineMargin);
    });
}
