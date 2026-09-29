// PnPLayout (PnPLayout/index.html): piece sizes, quantities, backs and exports.
const fs = require('node:fs');
const { test, expect, download, makeCardImages } = require('./helpers');

const status = (page) => page.locator('#status');
const rows = (page) => page.locator('#pieceList .piece');

// A plain 63 × 88 mm card image at `dpi`, with the DPI recorded or not.
async function card(page, dpi, { record = true, name = 'Card.png' } = {}) {
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

const pdfPages = (page, file) => page.evaluate(async (bytes) => (await PDFLib.PDFDocument.load(new Uint8Array(bytes))).getPageCount(), [...fs.readFileSync(file.path)]);

test.beforeEach(async ({ page }) => {
  await page.goto('PnPLayout/index.html');
});

test('a piece is sized from the DPI in its file', async ({ page }) => {
  await page.setInputFiles('#imageInput', await card(page, 600));
  await expect(status(page)).toContainText('1 piece(s)');
  await expect(rows(page).locator('.piece-size')).toContainText('63');
});

test('images without DPI use the default DPI setting', async ({ page }) => {
  await page.fill('#defaultDpi', '150');
  await page.setInputFiles('#imageInput', await card(page, 300, { record: false }));
  await expect(status(page)).toContainText('1 piece(s)');
  const width = await page.evaluate(() => [...state.pieces.values()][0].widthMm);
  expect(width).toBeCloseTo(126, 0); // 744 px at 150 DPI
});

test('the quantity fills more sheets', async ({ page }) => {
  await page.setInputFiles('#imageInput', await card(page, 300));
  await expect(status(page)).toContainText('1 piece(s) on 1 sheet(s)');
  await rows(page).getByLabel('Quantity').fill('12');
  await expect(status(page)).toContainText('12 piece(s) on 2 sheet(s)');
});

test('a piece too large for the page is reported by name', async ({ page }) => {
  await page.setInputFiles('#imageInput', await card(page, 300, { name: 'Board.png' }));
  await expect(status(page)).toContainText('1 piece(s)');
  await page.fill('#pw1__display', '400');
  await expect(status(page)).toContainText('Too large for the printable area: Board');
});

test('removing the last piece empties the layout', async ({ page }) => {
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha, img.opaque]);
  await expect(rows(page)).toHaveCount(2);
  await rows(page).first().getByRole('button', { name: 'Remove piece' }).click();
  await rows(page).first().getByRole('button', { name: 'Remove piece' }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#downloadPdf')).toBeDisabled();
});

test('a back image adds a back page after each front page', async ({ page }) => {
  await page.setInputFiles('#imageInput', await card(page, 300));
  await expect(status(page)).toContainText('1 piece(s) on 1 sheet(s)');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), rows(page).locator('.piece-face.back').click()]);
  await chooser.setFiles(await card(page, 300, { name: 'Back.png' }));
  await expect(rows(page).locator('.piece-face.back img, .piece-face.back canvas')).toHaveCount(1);
  await expect(status(page)).toContainText('back');
  const pdf = await download(page, () => page.click('#downloadPdf'));
  expect(await pdfPages(page, pdf)).toBe(2);
});
