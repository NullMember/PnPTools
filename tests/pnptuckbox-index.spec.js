// PnPTuckBox (PnPTuckBox/index.html): box styles, including the glueless ones.
const { test, expect, download, expectSvgSizeInInches } = require('./helpers');

// Cut paths in an SVG: closed outlines end in Z, slits are open two-point lines.
function cutLines(svgText) {
  const paths = [...svgText.matchAll(/<path d="([^"]+)"[^>]*stroke="#e03131"/g)].map((m) => m[1]);
  return {
    outlines: paths.filter((d) => d.trim().endsWith('Z')).length,
    slits: paths.filter((d) => !d.trim().endsWith('Z') && (d.match(/[ML]/g) || []).length === 2).length,
  };
}
const scoreLines = (svgText) => (svgText.match(/stroke="#e08e0b"/g) || []).length;

test.beforeEach(async ({ page }) => {
  await page.goto('PnPTuckBox/index.html');
});

test('the glueless styles are offered under "No glue"', async ({ page }) => {
  const labels = await page.locator('#boxStyle optgroup[label="No glue"] option').allTextContents();
  expect(labels).toEqual(['Tuck box, tab lock', 'Tuck box, hidden lock', 'Two-piece box, folded walls', 'Sleeve, tab lock']);
});

// [style, pieces, slits, folds, option field shown]
const GLUELESS = [
  ['tuckLock', 1, 2, 14, null],
  ['tuckHidden', 1, 2, 16, null], // the back/flap fold is split around its 2 slits
  ['twoPieceLock', 2, 16, 24, '#lidDepthGroup'],
  ['sleeveLock', 1, 2, 6, '#sleeveHeightGroup'],
];

for (const [style, pieces, slits, folds, option] of GLUELESS) {
  test(`${style}: one closed outline per piece, its slits and folds`, async ({ page }) => {
    await page.selectOption('#boxStyle', style);
    await expect(page.locator('#styleHint')).toContainText('No glue');
    for (const group of ['#lidDepthGroup', '#sleeveHeightGroup']) {
      if (group === option) await expect(page.locator(group)).toBeVisible();
      else await expect(page.locator(group)).toBeHidden();
    }
    await expect(page.locator('#status')).toBeHidden(); // fits the paper

    const svg = await download(page, () => page.click('#downloadSvg'));
    const text = svg.text();
    expectSvgSizeInInches(text);
    expect(cutLines(text)).toEqual({ outlines: pieces, slits });
    expect(scoreLines(text)).toBe(folds);

    const pdf = await download(page, () => page.click('#downloadPdf'));
    expect(pdf.name).toBe(`${style}-box.pdf`);
  });
}

test('the glued styles keep their glue flaps and have no slits', async ({ page }) => {
  for (const style of ['tuck', 'twoPiece', 'sleeve']) {
    await page.selectOption('#boxStyle', style);
    const svg = await download(page, () => page.click('#downloadSvg'));
    expect(cutLines(svg.text()).slits).toBe(0);
  }
});

test('a thick deck still gives a two-piece box without glue that fits A4', async ({ page }) => {
  await page.selectOption('#boxStyle', 'twoPieceLock');
  await page.fill('#cardCount', '100');
  await page.press('#cardCount', 'Tab');
  await expect(page.locator('#status')).toBeHidden(); // no "larger than the printable area"
  await expect(page.locator('.summary-item', { hasText: 'Pages' }).locator('.summary-value')).toHaveText('2');
  const zip = await download(page, () => page.click('#downloadSvg')); // one SVG per page
  expect(zip.name).toBe('twoPieceLock-box-cut.zip');
});

test('hidden lock: the slits sit on the back/flap fold, which is not scored over them', async ({ page }) => {
  await page.selectOption('#boxStyle', 'tuckHidden');
  await expect(page.locator('#styleHint')).toContainText('no tabs show');
  const svg = (await download(page, () => page.click('#downloadSvg'))).text();
  const pts = (d) => [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [+m[1], +m[2]]);
  const slits = [...svg.matchAll(/<path d="([^"]+)"[^>]*stroke="#e03131"/g)].map((m) => m[1])
    .filter((d) => !d.trim().endsWith('Z')).map(pts);
  const folds = [...svg.matchAll(/<path d="([^"]+)"[^>]*stroke="#e08e0b"/g)].map((m) => pts(m[1]));
  expect(slits).toHaveLength(2);
  for (const [[sx, sy0], [, sy1]] of slits) {
    const onLine = folds.filter(([[ax], [bx]]) => Math.abs(ax - sx) < 0.01 && Math.abs(bx - sx) < 0.01);
    expect(onLine.length).toBeGreaterThan(0); // the fold runs along the slit's line…
    for (const [[, ay], [, by]] of onLine) {  // …but stops at its ends
      const [lo, hi] = [Math.min(ay, by), Math.max(ay, by)];
      expect(hi <= Math.min(sy0, sy1) + 0.01 || lo >= Math.max(sy0, sy1) - 0.01).toBe(true);
    }
  }
});

// ---- Artwork editor ----------------------------------------------------------

async function addArt(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 400;
    const g = c.getContext('2d');
    g.fillStyle = '#2a7'; g.fillRect(0, 0, 600, 400);
    g.fillStyle = '#fff'; g.fillRect(250, 150, 100, 100);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.setInputFiles('#artInput', { name: 'art.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await expect(page.getByRole('button', { name: 'Edit (crop, zoom, move): Front' })).toBeVisible();
}

const frontArt = (page) => page.evaluate(() => JSON.parse(JSON.stringify(state.art.front)));
const previewPixels = (page) => page.locator('#sheetGrid canvas').first().evaluate((c) => c.toDataURL());

test.describe('artwork editor', () => {
  test('drag pans, the wheel zooms, and Done keeps the result', async ({ page }) => {
    await addArt(page);
    const before = await previewPixels(page);
    await page.getByRole('button', { name: 'Edit (crop, zoom, move): Front' }).click();
    const dialog = page.locator('.art-editor');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#artEditorTitle')).toHaveText('Edit artwork: Front');

    const c = await dialog.locator('.ae-canvas').boundingBox();
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width / 2 + 50, c.y + c.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.mouse.wheel(0, -200);
    await expect(dialog.locator('#aeZoomValue')).not.toHaveText('100%');

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    const a = await frontArt(page);
    expect(a.dx).toBeGreaterThan(0);
    expect(a.zoom).toBeGreaterThan(1);
    await expect.poll(() => previewPixels(page)).not.toBe(before); // the sheet preview follows
  });

  test('Cancel (or Esc) puts everything back', async ({ page }) => {
    await addArt(page);
    const before = await frontArt(page);
    for (const leave of ['cancel', 'escape']) {
      await page.getByRole('button', { name: 'Edit (crop, zoom, move): Front' }).click();
      await page.selectOption('#aeMode', 'fit');
      await page.click('#aeRotate');
      if (leave === 'cancel') await page.click('#aeCancel');
      else await page.keyboard.press('Escape');
      await expect(page.locator('.art-editor')).toBeHidden();
      expect(await frontArt(page)).toEqual(before);
    }
  });

  test('crop by dragging a corner; "Use the whole image" resets it', async ({ page }) => {
    await addArt(page);
    await page.getByRole('button', { name: 'Edit (crop, zoom, move): Front' }).click();
    await page.click('[data-tab="crop"]');
    await expect(page.locator('#aeCropSize')).toHaveText('Keeping 600 × 400 px of 600 × 400');

    // The image fills the stage width-wise, centred: find its top-left corner handle.
    const c = await page.locator('.ae-canvas').boundingBox();
    const corner = await page.locator('.ae-canvas').evaluate((cv) => {
      const w = parseFloat(cv.style.width), h = parseFloat(cv.style.height);
      const k = Math.min((w - 36) / 600, (h - 36) / 400);
      return { x: (w - 600 * k) / 2, y: (h - 400 * k) / 2, k };
    });
    await page.mouse.move(c.x + corner.x, c.y + corner.y);
    await page.mouse.down();
    await page.mouse.move(c.x + corner.x + 150 * corner.k, c.y + corner.y + 100 * corner.k, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#aeCropSize')).toHaveText('Keeping 450 × 300 px of 600 × 400');

    await page.click('#aeResetCrop');
    await expect(page.locator('#aeCropSize')).toHaveText('Keeping 600 × 400 px of 600 × 400');
    await page.mouse.move(c.x + corner.x, c.y + corner.y);
    await page.mouse.down();
    await page.mouse.move(c.x + corner.x + 60 * corner.k, c.y + corner.y, { steps: 3 });
    await page.mouse.up();
    await page.click('#aeDone');
    const a = await frontArt(page);
    expect(a.crop.x).toBeCloseTo(0.1, 1);
    expect(a.crop.w).toBeCloseTo(0.9, 1);
  });

  test('double-clicking a panel in the sheet preview opens its editor', async ({ page }) => {
    await addArt(page);
    const canvas = page.locator('#sheetGrid canvas').first();
    // Find the Front panel's centre on the preview through the page's own hit test.
    const spot = await canvas.evaluate((cv) => {
      const r = cv.getBoundingClientRect();
      for (let y = 0; y < r.height; y += 6) {
        for (let x = 0; x < r.width; x += 6) {
          const k = r.width / paperSize().w;
          if (slotAt(state.pages[0], x / k, y / k) === 'front') return { x, y };
        }
      }
      return null;
    });
    expect(spot).not.toBeNull();
    await canvas.dblclick({ position: spot });
    await expect(page.locator('.art-editor #artEditorTitle')).toHaveText('Edit artwork: Front');
  });

  test('crop, zoom and position are saved in the .pnp project', async ({ page }) => {
    await addArt(page);
    await page.evaluate(() => Object.assign(state.art.front, { crop: { x: 0.1, y: 0, w: 0.8, h: 1 }, zoom: 1.5, dx: 0.2, dy: -0.1 }));
    const saved = await download(page, () => page.locator('.pnp-topbar').getByRole('button', { name: 'Save', exact: true }).click());
    await page.goto('PnPTuckBox/index.html');
    await page.evaluate(async (bytes) => {
      await PnP.project.load(new File([new Uint8Array(bytes)], 'box.pnp'));
    }, [...require('node:fs').readFileSync(saved.path)]);
    await expect.poll(() => page.evaluate(() => !!state.art.front)).toBe(true);
    const a = await frontArt(page);
    expect(a).toMatchObject({ crop: { x: 0.1, y: 0, w: 0.8, h: 1 }, zoom: 1.5, dx: 0.2, dy: -0.1 });
  });
});
