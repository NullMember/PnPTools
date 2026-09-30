// Every tool that makes images or printable sheets exports PDF, PNG or JPEG.
const fs = require('node:fs');
const { test, expect, download, makeCardImages } = require('./helpers');

const bytesOf = (file) => [...fs.readFileSync(file.path)];
// Pages of a PDF made by PnP.imagesToPdf (uncompressed, so readable).
const pdfPages = (file) => (fs.readFileSync(file.path, 'latin1').match(/\/Type \/Page\b/g) || []).length;
const mediaBoxes = (file) => [...fs.readFileSync(file.path, 'latin1').matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [+m[1], +m[2]]);
const imageInfo = (page, file) => page.evaluate(async (b) => {
  const blob = new Blob([new Uint8Array(b)]);
  const bmp = await createImageBitmap(blob);
  return { w: bmp.width, h: bmp.height, dpi: await PnP.readImageDpi(blob) };
}, bytesOf(file));

test.describe('card images', () => {
  test('Bleed: all cards as one PDF, a page each at the card size with bleed', async ({ page }) => {
    await page.goto('PnPBleed/index.html');
    const img = await makeCardImages(page);
    await page.setInputFiles('#imageInput', [img.alpha, img.opaque]);
    await expect(page.locator('#downloadAllBtn')).toBeEnabled();
    await page.selectOption('#exportFormat', 'pdf');
    const pdf = await download(page, () => page.click('#downloadAllBtn'));
    expect(pdf.name).toBe('cards-with-bleed.pdf');
    expect(fs.readFileSync(pdf.path, 'latin1').startsWith('%PDF')).toBe(true);
    expect(pdfPages(pdf)).toBe(2);
    // 63 × 88 mm plus 2 × 2 mm of bleed, in points.
    mediaBoxes(pdf).forEach(([w, h]) => {
      expect(w).toBeCloseTo((67 / 25.4) * 72, 0);
      expect(h).toBeCloseTo((92 / 25.4) * 72, 0);
    });
  });

  test('Bleed: one card as JPEG', async ({ page }) => {
    await page.goto('PnPBleed/index.html');
    const img = await makeCardImages(page);
    await page.setInputFiles('#imageInput', [img.opaque]);
    await expect(page.locator('#downloadBtn')).toBeEnabled();
    await page.selectOption('#exportFormat', 'jpeg');
    const jpg = await download(page, () => page.click('#downloadBtn'));
    expect(jpg.name).toBe('Plain_bleed.jpg');
    expect(fs.readFileSync(jpg.path).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  test('Align: all cards as a PDF', async ({ page }) => {
    await page.goto('PnPAlign/index.html');
    const img = await makeCardImages(page);
    await page.setInputFiles('#fileInput', [img.opaque, img.alpha]);
    await expect(page.locator('#downloadAllZipBtn')).toBeEnabled();
    await page.selectOption('#exportFormat', 'application/pdf');
    const pdf = await download(page, () => page.click('#downloadAllZipBtn'));
    expect(pdf.name).toBe('aligned_cards.pdf');
    expect(pdfPages(pdf)).toBe(2);
  });

  test('CardCrop: cropped cards as a PDF, a page per card', async ({ page }) => {
    await page.goto('PnPCardCrop/index.html');
    const img = await makeCardImages(page);
    await page.setInputFiles('#pdfFile', img.opaque);
    await expect(page.locator('#pdfFileName')).toContainText('Plain.png');
    await page.fill('#rows', '1');
    await page.fill('#columns', '1');
    await page.click('#page_no_back');
    await page.selectOption('#outputFormat', 'pdf');
    await page.getByRole('button', { name: 'Crop cards' }).click();
    await expect(page.getByText('✓ Done!')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#downloadLink')).toContainText('(PDF)');
    const pdf = await download(page, () => page.click('#downloadLink'));
    expect(pdf.name).toBe('Plain_cards.pdf');
    expect(pdfPages(pdf)).toBe(1);
    const [[w, h]] = mediaBoxes(pdf);
    expect(w).toBeCloseTo((63 / 25.4) * 72, 0); // the card size
    expect(h).toBeCloseTo((88 / 25.4) * 72, 0);
  });
});

test.describe('printable sheets', () => {
  test('Layout: a sheet as a PNG at 300 DPI', async ({ page }) => {
    await page.goto('PnPLayout/index.html');
    const img = await makeCardImages(page);
    await page.setInputFiles('#imageInput', [img.alpha]);
    await expect(page.locator('#status')).toContainText('1 piece(s) on 1 sheet(s)');
    await page.selectOption('#exportFormat', 'png');
    const png = await download(page, () => page.click('#downloadPdf'));
    expect(png.name).toBe('Sticker_layout.png');
    const info = await imageInfo(page, png);
    expect(info.w).toBe(2480); // A4 at 300 DPI
    expect(info.h).toBe(3508);
    expect(Math.round(info.dpi)).toBe(300);
  });

  test('TuckBox: the box sheets as JPEG', async ({ page }) => {
    await page.goto('PnPTuckBox/index.html');
    await page.selectOption('#exportFormat', 'jpeg');
    const out = await download(page, () => page.click('#downloadPdf'));
    expect(out.name).toMatch(/\.(jpg|zip)$/);
    const head = fs.readFileSync(out.path).subarray(0, 2);
    expect(head.equals(Buffer.from([0xff, 0xd8])) || head.equals(Buffer.from('PK'))).toBe(true);
  });

  test('Booklet: several sheet sides as PNGs in a zip', async ({ page }) => {
    await page.goto('PnPBooklet/index.html');
    const img = await makeCardImages(page);
    await page.setInputFiles('#fileInput', [img.alpha, img.opaque, img.alpha, img.opaque]);
    await expect(page.locator('#downloadBtn')).toBeEnabled();
    await page.selectOption('#exportFormat', 'png');
    const zip = await download(page, () => page.click('#downloadBtn'));
    expect(zip.name).toMatch(/\.zip$/);
    const names = [...new Set([...fs.readFileSync(zip.path).toString('latin1').matchAll(/[\w -]+\.png/g)].map((m) => m[0]))];
    expect(names.length).toBe(2); // 4 pages, 2 to a sheet
  });
});
