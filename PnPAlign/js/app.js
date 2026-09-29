(() => {
  const state = {
    cards: [], // {id, name, img, analyzed, autoColorTransform, autoAngle, colorStats, maskReliable}
    referenceId: null,
    selectedId: null,
    nextId: 1,

    colorEnabled: false,
    autoColorEnabled: true,
    manualColor: { brightness: 0, contrast: 0, saturation: 0, rGain: 1, gGain: 1, bGain: 1 },

    rotationEnabled: false,
    autoAngleEnabled: true,
    manualRotationDeg: 0,
    perCardRotationDeg: {},

    autoScaleEnabled: true,
    autoPositionEnabled: true,

    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    emptyPixelMode: 'crop', // 'crop' trims the margins away; 'fill' extends interior edge pixels into them instead
  };

  const el = (id) => document.getElementById(id);
  const gallery = el('gallery');
  const cardCountEl = el('cardCount');
  const previewNameEl = el('previewName');
  const referenceCanvas = el('referenceCanvas');
  const beforeCanvas = el('beforeCanvas');
  const afterCanvas = el('afterCanvas');
  const guideCanvas = el('guideCanvas');
  const guideRow = el('guideRow');
  const exportStatus = el('exportStatus');

  const PREVIEW_MAX_DIM = 520;
  const THUMB_MAX_DIM = 150;

  function getReference() {
    return state.cards.find((c) => c.id === state.referenceId) || null;
  }
  function getSelected() {
    return state.cards.find((c) => c.id === state.selectedId) || null;
  }

  function ensureAnalyzed(card) {
    if (card.analyzed) return;
    const result = Analyze.analyzeCard(card.img);
    card.autoAngle = result.angle;
    card.cardSize = result.cardSize;
    card.colorStats = result.colorStats;
    card.maskReliable = result.maskReliable;
    card.analyzed = true;
  }

  // ---------- Progress for long batch steps ----------

  const progressEl = el('progress');
  function showProgress(label, done, total) {
    progressEl.hidden = false;
    progressEl.querySelector('.progress-label').textContent = `${label} ${done} / ${total}`;
    progressEl.querySelector('.progress-bar').style.width = `${total ? (done / total) * 100 : 0}%`;
  }
  function hideProgress() {
    progressEl.hidden = true;
  }
  const nextFrame = () => new Promise((r) => setTimeout(r, 0));

  // Analyse every card, yielding between cards so the page stays responsive.
  async function analyzeAll() {
    const todo = state.cards.filter((c) => !c.analyzed);
    for (let i = 0; i < todo.length; i++) {
      showProgress('Analyzing cards', i, todo.length);
      await nextFrame();
      ensureAnalyzed(todo[i]);
    }
    hideProgress();
  }

  // Runs one auto step with its buttons disabled and a progress bar shown.
  let autoBusy = false;
  async function runAuto(step) {
    if (autoBusy) return;
    autoBusy = true;
    const ids = ['autoColorBtn', 'autoRotateBtn', 'autoScaleBtn', 'autoPositionBtn'];
    ids.forEach((id) => (el(id).disabled = true));
    try {
      await analyzeAll();
      await step();
    } finally {
      hideProgress();
      autoBusy = false;
      updateButtonsEnabled();
    }
  }

  // Scale each card so its printed content matches the reference's physical size —
  // otherwise cards scanned at a slightly different zoom/DPI stay a different size
  // than everyone else even after rotation and crop line their edges up.
  function computeAutoScales() {
    const ref = getReference();
    if (!ref || !ref.cardSize) {
      state.cards.forEach((c) => (c.autoScale = 1));
      return;
    }
    state.cards.forEach((card) => {
      if (card.id === ref.id || !card.cardSize) {
        card.autoScale = 1;
        return;
      }
      const scaleLong = ref.cardSize.long / card.cardSize.long;
      const scaleShort = ref.cardSize.short / card.cardSize.short;
      card.autoScale = Math.max(0.8, Math.min(1.25, (scaleLong + scaleShort) / 2));
    });
  }

  const OFFSET_CORR_MAX_DIM = 300; // downscale target for position-alignment search (speed; shift is scaled back up to full res)

  function canvasGray(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    const gray = new Float64Array(w * h);
    for (let i = 0, n = w * h; i < n; i++) {
      const o = i * 4;
      gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }
    return { gray, w, h };
  }

  // Per-card pixel shift to line content up with the reference. Must run after rotation/scale.
  function computeAutoOffsets() {
    const ref = getReference();
    if (!ref) {
      state.cards.forEach((c) => (c.autoOffset = { dx: 0, dy: 0 }));
      return;
    }
    const baseOptions = { ...currentOptions(), colorEnabled: false, autoPositionEnabled: false, crop: null };

    const refCanvas = Render.renderCard(ref, baseOptions, OFFSET_CORR_MAX_DIM);
    const { gray: refGray, w: refW, h: refH } = canvasGray(refCanvas);
    ref.autoOffset = { dx: 0, dy: 0 };

    state.cards.forEach((card) => {
      if (card.id === ref.id) return;
      computeOffsetFor(card, baseOptions, refGray, refW, refH);
    });
  }

  // Same as computeAutoOffsets, but yields between cards and shows progress.
  async function computeAutoOffsetsAsync() {
    const ref = getReference();
    if (!ref) return computeAutoOffsets();
    const baseOptions = { ...currentOptions(), colorEnabled: false, autoPositionEnabled: false, crop: null };
    const refCanvas = Render.renderCard(ref, baseOptions, OFFSET_CORR_MAX_DIM);
    const { gray: refGray, w: refW, h: refH } = canvasGray(refCanvas);
    ref.autoOffset = { dx: 0, dy: 0 };
    const others = state.cards.filter((c) => c.id !== ref.id);
    for (let i = 0; i < others.length; i++) {
      showProgress('Matching positions', i, others.length);
      await nextFrame();
      computeOffsetFor(others[i], baseOptions, refGray, refW, refH);
    }
  }

  function computeOffsetFor(card, baseOptions, refGray, refW, refH) {
    const cardCanvas = Render.renderCard(card, baseOptions, OFFSET_CORR_MAX_DIM);
    const cardPreviewScale = previewScaleFor(card, baseOptions, OFFSET_CORR_MAX_DIM);
    const { gray: cardGray, w: cardW, h: cardH } = canvasGray(cardCanvas);
    const { dx, dy } = Offset.computeOffset(refGray, refW, refH, cardGray, cardW, cardH);
    // dx/dy come back in this low-res render's pixel space — convert to the card's own
    // full-resolution (post-scale) pixel space so render.js can rescale it consistently
    // for any output size, the same way autoAngle/autoScale already are.
    card.autoOffset = { dx: dx / cardPreviewScale, dy: dy / cardPreviewScale };
  }


  function currentOptions() {
    return {
      colorEnabled: state.colorEnabled,
      autoColorEnabled: state.autoColorEnabled,
      manualColor: state.manualColor,
      rotationEnabled: state.rotationEnabled,
      autoAngleEnabled: state.autoAngleEnabled,
      manualRotationDeg: state.manualRotationDeg,
      perCardRotationDeg: state.perCardRotationDeg,
      autoScaleEnabled: state.autoScaleEnabled,
      autoPositionEnabled: state.autoPositionEnabled,
      crop: state.crop,
      emptyPixelMode: state.emptyPixelMode,
    };
  }

  // ---------- File loading ----------

  // Adds cards in file order; resolves once every image has loaded.
  function loadFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    const loads = files.map((file) => new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = async () => resolve({ file, img, dpi: await PnP.readImageDpi(file) });
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    }));
    return Promise.all(loads).then((results) => {
      results.filter(Boolean).forEach(({ file, img, dpi }) => {
        const card = {
          id: state.nextId++,
          name: file.name,
          file, // kept for project saving
          role: file.pnpRole, // front/back from a hand-off, passed on when sending
          img,
          dpi, // from the file, or null
          analyzed: false,
        };
        state.cards.push(card);
        if (state.referenceId === null) state.referenceId = card.id;
        if (state.selectedId === null) state.selectedId = card.id;
      });
      renderGallery();
      updateButtonsEnabled();
      updatePreview();
    });
  }

  PnP.dropzone(el('dropzone'), { input: el('fileInput'), onFiles: loadFiles });

  // ---------- Gallery ----------

  function renderGallery() {
    gallery.innerHTML = '';
    cardCountEl.textContent = state.cards.length ? `(${state.cards.length})` : '';
    state.cards.forEach((card) => {
      const div = document.createElement('div');
      div.className = 'card-thumb';
      if (card.id === state.selectedId) div.classList.add('selected');
      if (card.id === state.referenceId) div.classList.add('reference');

      const star = document.createElement('div');
      star.className = 'ref-star';
      star.textContent = '★';
      star.title = 'Set as reference card';
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        state.referenceId = card.id;
        renderGallery();
        recomputeAutoColorIfNeeded();
        if (state.autoScaleEnabled || state.autoPositionEnabled) {
          state.cards.forEach((c) => ensureAnalyzed(c));
          if (state.autoScaleEnabled) computeAutoScales();
          if (state.autoPositionEnabled) computeAutoOffsets();
        }
        refreshAll();
      });

      const remove = document.createElement('div');
      remove.className = 'remove-x';
      remove.textContent = '×';
      remove.title = 'Remove card';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeCard(card.id);
      });

      const img = document.createElement('img');
      img.src = card.img.src;
      img.alt = card.name;

      const nameEl = document.createElement('div');
      nameEl.className = 'thumb-name';
      nameEl.textContent = card.name;
      nameEl.title = card.name;

      div.appendChild(star);
      div.appendChild(remove);
      div.appendChild(img);
      div.appendChild(nameEl);
      div.addEventListener('click', () => {
        state.selectedId = card.id;
        renderGallery();
        updatePreview();
      });
      gallery.appendChild(div);
    });
  }

  // The gallery reuses a card's blob URL for its thumbnail, so it is only
  // released once the card is gone.
  function releaseCard(card) {
    if (card.img.src.startsWith('blob:')) URL.revokeObjectURL(card.img.src);
  }

  function removeCard(id) {
    state.cards.filter((c) => c.id === id).forEach(releaseCard);
    state.cards = state.cards.filter((c) => c.id !== id);
    delete state.perCardRotationDeg[id];
    if (state.referenceId === id) state.referenceId = state.cards[0]?.id ?? null;
    if (state.selectedId === id) state.selectedId = state.cards[0]?.id ?? null;
    renderGallery();
    updateButtonsEnabled();
    updatePreview();
  }

  function updateButtonsEnabled() {
    const has = state.cards.length > 0;
    const hasTwo = state.cards.length > 0;
    el('autoColorBtn').disabled = !hasTwo || autoBusy;
    el('autoRotateBtn').disabled = !hasTwo || autoBusy;
    el('autoScaleBtn').disabled = !hasTwo || autoBusy;
    el('autoPositionBtn').disabled = !hasTwo || autoBusy;
    el('suggestCropBtn').disabled = !hasTwo;
    el('downloadOneBtn').disabled = !has;
    el('downloadAllZipBtn').disabled = !has;
    sendMenu.setEnabled(has);
  }

  // ---------- Color controls ----------

  const autoColor = () => runAuto(async () => {
    const ref = getReference();
    if (!ref) return;
    ensureAnalyzed(ref);
    state.cards.forEach((card) => {
      ensureAnalyzed(card);
      card.autoColorTransform = ColorAlign.computeAutoTransform(card.colorStats, ref.colorStats);
    });
    state.colorEnabled = true;
    state.autoColorEnabled = true;
    el('colorEnabled').checked = true;
    el('colorEnabled').disabled = false;
    el('autoColorEnabled').checked = true;
    el('autoColorEnabled').disabled = false;
    refreshAll();
  });
  el('autoColorBtn').addEventListener('click', autoColor);

  function recomputeAutoColorIfNeeded() {
    if (!state.colorEnabled || !state.autoColorEnabled) return;
    const ref = getReference();
    if (!ref) return;
    ensureAnalyzed(ref);
    state.cards.forEach((card) => {
      ensureAnalyzed(card);
      card.autoColorTransform = ColorAlign.computeAutoTransform(card.colorStats, ref.colorStats);
    });
    refreshAll();
  }

  el('colorEnabled').addEventListener('change', (e) => {
    state.colorEnabled = e.target.checked;
    refreshAll();
  });
  el('autoColorEnabled').addEventListener('change', (e) => {
    state.autoColorEnabled = e.target.checked;
    refreshAll();
  });

  function bindSlider(id, outId, key, isFloat, formatter) {
    const input = el(id);
    const out = el(outId);
    input.addEventListener('input', () => {
      const v = isFloat ? parseFloat(input.value) : parseInt(input.value, 10);
      state.manualColor[key] = v;
      out.textContent = formatter ? formatter(v) : v;
      previewNextFrame();
    });
    input.addEventListener('change', () => refreshThumbnails());
  }
  bindSlider('brightness', 'brightnessOut', 'brightness', false);
  bindSlider('contrast', 'contrastOut', 'contrast', false);
  bindSlider('saturation', 'saturationOut', 'saturation', false);
  bindSlider('rGain', 'rGainOut', 'rGain', true, (v) => v.toFixed(2));
  bindSlider('gGain', 'gGainOut', 'gGain', true, (v) => v.toFixed(2));
  bindSlider('bGain', 'bGainOut', 'bGain', true, (v) => v.toFixed(2));

  el('resetColorBtn').addEventListener('click', () => {
    state.manualColor = { brightness: 0, contrast: 0, saturation: 0, rGain: 1, gGain: 1, bGain: 1 };
    el('brightness').value = 0; el('brightnessOut').textContent = '0';
    el('contrast').value = 0; el('contrastOut').textContent = '0';
    el('saturation').value = 0; el('saturationOut').textContent = '0';
    el('rGain').value = 1; el('rGainOut').textContent = '1.00';
    el('gGain').value = 1; el('gGainOut').textContent = '1.00';
    el('bGain').value = 1; el('bGainOut').textContent = '1.00';
    refreshAll();
  });

  // ---------- Rotation controls ----------
  // Rotation/scale/position can each run independently, but always compose at render time
  // (render.js) in fixed order: scale, then rotation, then position, then crop.

  const autoRotate = () => runAuto(async () => {
    state.rotationEnabled = true;
    state.autoAngleEnabled = true;
    el('rotationEnabled').checked = true;
    el('rotationEnabled').disabled = false;
    el('autoAngleEnabled').checked = true;
    el('autoAngleEnabled').disabled = false;
    autoSuggestCrop();
    refreshAll();
  });
  el('autoRotateBtn').addEventListener('click', autoRotate);

  el('rotationEnabled').addEventListener('change', (e) => {
    state.rotationEnabled = e.target.checked;
    refreshAll();
  });
  el('autoAngleEnabled').addEventListener('change', (e) => {
    state.autoAngleEnabled = e.target.checked;
    refreshAll();
  });

  el('manualRotation').addEventListener('input', (e) => {
    state.manualRotationDeg = parseFloat(e.target.value);
    el('manualRotationOut').textContent = state.manualRotationDeg.toFixed(1);
    previewNextFrame();
  });
  el('manualRotation').addEventListener('change', () => {
    refreshThumbnails();
  });

  el('perCardRotation').addEventListener('input', (e) => {
    const card = getSelected();
    if (!card) return;
    state.perCardRotationDeg[card.id] = parseFloat(e.target.value) || 0;
    previewNextFrame();
  });
  el('perCardRotation').addEventListener('change', () => refreshThumbnails());

  el('resetRotationBtn').addEventListener('click', () => {
    state.manualRotationDeg = 0;
    state.perCardRotationDeg = {};
    el('manualRotation').value = 0;
    el('manualRotationOut').textContent = '0.0';
    el('perCardRotation').value = 0;
    refreshAll();
  });

  // ---------- Scale controls ----------

  const autoScale = () => runAuto(async () => {
    state.autoScaleEnabled = true;
    el('autoScaleEnabled').checked = true;
    el('autoScaleEnabled').disabled = false;
    computeAutoScales();
    autoSuggestCrop();
    refreshAll();
  });
  el('autoScaleBtn').addEventListener('click', autoScale);

  el('autoScaleEnabled').addEventListener('change', (e) => {
    state.autoScaleEnabled = e.target.checked;
    refreshAll();
  });

  // ---------- Position controls ----------

  const autoPosition = () => runAuto(async () => {
    state.autoPositionEnabled = true;
    el('autoPositionEnabled').checked = true;
    el('autoPositionEnabled').disabled = false;
    await computeAutoOffsetsAsync();
    autoSuggestCrop();
    refreshAll();
  });
  el('autoPositionBtn').addEventListener('click', autoPosition);

  el('autoPositionEnabled').addEventListener('change', (e) => {
    state.autoPositionEnabled = e.target.checked;
    refreshAll();
  });

  // ---------- Crop controls ----------

  function currentMaxAbsAngle() {
    let max = 0;
    state.cards.forEach((card) => {
      const auto = state.autoAngleEnabled ? card.autoAngle || 0 : 0;
      const perCard = state.perCardRotationDeg[card.id] || 0;
      const total = auto + state.manualRotationDeg + perCard;
      max = Math.max(max, Math.abs(total));
    });
    return max;
  }

  // Worst case across all 4 edges: the rotation-derived margin (same on both sides of an
  // axis, since different cards can skew in either direction) plus, per edge, the largest
  // position-alignment shift that would leave that specific edge with a blank margin. A
  // card shifted right (positive dx) exposes blank on its LEFT; shifted left exposes blank
  // on its RIGHT; same logic for dy/top/bottom. Taking the max per edge across all cards
  // (rather than a single combined pixel budget split evenly) keeps the crop anchored and
  // no larger than it needs to be on each side.
  function autoSuggestCrop() {
    const ref = getReference() || state.cards[0];
    if (!ref) return;
    const w = ref.img.naturalWidth || ref.img.width;
    const h = ref.img.naturalHeight || ref.img.height;
    const maxAngle = currentMaxAbsAngle();
    const rot = Render.suggestedCrop(w, h, maxAngle);

    let extraLeft = 0, extraRight = 0, extraTop = 0, extraBottom = 0;
    if (state.autoPositionEnabled) {
      state.cards.forEach((card) => {
        const off = card.autoOffset;
        if (!off) return;
        extraLeft = Math.max(extraLeft, off.dx);
        extraRight = Math.max(extraRight, -off.dx);
        extraTop = Math.max(extraTop, off.dy);
        extraBottom = Math.max(extraBottom, -off.dy);
      });
    }

    const crop = {
      top: Math.ceil(rot.top + extraTop),
      bottom: Math.ceil(rot.bottom + extraBottom),
      left: Math.ceil(rot.left + extraLeft),
      right: Math.ceil(rot.right + extraRight),
    };
    state.crop = crop;
    el('cropTop').value = crop.top;
    el('cropBottom').value = crop.bottom;
    el('cropLeft').value = crop.left;
    el('cropRight').value = crop.right;
  }

  el('suggestCropBtn').addEventListener('click', () => {
    autoSuggestCrop();
    refreshAll();
  });

  ['cropTop', 'cropBottom', 'cropLeft', 'cropRight'].forEach((id) => {
    el(id).addEventListener('input', () => {
      state.crop = {
        top: parseInt(el('cropTop').value, 10) || 0,
        bottom: parseInt(el('cropBottom').value, 10) || 0,
        left: parseInt(el('cropLeft').value, 10) || 0,
        right: parseInt(el('cropRight').value, 10) || 0,
      };
      previewNextFrame();
    });
    el(id).addEventListener('change', () => refreshThumbnails());
  });

  el('showCropGuide').addEventListener('change', () => updatePreview());

  // Drag the dashed crop rectangle's edges on the guide canvas.
  const CROP_IDS = { left: 'cropLeft', right: 'cropRight', top: 'cropTop', bottom: 'cropBottom' };
  let cropDrag = null;

  function guideGeometry(e) {
    const card = getSelected();
    if (!card || !guideCanvas.width) return null;
    const rect = guideCanvas.getBoundingClientRect();
    const k = guideCanvas.width / rect.width; // canvas px per screen px
    const scale = previewScaleFor(card, currentOptions(), PREVIEW_MAX_DIM); // canvas px per card px
    const crop = state.crop || { top: 0, right: 0, bottom: 0, left: 0 };
    return {
      x: (e.clientX - rect.left) * k,
      y: (e.clientY - rect.top) * k,
      k,
      scale,
      edges: {
        left: crop.left * scale,
        right: guideCanvas.width - crop.right * scale,
        top: crop.top * scale,
        bottom: guideCanvas.height - crop.bottom * scale,
      },
    };
  }

  function edgeUnder(g) {
    const tol = 8 * g.k;
    const inY = g.y > g.edges.top - tol && g.y < g.edges.bottom + tol;
    const inX = g.x > g.edges.left - tol && g.x < g.edges.right + tol;
    if (inY && Math.abs(g.x - g.edges.left) < tol) return 'left';
    if (inY && Math.abs(g.x - g.edges.right) < tol) return 'right';
    if (inX && Math.abs(g.y - g.edges.top) < tol) return 'top';
    if (inX && Math.abs(g.y - g.edges.bottom) < tol) return 'bottom';
    return null;
  }

  guideCanvas.addEventListener('pointerdown', (e) => {
    const g = guideGeometry(e);
    const edge = g && edgeUnder(g);
    if (!edge) return;
    cropDrag = edge;
    guideCanvas.setPointerCapture(e.pointerId);
  });

  guideCanvas.addEventListener('pointermove', (e) => {
    const g = guideGeometry(e);
    if (!g) return;
    if (!cropDrag) {
      const edge = edgeUnder(g);
      guideCanvas.style.cursor = edge === 'left' || edge === 'right' ? 'ew-resize' : edge ? 'ns-resize' : '';
      return;
    }
    const distance = {
      left: g.x,
      right: guideCanvas.width - g.x,
      top: g.y,
      bottom: guideCanvas.height - g.y,
    }[cropDrag];
    const input = el(CROP_IDS[cropDrag]);
    input.value = Math.max(0, Math.round(distance / g.scale));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const endCropDrag = () => {
    if (!cropDrag) return;
    el(CROP_IDS[cropDrag]).dispatchEvent(new Event('change', { bubbles: true }));
    cropDrag = null;
  };
  guideCanvas.addEventListener('pointerup', endCropDrag);
  guideCanvas.addEventListener('pointercancel', endCropDrag);

  document.getElementsByName('emptyPixelMode').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.emptyPixelMode = radio.value;
      refreshAll();
    });
  });

  // ---------- Preview ----------

  function drawImageToCanvas(canvas, img, maxDim) {
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
    canvas.width = Math.round(naturalW * scale);
    canvas.height = Math.round(naturalH * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  function copyCanvas(dest, src) {
    dest.width = src.width;
    dest.height = src.height;
    dest.getContext('2d').drawImage(src, 0, 0);
  }

  // Mirrors Render.renderCard's internal scale math, needed here only to place the
  // crop-guide overlay rectangle at the right size on the uncropped preview canvas.
  function previewScaleFor(card, options, maxDim) {
    const naturalW = card.img.naturalWidth || card.img.width;
    const naturalH = card.img.naturalHeight || card.img.height;
    const cardScale = options.autoScaleEnabled && card.autoScale ? card.autoScale : 1;
    const targetW = naturalW * cardScale;
    const targetH = naturalH * cardScale;
    return maxDim ? Math.min(1, maxDim / Math.max(targetW, targetH)) : 1;
  }

  // Sliders fire far more often than the screen redraws: redraw once per frame.
  let previewFrame = 0;
  function previewNextFrame() {
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      updatePreview();
    });
  }

  function updatePreview() {
    const ref = getReference();
    if (ref) {
      ensureAnalyzed(ref);
      const refCanvas = Render.renderCard(ref, currentOptions(), PREVIEW_MAX_DIM);
      copyCanvas(referenceCanvas, refCanvas);
    } else {
      referenceCanvas.width = 0;
      referenceCanvas.height = 0;
    }

    const card = getSelected();
    if (!card) {
      previewNameEl.textContent = '— select a card —';
      [beforeCanvas, afterCanvas, guideCanvas].forEach((c) => {
        c.width = 0;
        c.height = 0;
      });
      return;
    }
    previewNameEl.textContent = card.name + (card.id === state.referenceId ? '  (reference)' : '');
    ensureAnalyzed(card);

    drawImageToCanvas(beforeCanvas, card.img, PREVIEW_MAX_DIM);

    const finalCanvas = Render.renderCard(card, currentOptions(), PREVIEW_MAX_DIM);
    copyCanvas(afterCanvas, finalCanvas);

    // Guide: rotated/positioned but uncropped, with a red overlay at the crop's actual
    // anchored offset — a residual drift shows up as the rectangle missing the icons.
    const showGuide = (state.rotationEnabled || state.autoScaleEnabled || state.autoPositionEnabled) && el('showCropGuide').checked;
    guideRow.style.display = showGuide ? '' : 'none';
    if (showGuide) {
      const options = currentOptions();
      const uncroppedOptions = { ...options, crop: null };
      const uncropped = Render.renderCard(card, uncroppedOptions, PREVIEW_MAX_DIM);
      copyCanvas(guideCanvas, uncropped);
      const gctx = guideCanvas.getContext('2d');
      const previewScale = previewScaleFor(card, options, PREVIEW_MAX_DIM);
      const crop = options.crop;
      const left = crop ? Math.round(crop.left * previewScale) : 0;
      const top = crop ? Math.round(crop.top * previewScale) : 0;
      const right = crop ? Math.round(crop.right * previewScale) : 0;
      const bottom = crop ? Math.round(crop.bottom * previewScale) : 0;
      const rectW = Math.max(1, uncropped.width - left - right);
      const rectH = Math.max(1, uncropped.height - top - bottom);
      gctx.strokeStyle = '#dc2626';
      gctx.lineWidth = 2;
      gctx.setLineDash([6, 4]);
      gctx.strokeRect(left, top, rectW, rectH);
    }
  }

  function refreshThumbnails() {
    document.querySelectorAll('.card-thumb img').forEach((imgEl, idx) => {
      const card = state.cards[idx];
      if (!card) return;
      const canvas = Render.renderCard(card, currentOptions(), THUMB_MAX_DIM);
      imgEl.src = canvas.toDataURL('image/png');
    });
  }

  function refreshAll() {
    updatePreview();
    refreshThumbnails();
  }

  // ---------- Export ----------

  function extForFormat(format) {
    return format === 'image/jpeg' ? 'jpg' : 'png';
  }

  // DPI of an aligned card: with auto scale on, cards are resampled to the
  // reference card's size, so they share its DPI; otherwise their own.
  function outputDpi(card, options) {
    const scale = options.autoScaleEnabled && card.autoScale ? card.autoScale : 1;
    const ref = state.cards.find((c) => c.id === state.referenceId);
    if (scale !== 1 && ref && ref.dpi) return ref.dpi;
    return card.dpi ? card.dpi * scale : null;
  }

  // One aligned card at full resolution, stamped with its DPI.
  async function alignedBlob(card, format) {
    const options = currentOptions();
    const canvas = Render.renderCard(card, options, null); // null = full resolution
    const blob = await PnP.canvasToBlob(canvas, format, 0.95);
    return PnP.setImageDpi(blob, outputDpi(card, options));
  }

  const alignedName = (card, format) => `${card.name.replace(/\.[^.]+$/, '')}_aligned.${extForFormat(format)}`;

  function uniqueZipName(name, used) {
    let candidate = name;
    let n = 2;
    while (used.has(candidate)) {
      candidate = name.replace(/(\.[^.]+)$/, `_${n}$1`);
      n++;
    }
    used.add(candidate);
    return candidate;
  }

  el('downloadOneBtn').addEventListener('click', async () => {
    const card = getSelected();
    if (!card) return;
    const format = el('exportFormat').value;
    PnP.downloadBlob(await alignedBlob(card, format), alignedName(card, format));
  });

  el('downloadAllZipBtn').addEventListener('click', async () => {
    const format = el('exportFormat').value;
    const btn = el('downloadAllZipBtn');
    btn.disabled = true;
    const used = new Set();
    const files = [];
    for (let i = 0; i < state.cards.length; i++) {
      const card = state.cards[i];
      exportStatus.textContent = `Preparing ZIP ${i + 1} / ${state.cards.length}: ${card.name}...`;
      const name = uniqueZipName(alignedName(card, format), used);
      files.push({ name, data: await alignedBlob(card, format) });
    }
    exportStatus.textContent = `Building ZIP archive...`;
    const zipBlob = await PnP.zip.create(files);
    PnP.downloadBlob(zipBlob, PnP.outputName(state.cards, 'aligned.zip', 'aligned_cards.zip'));
    exportStatus.textContent = `Done — zipped ${state.cards.length} card(s).`;
    btn.disabled = false;
  });

  // ---------- Shared PnPTools wiring ----------


  const sendMenu = PnP.sendMenu(el('sendSlot'), {
    from: 'Align',
    targets: ['PnPBleed', 'PnPLayout', 'PnPBooklet', 'PnPTuckBox'],
    getItems: async () => {
      const format = el('exportFormat').value;
      const items = [];
      for (const card of state.cards) {
        items.push({ name: alignedName(card, format), blob: await alignedBlob(card, format), role: card.role });
      }
      return items;
    },
  });

  // Auto steps are replayed (in the order they were run) when a project is
  // opened, which recreates their results exactly without storing them.
  const AUTO_BUTTONS = ['autoRotateBtn', 'autoScaleBtn', 'autoPositionBtn', 'autoColorBtn'];
  const AUTO_ACTIONS = { autoRotateBtn: autoRotate, autoScaleBtn: autoScale, autoPositionBtn: autoPosition, autoColorBtn: autoColor };
  let autoRuns = [];
  AUTO_BUTTONS.forEach((id) => el(id).addEventListener('click', () => {
    autoRuns = autoRuns.filter((x) => x !== id).concat(id);
  }));

  function resetCards() {
    state.cards.forEach(releaseCard);
    state.cards = [];
    state.referenceId = null;
    state.selectedId = null;
    state.perCardRotationDeg = {};
    autoRuns = [];
  }

  PnP.init({
    tool: 'PnPAlign',
    project: {
      getFiles: () => state.cards.map((c) => ({ name: c.name, blob: c.file, role: c.role })),
      getState: () => {
        const index = (id) => state.cards.findIndex((c) => c.id === id);
        return {
          referenceIndex: index(state.referenceId),
          perCardRotationDeg: state.cards.map((c) => state.perCardRotationDeg[c.id] || 0),
          autoRuns,
        };
      },
      setFiles: async (files) => {
        resetCards();
        await loadFiles(files);
      },
      setState: async (saved, manifest) => {
        if (!saved) return;
        const ref = state.cards[saved.referenceIndex];
        if (ref) state.referenceId = ref.id;
        (saved.perCardRotationDeg || []).forEach((deg, i) => {
          if (state.cards[i] && deg) state.perCardRotationDeg[state.cards[i].id] = deg;
        });
        for (const id of saved.autoRuns || []) {
          if (AUTO_ACTIONS[id]) {
            await AUTO_ACTIONS[id]();
            autoRuns = autoRuns.filter((x) => x !== id).concat(id);
          }
        }
        // Replaying the auto steps resets toggles and crop; restore the saved ones.
        PnP.settings.apply(manifest.settings);
        renderGallery();
        refreshAll();
      },
    },
    hasUnsavedWork: () => state.cards.length > 0,
  });

  PnP.handoff.receive((items) => loadFiles(PnP.itemsToFiles(items)));

  updateButtonsEnabled();
})();
