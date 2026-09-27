// PnPAlign (PnPAlign/index.html).
const { test, expect, makeCardImages, trackRevokedUrls, revokedUrls } = require('./helpers');

test('dragging a colour slider updates the preview (redrawn once per frame)', async ({ page }) => {
  await page.goto('PnPAlign/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#fileInput', [img.opaque, img.alpha]);
  const after = page.locator('#afterCanvas');
  await expect.poll(() => after.evaluate((c) => c.width)).toBeGreaterThan(0);
  // Colour edits apply once auto colour has run (it turns them on).
  await page.click('#autoColorBtn');
  await expect(page.locator('#colorEnabled')).toBeEnabled();
  const before = await after.evaluate((c) => c.toDataURL());

  const b = await page.locator('#brightness').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(b.x + b.width / 2 + i * (b.width / 45), b.y + b.height / 2);
  await page.mouse.up();

  await expect(page.locator('#brightnessOut')).not.toHaveText('0');
  await expect.poll(() => after.evaluate((c) => c.toDataURL())).not.toBe(before);
});

test('removing a card releases its image', async ({ page }) => {
  await trackRevokedUrls(page);
  await page.goto('PnPAlign/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#fileInput', [img.opaque, img.alpha]);
  await expect(page.locator('.card-thumb')).toHaveCount(2);
  const url = await page.locator('.card-thumb img').first().getAttribute('src');
  expect(url).toMatch(/^blob:/);
  await page.locator('.card-thumb').first().getByTitle('Remove card').click();
  await expect(page.locator('.card-thumb')).toHaveCount(1);
  expect(await revokedUrls(page)).toContain(url);
});
