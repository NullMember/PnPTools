// Shared runtime: top-bar project buttons and the Inputs & outputs viewer,
// which records files loaded into and produced by every tool.
const { test, expect, download, makeCardImages, expectSvgSizeInInches } = require('./helpers');

const topBar = (page) => page.locator('.pnp-topbar');
const filesButton = (page) => page.locator('.pnp-outputs-btn');
const popover = (page) => page.locator('.pnp-outputs .pnp-popover');

async function openFiles(page) {
  await filesButton(page).click();
  await expect(popover(page)).toBeVisible();
}

test('the card editor has a project name, New, Open, Save and Save as in the top bar', async ({ page }) => {
  await page.goto('PnPCut/editor.html');
  for (const name of ['New', 'Open', 'Save', 'Save as']) {
    await expect(topBar(page).getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(topBar(page).getByRole('textbox', { name: 'Project name' })).toBeVisible();
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
  expect(saved.name).toMatch(/^PnPTools-.*\.pnp$/);

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

test('New clears Inputs & outputs', async ({ page }) => {
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
  await expect(popover(page).locator('.pnp-popover-row')).toHaveCount(0);
  await expect(popover(page).locator('.pnp-popover-empty')).toBeVisible();
});

test('files dropped into a tool are listed as its inputs', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha, img.opaque]);
  await openFiles(page);
  const inputs = popover(page).locator('.pnp-popover-row[data-kind="input"]');
  await expect(inputs).toHaveCount(1);
  await expect(inputs).toContainText('2 images loaded in Bleed tool');

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
  await expect(page.getByText('Loaded 2 file(s) from Bleed tool.')).toBeVisible();
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
  await expect(outputs).toContainText('from CardCrop tool');
  await expect(popover(page).locator('.pnp-popover-row[data-kind="input"]')).toContainText('1 image loaded in CardCrop tool');
});

test('downloads are recorded; zips are unpacked for preview', async ({ page }) => {
  await page.goto('PnPCut/editor.html');
  await page.click('#addTemplateBtn');
  await page.click('#addCardBtn');
  await page.click('#addTemplateBtn');
  await download(page, () => page.click('#exportCardsBtn'));
  await openFiles(page);
  const outputs = popover(page).locator('.pnp-popover-row[data-kind="output"]');
  await expect(outputs).toContainText('2 images from Cut tool');
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

test('Layout and TuckBox cut files are sized in inches', async ({ page }) => {
  await page.goto('PnPTuckBox/index.html');
  const box = await download(page, () => page.click('#downloadSvg'));
  expectSvgSizeInInches(box.text());

  await page.goto('PnPLayout/index.html');
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', img.alpha);
  await expect(page.locator('#sheetGrid > *').first()).toBeVisible({ timeout: 15000 }); // packed
  const layout = await download(page, () => page.click('#downloadSvg'));
  expectSvgSizeInInches(layout.text());
});

// ---- project name, Save, Save as ----

test('Save names the project file after the project name, and Open restores it', async ({ page }) => {
  await page.goto('PnPTuckBox/index.html');
  await page.fill('.pnp-project-name', 'Dragon deck');
  const saved = await download(page, () => topBar(page).getByRole('button', { name: 'Save', exact: true }).click());
  expect(saved.name).toBe('Dragon deck.pnp');
  // No File System Access: Save as downloads a copy too.
  const copy = await download(page, () => topBar(page).getByRole('button', { name: 'Save as', exact: true }).click());
  expect(copy.name).toBe('Dragon deck.pnp');

  // The name belongs to the project, which the browser keeps.
  await page.goto('PnPBleed/index.html');
  await expect(page.locator('.pnp-project-name')).toHaveValue('Dragon deck');

  await page.fill('.pnp-project-name', 'Something else');
  await page.press('.pnp-project-name', 'Tab');
  await page.evaluate(async (bytes) => {
    await PnP.project.load(new File([new Uint8Array(bytes)], 'Dragon deck (1).pnp'));
  }, [...require('node:fs').readFileSync(saved.path)]);
  await expect(page.locator('.pnp-project-name')).toHaveValue('Dragon deck');
});

test('Ctrl+S saves the project', async ({ page }) => {
  await page.goto('PnPCut/sheet.html');
  await page.fill('.pnp-project-name', 'Sheet one');
  await page.locator('body').click();
  const saved = await download(page, () => page.keyboard.press('ControlOrMeta+s'));
  expect(saved.name).toBe('Sheet one.pnp');
});

test.describe('with the File System Access API', () => {
  const { fakeFilePickers } = require('./helpers');
  const save = (page) => topBar(page).getByRole('button', { name: 'Save', exact: true }).click();
  const saveAs = (page) => topBar(page).getByRole('button', { name: 'Save as', exact: true }).click();
  const state = (page) => page.evaluate(() => ({ calls: window.__pickerCalls, files: Object.keys(window.__fs) }));

  test.beforeEach(async ({ page }) => {
    await fakeFilePickers(page);
    await page.goto('PnPTuckBox/index.html');
  });

  test('Save asks once, then saves to the same file', async ({ page }) => {
    await page.fill('.pnp-project-name', 'Box');
    await save(page);
    await expect(page.locator('.pnp-toast')).toContainText('Saved Box.pnp');
    expect(await state(page)).toEqual({ calls: 1, files: ['Box.pnp'] });

    await page.fill('#cardCount', '20');
    await save(page);
    await expect.poll(() => page.evaluate(async () => {
      const entries = await PnP.zip.read(window.__fs['Box.pnp']);
      return (JSON.parse(new TextDecoder().decode(entries.get('manifest.json'))).settings.PnPTuckBox || {}).cardCount;
    })).toBe('20');
    expect((await state(page)).calls).toBe(1); // no second dialog
  });

  test('Save as picks a new file and the name follows it', async ({ page }) => {
    await page.fill('.pnp-project-name', 'Box');
    await save(page);
    await page.evaluate(() => window.__pickNames.push('Box copy.pnp'));
    await saveAs(page);
    await expect(page.locator('.pnp-project-name')).toHaveValue('Box copy');
    expect(await state(page)).toEqual({ calls: 2, files: ['Box.pnp', 'Box copy.pnp'] });
    await save(page); // now saves to the copy
    await expect.poll(() => state(page)).toEqual({ calls: 2, files: ['Box.pnp', 'Box copy.pnp'] });
  });

  test('renaming the project asks where to save it', async ({ page }) => {
    await page.fill('.pnp-project-name', 'Box');
    await save(page);
    await expect(page.locator('.pnp-toast')).toContainText('Saved Box.pnp');
    await page.fill('.pnp-project-name', 'Renamed');
    await save(page);
    await expect.poll(() => state(page)).toEqual({ calls: 2, files: ['Box.pnp', 'Renamed.pnp'] });
  });

  test('a project opened from a file saves back to it', async ({ page }) => {
    await page.fill('.pnp-project-name', 'Mine');
    await save(page);
    await expect(page.locator('.pnp-toast')).toContainText('Saved Mine.pnp');
    const bytes = await page.evaluate(async () => [...new Uint8Array(await window.__fs['Mine.pnp'].arrayBuffer())]);
    await page.goto('PnPTuckBox/index.html'); // later, in a fresh page
    await page.evaluate((b) => { window.__openFile = new File([new Uint8Array(b)], 'Mine.pnp'); }, bytes);
    await topBar(page).getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.locator('.pnp-project-name')).toHaveValue('Mine');
    await save(page);
    await expect(page.locator('.pnp-toast').last()).toContainText('Saved Mine.pnp');
    expect(await state(page)).toEqual({ calls: 1, files: ['Mine.pnp'] }); // only the open dialog
  });
});

// ---- unsaved work ----

test.describe('unsaved-work warning after Save', () => {
  const newButton = (page) => topBar(page).getByRole('button', { name: 'New', exact: true });
  // Clicks New and reports whether it asked to discard the work.
  async function newAsks(page) {
    let asked = false;
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => { asked = true; d.accept(); });
    await Promise.all([page.waitForEvent('load'), newButton(page).click()]);
    return asked;
  }

  test('New does not ask right after a Save, but does after a change', async ({ page }) => {
    await page.goto('PnPBleed/index.html');
    const img = await makeCardImages(page);
    await page.setInputFiles('#imageInput', [img.alpha]);
    await download(page, () => topBar(page).getByRole('button', { name: 'Save', exact: true }).click());
    expect(await newAsks(page)).toBe(false);

    await page.setInputFiles('#imageInput', [img.alpha]);
    await download(page, () => topBar(page).getByRole('button', { name: 'Save', exact: true }).click());
    await page.fill('#bleedInput__display', '4'); // a change after saving
    expect(await newAsks(page)).toBe(true);
  });

  test('a project just opened does not count as unsaved', async ({ page }) => {
    await page.goto('PnPBleed/index.html');
    const img = await makeCardImages(page);
    await page.setInputFiles('#imageInput', [img.alpha]);
    const saved = await download(page, () => topBar(page).getByRole('button', { name: 'Save', exact: true }).click());
    await page.goto('PnPBleed/index.html');
    await page.evaluate(async (bytes) => {
      await PnP.project.load(new File([new Uint8Array(bytes)], 'cards.pnp'));
    }, [...require('node:fs').readFileSync(saved.path)]);
    await expect(page.locator('#thumbnailsContainer .thumbnail')).toHaveCount(1);
    expect(await newAsks(page)).toBe(false);
  });

  test('leaving never warns: the work stays in the browser', async ({ page }) => {
    await page.goto('PnPBleed/index.html');
    const img = await makeCardImages(page);
    await page.setInputFiles('#imageInput', [img.alpha]);
    const warns = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(warns).toBe(false);
  });
});

// ---- the library ----

test('the library shows the space used, and Clear all empties it', async ({ page }) => {
  await page.goto('PnPBleed/index.html');
  await page.evaluate(async () => {
    const mb = (n) => new Blob([new Uint8Array(n * 1024 * 1024).fill(n)], { type: 'image/png' });
    await PnP.recordFiles({ kind: 'input', items: [{ name: 'big.png', blob: mb(3) }] });
    await PnP.recordFiles({ kind: 'output', items: [{ name: 'big-copy.png', blob: mb(3) }, { name: 'small.png', blob: mb(1) }] });
  });
  await openFiles(page);
  await expect(popover(page).locator('.pnp-popover-footer')).toContainText('4.0 MB in this project'); // big.png is stored once
  await expect(popover(page).locator('.pnp-popover-row[data-kind="output"]')).toContainText('4.0 MB');
  await popover(page).getByRole('button', { name: 'Clear all' }).click();
  await expect(popover(page).locator('.pnp-popover-row')).toHaveCount(0);
  await expect(popover(page).locator('.pnp-popover-empty')).toBeVisible();
});
