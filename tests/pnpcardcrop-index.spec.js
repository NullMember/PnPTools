// PnPCardCrop grid crop (PnPCardCrop/index.html).
const { test, expect, makeCardImages, trackRevokedUrls, revokedUrls } = require('./helpers');

async function crop(page) {
  await page.getByRole('button', { name: 'Crop cards' }).click();
  await expect(page.getByText('✓ Done!')).toBeVisible({ timeout: 15000 });
}

test('cropping again releases the previous result zip', async ({ page }) => {
  await trackRevokedUrls(page);
  await page.goto('PnPCardCrop/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#pdfFile', img.opaque);
  await expect(page.locator('#pdfFileName')).toContainText('Plain.png');
  await page.fill('#rows', '1');
  await page.fill('#columns', '1');
  await page.click('#page_no_back');

  await crop(page);
  const first = await page.locator('#downloadLink').getAttribute('href');
  expect(first).toMatch(/^blob:/);
  const zip = await page.evaluate((u) => fetch(u).then((r) => r.blob()).then((b) => b.size), first);
  expect(zip).toBeGreaterThan(100);

  await page.getByText('✓ Done!').evaluate((el) => { el.textContent = ''; });
  await crop(page);
  const second = await page.locator('#downloadLink').getAttribute('href');
  expect(second).not.toBe(first);
  const revoked = await revokedUrls(page);
  expect(revoked).toContain(first);       // the old zip is released…
  expect(revoked).not.toContain(second);  // …the new one still downloads
});
