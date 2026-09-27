// Box dielines. Each style describes its flat layout as panel polygons (mm,
// origin top-left, y down). Fold lines are derived automatically — an edge
// shared by two panels is a fold — and every other edge is a cut, chained
// into closed paths. So styles only need to get the panel shapes right.
// Glueless styles add slits: open cut lines inside a piece that locking tabs
// push through.

const ARC_STEPS = 10;

// Points along a circular arc (angles in degrees, y down; excludes the start point).
function arc(cx, cy, r, fromDeg, toDeg) {
    const pts = [];
    for (let i = 1; i <= ARC_STEPS; i++) {
        const a = ((fromDeg + ((toDeg - fromDeg) * i) / ARC_STEPS) * Math.PI) / 180;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
}

function rect(x, y, w, h) {
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- Fold / cut extraction ---------------------------------------------------------

const key = ([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`;
const edgeKey = (a, b) => [key(a), key(b)].sort().join('|');

function extractLines(panels) {
    const count = new Map();
    const edges = [];
    panels.forEach((p) => {
        p.poly.forEach((a, i) => {
            const b = p.poly[(i + 1) % p.poly.length];
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) return;
            const k = edgeKey(a, b);
            count.set(k, (count.get(k) || 0) + 1);
            edges.push({ a, b, k });
        });
    });

    const folds = [];
    const seenFold = new Set();
    const cutEdges = [];
    edges.forEach((e) => {
        if (count.get(e.k) > 1) {
            if (!seenFold.has(e.k)) { seenFold.add(e.k); folds.push([e.a, e.b]); }
        } else {
            cutEdges.push(e);
        }
    });

    // Chain cut edges end-to-end into closed loops (one per piece outline).
    const byStart = new Map();
    cutEdges.forEach((e) => {
        [[e.a, e.b], [e.b, e.a]].forEach(([p, q]) => {
            const k = key(p);
            if (!byStart.has(k)) byStart.set(k, []);
            byStart.get(k).push({ e, to: q });
        });
    });
    const used = new Set();
    const cuts = [];
    cutEdges.forEach((start) => {
        if (used.has(start)) return;
        used.add(start);
        const loop = [start.a, start.b];
        let cur = start.b;
        for (let guard = 0; guard < cutEdges.length; guard++) {
            const next = (byStart.get(key(cur)) || []).find((c) => !used.has(c.e));
            if (!next) break;
            used.add(next.e);
            if (key(next.to) === key(loop[0])) { cur = null; break; }
            loop.push(next.to);
            cur = next.to;
        }
        cuts.push(loop);
    });
    return { folds, cuts };
}

function finishPiece(name, panels, slits = []) {
    let x1 = -Infinity, y1 = -Infinity, x0 = Infinity, y0 = Infinity;
    panels.forEach((p) => p.poly.forEach(([x, y]) => {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }));
    // Normalise so the piece starts at (0, 0).
    panels.forEach((p) => { p.poly = p.poly.map(([x, y]) => [x - x0, y - y0]); });
    slits = slits.map((line) => line.map(([x, y]) => [x - x0, y - y0]));
    panels.forEach((p) => {
        const xs = p.poly.map((q) => q[0]), ys = p.poly.map((q) => q[1]);
        p.box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    });
    const { folds, cuts } = extractLines(panels);
    return { name, width: x1 - x0, height: y1 - y0, panels, slits, cuts, folds: splitFoldsAtSlits(folds, slits) };
}

// A slit cut along a fold line takes that stretch out of the fold, so the
// cut file doesn't also score over it.
function splitFoldsAtSlits(folds, slits) {
    let out = folds;
    slits.forEach(([p, q]) => {
        const next = [];
        out.forEach(([a, b]) => {
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const len2 = dx * dx + dy * dy;
            const off = (r) => Math.abs((r[0] - a[0]) * dy - (r[1] - a[1]) * dx) / Math.sqrt(len2);
            if (off(p) > 1e-6 || off(q) > 1e-6) { next.push([a, b]); return; }
            const at = (r) => ((r[0] - a[0]) * dx + (r[1] - a[1]) * dy) / len2;
            const t0 = Math.max(0, Math.min(at(p), at(q))), t1 = Math.min(1, Math.max(at(p), at(q)));
            if (t1 <= t0) { next.push([a, b]); return; }
            const pt = (u) => [a[0] + dx * u, a[1] + dy * u];
            if (t0 > 1e-9) next.push([a, pt(t0)]);
            if (t1 < 1 - 1e-9) next.push([pt(t1), b]);
        });
        out = next;
    });
    return out;
}

// ---- Dimensions ------------------------------------------------------------------------

/**
 * cfg: { cardW, cardH, thickness, clearance, paper } (mm)
 * Inner size of the space for the deck, and panel sizes (inner + paper).
 */
function boxDims(cfg) {
    const W = cfg.cardW + cfg.clearance;
    const H = cfg.cardH + cfg.clearance;
    const D = cfg.thickness + cfg.clearance;
    const t = cfg.paper;
    return { W, H, D, t, pw: W + t, ph: H + t, pd: D + t };
}

// ---- Classic tuck box (reverse tuck end) --------------------------------------------------
//
//            [tuck]
//            [lid ]  [dust]        [dust]
//   [glue]  [back ][side ][front*][side ]      * thumb notch
//            [dust]        [bottom]
//                          [tuck  ]

function tuckFlap(xa, xb, ya, depth, dir) {
    // Rounded tuck flap on edge (xa..xb, ya); dir = -1 extends up, +1 down.
    const inset = 1.5;
    const r = clamp(depth * 0.7, 3, (xb - xa) / 3);
    const yt = ya + dir * depth;
    const pts = [[xa, ya], [xa + inset, ya + dir * 2], [xa + inset, yt - dir * r]];
    if (dir < 0) {
        pts.push(...arc(xa + inset + r, yt + r, r, 180, 270));
        pts.push([xb - inset - r, yt]);
        pts.push(...arc(xb - inset - r, yt + r, r, 270, 360));
    } else {
        pts.push(...arc(xa + inset + r, yt - r, r, 180, 90));
        pts.push([xb - inset - r, yt]);
        pts.push(...arc(xb - inset - r, yt - r, r, 90, 0));
    }
    pts.push([xb - inset, ya + dir * 2], [xb, ya]);
    return pts;
}

function dustFlap(xa, xb, ya, depth, dir) {
    // Tapered flap with a 1 mm gap from neighbouring panels so it never shares
    // an edge (which would turn a cut into a fold).
    const taper = Math.min(depth * 0.35, (xb - xa) / 3);
    const yt = ya + dir * depth;
    return [[xa, ya], [xa + 1, ya + dir * 2], [xa + 1 + taper, yt], [xb - 1 - taper, yt], [xb - 1, ya + dir * 2], [xb, ya]];
}

// seam: 'glue' (glue flap), 'tabs' (lock flap with tabs through slits in
// the back) or 'corner' (hidden: the flap on the back lies inside the last
// side, and that side's tabs fold into slits along the back's corner fold).
// bottom: 'tuck' (opens like the top), 'glue' (a glue flap instead of the
// tuck flap) or 'corner' (hidden lock: the bottom's tabs fold into slits on
// the fold of an inner flap on the back's bottom edge).
// Every tuck flap gets lock slits at both ends of its fold, which the dust
// flaps catch in when the box is closed.
function classicTuck(cfg, { seam = 'glue', bottom = 'tuck' } = {}) {
    const { pw, ph, pd, t } = boxDims(cfg);
    const g = seam === 'tabs' ? 0                              // lock flap sits on the right instead
        : seam === 'corner' ? Math.max(4, Math.min(pd - 1.5, 16)) // as wide as fits inside the side
            : clamp(pd * 0.8, 8, 12);
    const tuck = clamp(pd * 0.8, 12, 22);    // tuck-in flap depth
    const dust = clamp(pd * 0.85, 6, 25);    // dust flap depth
    const notchR = Math.min(pw * 0.18, 12);  // thumb notch radius
    const glueDepth = clamp(pd * 0.8, 8, 12);

    const xb = g, xs1 = g + pw, xf = xs1 + pd, xs2 = xf + pw, xe = xs2 + pd;
    const y1 = tuck + pd, y2 = y1 + ph, yb = y2 + pd;
    const cx = xf + pw / 2;

    const front = [[xf, y1], [cx - notchR, y1], ...arc(cx, y1, notchR, 180, 0).slice(0, -1), [cx + notchR, y1], [xs2, y1], [xs2, y2], [xf, y2]];

    const panels = [
        { id: 'back', name: 'Back', slot: 'back', poly: rect(xb, y1, pw, ph) },
        { id: 'side1', name: 'Side', slot: 'sideL', poly: rect(xs1, y1, pd, ph) },
        { id: 'front', name: 'Front', slot: 'front', poly: front },
        { id: 'side2', name: 'Side', slot: 'sideR', poly: rect(xs2, y1, pd, ph) },
        // The lid folds over from the back, so its art is drawn upside down in
        // the flat layout to read correctly from the front of the closed box.
        { id: 'lid', name: 'Top', slot: 'top', artRot: 180, poly: rect(xb, y1 - pd, pw, pd) },
        { id: 'tuckTop', name: 'Tuck flap', poly: tuckFlap(xb, xs1, y1 - pd, tuck, -1) },
        { id: 'dust1', name: 'Dust flap', poly: dustFlap(xs1, xf, y1, dust, -1) },
        { id: 'dust2', name: 'Dust flap', poly: dustFlap(xs2, xe, y1, dust, -1) },
        { id: 'dust3', name: 'Dust flap', poly: dustFlap(xs1, xf, y2, dust, 1) },
        { id: 'dust4', name: 'Dust flap', poly: dustFlap(xs2, xe, y2, dust, 1) },
    ];
    const slits = tuckLockSlits(xb, xs1, y1 - pd, pd);

    if (bottom === 'corner') {
        // Tabs on the bottom's free edge (built on a vertical edge, axes swapped).
        const centres = tabCentres(xf, xs2);
        const tabs = arrowTabs(yb, centres, t);
        const swap = ([u, v]) => [v, u];
        panels.push(
            { id: 'bottom', name: 'Bottom', slot: 'bottom', poly: [[xf, y2], [xs2, y2], [xs2, yb], ...tabs.edge.map(swap).reverse(), [xf, yb]] },
            ...tabs.panels.map((p) => ({ ...p, id: `bottomTab${p.id.slice(-1)}`, poly: p.poly.map(swap) })),
            { id: 'backFlap', name: 'Lock flap', poly: dustFlap(xb, xs1, y2, Math.max(4, Math.min(pd - 1.5, 16)), 1) },
        );
        // The bottom folds across from the front, so its tabs meet the back mirrored.
        const len = LOCK.neck + 0.6;
        centres.forEach((c) => {
            const x = xs1 - (c - xf);
            slits.push([[x - len / 2, y2], [x + len / 2, y2]]);
        });
    } else {
        panels.push({ id: 'bottom', name: 'Bottom', slot: 'bottom', poly: rect(xf, y2, pw, pd) });
        if (bottom === 'glue') {
            panels.push({ id: 'glueBottom', name: 'Glue flap', glue: true, poly: [[xf, yb], [xf + 4, yb + glueDepth], [xs2 - 4, yb + glueDepth], [xs2, yb]] });
        } else {
            panels.push({ id: 'tuckBottom', name: 'Tuck flap', poly: tuckFlap(xf, xs2, yb, tuck, 1) });
            slits.push(...tuckLockSlits(xf, xs2, yb, pd));
        }
    }

    if (seam === 'glue') {
        panels.unshift({ id: 'glue', name: 'Glue flap', glue: true, poly: [[0, y1 + 4], [g, y1], [g, y2], [0, y2 - 4]] });
        return [finishPiece('Tuck box', panels, slits)];
    }
    if (seam === 'corner') {
        // The flap lies inside the last side. That side's arrow tabs fold 90°
        // at the corner and push into slits on the back/flap fold, so they
        // end up inside against the back: only the slits show, on the fold.
        const centres = tabCentres(y1, y2);
        const tabs = arrowTabs(xe, centres, t);
        const side2 = panels.find((p) => p.id === 'side2');
        side2.poly = [[xs2, y1], [xe, y1], ...tabs.edge, [xe, y2], [xs2, y2]];
        panels.unshift({ id: 'lockFlap', name: 'Lock flap', poly: [[0, y1 + 4], [g, y1], [g, y2], [0, y2 - 4]] });
        panels.push(...tabs.panels);
        return [finishPiece('Tuck box', panels, slits.concat(slitsAt(g, centres)))];
    }
    // The last side's lock flap lies inside the back; its tabs fold out
    // through slits in the back panel.
    const lock = lockSeam(xe, y1, y2, xb, clamp(pd * 0.8, 8, Math.min(14, pw / 3)), t);
    return [finishPiece('Tuck box', panels.concat(lock.panels), slits.concat(lock.slits))];
}

// Tuck lock: short slits along both ends of a tuck flap's fold (xa..xb at y).
// Closing the box pushes the dust flaps' edges into them, which holds the
// tuck flap in place.
function tuckLockSlits(xa, xb, y, pd) {
    const len = clamp(pd * 0.25, 2.5, 5);
    return [[[xa, y], [xa + len, y]], [[xb - len, y], [xb, y]]];
}

// ---- Glueless seams and tabs ----------------------------------------------------------------
//
// A lock flap hinged on a vertical edge (x = x0, y0..y1) that folds inside
// the panel whose left edge is at x = target. Two arrow tabs on its free edge
// fold 90° and push out through slits in that panel; their heads are wider
// than the slits, so they catch.

const LOCK = { neck: 7, head: 10, tip: 5, headLen: 4 };

// One tab for a short edge, two for a long one.
function tabCentres(y0, y1) {
    const h = y1 - y0;
    return h > 40 ? [y0 + h * 0.25, y0 + h * 0.75] : [y0 + h / 2];
}

// Arrow tabs hinged on a vertical edge at x = xg (pointing right), one per
// centre. edge: the points to insert along that edge (top to bottom) so the
// tab bases become folds.
function arrowTabs(xg, centres, t) {
    const neckLen = t + 1.2; // through the panel, plus room to fold
    const { neck, head, tip, headLen } = LOCK;
    const edge = [];
    const panels = centres.map((c, i) => {
        edge.push([xg, c - neck / 2], [xg, c + neck / 2]);
        const xn = xg + neckLen;
        return {
            id: `lockTab${i + 1}`,
            name: 'Lock tab',
            poly: [[xg, c - neck / 2], [xn, c - neck / 2], [xn, c - head / 2], [xn + headLen, c - tip / 2],
                [xn + headLen, c + tip / 2], [xn, c + head / 2], [xn, c + neck / 2], [xg, c + neck / 2]],
        };
    });
    return { edge, panels };
}

// Vertical slits at x for the tabs at these centres.
function slitsAt(x, centres) {
    const len = LOCK.neck + 0.6;
    return centres.map((c) => [[x, c - len / 2], [x, c + len / 2]]);
}

function lockSeam(x0, y0, y1, target, width, t) {
    const xg = x0 + width;
    const inset = Math.min(4, (y1 - y0) / 6);
    const centres = tabCentres(y0, y1);
    const tabs = arrowTabs(xg, centres, t);
    const flap = { id: 'lockFlap', name: 'Lock flap', poly: [[x0, y0], [xg, y0 + inset], ...tabs.edge, [xg, y1 - inset], [x0, y1]] };
    return { panels: [flap, ...tabs.panels], slits: slitsAt(target + width, centres) };
}

// ---- Two-piece box (tray base + slightly larger lid) ---------------------------------------
//
//   [tab][ wall ][tab]
//   [wall][floor][wall]      the deck lies flat on the floor
//   [tab][ wall ][tab]

function tray(name, w, l, h, slots) {
    const tw = Math.max(3, h * 0.85); // corner glue tab width
    const panels = [
        { id: 'floor', name: slots.floorName, slot: slots.floor, poly: rect(h, h, w, l) },
        // Walls fold away from the printed side, so their art is turned to read
        // upright once folded: the far wall upside down, side walls sideways.
        { id: 'wallTop', name: 'Wall', slot: slots.long, artRot: 180, poly: rect(h, 0, w, h) },
        { id: 'wallBottom', name: 'Wall', slot: slots.long, poly: rect(h, h + l, w, h) },
        { id: 'wallLeft', name: 'Wall', slot: slots.short, artRot: 90, poly: rect(0, h, h, l) },
        { id: 'wallRight', name: 'Wall', slot: slots.short, artRot: 270, poly: rect(h + w, h, h, l) },
        { id: 'tab1', name: 'Glue tab', glue: true, poly: [[h, 0], [h, h], [h - tw, h - 1.5], [h - tw, 1.5]] },
        { id: 'tab2', name: 'Glue tab', glue: true, poly: [[h + w, 0], [h + w + tw, 1.5], [h + w + tw, h - 1.5], [h + w, h]] },
        { id: 'tab3', name: 'Glue tab', glue: true, poly: [[h, h + l], [h, h + l + h], [h - tw, h + l + h - 1.5], [h - tw, h + l + 1.5]] },
        { id: 'tab4', name: 'Glue tab', glue: true, poly: [[h + w, h + l], [h + w + tw, h + l + 1.5], [h + w + tw, h + l + h - 1.5], [h + w, h + l + h]] },
    ];
    return finishPiece(name, panels);
}

function twoPiece(cfg) {
    const { W, H, D, t } = boxDims(cfg);
    const bw = W + 2 * t, bl = H + 2 * t, bh = D + t;
    // The lid slides over the base: its inside matches the base's outside plus a little play.
    const play = 0.5;
    const lw = bw + 2 * t + play, ll = bl + 2 * t + play;
    const lh = bh * (cfg.lidDepth / 100);
    return [
        tray('Lid', lw, ll, lh, { floor: 'lidTop', floorName: 'Lid top', long: 'lidLong', short: 'lidShort' }),
        tray('Base', bw, bl, bh, { floor: 'baseFloor', floorName: 'Base floor', long: 'baseLong', short: 'baseShort' }),
    ];
}

// ---- Two-piece box without glue (double-walled trays) ----------------------------------
//
//            [inner wall + tabs]
//      [flap][   outer wall    ][flap]
//   [in][out][      floor      ][out][in]     slits in the floor take the tabs
//      [flap][   outer wall    ][flap]
//            [inner wall + tabs]
//
// Long walls (top and bottom) fold up and their inner halves fold back down
// inside; their corner flaps turn in along the short sides. The short walls
// then fold up over the flaps, trapping them, and every inner wall's tabs
// push into slits in the floor.

function lockTabs(xa, xb, yEdge, dir, len, count) {
    // Tabs on a horizontal free edge (xa..xb at yEdge) extending in dir (±1);
    // points run along the edge from xa to xb.
    const span = xb - xa;
    const tw = clamp(span * 0.16, 5, 14);
    const centres = count === 2 ? [xa + span * 0.25, xa + span * 0.75] : [xa + span / 2];
    const pts = [];
    centres.forEach((c) => {
        pts.push([c - tw / 2, yEdge], [c - tw / 2 + 0.6, yEdge + dir * len], [c + tw / 2 - 0.6, yEdge + dir * len], [c + tw / 2, yEdge]);
    });
    return { pts, centres, tw };
}

function lockTray(name, w, l, h, t, slots) {
    const tabLen = clamp(h * 0.35, 3, 6);
    const a = 2 * t + 0.4;             // long inner walls clear the short walls' layers
    const b = 3 * t + 0.6;             // short inner walls clear two long-wall layers
    const hi = Math.max(h - t, 1);     // inner long wall height
    const hs = Math.max(h - 2 * t, 1); // inner short wall height (over the corner flaps)
    const cw = Math.max(3, Math.min(h * 0.9, l / 2 - 2)); // corner flap width
    const taper = Math.min(3, h * 0.2);
    const panels = [{ id: 'floor', name: slots.floorName, slot: slots.floor, poly: rect(0, 0, w, l) }];
    const slits = [];

    // Top long wall (outer + inner) and its corner flaps; bottom mirrors it.
    const longWall = (side) => {
        const s = side === 'top' ? -1 : 1;
        const y0 = side === 'top' ? 0 : l;          // floor edge
        const yRim = y0 + s * h;
        const yFree = yRim + s * hi;
        const count = w - 2 * a > 45 ? 2 : 1;
        const tabs = lockTabs(a, w - a, yFree, s, tabLen, count);
        panels.push(
            { id: `wall${side}`, name: 'Wall', slot: slots.long, artRot: side === 'top' ? 180 : 0,
                poly: [[0, y0], [0, yRim], [a, yRim], [w - a, yRim], [w, yRim], [w, y0]] },
            { id: `inner${side}`, name: 'Inner wall',
                poly: [[a, yRim], [a, yFree], ...tabs.pts, [w - a, yFree], [w - a, yRim]] },
            { id: `flap${side}L`, name: 'Corner flap', poly: [[0, y0], [0, yRim], [-cw, yRim - s * taper], [-cw, y0 + s * 1.2]] },
            { id: `flap${side}R`, name: 'Corner flap', poly: [[w, y0], [w + cw, y0 + s * 1.2], [w + cw, yRim - s * taper], [w, yRim]] },
        );
        const ys = y0 - s * (1.5 * t + 0.3); // in the floor, just inside the fold
        tabs.centres.forEach((c) => slits.push([[c - tabs.tw / 2 - 0.4, ys], [c + tabs.tw / 2 + 0.4, ys]]));
    };
    const shortWall = (side) => {
        const s = side === 'left' ? -1 : 1;
        const x0 = side === 'left' ? 0 : w;
        const xRim = x0 + s * h;
        const xFree = xRim + s * hs;
        const count = l - 2 * b > 45 ? 2 : 1;
        // The same tabs on a vertical edge: built along y, then axes swapped.
        const tabs = lockTabs(b, l - b, xFree, s, tabLen, count);
        panels.push(
            { id: `wall${side}`, name: 'Wall', slot: slots.short, artRot: side === 'left' ? 90 : 270,
                poly: [[x0, 0], [xRim, 0], [xRim, b], [xRim, l - b], [xRim, l], [x0, l]] },
            { id: `inner${side}`, name: 'Inner wall',
                poly: [[xRim, b], [xFree, b], ...tabs.pts.map(([y, x]) => [x, y]), [xFree, l - b], [xRim, l - b]] },
        );
        const xs = x0 - s * (2.5 * t + 0.3);
        tabs.centres.forEach((c) => slits.push([[xs, c - tabs.tw / 2 - 0.4], [xs, c + tabs.tw / 2 + 0.4]]));
    };
    longWall('top');
    longWall('bottom');
    shortWall('left');
    shortWall('right');
    return finishPiece(name, panels, slits);
}

function twoPieceLock(cfg) {
    const { W, H, D, t } = boxDims(cfg);
    // Inside the base: short walls take two layers each side (wall + flap
    // under the inner wall), long walls one.
    const bw = W + 4 * t + 0.5, bl = H + 2 * t + 0.5, bh = D + t;
    // The lid's inside matches the base's outside (one wall thickness each side) plus play.
    const play = 0.8;
    const lw = bw + 2 * t + play + 4 * t, ll = bl + 2 * t + play + 2 * t;
    const lh = bh * (cfg.lidDepth / 100);
    return [
        lockTray('Lid', lw, ll, lh, t, { floor: 'lidTop', floorName: 'Lid top', long: 'lidLong', short: 'lidShort' }),
        lockTray('Base', bw, bl, bh, t, { floor: 'baseFloor', floorName: 'Base floor', long: 'baseLong', short: 'baseShort' }),
    ];
}

// ---- Sleeve / wrap ------------------------------------------------------------------------
//
//   [front][side][back][side][glue]      open at both ends

function sleeve(cfg) {
    const { pw, ph, pd } = boxDims(cfg);
    const bh = ph * (cfg.sleeveHeight / 100);
    const g = clamp(pd * 0.8, 8, 12);
    const x1 = pw, x2 = x1 + pd, x3 = x2 + pw, x4 = x3 + pd;
    const panels = [
        { id: 'front', name: 'Front', slot: 'front', poly: rect(0, 0, pw, bh) },
        { id: 'side1', name: 'Side', slot: 'sideR', poly: rect(x1, 0, pd, bh) },
        { id: 'back', name: 'Back', slot: 'back', poly: rect(x2, 0, pw, bh) },
        { id: 'side2', name: 'Side', slot: 'sideL', poly: rect(x3, 0, pd, bh) },
        { id: 'glue', name: 'Glue flap', glue: true, poly: [[x4, 0], [x4 + g, Math.min(4, bh / 4)], [x4 + g, bh - Math.min(4, bh / 4)], [x4, bh]] },
    ];
    return [finishPiece('Sleeve', panels)];
}

// Glueless sleeve: back first, so the lock flap on the last side lies inside
// the back and its tabs show there, not on the front.
function sleeveLock(cfg) {
    const { pw, ph, pd, t } = boxDims(cfg);
    const bh = ph * (cfg.sleeveHeight / 100);
    const x1 = pw, x2 = x1 + pd, x3 = x2 + pw, x4 = x3 + pd;
    const panels = [
        { id: 'back', name: 'Back', slot: 'back', poly: rect(0, 0, pw, bh) },
        { id: 'side1', name: 'Side', slot: 'sideL', poly: rect(x1, 0, pd, bh) },
        { id: 'front', name: 'Front', slot: 'front', poly: rect(x2, 0, pw, bh) },
        { id: 'side2', name: 'Side', slot: 'sideR', poly: rect(x3, 0, pd, bh) },
    ];
    const seam = lockSeam(x4, 0, bh, 0, clamp(pd * 0.8, 8, Math.min(14, pw / 3)), t);
    return [finishPiece('Sleeve', panels.concat(seam.panels), seam.slits)];
}

// Hidden-lock sleeve, like the hidden-lock tuck box: the flap on the back
// folds inside along the last side, whose tabs fold into slits on the
// back/flap fold. Only the slits show, on that corner.
function sleeveHidden(cfg) {
    const { pw, ph, pd, t } = boxDims(cfg);
    const bh = ph * (cfg.sleeveHeight / 100);
    const g = Math.max(4, Math.min(pd - 1.5, 16)); // as wide as fits inside the side
    const xb = g, x1 = xb + pw, x2 = x1 + pd, x3 = x2 + pw, x4 = x3 + pd;
    const inset = Math.min(4, bh / 6);
    const centres = tabCentres(0, bh);
    const tabs = arrowTabs(x4, centres, t);
    const panels = [
        { id: 'lockFlap', name: 'Lock flap', poly: [[0, inset], [xb, 0], [xb, bh], [0, bh - inset]] },
        { id: 'back', name: 'Back', slot: 'back', poly: rect(xb, 0, pw, bh) },
        { id: 'side1', name: 'Side', slot: 'sideL', poly: rect(x1, 0, pd, bh) },
        { id: 'front', name: 'Front', slot: 'front', poly: rect(x2, 0, pw, bh) },
        { id: 'side2', name: 'Side', slot: 'sideR', poly: [[x3, 0], [x4, 0], ...tabs.edge, [x4, bh], [x3, bh]] },
        ...tabs.panels,
    ];
    return [finishPiece('Sleeve', panels, slitsAt(xb, centres))];
}

// ---- Public -----------------------------------------------------------------------------

const BOX_STYLES = {
    tuck: { label: 'Classic tuck box', build: classicTuck, slots: ['front', 'back', 'sideL', 'sideR', 'top', 'bottom'] },
    twoPiece: { label: 'Two-piece box', build: twoPiece, slots: ['lidTop', 'lidLong', 'lidShort', 'baseFloor', 'baseLong', 'baseShort'] },
    sleeve: { label: 'Sleeve / wrap', build: sleeve, slots: ['front', 'back', 'sideL', 'sideR'] },
    tuckLock: { label: 'Tuck box, tab lock', build: (cfg) => classicTuck(cfg, { seam: 'tabs' }), slots: ['front', 'back', 'sideL', 'sideR', 'top', 'bottom'] },
    tuckHidden: { label: 'Tuck box, hidden lock', build: (cfg) => classicTuck(cfg, { seam: 'corner' }), slots: ['front', 'back', 'sideL', 'sideR', 'top', 'bottom'] },
    tuckFixed: { label: 'Tuck box, glued bottom', build: (cfg) => classicTuck(cfg, { bottom: 'glue' }), slots: ['front', 'back', 'sideL', 'sideR', 'top', 'bottom'] },
    tuckFixedLock: { label: 'Tuck box, fixed bottom', build: (cfg) => classicTuck(cfg, { seam: 'corner', bottom: 'corner' }), slots: ['front', 'back', 'sideL', 'sideR', 'top', 'bottom'] },
    twoPieceLock: { label: 'Two-piece box, no glue', build: twoPieceLock, slots: ['lidTop', 'lidLong', 'lidShort', 'baseFloor', 'baseLong', 'baseShort'], option: 'lidDepth' },
    sleeveLock: { label: 'Sleeve, tab lock', build: sleeveLock, slots: ['front', 'back', 'sideL', 'sideR'], option: 'sleeveHeight' },
    sleeveHidden: { label: 'Sleeve, hidden lock', build: sleeveHidden, slots: ['front', 'back', 'sideL', 'sideR'], option: 'sleeveHeight' },
};
BOX_STYLES.twoPiece.option = 'lidDepth';
BOX_STYLES.sleeve.option = 'sleeveHeight';

const SLOT_LABELS = {
    front: 'Front',
    back: 'Back',
    sideL: 'Left side',
    sideR: 'Right side',
    top: 'Top (lid)',
    bottom: 'Bottom',
    lidTop: 'Lid top',
    lidLong: 'Lid long sides',
    lidShort: 'Lid short sides',
    baseFloor: 'Base floor (inside)',
    baseLong: 'Base long sides',
    baseShort: 'Base short sides',
};

function buildBox(style, cfg) {
    return BOX_STYLES[style].build(cfg);
}

if (typeof module !== 'undefined') module.exports = { buildBox, boxDims, BOX_STYLES };
