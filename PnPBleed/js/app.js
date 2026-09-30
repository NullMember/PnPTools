// State, DOM wiring and UI event handling for the Card Bleed Generator.
// The actual pixel processing lives in bleed.js / sides.js / edge.js.

// Store uploaded images and processed results
const state = {
    images: [], // { file, canvas, thumb, processed } — processed is the cached card with bleed
    selectedIndex: 0,
};

const elements = {
    imageInput: document.getElementById('imageInput'),
    cardWidthInput: document.getElementById('cardWidthInput'),
    cardHeightInput: document.getElementById('cardHeightInput'),
    bleedInput: document.getElementById('bleedInput'),
    bleedMode: document.getElementById('bleedMode'),
    bleedColor: document.getElementById('bleedColor'),
    showTrimLine: document.getElementById('showTrimLine'),
    detectBorderBtn: document.getElementById('detectBorderBtn'),
    removeWhiteCornersInput: document.getElementById('removeWhiteCornersInput'),
    cornerSizeInput: document.getElementById('cornerSizeInput'),
    removeLeftSideInput: document.getElementById('removeLeftSideInput'),
    leftSideWidthInput: document.getElementById('leftSideWidthInput'),
    removeRightSideInput: document.getElementById('removeRightSideInput'),
    rightSideWidthInput: document.getElementById('rightSideWidthInput'),
    removeTopSideInput: document.getElementById('removeTopSideInput'),
    topSideHeightInput: document.getElementById('topSideHeightInput'),
    removeBottomSideInput: document.getElementById('removeBottomSideInput'),
    bottomSideHeightInput: document.getElementById('bottomSideHeightInput'),
    downloadBtn: document.getElementById('downloadBtn'),
    downloadAllBtn: document.getElementById('downloadAllBtn'),
    status: document.getElementById('status'),
    thumbnailsContainer: document.getElementById('thumbnailsContainer'),
    originalContainer: document.getElementById('originalContainer'),
    processedContainer: document.getElementById('processedContainer'),
    infoGrid: document.getElementById('infoGrid')
};

const DEFAULT_DPI = 300;

// Add card images after the ones already loaded. Files that can't be read
// are reported and skipped; the cards already there are kept.
async function loadFiles(files) {
    files = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;

    updateStatus('Loading images...', 'info');
    const firstNew = state.images.length;
    const failed = [];
    for (const file of files) {
        const canvas = await imageToCanvas(file);
        if (canvas) canvas.dpi = await PnP.readImageDpi(file); // null when the file doesn't say
        if (canvas) canvas.notes = await PnP.readSizeNotes(file); // its size in mm, if it records one
        if (canvas) state.images.push({ file, canvas, thumb: thumbnailOf(canvas), processed: null });
        else failed.push(file.name);
    }

    const added = state.images.length - firstNew;
    if (added) state.selectedIndex = firstNew;
    cardsChanged();
    if (failed.length) {
        updateStatus(`Could not read ${failed.join(', ')}${added ? ` · loaded ${added} other image(s)` : ''}.`, 'error');
    } else {
        updateStatus(`Loaded ${added} image(s)`, 'success');
    }
}

function removeCard(index) {
    state.images.splice(index, 1);
    if (state.selectedIndex >= index && state.selectedIndex > 0) state.selectedIndex--;
    cardsChanged();
    updateStatus(state.images.length ? `${state.images.length} card(s) left.` : 'All cards removed.', 'info');
}

// After cards are added or removed: thumbnails, previews and buttons.
function cardsChanged() {
    const any = state.images.length > 0;
    state.selectedIndex = Math.min(state.selectedIndex, Math.max(0, state.images.length - 1));
    elements.downloadBtn.disabled = !any;
    elements.downloadAllBtn.disabled = !any;
    elements.detectBorderBtn.disabled = !any;
    sendMenu.setEnabled(any);
    renderThumbnails();
    if (any) {
        updatePreviews();
    } else {
        elements.originalContainer.innerHTML = '';
        elements.processedContainer.innerHTML = '';
        elements.infoGrid.style.display = 'none';
    }
}

// Convert image file to canvas
function imageToCanvas(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);
            URL.revokeObjectURL(url);
            resolve(canvas);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        img.src = url;
    });
}

// Pixels per mm of an image: from the size the file records (set in the
// library, or by CardCrop tool), else the entered card (trim) size. Shapes
// without a recorded size use the DPI their file records, when it does.
function pxPerMmFor(canvas) {
    const n = canvas.notes || {};
    if (n.widthMm && n.heightMm) {
        const b = n.bleedMm || 0; // an image that already has bleed
        return (canvas.width / (n.widthMm + 2 * b) + canvas.height / (n.heightMm + 2 * b)) / 2;
    }
    if (elements.bleedMode.value === 'shape' && canvas.dpi) return canvas.dpi / 25.4;
    const cardWidthMm = parseFloat(elements.cardWidthInput.value) || 63;
    const cardHeightMm = parseFloat(elements.cardHeightInput.value) || 88;
    return mmToPixels(1, cardWidthMm, cardHeightMm, canvas.width, canvas.height);
}

// Build (or reuse) the bled version of card i
// The bleed in an image's pixels (whole pixels, as it is drawn)
function bleedPxFor(canvas) {
    return Math.round((parseFloat(elements.bleedInput.value) || 0) * pxPerMmFor(canvas));
}

function processCard(i) {
    const img = state.images[i];
    if (img.processed) return img.processed;
    const pxPerMm = pxPerMmFor(img.canvas);
    const processed = addBleedToCard(img.canvas, bleedPxFor(img.canvas), pxPerMm);
    img.processed = processed;
    return processed;
}

// Processed cards are always PNG, whatever the source format was:
// "Ace.jpg" -> "Ace_bleed.png"
function pngName(name) {
    return `${PnP.baseName(name)}_bleed.png`;
}

// Render thumbnail previews
function renderThumbnails() {
    elements.thumbnailsContainer.innerHTML = '';

    if (state.images.length === 0) {
        elements.thumbnailsContainer.innerHTML = `
            <div class="empty-state" style="width: 100%; justify-content: center;">
                <div class="empty-state-icon">📁</div>
                <div>No images uploaded yet</div>
            </div>
        `;
        return;
    }

    state.images.forEach((img, index) => {
        const thumbnail = document.createElement('div');
        thumbnail.className = 'thumbnail' + (index === state.selectedIndex ? ' active' : '');
        thumbnail.title = img.file.name;
        thumbnail.addEventListener('click', () => selectCard(index));
        const image = document.createElement('img');
        image.src = img.thumb;
        image.alt = img.file.name;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'thumbnail-remove';
        remove.title = 'Remove this card';
        remove.setAttribute('aria-label', `Remove ${img.file.name}`);
        remove.textContent = '✕';
        remove.addEventListener('click', (e) => {
            e.stopPropagation();
            removeCard(index);
        });
        thumbnail.append(image, remove);
        elements.thumbnailsContainer.appendChild(thumbnail);
    });
}

// A small preview of a card, made once when it's loaded.
function thumbnailOf(source) {
    const size = 100;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const scale = Math.min(size / source.width, size / source.height);
    const w = source.width * scale;
    const h = source.height * scale;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL();
}

// Select a card and update preview
function selectCard(index) {
    state.selectedIndex = index;
    renderThumbnails();
    updatePreviews();
}

// Update both original and processed previews
async function updatePreviews() {
    const img = state.images[state.selectedIndex];
    if (!img) return;

    updateOriginalPreview();
    updateProcessedPreview();
    updateInfoGrid();
}

// Show original image preview
function updateOriginalPreview() {
    const img = state.images[state.selectedIndex];
    if (!img) return;

    elements.originalContainer.innerHTML = '';

    const canvas = document.createElement('canvas');
    const maxWidth = elements.originalContainer.offsetWidth - 24;
    const maxHeight = elements.originalContainer.offsetHeight - 24;

    const scale = Math.min(maxWidth / img.canvas.width, maxHeight / img.canvas.height);
    canvas.width = img.canvas.width * scale;
    canvas.height = img.canvas.height * scale;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(img.canvas, 0, 0, canvas.width, canvas.height);

    canvas.className = 'comparison-canvas';
    elements.originalContainer.appendChild(canvas);
}

// Process and show processed preview
async function updateProcessedPreview() {
    const img = state.images[state.selectedIndex];
    if (!img) return;

    try {
        const processedCanvas = processCard(state.selectedIndex);

        elements.processedContainer.innerHTML = '';

        const canvas = document.createElement('canvas');
        const maxWidth = elements.processedContainer.offsetWidth - 24;
        const maxHeight = elements.processedContainer.offsetHeight - 24;

        const scale = Math.min(maxWidth / processedCanvas.width, maxHeight / processedCanvas.height);
        canvas.width = processedCanvas.width * scale;
        canvas.height = processedCanvas.height * scale;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(processedCanvas, 0, 0, canvas.width, canvas.height);

        // Where the card will be cut: the original image's edges
        // (A shape's cut line is its outline, which the preview already shows.)
        if (elements.showTrimLine.checked && elements.bleedMode.value !== 'shape') {
            const bleedPx = (processedCanvas.width - img.canvas.width) / 2;
            ctx.save();
            ctx.setLineDash([6, 4]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#ff2d55';
            ctx.strokeRect(bleedPx * scale, bleedPx * scale, img.canvas.width * scale, img.canvas.height * scale);
            ctx.restore();
        }

        canvas.className = 'comparison-canvas';
        elements.processedContainer.appendChild(canvas);

        elements.downloadBtn.disabled = false;
    } catch (error) {
        updateStatus(`Error: ${error.message}`, 'error');
    }
}

// Update info grid
function updateInfoGrid() {
    const img = state.images[state.selectedIndex];
    if (!img) return;

    const cardWidthMm = parseFloat(elements.cardWidthInput.value) || 63;
    const cardHeightMm = parseFloat(elements.cardHeightInput.value) || 88;
    const bleedMm = parseFloat(elements.bleedInput.value) || 0;
    const bleedPx = mmToPixels(bleedMm, cardWidthMm, cardHeightMm, img.canvas.width, img.canvas.height);

    document.getElementById('originalSize').textContent = `${img.canvas.width} × ${img.canvas.height}`;
    document.getElementById('bleedSize').textContent = `${PnP.units.format(bleedMm)} (${Math.round(bleedPx)}px)`;
    document.getElementById('originalPixels').textContent = `${img.canvas.width} × ${img.canvas.height}`;
    document.getElementById('bleedPixels').textContent =
        `${img.canvas.width + 2*Math.round(bleedPx)} × ${img.canvas.height + 2*Math.round(bleedPx)}`;

    elements.infoGrid.style.display = 'grid';
}

// PDF, PNG or JPEG (the Export panel's format).
const $format = () => document.getElementById('exportFormat').value;

// Card i with bleed as a PNG, stamped with its DPI (from the card size) and
// the bleed added ("PnPTools:bleed", mm), so Layout finds the card inside it.
async function cardBlob(i) {
    const blob = await PnP.canvasToBlob(processCard(i));
    const pxPerMm = pxPerMmFor(state.images[i].canvas);
    const bleedMm = Math.round(bleedPxFor(state.images[i].canvas) / pxPerMm * 1000) / 1000;
    const stamped = await PnP.setImageDpi(blob, pxPerMm * 25.4);
    const src = state.images[i].canvas;
    const sized = await PnP.setSizeNote(stamped, src.width / pxPerMm, src.height / pxPerMm);
    return PnP.setPngText(sized, 'PnPTools:bleed', String(bleedMm));
}

// Download current processed card
elements.downloadBtn.addEventListener('click', async () => {
    const img = state.images[state.selectedIndex];
    if (!img) {
        updateStatus('No processed card to download', 'error');
        return;
    }
    await PnP.exportImages([{ name: pngName(img.file.name), blob: await cardBlob(state.selectedIndex) }], $format(), pngName(img.file.name));
    updateStatus('Downloaded.', 'success');
});

// Download all processed cards. Cards are encoded one at a time and only the
// one on screen stays in memory.
elements.downloadAllBtn.addEventListener('click', async () => {
    if (!state.images.length) return;
    elements.downloadAllBtn.disabled = true;
    try {
        const entries = [];
        for (let i = 0; i < state.images.length; i++) {
            updateStatus(`Processing card ${i + 1} of ${state.images.length}...`, 'info');
            await new Promise((r) => setTimeout(r, 0)); // let the status paint
            entries.push({ name: pngName(state.images[i].file.name), blob: await cardBlob(i) });
            if (i !== state.selectedIndex) state.images[i].processed = null;
        }
        await PnP.exportImages(entries, $format(), PnP.outputName(state.images.map((img) => img.file), 'bleed.zip', 'cards-with-bleed.zip'), { alwaysZip: true });

        elements.downloadAllBtn.disabled = false;
        updateStatus(`Downloaded ${state.images.length} card(s).`, 'success');
    } catch (error) {
        updateStatus(`Error creating ZIP: ${error.message}`, 'error');
        elements.downloadAllBtn.disabled = false;
    }
});

// Update status message
function updateStatus(message, type = 'info') {
    elements.status.textContent = message;
    elements.status.className = `status ${type}`;
}

// Any setting change invalidates every processed card. Typing updates the
// preview after a short pause; the enable checkboxes toggle their inputs.
let reprocessTimer = null;
function reprocess() {
    state.images.forEach(img => img.processed = null);
    clearTimeout(reprocessTimer);
    reprocessTimer = setTimeout(() => {
        updateInfoGrid();
        updateProcessedPreview();
    }, 150);
}

[
    [elements.removeWhiteCornersInput, elements.cornerSizeInput],
    [elements.removeLeftSideInput, elements.leftSideWidthInput],
    [elements.removeRightSideInput, elements.rightSideWidthInput],
    [elements.removeTopSideInput, elements.topSideHeightInput],
    [elements.removeBottomSideInput, elements.bottomSideHeightInput],
].forEach(([checkbox, input]) => {
    checkbox.addEventListener('change', () => {
        input.disabled = !checkbox.checked;
        reprocess();
    });
    input.addEventListener('input', reprocess);
});

[elements.bleedInput, elements.cardWidthInput, elements.cardHeightInput, elements.bleedColor].forEach((input) => {
    input.addEventListener('input', reprocess);
});

const BLEED_MODE_HINTS = {
    extend: 'Best for flat borders and frames.',
    mirror: 'Best for full-bleed artwork and photos.',
    solid: 'One colour, e.g. for a black border.',
    shape: 'For tokens and shapes on a transparent background.',
};

function updateBleedModeUI() {
    const mode = elements.bleedMode.value;
    document.getElementById('bleedColorGroup').hidden = mode !== 'solid';
    document.getElementById('bleedModeHint').textContent = BLEED_MODE_HINTS[mode];
}

elements.bleedMode.addEventListener('change', () => {
    updateBleedModeUI();
    reprocess();
});
elements.showTrimLine.addEventListener('change', () => updateProcessedPreview());

// Measure plain white (or transparent) margins on the selected card and
// turn them into edge-removal settings.
elements.detectBorderBtn.addEventListener('click', () => {
    const img = state.images[state.selectedIndex];
    if (!img) return;
    const { width: w, height: h } = img.canvas;
    const data = img.canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const isBlank = (x, y) => {
        const i = (y * w + x) * 4;
        return data[i + 3] < 32 || (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230);
    };
    // A row/column is border when nearly all of its pixels are blank.
    const lineBlank = (horizontal, index) => {
        const n = horizontal ? w : h;
        let blank = 0;
        for (let k = 0; k < n; k++) if (horizontal ? isBlank(k, index) : isBlank(index, k)) blank++;
        return blank / n > 0.97;
    };
    const measure = (horizontal, from, step, limit) => {
        let count = 0;
        for (let i = from; count < limit && lineBlank(horizontal, i); i += step) count++;
        return count;
    };
    const px = {
        top: measure(true, 0, 1, h * 0.2),
        bottom: measure(true, h - 1, -1, h * 0.2),
        left: measure(false, 0, 1, w * 0.2),
        right: measure(false, w - 1, -1, w * 0.2),
    };
    const pxPerMm = pxPerMmFor(img.canvas);
    const sides = [
        ['top', elements.removeTopSideInput, elements.topSideHeightInput],
        ['bottom', elements.removeBottomSideInput, elements.bottomSideHeightInput],
        ['left', elements.removeLeftSideInput, elements.leftSideWidthInput],
        ['right', elements.removeRightSideInput, elements.rightSideWidthInput],
    ];
    let found = 0;
    sides.forEach(([side, checkbox, input]) => {
        const mm = Math.round((px[side] / pxPerMm) * 10) / 10;
        checkbox.checked = mm > 0;
        input.disabled = !checkbox.checked;
        input.value = mm;
        if (mm > 0) found++;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    updateStatus(found ? `White border found: top ${px.top}px, bottom ${px.bottom}px, left ${px.left}px, right ${px.right}px.` : 'No white border found on this card.', found ? 'success' : 'info');
});

PnP.units.onChange(() => updateInfoGrid());

// Handle window resize
window.addEventListener('resize', () => {
    updateOriginalPreview();
    updateProcessedPreview();
});

// ---- Shared PnPTools wiring --------------------------------------------------

PnP.dropzone(document.getElementById('dropZone'), {
    input: elements.imageInput,
    accept: ['image/*'],
    onFiles: loadFiles,
});


async function processedItems() {
    const items = [];
    for (let i = 0; i < state.images.length; i++) {
        items.push({ name: pngName(state.images[i].file.name), blob: await cardBlob(i), role: state.images[i].file.pnpRole });
    }
    return items;
}

const sendMenu = PnP.sendMenu(document.getElementById('sendSlot'), {
    from: 'Bleed',
    targets: ['PnPLayout', 'PnPBooklet', 'PnPTuckBox'],
    getItems: processedItems,
});
sendMenu.setEnabled(false);

PnP.bindPreset(document.getElementById('cardPreset'), elements.cardWidthInput, elements.cardHeightInput, 'card');
PnP.settings.onApply(updateBleedModeUI);
updateBleedModeUI();

PnP.init({
    tool: 'PnPBleed',
    project: {
        getFiles: () => state.images.map((img) => ({ name: img.file.name, blob: img.file, role: img.file.pnpRole })),
        // Opening a project replaces the cards.
        setFiles: (files) => {
            state.images = [];
            state.selectedIndex = 0;
            return loadFiles(files);
        },
    },
    hasUnsavedWork: () => state.images.length > 0,
});

PnP.handoff.receive((items) => loadFiles(PnP.itemsToFiles(items)));
