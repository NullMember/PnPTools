// PnPCut card line-art editor (PnPCut/editor.html) and the shared vector editor.
const { test, expect, download, makeCardImages, dropFiles, jsonFile } = require('./helpers');

const shapes = (page, layer) => page.locator(layer ? `[data-layer-group="${layer}"] .shape-el` : '#canvasSvg .shape-el');
const cardItems = (page) => page.locator('.card-item');

const ART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="80mm" viewBox="0 0 60 80">
  <rect x="5" y="5" width="20" height="10" stroke="#c0392b" fill="none"/>
  <circle cx="40" cy="40" r="8" stroke="#e08e0b" fill="none"/>
  <line x1="5" y1="70" x2="55" y2="70" stroke="#2e8b57"/>
</svg>`;

test.beforeEach(async ({ page }) => {
  await page.goto('PnPCut/editor.html');
});

// Loads the transparent and the opaque test image as two cards.
async function addTwoCards(page) {
  const img = await makeCardImages(page);
  await page.setInputFiles('#cardImageInput', [img.alpha, img.opaque]);
  await expect(cardItems(page)).toHaveCount(2);
}

test.describe('cards', () => {
  test('each dropped image becomes a card; the first fills the blank card', async ({ page }) => {
    await expect(cardItems(page)).toHaveCount(1);
    await addTwoCards(page);
    await expect(page.locator('.card-item.current .card-label')).toHaveText('Sticker');
    await expect(page.locator('.card-label')).toHaveText(['Sticker', 'Plain']);
  });

  test('switching cards keeps each card\'s shapes and undo history', async ({ page }) => {
    await addTwoCards(page);
    await page.click('#addTemplateBtn');
    await expect(shapes(page)).toHaveCount(1);

    await cardItems(page).nth(1).click();
    await expect(shapes(page)).toHaveCount(0);
    await page.selectOption('#templateSelect', 'foldMiddle');
    await page.click('#addTemplateBtn');
    await page.click('#addTemplateBtn');
    await expect(shapes(page)).toHaveCount(2);

    await cardItems(page).first().click();
    await expect(shapes(page)).toHaveCount(1);
    await page.click('#undoBtn');
    await expect(shapes(page)).toHaveCount(0);
    await page.click('#redoBtn');
    await expect(shapes(page)).toHaveCount(1);

    await cardItems(page).nth(1).click();
    await expect(shapes(page)).toHaveCount(2);
  });

  test('new, rename, duplicate and delete cards', async ({ page }) => {
    await page.click('#addTemplateBtn');
    await page.fill('#cardName', 'Hero');
    await expect(page.locator('.card-label')).toHaveText(['Hero']);
    await page.click('#dupCardBtn');
    await expect(page.locator('.card-label')).toHaveText(['Hero', 'Hero copy']);
    await expect(shapes(page)).toHaveCount(1);
    await page.click('#addCardBtn');
    await expect(cardItems(page)).toHaveCount(3);
    await expect(shapes(page)).toHaveCount(0);
    await page.click('#deleteCardBtn');
    await expect(page.locator('.card-label')).toHaveText(['Hero', 'Hero copy']);
  });

  test('each card\'s eye shows or hides only its own reference image', async ({ page }) => {
    await addTwoCards(page);
    const image = page.locator('#canvasSvg image');
    await cardItems(page).first().getByRole('button', { name: 'Hide reference image' }).click();
    await expect(image).toBeHidden();
    await expect(cardItems(page).first().locator('.card-thumb image')).toHaveCount(0);
    await cardItems(page).nth(1).locator('.card-select').click();
    await expect(image).toBeVisible();
    await cardItems(page).first().locator('.card-select').click();
    await expect(image).toBeHidden();

    // The choice is saved with the project.
    const saved = await download(page, () => page.click('#saveProjectBtn'));
    expect(JSON.parse(saved.text()).cards.map((c) => c.imageVisible)).toEqual([false, true]);
  });

  test('a card\'s image can be set, replaced by dropping, and removed from its row', async ({ page }) => {
    const img = await makeCardImages(page);
    const row = cardItems(page).first();
    await expect(row.getByRole('button', { name: 'Hide reference image' })).toHaveCount(0);

    await row.getByRole('button', { name: 'Set reference image…' }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Browse files on this device…' }).click(),
    ]);
    await chooser.setFiles(img.opaque);
    await expect(page.locator('#canvasSvg')).not.toHaveClass(/has-alpha/);
    await expect(row.getByRole('button', { name: 'Hide reference image' })).toBeVisible();

    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'Sticker.png', { type: 'image/png' }));
      document.querySelector('.card-item').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, img.alpha.buffer.toString('base64'));
    await expect(page.locator('#canvasSvg')).toHaveClass(/has-alpha/);
    await expect(cardItems(page)).toHaveCount(1); // replaced, not a new card

    await row.getByRole('button', { name: 'Remove reference image' }).click();
    await expect(page.locator('#canvasSvg image')).not.toHaveAttribute('href', /.+/);
    await expect(row.getByRole('button', { name: 'Set reference image…' })).toBeVisible();
  });

  test('a template can go on every card', async ({ page }) => {
    await page.click('#addCardBtn');
    await page.click('#addCardBtn');
    await page.selectOption('#templateSelect', 'standee');
    await page.click('#addTemplateAllBtn');
    await expect(page.locator('.card-count')).toHaveText(['2 shapes', '2 shapes', '2 shapes']);
  });
});

test.describe('transparent images', () => {
  test('transparent pixels show as a checkerboard, only while the image is shown', async ({ page }) => {
    await addTwoCards(page);
    const svg = page.locator('#canvasSvg');
    await expect(svg).toHaveClass(/has-alpha/);
    await expect(page.locator('#alphaPanel')).toBeVisible();
    await page.locator('.card-item.current').getByRole('button', { name: 'Hide reference image' }).click();
    await expect(svg).not.toHaveClass(/has-alpha/);
    await page.locator('.card-item.current').getByRole('button', { name: 'Show reference image' }).click();
    await cardItems(page).nth(1).click();
    await expect(svg).not.toHaveClass(/has-alpha/);
    await expect(page.locator('#alphaPanel')).toBeHidden();
  });

  test('transparent edges become an outline and a hole on the chosen layer', async ({ page }) => {
    await addTwoCards(page);
    await page.click('#alphaTraceBtn');
    await expect(shapes(page, 'cut')).toHaveCount(2);

    await page.click('#undoBtn');
    await page.uncheck('#alphaHoles');
    await page.selectOption('#alphaLayer', 'emboss');
    await page.click('#alphaTraceBtn');
    await expect(shapes(page)).toHaveCount(1);
    await expect(shapes(page, 'emboss')).toHaveCount(1);
  });

  test('the traced outline hugs the rounded card without overshooting it', async ({ page }) => {
    await addTwoCards(page);
    await page.check('#alphaHoles');
    await page.click('#alphaTraceBtn');
    const saved = await download(page, () => page.click('#saveProjectBtn'));
    const card = JSON.parse(saved.text()).cards[0];
    // Every Bézier handle of the outline stays within the card (plus a hair).
    const outer = card.shapes.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b));
    const handles = outer.nodes.flatMap((n) => [n.hi, n.ho].filter(Boolean));
    expect(handles.length).toBeGreaterThan(0);
    for (const h of handles) {
      expect(outer.x + h.fx * outer.w).toBeGreaterThan(-0.5);
      expect(outer.x + h.fx * outer.w).toBeLessThan(63.5);
      expect(outer.y + h.fy * outer.h).toBeGreaterThan(-0.5);
      expect(outer.y + h.fy * outer.h).toBeLessThan(88.5);
    }
  });
});

test.describe('SVG import', () => {
  test('dropping an SVG imports its elements onto layers by stroke colour', async ({ page }) => {
    await dropFiles(page, '#importSvgDrop', [{ name: 'art.svg', type: 'image/svg+xml', text: ART_SVG }]);
    await expect(shapes(page)).toHaveCount(3);
    await expect(shapes(page, 'cut')).toHaveCount(1);
    await expect(shapes(page, 'score')).toHaveCount(1);
    await expect(shapes(page, 'emboss')).toHaveCount(1);
    await expect(page.locator('.import-file')).toHaveCount(1);
    await expect(page.locator('.import-file .import-count')).toHaveText('3');
  });

  test('each imported element can be selected, moved and removed', async ({ page }) => {
    await page.setInputFiles('#importSvgInput', { name: 'art.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(ART_SVG) });
    await page.locator('.import-file summary').click({ position: { x: 4, y: 8 } });
    await page.locator('.import-row .import-name').nth(1).click();
    await expect(page.locator('.import-row.selected')).toHaveCount(1);

    const x0 = parseFloat(await page.inputValue('#propX'));
    await page.locator('#canvasSvg').hover();
    await page.keyboard.press('Shift+ArrowRight');
    expect(parseFloat(await page.inputValue('#propX'))).toBeCloseTo(x0 + 1, 6);

    await page.locator('.import-row .remove-btn').first().click();
    await expect(shapes(page)).toHaveCount(2);
    await expect(page.locator('.import-file .import-count')).toHaveText('2');
  });

  test('a whole file can be selected and removed, and undo brings it back', async ({ page }) => {
    await page.setInputFiles('#importSvgInput', [
      { name: 'a.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(ART_SVG) },
      { name: 'b.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(ART_SVG) },
    ]);
    await expect(page.locator('.import-file')).toHaveCount(2);
    await page.locator('.import-file summary .import-name').first().click();
    await expect(page.locator('.import-file.selected')).toHaveCount(1);
    await page.locator('.import-file summary .remove-btn').first().click();
    await expect(shapes(page)).toHaveCount(3);
    await expect(page.locator('.import-file')).toHaveCount(1);
    await page.click('#undoBtn');
    await expect(shapes(page)).toHaveCount(6);
  });

  test('copies of imported shapes are not listed as imported', async ({ page }) => {
    await page.setInputFiles('#importSvgInput', { name: 'art.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(ART_SVG) });
    await page.locator('#canvasSvg').hover();
    await page.keyboard.press('Control+d');
    await expect(shapes(page)).toHaveCount(6);
    await expect(page.locator('.import-file .import-count')).toHaveText('3');
  });
});

test.describe('line visibility', () => {
  test('shape lines are drawn 2.5px wide with a halo, whatever the zoom', async ({ page }) => {
    await page.click('#addTemplateBtn');
    const line = page.locator('.shape-line').first();
    await expect(line).toHaveCSS('stroke-width', '2.5px');
    await expect(page.locator('.shape-halo')).toHaveCount(1);
    await page.click('#zoomOutBtn');
    await expect(line).toHaveCSS('stroke-width', '2.5px');
  });

  test('a click a few pixels off a line still picks the shape', async ({ page }) => {
    await page.click('#addTemplateBtn');
    await page.keyboard.press('Escape');
    await expect(page.locator('#propsForm')).toBeHidden();
    const box = await page.locator('.shape-line').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 3); // 3px inside the top edge
    await expect(page.locator('#propsForm')).toBeVisible();
  });
});

test.describe('project files', () => {
  test('saves every card and reopens them', async ({ page }) => {
    await addTwoCards(page);
    await page.click('#alphaTraceBtn');
    await cardItems(page).nth(1).click();
    await page.setInputFiles('#importSvgInput', { name: 'art.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(ART_SVG) });

    const saved = await download(page, () => page.click('#saveProjectBtn'));
    const project = JSON.parse(saved.text());
    expect(project).toMatchObject({ app: 'PnPCut', type: 'card-project', version: 2, cardW: 63, cardH: 88 });
    expect(project.cards.map((c) => c.name)).toEqual(['Sticker', 'Plain']);
    expect(project.cards[1].shapes.every((s) => s.source && s.source.name === 'art.svg')).toBe(true);

    await page.reload();
    await page.setInputFiles('#loadProjectInput', saved.path);
    await expect(cardItems(page)).toHaveCount(2);
    await expect(shapes(page)).toHaveCount(2);
    await expect(page.locator('#canvasSvg')).toHaveClass(/has-alpha/);
    await cardItems(page).nth(1).click();
    await expect(page.locator('.import-file .import-count')).toHaveText('3');
  });

  test('Open in sheet assembler sends every card and places them', async ({ page, context }) => {
    await page.fill('#cardName', 'Hero');
    await page.click('#addTemplateBtn');
    await page.click('#addCardBtn');
    await page.click('#addCardBtn');
    const [sheet] = await Promise.all([context.waitForEvent('page'), page.click('#openSheetBtn')]);
    const errors = [];
    sheet.on('pageerror', (e) => errors.push(e.message));
    await expect(sheet).toHaveURL(/PnPCut\/sheet\.html$/); // the ?import id is consumed
    await expect(sheet.locator('.project-cards')).toHaveText(['3 cards']);
    const assigned = await sheet.locator('.cell-row select').evaluateAll((s) => s.map((x) => x.value).filter(Boolean));
    expect(assigned).toHaveLength(3);
    await expect(sheet.locator('.cell-row select').first().locator('option:checked')).toHaveText('Hero');
    await expect(sheet.getByText('Imported 1 file from Card editor.')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('opens a version 1 (single card) project', async ({ page }) => {
    await page.setInputFiles('#loadProjectInput', jsonFile('old-card.json', {
      cardW: 70, cardH: 120, imageDataUrl: null, nextId: 2,
      shapes: [{ id: 1, type: 'rect', layer: 'score', x: 10, y: 10, w: 20, h: 20, rotation: 0, radius: 0 }],
    }));
    await expect(page.locator('.card-label')).toHaveText(['old-card']);
    await expect(shapes(page, 'score')).toHaveCount(1);
    await expect(page.locator('#cardW')).toHaveValue('70');
  });

  test('exports the shown card per layer and every card as a zip', async ({ page }) => {
    await page.fill('#cardName', 'Hero');
    await page.click('#addTemplateBtn');
    const cut = await download(page, () => page.click('#exportCutBtn'));
    expect(cut.name).toBe('Hero_63x88mm_cut.svg');
    expect(cut.text()).toContain('stroke-width="0.15"');
    await page.click('#addCardBtn');
    const zip = await download(page, () => page.click('#exportCardsBtn'));
    expect(zip.name).toBe('cards_63x88mm.zip');
  });
});
