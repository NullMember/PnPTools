// PnPCut grid tool (PnPCut/index.html).
const { test, expect, download, expectSvgSizeInInches } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await page.goto('PnPCut/index.html');
});

test('the cut grid SVG is sized in inches (for Design Space)', async ({ page }) => {
  const svg = await download(page, () => page.click('#downloadBtn'));
  expect(svg.name).toBe('card-grid_63x88mm_2x3.svg');
  // A4 minus Cricut's 6.35 mm dead margin on each side.
  expectSvgSizeInInches(svg.text(), 210 - 2 * 6.35, 297 - 2 * 6.35);
  expect((svg.text().match(/<rect /g) || []).length).toBe(7); // guide + 6 cards
});

test('the registration test sheet is sized in inches', async ({ page }) => {
  const svg = await download(page, () => page.click('#registrationTestBtn'));
  expectSvgSizeInInches(svg.text(), 210 - 2 * 6.35, 297 - 2 * 6.35);
});
