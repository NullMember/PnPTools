// The project: one library and every tool page's work, kept in the browser
// as the user works, and saved to or opened from a single .pnp file.
const fs = require('node:fs');
const { test, expect, download, makeCardImages } = require('./helpers');

const topBar = (page) => page.locator('.pnp-topbar');
// Save the page's work into the project now (instead of waiting for it).
const settle = (page) => page.evaluate(() => PnP.project.autosave());
const bleedCards = (page) => page.locator('#thumbnailsContainer .thumbnail');
const boxImages = (page) => page.locator('#artLibrary .art-tile');

async function withBleedWork(page, img) {
  await page.goto('PnPBleed/index.html');
  await page.setInputFiles('#imageInput', [img.alpha]);
  await expect(bleedCards(page)).toHaveCount(1);
  await settle(page);
}

test('work is kept across a reload', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  await withBleedWork(page, img);
  await page.reload();
  await expect(bleedCards(page)).toHaveCount(1);
  await expect(bleedCards(page).first()).toHaveAttribute('title', 'Sticker.png');
});

test('each tool keeps its own work while you move between tools', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  await withBleedWork(page, img);
  await page.goto('PnPTuckBox/index.html');
  await page.setInputFiles('#artInput', [img.opaque, img.alpha]);
  await expect(boxImages(page)).toHaveCount(2);
  await settle(page);

  await page.goto('PnPBleed/index.html');
  await expect(bleedCards(page)).toHaveCount(1);
  await page.goto('PnPTuckBox/index.html');
  await expect(boxImages(page)).toHaveCount(2);
});

test('a file used by several tools is stored once', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  await withBleedWork(page, img);
  await page.goto('PnPTuckBox/index.html');
  await page.setInputFiles('#artInput', [img.alpha]);
  await expect(boxImages(page)).toHaveCount(1);
  await settle(page);
  const blobs = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('pnptools-project');
    req.onsuccess = () => {
      const r = req.result.transaction('blobs').objectStore('blobs').count();
      r.onsuccess = () => resolve(r.result);
    };
  }));
  expect(blobs).toBe(1);
});

test('Save holds every tool\'s work; New empties it; Open brings it all back', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  await withBleedWork(page, img);
  await page.goto('PnPTuckBox/index.html');
  await page.setInputFiles('#artInput', [img.opaque]);
  await expect(boxImages(page)).toHaveCount(1);
  await page.fill('.pnp-project-name', 'Whole game');
  const saved = await download(page, () => topBar(page).getByRole('button', { name: 'Save', exact: true }).click());
  expect(saved.name).toBe('Whole game.pnp');

  await Promise.all([page.waitForEvent('load'), topBar(page).getByRole('button', { name: 'New', exact: true }).click()]);
  await expect(boxImages(page)).toHaveCount(0);
  await expect(page.locator('.pnp-project-name')).toHaveValue('');
  await page.goto('PnPBleed/index.html');
  await expect(bleedCards(page)).toHaveCount(0);

  await page.evaluate(async (bytes) => {
    await PnP.project.load(new File([new Uint8Array(bytes)], 'Whole game.pnp'));
  }, [...fs.readFileSync(saved.path)]);
  await expect(bleedCards(page)).toHaveCount(1);
  await expect(page.locator('.pnp-project-name')).toHaveValue('Whole game');
  await page.goto('PnPTuckBox/index.html');
  await expect(boxImages(page)).toHaveCount(1);
});

test('New asks first only when the project changed since it was saved', async ({ page }) => {
  const asks = async () => {
    let asked = false;
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => { asked = true; d.accept(); });
    await Promise.all([page.waitForEvent('load'), topBar(page).getByRole('button', { name: 'New', exact: true }).click()]);
    return asked;
  };
  await page.goto('PnPBleed/index.html');
  expect(await asks()).toBe(false); // nothing in it
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha]);
  await expect(bleedCards(page)).toHaveCount(1);
  expect(await asks()).toBe(true); // changed, never saved

  await page.setInputFiles('#imageInput', [img.alpha]);
  await expect(bleedCards(page)).toHaveCount(1);
  await download(page, () => topBar(page).getByRole('button', { name: 'Save', exact: true }).click());
  expect(await asks()).toBe(false); // just saved
});

test('a project file from before (one tool\'s work) still opens on its tool', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  const bytes = await page.evaluate(async (png) => {
    const manifest = {
      app: 'PnPTools', version: 1, tool: 'PnPBleed', name: 'Old deck',
      settings: { bleedInput: '3' }, state: null,
      files: [{ path: 'files/0001-Old.png', name: 'Old.png', type: 'image/png', role: null }],
    };
    const blob = await PnP.zip.create([
      { name: 'manifest.json', data: JSON.stringify(manifest) },
      { name: 'files/0001-Old.png', data: new Blob([new Uint8Array(png)], { type: 'image/png' }) },
    ]);
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, [...img.opaque.buffer]);
  await page.evaluate(async (b) => {
    await PnP.project.load(new File([new Uint8Array(b)], 'Old deck.pnp'));
  }, bytes);
  await expect(bleedCards(page)).toHaveCount(1);
  await expect(bleedCards(page).first()).toHaveAttribute('title', 'Old.png');
  await expect(page.locator('#bleedInput')).toHaveValue('3');
  await expect(page.locator('.pnp-project-name')).toHaveValue('Old deck');
  // It is the project now: its files are in the library, and it survives a reload.
  await page.reload();
  await expect(bleedCards(page)).toHaveCount(1);
});
