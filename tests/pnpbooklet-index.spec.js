// PnPBooklet (PnPBooklet/index.html): PDF pages, preview and export.
const fs = require('node:fs');
const { test, expect, download } = require('./helpers');

// A PDF of `n` card-sized pages, each filled with a colour, made in the page.
async function makePdf(page, n) {
  const b64 = await page.evaluate((n) => {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: [63, 88] });
    for (let i = 0; i < n; i++) {
      if (i) pdf.addPage([63, 88]);
      pdf.setFillColor(40, 80 + i * 5, 200);
      pdf.rect(0, 0, 63, 88, 'F');
      pdf.setFontSize(40);
      pdf.text(String(i + 1), 20, 50);
    }
    return pdf.output('datauristring').split(',')[1];
  }, n);
  return { name: 'Rules.pdf', mimeType: 'application/pdf', buffer: Buffer.from(b64, 'base64') };
}

const thumbs = (page) => page.locator('#pageThumbs .page-thumb');
const sideLabel = (page) => page.locator('.preview-nav span');

test.beforeEach(async ({ page }) => {
  await page.goto('PnPBooklet/index.html');
});

test('a long PDF keeps only small thumbnails in memory', async ({ page }) => {
  await page.setInputFiles('#fileInput', await makePdf(page, 20));
  await expect(thumbs(page)).toHaveCount(20);
  const stored = await page.evaluate(() => state.pages.reduce((n, p) => n + p.thumb.width * p.thumb.height + (p.canvas ? p.canvas.width * p.canvas.height : 0), 0));
  expect(stored).toBeLessThanOrEqual(20 * 160 * 160);
});

test('the preview draws the pages of the side shown, and pages through', async ({ page }) => {
  await page.setInputFiles('#fileInput', await makePdf(page, 20));
  await expect(sideLabel(page)).toContainText('1 of 10'); // two pages to a sheet by default
  // Middle of the first cell is the page's colour, not the white sheet.
  const colourAt = () => page.evaluate(() => {
    const c = document.querySelector('.preview-page canvas');
    const cfg = readConfig();
    const geo = gridGeometry(cfg);
    const k = c.width / cfg.sheetW;
    const [r, g, b] = c.getContext('2d').getImageData(Math.round((geo.cellX(0) + 5) * k), Math.round((geo.cellY(0) + 5) * k), 1, 1).data;
    return [r, g, b];
  });
  expect(await colourAt()).not.toEqual([255, 255, 255]);

  for (let i = 2; i <= 10; i++) {
    await page.getByRole('button', { name: 'Next side' }).click();
    await expect(sideLabel(page)).toContainText(`${i} of 10`);
  }
  expect(await colourAt()).not.toEqual([255, 255, 255]);
  expect(await page.evaluate(() => renderCache.size)).toBeLessThanOrEqual(12);
});

test('rotating a page turns its thumbnail', async ({ page }) => {
  await page.setInputFiles('#fileInput', await makePdf(page, 2));
  await expect(thumbs(page)).toHaveCount(2);
  await thumbs(page).first().hover();
  await page.getByRole('button', { name: 'Rotate page 1' }).click();
  const size = await page.evaluate(() => { const t = thumbSource(state.pages[0]); return [t.width, t.height]; });
  expect(size[0]).toBeGreaterThan(size[1]); // a portrait page lying on its side
});

test('exports a PDF with one page per sheet side', async ({ page }) => {
  await page.setInputFiles('#fileInput', await makePdf(page, 6));
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  const pdf = await download(page, () => page.click('#downloadBtn'));
  expect(pdf.name).toBe('Rules_sheets.pdf');
  const text = fs.readFileSync(pdf.path, 'latin1');
  expect(text.startsWith('%PDF')).toBe(true);
  expect((text.match(/\/Type \/Page\b/g) || []).length).toBe(3); // 6 pages, 2 per side
});

test('pages use paper sizes, and card sheets go to Layout', async ({ page }) => {
  await expect(page.locator('#pagePreset')).toHaveValue('a5');
  await expect(page.locator('#pagePreset option', { hasText: 'Poker' })).toHaveCount(0);
  await expect(page.locator('#sendSlot').getByRole('button', { name: /Layout/ })).toBeVisible();
});
