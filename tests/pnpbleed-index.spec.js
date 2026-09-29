// PnPBleed (PnPBleed/index.html): loading, removing and exporting cards.
const fs = require('node:fs');
const { test, expect, download, makeCardImages } = require('./helpers');

const thumbs = (page) => page.locator('#thumbnailsContainer .thumbnail');
// Stored zip entry names are readable in the bytes (twice: local header and directory).
const zipNames = (file) => [...new Set([...fs.readFileSync(file.path).toString('latin1').matchAll(/[\w -]+\.png/g)].map((m) => m[0]))];
const broken = { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') };

test.beforeEach(async ({ page }) => {
  await page.goto('PnPBleed/index.html');
});

test('adding more images keeps the cards already loaded', async ({ page }) => {
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha]);
  await expect(thumbs(page)).toHaveCount(1);
  await page.setInputFiles('#imageInput', [img.opaque]);
  await expect(thumbs(page)).toHaveCount(2);
  await expect(thumbs(page).nth(1)).toHaveClass(/active/); // the new card is shown
});

test('an unreadable file is reported and nothing is lost', async ({ page }) => {
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha, img.opaque]);
  await expect(thumbs(page)).toHaveCount(2);
  await page.setInputFiles('#imageInput', [broken]);
  await expect(page.locator('#status')).toContainText('Could not read broken.png');
  await expect(thumbs(page)).toHaveCount(2);
  const zip = await download(page, () => page.click('#downloadAllBtn'));
  expect(zipNames(zip).sort()).toEqual(['Plain_bleed.png', 'Sticker_bleed.png']);
});

test('cards can be removed one by one', async ({ page }) => {
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha, img.opaque]);
  await expect(thumbs(page)).toHaveCount(2);
  await thumbs(page).first().hover();
  await thumbs(page).first().getByRole('button', { name: 'Remove Sticker.png' }).click();
  await expect(thumbs(page)).toHaveCount(1);
  await expect(thumbs(page).first()).toHaveAttribute('title', 'Plain.png');
  const zip = await download(page, () => page.click('#downloadAllBtn'));
  expect(zipNames(zip)).toEqual(['Plain_bleed.png']);

  await thumbs(page).first().hover();
  await thumbs(page).first().getByRole('button', { name: 'Remove Plain.png' }).click();
  await expect(thumbs(page)).toHaveCount(0);
  await expect(page.locator('#thumbnailsContainer .empty-state')).toBeVisible();
  await expect(page.locator('#downloadAllBtn')).toBeDisabled();
  await expect(page.locator('#downloadBtn')).toBeDisabled();
});

test('opening a project replaces the cards', async ({ page }) => {
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha]);
  await expect(thumbs(page)).toHaveCount(1);
  const saved = await download(page, () => page.locator('.pnp-topbar').getByRole('button', { name: 'Save', exact: true }).click());
  await page.setInputFiles('#imageInput', [img.opaque]);
  await expect(thumbs(page)).toHaveCount(2);
  await page.evaluate(async (bytes) => {
    await PnP.project.load(new File([new Uint8Array(bytes)], 'cards.pnp'));
  }, [...fs.readFileSync(saved.path)]);
  await expect(thumbs(page)).toHaveCount(1);
  await expect(thumbs(page).first()).toHaveAttribute('title', 'Sticker.png');
});

// A round token (transparent around a 40 mm disc) at 300 DPI, DPI recorded.
async function token(page, name = 'Token.png') {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 472; // 40 mm at 300 DPI
    const g = c.getContext('2d');
    g.fillStyle = '#22aa44';
    g.beginPath(); g.arc(236, 236, 236, 0, Math.PI * 2); g.fill();
    const blob = await PnP.setImageDpi(await PnP.canvasToBlob(c), 300);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  });
  return { name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

test('"Follow the shape" puts bleed around a transparent shape, by its DPI', async ({ page }) => {
  await page.selectOption('#bleedMode', 'shape');
  await page.fill('#bleedInput__display', '2');
  await page.setInputFiles('#imageInput', [await token(page)]);
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  const out = await download(page, () => page.click('#downloadBtn'));
  const info = await page.evaluate(async (bytes) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const px = (x, y) => [...g.getImageData(x, y, 1, 1).data];
    const mid = bmp.width / 2;
    return {
      size: bmp.width,
      corner: px(2, 2)[3], // far outside the disc: still transparent
      ring: px(Math.round(mid), 10), // inside the bleed ring above the disc
      note: await PnP.readPngText(blob, 'PnPTools:bleed'),
    };
  }, [...fs.readFileSync(out.path)]);
  expect(info.size).toBe(472 + 2 * 24); // 2 mm at 300 DPI = 24 px each side
  expect(info.corner).toBe(0);
  expect(info.ring).toEqual([34, 170, 68, 255]); // the disc's colour, opaque
  expect(parseFloat(info.note)).toBeCloseTo(2, 1);
});

test('card outputs record the bleed they were given', async ({ page }) => {
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.opaque]);
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  const out = await download(page, () => page.click('#downloadBtn'));
  const note = await page.evaluate((bytes) => PnP.readPngText(new Blob([new Uint8Array(bytes)]), 'PnPTools:bleed'), [...fs.readFileSync(out.path)]);
  expect(parseFloat(note)).toBeCloseTo(2, 1); // the default 2 mm
});

test('a removed edge becomes bleed: mirror reflects the kept card by bleed + removed', async ({ page }) => {
  // 100 × 100 px "card" of 10 px vertical stripes, coloured by column; a 1 px white
  // border on the left. Card size 100 × 100 mm makes 1 px = 1 mm.
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 100;
    const g = c.getContext('2d');
    for (let x = 0; x < 100; x++) { g.fillStyle = `rgb(${x * 2}, 50, 100)`; g.fillRect(x, 0, 1, 100); }
    g.fillStyle = '#fff'; g.fillRect(0, 0, 1, 100);
    const bytes = new Uint8Array(await (await PnP.canvasToBlob(c)).arrayBuffer());
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  });
  await page.fill('#cardWidthInput__display', '100');
  await page.fill('#cardHeightInput__display', '100');
  await page.fill('#bleedInput__display', '2');
  await page.selectOption('#bleedMode', 'mirror');
  await page.check('#removeLeftSideInput');
  await page.fill('#leftSideWidthInput__display', '1');
  await page.setInputFiles('#imageInput', { name: 'Stripes.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  const out = await download(page, () => page.click('#downloadBtn'));
  const row = await page.evaluate(async (bytes) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 50, bmp.width, 1).data;
    const reds = [];
    for (let x = 0; x < 6; x++) reds.push(d[x * 4]);
    return { width: bmp.width, reds };
  }, [...fs.readFileSync(out.path)]);
  expect(row.width).toBe(104); // image + 2 × 2 px bleed; the trim line stays at the image edge
  // Kept card starts at image column 1 (output x = 3). The 3 px to its left mirror
  // columns 3, 2, 1: no white, nothing smeared.
  expect(row.reds).toEqual([6, 4, 2, 2, 4, 6]);

  // Extend: the kept card's first column carries on over the removed strip too.
  await page.selectOption('#bleedMode', 'extend');
  const extended = await download(page, () => page.click('#downloadBtn'));
  const reds = await page.evaluate(async (bytes) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return [0, 1, 2, 3, 4].map((x) => g.getImageData(x, 50, 1, 1).data[0]);
  }, [...fs.readFileSync(extended.path)]);
  expect(reds).toEqual([2, 2, 2, 2, 4]);
});
