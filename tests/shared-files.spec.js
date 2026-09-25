// Shared runtime: top-bar project buttons and the Inputs & outputs viewer,
// which records files loaded into and produced by every tool.
const { test, expect, download, makeCardImages } = require('./helpers');

const topBar = (page) => page.locator('.pnp-topbar');
const filesButton = (page) => page.locator('.pnp-outputs-btn');
const popover = (page) => page.locator('.pnp-outputs .pnp-popover');

async function openFiles(page) {
  await filesButton(page).click();
  await expect(popover(page)).toBeVisible();
}

test('the card editor has New, Open and Save in the top bar', async ({ page }) => {
  await page.goto('PnPCut/editor.html');
  for (const name of ['New', 'Open', 'Save']) {
    await expect(topBar(page).getByRole('button', { name, exact: true })).toBeVisible();
  }
});

test('every tool with projects has a New button', async ({ page }) => {
  for (const path of ['PnPCardCrop/index.html', 'PnPBleed/index.html', 'PnPCut/sheet.html', 'PnPTuckBox/index.html']) {
    await page.goto(path);
    await expect(topBar(page).getByRole('button', { name: 'New', exact: true })).toBeVisible();
  }
});

test('card editor .pnp project keeps cards, images and shapes', async ({ page }) => {
  await page.goto('PnPCut/editor.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#cardImageInput', [img.alpha, img.opaque]);
  await expect(page.locator('.card-item')).toHaveCount(2);
  await page.fill('#cardW__display', '70'); // the visible mm/in field
  await page.press('#cardW__display', 'Tab');
  await page.click('#alphaTraceBtn');
  await expect(page.locator('#canvasSvg .shape-el')).toHaveCount(2);

  const saved = await download(page, () => topBar(page).getByRole('button', { name: 'Save', exact: true }).click());
  expect(saved.name).toMatch(/^PnPCut-cards-.*\.pnp$/);

  await page.goto('PnPCut/editor.html');
  await page.fill('#cardW__display', '63');
  await page.press('#cardW__display', 'Tab');
  await page.evaluate(async (bytes) => {
    await PnP.project.load(new File([new Uint8Array(bytes)], 'cards.pnp'));
  }, [...require('node:fs').readFileSync(saved.path)]);
  await expect(page.locator('.card-label')).toHaveText(['Sticker', 'Plain']);
  await expect(page.locator('#cardW')).toHaveValue('70');
  await expect(page.locator('#canvasSvg .shape-el')).toHaveCount(2);
  await expect(page.locator('#canvasSvg')).toHaveClass(/has-alpha/);
  await page.locator('.card-item').nth(1).click();
  await expect(page.locator('#canvasSvg image')).toHaveAttribute('href', /^data:image\/png/);
});

test('New starts an empty project, after confirming unsaved work', async ({ page }) => {
  await page.goto('PnPCut/editor.html');
  await page.click('#addCardBtn');
  await page.click('#addTemplateBtn');
  let asked = false;
  page.removeAllListeners('dialog');
  page.on('dialog', (d) => { asked = true; d.accept(); });
  await Promise.all([
    page.waitForEvent('load'),
    topBar(page).getByRole('button', { name: 'New', exact: true }).click(),
  ]);
  expect(asked).toBe(true);
  await expect(page.locator('.card-item')).toHaveCount(1);
  await expect(page.locator('#canvasSvg .shape-el')).toHaveCount(0);
});

test('New clears this page\'s Inputs & outputs, not other tools\'', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha]);
  await openFiles(page); // recorded before leaving the page
  await expect(popover(page).locator('.pnp-popover-row')).toHaveCount(1);
  await page.goto('PnPCut/editor.html');
  await page.setInputFiles('#cardImageInput', [img.opaque]);
  await page.click('#addTemplateBtn');
  await download(page, () => page.click('#exportAllBtn'));
  await expect(async () => { // the download is recorded asynchronously
    await page.keyboard.press('Escape');
    await openFiles(page);
    await expect(popover(page).locator('.pnp-popover-row')).toHaveCount(3, { timeout: 500 });
  }).toPass();
  await page.keyboard.press('Escape');

  await Promise.all([
    page.waitForEvent('load'),
    topBar(page).getByRole('button', { name: 'New', exact: true }).click(),
  ]);
  await openFiles(page);
  const rows = popover(page).locator('.pnp-popover-row');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('loaded in Bleed');
});

test('files dropped into a tool are listed as its inputs', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha, img.opaque]);
  await openFiles(page);
  const inputs = popover(page).locator('.pnp-popover-row[data-kind="input"]');
  await expect(inputs).toHaveCount(1);
  await expect(inputs).toContainText('2 images loaded in Bleed');

  // The set opens in the viewer, and other tools can import it.
  await inputs.locator('.pnp-popover-item').click();
  await expect(page.locator('.pnp-viewer')).toBeVisible();
  await expect(page.locator('.pnp-viewer-thumb')).toHaveCount(2);
  await expect(page.locator('.pnp-viewer-img')).toBeVisible();
  await page.keyboard.press('Escape');

  // Another tool's drop area can load them from the list.
  await page.goto('PnPLayout/index.html');
  await page.locator('#dropZone .pnp-pick-btn').click();
  const picker = page.locator('#dropZone .pnp-popover');
  await expect(picker.locator('.pnp-popover-row')).toHaveCount(1);
  await picker.locator('.pnp-popover-item').click();
  await expect(page.getByText('Loaded 2 file(s) from Bleed.')).toBeVisible();
});

test('pickers only offer sets with files the input accepts', async ({ page }) => {
  await page.goto('PnPCut/editor.html');
  await page.click('#addTemplateBtn');
  await download(page, () => page.click('#exportAllBtn')); // an SVG output
  await page.locator('#projectDrop .pnp-pick-btn').click(); // wants .json
  await expect(page.locator('#projectDrop .pnp-popover-row')).toHaveCount(0);
  await expect(page.locator('#projectDrop .pnp-popover-empty')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.click('#addCardBtn');
  await page.locator('#importSvgDrop .pnp-pick-btn').click(); // wants .svg
  await page.locator('#importSvgDrop .pnp-popover-item').click();
  await expect(page.locator('#canvasSvg .shape-el')).toHaveCount(1);
  await expect(page.locator('.import-file')).toHaveCount(1);
});

test('a card row can take its image from the list', async ({ page }) => {
  await page.goto('PnPCut/editor.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#cardImageInput', [img.alpha]);
  await page.click('#addCardBtn');
  const row = page.locator('.card-item').nth(1);
  await row.getByRole('button', { name: 'Set reference image…' }).click();
  const pop = page.locator('.pnp-popover-floating:visible');
  await expect(pop.locator('.pnp-popover-browse')).toBeVisible();
  await pop.locator('.pnp-popover-row[data-kind="input"] .pnp-popover-item').click();
  await expect(page.locator('#canvasSvg')).toHaveClass(/has-alpha/);
  await expect(row.getByRole('button', { name: 'Hide reference image' })).toBeVisible();
});

test('crop cards records the cropped cards as output without Send to', async ({ page }) => {
  await page.goto('PnPCardCrop/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#pdfFile', img.opaque);
  await expect(page.locator('#pdfFileName')).toContainText('Plain.png');
  await page.fill('#rows', '1');
  await page.fill('#columns', '1');
  await page.getByRole('button', { name: 'Crop cards' }).click();
  await expect(page.getByText('✓ Done!')).toBeVisible({ timeout: 15000 });

  await openFiles(page);
  const outputs = popover(page).locator('.pnp-popover-row[data-kind="output"]');
  await expect(outputs).toHaveCount(1);
  await expect(outputs).toContainText('from CardCrop');
  await expect(popover(page).locator('.pnp-popover-row[data-kind="input"]')).toContainText('1 image loaded in CardCrop');
});

test('downloads are recorded; zips are unpacked for preview', async ({ page }) => {
  await page.goto('PnPCut/editor.html');
  await page.click('#addTemplateBtn');
  await page.click('#addCardBtn');
  await page.click('#addTemplateBtn');
  await download(page, () => page.click('#exportCardsBtn'));
  await openFiles(page);
  const outputs = popover(page).locator('.pnp-popover-row[data-kind="output"]');
  await expect(outputs).toContainText('2 images from Cut');
  await outputs.locator('.pnp-popover-item').click();
  await expect(page.locator('.pnp-viewer-thumb')).toHaveCount(2);
  await expect(page.locator('.pnp-viewer-img')).toHaveAttribute('src', /^blob:/);
});

test('PDF outputs open in the viewer; project saves are not recorded', async ({ page }) => {
  await page.goto('PnPTuckBox/index.html');
  const pdfButton = page.getByRole('button', { name: /PDF/ }).first();
  await download(page, () => pdfButton.click());
  await download(page, () => topBar(page).getByRole('button', { name: 'Save', exact: true }).click());
  await openFiles(page);
  const rows = popover(page).locator('.pnp-popover-row');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('1 file from TuckBox');
  await rows.locator('.pnp-popover-item').click();
  await expect(page.locator('.pnp-viewer-doc')).toBeVisible();
  await expect(page.locator('.pnp-viewer-img')).toBeHidden();
});

test('the same files are listed once, and rows can be removed', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha]);
  await page.setInputFiles('#imageInput', [img.alpha]);
  await openFiles(page);
  await expect(popover(page).locator('.pnp-popover-row')).toHaveCount(1);
  await popover(page).locator('.pnp-popover-remove').click();
  await expect(popover(page).locator('.pnp-popover-row')).toHaveCount(0);
  await expect(popover(page).locator('.pnp-popover-empty')).toBeVisible();
});
