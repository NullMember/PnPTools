// PnP Tuck Box: settings, artwork slots, live preview, exports and the shared
// PnPTools hooks.

const $ = (id) => document.getElementById(id);

const state = {
    images: [], // image library: { id, file, img }
    nextImageId: 1,
    art: {},    // slot -> { imageId, rot, mode }
    pages: [],
};

const ART_MODES = { fill: 'Fill', fit: 'Fit', stretch: 'Stretch', extend: 'Extend' };
const IMAGE_DRAG_TYPE = 'application/x-pnp-image';

const STYLE_HINTS = {
    tuck: 'The usual card box, with tuck-in lid and bottom.',
    tuckFixed: 'A tuck box with a glued bottom. Only the lid opens.',
    twoPiece: 'A tray and a lid that slides over it.',
    sleeve: 'An open band that slides over the deck.',
    tuckLock: 'Fold the back’s flap inside, then push the side’s hook tabs into the slits by the corner: straight side first, then straighten to lock.',
    tuckFixedLock: 'Close the side as for the tab lock. At the bottom, fold in the dust flaps, the back’s flap, then the bottom, and lock its hook tabs into the slits.',
    twoPieceLock: 'Fold each wall up and its inner half down inside, corner flaps in first. Push every tab into its slit in the floor.',
    sleeveLock: 'Fold the back’s flap inside, then push the side’s hook tabs into the slits by the corner: straight side first, then straighten to lock.',
};

// The chosen style, with an old saved name read as its new one (settings
// apply fires change events before normalizeStyle runs).
function styleId() {
    const v = $('boxStyle').value;
    return STYLE_ALIASES[v] || v;
}

// A style saved under an old name (settings, projects) switches to its new
// one; saving the settings again keeps the new name.
function normalizeStyle() {
    const select = $('boxStyle');
    const renamed = STYLE_ALIASES[select.value];
    if (!renamed) return;
    select.value = renamed;
    select.dispatchEvent(new Event('change', { bubbles: true }));
}

function num(id, fallback = 0) {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? v : fallback;
}

function readConfig() {
    return {
        style: styleId(),
        cardW: num('cardW', 63),
        cardH: num('cardH', 88),
        thickness: Math.max(0.5, num('cardCount', 1) * num('cardThickness', 0.32)),
        clearance: num('clearance', 1),
        paper: sheetThickness(),
        lidDepth: Math.min(100, Math.max(20, num('lidDepth', 100))),
        sleeveHeight: Math.min(100, Math.max(15, num('sleeveHeight', 60))),
        tabLip: Math.min(10, Math.max(1, num('tabLip', 3))),
    };
}

function readOptions() {
    return {
        bgColor: $('bgColor').value,
        bleed: Math.max(0, num('bleed', 3)),
        margin: Math.max(0, num('margin', 5)),
        printCut: $('printCut').checked,
        printFold: $('printFold').checked,
        lineColor: $('lineColor').value,
        dpi: 300,
    };
}

function paperSize() {
    return { w: num('paperW', 210), h: num('paperH', 297) };
}

// ---- Artwork --------------------------------------------------------------------------------

// Images live in a library; each panel slot points at one of them, with its
// own rotation and fit mode, so the same image can serve several panels and
// the choice can be changed any time.

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`${file.name} is not a readable image`));
        img.src = url;
    });
}

const imageById = (id) => state.images.find((im) => im.id === id);

// Add files to the library; returns the images that loaded.
async function addImages(files) {
    const added = [];
    for (const file of files.filter((f) => f.type.startsWith('image/'))) {
        try {
            const entry = { id: state.nextImageId++, file, img: await loadImage(file) };
            state.images.push(entry);
            added.push(entry);
        } catch (err) {
            PnP.toast(err.message, 'error');
        }
    }
    return added;
}

// New images go to the current style's empty panels in order; any extras
// stay in the library for picking later.
async function importImages(files) {
    const added = await addImages(files);
    const empty = BOX_STYLES[styleId()].slots.filter((s) => !state.art[s]);
    added.slice(0, empty.length).forEach((im, i) => { state.art[empty[i]] = { imageId: im.id, rot: 0, mode: 'fill' }; });
    renderSlots();
    schedule();
}

// Point a slot at a library image, keeping its rotation and mode (a new
// image starts uncropped and centred).
function assignImage(slot, imageId) {
    const prev = state.art[slot];
    state.art[slot] = { imageId, rot: prev ? prev.rot : 0, mode: prev ? prev.mode : 'fill' };
    renderSlots();
    schedule();
}

async function assignFile(slot, file) {
    const [im] = await addImages([file]);
    if (im) assignImage(slot, im.id);
}

// Thumbnails reuse an image's blob URL, so it is only released once the
// image leaves the library.
function releaseImage(im) {
    if (im.img.src.startsWith('blob:')) URL.revokeObjectURL(im.img.src);
}

function removeImage(id) {
    state.images.filter((im) => im.id === id).forEach(releaseImage);
    state.images = state.images.filter((im) => im.id !== id);
    Object.keys(state.art).forEach((slot) => { if (state.art[slot].imageId === id) delete state.art[slot]; });
    renderSlots();
    schedule();
}

// slot -> { img, rot, mode }, the form the renderer draws.
function resolvedArt() {
    const out = {};
    Object.entries(state.art).forEach(([slot, a]) => {
        const im = imageById(a.imageId);
        if (im) out[slot] = { img: im.img, rot: a.rot, mode: a.mode, crop: a.crop, zoom: a.zoom, dx: a.dx, dy: a.dy };
    });
    return out;
}

function pickFiles(onFiles, multiple = false) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.addEventListener('change', () => input.files.length && onFiles([...input.files]));
    input.click();
}

// A drop carries either a library image (dragged from the sidebar) or files.
function readDrop(e) {
    const id = parseInt(e.dataTransfer.getData(IMAGE_DRAG_TYPE), 10);
    if (imageById(id)) return { imageId: id };
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    return file ? { file } : null;
}

function dropOnSlot(slot, drop) {
    if (drop.imageId) assignImage(slot, drop.imageId);
    else assignFile(slot, drop.file);
}

function acceptDrops(el, onDrop) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dragover'); });
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
    el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('dragover');
        const drop = readDrop(e);
        if (drop) onDrop(drop, e);
    });
}

function thumbImg(im, rot = 0) {
    const img = document.createElement('img');
    img.src = im.img.src;
    img.alt = '';
    img.style.transform = `rotate(${rot}deg)`;
    return img;
}

function renderLibrary() {
    const lib = $('artLibrary');
    lib.innerHTML = '';
    lib.hidden = state.images.length === 0;
    state.images.forEach((im) => {
        const used = Object.values(state.art).some((a) => a.imageId === im.id);
        const tile = document.createElement('div');
        tile.className = 'art-tile' + (used ? ' used' : '');
        tile.title = `${im.file.name} — drag onto a panel`;
        tile.draggable = true;
        tile.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData(IMAGE_DRAG_TYPE, String(im.id));
            e.dataTransfer.effectAllowed = 'copy';
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = '✕';
        remove.title = 'Remove from library';
        remove.setAttribute('aria-label', `Remove ${im.file.name}`);
        remove.addEventListener('click', () => removeImage(im.id));
        tile.append(thumbImg(im), remove);
        lib.append(tile);
    });
}

// Popover under a slot row listing the library, plus Browse… and None.
function openPicker(row, slot) {
    closePicker();
    const pop = document.createElement('div');
    pop.className = 'art-picker';
    const current = state.art[slot]?.imageId;
    state.images.forEach((im) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'art-tile' + (im.id === current ? ' selected' : '');
        b.title = im.file.name;
        b.append(thumbImg(im));
        b.addEventListener('click', () => { closePicker(); assignImage(slot, im.id); });
        pop.append(b);
    });
    const action = (text, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'art-picker-action';
        b.textContent = text;
        b.addEventListener('click', () => { closePicker(); onClick(); });
        pop.append(b);
    };
    action('Browse…', () => pickFiles(([file]) => assignFile(slot, file)));
    if (current) action('None', () => { delete state.art[slot]; renderSlots(); schedule(); });
    row.append(pop);
}

function closePicker() {
    document.querySelectorAll('.art-picker').forEach((p) => p.remove());
}
document.addEventListener('click', (e) => {
    if (!e.target.closest('.art-picker, .slot-thumb')) closePicker();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });

function renderSlots() {
    closePicker();
    renderLibrary();
    const list = $('slotList');
    list.innerHTML = '';
    BOX_STYLES[styleId()].slots.forEach((slot) => {
        const a = state.art[slot];
        const im = a && imageById(a.imageId);
        const row = document.createElement('div');
        row.className = 'slot';
        acceptDrops(row, (drop) => dropOnSlot(slot, drop));

        const thumb = document.createElement('button');
        thumb.type = 'button';
        thumb.className = 'slot-thumb' + (im ? '' : ' empty');
        thumb.title = 'Choose image';
        thumb.setAttribute('aria-label', `Choose image: ${SLOT_LABELS[slot]}`);
        if (im) thumb.append(thumbImg(im, a.rot));
        else thumb.textContent = '+';
        thumb.addEventListener('click', () => {
            if (row.querySelector('.art-picker')) closePicker();
            else if (state.images.length) openPicker(row, slot);
            else pickFiles(([file]) => assignFile(slot, file));
        });

        const info = document.createElement('div');
        info.className = 'slot-info';
        const name = document.createElement('span');
        name.className = 'slot-name';
        name.textContent = SLOT_LABELS[slot];
        info.append(name);
        if (im) {
            const mode = document.createElement('select');
            mode.className = 'slot-mode';
            mode.dataset.persist = 'false';
            mode.setAttribute('aria-label', `Fit mode: ${SLOT_LABELS[slot]}`);
            Object.entries(ART_MODES).forEach(([value, label]) => mode.append(new Option(label, value, false, value === a.mode)));
            mode.addEventListener('change', () => { a.mode = mode.value; schedule(); });
            info.append(mode);
        }

        const actions = document.createElement('div');
        actions.className = 'slot-actions';
        if (im) {
            const button = (text, label, onClick) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = text;
                b.title = label;
                b.setAttribute('aria-label', `${label}: ${SLOT_LABELS[slot]}`);
                b.addEventListener('click', onClick);
                actions.append(b);
            };
            button('✎', 'Edit (crop, zoom, move)', () => editArt(slot));
            button('⟳', 'Rotate 90°', () => { a.rot = (a.rot + 90) % 360; a.dx = 0; a.dy = 0; renderSlots(); schedule(); });
            button('✕', 'Clear panel', () => { delete state.art[slot]; renderSlots(); schedule(); });
        }
        row.append(thumb, info, actions);
        list.append(row);
    });
}

// ---- Artwork editor ----------------------------------------------------------------------

// The first panel showing this slot in the current layout (all panels of a
// slot have the same size).
function panelForSlot(slot) {
    for (const page of state.pages) {
        for (const item of page.items) {
            const panel = item.piece.panels.find((p) => p.slot === slot);
            if (panel) return panel;
        }
    }
    return null;
}

function editArt(slot) {
    const a = state.art[slot];
    const im = a && imageById(a.imageId);
    const panel = panelForSlot(slot);
    if (!im || !panel) return;
    ArtEditor.open({
        title: `Edit artwork: ${SLOT_LABELS[slot]}`,
        a,
        img: im.img,
        panel: { w: panel.box.w, h: panel.box.h, artRot: panel.artRot || 0 },
        bleed: readOptions().bleed,
        onChange: schedule,
        onClose: () => renderSlots(),
    });
}

// ---- Preview -----------------------------------------------------------------------------

let timer = null;
function schedule() {
    clearTimeout(timer);
    timer = setTimeout(render, 60);
}

function setStatus(message, type = 'info') {
    const el = $('status');
    el.hidden = !message;
    el.textContent = message || '';
    el.className = `status ${type}`;
}

function updateStyleUI() {
    const style = styleId();
    $('styleHint').textContent = STYLE_HINTS[style];
    $('lidDepthGroup').hidden = BOX_STYLES[style].option !== 'lidDepth';
    $('sleeveHeightGroup').hidden = BOX_STYLES[style].option !== 'sleeveHeight';
    $('tabLipGroup').hidden = !BOX_STYLES[style].tabs;
    if (BOX_STYLES[style].tabs) {
        $('tabLipHint').textContent = `The barb sits ${PnP.units.format(lockLip(readConfig()))} from the side.`;
    }
}

function render() {
    updateStyleUI();
    const cfg = readConfig();
    const opts = readOptions();
    const paper = paperSize();
    let pieces;
    try {
        pieces = buildBox(cfg.style, cfg);
    } catch (err) {
        console.error(err);
        setStatus(`Could not build the box: ${err.message}`, 'error');
        return;
    }
    state.pages = layoutPages(pieces, paper, opts.margin, opts.bleed);

    const d = boxDims(cfg);
    const fmt = (mm) => PnP.units.format(mm);
    const outer = cfg.style === 'twoPiece'
        ? `Base inside ${fmt(d.W + 2 * d.t)} × ${fmt(d.H + 2 * d.t)} × ${fmt(d.D + d.t)} deep`
        : `Inside ${fmt(d.W)} × ${fmt(d.H)} × ${fmt(d.D)}`;
    $('summary').innerHTML = '';
    [
        ['Deck', `${num('cardCount')} cards, ${fmt(cfg.thickness)} thick`],
        ['Box', outer],
        ['Pieces', pieces.map((p) => `${p.name} ${fmt(p.width)} × ${fmt(p.height)}`).join(' · ')],
        ['Pages', String(state.pages.length)],
    ].forEach(([label, value]) => {
        const item = document.createElement('div');
        item.className = 'summary-item';
        item.innerHTML = '<span class="summary-label"></span><span class="summary-value"></span>';
        item.children[0].textContent = label;
        item.children[1].textContent = value;
        $('summary').append(item);
    });

    const tooBig = state.pages.some((p) => p.items.some((i) => !i.fits));
    setStatus(tooBig ? 'The box doesn’t fit this paper. Choose a larger paper or a smaller margin.' : '', 'error');

    const grid = $('sheetGrid');
    grid.innerHTML = '';
    const maxWidth = Math.min(520, Math.max(240, grid.clientWidth / Math.min(2, state.pages.length) - 24));
    state.pages.forEach((page, i) => {
        const fig = document.createElement('figure');
        fig.className = 'sheet';
        const canvas = document.createElement('canvas');
        const k = drawPagePreview(canvas, page, { paper, art: resolvedArt(), opts, maxWidth, showLabels: $('showLabels').checked });
        attachDrop(canvas, page, k);
        canvas.addEventListener('dblclick', (e) => {
            const rect = canvas.getBoundingClientRect();
            const slot = slotAt(page, (e.clientX - rect.left) / k, (e.clientY - rect.top) / k);
            if (slot && state.art[slot]) editArt(slot);
        });
        const cap = document.createElement('figcaption');
        cap.textContent = `Page ${i + 1} · ${page.items.map((it) => it.piece.name).join(' + ')}`;
        fig.append(canvas, cap);
        grid.append(fig);
    });
}

// Dropping an image (a file, or one dragged from the library) on a panel
// assigns it to that panel's artwork slot.
function attachDrop(canvas, page, k) {
    acceptDrops(canvas, (drop, e) => {
        const rect = canvas.getBoundingClientRect();
        const slot = slotAt(page, (e.clientX - rect.left) / k, (e.clientY - rect.top) / k);
        if (slot) dropOnSlot(slot, drop);
        else PnP.toast('Drop the image onto a printable panel (front, back, sides, top…).', 'error');
    });
}

// ---- Paper: thickness, weight and lamination -------------------------------------------

// GSM to thickness is an estimate: cardstock is roughly 1 g/cm³, so 300 GSM
// is about 0.3 mm (coated card is a little denser, uncoated a little less).
const GSM_PER_MM = 1000;

// What the box folds: the paper plus any laminating film.
function sheetThickness() {
    const film = $('laminated').checked ? num('laminateThickness', 0.08) * num('laminateSides', 2) : 0;
    return num('paperThickness', 0.3) + film;
}

function syncGsm() {
    $('paperGsm').value = Math.round(num('paperThickness', 0.3) * GSM_PER_MM);
}

function updatePaperUI() {
    $('laminateGroup').hidden = !$('laminated').checked;
    $('paperHint').textContent = $('laminated').checked
        ? `Laminated sheet: ${PnP.units.format(sheetThickness())} thick.`
        : '';
}

// Each field follows the other; typing GSM mustn't round-trip into itself.
let typingGsm = false;
$('paperGsm').addEventListener('input', () => {
    const gsm = num('paperGsm');
    if (!(gsm > 0)) return;
    typingGsm = true;
    $('paperThickness').value = +(gsm / GSM_PER_MM).toFixed(3);
    $('paperThickness').dispatchEvent(new Event('input', { bubbles: true }));
    $('paperThickness').dispatchEvent(new Event('change', { bubbles: true }));
    typingGsm = false;
});
['input', 'change'].forEach((type) => $('paperThickness').addEventListener(type, () => { if (!typingGsm) syncGsm(); }));
['laminated', 'laminateThickness', 'laminateSides', 'paperThickness'].forEach((id) => {
    $(id).addEventListener('input', updatePaperUI);
    $(id).addEventListener('change', updatePaperUI);
});
PnP.units.onChange(updatePaperUI);

// ---- Card thickness: weight, lamination, sleeves -------------------------------------------

// What a sleeve adds to a card (both plastic layers).
const SLEEVE_MM = { none: 0, penny: 0.13, premium: 0.28 };

// Film and sleeves on one card; the rest of its thickness is the card stock.
function cardExtras() {
    const film = $('cardLaminated').checked ? num('cardLaminateThickness', 0.08) * num('cardLaminateSides', 2) : 0;
    return film + (SLEEVE_MM[$('cardSleeves').value] || 0);
}

// The card weight that gives the per-card thickness (when it's positive).
function syncCardGsm() {
    const stock = num('cardThickness', 0.32) - cardExtras();
    $('cardGsm').value = stock > 0 ? Math.round(stock * GSM_PER_MM) : '';
}

// Per card = card weight + film + sleeves; typing the per-card (or whole
// deck) thickness works the card weight back out instead.
let derivingCard = false;
function updateCardThickness() {
    const gsm = num('cardGsm');
    if (!(gsm > 0)) return;
    derivingCard = true;
    $('cardThickness').value = +(gsm / GSM_PER_MM + cardExtras()).toFixed(4);
    $('cardThickness').dispatchEvent(new Event('input', { bubbles: true }));
    $('cardThickness').dispatchEvent(new Event('change', { bubbles: true }));
    derivingCard = false;
}

function updateCardUI() {
    $('cardLaminateGroup').hidden = !$('cardLaminated').checked;
}

$('cardGsm').addEventListener('input', updateCardThickness);
['cardSleeves', 'cardLaminated', 'cardLaminateThickness', 'cardLaminateSides'].forEach((id) => {
    $(id).addEventListener('input', updateCardThickness);
    $(id).addEventListener('change', () => { updateCardUI(); updateCardThickness(); });
});
['input', 'change'].forEach((type) => $('cardThickness').addEventListener(type, () => { if (!derivingCard) syncCardGsm(); }));

// ---- Deck thickness ------------------------------------------------------------------------

// Whole-deck thickness is cards × thickness per card. It's derived (not
// saved); typing it sets the per-card value instead, since measuring the
// whole deck is far more precise than measuring one card.
let editingDeck = false;

function syncDeckThickness() {
    if (editingDeck) return; // don't rewrite the field the user is typing in
    $('deckThickness').value = +(num('cardCount', 1) * num('cardThickness', 0.32)).toFixed(2);
}

$('deckThickness').addEventListener('input', () => {
    const total = num('deckThickness');
    const count = num('cardCount');
    if (!(total > 0) || !(count > 0)) return;
    editingDeck = true;
    $('cardThickness').value = +(total / count).toFixed(4);
    $('cardThickness').dispatchEvent(new Event('input', { bubbles: true }));
    editingDeck = false;
});
['cardCount', 'cardThickness'].forEach((id) => $(id).addEventListener('input', syncDeckThickness));

// ---- Export --------------------------------------------------------------------------------

// Named after the project when it has a name, otherwise after the style.
const outputBase = () => PnP.outputName([], 'box', `${styleId()}-box`);

$('downloadPdf').addEventListener('click', async () => {
    const btn = $('downloadPdf');
    btn.disabled = true;
    try {
        const bytes = await buildPdf(state.pages, paperSize(), resolvedArt(), readOptions(), (m) => setStatus(m, 'processing'));
        await PnP.exportPdf(new Blob([bytes], { type: 'application/pdf' }), $('exportFormat').value, `${outputBase()}.pdf`);
        setStatus('');
    } catch (err) {
        console.error(err);
        setStatus(`Could not build the PDF: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        render();
    }
});

$('downloadSvg').addEventListener('click', async () => {
    const paper = paperSize();
    const machineMargin = num('machineMargin');
    if (state.pages.some((page) => linesInDeadMargin(page, paper, machineMargin))) {
        PnP.toast('Some lines are in the mat’s dead margin and won’t be cut. Widen the printer margin.', 'error');
    }
    const svgs = state.pages.map((page) => buildSvg(page, paper, machineMargin));
    const base = `${outputBase()}-cut`;
    if (svgs.length === 1) {
        PnP.downloadBlob(new Blob([svgs[0]], { type: 'image/svg+xml' }), `${base}.svg`);
    } else {
        const zip = await PnP.zip.create(svgs.map((svg, i) => ({ name: `${base}-page-${i + 1}.svg`, data: svg })));
        PnP.downloadBlob(zip, `${base}.zip`);
    }
});

// ---- Wiring ----------------------------------------------------------------------------------

document.querySelector('.sidebar').addEventListener('input', schedule);
document.querySelector('.sidebar').addEventListener('change', schedule);
$('boxStyle').addEventListener('change', renderSlots);
$('showLabels').addEventListener('change', render);
window.addEventListener('resize', schedule);
PnP.units.onChange(schedule);

PnP.bindPreset($('cardPreset'), $('cardW'), $('cardH'), 'card');
PnP.bindPreset($('paperPreset'), $('paperW'), $('paperH'), 'paper');
PnP.bindMachinePreset($('machinePreset'), $('machineMargin'));
PnP.settings.onApply(() => { normalizeStyle(); syncCardGsm(); updateCardUI(); syncDeckThickness(); syncGsm(); updatePaperUI(); renderSlots(); });

// Images from other tools fill the empty slots of the current style in order.
PnP.dropzone($('artDrop'), {
    input: $('artInput'),
    accept: ['image/png', 'image/jpeg', 'image/webp'],
    onFiles: importImages,
});

// Project files hold the library in order; slots refer to images by index.
let projectFiles = [];
PnP.init({
    tool: 'PnPTuckBox',
    project: {
        getFiles: () => state.images.map((im) => ({ name: im.file.name, blob: im.file })),
        getState: () => ({
            art: Object.fromEntries(Object.entries(state.art).map(([slot, a]) => [slot, {
                image: state.images.findIndex((im) => im.id === a.imageId), rot: a.rot, mode: a.mode,
                crop: a.crop || null, zoom: a.zoom || 1, dx: a.dx || 0, dy: a.dy || 0,
            }])),
        }),
        setFiles: (files) => { projectFiles = files; },
        setState: async (saved) => {
            state.images.forEach(releaseImage);
            state.images = [];
            state.art = {};
            const images = [];
            for (const f of projectFiles) images.push((await addImages([f]))[0]);
            if (saved && saved.art) {
                Object.entries(saved.art).forEach(([slot, a]) => {
                    const im = images[a.image];
                    if (im) {
                        state.art[slot] = {
                            imageId: im.id, rot: a.rot || 0, mode: ART_MODES[a.mode] ? a.mode : 'fill',
                            crop: a.crop || null, zoom: a.zoom || 1, dx: a.dx || 0, dy: a.dy || 0,
                        };
                    }
                });
            } else {
                // Older projects: one file per slot, named by its role.
                const rotations = (saved && saved.rotations) || {};
                projectFiles.forEach((f, i) => {
                    if (f.pnpRole && images[i]) state.art[f.pnpRole] = { imageId: images[i].id, rot: rotations[f.pnpRole] || 0, mode: 'fill' };
                });
            }
            renderSlots();
            schedule();
        },
    },
    hasUnsavedWork: () => state.images.length > 0,
});

PnP.handoff.receive((items) => importImages(PnP.itemsToFiles(items)));

syncCardGsm();
updateCardUI();
syncDeckThickness();
syncGsm();
updatePaperUI();
renderSlots();
render();
