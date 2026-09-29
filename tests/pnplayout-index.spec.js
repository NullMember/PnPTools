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

test.describe('grid mode', () => {
  const setMode = async (page, mode) => {
    await page.selectOption('#packMode', mode);
  };
  // Is something drawn at (x, y) mm on the first sheet (not white paper)?
  const darkAt = (page, x, y) => page.evaluate(({ x, y }) => {
    const c = document.querySelector('#sheetGrid canvas');
    const k = c.width / readSettings().paper.w;
    const [r, g, b] = c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
    return r + g + b < 700;
  }, { x, y });

  test('cards line up in rows and columns, centred on the page', async ({ page }) => {
    await expect(page.locator('#cropMarksGroup')).toBeHidden();
    await setMode(page, 'grid');
    await expect(page.locator('#cropMarksGroup')).toBeVisible();
    await expect(page.locator('#precisionGroup')).toBeHidden();
    await page.setInputFiles('#imageInput', await card(page, 300));
    await rows(page).getByLabel('Quantity').fill('10');
    // A4, 7 mm margins, 2 mm gap: 3 × 3 poker cards.
    await expect(status(page)).toContainText('10 piece(s) on 2 sheet(s)');
    await expect(status(page)).toContainText('3 × 3 per sheet');
    const first = await page.evaluate(() => state.layout.sheets[0].slice(0, 2));
    // (196 − 193) / 2 + 7 + 31.5 across; the card image is 87.98 mm tall.
    expect(first[0].angle).toBe(0);
    expect(first[0].cx).toBeCloseTo(40, 5);
    expect(first[0].cy).toBeCloseTo(58.5, 1);
    expect(first[1].cx - first[0].cx).toBeCloseTo(65, 5); // card + gap
  });

  test('cards turn sideways when that fits more, unless rotation is off', async ({ page }) => {
    await setMode(page, 'grid');
    await page.fill('#paperW__display', '297');
    await page.fill('#paperH__display', '210');
    await page.setInputFiles('#imageInput', await card(page, 300));
    await rows(page).getByLabel('Quantity').fill('9');
    await expect(status(page)).toContainText('3 × 3 per sheet'); // 4 × 2 upright
    expect(await page.evaluate(() => state.layout.sheets[0][0].angle)).toBe(90);
    await rows(page).getByLabel('Allow rotation').uncheck();
    await expect(status(page)).toContainText('4 × 2 per sheet');
  });

  test('crop marks sit in the margin in line with the cuts', async ({ page }) => {
    await setMode(page, 'grid');
    await page.setInputFiles('#imageInput', await card(page, 300));
    await expect(status(page)).toContainText('3 × 3 per sheet');
    // First cut at x = 8.5 mm; the grid starts at y = 14.5 mm, bleed 1 mm, marks 1 mm further out.
    const marks = await page.evaluate(() => cropMarks(state.layout.grid, readSettings().paper, readSettings().bleed));
    expect(marks).toHaveLength(24); // 6 vertical cut lines × 2 + 6 horizontal × 2
    const mark = marks.find(([x1, y1]) => x1 === 8.5 && y1 < 20);
    [8.5, 7.5, 8.5, 12.5].forEach((v, i) => expect(mark[i]).toBeCloseTo(v, 1));
    expect(await darkAt(page, 8.5, 10)).toBe(true);
    await page.uncheck('#cropMarks');
    await expect.poll(() => darkAt(page, 8.5, 10)).toBe(false);
  });

  test('a card too big for the page is reported', async ({ page }) => {
    await setMode(page, 'grid');
    await page.setInputFiles('#imageInput', await card(page, 300, { name: 'Board.png' }));
    await expect(status(page)).toContainText('1 piece(s)');
    await page.fill('#pw1__display', '400');
    await expect(status(page)).toContainText('Too large for the printable area: Board');
  });

  test('exports the grid with back pages', async ({ page }) => {
    await setMode(page, 'grid');
    await page.setInputFiles('#imageInput', await card(page, 300));
    await rows(page).getByLabel('Quantity').fill('10');
    await expect(status(page)).toContainText('on 2 sheet(s)');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), rows(page).locator('.piece-face.back').click()]);
    await chooser.setFiles(await card(page, 300, { name: 'Back.png' }));
    await expect(status(page)).toContainText('2 back page(s)');
    const pdf = await download(page, () => page.click('#downloadPdf'));
    expect(await pdfPages(page, pdf)).toBe(4);
  });
});
