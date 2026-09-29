// Grid mode: cards in even rows and columns, centred in the printable area,
// with crop marks in the margins. Fold mode: the same grid on one half of
// the page and each card's back mirrored across a fold line on the other,
// to print one-sided, fold and glue. Both produce the layout the packer does
// ({ sheets: [[{ pieceId, angle, cx, cy }]], unplaced }), plus the grid used
// for the crop marks and, for fold, the fold and the backs' placements.

const CROP_MARK = { offset: 1, length: 5 }; // mm: gap from the bleed edge, mark length

// How many w × h cards fit an area in rows and columns `gap` apart, upright
// or (when canTurn and it fits more) on their side. With `want` ({ cols,
// rows }) that grid is used instead, upright if it fits, else on its side;
// `tooBig` says it fits neither way (the most that fits is used then).
function fitGrid(areaW, areaH, cardW, cardH, gap, canTurn, want = null) {
    const fit = (w, h) => ({
        cols: Math.max(0, Math.floor((areaW + gap) / (w + gap) + 1e-9)),
        rows: Math.max(0, Math.floor((areaH + gap) / (h + gap) + 1e-9)),
    });
    const upright = fit(cardW, cardH);
    const turned = canTurn ? fit(cardH, cardW) : { cols: 0, rows: 0 };
    const holds = (f) => want && f.cols >= want.cols && f.rows >= want.rows;
    let turn = turned.cols * turned.rows > upright.cols * upright.rows;
    let tooBig = false;
    if (want) {
        if (holds(upright)) turn = false;
        else if (holds(turned)) turn = true;
        else tooBig = true;
    }
    const most = turn ? turned : upright;
    const { cols, rows } = want && !tooBig ? want : most;
    return { cols, rows, turn, w: turn ? cardH : cardW, h: turn ? cardW : cardH, gap, tooBig };
}

// What grid and fold layouts share: the cards to place and the cell size.
function gridCards(pieces, settings) {
    const list = [...pieces.values()].filter((p) => p.qty > 0);
    return {
        list,
        // Same rule as packing: a card's bleed never reaches another card's edge.
        gap: Math.max(settings.spacing, settings.reach),
        // Every cell fits the largest card; smaller cards sit in the middle of theirs.
        cardW: Math.max(0, ...list.map((p) => p.widthMm)),
        cardH: Math.max(0, ...list.map((p) => pieceHeightMm(p))),
        // Cards lie on their side only when every piece may turn.
        canTurn: list.every((p) => p.rotate),
    };
}

// Cards placed in `g` from (x0, y0), in order, a sheet at a time.
function fillGrid(list, g, x0, y0) {
    const perSheet = g.cols * g.rows;
    const cards = list.flatMap((p) => Array(p.qty).fill(p.id));
    const sheets = [];
    for (let i = 0; i < cards.length; i += perSheet) {
        sheets.push(cards.slice(i, i + perSheet).map((pieceId, k) => ({
            pieceId,
            angle: g.turn ? 90 : 0,
            cx: x0 + (k % g.cols) * (g.w + g.gap) + g.w / 2,
            cy: y0 + Math.floor(k / g.cols) * (g.h + g.gap) + g.h / 2,
        })));
    }
    return sheets;
}

const unplacedAll = (list) => ({ sheets: [], unplaced: Object.fromEntries(list.map((p) => [p.id, p.qty])), grid: null });

// pieces: Map of pieces (see app.js); settings: readSettings().
function gridLayout(pieces, settings) {
    const { list, gap, cardW, cardH, canTurn } = gridCards(pieces, settings);
    const { paper, margins } = settings;
    const areaW = paper.w - margins.left - margins.right;
    const areaH = paper.h - margins.top - margins.bottom;
    const g = fitGrid(areaW, areaH, cardW, cardH, gap, canTurn, settings.gridSize);
    if (!list.length || !g.cols || !g.rows) return unplacedAll(list);

    const gridW = g.cols * g.w + (g.cols - 1) * gap;
    const gridH = g.rows * g.h + (g.rows - 1) * gap;
    const x0 = margins.left + (areaW - gridW) / 2;
    const y0 = margins.top + (areaH - gridH) / 2;
    return { sheets: fillGrid(list, g, x0, y0), unplaced: {}, grid: { ...g, x0, y0 } };
}

// Fold mode. The fold runs through the middle of the printable area; the
// cards sit on one half, `foldGap` from the fold (never less than their
// bleed), and each back is the front's mirror image across the fold, turned
// as a duplex back would be (see backPlacement), so it lands behind its
// front once folded. settings.foldDirection: auto | vertical | horizontal.
function foldLayout(pieces, settings) {
    const { list, gap, cardW, cardH, canTurn } = gridCards(pieces, settings);
    const { paper, margins } = settings;
    const areaW = paper.w - margins.left - margins.right;
    const areaH = paper.h - margins.top - margins.bottom;
    const foldGap = Math.max(settings.foldGap, settings.reach);
    const options = [];
    if (settings.foldDirection !== 'horizontal') {
        options.push({ dir: 'vertical', g: fitGrid(areaW / 2 - foldGap, areaH, cardW, cardH, gap, canTurn, settings.gridSize) });
    }
    if (settings.foldDirection !== 'vertical') {
        options.push({ dir: 'horizontal', g: fitGrid(areaW, areaH / 2 - foldGap, cardW, cardH, gap, canTurn, settings.gridSize) });
    }
    // The fold that holds the grid asked for, else the one that fits more.
    const score = (o) => (o.g.tooBig ? 0 : 1e6) + o.g.cols * o.g.rows;
    const best = options.reduce((a, b) => (score(b) > score(a) ? b : a));
    const { dir, g } = best;
    if (!list.length || !g.cols || !g.rows) return unplacedAll(list);

    const gridW = g.cols * g.w + (g.cols - 1) * gap;
    const gridH = g.rows * g.h + (g.rows - 1) * gap;
    const vertical = dir === 'vertical';
    const at = vertical ? margins.left + areaW / 2 : margins.top + areaH / 2;
    // The fronts' grid ends foldGap before the fold.
    const x0 = vertical ? at - foldGap - gridW : margins.left + (areaW - gridW) / 2;
    const y0 = vertical ? margins.top + (areaH - gridH) / 2 : at - foldGap - gridH;
    const sheets = fillGrid(list, g, x0, y0);
    const backs = sheets.map((sheet) => sheet
        .filter((p) => pieces.get(p.pieceId).back)
        .map((p) => (vertical
            ? { pieceId: p.pieceId, cx: 2 * at - p.cx, cy: p.cy, angle: -p.angle }
            : { pieceId: p.pieceId, cx: p.cx, cy: 2 * at - p.cy, angle: 180 - p.angle })));
    return { sheets, unplaced: {}, grid: { ...g, x0, y0 }, fold: { dir, at, backs } };
}

// The fold line across the printable area, [x1, y1, x2, y2] in mm.
function foldLine(fold, paper, margins) {
    return fold.dir === 'vertical'
        ? [fold.at, margins.top, fold.at, paper.h - margins.bottom]
        : [margins.left, fold.at, paper.w - margins.right, fold.at];
}

// Crop marks for a grid: short lines in the margins lined up with every trim
// edge, starting just outside the bleed (`bleed`: how far the artwork reaches
// past the cut). Returns [[x1, y1, x2, y2]] in mm.
// With a fold, the marks on the fold side are left out: they would print
// over the backs.
function cropMarks(grid, paper, bleed, fold = null) {
    if (!grid) return [];
    const { cols, rows, w, h, gap, x0, y0 } = grid;
    const xs = new Set();
    const ys = new Set();
    for (let c = 0; c < cols; c++) { xs.add(+(x0 + c * (w + gap)).toFixed(4)); xs.add(+(x0 + c * (w + gap) + w).toFixed(4)); }
    for (let r = 0; r < rows; r++) { ys.add(+(y0 + r * (h + gap)).toFixed(4)); ys.add(+(y0 + r * (h + gap) + h).toFixed(4)); }
    const top = y0 - bleed - CROP_MARK.offset;
    const bottom = y0 + rows * h + (rows - 1) * gap + bleed + CROP_MARK.offset;
    const left = x0 - bleed - CROP_MARK.offset;
    const right = x0 + cols * w + (cols - 1) * gap + bleed + CROP_MARK.offset;
    // Marks stop at the paper edge; none when there's no room at all.
    const marks = [];
    const len = (room) => Math.min(CROP_MARK.length, room);
    const foldSide = fold ? (fold.dir === 'vertical' ? 'right' : 'bottom') : null;
    xs.forEach((x) => {
        if (len(top) > 0) marks.push([x, top - len(top), x, top]);
        if (len(paper.h - bottom) > 0 && foldSide !== 'bottom') marks.push([x, bottom, x, bottom + len(paper.h - bottom)]);
    });
    ys.forEach((y) => {
        if (len(left) > 0) marks.push([left - len(left), y, left, y]);
        if (len(paper.w - right) > 0 && foldSide !== 'right') marks.push([right, y, right + len(paper.w - right), y]);
    });
    return marks;
}
