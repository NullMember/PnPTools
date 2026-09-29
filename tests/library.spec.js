// The library window: selecting files, setting their size, bleed and backs,
// cropping and turning them, and using them in a tool.
const { test, expect, makeCardImages } = require('./helpers');

const library = (page) => page.locator('.pnp-library');
const tiles = (page) => library(page).locator('.pnp-library-tile');
const props = (page) => library(page).locator('.pnp-library-props');
const pieces = (page) => page.evaluate(() => [...state.pieces.values()].map((p) => ({
  name: p.front.file.name, w: +p.widthMm.toFixed(1), h: +pieceHeightMm(p).toFixed(1), back: p.back ? p.back.file.name : null,
})));

// A plain square image of `px` pixels, as a file to load.
async function square(page, name, px = 400) {
  const b64 = await page.evaluate(async (px) => {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    c.getContext('2d').fillRect(0, 0, px, px);
    const bytes = new Uint8Array(await (await PnP.canvasToBlob(c)).arrayBuffer());
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  }, px);
  return { name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

async function openLibrary(page) {
  await page.locator('.pnp-outputs-btn').click();
  await expect(library(page)).toBeVisible();
}

// Load files in Bleed (so they're in the library), then open Layout's library.
async function loadThenLayout(page, files) {
  await page.goto('PnPBleed/index.html');
  await page.setInputFiles('#imageInput', files);
  await expect(page.locator('#thumbnailsContainer .thumbnail')).toHaveCount(files.length);
  // The files reach the library in the background: wait for them.
  await openLibrary(page);
  await expect(tiles(page)).toHaveCount(files.length);
  await page.goto('PnPLayout/grid.html');
  await openLibrary(page);
}

test('the header counts the files and the space they take', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  await page.evaluate(async () => {
    const mb = (n) => new Blob([new Uint8Array(n * 1024 * 1024).fill(n)], { type: 'image/png' });
    await PnP.recordFiles({ kind: 'input', items: [{ name: 'big.png', blob: mb(3) }] });
    await PnP.recordFiles({ kind: 'output', items: [{ name: 'big-copy.png', blob: mb(3) }, { name: 'small.png', blob: mb(1) }] });
  });
  await openLibrary(page);
  await expect(library(page).locator('.pnp-viewer-title')).toContainText('3 files · 4.0 MB'); // the 3 MB file is stored once
});

test('select several files, give them a card size, and use them in a tool', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  await loadThenLayout(page, [await square(page, 'A.png'), await square(page, 'B.png'), await square(page, 'C.png')]);
  await expect(tiles(page)).toHaveCount(3);
  await expect(library(page).getByRole('button', { name: 'Use in this tool' })).toBeDisabled();

  // Click the first, Shift-click the last: all three.
  await tiles(page).first().click();
  await tiles(page).last().click({ modifiers: ['Shift'] });
  await expect(props(page)).toContainText('3 selected');
  await props(page).getByLabel('Size').selectOption('poker');
  await expect(tiles(page).first()).toContainText('63 mm × 88 mm');

  await library(page).getByRole('button', { name: 'Use 3 in this tool' }).click();
  await expect(library(page)).toBeHidden();
  await expect(page.locator('#pieceList .piece')).toHaveCount(3);
  // The square images were stretched to the card's shape, and sized by it.
  expect((await pieces(page)).map((p) => [p.w, p.h])).toEqual([[63, 88], [63, 88], [63, 88]]);
});

test('a size can also be typed, and the bleed in the image is recorded', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  await loadThenLayout(page, [await square(page, 'Token.png')]);
  await tiles(page).first().click();
  await props(page).locator('#pnpLibW__display').fill('46');
  await props(page).locator('#pnpLibW__display').press('Tab');
  await props(page).locator('#pnpLibH__display').fill('46');
  await props(page).locator('#pnpLibH__display').press('Tab');
  await props(page).locator('#pnpLibBleed__display').fill('3');
  await props(page).locator('#pnpLibBleed__display').press('Tab');
  await expect(tiles(page).first()).toContainText('46 mm × 46 mm');
  await library(page).getByRole('button', { name: 'Use 1 in this tool' }).click();
  await expect(page.locator('#pieceList .piece')).toHaveCount(1);
  // Layout finds the 46 mm piece inside its 3 mm bleed by itself.
  expect(await pieces(page)).toEqual([{ name: 'Token.png', w: 46, h: 46, back: null }]);
});

test('backs are chosen in the library and come along', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  await loadThenLayout(page, [await square(page, 'Ace.png'), await square(page, 'King.png'), await square(page, 'Back.png')]);
  const tile = (name) => tiles(page).filter({ hasText: name });
  await tile('Ace.png').click();
  await tile('King.png').click();
  await props(page).getByRole('button', { name: 'Choose…' }).click();
  await tile('Back.png').click();
  await expect(tile('Ace.png')).toContainText('+ back');
  await expect(props(page).locator('.pnp-library-back img')).toHaveAttribute('title', 'Back.png');

  await library(page).getByRole('button', { name: 'Use 2 in this tool' }).click();
  await expect(page.locator('#pieceList .piece')).toHaveCount(2);
  expect((await pieces(page)).map((p) => [p.name, p.back])).toEqual([['Ace.png', 'Back.png'], ['King.png', 'Back.png']]);
});

test('the image editor turns and crops, and the tool gets the edited image', async ({ page }) => {
  const img = await makeCardImages(page); // 315 × 440
  await page.goto('PnPBleed/index.html');
  await loadThenLayout(page, [img.opaque]);
  await tiles(page).first().dblclick();
  const editor = page.locator('.pnp-crop');
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Turn right' }).click();

  // Drag the bottom-right corner to the middle: half the width and height.
  const canvas = editor.locator('canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height - 1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(editor).toBeHidden();

  const meta = () => page.evaluate(async () => {
    const [batch] = await new Promise((resolve) => {
      const req = indexedDB.open('pnptools-project');
      req.onsuccess = () => { const r = req.result.transaction('batches').objectStore('batches').getAll(); r.onsuccess = () => resolve(r.result); };
    });
    return batch.items[0].meta || {};
  });
  await expect.poll(async () => (await meta()).rotate).toBe(90);
  const size = await meta();
  expect(size.crop.w).toBeCloseTo(0.5, 1);
  expect(size.crop.h).toBeCloseTo(0.5, 1);

  await tiles(page).first().click();
  await library(page).getByRole('button', { name: 'Use 1 in this tool' }).click();
  await expect(page.locator('#pieceList .piece')).toHaveCount(1);
  // Turned, the card is 440 × 315; half of that is 220 × 158 (or so).
  const px = await page.evaluate(() => { const f = [...state.pieces.values()][0].front; return [f.w, f.h]; });
  expect(px[0]).toBeGreaterThan(210);
  expect(px[0]).toBeLessThan(230);
  expect(px[1]).toBeGreaterThan(150);
  expect(px[1]).toBeLessThan(166);
});

test('selected files can be removed', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  await loadThenLayout(page, [await square(page, 'A.png'), await square(page, 'B.png')]);
  await tiles(page).first().click();
  await props(page).getByRole('button', { name: 'Remove' }).click();
  await expect(tiles(page)).toHaveCount(1);
  await expect(tiles(page).first()).toContainText('B.png');
});

// ---- sizes the files record ----

// A square PNG with a recorded size (and optionally a wrong DPI), made in the page.
async function notedSquare(page, name, { px = 400, sizeMm = 50, dpi = null } = {}) {
  const b64 = await page.evaluate(async ({ px, sizeMm, dpi }) => {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    c.getContext('2d').fillRect(0, 0, px, px);
    let blob = await PnP.canvasToBlob(c);
    if (dpi) blob = await PnP.setImageDpi(blob, dpi);
    blob = await PnP.setSizeNote(blob, sizeMm, sizeMm);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  }, { px, sizeMm, dpi });
  return { name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

test('the library shows the size a tool records in its output', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.opaque]);
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  await page.click('#downloadBtn');
  const output = library(page).locator('.pnp-library-batch[data-kind="output"] .pnp-library-tile');
  await expect(async () => { // the download reaches the library in the background
    await page.keyboard.press('Escape');
    await openLibrary(page);
    await expect(output).toHaveCount(1, { timeout: 500 });
  }).toPass();
  await expect(output).toContainText('63 mm × 88 mm');
  await output.click();
  await expect(props(page).locator('#pnpLibBleed')).toHaveValue('2');
});

test('Bleed uses the size a file records over the typed card size', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  await page.fill('#bleedInput__display', '2');
  await page.setInputFiles('#imageInput', [await notedSquare(page, 'Coin.png', { px: 400, sizeMm: 50 })]); // 8 px per mm
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBtn')]);
  const width = await page.evaluate(async (b) => (await createImageBitmap(new Blob([new Uint8Array(b)]))).width, [...require('node:fs').readFileSync(await dl.path())]);
  expect(width).toBe(400 + 2 * 16); // 2 mm of bleed at 8 px per mm, not at the 63 × 88 mm card's
});

test('Layout sizes a piece by the size its file records, even with a wrong DPI', async ({ page }) => {
  await page.goto('PnPLayout/index.html');
  await page.setInputFiles('#imageInput', [await notedSquare(page, 'Token.png', { sizeMm: 40, dpi: 72 })]);
  await expect(page.locator('#pieceList .piece')).toHaveCount(1);
  expect(await pieces(page)).toEqual([{ name: 'Token.png', w: 40, h: 40, back: null }]);
});

test('files whose size matches what they record reach tools as they are', async ({ page }) => {
  await page.goto('PnPLayout/index.html');
  const same = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 420;
    const blob = await PnP.setSizeNote(await PnP.canvasToBlob(c), 63, 88);
    const own = await PnP.readSizeNotes(blob);
    const file = await PnP.library.itemFile({ name: 'A.png', blob, meta: { ...own, file: own } });
    const edited = await PnP.library.itemFile({ name: 'A.png', blob, meta: { ...own, widthMm: 70, file: own } });
    return { untouched: file.size === blob.size, redrawn: edited.size !== blob.size };
  });
  expect(same).toEqual({ untouched: true, redrawn: true });
});
