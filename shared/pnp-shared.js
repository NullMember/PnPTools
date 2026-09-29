// PnPTools shared runtime — canonical copy lives in the hub's shared/ folder
// and is copied verbatim into every tool by scripts/sync-shared.sh, so each
// tool keeps working when deployed on its own. Do not edit the per-tool copies.
//
// Exposes a single global, PnP, with:
//   PnP.init({ tool, ... })       top bar (hub + tool links, mm/in toggle, project buttons)
//   PnP.settings                   auto-persisted sidebar settings (localStorage)
//   PnP.units                      mm / inch display layer for inputs marked data-unit="mm"
//   PnP.presets / bindPreset()     shared card and paper size presets
//   PnP.bindMachinePreset() / cutSvg()  cutting-machine dead margin + guide-framed SVG cut files
//   PnP.handoff                    pass image sets between tools (IndexedDB)
//   PnP.sendMenu() / filePicker()  send files to a tool / pick recorded files
//   PnP.outputPreviewButton() / previewOutput()  the project library, and a viewer for its files
//   PnP.recordFiles()              remember a tool's inputs / outputs for that viewer
//   PnP.project                    .pnp project files (zip: manifest.json + files/)
//   PnP.guard()                    warn before leaving with unsaved work
//   PnP.dropzone()                 drag & drop + click-to-browse file zone
//   PnP.zip                        tiny dependency-free zip writer/reader

(() => {
    'use strict';

    const MM_PER_IN = 25.4;
    // The site root (the folder above shared/), wherever the site is served.
    const ROOT = new URL('../', document.currentScript.src).href;

    const TOOLS = [
        { id: 'PnPCardCrop', name: 'CardCrop', icon: '✂️', path: 'PnPCardCrop/index.html' },
        { id: 'PnPAlign', name: 'Align', icon: '🎯', path: 'PnPAlign/index.html' },
        { id: 'PnPBleed', name: 'Bleed', icon: '🩸', path: 'PnPBleed/index.html' },
        { id: 'PnPLayout', name: 'Layout', icon: '🗂️', path: 'PnPLayout/index.html' },
        { id: 'PnPBooklet', name: 'Booklet', icon: '📖', path: 'PnPBooklet/index.html' },
        { id: 'PnPCut', name: 'Cut', icon: '✒️', path: 'PnPCut/index.html' },
        { id: 'PnPTuckBox', name: 'TuckBox', icon: '📦', path: 'PnPTuckBox/index.html' },
    ];

    // ---------------------------------------------------------------- utils

    function storageGet(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    function storageSet(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            // Private mode / quota — settings just won't persist.
        }
    }

    function storageRemove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) { /* ignore */ }
    }

    function h(tag, attrs = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
            else node.setAttribute(k, v === true ? '' : v);
        }
        for (const child of children.flat()) {
            if (child === null || child === undefined || child === false) continue;
            node.append(child instanceof Node ? child : String(child));
        }
        return node;
    }

    // ---------------------------------------------------------------- file names

    // A tool's name as it reads in a sentence: "Bleed tool".
    const toolLabel = (name) => `${name} tool`;

    // "cards/Ace.png" -> "Ace"
    const baseName = (name) => String(name || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const safeFileName = (name) => String(name).replace(/[\\/:*?"<>|]/g, '_').trim();

    // Base name for an output made from `sources` (files or file names): the
    // source's own name when there is one, otherwise the project name,
    // otherwise ''.
    function outputBase(sources = []) {
        const names = [...sources].map((s) => (typeof s === 'string' ? s : s && s.name)).filter(Boolean);
        if (names.length === 1) return safeFileName(baseName(names[0]));
        return safeFileName(project.name().replace(/\.pnp$/i, ''));
    }

    // outputName(files, 'bleed.zip', 'cards-with-bleed.zip') -> "Deck_bleed.zip",
    // or the fallback when there is no base name.
    function outputName(sources, suffix, fallback) {
        const base = outputBase(sources);
        return base ? `${base}_${suffix}` : (fallback || suffix);
    }

    // Downloads are remembered as the tool's output (see recordFiles), except
    // project files: pass { record: false }.
    function downloadBlob(blob, filename, { record = true } = {}) {
        if (record) recordDownload(blob, filename);
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: filename });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    function timeAgo(ts) {
        const s = Math.round((Date.now() - ts) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return `${Math.round(s / 60)} min ago`;
        if (s < 86400) return `${Math.round(s / 3600)} h ago`;
        return new Date(ts).toLocaleDateString();
    }

    function toast(message, type = 'info') {
        let host = document.querySelector('.pnp-toasts');
        if (!host) {
            host = h('div', { class: 'pnp-toasts', role: 'status', 'aria-live': 'polite' });
            document.body.appendChild(host);
        }
        const node = h('div', { class: `pnp-toast ${type}` }, message);
        host.appendChild(node);
        setTimeout(() => node.classList.add('leaving'), 3500);
        setTimeout(() => node.remove(), 4000);
    }

    // URLs of another tool and of the hub page.
    function toolUrl(tool) {
        return new URL(tool.path, ROOT).href;
    }

    function hubUrl() {
        return new URL('index.html', ROOT).href;
    }

    // The unit layer overrides .value on mm inputs; nativeValue reads the raw
    // stored millimetres regardless.
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    // Set a field's value (keeping any unit proxy in sync) and notify
    // listeners like a user edit would.
    function setFieldValue(el, value, events = ['input', 'change']) {
        if (el.type === 'checkbox' || el.type === 'radio') {
            el.checked = !!value;
        } else {
            el.value = value;
        }
        events.forEach((type) => el.dispatchEvent(new Event(type, { bubbles: true })));
    }

    // ---------------------------------------------------------------- zip

    const zip = (() => {
        const CRC_TABLE = new Uint32Array(256).map((_, n) => {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            return c >>> 0;
        });

        function crc32(bytes) {
            let crc = 0xffffffff;
            for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
            return (crc ^ 0xffffffff) >>> 0;
        }

        // entries: [{ name, data: Uint8Array | Blob | string }] -> Blob (STORE, no compression)
        async function create(entries) {
            const enc = new TextEncoder();
            const parts = [];
            const central = [];
            let offset = 0;
            for (const entry of entries) {
                let data = entry.data;
                if (typeof data === 'string') data = enc.encode(data);
                else if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
                const name = enc.encode(entry.name);
                const crc = crc32(data);

                const local = new DataView(new ArrayBuffer(30));
                local.setUint32(0, 0x04034b50, true);
                local.setUint16(4, 20, true);
                local.setUint16(6, 0x0800, true); // UTF-8 names
                local.setUint32(14, crc, true);
                local.setUint32(18, data.length, true);
                local.setUint32(22, data.length, true);
                local.setUint16(26, name.length, true);
                parts.push(local, name, data);

                const cen = new DataView(new ArrayBuffer(46));
                cen.setUint32(0, 0x02014b50, true);
                cen.setUint16(4, 20, true);
                cen.setUint16(6, 20, true);
                cen.setUint16(8, 0x0800, true);
                cen.setUint32(16, crc, true);
                cen.setUint32(20, data.length, true);
                cen.setUint32(24, data.length, true);
                cen.setUint16(28, name.length, true);
                cen.setUint32(42, offset, true);
                central.push(cen, name);

                offset += 30 + name.length + data.length;
            }
            const centralSize = central.reduce((n, p) => n + p.byteLength, 0);
            const end = new DataView(new ArrayBuffer(22));
            end.setUint32(0, 0x06054b50, true);
            end.setUint16(8, entries.length, true);
            end.setUint16(10, entries.length, true);
            end.setUint32(12, centralSize, true);
            end.setUint32(16, offset, true);
            return new Blob([...parts, ...central, end], { type: 'application/zip' });
        }

        async function inflateRaw(bytes) {
            if (typeof DecompressionStream === 'undefined') {
                throw new Error('This browser cannot read compressed zip files.');
            }
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        }

        // Blob -> Map(name -> Uint8Array). Supports STORE and DEFLATE entries.
        async function read(blob) {
            const buf = new Uint8Array(await blob.arrayBuffer());
            const view = new DataView(buf.buffer);
            let eocd = -1;
            for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
                if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
            }
            if (eocd < 0) throw new Error('Not a valid project file.');
            const count = view.getUint16(eocd + 10, true);
            let p = view.getUint32(eocd + 16, true);
            const dec = new TextDecoder();
            const files = new Map();
            for (let i = 0; i < count; i++) {
                if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt project file.');
                const method = view.getUint16(p + 10, true);
                const compSize = view.getUint32(p + 20, true);
                const nameLen = view.getUint16(p + 28, true);
                const extraLen = view.getUint16(p + 30, true);
                const commentLen = view.getUint16(p + 32, true);
                const localOffset = view.getUint32(p + 42, true);
                const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
                p += 46 + nameLen + extraLen + commentLen;

                const lNameLen = view.getUint16(localOffset + 26, true);
                const lExtraLen = view.getUint16(localOffset + 28, true);
                const start = localOffset + 30 + lNameLen + lExtraLen;
                const raw = buf.subarray(start, start + compSize);
                if (name.endsWith('/')) continue;
                if (method === 0) files.set(name, raw.slice());
                else if (method === 8) files.set(name, await inflateRaw(raw));
                else throw new Error(`Unsupported zip compression in ${name}.`);
            }
            return files;
        }

        return { create, read, crc32 };
    })();

    // ---------------------------------------------------------------- image DPI

    // DPI stored in a PNG (pHYs chunk) or JPEG (JFIF header); null if absent.
    async function readImageDpi(file) {
        const bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
        const view = new DataView(bytes.buffer);
        if (bytes[0] === 0x89 && bytes[1] === 0x50) {
            let p = 8;
            while (p + 12 <= bytes.length) {
                const len = view.getUint32(p);
                const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
                if (type === 'pHYs' && p + 17 <= bytes.length) {
                    const ppu = view.getUint32(p + 8);
                    return bytes[p + 16] === 1 && ppu > 0 ? ppu * 0.0254 : null;
                }
                if (type === 'IDAT' || type === 'IEND') return null;
                p += 12 + len;
            }
            return null;
        }
        if (bytes[0] === 0xff && bytes[1] === 0xd8) {
            let p = 2;
            while (p + 4 < bytes.length && bytes[p] === 0xff) {
                const marker = bytes[p + 1];
                const len = view.getUint16(p + 2);
                if (marker === 0xe0 && String.fromCharCode(...bytes.subarray(p + 4, p + 9)) === 'JFIF\0') {
                    const units = bytes[p + 11];
                    const density = view.getUint16(p + 12);
                    if (!density) return null;
                    if (units === 1) return density;
                    if (units === 2) return density * 2.54;
                    return null;
                }
                p += 2 + len;
            }
        }
        return null;
    }

    // A PNG blob with its DPI recorded (a pHYs chunk after IHDR), so other
    // tools and apps know its physical size.
    async function setPngDpi(blob, dpi) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return blob;
        const ppm = Math.round(dpi / 0.0254);
        const chunk = new Uint8Array(21);
        const view = new DataView(chunk.buffer);
        view.setUint32(0, 9);
        chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
        view.setUint32(8, ppm);
        view.setUint32(12, ppm);
        chunk[16] = 1; // metre
        view.setUint32(17, zip.crc32(chunk.subarray(4, 17)));
        const ihdrEnd = 8 + 25;
        // Drop a pHYs that is already there, so there's only one.
        const pv = new DataView(bytes.buffer);
        const parts = [bytes.subarray(0, ihdrEnd), chunk];
        let p = ihdrEnd;
        while (p + 12 <= bytes.length) {
            const len = pv.getUint32(p);
            const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
            if (type !== 'pHYs') parts.push(bytes.subarray(p, p + 12 + len));
            p += 12 + len;
        }
        return new Blob(parts, { type: 'image/png' });
    }

    // Text notes in a PNG (tEXt chunks, placed after IHDR). Tools use them to
    // pass facts about an image on, e.g. "PnPTools:bleed" = the bleed (mm) Bleed
    // added, so Layout can find the card inside it.
    async function setPngText(blob, key, value) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return blob;
        const data = new TextEncoder().encode(`${key}\0${value}`);
        const chunk = new Uint8Array(12 + data.length);
        const view = new DataView(chunk.buffer);
        view.setUint32(0, data.length);
        chunk.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
        chunk.set(data, 8);
        view.setUint32(8 + data.length, zip.crc32(chunk.subarray(4, 8 + data.length)));
        // Drop an older note with the same key.
        const pv = new DataView(bytes.buffer);
        const ihdrEnd = 8 + 25;
        const parts = [bytes.subarray(0, ihdrEnd), chunk];
        let p = ihdrEnd;
        while (p + 12 <= bytes.length) {
            const len = pv.getUint32(p);
            const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
            const same = type === 'tEXt' && new TextDecoder().decode(bytes.subarray(p + 8, p + 8 + len)).split('\0')[0] === key;
            if (!same) parts.push(bytes.subarray(p, p + 12 + len));
            p += 12 + len;
        }
        return new Blob(parts, { type: 'image/png' });
    }

    // The value of a PNG text note, or null.
    async function readPngText(file, key) {
        const bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
        if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
        const view = new DataView(bytes.buffer);
        let p = 8;
        while (p + 12 <= bytes.length) {
            const len = view.getUint32(p);
            const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
            if (type === 'IDAT' || type === 'IEND') return null;
            if (type === 'tEXt' && p + 8 + len <= bytes.length) {
                const [k, ...v] = new TextDecoder().decode(bytes.subarray(p + 8, p + 8 + len)).split('\0');
                if (k === key) return v.join('\0');
            }
            p += 12 + len;
        }
        return null;
    }

    // A PNG or JPEG blob with its DPI recorded; other blobs, or no DPI, come
    // back unchanged. Tools stamp every image they output so the next tool
    // (Layout, TuckBox…) and other apps print it at the right size.
    async function setImageDpi(blob, dpi) {
        if (!blob || !(dpi > 0)) return blob;
        const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
        if (head[0] === 0x89 && head[1] === 0x50) return setPngDpi(blob, dpi);
        if (head[0] !== 0xff || head[1] !== 0xd8) return blob;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const view = new DataView(bytes.buffer);
        const density = Math.min(65535, Math.round(dpi));
        // An existing JFIF header (canvas JPEGs have one) gets dots-per-inch.
        if (bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.subarray(6, 11)) === 'JFIF\0') {
            const out = bytes.slice();
            const v = new DataView(out.buffer);
            out[13] = 1;
            v.setUint16(14, density);
            v.setUint16(16, density);
            return new Blob([out], { type: 'image/jpeg' });
        }
        const app0 = new Uint8Array(18);
        const a = new DataView(app0.buffer);
        app0.set([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1]);
        a.setUint16(12, density);
        a.setUint16(14, density);
        return new Blob([bytes.subarray(0, 2), app0, bytes.subarray(2)], { type: 'image/jpeg' });
    }

    // ---------------------------------------------------------------- presets

    const presets = {
        card: [
            { id: 'poker', label: 'Poker', w: 63, h: 88 },
            { id: 'usPoker', label: 'US Poker', w: 63.5, h: 88.9 },
            { id: 'bridge', label: 'Bridge', w: 57, h: 89 },
            { id: 'euro', label: 'Standard European', w: 59, h: 92 },
            { id: 'miniAmerican', label: 'Mini American', w: 41, h: 63 },
            { id: 'miniEuropean', label: 'Mini European', w: 44, h: 68 },
            { id: 'tarot', label: 'Tarot', w: 70, h: 120 },
            { id: 'large', label: 'Large (Dixit)', w: 80, h: 120 },
            { id: 'square', label: 'Square', w: 70, h: 70 },
        ],
        paper: [
            { id: 'a4', label: 'A4', w: 210, h: 297 },
            { id: 'a4l', label: 'A4 landscape', w: 297, h: 210 },
            { id: 'letter', label: 'US Letter', w: 215.9, h: 279.4 },
            { id: 'letterl', label: 'US Letter landscape', w: 279.4, h: 215.9 },
            { id: 'a3', label: 'A3', w: 297, h: 420 },
            { id: 'a3l', label: 'A3 landscape', w: 420, h: 297 },
            { id: 'legal', label: 'US Legal', w: 215.9, h: 355.6 },
        ],
    };

    function formatSize(p) {
        if (units.current === 'in') {
            const f = (v) => +(v / MM_PER_IN).toFixed(2);
            return `${f(p.w)} × ${f(p.h)} in`;
        }
        return `${p.w} × ${p.h} mm`;
    }

    // Fill `select` with presets and keep it in sync with the two mm inputs:
    // choosing a preset writes the inputs; editing an input selects the
    // matching preset (or "Custom").
    //
    // Card presets also get a ⇄ button between the inputs that swaps width
    // and height, for landscape cards. A card preset matches in either
    // orientation, and choosing one keeps the current orientation.
    function bindPreset(select, wInput, hInput, list) {
        const rotatable = list === 'card';
        if (typeof list === 'string') list = presets[list];
        const read = (el) => parseFloat(nativeValue.get.call(el));
        const render = () => {
            const current = select.value;
            select.innerHTML = '';
            list.forEach((p) => select.append(h('option', { value: p.id }, `${p.label} (${formatSize(p)})`)));
            select.append(h('option', { value: 'custom' }, 'Custom'));
            if (current) select.value = current;
        };
        const same = (a, b) => Math.abs(a - b) < 0.05;
        const syncFromInputs = () => {
            const w = read(wInput);
            const hh = read(hInput);
            const match = list.find((p) => (same(p.w, w) && same(p.h, hh)) || (rotatable && same(p.w, hh) && same(p.h, w)));
            select.value = match ? match.id : 'custom';
        };
        render();
        syncFromInputs();
        select.addEventListener('change', () => {
            const p = list.find((x) => x.id === select.value);
            if (!p) return;
            const landscape = rotatable && read(wInput) > read(hInput);
            setFieldValue(wInput, landscape ? p.h : p.w);
            setFieldValue(hInput, landscape ? p.w : p.h);
        });
        [wInput, hInput].forEach((el) => el.addEventListener('input', syncFromInputs));
        units.onChange(() => { render(); syncFromInputs(); });
        settings.onApply(syncFromInputs);
        select.dataset.persist = 'false'; // derived from the inputs
        if (rotatable) swapButton(wInput, hInput);
        return { sync: syncFromInputs };
    }

    // A ⇄ button between two inputs' control groups (when they share a .row)
    // that exchanges their values, firing the usual input/change events.
    function swapButton(aInput, bInput) {
        const aGroup = aInput.closest('.control-group');
        const bGroup = bInput.closest('.control-group');
        if (!aGroup || !bGroup || aGroup.parentElement !== bGroup.parentElement) return null;
        const btn = h('button', {
            type: 'button',
            class: 'pnp-swap',
            title: 'Swap width and height (landscape / portrait)',
            'aria-label': 'Swap width and height',
            onclick: () => {
                const a = nativeValue.get.call(aInput);
                const b = nativeValue.get.call(bInput);
                // Set both before notifying, so listeners never see a half-swapped pair.
                aInput.value = b;
                bInput.value = a;
                [aInput, bInput].forEach((el) => ['input', 'change'].forEach((type) => el.dispatchEvent(new Event(type, { bubbles: true }))));
            },
        }, '⇄');
        aGroup.after(btn);
        aGroup.parentElement.classList.add('pnp-swap-row');
        return btn;
    }

    // ---------------------------------------------------------------- cutting machine

    // A cutting machine can't reach a strip around the edge of its mat (the
    // "dead margin"). SVG cut files therefore cover only the reachable part of
    // the sheet — the paper minus the dead margin on every side — outlined by
    // a guide rectangle, so the cut job lines up with the printed paper once
    // the guide is placed at the machine's origin.
    const machinePresets = [
        { id: 'cricut', label: 'Cricut', margin: 6.35 },
    ];

    function formatLength(mm) {
        return units.current === 'in' ? `${+(mm / MM_PER_IN).toFixed(3)} in` : `${mm} mm`;
    }

    // Same idea as bindPreset, for the single dead-margin input.
    function bindMachinePreset(select, input) {
        const render = () => {
            select.innerHTML = '';
            machinePresets.forEach((p) => select.append(h('option', { value: p.id }, `${p.label} (${formatLength(p.margin)})`)));
            select.append(h('option', { value: 'custom' }, 'Custom'));
        };
        const syncFromInput = () => {
            const v = parseFloat(nativeValue.get.call(input));
            const match = machinePresets.find((p) => Math.abs(p.margin - v) < 0.005);
            select.value = match ? match.id : 'custom';
        };
        render();
        syncFromInput();
        select.addEventListener('change', () => {
            const p = machinePresets.find((x) => x.id === select.value);
            if (p) setFieldValue(input, p.margin);
        });
        input.addEventListener('input', syncFromInput);
        units.onChange(() => { render(); syncFromInput(); });
        settings.onApply(syncFromInput);
        select.dataset.persist = 'false'; // derived from the input
        return { sync: syncFromInput };
    }

    const CUT_GUIDE_COLOR = '#2b6cb0';

    /**
     * SVG cut file the size of the machine's reachable area (paper minus dead
     * margin), with the guide rectangle on its outline. `content` gets a
     * function that maps a paper-mm point [x, y] into the file's coordinates
     * and returns the markup.
     *
     * Keep the markup flat for Cricut Design Space: no transform attributes
     * (it mis-scales them), no <g> groups (it misplaces grouped content on
     * import) and fill/stroke on every element rather than inherited. Use
     * cutPath() for each line.
     *   cutSvg({ paperW, paperH, margin, content: (toGuide) => string }) -> string
     */
    // Size attributes for an SVG drawn in millimetres (viewBox in mm). The
    // width and height are written in inches: Cricut Design Space reads these
    // numbers as inches whatever their unit, so "197.3mm" came in as 197.3 in
    // (5 m, clamped to its 480 cm limit). Inches are right there and everywhere.
    function svgSize(wMm, hMm) {
        const mm = (v) => +v.toFixed(3);
        const inch = (v) => +(v / MM_PER_IN).toFixed(5);
        return `width="${inch(wMm)}in" height="${inch(hMm)}in" viewBox="0 0 ${mm(wMm)} ${mm(hMm)}"`;
    }

    function cutSvg({ paperW, paperH, margin, content }) {
        const f = (v) => +v.toFixed(3);
        const m = Math.max(0, margin);
        const w = f(Math.max(0, paperW - 2 * m));
        const hh = f(Math.max(0, paperH - 2 * m));
        return `<svg xmlns="http://www.w3.org/2000/svg" ${svgSize(w, hh)}>
  <rect x="0" y="0" width="${w}" height="${hh}" fill="none" stroke="${CUT_GUIDE_COLOR}" stroke-width="0.1"/>
${content(([x, y]) => [x - m, y - m])}
</svg>
`;
    }

    // One stroked polyline for cutSvg(): points are [x, y] in file coordinates.
    function cutPath(points, color, closed = true) {
        const f = (v) => +v.toFixed(3);
        const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ') + (closed ? ' Z' : '');
        return `  <path d="${d}" fill="none" stroke="${color}" stroke-width="0.25"/>`;
    }

    // True if any [x, y] point (paper mm) lies in the dead margin.
    function inDeadMargin(points, paperW, paperH, margin) {
        const eps = 1e-6;
        return points.some(([x, y]) => x < margin - eps || y < margin - eps || x > paperW - margin + eps || y > paperH - margin + eps);
    }

    // ---------------------------------------------------------------- units

    // Inputs marked data-unit="mm" always hold millimetres, so tool code never
    // changes. Each one gets a visible proxy input that shows the value in the
    // user's chosen unit; the real input is hidden and kept in sync both ways.
    const units = (() => {
        const KEY = 'pnp:units';
        let current = storageGet(KEY, 'mm') === 'in' ? 'in' : 'mm';
        const listeners = [];
        const proxies = [];

        const factor = () => (current === 'in' ? MM_PER_IN : 1);
        const fmt = (mm) => {
            const v = parseFloat(mm);
            if (!Number.isFinite(v)) return '';
            return String(+(v / factor()).toFixed(current === 'in' ? 3 : 2));
        };

        function relabel(root = document.body) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const target = current === 'in' ? '(in)' : '(mm)';
            let node;
            while ((node = walker.nextNode())) {
                if (/\((mm|in)\)/.test(node.nodeValue) && !node.parentElement.closest('option, script, style, .pnp-no-units')) {
                    node.nodeValue = node.nodeValue.replace(/\((mm|in)\)/g, target);
                }
            }
        }

        function refreshProxy(real, proxy) {
            proxy.value = fmt(nativeValue.get.call(real));
            const step = parseFloat(real.getAttribute('step'));
            proxy.step = current === 'in' ? 'any' : (real.getAttribute('step') || 'any');
            ['min', 'max'].forEach((attr) => {
                const v = parseFloat(real.getAttribute(attr));
                if (Number.isFinite(v)) proxy.setAttribute(attr, +(v / factor()).toFixed(4));
                else proxy.removeAttribute(attr);
            });
            if (!Number.isFinite(step)) proxy.step = 'any';
        }

        function attach(real) {
            if (real.dataset.unitBound) return;
            real.dataset.unitBound = '1';
            const proxy = real.cloneNode(false);
            proxy.removeAttribute('id');
            proxy.removeAttribute('name');
            proxy.removeAttribute('required');
            proxy.removeAttribute('data-unit');
            proxy.removeAttribute('data-unit-bound');
            proxy.classList.add('pnp-unit-proxy');
            proxy.id = real.id ? `${real.id}__display` : '';
            real.after(proxy);
            real.hidden = true;
            real.classList.add('pnp-unit-real');

            const label = real.id && document.querySelector(`label[for="${CSS.escape(real.id)}"]`);
            if (label && proxy.id) label.htmlFor = proxy.id;

            const push = (type) => {
                const v = parseFloat(proxy.value);
                if (!Number.isFinite(v)) return;
                nativeValue.set.call(real, +(v * factor()).toFixed(4));
                real.dispatchEvent(new Event(type, { bubbles: true }));
            };
            proxy.addEventListener('input', (e) => { e.stopPropagation(); push('input'); });
            proxy.addEventListener('change', (e) => { e.stopPropagation(); push('change'); });

            // Tool code that writes real.value (presets, auto-fit, …) updates the proxy.
            Object.defineProperty(real, 'value', {
                configurable: true,
                get() { return nativeValue.get.call(this); },
                set(v) {
                    nativeValue.set.call(this, v);
                    if (document.activeElement !== proxy) proxy.value = fmt(v);
                },
            });
            new MutationObserver(() => {
                proxy.disabled = real.disabled;
                proxy.readOnly = real.readOnly;
            }).observe(real, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
            proxy.disabled = real.disabled;

            proxies.push([real, proxy]);
            refreshProxy(real, proxy);
        }

        function scan(root = document) {
            root.querySelectorAll('input[data-unit="mm"]').forEach(attach);
        }

        function set(unit) {
            current = unit === 'in' ? 'in' : 'mm';
            storageSet(KEY, current);
            proxies.forEach(([real, proxy]) => refreshProxy(real, proxy));
            relabel();
            document.querySelectorAll('.pnp-units button').forEach((b) => {
                b.setAttribute('aria-pressed', String(b.dataset.unit === current));
            });
            listeners.forEach((fn) => fn(current));
        }

        function refresh() {
            proxies.forEach(([real, proxy]) => { if (document.activeElement !== proxy) proxy.value = fmt(nativeValue.get.call(real)); });
        }

        // Another tab changed the unit.
        window.addEventListener('storage', (e) => { if (e.key === KEY) set(storageGet(KEY, 'mm')); });

        return {
            get current() { return current; },
            scan,
            set,
            refresh,
            relabel,
            onChange: (fn) => listeners.push(fn),
            /** mm -> display string with unit, e.g. for info panels */
            format: (mm) => `${fmt(mm)} ${current}`,
        };
    })();

    // ---------------------------------------------------------------- theme

    // auto (follow the OS) / light / dark, shared by every tool. pnp-theme.js
    // applies it early in <head>; this module switches it at runtime.
    const theme = (() => {
        const KEY = 'pnp:theme';
        const ORDER = ['auto', 'light', 'dark'];
        const LABEL = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
        let current = storageGet(KEY, 'auto');
        if (!ORDER.includes(current)) current = 'auto';
        const buttons = [];

        function apply() {
            if (current === 'auto') document.documentElement.removeAttribute('data-theme');
            else document.documentElement.setAttribute('data-theme', current);
            buttons.forEach((b) => {
                b.textContent = LABEL[current];
                b.title = `Colour theme: ${current} (click to change)`;
                b.setAttribute('aria-label', `Colour theme: ${current}. Click to change.`);
            });
        }

        function set(value) {
            current = ORDER.includes(value) ? value : 'auto';
            storageSet(KEY, current);
            apply();
        }

        function toggleButton(container) {
            const b = h('button', {
                type: 'button',
                class: 'pnp-theme-toggle',
                onclick: () => set(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]),
            });
            buttons.push(b);
            if (container) container.append(b);
            apply();
            return b;
        }

        window.addEventListener('storage', (e) => {
            if (e.key === KEY) { current = storageGet(KEY, 'auto'); apply(); }
        });
        apply();
        return { get current() { return current; }, set, toggleButton };
    })();

    // ---------------------------------------------------------------- settings

    // Every input/select inside the tool's settings root (default: .sidebar)
    // that has an id is saved to localStorage on edit and restored on load.
    //   data-persist="false"    never saved
    //   data-persist="project"  saved only into project files, not localStorage
    const settings = (() => {
        let key = null;
        let root = null;
        let defaults = {};
        const applyListeners = [];

        function fields(scope = 'local') {
            if (!root) return [];
            return [...root.querySelectorAll('input[id], select[id], textarea[id]')].filter((el) => {
                if (el.type === 'file' || el.type === 'button' || el.type === 'submit') return false;
                if (el.classList.contains('pnp-unit-proxy')) return false;
                const p = el.dataset.persist;
                if (p === 'false') return false;
                if (p === 'project' && scope === 'local') return false;
                return true;
            });
        }

        function read(el) {
            return el.type === 'checkbox' || el.type === 'radio' ? el.checked : (el instanceof HTMLInputElement ? nativeValue.get.call(el) : el.value);
        }

        function collect(scope = 'local') {
            const out = {};
            fields(scope).forEach((el) => { out[el.id] = read(el); });
            return out;
        }

        // Apply values in DOM order, firing the same events a user edit would,
        // so tool code (previews, dependent fields) reacts normally.
        function apply(values) {
            if (!values) return;
            fields('project').forEach((el) => {
                if (!(el.id in values)) return;
                const v = values[el.id];
                if (read(el) === v) return;
                if (el.type === 'radio' && !v) return; // the checked sibling handles it
                if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v)) return;
                setFieldValue(el, v);
            });
            units.refresh();
            applyListeners.forEach((fn) => fn());
        }

        let saveTimer = null;
        function save() {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(flush, 150);
        }
        // A change made just before leaving is still saved.
        const storeListeners = [];
        // Returns whether there was anything to save.
        function flush() {
            if (saveTimer === null) return false;
            clearTimeout(saveTimer);
            saveTimer = null;
            storageSet(key, collect('local'));
            storeListeners.forEach((fn) => fn());
            return true;
        }

        function init(tool, rootEl) {
            key = `pnp:settings:${tool}`;
            root = rootEl;
            if (!root) return;
            defaults = collect('project');
            apply(storageGet(key, null));
            root.addEventListener('input', save);
            root.addEventListener('change', save);
            window.addEventListener('pagehide', flush);
        }

        function reset() {
            storageRemove(key);
            apply(defaults);
            storageRemove(key);
        }

        // What localStorage holds for this page (after a project was opened).
        const saved = () => storageGet(key, null);

        return { init, collect, apply, reset, saved, flush, onApply: (fn) => applyListeners.push(fn), onStore: (fn) => storeListeners.push(fn) };
    })();

    // ---------------------------------------------------------------- guard

    // Tools say whether they hold work (hasUnsavedWork). The work itself is
    // kept in the project as the user goes (see project), so leaving the
    // page doesn't need a warning.
    const guards = [];
    function guard(hasUnsavedWork) {
        guards.push(hasUnsavedWork);
    }
    let guardBypass = false;

    // ---------------------------------------------------------------- handoff

    // File sets passed between tools live in IndexedDB (same origin for the
    // hub and every standalone tool deploy): outputs (sent or downloaded) and
    // inputs (files loaded into a tool). The newest MAX_SETS of each kind are
    // kept; saving a set identical to a stored one just refreshes that one.
    const handoff = (() => {
        const DB = 'pnptools';
        const STORE = 'handoff';
        const MAX_SETS = { output: 12, input: 8 };
        // Stored sets together stay under this; the oldest go first.
        const MAX_BYTES = 500 * 1024 * 1024;
        const sizeOf = (set) => set.bytes ?? (set.items || []).reduce((n, it) => n + ((it.blob && it.blob.size) || 0), 0);
        const kindOf = (set) => set.kind || 'output';
        const signature = (kind, from, items) => JSON.stringify([kind, from, items.map((it) => [it.name, it.blob && it.blob.size])]);

        function open() {
            return new Promise((resolve, reject) => {
                const req = indexedDB.open(DB, 1);
                req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }

        async function tx(mode, fn) {
            const db = await open();
            return new Promise((resolve, reject) => {
                const t = db.transaction(STORE, mode);
                const result = fn(t.objectStore(STORE));
                t.oncomplete = () => { db.close(); resolve(result && 'result' in result ? result.result : result); };
                t.onerror = () => { db.close(); reject(t.error); };
            });
        }

        async function list() {
            const all = await tx('readonly', (s) => s.getAll());
            return (all || []).sort((a, b) => b.created - a.created);
        }

        /** items: [{ name, blob, role? }], kind: 'output' | 'input' -> id */
        async function save({ name, from, items, kind = 'output' }) {
            const sig = signature(kind, from, items);
            const same = (await list()).find((set) => set.sig === sig);
            const id = same ? same.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            // page: which tool page recorded it, so New there can clear its own sets.
            const bytes = items.reduce((n, it) => n + ((it.blob && it.blob.size) || 0), 0);
            await tx('readwrite', (s) => s.put({ id, name, from, kind, sig, page: location.pathname, created: Date.now(), bytes, items }));
            const all = await list();
            const stale = all.filter((set) => kindOf(set) === kind).slice(MAX_SETS[kind] || 12);
            // Over the size limit: drop the oldest sets, never the one just saved
            // (a tool may be about to open it).
            let total = all.filter((set) => !stale.includes(set)).reduce((n, set) => n + sizeOf(set), 0);
            for (const set of all.slice().reverse()) {
                if (total <= MAX_BYTES) break;
                if (set.id === id || stale.includes(set)) continue;
                stale.push(set);
                total -= sizeOf(set);
            }
            if (stale.length) await tx('readwrite', (s) => stale.forEach((set) => s.delete(set.id)));
            return id;
        }

        const get = (id) => tx('readonly', (s) => s.get(id));
        const remove = (id) => tx('readwrite', (s) => s.delete(id));

        // If the page was opened with ?import=<id>, hand that set to onItems once.
        async function receive(onItems) {
            const params = new URLSearchParams(location.search);
            const id = params.get('import');
            if (!id) return;
            await project.ready(); // after the page's own work is back
            params.delete('import');
            const clean = location.pathname + (params.toString() ? `?${params}` : '') + location.hash;
            history.replaceState(null, '', clean);
            try {
                const set = await get(id);
                if (!set) {
                    toast('The images sent from the other tool are no longer available.', 'error');
                    return;
                }
                await onItems(set.items, set);
                toast(`Imported ${describeSet(set)} from ${toolLabel(set.from)}.`, 'success');
            } catch (err) {
                console.error(err);
                toast(`Import failed: ${err.message}`, 'error');
            }
        }

        async function removeFromPage(path) {
            const mine = (await list()).filter((set) => set.page === path);
            if (mine.length) await tx('readwrite', (s) => mine.forEach((set) => s.delete(set.id)));
        }

        const clear = () => tx('readwrite', (s) => s.clear());

        return { list, save, get, remove, removeFromPage, clear, receive, kindOf, sizeOf, MAX_BYTES };
    })();

    // ---------------------------------------------------------------- project store

    // The open project lives in IndexedDB, so every tool page sees it and
    // nothing is lost on reload:
    //   blobs    content hash -> Blob. Files are stored once, however many
    //            batches and pages use them.
    //   batches  the library: files loaded into or made by the tools, in
    //            batches ({ id, from, kind: 'input' | 'output', created, items })
    //   pages    each tool page's work ({ key, fields, state, files }), saved as
    //            the user works and restored when the page opens
    //   info     'project' -> { name, changed, saved } (timestamps)
    // Items and files are refs: { name, hash, type, size, role }. Library
    // items also have an id and meta: what the user set in the library
    // ({ widthMm, heightMm, bleedMm, rotate, crop: { x, y, w, h }, back }).
    const store = (() => {
        const DB = 'pnptools-project';
        let dbPromise = null;

        function open() {
            if (!dbPromise) {
                dbPromise = new Promise((resolve, reject) => {
                    const req = indexedDB.open(DB, 1);
                    req.onupgradeneeded = () => {
                        const db = req.result;
                        db.createObjectStore('blobs');
                        db.createObjectStore('batches', { keyPath: 'id' });
                        db.createObjectStore('pages', { keyPath: 'key' });
                        db.createObjectStore('info');
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            }
            return dbPromise;
        }

        // Run fn(...objectStores) in one transaction; resolves with fn's
        // request result (if it returned a request) once it commits.
        async function tx(names, mode, fn) {
            const db = await open();
            return new Promise((resolve, reject) => {
                const t = db.transaction(names, mode);
                const out = fn(...names.map((n) => t.objectStore(n)));
                t.oncomplete = () => resolve(out && typeof out === 'object' && 'result' in out ? out.result : out);
                t.onerror = () => reject(t.error);
                t.onabort = () => reject(t.error);
            });
        }

        // SHA-256 of a blob's bytes, remembered per Blob object.
        const hashes = new WeakMap();
        async function hashOf(blob) {
            if (hashes.has(blob)) return hashes.get(blob);
            let hash;
            if (window.crypto && crypto.subtle) {
                const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
                hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
            } else {
                hash = `x${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`; // no dedup without crypto
            }
            hashes.set(blob, hash);
            return hash;
        }

        // Store the files ([{ name, blob, role }]) and return their refs.
        async function putFiles(items) {
            const refs = [];
            const fresh = new Map();
            const known = new Set(await tx(['blobs'], 'readonly', (b) => b.getAllKeys()));
            for (const it of items) {
                if (!it || !it.blob) continue;
                const hash = await hashOf(it.blob);
                refs.push({ name: it.name, hash, type: it.blob.type || typeFromName(it.name), size: it.blob.size, role: it.role || null });
                if (!known.has(hash)) fresh.set(hash, it.blob);
            }
            if (fresh.size) await tx(['blobs'], 'readwrite', (b) => fresh.forEach((blob, hash) => b.put(blob, hash)));
            return refs;
        }

        // Refs back to { id, name, blob, role, meta } items (missing blobs are
        // left out).
        async function resolve(refs) {
            const blobs = await tx(['blobs'], 'readonly', (b) => {
                const out = [];
                refs.forEach((r) => { const req = b.get(r.hash); req.onsuccess = () => { out.push([r, req.result]); }; });
                return out;
            });
            return refs.map((r) => {
                const found = blobs.find(([ref]) => ref === r);
                const blob = found && found[1];
                if (!blob) return null;
                hashes.set(blob, r.hash);
                return { id: r.id, name: r.name, blob, role: r.role || null, meta: r.meta || {} };
            }).filter(Boolean);
        }

        const signature = (kind, from, refs) => JSON.stringify([kind, from, refs.map((r) => r.hash)]);

        // A batch of files in the library. Adding the same files again only
        // moves that batch to the top.
        async function addBatch({ kind = 'output', from, items }) {
            const refs = await putFiles(items);
            if (!refs.length) return null;
            const sig = signature(kind, from, refs);
            const same = (await tx(['batches'], 'readonly', (b) => b.getAll())).find((x) => x.sig === sig);
            const id = same ? same.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            refs.forEach((r, i) => { r.id = `${id}:${i}`; });
            if (same) refs.forEach((r, i) => { r.meta = (same.items[i] && same.items[i].meta) || undefined; });
            await tx(['batches'], 'readwrite', (b) => b.put({ id, from, kind, sig, created: Date.now(), items: refs }));
            await touch();
            return id;
        }

        // Library batches, newest first, with their files.
        async function listBatches() {
            const all = (await tx(['batches'], 'readonly', (b) => b.getAll())) || [];
            all.sort((a, b) => b.created - a.created);
            for (const batch of all) {
                batch.items.forEach((r, i) => { if (!r.id) r.id = `${batch.id}:${i}`; });
                batch.items = await resolve(batch.items);
            }
            return all;
        }

        // Change library items: changes maps item id -> meta fields to set
        // (undefined removes one).
        async function updateItems(changes) {
            const batches = await tx(['batches'], 'readonly', (b) => b.getAll());
            const touched = [];
            batches.forEach((batch) => {
                let hit = false;
                batch.items.forEach((r, i) => {
                    const id = r.id || `${batch.id}:${i}`;
                    if (!changes.has(id)) return;
                    r.id = id;
                    const meta = { ...(r.meta || {}), ...changes.get(id) };
                    Object.keys(meta).forEach((k) => { if (meta[k] === undefined || meta[k] === null || meta[k] === '') delete meta[k]; });
                    r.meta = meta;
                    hit = true;
                });
                if (hit) touched.push(batch);
            });
            if (touched.length) await tx(['batches'], 'readwrite', (b) => touched.forEach((x) => b.put(x)));
            await touch();
        }

        // Remove library items; a batch left empty goes too.
        async function removeItems(ids) {
            const drop = new Set(ids);
            const batches = await tx(['batches'], 'readonly', (b) => b.getAll());
            await tx(['batches'], 'readwrite', (b) => batches.forEach((batch) => {
                // Ids from positions become lasting before anything moves.
                batch.items.forEach((r, i) => { if (!r.id) r.id = `${batch.id}:${i}`; });
                const keep = batch.items.filter((r) => !drop.has(r.id));
                if (keep.length === batch.items.length) return;
                if (!keep.length) b.delete(batch.id);
                else b.put({ ...batch, items: keep });
            }));
            await touch();
            await collect();
        }

        async function removeBatch(id) {
            await tx(['batches'], 'readwrite', (b) => b.delete(id));
            await touch();
            await collect();
        }

        async function clearBatches() {
            await tx(['batches'], 'readwrite', (b) => b.clear());
            await touch();
            await collect();
        }

        async function savePage(key, { fields, state, files }) {
            const refs = await putFiles(files || []);
            await tx(['pages'], 'readwrite', (p) => p.put({ key, fields: fields || {}, state: state === undefined ? null : state, files: refs, updated: Date.now() }));
            await touch();
        }

        // A page's saved work with its files as File objects, or null.
        async function loadPage(key) {
            const page = await tx(['pages'], 'readonly', (p) => p.get(key));
            if (!page) return null;
            const items = await resolve(page.files || []);
            return { ...page, files: itemsToFiles(items) };
        }

        async function getInfo() {
            return (await tx(['info'], 'readonly', (i) => i.get('project'))) || { name: '', changed: 0, saved: 0 };
        }

        async function setInfo(patch) {
            const next = { ...(await getInfo()), ...patch };
            await tx(['info'], 'readwrite', (i) => i.put(next, 'project'));
            return next;
        }

        // Something in the project changed (for "unsaved" and other tabs).
        async function touch() {
            await setInfo({ changed: Date.now() });
            channel && channel.postMessage('changed');
        }

        // Delete blobs nothing refers to any more.
        async function collect() {
            const [batches, pages, keys] = await Promise.all([
                tx(['batches'], 'readonly', (b) => b.getAll()),
                tx(['pages'], 'readonly', (p) => p.getAll()),
                tx(['blobs'], 'readonly', (b) => b.getAllKeys()),
            ]);
            const used = new Set();
            batches.forEach((b) => b.items.forEach((r) => used.add(r.hash)));
            pages.forEach((p) => (p.files || []).forEach((r) => used.add(r.hash)));
            const unused = keys.filter((k) => !used.has(k));
            if (unused.length) await tx(['blobs'], 'readwrite', (b) => unused.forEach((k) => b.delete(k)));
        }

        // Empty the whole project (library, pages, name).
        async function clearProject() {
            await tx(['blobs', 'batches', 'pages', 'info'], 'readwrite', (b, ba, p, i) => { b.clear(); ba.clear(); p.clear(); i.clear(); });
            channel && channel.postMessage('changed');
        }

        async function isEmpty() {
            const [batches, pages] = await Promise.all([
                tx(['batches'], 'readonly', (b) => b.count()),
                tx(['pages'], 'readonly', (p) => p.getAll()),
            ]);
            return !batches && pages.every((p) => !(p.files || []).length && (p.state === null || p.state === undefined));
        }

        async function sizeUsed() {
            const batches = await tx(['batches'], 'readonly', (b) => b.getAll());
            const seen = new Map();
            batches.forEach((b) => b.items.forEach((r) => seen.set(r.hash, r.size || 0)));
            return [...seen.values()].reduce((n, x) => n + x, 0);
        }

        // Everything, for a project file: records plus the blobs they use.
        async function dump() {
            const [batches, pages, info, hashesInUse] = await Promise.all([
                tx(['batches'], 'readonly', (b) => b.getAll()),
                tx(['pages'], 'readonly', (p) => p.getAll()),
                getInfo(),
                tx(['blobs'], 'readonly', (b) => b.getAllKeys()),
            ]);
            const blobs = new Map();
            await tx(['blobs'], 'readonly', (b) => hashesInUse.forEach((k) => { const req = b.get(k); req.onsuccess = () => blobs.set(k, req.result); }));
            return { batches, pages, info, blobs };
        }

        // Replace the project with a dump ({ batches, pages, info, blobs }).
        async function load({ batches, pages, info, blobs }) {
            await tx(['blobs', 'batches', 'pages', 'info'], 'readwrite', (b, ba, p, i) => {
                b.clear(); ba.clear(); p.clear(); i.clear();
                blobs.forEach((blob, hash) => b.put(blob, hash));
                batches.forEach((x) => ba.put(x));
                pages.forEach((x) => p.put(x));
                i.put(info, 'project');
            });
            blobs.forEach((blob, hash) => hashes.set(blob, hash));
            channel && channel.postMessage('changed');
        }

        // Other tabs of the site hear about changes (to refresh the library).
        const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('pnptools-project') : null;
        const listeners = [];
        if (channel) channel.onmessage = () => listeners.forEach((fn) => fn());

        return {
            addBatch, listBatches, removeBatch, clearBatches, updateItems, removeItems, savePage, loadPage, getInfo, setInfo,
            clearProject, isEmpty, sizeUsed, dump, load, hashOf, putFiles, resolve, touch, collect,
            onChange: (fn) => listeners.push(fn),
        };
    })();

    // ---------------------------------------------------------------- recorded files

    let currentTool = null; // TOOLS entry of this page, set by init()

    const EXT_TYPES = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
        svg: 'image/svg+xml', pdf: 'application/pdf', json: 'application/json', txt: 'text/plain',
    };
    const typeFromName = (name) => EXT_TYPES[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

    // An <input accept>-style list (['image/*', '.pdf', 'application/json'])
    // as a test on a file name and type; no list accepts everything.
    const acceptMatcher = (accept) => (name, type) => !accept || accept.some((a) => (a.endsWith('/*')
        ? (type || '').startsWith(a.slice(0, -1))
        : type === a || name.toLowerCase().endsWith(a)));

    // Put files a tool took in or produced into the project's library.
    // Never throws: the tool's own work doesn't depend on it.
    async function recordFiles({ kind = 'output', items, from } = {}) {
        from = from || (currentTool && currentTool.name);
        if (!from || !items || !items.length || !window.indexedDB) return null;
        try {
            const list = items.filter((it) => it && it.blob).map((it) => ({ name: it.name, blob: it.blob, role: it.role || null }));
            if (!list.length) return null;
            return await store.addBatch({ kind, from, items: list });
        } catch (err) {
            console.warn('Could not add files to the library:', err);
            return null;
        }
    }

    // A downloaded zip is recorded as its contents, so they can be previewed.
    async function recordDownload(blob, filename) {
        if (!currentTool) return;
        let items = [{ name: filename, blob }];
        if (/\.zip$/i.test(filename)) {
            try {
                const entries = await zip.read(blob);
                items = [...entries].map(([name, data]) => ({ name: name.split('/').pop(), blob: new Blob([data], { type: typeFromName(name) }) }));
            } catch (err) { /* not a zip we can read: keep it whole */ }
        }
        await recordFiles({ kind: 'output', items });
    }

    // Turn stored items back into File objects that tools' loaders accept.
    function itemsToFiles(items) {
        return items.map((it) => {
            const f = new File([it.blob], it.name, { type: it.blob.type || typeFromName(it.name) });
            if (it.role) f.pnpRole = it.role;
            return f;
        });
    }

    // "Send to →" buttons. getItems() returns [{ name, blob, role? }].
    function sendMenu(container, { from, targets, getItems, label = 'Send to' }) {
        const row = h('div', { class: 'pnp-send' }, h('span', { class: 'pnp-send-label' }, `${label}:`));
        const buttons = [];
        targets.forEach((id) => {
            const tool = TOOLS.find((t) => t.id === id);
            if (!tool) return;
            const btn = h('button', {
                type: 'button',
                class: 'btn-secondary btn-small',
                title: `Open ${toolLabel(tool.name)} in a new tab with these images`,
                onclick: async () => {
                    // Open the tab synchronously so popup blockers allow it.
                    const win = window.open('', '_blank');
                    buttons.forEach((b) => (b.disabled = true));
                    try {
                        const items = await getItems();
                        if (!items || items.length === 0) throw new Error('Nothing to send yet.');
                        const id = await handoff.save({ name: `${items.length} image(s) from ${from}`, from, items });
                        const url = `${toolUrl(tool)}?import=${encodeURIComponent(id)}`;
                        if (win) win.location.href = url;
                        else location.href = url;
                    } catch (err) {
                        if (win) win.close();
                        toast(err.message, 'error');
                    } finally {
                        buttons.forEach((b) => (b.disabled = false));
                    }
                },
            }, h('span', { class: 'pnp-send-icon', 'aria-hidden': 'true' }, tool.icon), h('span', {}, tool.name));
            buttons.push(btn);
            row.append(btn);
        });
        container.append(row);
        return {
            setEnabled(on) { buttons.forEach((b) => (b.disabled = !on)); },
        };
    }

    // "Import from other tools" button + popover listing recent hand-offs.
    // Fill `pop` with the stored tool outputs (newest first); onPick(set)
    // runs when one is chosen. Each row can also be removed from the list.
    const isImage = (it) => it.blob && /^image\//.test(it.blob.type || typeFromName(it.name));

    function describeSet(set) {
        const n = set.items.length;
        const noun = set.items.every(isImage) ? 'image' : 'file';
        return `${n} ${noun}${n === 1 ? '' : 's'}`;
    }

    // filter(item): list only sets with a matching file. browse(): adds a
    // first row that opens the file chooser instead.
    async function renderOutputList(pop, onPick, opts = {}) {
        const { filter, browse, footer } = opts;
        pop.innerHTML = '';
        let sets = [];
        try { sets = await store.listBatches(); } catch (err) { /* IndexedDB unavailable */ }
        if (filter) sets = sets.filter((set) => set.items.some(filter));
        if (browse) {
            pop.append(h('div', { class: 'pnp-popover-row' }, h('button', {
                type: 'button',
                class: 'pnp-popover-item pnp-popover-browse',
                onclick: () => { pop.hidden = true; browse(); },
            }, h('strong', {}, 'Browse files on this device…'))));
        }
        if (sets.length === 0) {
            pop.append(h('div', { class: 'pnp-popover-empty' }, 'Nothing here yet. Files you load into or export from the tools show up here.'));
        }
        [['output', 'Outputs'], ['input', 'Inputs']].forEach(([kind, title]) => {
            const group = sets.filter((set) => set.kind === kind);
            if (!group.length) return;
            pop.append(h('div', { class: 'pnp-popover-heading' }, title));
            group.forEach((set) => appendSetRow(pop, set, onPick, opts));
        });
        // The library view shows the space used and can empty the library.
        if (footer && sets.length) {
            pop.append(h('div', { class: 'pnp-popover-footer' },
                h('span', {}, `${formatBytes(await store.sizeUsed())} in this project`),
                h('button', {
                    type: 'button',
                    class: 'pnp-popover-clear',
                    onclick: async (ev) => {
                        ev.stopPropagation();
                        await store.clearBatches();
                        renderOutputList(pop, onPick, opts);
                    },
                }, 'Clear all')));
        }
    }

    function appendSetRow(pop, set, onPick, opts) {
        pop.append(h('div', { class: 'pnp-popover-row', 'data-kind': set.kind },
            h('button', {
                type: 'button',
                class: 'pnp-popover-item',
                onclick: () => { pop.hidden = true; onPick(set); },
            },
            h('strong', {}, describeSet(set)),
            h('span', {}, ` ${set.kind === 'input' ? 'loaded in' : 'from'} ${toolLabel(set.from)} · ${formatBytes(set.items.reduce((n, it) => n + it.blob.size, 0))} · ${timeAgo(set.created)}`)),
            h('button', {
                type: 'button',
                class: 'pnp-popover-remove',
                title: 'Remove from library',
                'aria-label': 'Remove from library',
                onclick: async (ev) => {
                    ev.stopPropagation();
                    await store.removeBatch(set.id);
                    renderOutputList(pop, onPick, opts);
                },
            }, '✕')));
    }

    // A button that toggles a popover listing the stored tool outputs.
    // floating: the popover is placed on the page under the button, so a
    // scrolling or clipped container (a sidebar list) can't cut it off.
    function outputMenu(container, { label, title, wrapClass, buttonClass, onPick, filter, browse, footer = false, floating = false }) {
        const wrap = h('div', { class: wrapClass });
        const pop = h('div', { class: `pnp-popover${floating ? ' pnp-popover-floating' : ''}`, hidden: true });
        const place = () => {
            const r = btn.getBoundingClientRect();
            const width = Math.max(260, r.width);
            pop.style.width = `${width}px`;
            pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
            pop.style.top = `${r.bottom + 4}px`;
        };
        const btn = h('button', {
            type: 'button',
            class: buttonClass,
            'aria-haspopup': 'true',
            onclick: async (e) => {
                e.stopPropagation();
                if (!pop.hidden) { pop.hidden = true; return; }
                await renderOutputList(pop, onPick, { filter, browse, footer });
                if (floating) place();
                pop.hidden = false;
            },
            title,
            'aria-label': typeof label === 'string' ? null : title, // icon-only buttons
        }, label);
        document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) pop.hidden = true; });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });
        if (floating) {
            window.addEventListener('resize', () => { pop.hidden = true; });
            document.addEventListener('scroll', (e) => { if (!pop.contains(e.target)) pop.hidden = true; }, true);
        }
        wrap.append(btn, pop);
        if (container) container.append(wrap);
        return wrap;
    }

    // "Pick from library": a button whose popover lists the library batches
    // file sets holding files this input accepts; picking one passes those
    // files to onFiles. browse() adds a "Browse files…" entry (for buttons
    // that replace a plain file input).
    function filePicker(container, { accept, onFiles, browse, label = 'Pick from library', title, buttonClass = 'pnp-pick-btn', floating = true }) {
        const matches = acceptMatcher(accept);
        const filter = (it) => it.blob && matches(it.name, it.blob.type || typeFromName(it.name));
        return outputMenu(container, {
            label,
            title: title || 'Use files from this project’s library',
            wrapClass: 'pnp-pick',
            buttonClass,
            floating,
            filter,
            browse,
            onPick: async (set) => {
                try {
                    const files = await itemsForTool(set.items.filter(filter), set.items);
                    await onFiles(files, set);
                    toast(`Loaded ${files.length} file(s) from ${toolLabel(set.from)}.`, 'success');
                } catch (err) {
                    toast(`Could not load the files: ${err.message}`, 'error');
                }
            },
        });
    }

    // Top-bar "Library": opens the project's library.
    function outputPreviewButton(container) {
        const wrap = h('div', { class: 'pnp-outputs' }, h('button', {
            type: 'button',
            class: 'pnp-outputs-btn',
            title: 'Files loaded into and made by the tools in this project',
            'aria-haspopup': 'dialog',
            onclick: () => openLibrary(),
        }, 'Library'));
        if (container) container.append(wrap);
        return wrap;
    }

    // ---------------------------------------------------------------- output viewer

    // Modal viewer for one stored output set: image list on the side, the
    // selected image large. ←/→ (or ↑/↓) step through, Esc closes.
    // Images (and SVGs) show as pictures, PDFs in the browser's PDF viewer;
    // anything else can still be downloaded.
    function previewOutput(set) {
        const items = set.items.filter((it) => it.blob);
        if (!items.length) { toast('This set has no files.', 'error'); return; }
        const typeOf = (it) => it.blob.type || typeFromName(it.name);
        const urls = items.map((it) => URL.createObjectURL(it.blob));
        const opener = document.activeElement;
        let index = 0;

        const big = h('img', { class: 'pnp-viewer-img', alt: '' });
        const doc = h('iframe', { class: 'pnp-viewer-doc', title: 'Document preview', hidden: true });
        const none = h('div', { class: 'pnp-viewer-none', hidden: true }, 'No preview for this file type. Use Download.');
        const caption = h('div', { class: 'pnp-viewer-caption' });
        const counter = h('span', { class: 'pnp-viewer-count' });
        const list = h('div', { class: 'pnp-viewer-list', role: 'listbox', 'aria-label': 'Images' });
        const thumbs = items.map((it, i) => {
            const b = h('button', {
                type: 'button',
                class: 'pnp-viewer-thumb',
                role: 'option',
                title: it.name,
                onclick: () => select(i),
            }, isImage(it)
                ? h('img', { src: urls[i], alt: '', loading: 'lazy' })
                : h('span', { class: 'pnp-viewer-filetype' }, (it.name.split('.').pop() || 'file').slice(0, 4).toUpperCase()),
            h('span', {}, it.name));
            list.append(b);
            return b;
        });
        const download = h('button', {
            type: 'button',
            class: 'pnp-viewer-btn',
            onclick: () => downloadBlob(items[index].blob, items[index].name),
        }, 'Download');
        const close = h('button', { type: 'button', class: 'pnp-viewer-btn', 'aria-label': 'Close', onclick: () => done() }, '✕');

        const dialog = h('div', { class: 'pnp-viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Output from ${toolLabel(set.from)}` },
            h('div', { class: 'pnp-viewer-head' },
                h('div', { class: 'pnp-viewer-title' },
                    h('strong', {}, `${describeSet({ items })} ${set.kind === 'input' ? 'loaded in' : 'from'} ${toolLabel(set.from)}`),
                    h('span', {}, ` · ${timeAgo(set.created)}`)),
                counter, download, close),
            h('div', { class: 'pnp-viewer-body' },
                list,
                h('div', { class: 'pnp-viewer-stage' }, big, doc, none, caption)));
        const backdrop = h('div', { class: 'pnp-viewer-backdrop', onclick: (e) => { if (e.target === backdrop) done(); } }, dialog);

        function select(i) {
            index = (i + items.length) % items.length;
            const it = items[index];
            const image = isImage(it), pdf = typeOf(it) === 'application/pdf';
            big.hidden = !image;
            doc.hidden = !pdf;
            none.hidden = image || pdf;
            big.onload = null;
            caption.textContent = `${it.name} · ${formatBytes(it.blob.size)}`;
            if (image) {
                big.onload = () => {
                    caption.textContent = `${it.name} · ${big.naturalWidth} × ${big.naturalHeight} px · ${formatBytes(it.blob.size)}`;
                };
                big.src = urls[index];
            } else {
                big.removeAttribute('src');
            }
            if (pdf) doc.src = urls[index];
            else doc.removeAttribute('src');
            counter.textContent = `${index + 1} / ${items.length}`;
            thumbs.forEach((t, j) => {
                t.classList.toggle('selected', j === index);
                t.setAttribute('aria-selected', String(j === index));
            });
            thumbs[index].scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }

        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); done(); }
            else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); select(index + 1); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); select(index - 1); }
        }

        function done() {
            document.removeEventListener('keydown', onKey, true);
            backdrop.remove();
            document.body.classList.remove('pnp-viewer-open');
            urls.forEach((u) => URL.revokeObjectURL(u));
            if (opener && opener.focus) opener.focus();
        }

        document.addEventListener('keydown', onKey, true);
        document.body.append(backdrop);
        document.body.classList.add('pnp-viewer-open');
        select(0);
        close.focus();
    }

    function formatBytes(n) {
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
        return `${(n / 1024 / 1024).toFixed(1)} MB`;
    }

    // ---------------------------------------------------------------- library items

    // Edits set in the library that change the image a tool gets.
    const isEdited = (meta) => !!(meta && (meta.rotate || meta.crop || meta.widthMm || meta.heightMm || meta.bleedMm));
    const isRaster = (type) => /^image\//.test(type || '') && type !== 'image/svg+xml';

    // A library item as a file for a tool: the image with the item's
    // rotation and crop, stretched to its size in mm when its proportions
    // differ, and carrying its DPI and bleed; other files as they are.
    async function itemFile(item) {
        const meta = item.meta || {};
        const type = item.blob.type || typeFromName(item.name);
        const role = meta.role || item.role || null;
        const asFile = (blob, name) => {
            const f = new File([blob], name, { type: blob.type || type });
            if (role) f.pnpRole = role;
            return f;
        };
        if (!isRaster(type) || !isEdited(meta)) return asFile(item.blob, item.name);

        const bmp = await createImageBitmap(item.blob);
        const rot = (((meta.rotate || 0) % 360) + 360) % 360;
        const turned = rot % 180 !== 0;
        const rw = turned ? bmp.height : bmp.width;
        const rh = turned ? bmp.width : bmp.height;
        const crop = meta.crop || { x: 0, y: 0, w: 1, h: 1 };
        const sx = crop.x * rw, sy = crop.y * rh;
        const sw = Math.max(1, crop.w * rw), sh = Math.max(1, crop.h * rh);

        // Size: the width (or height) sets the DPI; with both, the other
        // side is stretched to match.
        const bleed = meta.bleedMm || 0;
        let outW = Math.round(sw), outH = Math.round(sh), dpi = null;
        if (meta.widthMm) {
            dpi = (outW / (meta.widthMm + 2 * bleed)) * 25.4;
            if (meta.heightMm) outH = Math.max(1, Math.round(((meta.heightMm + 2 * bleed) / 25.4) * dpi));
        } else if (meta.heightMm) {
            dpi = (outH / (meta.heightMm + 2 * bleed)) * 25.4;
        }

        const turnedCanvas = document.createElement('canvas');
        turnedCanvas.width = rw;
        turnedCanvas.height = rh;
        const tg = turnedCanvas.getContext('2d');
        tg.translate(rw / 2, rh / 2);
        tg.rotate((rot * Math.PI) / 180);
        tg.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
        const out = document.createElement('canvas');
        out.width = outW;
        out.height = outH;
        out.getContext('2d').drawImage(turnedCanvas, sx, sy, sw, sh, 0, 0, outW, outH);
        let blob = await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image.'))), 'image/png'));
        if (dpi) blob = await setImageDpi(blob, dpi);
        if (bleed) blob = await setPngText(blob, 'PnPTools:bleed', String(bleed));
        return asFile(blob, `${baseName(item.name)}.png`);
    }

    // Files for a tool from library items: each item, then the backs chosen
    // for them (as backs), so tools pair them like fronts and backs.
    async function itemsForTool(items, all = items) {
        const files = [];
        const backs = [];
        for (const item of items) {
            files.push(await itemFile(item));
            const backId = item.meta && item.meta.back;
            const back = backId && all.find((x) => x.id === backId);
            if (back && !backs.includes(back)) backs.push(back);
        }
        for (const back of backs) {
            const f = await itemFile(back);
            f.pnpRole = 'back';
            files.push(f);
        }
        return files;
    }

    // ---------------------------------------------------------------- library window

    // The page's main drop zone ({ deliver }), which "Use in this tool" hands
    // the chosen library items to. See dropzone.
    let primaryDrop = null;

    // The project's library: batches of thumbnails to select (click toggles,
    // Shift-click selects a range), the selection's size in mm, bleed, front
    // or back and back image, an image editor (double-click), and "Use in
    // this tool". Edits are kept with the items and applied when a tool takes
    // them (itemFile).
    function openLibrary() {
        const opener = document.activeElement;
        let batches = [];
        const selected = new Set();
        const urls = new Map();
        let pickingBack = false;
        let anchor = null;

        const allItems = () => batches.flatMap((b) => b.items);
        const chosen = () => allItems().filter((it) => selected.has(it.id));
        const urlOf = (it) => {
            if (!urls.has(it.id)) urls.set(it.id, URL.createObjectURL(it.blob));
            return urls.get(it.id);
        };

        const items = h('div', { class: 'pnp-library-items' });
        const props = h('div', { class: 'pnp-library-props' });
        const count = h('span', {});
        const addInput = h('input', { type: 'file', multiple: true, hidden: true });
        addInput.addEventListener('change', async () => {
            const files = [...addInput.files];
            addInput.value = '';
            if (!files.length) return;
            await store.addBatch({ kind: 'input', from: currentTool ? currentTool.name : 'Library', items: files.map((f) => ({ name: f.name, blob: f })) });
            await reload();
        });
        const useButton = primaryDrop ? h('button', { type: 'button', class: 'pnp-viewer-btn pnp-library-use', onclick: () => use() }, 'Use in this tool') : null;
        const close = h('button', { type: 'button', class: 'pnp-viewer-btn', 'aria-label': 'Close', onclick: () => done() }, '✕');
        const dialog = h('div', { class: 'pnp-viewer pnp-library', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Library' },
            h('div', { class: 'pnp-viewer-head' },
                h('div', { class: 'pnp-viewer-title' }, h('strong', {}, 'Library'), count),
                h('button', { type: 'button', class: 'pnp-viewer-btn', onclick: () => addInput.click() }, 'Add files…'),
                addInput, useButton, close),
            h('div', { class: 'pnp-library-body' }, items, props));
        const backdrop = h('div', { class: 'pnp-viewer-backdrop', onclick: (e) => { if (e.target === backdrop) done(); } }, dialog);

        let size = 0;
        // keepProps: a typed value changed; redrawing the panel would take
        // the cursor out of the field the user moved on to.
        async function reload({ keepProps = false } = {}) {
            try {
                batches = await store.listBatches();
                size = await store.sizeUsed();
            } catch (err) { batches = []; }
            const ids = new Set(allItems().map((it) => it.id));
            [...selected].forEach((id) => { if (!ids.has(id)) selected.delete(id); });
            renderItems();
            if (!keepProps) renderProps();
        }

        function render() {
            renderItems();
            renderProps();
        }

        function renderItems() {
            const scroll = items.scrollTop;
            items.innerHTML = '';
            const n = allItems().length;
            count.textContent = ` · ${n} file${n === 1 ? '' : 's'} · ${formatBytes(size)}`;
            if (!batches.length) {
                items.append(h('div', { class: 'pnp-popover-empty' }, 'Nothing here yet. Files you load into or export from the tools show up here.'));
            }
            batches.forEach((batch) => {
                const all = batch.items.every((it) => selected.has(it.id));
                items.append(h('section', { class: 'pnp-library-batch', 'data-kind': batch.kind },
                    h('div', { class: 'pnp-library-batch-head' },
                        h('strong', {}, describeSet(batch)),
                        h('span', {}, ` ${batch.kind === 'input' ? 'loaded in' : 'from'} ${toolLabel(batch.from)} · ${timeAgo(batch.created)}`),
                        h('button', {
                            type: 'button',
                            class: 'pnp-library-link pnp-library-select',
                            'data-batch': batch.id,
                            onclick: () => {
                                const every = batch.items.every((it) => selected.has(it.id));
                                batch.items.forEach((it) => (every ? selected.delete(it.id) : selected.add(it.id)));
                                showSelection();
                            },
                        }, all ? 'Select none' : 'Select all'),
                        h('button', {
                            type: 'button',
                            class: 'pnp-library-link',
                            onclick: async () => { await store.removeBatch(batch.id); await reload(); },
                        }, 'Remove')),
                    h('div', { class: 'pnp-library-grid' }, batch.items.map(tile))));
            });
            items.scrollTop = scroll;
        }

        function tile(it) {
            const meta = it.meta || {};
            const type = it.blob.type || typeFromName(it.name);
            const on = selected.has(it.id);
            const tags = [];
            if (meta.widthMm && meta.heightMm) tags.push(`${units.format(meta.widthMm)} × ${units.format(meta.heightMm)}`);
            const role = meta.role || it.role;
            if (role) tags.push(role === 'back' ? 'Back' : 'Front');
            if (meta.back) tags.push('+ back');
            const pic = isRaster(type) || type === 'image/svg+xml'
                ? h('img', { src: urlOf(it), alt: '', loading: 'lazy', style: meta.rotate ? `transform: rotate(${meta.rotate}deg)` : null })
                : h('span', { class: 'pnp-viewer-filetype' }, (it.name.split('.').pop() || 'file').slice(0, 4).toUpperCase());
            return h('button', {
                type: 'button',
                class: `pnp-library-tile${on ? ' selected' : ''}`,
                'aria-pressed': String(on),
                title: isRaster(type) ? `${it.name} (double-click to edit)` : it.name,
                'data-id': it.id,
                onclick: (e) => click(it, e),
                ondblclick: () => { if (isRaster(type)) editImage(it); },
            },
            h('span', { class: 'pnp-library-pic' }, pic),
            h('span', { class: 'pnp-library-name' }, it.name),
            tags.length ? h('span', { class: 'pnp-library-tags' }, tags.join(' · ')) : null);
        }

        function click(it, e) {
            if (pickingBack) {
                pickingBack = false;
                change({ back: it.id }, chosen().filter((x) => x.id !== it.id));
                return;
            }
            const list = allItems();
            if (e.shiftKey && anchor) {
                const [a, b] = [list.findIndex((x) => x.id === anchor), list.findIndex((x) => x.id === it.id)].sort((x, y) => x - y);
                if (a >= 0) list.slice(a, b + 1).forEach((x) => selected.add(x.id));
            } else if (selected.has(it.id)) {
                selected.delete(it.id);
            } else {
                selected.add(it.id);
            }
            anchor = it.id;
            showSelection();
        }

        // Selection changes only restyle the tiles: replacing them would break
        // a double-click, whose second click would land on a new tile.
        function showSelection() {
            items.querySelectorAll('.pnp-library-tile').forEach((t) => {
                const on = selected.has(t.dataset.id);
                t.classList.toggle('selected', on);
                t.setAttribute('aria-pressed', String(on));
            });
            items.querySelectorAll('.pnp-library-select').forEach((b) => {
                const batch = batches.find((x) => x.id === b.dataset.batch);
                b.textContent = batch && batch.items.every((it) => selected.has(it.id)) ? 'Select none' : 'Select all';
            });
            renderProps();
        }

        // Changes run one after another: each reads and rewrites the items,
        // so two at once would lose one.
        let queue = Promise.resolve();
        function change(patch, targets = chosen(), opts = {}) {
            if (!targets.length) return queue;
            const ids = targets.map((it) => it.id);
            queue = queue.then(async () => {
                await store.updateItems(new Map(ids.map((id) => [id, patch])));
                await reload(opts);
            }).catch((err) => toast(`Could not change the files: ${err.message}`, 'error'));
            return queue;
        }

        function renderProps() {
            props.innerHTML = '';
            const sel = chosen();
            if (useButton) {
                useButton.textContent = sel.length ? `Use ${sel.length} in this tool` : 'Use in this tool';
                useButton.disabled = !sel.length;
            }
            if (!sel.length) {
                props.append(h('div', { class: 'pnp-library-hint' }, 'Select files to set their size, bleed and back.'));
                return;
            }
            const value = (key) => {
                const vals = sel.map((it) => (it.meta || {})[key]);
                return vals.every((v) => v === vals[0]) ? vals[0] : undefined;
            };
            const mixed = (key) => sel.some((it) => (it.meta || {})[key] !== (sel[0].meta || {})[key]);
            const numberField = (id, label, key) => {
                const input = h('input', { type: 'number', id, min: '0', step: '0.1', 'data-unit': 'mm', value: value(key) ?? '', placeholder: mixed(key) ? 'mixed' : '' });
                input.addEventListener('change', () => {
                    const v = parseFloat(input.value);
                    change({ [key]: v > 0 ? v : undefined }, chosen(), { keepProps: true });
                });
                return h('div', { class: 'control-group' }, h('label', { for: id }, label), input);
            };

            // Card size presets fill both sides at once.
            const preset = h('select', { id: 'pnpLibPreset' },
                h('option', { value: '' }, value('widthMm') ? 'Custom' : 'No size'),
                presets.card.map((p) => h('option', { value: p.id }, `${p.label} (${formatSize(p)})`)),
                value('widthMm') ? h('option', { value: 'none' }, 'No size') : null);
            const match = presets.card.find((p) => p.w === value('widthMm') && p.h === value('heightMm'));
            if (match) preset.value = match.id;
            preset.addEventListener('change', () => {
                if (preset.value === 'none') change({ widthMm: undefined, heightMm: undefined });
                const p = presets.card.find((x) => x.id === preset.value);
                if (p) change({ widthMm: p.w, heightMm: p.h });
            });

            const role = h('select', { id: 'pnpLibRole' },
                h('option', { value: '' }, mixed('role') ? 'Mixed' : 'Not set'),
                h('option', { value: 'front' }, 'Front'),
                h('option', { value: 'back' }, 'Back'));
            role.value = value('role') || '';
            role.addEventListener('change', () => change({ role: role.value || undefined }));

            const backId = value('back');
            const back = backId && allItems().find((x) => x.id === backId);
            const one = sel.length === 1 && isRaster(sel[0].blob.type || typeFromName(sel[0].name));

            props.append(
                h('div', { class: 'pnp-library-props-title' }, `${sel.length} selected`),
                h('div', { class: 'control-group' }, h('label', { for: 'pnpLibPreset' }, 'Size'), preset),
                h('div', { class: 'row' }, numberField('pnpLibW', 'Width (mm)', 'widthMm'), numberField('pnpLibH', 'Height (mm)', 'heightMm')),
                numberField('pnpLibBleed', 'Bleed in image (mm)', 'bleedMm'),
                h('div', { class: 'control-group' }, h('label', { for: 'pnpLibRole' }, 'Side'), role),
                h('div', { class: 'control-group' },
                    h('label', {}, 'Back'),
                    h('div', { class: 'pnp-library-back' },
                        back ? h('img', { src: urlOf(back), alt: back.name, title: back.name }) : h('span', { class: 'pnp-library-hint' }, mixed('back') ? 'Mixed' : 'None'),
                        h('button', { type: 'button', class: 'btn-secondary btn-small', onclick: () => { pickingBack = true; renderProps(); } }, pickingBack ? 'Click the back…' : 'Choose…'),
                        backId || mixed('back') ? h('button', { type: 'button', class: 'btn-secondary btn-small', onclick: () => change({ back: undefined }) }, 'None') : null)),
                h('div', { class: 'button-group' },
                    h('button', {
                        type: 'button',
                        class: 'btn-secondary',
                        onclick: () => {
                            const batch = batches.find((b) => b.items.includes(sel[0]));
                            previewOutput({ ...batch, items: sel });
                        },
                    }, 'View'),
                    h('button', { type: 'button', class: 'btn-secondary', disabled: !one, onclick: () => editImage(sel[0]) }, 'Edit image…'),
                    h('button', {
                        type: 'button',
                        class: 'btn-secondary',
                        onclick: async () => { await store.removeItems(sel.map((it) => it.id)); selected.clear(); await reload(); },
                    }, 'Remove')));
            units.scan(props);
            units.relabel(props);
        }

        function editImage(item) {
            imageEditor(item, (patch) => change(patch, [item]));
        }

        async function use() {
            const sel = chosen();
            if (!sel.length || !primaryDrop) return;
            const files = await itemsForTool(sel, allItems());
            done();
            primaryDrop.deliver(files);
        }

        // Esc closes the library only when nothing is open over it.
        function onKey(e) {
            const top = [...document.querySelectorAll('.pnp-viewer-backdrop')].pop();
            if (e.key === 'Escape' && top === backdrop) { e.preventDefault(); done(); }
        }

        function done() {
            document.removeEventListener('keydown', onKey, true);
            backdrop.remove();
            document.body.classList.remove('pnp-viewer-open');
            urls.forEach((u) => URL.revokeObjectURL(u));
            if (opener && opener.focus) opener.focus();
        }

        document.addEventListener('keydown', onKey, true);
        document.body.append(backdrop);
        document.body.classList.add('pnp-viewer-open');
        close.focus();
        reload();
        return { close: done };
    }

    // Crop and rotate one image: drag the box or its corners, turn with the
    // buttons. onDone({ rotate, crop }) with undefined for "none".
    function imageEditor(item, onDone) {
        const meta = item.meta || {};
        let rot = (((meta.rotate || 0) % 360) + 360) % 360;
        let crop = { ...(meta.crop || { x: 0, y: 0, w: 1, h: 1 }) };
        const url = URL.createObjectURL(item.blob);
        const img = new Image();
        const canvas = h('canvas', { class: 'pnp-crop-canvas' });
        const ctx = canvas.getContext('2d');
        const MIN = 0.02;

        // The same region after a quarter turn.
        const turnCrop = (c, cw) => (cw ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w } : { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w });

        function draw() {
            if (!img.naturalWidth) return;
            const turned = rot % 180 !== 0;
            const iw = turned ? img.naturalHeight : img.naturalWidth;
            const ih = turned ? img.naturalWidth : img.naturalHeight;
            const box = Math.min(560, window.innerWidth - 80);
            const k = Math.min(box / iw, box / ih);
            const vw = Math.round(iw * k), vh = Math.round(ih * k);
            canvas.width = vw;
            canvas.height = vh;
            ctx.save();
            ctx.translate(vw / 2, vh / 2);
            ctx.rotate((rot * Math.PI) / 180);
            const dw = img.naturalWidth * k, dh = img.naturalHeight * k;
            ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
            ctx.restore();
            const r = { x: crop.x * vw, y: crop.y * vh, w: crop.w * vw, h: crop.h * vh };
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.beginPath();
            ctx.rect(0, 0, vw, vh);
            ctx.rect(r.x, r.y, r.w, r.h);
            ctx.fill('evenodd');
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(r.x, r.y, r.w, r.h);
            ctx.fillStyle = '#fff';
            [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].forEach(([x, y]) => ctx.fillRect(x - 5, y - 5, 10, 10));
        }

        // Dragging: a corner resizes, inside moves.
        let drag = null;
        const at = (e) => {
            const b = canvas.getBoundingClientRect();
            return { px: (e.clientX - b.left) / b.width, py: (e.clientY - b.top) / b.height, tx: 12 / b.width, ty: 12 / b.height };
        };
        canvas.addEventListener('pointerdown', (e) => {
            const { px, py, tx, ty } = at(e);
            const corners = { nw: [crop.x, crop.y], ne: [crop.x + crop.w, crop.y], sw: [crop.x, crop.y + crop.h], se: [crop.x + crop.w, crop.y + crop.h] };
            const corner = Object.keys(corners).find((c) => Math.abs(corners[c][0] - px) < tx && Math.abs(corners[c][1] - py) < ty);
            const inside = px > crop.x && px < crop.x + crop.w && py > crop.y && py < crop.y + crop.h;
            if (!corner && !inside) return;
            drag = { corner, px, py, start: { ...crop } };
            canvas.setPointerCapture(e.pointerId);
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!drag) return;
            const { px, py } = at(e);
            const dx = px - drag.px, dy = py - drag.py;
            const s0 = drag.start;
            const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
            if (!drag.corner) {
                crop = { ...s0, x: clamp(s0.x + dx, 0, 1 - s0.w), y: clamp(s0.y + dy, 0, 1 - s0.h) };
            } else {
                let x0 = s0.x, y0 = s0.y, x1 = s0.x + s0.w, y1 = s0.y + s0.h;
                if (drag.corner.includes('w')) x0 = clamp(x0 + dx, 0, x1 - MIN);
                if (drag.corner.includes('e')) x1 = clamp(x1 + dx, x0 + MIN, 1);
                if (drag.corner.includes('n')) y0 = clamp(y0 + dy, 0, y1 - MIN);
                if (drag.corner.includes('s')) y1 = clamp(y1 + dy, y0 + MIN, 1);
                crop = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
            }
            draw();
        });
        canvas.addEventListener('pointerup', () => { drag = null; });

        const turn = (cw) => { rot = (rot + (cw ? 90 : 270)) % 360; crop = turnCrop(crop, cw); draw(); };
        const full = (c) => c.x < 0.001 && c.y < 0.001 && c.w > 0.999 && c.h > 0.999;
        const dialog = h('div', { class: 'pnp-viewer pnp-crop', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Edit image' },
            h('div', { class: 'pnp-viewer-head' },
                h('div', { class: 'pnp-viewer-title' }, h('strong', {}, item.name)),
                h('button', { type: 'button', class: 'pnp-viewer-btn', title: 'Turn left', 'aria-label': 'Turn left', onclick: () => turn(false) }, '⟲'),
                h('button', { type: 'button', class: 'pnp-viewer-btn', title: 'Turn right', 'aria-label': 'Turn right', onclick: () => turn(true) }, '⟳'),
                h('button', { type: 'button', class: 'pnp-viewer-btn', onclick: () => { rot = 0; crop = { x: 0, y: 0, w: 1, h: 1 }; draw(); } }, 'Reset'),
                h('button', { type: 'button', class: 'pnp-viewer-btn', onclick: () => finish(false) }, 'Cancel'),
                h('button', { type: 'button', class: 'pnp-viewer-btn pnp-library-use', onclick: () => finish(true) }, 'Done')),
            h('div', { class: 'pnp-crop-stage' }, canvas));
        const backdrop = h('div', { class: 'pnp-viewer-backdrop pnp-crop-backdrop' }, dialog);

        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        }
        function finish(keep) {
            document.removeEventListener('keydown', onKey, true);
            backdrop.remove();
            URL.revokeObjectURL(url);
            if (keep) onDone({ rotate: rot || undefined, crop: full(crop) ? undefined : crop });
        }
        document.addEventListener('keydown', onKey, true);
        document.body.append(backdrop);
        img.onload = draw;
        img.src = url;
    }

    // ---------------------------------------------------------------- dropzone

    // Files taken in are recorded as the tool's input (record: false to skip).
    // The zone also gets a "Pick from library" button (pick: false to skip).
    // The page's first zone for images is where the library's "Use in this
    // tool" delivers.
    function dropzone(zone, { input, onFiles, accept, record = true, pick = true }) {
        const accepts = acceptMatcher(accept);
        const matches = (f) => accepts(f.name, f.type);
        // Files from the library are in it already: they aren't recorded again.
        const deliver = (fileList, { fromLibrary = false } = {}) => {
            const files = [...fileList];
            const ok = files.filter(matches);
            if (ok.length < files.length) toast(`Skipped ${files.length - ok.length} unsupported file(s).`, 'error');
            if (!ok.length) return;
            if (record && !fromLibrary) recordFiles({ kind: 'input', items: ok.map((f) => ({ name: f.name, blob: f })) });
            onFiles(ok);
        };
        if (!primaryDrop && accepts('card.png', 'image/png')) primaryDrop = { deliver: (files) => deliver(files, { fromLibrary: true }) };
        zone.addEventListener('click', (e) => {
            if (e.target === input || e.target.closest('button, a')) return;
            input.click();
        });
        zone.setAttribute('tabindex', '0');
        zone.setAttribute('role', 'button');
        zone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
        });
        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('change', () => { deliver(input.files); input.value = ''; });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
            deliver(e.dataTransfer.files);
        });
        if (pick) {
            const picker = filePicker(zone, { accept, onFiles: (files) => deliver(files, { fromLibrary: true }) });
            // Clicks in the picker must not open the zone's file chooser.
            picker.addEventListener('click', (e) => e.stopPropagation());
            picker.addEventListener('keydown', (e) => e.stopPropagation());
        }
    }

    // ---------------------------------------------------------------- project

    // A project is the library plus every tool page's work and settings. The
    // open project lives in the browser (see store) and each page saves its
    // work into it as the user goes, so reloading or switching tools loses
    // nothing. A .pnp file is the whole project: a zip of manifest.json
    // ({ app, version: 2, name, settings: { key: values }, pages, library,
    // blobs }) and files/<hash>. Older single-tool files (version 1: one
    // tool's settings, state and files) still open on their tool's page.
    //
    // Where the browser has the File System Access API (Chrome, Edge), Save
    // writes back to the file the project was opened from or last saved to,
    // and Save as asks for a new file. Elsewhere both download a copy.
    const project = (() => {
        const VERSION = 2;
        const TYPES = [{ description: 'PnPTools project', accept: { 'application/zip': ['.pnp'] } }];
        let tool = null;       // this page's tool id
        let pageKey = null;    // this page's work in the project, e.g. "PnPCut/sheet.html"
        let hooks = null;
        let handle = null;     // FileSystemFileHandle saved to / opened from
        let nameInput = null;  // the top bar's project name field
        let ready = Promise.resolve();
        let lastSig = null;    // the work as last saved into the project
        let active = 0;        // time of the user's last action on the page

        const canPick = () => typeof window.showSaveFilePicker === 'function';
        const name = () => (nameInput ? nameInput.value.trim() : '');
        function setName(value) {
            if (nameInput) nameInput.value = value || '';
        }
        const defaultName = () => `PnPTools-${new Date().toISOString().slice(0, 10)}`;
        const fileName = () => `${safeFileName(name().replace(/\.pnp$/i, '') || defaultName())}.pnp`;

        function register(h_) { hooks = h_; }

        // Fields saved only with the work (data-persist="project").
        function workFields() {
            const all = settings.collect('project');
            Object.keys(settings.collect('local')).forEach((k) => delete all[k]);
            return all;
        }

        async function snapshot() {
            const files = hooks.getFiles ? (await hooks.getFiles()) || [] : [];
            const state = hooks.getState ? await hooks.getState() : null;
            return { fields: workFields(), state: state === undefined ? null : state, files };
        }

        async function signature(snap) {
            const files = [];
            for (const f of snap.files) files.push([f.name, f.blob ? await store.hashOf(f.blob) : null, f.role || null]);
            return JSON.stringify([snap.fields, snap.state, files]);
        }

        // Save this page's work into the project, if it changed.
        let saving = null;
        async function autosave() {
            if (!hooks || !window.indexedDB) return;
            if (saving) return saving;
            saving = (async () => {
                try {
                    const snap = await snapshot();
                    const sig = await signature(snap);
                    if (sig === lastSig) return;
                    await store.savePage(pageKey, snap);
                    lastSig = sig;
                } catch (err) {
                    console.warn('Could not keep the work in this browser:', err);
                }
            })();
            try { await saving; } finally { saving = null; }
        }

        // While the user is active (and a little after, for work that
        // finishes later, like loading files), check every couple of seconds.
        function watch() {
            const mark = () => { active = Date.now(); };
            ['input', 'change', 'drop', 'click', 'keydown', 'pointerup'].forEach((type) => document.addEventListener(type, mark, true));
            setInterval(() => { if (Date.now() - active < 30000) autosave(); }, 2000);
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autosave(); });
            window.addEventListener('pagehide', () => { autosave(); });
        }

        // Put a page's saved work ({ fields, state, files }) on this page.
        async function applyPage(page, manifest = {}) {
            settings.apply(page.fields);
            if (hooks.setFiles) await hooks.setFiles(page.files, manifest);
            if (hooks.setState) await hooks.setState(page.state, manifest);
        }

        // This page's work back from the project, when the page opens.
        async function restore() {
            if (!hooks || !window.indexedDB) return;
            try {
                const info = await store.getInfo();
                if (!name()) setName(info.name); // unless the user is already typing one
                const page = await store.loadPage(pageKey);
                if (page) await applyPage(page);
                // What's on the page now is what's saved: opening isn't a change.
                lastSig = await signature(await snapshot());
            } catch (err) {
                console.warn('Could not restore the work:', err);
            }
        }

        // Changed since the project was last saved to (or opened from) a file.
        async function unsaved() {
            try {
                const info = await store.getInfo();
                return info.changed > (info.saved || 0) && !(await store.isEmpty());
            } catch (err) {
                return false;
            }
        }

        function allSettings() {
            const out = {};
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k.startsWith('pnp:settings:')) out[k.slice('pnp:settings:'.length)] = storageGet(k);
                }
            } catch (err) { /* storage blocked */ }
            return out;
        }

        async function build() {
            settings.flush();
            await autosave();
            await store.collect();
            const { batches, pages, blobs } = await store.dump();
            const manifest = {
                app: 'PnPTools',
                version: VERSION,
                name: name() || null,
                saved: new Date().toISOString(),
                settings: allSettings(),
                pages,
                library: batches,
                blobs: [...blobs.keys()],
            };
            const entries = [{ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) }];
            blobs.forEach((blob, hash) => entries.push({ name: `files/${hash}`, data: blob }));
            return zip.create(entries);
        }

        // as: always ask where to save. Renaming the project also asks, so
        // Save never overwrites the file under its old name.
        async function save({ as = false } = {}) {
            if (!hooks) return;
            const typed = name();
            if (!canPick()) {
                downloadBlob(await build(), fileName(), { record: false });
            } else {
                let target = handle;
                if (as || !target || target.name !== fileName()) {
                    // Ask first: the picker needs the click's user activation.
                    try {
                        target = await window.showSaveFilePicker({ suggestedName: fileName(), types: TYPES });
                    } catch (err) {
                        if (err.name === 'AbortError') return;
                        throw err;
                    }
                }
                const blob = await build();
                const writable = await target.createWritable();
                await writable.write(blob);
                await writable.close();
                handle = target;
                // The name follows the file, unless the user renamed it meanwhile.
                if (name() === typed) setName(baseName(target.name));
            }
            await store.setInfo({ name: name(), saved: Date.now() });
            hooks.markSaved && hooks.markSaved();
            toast(canPick() ? `Saved ${handle.name}.` : 'Project saved.', 'success');
        }

        async function load(file, fileHandle = null) {
            const entries = await zip.read(file);
            const raw = entries.get('manifest.json');
            if (!raw) throw new Error('This is not a PnPTools project file.');
            const manifest = JSON.parse(new TextDecoder().decode(raw));
            if (manifest.app !== 'PnPTools') throw new Error('This is not a PnPTools project file.');
            const projectName = fileHandle || !manifest.name ? baseName(file.name) : manifest.name;
            const now = Date.now();
            if ((manifest.version || 1) >= 2) {
                // Blobs are stored typeless; their refs know the type.
                const types = new Map();
                [...(manifest.library || []).flatMap((b) => b.items || []), ...(manifest.pages || []).flatMap((pg) => pg.files || [])]
                    .forEach((r) => types.set(r.hash, r.type));
                const blobs = new Map();
                (manifest.blobs || []).forEach((hash) => {
                    const data = entries.get(`files/${hash}`);
                    if (data) blobs.set(hash, new Blob([data], { type: types.get(hash) || '' }));
                });
                await store.load({ batches: manifest.library || [], pages: manifest.pages || [], info: { name: projectName, changed: now, saved: now }, blobs });
                Object.entries(manifest.settings || {}).forEach(([key, values]) => storageSet(`pnp:settings:${key}`, values));
                settings.apply(settings.saved());
                const page = await store.loadPage(pageKey);
                await applyPage(page || { fields: {}, state: null, files: [] }, manifest);
            } else {
                // A single-tool project from before: it becomes this page's work.
                if (manifest.tool !== tool) {
                    const other = TOOLS.find((t) => t.id === manifest.tool);
                    throw new Error(`This project belongs to ${other ? toolLabel(other.name) : manifest.tool}. Open it there.`);
                }
                const files = (manifest.files || []).map((f) => {
                    const one = new File([entries.get(f.path)], f.name, { type: f.type || '' });
                    if (f.role) one.pnpRole = f.role;
                    return one;
                });
                await store.clearProject();
                settings.apply(manifest.settings);
                await applyPage({ fields: manifest.settings || {}, state: manifest.state, files }, manifest);
                const items = files.map((f) => ({ name: f.name, blob: f, role: f.pnpRole || null }));
                if (items.length) await store.addBatch({ kind: 'input', from: currentTool ? currentTool.name : tool, items });
                await store.savePage(pageKey, await snapshot());
                await store.setInfo({ name: projectName, changed: now, saved: now });
            }
            lastSig = await signature(await snapshot());
            handle = fileHandle;
            // The file's own name wins, so Save goes back to that file.
            setName(projectName);
            toast('Project loaded.', 'success');
        }

        async function openPicker() {
            const tryLoad = (file, fileHandle) => load(file, fileHandle).catch((err) => {
                console.error(err);
                toast(err.message, 'error');
            });
            if (typeof window.showOpenFilePicker === 'function') {
                let picked;
                try {
                    [picked] = await window.showOpenFilePicker({ types: TYPES });
                } catch (err) {
                    if (err.name !== 'AbortError') toast(err.message, 'error');
                    return;
                }
                await tryLoad(await picked.getFile(), picked);
                return;
            }
            const input = h('input', { type: 'file', accept: '.pnp,application/zip' });
            input.addEventListener('change', () => {
                if (input.files[0]) tryLoad(input.files[0], null);
            });
            input.click();
        }

        // Start over: an empty project (library and every tool's work).
        // Settings stay (Reset restores those).
        async function newProject() {
            if (settings.flush()) await store.touch(); // a change from the last moments counts too
            await autosave();
            if (await unsaved() && !confirm('Discard this project and start a new one?')) return;
            try { await store.clearProject(); } catch (err) { /* IndexedDB unavailable */ }
            guardBypass = true;
            location.href = location.pathname;
        }

        function setup(toolId, key) {
            tool = toolId;
            pageKey = key;
            if (!hooks) return;
            watch();
            ready = restore();
            // Settings are part of the project too.
            settings.onStore(() => { store.touch().catch(() => {}); });
            if (nameInput) nameInput.addEventListener('change', () => store.setInfo({ name: name() }).catch(() => {}));
        }

        const report = (err) => { console.error(err); toast(`Could not save project: ${err.message}`, 'error'); };

        return {
            register,
            newProject,
            save: () => save().catch(report),
            saveAs: () => save({ as: true }).catch(report),
            load,
            openPicker,
            name,
            setName,
            autosave,
            ready: () => ready,
            _nameInput: (el) => { nameInput = el; },
            _setup: setup,
            _setTool: (t) => { tool = t; },
            get registered() { return !!hooks; },
        };
    })();

    // ---------------------------------------------------------------- top bar

    // The project's name: the saved file's name, and the base name of
    // outputs made from several files.
    function projectNameField() {
        const input = h('input', {
            type: 'text',
            class: 'pnp-project-name',
            placeholder: 'Untitled project',
            'aria-label': 'Project name',
            title: 'Project name: Save names the .pnp file after it, and outputs made from several files use it',
            spellcheck: 'false',
            'data-persist': 'false',
        });
        project._nameInput(input);
        return input;
    }

    // Ctrl/⌘ S saves the project, with Shift it saves to a new file.
    function saveShortcut() {
        document.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return;
            e.preventDefault();
            if (e.shiftKey) project.saveAs();
            else project.save();
        });
    }

    function topBar(toolId, { projectButtons }) {
        const header = document.querySelector('header');
        if (!header) return;
        const nav = h('nav', { class: 'pnp-topbar', 'aria-label': 'PnPTools' },
            h('a', { class: 'pnp-home', href: hubUrl(), title: 'All PnPTools' }, '◂ PnPTools'),
            h('div', { class: 'pnp-tools' },
                TOOLS.map((t) => h('a', {
                    class: `pnp-tool${t.id === toolId ? ' current' : ''}`,
                    href: toolUrl(t),
                    'aria-current': t.id === toolId ? 'page' : null,
                    title: t.id,
                }, h('span', { 'aria-hidden': 'true' }, t.icon), ` ${t.name}`))),
            h('div', { class: 'pnp-actions' },
                outputPreviewButton(),
                theme.toggleButton(),
                h('div', { class: 'pnp-units', role: 'group', 'aria-label': 'Units' },
                    ['mm', 'in'].map((u) => h('button', {
                        type: 'button',
                        'data-unit': u,
                        'aria-pressed': String(units.current === u),
                        onclick: () => units.set(u),
                    }, u))),
                projectButtons ? [
                    projectNameField(),
                    h('button', { type: 'button', class: 'pnp-action', onclick: () => project.newProject(), title: 'Start a new, empty project (settings are kept)' }, 'New'),
                    h('button', { type: 'button', class: 'pnp-action', onclick: () => project.openPicker(), title: 'Open a saved .pnp project' }, 'Open'),
                    h('button', { type: 'button', class: 'pnp-action', onclick: () => project.save(), title: 'Save the project (library, every tool’s work and settings) as a .pnp file (Ctrl/⌘ S)' }, 'Save'),
                    h('button', { type: 'button', class: 'pnp-action', onclick: () => project.saveAs(), title: 'Save the project to a new file (Ctrl/⌘ Shift S)' }, 'Save as'),
                ] : null,
                h('button', {
                    type: 'button',
                    class: 'pnp-action',
                    title: 'Restore this tool’s default settings',
                    onclick: () => {
                        if (confirm('Reset all settings in this tool to their defaults?')) settings.reset();
                    },
                }, 'Reset')));
        header.prepend(nav);
        // The heading shows the description on one line, cut to fit.
        const subtitle = header.querySelector(':scope > .subtitle');
        if (subtitle && !subtitle.title) subtitle.title = subtitle.textContent.trim();
    }

    // ---------------------------------------------------------------- offline

    // Registers the site's service worker (sw.js at the root, serving every
    // page) and asks it to cache everything this page loaded plus any `extra`
    // files the tool only loads later (workers, lazily fetched libraries).
    function enableOffline(extra = []) {
        if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
        window.addEventListener('load', async () => {
            try {
                // Tools used to have a worker each, in their own folder; a leftover
                // one would keep serving that tool from an old cache.
                for (const old of await navigator.serviceWorker.getRegistrations()) {
                    if (old.scope !== ROOT) await old.unregister();
                }
                await navigator.serviceWorker.register(new URL('sw.js', ROOT).href, { scope: ROOT });
                const reg = await navigator.serviceWorker.ready;
                const loaded = performance.getEntriesByType('resource').map((e) => e.name);
                const urls = [location.href.split('#')[0], ...loaded, ...extra.map((u) => new URL(u, location.href).href)]
                    .filter((u) => /^https?:/.test(u));
                (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: 'precache', urls: [...new Set(urls)] });
            } catch (err) {
                console.warn('Offline support unavailable:', err);
            }
        });
    }

    // Files from before the library (the Inputs & outputs sets) move into
    // the library once.
    async function migrateOldFiles() {
        if (!window.indexedDB || storageGet('pnp:library-migrated', false)) return;
        storageSet('pnp:library-migrated', true);
        try {
            const old = (await handoff.list()).filter((set) => set.kind === 'input' || set.kind === 'output').reverse();
            for (const set of old) await store.addBatch({ kind: set.kind, from: set.from, items: set.items });
            if (old.length) await handoff.clear();
        } catch (err) { /* nothing to move */ }
    }

    // ---------------------------------------------------------------- init

    /**
     * PnP.init({
     *   tool: 'PnPBleed',                     // TOOLS id
     *   settingsKey?: 'PnPCut-grid',          // localStorage scope (defaults to tool)
     *   settingsRoot?: Element,               // defaults to .sidebar
     *   project?: { getFiles, setFiles, getState, setState, fileName },
     *   hasUnsavedWork?: () => boolean,
     *   offlineFiles?: [url],                 // files loaded later that must work offline
     * })
     */
    function init(opts) {
        const toolId = opts.tool;
        currentTool = TOOLS.find((t) => t.id === toolId) || null;
        project._setTool(toolId);
        // Each page's work is kept under its path: "PnPCut/sheet.html".
        const pageKey = `${toolId}/${location.pathname.split('/').pop() || 'index.html'}`;
        units.scan();
        units.relabel();
        topBar(toolId, { projectButtons: !!opts.project });
        if (opts.project) {
            project.register(opts.project);
            saveShortcut();
        }
        const rootEl = opts.settingsRoot === undefined ? document.querySelector('.sidebar') : opts.settingsRoot;
        settings.init(opts.settingsKey || toolId, rootEl);
        project._setup(toolId, pageKey);
        migrateOldFiles();
        if (opts.hasUnsavedWork) guard(opts.hasUnsavedWork);
        enableOffline(opts.offlineFiles || []);
    }

    window.PnP = {
        TOOLS,
        MM_PER_IN,
        init,
        units,
        theme,
        settings,
        presets,
        bindPreset,
        machinePresets,
        bindMachinePreset,
        cutSvg,
        svgSize,
        cutPath,
        inDeadMargin,
        handoff,
        sendMenu,
        filePicker,
        outputPreviewButton,
        previewOutput,
        library: { open: openLibrary, itemFile, itemsForTool },
        itemsToFiles,
        recordFiles,
        dropzone,
        project,
        guard,
        allowLeave() { guardBypass = true; },
        enableOffline,
        toast,
        zip,
        downloadBlob,
        baseName,
        safeFileName,
        outputBase,
        outputName,
        readImageDpi,
        setPngDpi,
        setImageDpi,
        setPngText,
        readPngText,
        canvasToBlob: (canvas, type = 'image/png', quality) => new Promise((resolve, reject) => {
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image.'))), type, quality);
        }),
    };
})();
