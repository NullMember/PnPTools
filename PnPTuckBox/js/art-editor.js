// Artwork editor: a dialog for one panel's art.
//   Position — the panel as it reads on the box; drag to pan, wheel or slider
//              to zoom, plus fit mode and rotation.
//   Crop     — the whole image with a crop box to drag and resize.
// Edits apply live (onChange); Cancel restores what the panel had before.

const ArtEditor = (() => {
    const MODES = { fill: 'Fill', fit: 'Fit', stretch: 'Stretch', extend: 'Extend' };
    const FULL = { x: 0, y: 0, w: 1, h: 1 };
    const MIN_CROP = 0.05;
    const ZOOM_MIN = 0.1, ZOOM_MAX = 8;

    let dialog = null;
    let session = null; // { a, img, panel, bleed, onChange, before, tab }

    const $e = (sel) => dialog.querySelector(sel);

    function build() {
        dialog = document.createElement('dialog');
        dialog.className = 'art-editor';
        dialog.setAttribute('aria-labelledby', 'artEditorTitle');
        dialog.innerHTML = `
  <div class="ae-head">
    <h2 id="artEditorTitle">Edit artwork</h2>
    <div class="ae-tabs" role="tablist">
      <button type="button" role="tab" data-tab="position" aria-selected="true">Position</button>
      <button type="button" role="tab" data-tab="crop" aria-selected="false">Crop</button>
    </div>
  </div>
  <div class="ae-body">
    <div class="ae-stage"><canvas class="ae-canvas"></canvas></div>
    <div class="ae-controls">
      <div class="ae-group" data-for="position">
        <div class="control-group">
          <label for="aeMode">Fit</label>
          <select id="aeMode" data-persist="false">${Object.entries(MODES).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
        </div>
        <div class="control-group">
          <label for="aeZoom">Zoom <span class="ae-zoom-value" id="aeZoomValue">100%</span></label>
          <input type="range" id="aeZoom" data-persist="false" min="-2.303" max="2.079" step="0.01" value="0">
        </div>
        <div class="button-row">
          <button type="button" class="btn-secondary btn-small" id="aeRotate">Rotate 90°</button>
          <button type="button" class="btn-secondary btn-small" id="aeCenter">Centre</button>
          <button type="button" class="btn-secondary btn-small" id="aeResetView">Reset position</button>
        </div>
        <p class="input-hint">Drag the image to move it; scroll or use the slider to zoom. The dashed line is the bleed; the faded part is cut away.</p>
      </div>
      <div class="ae-group" data-for="crop" hidden>
        <p class="input-hint">Drag the box's edges or corners to keep only part of the image, or drag inside it to move it. The kept part is then fitted to the panel.</p>
        <div class="ae-crop-size" id="aeCropSize"></div>
        <button type="button" class="btn-secondary btn-small" id="aeResetCrop">Use the whole image</button>
      </div>
    </div>
  </div>
  <div class="ae-foot">
    <button type="button" class="btn-secondary" id="aeCancel">Cancel</button>
    <button type="button" class="btn-primary" id="aeDone">Done</button>
  </div>`;
        document.body.append(dialog);

        dialog.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
        $e('#aeMode').addEventListener('change', () => { session.a.mode = $e('#aeMode').value; changed(); });
        $e('#aeZoom').addEventListener('input', () => setZoom(Math.exp(parseFloat($e('#aeZoom').value))));
        $e('#aeRotate').addEventListener('click', () => {
            const a = session.a;
            a.rot = ((a.rot || 0) + 90) % 360;
            a.dx = 0; // the frame's sides swap, so re-centre rather than guess
            a.dy = 0;
            changed();
        });
        $e('#aeCenter').addEventListener('click', () => { session.a.dx = 0; session.a.dy = 0; changed(); });
        $e('#aeResetView').addEventListener('click', () => { Object.assign(session.a, { zoom: 1, dx: 0, dy: 0 }); changed(); });
        $e('#aeResetCrop').addEventListener('click', () => { session.a.crop = null; changed(); });
        $e('#aeCancel').addEventListener('click', () => close(false));
        $e('#aeDone').addEventListener('click', () => close(true));
        dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(false); }); // Esc
        dialog.addEventListener('keydown', onKey);

        const canvas = $e('.ae-canvas');
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onHover);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        new ResizeObserver(() => session && draw()).observe($e('.ae-stage'));
    }

    // ---- Opening and closing ------------------------------------------------------------

    /**
     * open({ title, a, img, panel: { w, h, artRot }, bleed, onChange })
     * a: the panel's art entry ({ mode, rot, crop, zoom, dx, dy }), edited in place.
     */
    function open(opts) {
        if (!dialog) build();
        const { a } = opts;
        session = {
            ...opts,
            before: JSON.parse(JSON.stringify(a)), // restored exactly on Cancel
            tab: 'position',
        };
        $e('#artEditorTitle').textContent = opts.title || 'Edit artwork';
        setTab('position');
        dialog.showModal();
        sync();
        requestAnimationFrame(draw);
    }

    function close(keep) {
        if (!session) return;
        if (!keep) {
            Object.keys(session.a).forEach((k) => { if (!(k in session.before)) delete session.a[k]; });
            Object.assign(session.a, session.before);
            session.onChange && session.onChange();
        }
        session.onClose && session.onClose(keep);
        session = null;
        dialog.close();
    }

    function setTab(tab) {
        session.tab = tab;
        dialog.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
        dialog.querySelectorAll('.ae-group').forEach((g) => { g.hidden = g.dataset.for !== tab; });
        draw();
    }

    function changed() {
        sync();
        draw();
        session.onChange && session.onChange();
    }

    function sync() {
        const a = session.a;
        $e('#aeMode').value = a.mode || 'fill';
        const z = a.zoom || 1;
        $e('#aeZoom').value = Math.log(z).toFixed(3);
        $e('#aeZoomValue').textContent = `${Math.round(z * 100)}%`;
        const c = a.crop || FULL;
        const iw = session.img.naturalWidth, ih = session.img.naturalHeight;
        $e('#aeCropSize').textContent = `Keeping ${Math.round(c.w * iw)} × ${Math.round(c.h * ih)} px of ${iw} × ${ih}`;
    }

    // ---- Geometry ---------------------------------------------------------------------------

    // The panel as it reads on the box (its layout rotation undone), and the
    // art frame inside it (turned by the art's own rotation).
    function frames() {
        const { panel, a } = session;
        const reading = panel.artRot % 180 ? { w: panel.h, h: panel.w } : { w: panel.w, h: panel.h };
        const rot = (a.rot || 0) % 360;
        const art = rot % 180 ? { w: reading.h, h: reading.w } : { w: reading.w, h: reading.h };
        return { reading, art, rot };
    }

    // Canvas scale and the view it shows.
    function view(canvas) {
        const stage = $e('.ae-stage');
        const cw = Math.max(200, stage.clientWidth), ch = Math.max(200, stage.clientHeight);
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
            canvas.width = Math.round(cw * dpr);
            canvas.height = Math.round(ch * dpr);
            canvas.style.width = `${cw}px`;
            canvas.style.height = `${ch}px`;
        }
        return { cw, ch, dpr };
    }

    // ---- Drawing ----------------------------------------------------------------------------

    function draw() {
        if (!session) return;
        const canvas = $e('.ae-canvas');
        const { cw, ch, dpr } = view(canvas);
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        if (session.tab === 'crop') drawCrop(ctx, cw, ch);
        else drawPosition(ctx, cw, ch);
    }

    function positionTransform(cw, ch) {
        const { reading } = frames();
        const b = session.bleed;
        // The panel plus room around it to see what is cut away.
        const pad = Math.max(b * 2, Math.max(reading.w, reading.h) * 0.35);
        const k = Math.min(cw / (reading.w + 2 * pad), ch / (reading.h + 2 * pad));
        return { k, ox: cw / 2, oy: ch / 2 };
    }

    function drawPosition(ctx, cw, ch) {
        const { a, img, bleed } = session;
        const { reading, art, rot } = frames();
        const { k, ox, oy } = positionTransform(cw, ch);
        const box = (w, h, grow = 0) => {
            const p = new Path2D();
            p.rect(-w / 2 - grow, -h / 2 - grow, w + 2 * grow, h + 2 * grow);
            return p;
        };
        const drawArt = (b) => {
            ctx.save();
            ctx.rotate((rot * Math.PI) / 180);
            drawFitted(ctx, img, art.w, art.h, a, b);
            ctx.restore();
        };
        ctx.save();
        ctx.translate(ox, oy);
        ctx.scale(k, k);
        // Everything the image covers, faded; then the kept part (panel + bleed) at full strength.
        ctx.globalAlpha = 0.3;
        drawArt(0);
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.clip(box(reading.w, reading.h, bleed));
        ctx.fillStyle = '#ffffff';
        ctx.fill(box(reading.w, reading.h, bleed));
        drawArt(bleed);
        ctx.restore();
        // Panel (cut line) and bleed outlines.
        ctx.lineWidth = 1.5 / k;
        ctx.strokeStyle = '#e03131';
        ctx.stroke(box(reading.w, reading.h));
        if (bleed > 0) {
            ctx.setLineDash([4 / k, 3 / k]);
            ctx.lineWidth = 1 / k;
            ctx.strokeStyle = '#2b6cb0';
            ctx.stroke(box(reading.w, reading.h, bleed));
        }
        ctx.restore();
    }

    function cropTransform(cw, ch) {
        const iw = session.img.naturalWidth, ih = session.img.naturalHeight;
        const pad = 18;
        const k = Math.min((cw - 2 * pad) / iw, (ch - 2 * pad) / ih);
        return { k, x0: (cw - iw * k) / 2, y0: (ch - ih * k) / 2, iw, ih };
    }

    function cropRectPx(t) {
        const c = session.a.crop || FULL;
        return { x: t.x0 + c.x * t.iw * t.k, y: t.y0 + c.y * t.ih * t.k, w: c.w * t.iw * t.k, h: c.h * t.ih * t.k };
    }

    function drawCrop(ctx, cw, ch) {
        const t = cropTransform(cw, ch);
        ctx.drawImage(session.img, t.x0, t.y0, t.iw * t.k, t.ih * t.k);
        const r = cropRectPx(t);
        // Darken what is cropped away.
        ctx.fillStyle = 'rgba(15, 17, 23, 0.55)';
        const shade = new Path2D();
        shade.rect(t.x0, t.y0, t.iw * t.k, t.ih * t.k);
        shade.rect(r.x, r.y, r.w, r.h);
        ctx.fill(shade, 'evenodd');
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#3f5fe8';
        handles(r).forEach(({ x, y }) => {
            ctx.beginPath();
            ctx.rect(x - 5, y - 5, 10, 10);
            ctx.fill();
            ctx.stroke();
        });
    }

    function handles(r) {
        const xs = { w: r.x, c: r.x + r.w / 2, e: r.x + r.w };
        const ys = { n: r.y, c: r.y + r.h / 2, s: r.y + r.h };
        return [
            { key: 'nw', x: xs.w, y: ys.n }, { key: 'n', x: xs.c, y: ys.n }, { key: 'ne', x: xs.e, y: ys.n },
            { key: 'e', x: xs.e, y: ys.c }, { key: 'se', x: xs.e, y: ys.s }, { key: 's', x: xs.c, y: ys.s },
            { key: 'sw', x: xs.w, y: ys.s }, { key: 'w', x: xs.w, y: ys.c },
        ];
    }

    // ---- Interaction ------------------------------------------------------------------------

    function canvasPoint(e) {
        const r = $e('.ae-canvas').getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    // Screen movement (reading frame, mm) -> pan fractions of the art frame.
    function panBy(dxMm, dyMm) {
        const { art, rot } = frames();
        const r = (-rot * Math.PI) / 180;
        const ux = dxMm * Math.cos(r) - dyMm * Math.sin(r);
        const uy = dxMm * Math.sin(r) + dyMm * Math.cos(r);
        session.a.dx = (session.a.dx || 0) + ux / art.w;
        session.a.dy = (session.a.dy || 0) + uy / art.h;
    }

    // Zoom, keeping the image point under (px, py) — canvas px — in place.
    function setZoom(z, px, py) {
        const a = session.a;
        const old = a.zoom || 1;
        z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
        if (px != null) {
            const canvas = $e('.ae-canvas');
            const { k, ox, oy } = positionTransform(parseFloat(canvas.style.width), parseFloat(canvas.style.height));
            const { art, rot } = frames();
            // Cursor and image centre in the reading frame (mm).
            const cx = (px - ox) / k, cy = (py - oy) / k;
            const r = (rot * Math.PI) / 180;
            const ax = (a.dx || 0) * art.w, ay = (a.dy || 0) * art.h;
            const icx = ax * Math.cos(r) - ay * Math.sin(r), icy = ax * Math.sin(r) + ay * Math.cos(r);
            const f = z / old;
            panBy((cx + (icx - cx) * f) - icx, (cy + (icy - cy) * f) - icy);
        }
        a.zoom = z;
        changed();
    }

    function onWheel(e) {
        if (session.tab !== 'position') return;
        e.preventDefault();
        const p = canvasPoint(e);
        setZoom((session.a.zoom || 1) * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    }

    function cropHit(p) {
        const canvas = $e('.ae-canvas');
        const t = cropTransform(parseFloat(canvas.style.width), parseFloat(canvas.style.height));
        const r = cropRectPx(t);
        const h = handles(r).find((q) => Math.abs(q.x - p.x) <= 8 && Math.abs(q.y - p.y) <= 8);
        if (h) return { key: h.key, t };
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { key: 'move', t };
        return null;
    }

    const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move' };

    function onHover(e) {
        if (!session || e.buttons) return;
        const canvas = $e('.ae-canvas');
        if (session.tab === 'position') { canvas.style.cursor = 'grab'; return; }
        const hit = cropHit(canvasPoint(e));
        canvas.style.cursor = hit ? CURSORS[hit.key] : 'default';
    }

    function onPointerDown(e) {
        const canvas = $e('.ae-canvas');
        const start = canvasPoint(e);
        let move;
        if (session.tab === 'position') {
            const { k } = positionTransform(parseFloat(canvas.style.width), parseFloat(canvas.style.height));
            let last = start;
            canvas.style.cursor = 'grabbing';
            move = (p) => {
                panBy((p.x - last.x) / k, (p.y - last.y) / k);
                last = p;
                changed();
            };
        } else {
            const hit = cropHit(start);
            if (!hit) return;
            const c0 = { ...(session.a.crop || FULL) };
            const { t } = hit;
            move = (p) => {
                const fx = (p.x - start.x) / (t.iw * t.k), fy = (p.y - start.y) / (t.ih * t.k);
                session.a.crop = resizeCrop(c0, hit.key, fx, fy);
                changed();
            };
        }
        canvas.setPointerCapture(e.pointerId);
        const onMove = (ev) => move(canvasPoint(ev));
        const onUp = () => {
            canvas.removeEventListener('pointermove', onMove);
            canvas.removeEventListener('pointerup', onUp);
            canvas.removeEventListener('pointercancel', onUp);
            onHover(e);
        };
        canvas.addEventListener('pointermove', onMove);
        canvas.addEventListener('pointerup', onUp);
        canvas.addEventListener('pointercancel', onUp);
    }

    // The crop after dragging `key` (a handle, or move) by (fx, fy) image fractions.
    function resizeCrop(c, key, fx, fy) {
        let x0 = c.x, y0 = c.y, x1 = c.x + c.w, y1 = c.y + c.h;
        if (key === 'move') {
            const dx = Math.max(-x0, Math.min(1 - x1, fx)), dy = Math.max(-y0, Math.min(1 - y1, fy));
            return { x: x0 + dx, y: y0 + dy, w: c.w, h: c.h };
        }
        if (key.includes('w')) x0 = Math.max(0, Math.min(x1 - MIN_CROP, x0 + fx));
        if (key.includes('e')) x1 = Math.min(1, Math.max(x0 + MIN_CROP, x1 + fx));
        if (key.includes('n')) y0 = Math.max(0, Math.min(y1 - MIN_CROP, y0 + fy));
        if (key.includes('s')) y1 = Math.min(1, Math.max(y0 + MIN_CROP, y1 + fy));
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    // Arrow keys pan by 1 mm (5 with Shift); + and − zoom.
    function onKey(e) {
        if (!session || session.tab !== 'position') return;
        if (e.target.matches('input, select')) return;
        const step = e.shiftKey ? 5 : 1;
        const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        if (moves[e.key]) {
            e.preventDefault();
            panBy(...moves[e.key]);
            changed();
        } else if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            setZoom((session.a.zoom || 1) * 1.1);
        } else if (e.key === '-') {
            e.preventDefault();
            setZoom((session.a.zoom || 1) / 1.1);
        }
    }

    return { open, close, get isOpen() { return !!session; } };
})();
