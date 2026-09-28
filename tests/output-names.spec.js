// Output file names follow the input files: one source keeps its name (with
// a suffix), outputs made from several files take the project name.
const fs = require('node:fs');
const { test, expect, download, makeCardImages } = require('./helpers');

const setProjectName = (page, name) => page.fill('.pnp-project-name', name);
// Stored (uncompressed) zip entries: the names are readable in the bytes.
const zipNames = (file) => [...fs.readFileSync(file.path).toString('latin1').matchAll(/[\w -]+\.(?:png|jpg|svg)/g)].map((m) => m[0]);

test('Bleed keeps each card\'s name, and names the zip after the project', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha, img.opaque]);
  await expect(page.locator('#downloadAllBtn')).toBeEnabled();

  const one = await download(page, () => page.click('#downloadBtn'));
  expect(one.name).toMatch(/^(Sticker|Plain)_bleed\.png$/);

  const all = await download(page, () => page.click('#downloadAllBtn'));
  expect(all.name).toBe('cards-with-bleed.zip');
  expect(zipNames(all)).toEqual(expect.arrayContaining(['Sticker_bleed.png', 'Plain_bleed.png']));

  await setProjectName(page, 'My Deck');
  const named = await download(page, () => page.click('#downloadAllBtn'));
  expect(named.name).toBe('My Deck_bleed.zip');
});

test('Bleed names a single card\'s zip after that card', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.opaque]);
  await expect(page.locator('#downloadAllBtn')).toBeEnabled();
  await setProjectName(page, 'My Deck');
  const all = await download(page, () => page.click('#downloadAllBtn'));
  expect(all.name).toBe('Plain_bleed.zip');
});

test('Align names the zip after the project', async ({ page }) => {
  await page.goto('PnPAlign/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#fileInput', [img.opaque, img.alpha]);
  await expect(page.locator('#downloadAllZipBtn')).toBeEnabled();
  await setProjectName(page, 'Deck');
  const zip = await download(page, () => page.click('#downloadAllZipBtn'));
  expect(zip.name).toBe('Deck_aligned.zip');
  expect(zipNames(zip)).toEqual(expect.arrayContaining(['Plain_aligned.png', 'Sticker_aligned.png']));
});

test('CardCrop names cropped cards after the sheet they came from', async ({ page }) => {
  await page.goto('PnPCardCrop/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#pdfFile', img.opaque);
  await expect(page.locator('#pdfFileName')).toContainText('Plain.png');
  await page.fill('#rows', '1');
  await page.fill('#columns', '1');
  await page.click('#page_no_back');
  await page.getByRole('button', { name: 'Crop cards' }).click();
  await expect(page.getByText('✓ Done!')).toBeVisible({ timeout: 15000 });
  const zip = await download(page, () => page.click('#downloadLink'));
  expect(zip.name).toBe('Plain_cards.zip');
  expect(zipNames(zip)).toContain('Plain_card_0000.png');
});

test('TuckBox names its files after the project', async ({ page }) => {
  await page.goto('PnPTuckBox/index.html');
  await setProjectName(page, 'Dragons');
  const svg = await download(page, () => page.click('#downloadSvg'));
  expect(svg.name).toBe('Dragons_box-cut.svg');
});

test('Booklet names the PDF after its source file', async ({ page }) => {
  await page.goto('PnPBooklet/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#fileInput', [img.opaque]);
  await expect(page.locator('#downloadBtn')).toBeEnabled();
  const pdf = await download(page, () => page.click('#downloadBtn'));
  expect(pdf.name).toMatch(/^Plain_(sheets|booklet)\.pdf$/);
});

test('Layout names the PDF after its piece, or the project', async ({ page }) => {
  await page.goto('PnPLayout/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.opaque]);
  // The packer runs in a worker: download once the sheets are laid out.
  await expect(page.getByText('1 piece(s) on 1 sheet(s)')).toBeVisible();
  const one = await download(page, () => page.click('#downloadPdf'));
  expect(one.name).toBe('Plain_layout.pdf');
  await page.setInputFiles('#imageInput', [img.alpha]);
  await expect(page.getByText('2 piece(s) on 1 sheet(s)')).toBeVisible();
  await setProjectName(page, 'Tokens');
  const two = await download(page, () => page.click('#downloadPdf'));
  expect(two.name).toBe('Tokens_layout.pdf');
});
