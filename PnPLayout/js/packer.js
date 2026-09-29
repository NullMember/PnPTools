// Raster nesting engine. Pure computation (no DOM), so it runs in a Web
// Worker (pack-worker.js) or, as a fallback, on the main thread.
//
// The sheet is a grid of cells. Every piece rotation is a "footprint": the
// cells its shape covers, already dilated by half the gap between pieces,
// stored as horizontal spans per row. Pieces are placed largest first, each
// on the first sheet with room, at the position whose bottom edge is highest
// (then leftmost) over all allowed rotations.
//
// Occupancy only ever grows, so once a position fails for a footprint it can
// never succeed later; the scan for that footprint resumes where it last
// stopped. That keeps large quantities of the same piece fast.

const Packer = (() => {
    function createSheet(W, H, allowed) {
        const occ = new Uint8Array(W * H);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (x < allowed.x0 || x >= allowed.x1 || y < allowed.y0 || y >= allowed.y1) occ[y * W + x] = 1;
            }
        }
        const sheet = { W, H, occ, pre: new Int32Array(H * (W + 1)), resume: new Map(), placements: [] };
        for (let y = 0; y < H; y++) updateRow(sheet, y);
        return sheet;
    }

    // Row prefix sums make "is this span empty?" an O(1) check.
    function updateRow(sheet, y) {
        const { W, occ, pre } = sheet;
        const base = y * (W + 1);
        let sum = 0;
        pre[base] = 0;
        for (let x = 0; x < W; x++) {
            sum += occ[y * W + x];
            pre[base + x + 1] = sum;
        }
    }

    // -1 if the footprint fits at (px, py); otherwise the next px worth trying.
    function fits(sheet, fp, px, py) {
        const { W, occ, pre } = sheet;
        const spans = fp.spans;
        for (let i = 0; i < spans.length; i += 3) {
            const y = py + spans[i];
            const a = px + spans[i + 1];
            const b = px + spans[i + 2];
            const base = y * (W + 1);
            if (pre[base + b] - pre[base + a] !== 0) {
                let k = b - 1;
                while (!occ[y * W + k]) k--;
                return k - spans[i + 1] + 1;
            }
        }
        return -1;
    }

    // First fitting position in scan order from `start`, looking no further
    // down than row maxPy. Returns { index, scannedTo }.
    function find(sheet, fp, start, maxPy) {
        const { W, H } = sheet;
        const lastPy = Math.min(H - fp.h, maxPy);
        let py = Math.floor(start / W);
        let px = start % W;
        for (; py <= lastPy; py++, px = 0) {
            while (px <= W - fp.w) {
                const next = fits(sheet, fp, px, py);
                if (next < 0) return { index: py * W + px, scannedTo: py * W + px };
                px = Math.max(px + 1, next);
            }
        }
        return { index: -1, scannedTo: (lastPy + 1) * W };
    }

    function place(sheet, fp, px, py) {
        const { W, occ } = sheet;
        const spans = fp.spans;
        for (let i = 0; i < spans.length; i += 3) {
            const y = py + spans[i];
            occ.fill(1, y * W + px + spans[i + 1], y * W + px + spans[i + 2]);
        }
        for (let r = 0; r < fp.h; r++) updateRow(sheet, py + r);
    }

    function tryPlace(sheet, item) {
        let best = null;
        item.footprints.forEach((fp, fi) => {
            const key = `${item.key}/${fi}`;
            const start = sheet.resume.get(key) || 0;
            // Only positions that beat the current best bottom edge matter.
            const maxPy = best ? best.bottom - fp.h : Infinity;
            const { index, scannedTo } = find(sheet, fp, start, maxPy);
            if (index < 0) {
                sheet.resume.set(key, Math.max(start, scannedTo));
                return;
            }
            sheet.resume.set(key, index);
            const py = Math.floor(index / sheet.W);
            const px = index % sheet.W;
            const bottom = py + fp.h;
            if (!best || bottom < best.bottom || (bottom === best.bottom && px < best.px)) {
                best = { fp, px, py, bottom };
            }
        });
        if (!best) return false;
        place(sheet, best.fp, best.px, best.py);
        sheet.placements.push({
            key: item.key,
            angle: best.fp.angle,
            cx: best.px + best.fp.cx,
            cy: best.py + best.fp.cy,
        });
        return true;
    }

    /**
     * job: {
     *   W, H,                      // sheet size in cells
     *   allowed: { x0, y0, x1, y1 } // cells a dilated footprint may use
     *   items: [{ key, count, footprints: [{ angle, w, h, cx, cy, area, spans: Int32Array[r, x0, x1, ...] }] }]
     * }
     * -> { sheets: [[{ key, angle, cx, cy }]], unplaced: { key: count } }
     */
    function pack(job, onProgress) {
        const instances = [];
        job.items.forEach((item) => {
            for (let i = 0; i < item.count; i++) instances.push(item);
        });
        instances.sort((a, b) => b.footprints[0].area - a.footprints[0].area);

        const sheets = [];
        const unplaced = {};
        instances.forEach((item, n) => {
            if (onProgress && n % 10 === 0) onProgress(n / instances.length);
            if (!item.footprints.length) {
                unplaced[item.key] = (unplaced[item.key] || 0) + 1;
                return;
            }
            for (const sheet of sheets) {
                if (tryPlace(sheet, item)) return;
            }
            const fresh = createSheet(job.W, job.H, job.allowed);
            if (tryPlace(fresh, item)) {
                sheets.push(fresh);
            } else {
                unplaced[item.key] = (unplaced[item.key] || 0) + 1;
            }
        });
        return { sheets: sheets.map((s) => s.placements), unplaced };
    }

    return { pack };
})();

if (typeof module !== 'undefined') module.exports = Packer;
