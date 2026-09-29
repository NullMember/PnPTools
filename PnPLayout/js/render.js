// Turning a packed layout into pixels, PDF and SVG. All positions are in mm
// from the sheet's top-left corner; angles are clockwise degrees.

const MM_TO_PT = 72 / 25.4;

function pieceHeightMm(piece) {
    return piece.widthMm * piece.front.h / piece.front.w;
}

// Where a piece's back goes so it lines up with the front after duplex
// printing. Long-edge flipping mirrors across the sheet's long axis.
function backPlacement(p, paper, settings) {
    const portrait = paper.w <= paper.h;
    const mirrorX = (settings.flipEdge === 'long') === portrait;
    return mirrorX
        ? { cx: paper.w - p.cx + settings.backOffsetX, cy: p.cy + settings.backOffsetY, angle: -p.angle }
        : { cx: p.cx + settings.backOffsetX, cy: paper.h - p.cy + settings.backOffsetY, angle: 180 - p.angle };
}

// Crop marks for a page: the front's, or on a back page mirrored like the
// backs (so they fall behind the front's marks: hold the sheet to the light
// to check the duplex alignment).
function pageMarks(layout, paper, settings, side) {
    if (!settings.cropMarks || !layout) return [];
    const marks = cropMarks(layout.grid, paper, settings.reach, layout.fold);
    if (side !== 'back') return marks;
    const at = (x, y) => { const b = backPlacement({ cx: x, cy: y, angle: 0 }, paper, settings); return [b.cx, b.cy]; };
    return marks.map(([x1, y1, x2, y2]) => [...at(x1, y1), ...at(x2, y2)]);
}

// The piece's cut outline, placed on the sheet (mm): the face's traced
// outline, or for rectangular images a rectangle with `cornerRadius` mm
// rounded corners (card corners the image doesn't show).
function outlineOnSheet(piece, p, cornerRadius = 0) {
    const face = piece.front;
    const wMm = piece.widthMm;
    const hMm = pieceHeightMm(piece);
    const rad = (p.angle * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const local = face.isRect && cornerRadius > 0
        ? roundedRect(wMm, hMm, cornerRadius)
        : face.outline.map(([x, y]) => [(x / face.w - 0.5) * wMm, (y / face.h - 0.5) * hMm]);
    return local.map(([lx, ly]) => [p.cx + lx * cos - ly * sin, p.cy + lx * sin + ly * cos]);
}

// A w × h rectangle centred on 0, 0 with corners of radius r, as a polygon
// (each corner in 12 steps: smooth enough for a cutting machine).
function roundedRect(w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    const corners = [[w / 2 - r, -h / 2 + r, -90], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180]];
    const pts = [];
    corners.forEach(([cx, cy, start]) => {
        for (let i = 0; i <= 12; i++) {
            const a = ((start + (90 * i) / 12) * Math.PI) / 180;
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
    });
    return pts;
}

function pathData(points, scale = 1, fmt = (v) => +v.toFixed(3)) {
    return points.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(x * scale)} ${fmt(y * scale)}`).join(' ') + ' Z';
}

// What gets printed for a face drawn at the front's size: the whole image.
// extraMm is how far it reaches past the piece's edge on each side (the
// bleed already in the image; Layout adds none).
function faceComposite(piece, face) {
    const pxPerMm = face.w / piece.widthMm;
    return { canvas: face.full, preview: face.preview, extraMm: face.inset / pxPerMm };
}

// ---- Preview ---------------------------------------------------------------------

const FOLD_DASH = [3, 2]; // mm, dashes of the fold line

function drawSheetPreview(canvas, sheet, ctxInfo) {
    const { paper, margins, pieces, settings, side, maxWidth } = ctxInfo;
    const k = maxWidth / paper.w; // px per mm
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
    ctx.strokeRect(margins.left, margins.top, paper.w - margins.left - margins.right, paper.h - margins.top - margins.bottom);
    ctx.restore();

    const { fold } = ctxInfo;
    // Folded layouts show the backs next to the fronts, on the same page.
    const draws = sheet.map((p) => [p, side === 'back' ? 'back' : 'front']);
    if (fold && side === 'front') fold.backs[ctxInfo.index].forEach((p) => draws.push([p, 'back', true]));
    draws.forEach(([p, which, placed]) => {
        const piece = pieces.get(p.pieceId);
        if (!piece) return;
        const face = which === 'back' ? piece.back : piece.front;
        if (!face) return;
        const pos = which === 'back' && !placed ? backPlacement(p, paper, settings) : p;
        const comp = faceComposite(piece, face);
        const wMm = piece.widthMm + 2 * comp.extraMm;
        const hMm = pieceHeightMm(piece) + 2 * comp.extraMm;
        ctx.save();
        ctx.translate(pos.cx, pos.cy);
        ctx.rotate((pos.angle * Math.PI) / 180);
        ctx.drawImage(comp.preview, -wMm / 2, -hMm / 2, wMm, hMm);
        ctx.restore();
    });

    if (settings.cropMarks) {
        ctx.save();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = Math.max(0.25, 1 / (dpr * k)); // at least a pixel, so it shows
        pageMarks({ grid: ctxInfo.grid, fold }, paper, settings, side).forEach(([x1, y1, x2, y2]) => {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        });
        ctx.restore();
    }

    if (fold && side === 'front') {
        const [x1, y1, x2, y2] = foldLine(fold, paper, margins);
        ctx.save();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = Math.max(0.3, 1 / (dpr * k));
        ctx.setLineDash(FOLD_DASH);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
    }

    if (side === 'front' && settings.cutOutline) {
        ctx.strokeStyle = '#e03131';
        ctx.lineWidth = 0.3;
        sheet.forEach((p) => {
            const piece = pieces.get(p.pieceId);
            if (!piece) return;
            ctx.stroke(new Path2D(pathData(outlineOnSheet(piece, p, settings.cornerRadius))));
        });
    }
}

// ---- PDF ---------------------------------------------------------------------------

function hexToRgb01(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex) || [0, '00', '00', '00'];
    return PDFLib.rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

// Draw an image centred at (cx, cy) mm, rotated clockwise by angle degrees.
function drawCentered(page, image, pageHpt, cxMm, cyMm, wMm, hMm, angle) {
    const w = wMm * MM_TO_PT;
    const h = hMm * MM_TO_PT;
    const cx = cxMm * MM_TO_PT;
    const cy = pageHpt - cyMm * MM_TO_PT;
    const t = (-angle * Math.PI) / 180; // pdf-lib rotates counter-clockwise about the bottom-left corner
    page.drawImage(image, {
        x: cx - (w / 2) * Math.cos(t) + (h / 2) * Math.sin(t),
        y: cy - (w / 2) * Math.sin(t) - (h / 2) * Math.cos(t),
        width: w,
        height: h,
        rotate: PDFLib.degrees(-angle),
    });
}

function drawMarks(page, marks, pageHpt) {
    marks.forEach(([x1, y1, x2, y2]) => {
        page.drawLine({
            start: { x: x1 * MM_TO_PT, y: pageHpt - y1 * MM_TO_PT },
            end: { x: x2 * MM_TO_PT, y: pageHpt - y2 * MM_TO_PT },
            thickness: 0.5,
            color: PDFLib.rgb(0, 0, 0),
        });
    });
}

async function buildPdf(layout, info, onProgress) {
    const { paper, pieces, settings } = info;
    const pdf = await PDFLib.PDFDocument.create();
    const embedded = new Map();
    const embed = async (piece, face) => {
        const key = face === piece.front ? `${piece.id}:f` : `${piece.id}:b`;
        if (!embedded.has(key)) {
            const comp = faceComposite(piece, face);
            const blob = await PnP.canvasToBlob(comp.canvas, 'image/png');
            embedded.set(key, { image: await pdf.embedPng(await blob.arrayBuffer()), extraMm: comp.extraMm });
        }
        return embedded.get(key);
    };

    const Wpt = paper.w * MM_TO_PT;
    const Hpt = paper.h * MM_TO_PT;
    const lineColor = hexToRgb01(settings.cutColor);

    for (let s = 0; s < layout.sheets.length; s++) {
        onProgress && onProgress(`Building sheet ${s + 1} of ${layout.sheets.length}…`);
        const sheet = layout.sheets[s];
        const front = pdf.addPage([Wpt, Hpt]);
        for (const p of sheet) {
            const piece = pieces.get(p.pieceId);
            const { image, extraMm } = await embed(piece, piece.front);
            drawCentered(front, image, Hpt, p.cx, p.cy, piece.widthMm + 2 * extraMm, pieceHeightMm(piece) + 2 * extraMm, p.angle);
        }
        if (layout.fold) {
            for (const p of layout.fold.backs[s]) {
                const piece = pieces.get(p.pieceId);
                const { image, extraMm } = await embed(piece, piece.back);
                drawCentered(front, image, Hpt, p.cx, p.cy, piece.widthMm + 2 * extraMm, pieceHeightMm(piece) + 2 * extraMm, p.angle);
            }
            const [x1, y1, x2, y2] = foldLine(layout.fold, paper, settings.margins);
            front.drawLine({
                start: { x: x1 * MM_TO_PT, y: Hpt - y1 * MM_TO_PT },
                end: { x: x2 * MM_TO_PT, y: Hpt - y2 * MM_TO_PT },
                thickness: 0.5,
                color: PDFLib.rgb(0.33, 0.33, 0.33),
                dashArray: FOLD_DASH.map((v) => v * MM_TO_PT),
            });
        }
        drawMarks(front, pageMarks(layout, paper, settings, 'front'), Hpt);
        if (settings.cutOutline) {
            for (const p of sheet) {
                const piece = pieces.get(p.pieceId);
                front.drawSvgPath(pathData(outlineOnSheet(piece, p, settings.cornerRadius), MM_TO_PT), {
                    x: 0,
                    y: Hpt,
                    borderColor: lineColor,
                    borderWidth: settings.cutWidth,
                });
            }
        }

        // Folded layouts have their backs on the front page already.
        const withBacks = layout.fold ? [] : sheet.filter((p) => pieces.get(p.pieceId).back);
        if (withBacks.length) {
            const back = pdf.addPage([Wpt, Hpt]);
            for (const p of withBacks) {
                const piece = pieces.get(p.pieceId);
                const { image, extraMm } = await embed(piece, piece.back);
                const pos = backPlacement(p, paper, settings);
                drawCentered(back, image, Hpt, pos.cx, pos.cy, piece.widthMm + 2 * extraMm, pieceHeightMm(piece) + 2 * extraMm, pos.angle);
            }
            drawMarks(back, pageMarks(layout, paper, settings, 'back'), Hpt);
        }
    }
    return pdf.save();
}

// ---- SVG cut file ------------------------------------------------------------------

// Sized to the machine's reachable area (paper minus dead margin) with a
// paper guide around it; see PnP.cutSvg.
function buildSvg(sheet, info, machineMargin) {
    const { paper, pieces, settings } = info;
    return PnP.cutSvg({
        paperW: paper.w,
        paperH: paper.h,
        margin: machineMargin,
        content: (toGuide) => sheet
            .map((p) => PnP.cutPath(outlineOnSheet(pieces.get(p.pieceId), p, settings.cornerRadius).map(toGuide), '#000000'))
            .join('\n'),
    });
}

// True if any outline on the sheets reaches into the machine's dead margin.
function outlinesInDeadMargin(sheets, info, machineMargin) {
    const { paper, pieces, settings } = info;
    return sheets.some((sheet) => sheet.some((p) =>
        PnP.inDeadMargin(outlineOnSheet(pieces.get(p.pieceId), p, settings.cornerRadius), paper.w, paper.h, machineMargin)));
}
