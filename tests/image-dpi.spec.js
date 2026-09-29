// Image outputs carry their DPI, so the next tool (and other apps) print
// them at the right physical size.
const fs = require('node:fs');
const { test, expect, download } = require('./helpers');

// A plain card scan: 63 × 88 mm at `dpi`, optionally with the DPI recorded.
async function cardScan(page, dpi, { record = true, name = 'Scan.png' } = {}) {
  const b64 = await page.evaluate(async ({ dpi, record }) => {
    const c = document.createElement('canvas');
    c.width = Math.round(63 / 25.4 * dpi);
    c.height = Math.round(88 / 25.4 * dpi);
    const g = c.getContext('2d');
    g.fillStyle = '#3366cc';
    g.fillRect(0, 0, c.width, c.height);
    let blob = await PnP.canvasToBlob(c);
    if (record) blob = await PnP.setImageDpi(blob, dpi);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  }, { dpi, record });
  return { name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

const dpiOf = (page, file) => page.evaluate(async (bytes) => PnP.readImageDpi(new Blob([new Uint8Array(bytes)])), [...fs.readFileSync(file.path)]);

test('setImageDpi stamps PNG and JPEG, and replaces an existing PNG DPI', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const dpis = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 10;
    const png = await PnP.setImageDpi(await PnP.canvasToBlob(c), 288);
    const again = await PnP.setImageDpi(png, 150);
    const jpg = await PnP.setImageDpi(await PnP.canvasToBlob(c, 'image/jpeg', 0.9), 600);
    const read = (b) => PnP.readImageDpi(b);
    const bmp = await createImageBitmap(again); // still a valid PNG
    return [Math.round(await read(png)), Math.round(await read(again)), await read(jpg), bmp.width];
  });
  expect(dpis).toEqual([288, 150, 600, 10]);
});

test('CardCrop cards keep their size in Layout', async ({ page }) => {
  await page.goto('PnPCardCrop/index.html');
  const scan = await cardScan(page, 300, { record: false });
  await page.fill('#imageDpi', '300');
  await page.setInputFiles('#pdfFile', scan);
  await page.fill('#rows', '1');
  await page.fill('#columns', '1');
  await page.click('#page_no_back');
  await page.getByRole('button', { name: 'Crop cards' }).click();
  await expect(page.getByText('✓ Done!')).toBeVisible({ timeout: 15000 });
  const card = await page.evaluate(async () => {
    const b = lastCrop.front[0].blob;
    const bytes = new Uint8Array(await b.arrayBuffer());
    let s = '';
    bytes.forEach((x) => { s += String.fromCharCode(x); });
    return { b64: btoa(s), dpi: await PnP.readImageDpi(b), size: await PnP.readSizeNotes(b) };
  });
  expect(Math.round(card.dpi)).toBe(288); // the crop DPI setting
  expect(card.size).toEqual({ widthMm: 63, heightMm: 88 }); // the card size, recorded

  await page.goto('PnPLayout/index.html');
  await page.setInputFiles('#imageInput', { name: 'card.png', mimeType: 'image/png', buffer: Buffer.from(card.b64, 'base64') });
  await expect(page.locator('#status')).toContainText('1 piece(s)');
  const widthMm = await page.evaluate(() => [...state.pieces.values()][0].widthMm);
  expect(widthMm).toBeCloseTo(63, 0);
});

test('Bleed outputs carry the DPI of the card with its bleed', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  await page.setInputFiles('#imageInput', await cardScan(page, 300, { record: false }));
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  const one = await download(page, () => page.click('#downloadBtn'));
  expect(await dpiOf(page, one)).toBeCloseTo(300, 0); // worked out from the 63 × 88 mm card size
});

test('Align outputs keep the scan DPI', async ({ page }) => {
  await page.goto('PnPAlign/index.html');
  await page.setInputFiles('#fileInput', [await cardScan(page, 600, { name: 'A.png' })]);
  await expect(page.locator('#downloadAllZipBtn')).toBeEnabled();
  await page.selectOption('#exportFormat', 'image/jpeg');
  const card = await download(page, () => page.click('#downloadOneBtn'));
  expect(card.name).toBe('A_aligned.jpg');
  expect(await dpiOf(page, card)).toBe(600);
});
