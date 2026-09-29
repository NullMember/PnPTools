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
