// Card line-art editor page: hosts the shared PnPTools vector editor
// (shared/pnp-editor.js) and adds what is specific to PnPCut — a project of
// same-size cards (each with its own reference image and shapes), templates,
// the .json card project and per-layer export.

(() => {
  const $ = (id) => document.getElementById(id);

  const LAYERS = [
    { id: 'cut', label: 'Cut', color: '#c0392b' },
    { id: 'score', label: 'Score/Fold', color: '#e08e0b' },
    { id: 'emboss', label: 'Emboss', color: '#2e8b57' },
  ];
  const LAYER_IDS = LAYERS.map((l) => l.id);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const cardSize = () => ({ w: parseFloat($('cardW').value) || 63, h: parseFloat($('cardH').value) || 88 });

  const editor = PnPEditor.create({
    stage: $('editorStage'),
    props: $('editorProps'),
    options: $('editorOptions'),
    layers: LAYERS,
    docSize: cardSize(),
    viewKey: 'pnp:PnPCut-editor:view',
    importSvg: true,
  });

  // ---------- cards ----------
  //
  // The editor shows one card at a time; the others keep their shapes,
  // guides and undo history here until they are shown again.

  const cards = [];
  let current = -1;

  function newCard(name, fields = {}) {
    return { name, imageDataUrl: null, imageVisible: true, thumb: null, shapes: [], guides: [], history: null, ...fields };
  }

  function storeCurrent() {
    const card = cards[current];
    if (!card) return;
    card.shapes = editor.getShapes();
    card.guides = JSON.parse(JSON.stringify(editor.guides));
    card.history = editor.getHistory();
  }

  function showCard(index) {
    storeCurrent();
    current = index;
    const card = cards[index];
    editor.setImage(card.imageDataUrl);
    editor.setImageVisible(card.imageVisible);
    editor.setGuides(JSON.parse(JSON.stringify(card.guides || [])));
    editor.setShapes(card.shapes, { resetHistory: true, history: card.history });
    $('cardName').value = card.name;
    renderCardList();
  }

  // Shapes of every card, with the one being edited taken live from the editor.
  function cardShapes(i) {
    return i === current ? editor.getShapes() : cards[i].shapes;
  }

  function nextCardName() {
    let n = cards.length + 1;
    while (cards.some((c) => c.name === `Card ${n}`)) n++;
    return `Card ${n}`;
  }

  function thumbSvg(card, shapes) {
    const { w, h } = cardSize();
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('class', 'card-thumb');
    if (card.thumb && card.imageVisible) {
      const img = document.createElementNS(SVG_NS, 'image');
      img.setAttribute('href', card.thumb);
      img.setAttribute('width', w);
      img.setAttribute('height', h);
      img.setAttribute('preserveAspectRatio', 'none');
      svg.appendChild(img);
    }
    const colors = editor.layerColors;
    shapes.forEach((s) => {
      const path = PathGeom.shapePath(s);
      if (!path) return;
      const el = document.createElementNS(SVG_NS, 'path');
      el.setAttribute('d', PathGeom.toD(path));
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', colors[s.layer] || '#000');
      el.setAttribute('stroke-width', '1.2');
      el.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(el);
    });
    return svg;
  }

  const ICONS = {
    eye: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    image: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
    remove: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  function iconButton(icon, title, onClick, extra = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `card-action ${extra}`.trim();
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = ICONS[icon];
    b.addEventListener('click', onClick);
    return b;
  }

  // Picture button: browse for an image or take one from the library.
  function imagePicker(card, title) {
    const icon = document.createElement('span');
    icon.className = 'card-action-icon';
    icon.innerHTML = ICONS.image;
    return PnP.filePicker(null, {
      accept: ['image/*'],
      onFiles: (files) => replaceImage(card, files[0]),
      browse: () => pickImageFor(card),
      label: icon,
      title,
      buttonClass: 'card-action',
    });
  }

  // One row per card: the card itself (click to edit it) and its reference
  // image actions. An image dropped on a row becomes that card's image.
  function renderCardList() {
    const list = $('cardList');
    list.innerHTML = '';
    cards.forEach((card, i) => {
      const shapes = cardShapes(i);
      const row = document.createElement('div');
      row.className = 'card-item' + (i === current ? ' current' : '');

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'card-select';
      select.title = card.name;
      const label = document.createElement('span');
      label.className = 'card-label';
      label.textContent = card.name;
      const count = document.createElement('span');
      count.className = 'card-count';
      count.textContent = shapes.length ? `${shapes.length} shape${shapes.length === 1 ? '' : 's'}` : 'empty';
      select.append(thumbSvg(card, shapes), label, count);
      select.addEventListener('click', () => { if (i !== current) showCard(i); });

      const actions = document.createElement('div');
      actions.className = 'card-actions';
      if (card.imageDataUrl) {
        actions.append(
          iconButton(card.imageVisible ? 'eye' : 'eyeOff', card.imageVisible ? 'Hide reference image' : 'Show reference image',
            () => setImageVisible(card, !card.imageVisible), card.imageVisible ? 'card-eye' : 'card-eye off'),
          imagePicker(card, 'Replace reference image…'),
          iconButton('remove', 'Remove reference image', () => setCardImage(card, null), 'danger'));
      } else {
        actions.append(imagePicker(card, 'Set reference image…'));
      }

      row.addEventListener('dragover', (e) => {
        if (![...e.dataTransfer.items].some((it) => it.kind === 'file')) return;
        e.preventDefault();
        row.classList.add('dragover');
      });
      row.addEventListener('dragleave', () => row.classList.remove('dragover'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        row.classList.remove('dragover');
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
        if (file) replaceImage(card, file);
      });

      row.append(select, actions);
      list.append(row);
    });
    $('deleteCardBtn').disabled = cards.length === 0;
  }

  editor.onChange(renderCardList);

  $('cardName').addEventListener('input', () => {
    const card = cards[current];
    if (!card) return;
    card.name = $('cardName').value.trim() || card.name;
    renderCardList();
  });

  $('addCardBtn').addEventListener('click', () => {
    storeCurrent();
    cards.splice(current + 1, 0, newCard(nextCardName()));
    showCard(current + 1);
  });

  $('dupCardBtn').addEventListener('click', () => {
    storeCurrent();
    const src = cards[current];
    const copy = newCard(`${src.name} copy`, {
      imageDataUrl: src.imageDataUrl,
      imageVisible: src.imageVisible,
      thumb: src.thumb,
      shapes: JSON.parse(JSON.stringify(src.shapes)),
      guides: JSON.parse(JSON.stringify(src.guides)),
    });
    cards.splice(current + 1, 0, copy);
    showCard(current + 1);
  });

  $('deleteCardBtn').addEventListener('click', () => {
    const card = cards[current];
    if (!card) return;
    if (editor.getShapes().length && !window.confirm(`Delete “${card.name}” and its line art?`)) return;
    const index = current;
    cards.splice(index, 1);
    current = -1; // nothing to store: the shown card is gone
    if (!cards.length) cards.push(newCard('Card 1'));
    showCard(Math.min(index, cards.length - 1));
  });

  // ---------- reference images ----------

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  // Small PNG preview (keeps transparency) for the card list.
  function makeThumb(url) {
    return new Promise((resolve) => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 160 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * s));
        c.height = Math.max(1, Math.round(img.naturalHeight * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function setCardImage(card, url) {
    card.imageDataUrl = url;
    card.imageVisible = true;
    card.thumb = await makeThumb(url);
    if (card === cards[current]) {
      editor.setImage(url);
      editor.setImageVisible(true);
    }
    renderCardList();
  }

  const baseName = (name) => name.replace(/\.[^.]+$/, '');

  // The first image fills the shown card while it is still blank; every
  // other image becomes a new card after it.
  async function addCardImages(files) {
    storeCurrent();
    const blank = cards[current] && !cards[current].imageDataUrl && !editor.getShapes().length;
    let first = -1;
    for (const file of files) {
      let url;
      try {
        url = await readDataUrl(file);
      } catch (err) {
        PnP.toast(err.message, 'error');
        continue;
      }
      if (first === -1 && blank) {
        first = current;
        cards[current].name = baseName(file.name);
        await setCardImage(cards[current], url);
      } else {
        const card = newCard(baseName(file.name));
        await setCardImage(card, url);
        cards.push(card);
        if (first === -1) first = cards.length - 1;
      }
    }
    if (first !== -1) showCard(first);
  }

  PnP.dropzone($('cardImageDrop'), { input: $('cardImageInput'), accept: ['image/*'], onFiles: addCardImages });

  async function replaceImage(card, file) {
    PnP.recordFiles({ kind: 'input', items: [{ name: file.name, blob: file }] });
    try {
      await setCardImage(card, await readDataUrl(file));
    } catch (err) {
      PnP.toast(err.message, 'error');
    }
  }

  let imageTarget = null; // card whose row asked for an image

  function pickImageFor(card) {
    imageTarget = card;
    $('imageInput').click();
  }

  $('imageInput').addEventListener('change', () => {
    const file = $('imageInput').files[0];
    $('imageInput').value = '';
    if (file && imageTarget) replaceImage(imageTarget, file);
    imageTarget = null;
  });

  function setImageVisible(card, visible) {
    card.imageVisible = visible;
    if (card === cards[current]) editor.setImageVisible(visible);
    renderCardList();
  }

  // ---------- card size ----------

  ['cardW', 'cardH'].forEach((id) => $(id).addEventListener('change', () => {
    const { w, h } = cardSize();
    editor.setDocSize(w, h);
    renderCardList();
  }));

  // ---------- export ----------

  const fmt = (n) => Math.round(n * 1000) / 1000;
  const safeName = (name) => name.replace(/[\\/:*?"<>|\s]+/g, '_') || 'card';

  // Flat paths with mirroring baked in, like the editor's own export:
  // Cricut Design Space mis-scales anything under a transform attribute.
  function cardSvg(shapes, layers, mirror) {
    const { w, h } = cardSize();
    const colors = editor.layerColors;
    const content = shapes
      .filter((s) => layers.includes(s.layer))
      .map((s) => {
        let path = PathGeom.shapePath(s);
        if (!path) return '';
        if (mirror) path = PathGeom.mapPath(path, (p) => ({ x: w - p.x, y: p.y }));
        return `<path d="${PathGeom.toD(path, fmt)}" fill="none" stroke="${colors[s.layer]}" stroke-width="0.15"/>`;
      })
      .join('\n');
    return `<svg xmlns="${SVG_NS}" ${PnP.svgSize(w, h)}>\n${content}\n</svg>`;
  }

  function downloadSVG(layers, suffix) {
    const { w, h } = cardSize();
    const markup = cardSvg(editor.getShapes(), layers, $('mirrorExport').checked);
    PnP.downloadBlob(new Blob([markup], { type: 'image/svg+xml' }), `${safeName(cards[current].name)}_${w}x${h}mm_${suffix}.svg`);
  }

  $('exportAllBtn').addEventListener('click', () => downloadSVG(LAYER_IDS, 'all'));
  $('exportCutBtn').addEventListener('click', () => downloadSVG(['cut'], 'cut'));
  $('exportScoreBtn').addEventListener('click', () => downloadSVG(['score'], 'score'));
  $('exportEmbossBtn').addEventListener('click', () => downloadSVG(['emboss'], 'emboss'));

  $('exportCardsBtn').addEventListener('click', async () => {
    const { w, h } = cardSize();
    const used = new Set();
    const entries = cards.map((card, i) => {
      let name = safeName(card.name);
      for (let n = 2; used.has(name); n++) name = `${safeName(card.name)}_${n}`;
      used.add(name);
      return { name: `${name}_${w}x${h}mm_all.svg`, data: cardSvg(cardShapes(i), LAYER_IDS, $('mirrorExport').checked) };
    });
    PnP.downloadBlob(await PnP.zip.create(entries), PnP.outputName([], `${w}x${h}mm.zip`, `cards_${w}x${h}mm.zip`));
  });

  // ---------- card project (.json, also read by the sheet assembler) ----------
  //
  // Version 2 holds a list of cards; version 1 files (one card, shapes at the
  // top level) still open as a single card.

  function projectData() {
    storeCurrent();
    const { w, h } = cardSize();
    return {
      app: 'PnPCut',
      type: 'card-project',
      version: 2,
      cardW: w,
      cardH: h,
      layerColors: editor.layerColors,
      cards: cards.map((c) => ({ name: c.name, imageDataUrl: c.imageDataUrl, imageVisible: c.imageVisible, shapes: c.shapes, guides: c.guides })),
    };
  }

  // What counts as unsaved work: names and shapes of every card.
  function workSignature() {
    return JSON.stringify(cards.map((c, i) => [c.name, cardShapes(i)]));
  }

  let savedSignature = null;

  $('saveProjectBtn').addEventListener('click', () => {
    const project = projectData();
    PnP.downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), PnP.outputName([], `${project.cardW}x${project.cardH}mm.json`, `card-project_${project.cardW}x${project.cardH}mm.json`), { record: false });
    savedSignature = workSignature();
  });

  // Replace every card with `list` ([{ name, imageDataUrl, shapes, guides }]).
  async function setCards(list) {
    if (!list.length) throw new Error('The project has no cards.');
    editor.setDocSize(cardSize().w, cardSize().h);
    cards.length = 0;
    current = -1;
    for (const [i, c] of list.entries()) {
      cards.push(newCard(c.name || `Card ${i + 1}`, {
        imageDataUrl: c.imageDataUrl || null,
        imageVisible: c.imageVisible !== false,
        thumb: await makeThumb(c.imageDataUrl),
        shapes: c.shapes || [],
        guides: c.guides || [],
      }));
    }
    showCard(0);
    savedSignature = workSignature();
  }

  // Hand the cards to a new sheet assembler tab (through the same store as
  // "Send to"); the sheet opens them as a project and places every card.
  $('openSheetBtn').addEventListener('click', async () => {
    const win = window.open('', '_blank'); // synchronously, so popup blockers allow it
    try {
      const project = projectData();
      const name = PnP.outputName([], `${project.cardW}x${project.cardH}mm.json`, `card-project_${project.cardW}x${project.cardH}mm.json`);
      const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
      const id = await PnP.handoff.save({ name: `${cards.length} card(s) from the card editor`, from: 'Card editor', items: [{ name, blob }] });
      const url = `sheet.html?import=${encodeURIComponent(id)}`;
      if (win) win.location.href = url;
      else location.href = url;
    } catch (err) {
      if (win) win.close();
      PnP.toast(`Could not open the sheet assembler: ${err.message}`, 'error');
    }
  });

  async function loadProject(file) {
    const project = JSON.parse(await file.text());
    const list = Array.isArray(project.cards)
      ? project.cards
      : [{ name: baseName(file.name), imageDataUrl: project.imageDataUrl, shapes: project.shapes, guides: project.guides }];
    if (project.cardW && project.cardH) {
      $('cardW').value = project.cardW;
      $('cardH').value = project.cardH;
    }
    editor.setLayerColors(project.layerColors);
    await setCards(list);
    PnP.toast(`Opened ${cards.length} card${cards.length === 1 ? '' : 's'}.`, 'success');
  }

  // The top bar's .pnp project: card size is a setting, the cards are the
  // state and their reference images travel as files (role "card:<index>").
  let projectImages = new Map();

  const pnpProject = {
    fileName: () => 'PnPCut-cards',
    getFiles: () => Promise.all(cards
      .map((c, i) => [c, i])
      .filter(([c]) => c.imageDataUrl)
      .map(async ([c, i]) => ({ name: `${i + 1}-${safeName(c.name)}.png`, blob: await (await fetch(c.imageDataUrl)).blob(), role: `card:${i}` }))),
    setFiles: (files) => {
      projectImages = new Map(files.map((f) => [f.pnpRole, f]));
    },
    getState: () => {
      storeCurrent();
      return { layerColors: editor.layerColors, cards: cards.map((c) => ({ name: c.name, imageVisible: c.imageVisible, shapes: c.shapes, guides: c.guides })) };
    },
    setState: async (saved) => {
      editor.setLayerColors(saved && saved.layerColors);
      const list = await Promise.all(((saved && saved.cards) || []).map(async (c, i) => {
        const image = projectImages.get(`card:${i}`);
        return { ...c, imageDataUrl: image ? await readDataUrl(image) : null };
      }));
      projectImages = new Map();
      await setCards(list.length ? list : [{ name: 'Card 1' }]);
    },
    markSaved: () => { savedSignature = workSignature(); },
  };

  PnP.dropzone($('projectDrop'), {
    input: $('loadProjectInput'),
    accept: ['application/json', '.json'],
    record: false,
    onFiles: async ([file]) => {
      if (hasUnsavedWork() && !window.confirm('Opening a project replaces the cards you have now. Continue?')) return;
      try {
        await loadProject(file);
      } catch (err) {
        PnP.toast(`Could not open the project: ${err.message}`, 'error');
      }
    },
  });

  function hasUnsavedWork() {
    const empty = cards.every((c, i) => !cardShapes(i).length);
    return !empty && workSignature() !== savedSignature;
  }

  // ---------- templates ----------

  // Starting shapes sized to the current card; added as normal, editable shapes.
  const TEMPLATES = {
    outline: (W, H) => [{ type: 'rect', layer: 'cut', x: 0, y: 0, w: W, h: H, radius: 3 }],
    round: (W, H) => {
      const d = Math.min(W, H);
      return [{ type: 'ellipse', layer: 'cut', x: (W - d) / 2, y: (H - d) / 2, w: d, h: d }];
    },
    hex: (W, H) => {
      // Pointy-top regular hexagon, as large as fits the card
      const R = Math.min(W / Math.sqrt(3), H / 2);
      const w = Math.sqrt(3) * R, h = 2 * R;
      const nodes = [];
      for (let i = 0; i < 6; i++) {
        const a = ((-90 + 60 * i) * Math.PI) / 180;
        nodes.push({ fx: 0.5 + (R * Math.cos(a)) / w, fy: 0.5 + (R * Math.sin(a)) / h });
      }
      return [{ type: 'path', closed: true, layer: 'cut', x: (W - w) / 2, y: (H - h) / 2, w, h, nodes }];
    },
    foldMiddle: (W, H) => [{ type: 'line', layer: 'score', x: W / 2, y: 0, w: 0, h: H, diag: 'tlbr' }],
    standee: (W, H) => {
      const base = Math.min(15, H * 0.2);
      return [
        { type: 'rect', layer: 'cut', x: 0, y: 0, w: W, h: H, radius: 0 },
        { type: 'line', layer: 'score', x: 0, y: H - base, w: W, h: 0, diag: 'tlbr' },
      ];
    },
  };

  function templateShapes() {
    const make = TEMPLATES[$('templateSelect').value];
    const { w, h } = cardSize();
    return make ? make(w, h) : [];
  }

  $('addTemplateBtn').addEventListener('click', () => editor.addShapes(templateShapes()));

  // Other cards get the shapes directly; their undo history restarts.
  $('addTemplateAllBtn').addEventListener('click', () => {
    cards.forEach((card, i) => {
      if (i === current) return;
      let id = card.shapes.reduce((m, s) => Math.max(m, s.id || 0), 0);
      templateShapes().forEach((s) => card.shapes.push({ rotation: 0, radius: 0, diag: 'tlbr', ...s, id: ++id }));
      card.history = null;
    });
    editor.addShapes(templateShapes());
  });

  // ---------- Shared PnPTools wiring ----------

  PnP.bindPreset($('cardPreset'), $('cardW'), $('cardH'), 'card');
  PnP.init({
    tool: 'PnPCut',
    settingsKey: 'PnPCut-editor',
    project: pnpProject,
    hasUnsavedWork,
  });
  // Restored settings may have changed the card size.
  editor.setDocSize(cardSize().w, cardSize().h);
  cards.push(newCard('Card 1'));
  showCard(0);
  savedSignature = workSignature();
})();
