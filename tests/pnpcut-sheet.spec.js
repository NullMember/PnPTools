// PnPCut sheet assembler (PnPCut/sheet.html).
const { test, expect, download, jsonFile } = require('./helpers');

// Three cards: one with its own die-cut outline, one with only a fold line,
// one blank. Plus a version 1 (single card) project.
const rect = (id, layer, x, y, w, h) => ({ id, type: 'rect', layer, x, y, w, h, rotation: 0, radius: 0 });
const DECK = {
  app: 'PnPCut', type: 'card-project', version: 2, cardW: 63, cardH: 88, layerColors: null,
  cards: [
    { name: 'Token', shapes: [{ id: 1, type: 'ellipse', layer: 'cut', x: 6.5, y: 18, w: 50, h: 50, rotation: 0 }, rect(2, 'score', 10, 10, 5, 5)] },
    { name: 'Fold', shapes: [{ id: 1, type: 'line', layer: 'score', x: 31.5, y: 0, w: 0, h: 88, rotation: 0, diag: 'tlbr' }] },
    { name: 'Blank', shapes: [] },
  ],
};
const OLD = { cardW: 63, cardH: 88, imageDataUrl: null, nextId: 2, shapes: [rect(1, 'emboss', 20, 20, 10, 10)] };

const cellSelects = (page) => page.locator('.cell-row select');
const assigned = (page) => cellSelects(page).evaluateAll((s) => s.map((x) => x.value).filter(Boolean));
// Outline rectangles in the preview (the guide frame is the first rect).
const outlineRects = (page) => page.locator('#canvasWrap svg rect').count().then((n) => n - 1);

test.beforeEach(async ({ page }) => {
  await page.goto('PnPCut/sheet.html');
  await page.setInputFiles('#projectInput', [jsonFile('deck.json', DECK), jsonFile('old.json', OLD)]);
  await expect(page.locator('.project-row')).toHaveCount(2);
});

test('lists each project with its card count', async ({ page }) => {
  await expect(page.locator('.project-cards')).toHaveText(['3 cards', '1 card']);
  const options = await page.locator('#fillAllSelect option').allTextContents();
  expect(options).toEqual(['Token', 'Fold', 'Blank', 'old.json']);
});

test('places every card once, adding pages as needed', async ({ page }) => {
  const cells = await cellSelects(page).count();
  expect(cells).toBe(6); // A4 fits 2 × 3 poker cards
  await page.click('#placeAllBtn');
  expect(await assigned(page)).toEqual(['deck.json::0', 'deck.json::1', 'deck.json::2', 'old.json::0']);
  await page.click('#placeAllBtn'); // nothing left to place
  await expect(page.locator('#pageLabel')).toHaveText('Page 1 of 1');

  // With the page already full, the next round starts a second page.
  await page.selectOption('#fillAllSelect', 'deck.json::1');
  await page.click('#fillAllBtn');
  await page.setInputFiles('#projectInput', jsonFile('more.json', DECK));
  await page.click('#placeAllBtn');
  await expect(page.locator('#pageLabel')).toHaveText('Page 2 of 2');
  expect(await assigned(page)).toEqual(['more.json::0', 'more.json::1', 'more.json::2']);
});

test.describe('outline cut', () => {
  test.beforeEach(async ({ page }) => {
    await page.click('#placeAllBtn');
  });

  test('auto: a card\'s own Cut lines replace the rectangle', async ({ page }) => {
    await page.selectOption('#outlineMode', 'auto');
    expect(await outlineRects(page)).toBe(5); // 6 cells, the Token card cuts itself
  });

  test('rect: a rectangle on every card, plus the cards\' own Cut lines', async ({ page }) => {
    await page.selectOption('#outlineMode', 'rect');
    expect(await outlineRects(page)).toBe(6);
    const cut = await download(page, () => page.click('#exportCutBtn'));
    expect((cut.text().match(/<rect /g) || []).length).toBe(7); // guide + 6 outlines
    expect((cut.text().match(/<path /g) || []).length).toBe(1); // the token's circle
  });

  test('none: no outline, only the cards\' own Cut lines', async ({ page }) => {
    await page.selectOption('#outlineMode', 'none');
    expect(await outlineRects(page)).toBe(0);
    await expect(page.locator('#radiusGroup')).toBeHidden();
    const cut = await download(page, () => page.click('#exportCutBtn'));
    expect((cut.text().match(/<rect /g) || []).length).toBe(1); // just the guide
    expect((cut.text().match(/<path /g) || []).length).toBe(1);
  });

  test('score export carries each card\'s score lines', async ({ page }) => {
    const score = await download(page, () => page.click('#exportScoreBtn'));
    expect((score.text().match(/<path /g) || []).length).toBe(2);
  });
});

test.describe('pages', () => {
  test('pages have their own assignments', async ({ page }) => {
    await expect(page.locator('#exportPagesGroup')).toBeHidden();
    await page.click('#placeAllBtn');
    await page.click('#addPageBtn');
    await expect(page.locator('#pageLabel')).toHaveText('Page 2 of 2');
    expect(await assigned(page)).toEqual([]);
    await page.selectOption('#fillAllSelect', 'deck.json::1');
    await page.click('#fillAllBtn');
    expect(await assigned(page)).toHaveLength(6);
    await page.click('#prevPageBtn');
    expect(await assigned(page)).toHaveLength(4);
    await expect(page.locator('#exportPagesGroup')).toBeVisible();
  });

  test('duplicate and delete pages', async ({ page }) => {
    await page.click('#placeAllBtn');
    await page.click('#dupPageBtn');
    await expect(page.locator('#pageLabel')).toHaveText('Page 2 of 2');
    expect(await assigned(page)).toHaveLength(4);
    await page.click('#deletePageBtn');
    await expect(page.locator('#pageLabel')).toHaveText('Page 1 of 1');
    await expect(page.locator('#deletePageBtn')).toBeDisabled();
  });

  test('exports every page as a zip, or just the page shown', async ({ page }) => {
    await page.click('#placeAllBtn');
    const single = await download(page, () => page.click('#exportAllBtn'));
    expect(single.name).toBe('sheet_63x88mm_2x3_all.svg');
    await page.click('#addPageBtn');
    const zip = await download(page, () => page.click('#exportAllBtn'));
    expect(zip.name).toBe('sheet_63x88mm_2x3_2pages_all.zip');
    await page.selectOption('#exportPages', 'current');
    const one = await download(page, () => page.click('#exportEmbossBtn'));
    expect(one.name).toBe('sheet_63x88mm_2x3_p2_emboss.svg');
  });
});

test('removing a project clears its cards from every page', async ({ page }) => {
  await page.click('#placeAllBtn');
  await page.click('#dupPageBtn');
  await page.locator('.project-row').first().locator('.remove-btn').click();
  expect(await assigned(page)).toEqual(['old.json::0']);
  await page.click('#prevPageBtn');
  expect(await assigned(page)).toEqual(['old.json::0']);
});

test('opens an older saved sheet (.pnp) with one page of project names', async ({ page }) => {
  const cells = await page.evaluate(async (old) => {
    const manifest = {
      app: 'PnPTools', version: 1, tool: 'PnPCut', settings: {}, files: [],
      state: { projects: { 'old.json': old }, assignments: { '0-0': 'old.json', '0-1': null } },
    };
    const blob = await PnP.zip.create([{ name: 'manifest.json', data: JSON.stringify(manifest) }]);
    await PnP.project.load(new File([blob], 'old.pnp'));
    return [...document.querySelectorAll('.cell-row select')].map((s) => s.value).filter(Boolean);
  }, OLD);
  expect(cells).toEqual(['old.json::0']);
});

test('preview lines are visible while exports keep hairline strokes', async ({ page }) => {
  await page.click('#placeAllBtn');
  await expect(page.locator('#canvasWrap svg rect').nth(1)).toHaveCSS('stroke-width', '1.5px');
  const all = await download(page, () => page.click('#exportAllBtn'));
  expect(all.text()).not.toMatch(/stroke-width="1\.5/);
  expect(all.text()).toContain('stroke-width="0.15"');
});
