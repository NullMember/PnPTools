// PnPTuckBox (PnPTuckBox/index.html): box styles, including the glueless ones.
const { test, expect, download, expectSvgSizeInInches, trackRevokedUrls, revokedUrls } = require('./helpers');

// Cut paths in an SVG: closed outlines end in Z, slits are open two-point lines.
function cutLines(svgText) {
  const paths = [...svgText.matchAll(/<path d="([^"]+)"[^>]*stroke="#e03131"/g)].map((m) => m[1]);
  return {
    outlines: paths.filter((d) => d.trim().endsWith('Z')).length,
    slits: paths.filter((d) => !d.trim().endsWith('Z') && (d.match(/[ML]/g) || []).length === 2).length,
  };
}
const scoreLines = (svgText) => (svgText.match(/stroke="#e08e0b"/g) || []).length;

// Pick a style and wait for the redraw (it runs just after the change and
// sets the style's hint), so exports use the new layout.
async function selectStyle(page, style) {
  await page.selectOption('#boxStyle', style);
  await expect(page.locator('#styleHint')).toHaveText(await page.evaluate((st) => STYLE_HINTS[st], style));
}

test.beforeEach(async ({ page }) => {
  await page.goto('PnPTuckBox/index.html');
});

test('the glueless styles are offered under "No glue"', async ({ page }) => {
  const labels = await page.locator('#boxStyle optgroup[label="No glue"] option').allTextContents();
  expect(labels).toEqual(['Tuck box, tab lock', 'Tuck box, fixed bottom', 'Two-piece box, folded walls', 'Sleeve, tab lock']);
});

// The "hidden lock" styles became the tab locks: settings saved under the old
// names open the new style.
for (const [old, now] of [['tuckHidden', 'tuckLock'], ['sleeveHidden', 'sleeveLock']]) test(`a saved "${old}" style opens as ${now}`, async ({ page }) => {
  await page.evaluate((style) => localStorage.setItem('pnp:settings:PnPTuckBox', JSON.stringify({ boxStyle: style })), old);
  await page.reload();
  await expect(page.locator('#boxStyle')).toHaveValue(now);
  await expect(page.locator('#styleHint')).toHaveText(await page.evaluate((st) => STYLE_HINTS[st], now));
});

// [style, pieces, slits, folds, option field shown]
const GLUELESS = [
  // Tuck boxes also have 2 tuck lock slits per tuck flap (top and bottom).
  ['tuckLock', 1, 6, 14, null],
  ['tuckFixedLock', 1, 6, 16, null], // top tuck lock 2 + side seam 2 + bottom 2
  ['twoPieceLock', 2, 16, 24, '#lidDepthGroup'],
  ['sleeveLock', 1, 2, 6, '#sleeveHeightGroup'],
];

for (const [style, pieces, slits, folds, option] of GLUELESS) {
  test(`${style}: one closed outline per piece, its slits and folds`, async ({ page }) => {
    await selectStyle(page, style);
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

test('glued styles: only the tuck flaps have lock slits', async ({ page }) => {
  // [style, slits]: 2 per tuck flap; the glued-bottom box tucks at the top only.
  for (const [style, slits] of [['tuck', 4], ['tuckFixed', 2], ['twoPiece', 0], ['sleeve', 0]]) {
    await selectStyle(page, style);
    const svg = await download(page, () => page.click('#downloadSvg'));
    expect(cutLines(svg.text()), style).toEqual({ outlines: style === 'twoPiece' ? 2 : 1, slits });
  }
});

// The preview redraws just after an input: wait for the summary to show the
// new card count before checking the result.
async function setCardCount(page, n) {
  await page.fill('#cardCount', String(n));
  await page.press('#cardCount', 'Tab');
  await expect(page.locator('.summary-item', { hasText: 'Deck' }).locator('.summary-value')).toContainText(`${n} cards`);
}

test('a thick deck still gives a two-piece box without glue that fits A4', async ({ page }) => {
  await selectStyle(page, 'twoPieceLock');
  await setCardCount(page, 80); // fits A4 up to 90 cards at 0.32 mm each
  await expect(page.locator('#status')).toBeHidden(); // no "larger than the printable area"
  await expect(page.locator('.summary-item', { hasText: 'Pages' }).locator('.summary-value')).toHaveText('2');
  const zip = await download(page, () => page.click('#downloadSvg')); // one SVG per page
  expect(zip.name).toBe('twoPieceLock-box-cut.zip');

  // Past that the lid is wider than A4's printable area, and the page says so.
  await setCardCount(page, 100);
  await expect(page.locator('#status')).toContainText('larger than the printable area');
});

// Tuck lock slits are cut along the tuck flap's fold; the fold must run up
// to them but never be scored over them.
for (const style of ['tuck', 'tuckFixed']) test(`${style}: tuck lock slits sit on the fold, which is not scored over them`, async ({ page }) => {
  await selectStyle(page, style);
  const svg = (await download(page, () => page.click('#downloadSvg'))).text();
  const pts = (d) => [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [+m[1], +m[2]]);
  const slits = [...svg.matchAll(/<path d="([^"]+)"[^>]*stroke="#e03131"/g)].map((m) => m[1])
    .filter((d) => !d.trim().endsWith('Z')).map(pts);
  const folds = [...svg.matchAll(/<path d="([^"]+)"[^>]*stroke="#e08e0b"/g)].map((m) => pts(m[1]));
  expect(slits.length).toBeGreaterThan(0);
  for (const [p, q] of slits) {
    // Work along the slit's own axis: u runs along it, v across it.
    const horizontal = Math.abs(p[1] - q[1]) < 0.01;
    const u = (r) => (horizontal ? r[0] : r[1]);
    const v = (r) => (horizontal ? r[1] : r[0]);
    const onLine = folds.filter(([a, b]) => Math.abs(v(a) - v(p)) < 0.01 && Math.abs(v(b) - v(p)) < 0.01);
    expect(onLine.length, `a fold runs along the slit at ${p}`).toBeGreaterThan(0);
    const [s0, s1] = [Math.min(u(p), u(q)), Math.max(u(p), u(q))];
    for (const [a, b] of onLine) { // …but stops at the slit's ends
      const [lo, hi] = [Math.min(u(a), u(b)), Math.max(u(a), u(b))];
      expect(hi <= s0 + 0.01 || lo >= s1 - 0.01, `fold ${a}–${b} scored over the slit ${p}–${q}`).toBe(true);
    }
  }
});

// Corner locks: each slit sits inside its lock flap, two paper thicknesses
// (at least 0.5 mm) from the fold, so it opens on the right side of the bend.
for (const style of ['tuckLock', 'tuckFixedLock', 'sleeveLock']) test(`${style}: corner slits sit just inside the lock flap`, async ({ page }) => {
  await selectStyle(page, style);
  const check = async (paper) => page.evaluate((expected) => {
    const pieces = buildBox($('boxStyle').value, readConfig());
    const out = [];
    pieces.forEach((piece) => piece.slits.forEach(([a, b]) => {
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const flap = piece.panels.find((p) => /lockFlap|backFlap/.test(p.id)
        && mid[0] > p.box.x && mid[0] < p.box.x + p.box.w && mid[1] > p.box.y && mid[1] < p.box.y + p.box.h);
      if (!flap && piece.panels.some((p) => p.id === 'tuckTop')) {
        // Not a corner slit: a tuck lock slit on the tuck fold.
        return;
      }
      if (!flap) { out.push({ ok: false, why: `slit at ${mid} is in no lock flap` }); return; }
      // Distance from the flap's fold edge (the side it shares with the back).
      const vertical = Math.abs(a[0] - b[0]) < 1e-6;
      const back = piece.panels.find((p) => p.id === 'back').box;
      const fold = vertical
        ? (Math.abs(flap.box.x + flap.box.w - back.x) < 1e-6 ? back.x : back.x + back.w)
        : back.y + back.h;
      const dist = vertical ? Math.abs(mid[0] - fold) : Math.abs(mid[1] - fold);
      out.push({ ok: Math.abs(dist - expected) < 1e-6, why: `${flap.id} slit ${dist.toFixed(3)} mm from its fold` });
    }));
    return out;
  }, Math.max(0.5, 2 * paper));
  const atDefault = await check(0.3);
  expect(atDefault.length).toBeGreaterThan(0);
  for (const r of atDefault) expect(r.ok, r.why).toBe(true);

  await page.fill('#paperThickness__display', '0.5');
  await page.press('#paperThickness__display', 'Tab');
  for (const r of await check(0.5)) expect(r.ok, r.why).toBe(true);
});

// Hook tabs: one barb each, heads only a barb wider than the neck, slits a
// little longer than the neck; paired barbs point away from each other. The
// barb's lip sits Tab lip × paper thickness from the side's edge (3 × 0.3 mm
// by default).
for (const style of ['tuckLock', 'tuckFixedLock', 'sleeveLock']) test(`${style}: hook tabs fit their slits`, async ({ page }) => {
  await selectStyle(page, style);
  const r = await page.evaluate(() => {
    const [piece] = buildBox($('boxStyle').value, readConfig());
    const tabs = piece.panels.filter((p) => /Tab\d/.test(p.id));
    // Each tab's root edge is its shared fold; measure across it.
    return tabs.map((tab) => {
      const [a, b] = [tab.poly[0], tab.poly[tab.poly.length - 1]]; // root endpoints
      const alongY = Math.abs(a[0] - b[0]) < 1e-6;
      const neck = alongY ? Math.abs(a[1] - b[1]) : Math.abs(a[0] - b[0]);
      const lo = Math.min(alongY ? a[1] : a[0], alongY ? b[1] : b[0]);
      const across = alongY ? tab.poly.map((q) => q[1]) : tab.poly.map((q) => q[0]);
      const head = Math.max(...across) - Math.min(...across);
      const barbBelow = Math.min(...across) < lo - 1e-6; // barb on the low side
      const lip = Math.hypot(tab.poly[1][0] - tab.poly[0][0], tab.poly[1][1] - tab.poly[0][1]); // root to barb lip
      return { id: tab.id, neck, head, lip, barbBelow, centre: lo + neck / 2 };
    }).concat([{ slits: piece.slits.map(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1])) }]);
  });
  const slits = r.pop().slits.filter((len) => len > 7); // tuck lock slits are shorter
  expect(slits.length).toBeGreaterThan(0);
  for (const len of slits) expect(len).toBeCloseTo(7.8, 5);
  for (const tab of r) {
    expect(tab.neck).toBeCloseTo(7, 5);
    expect(tab.head).toBeCloseTo(7 + 1.6, 5); // one barb, not a two-sided arrowhead
    expect(tab.lip).toBeCloseTo(3 * 0.3, 5); // 0.9 mm by default
  }
  // Tabs on the same edge (same kind of id) come in pairs with opposite barbs.
  const groups = {};
  r.forEach((t) => (groups[t.id.replace(/\d$/, '')] ||= []).push(t));
  Object.values(groups).filter((g) => g.length === 2).forEach(([a, b]) => {
    const [first, second] = a.centre < b.centre ? [a, b] : [b, a];
    expect(first.barbBelow).toBe(true);   // the lower tab's barb points down (outwards)…
    expect(second.barbBelow).toBe(false); // …the upper one's up
  });
});

// Tab lip: shown only for styles with hook tabs; it sets the barb's distance
// from the side in paper thicknesses, but never lets it end before the slit.
test('Tab lip sets how far the barb sits from the side', async ({ page }) => {
  const lips = () => page.evaluate(() => buildBox(styleId(), readConfig())[0].panels
    .filter((p) => /Tab\d/.test(p.id))
    .map((p) => Math.hypot(p.poly[1][0] - p.poly[0][0], p.poly[1][1] - p.poly[0][1])));

  await selectStyle(page, 'tuck');
  await expect(page.locator('#tabLipGroup')).toBeHidden();
  await selectStyle(page, 'tuckLock');
  await expect(page.locator('#tabLipGroup')).toBeVisible();
  await expect(page.locator('#tabLipHint')).toContainText('0.9 mm from the side');
  for (const lip of await lips()) expect(lip).toBeCloseTo(0.9, 5);

  await page.fill('#tabLip', '4');
  await page.press('#tabLip', 'Tab');
  await expect(page.locator('#tabLipHint')).toContainText('1.2 mm from the side');
  for (const lip of await lips()) expect(lip).toBeCloseTo(1.2, 5);

  // Too small to reach past the slit (0.6 mm into the flap): held just past it.
  await page.fill('#tabLip', '1');
  await page.press('#tabLip', 'Tab');
  for (const lip of await lips()) expect(lip).toBeCloseTo(0.7, 5);
});

// Dust flaps are square (not tapered) on the side that meets a tuck lock, so
// their corner catches in the lock slit: the front side at the top (the lid
// tucks in along the front), the back side at the bottom (only where the
// bottom tucks in too). Returns the square side per flap: 'a' is the flap's
// left end, 'b' its right end in the flat layout.
const EXPECTED_SQUARE = {
  tuck: { dust1: 'b', dust2: 'a', dust3: 'a', dust4: 'b' },
  tuckLock: { dust1: 'b', dust2: 'a', dust3: 'a', dust4: 'b' },
  tuckFixed: { dust1: 'b', dust2: 'a', dust3: '-', dust4: '-' },
  tuckFixedLock: { dust1: 'b', dust2: 'a', dust3: '-', dust4: '-' },
};
for (const [style, expected] of Object.entries(EXPECTED_SQUARE)) test(`${style}: dust flaps are square where they meet a tuck lock`, async ({ page }) => {
  await selectStyle(page, style);
  const square = await page.evaluate(() => {
    const [piece] = buildBox($('boxStyle').value, readConfig());
    const out = {};
    ['dust1', 'dust2', 'dust3', 'dust4'].forEach((id) => {
      const q = piece.panels.find((p) => p.id === id).poly;
      // A square side runs straight out from the fold: its two outer points share an x.
      const a = Math.abs(q[1][0] - q[2][0]) < 1e-9 ? 'a' : '';
      const b = Math.abs(q[3][0] - q[4][0]) < 1e-9 ? 'b' : '';
      out[id] = a + b || '-';
    });
    return out;
  });
  expect(square).toEqual(expected);
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

test('removing an image from the library releases its memory', async ({ page }) => {
  await trackRevokedUrls(page);
  await page.goto('PnPTuckBox/index.html');
  await addArt(page);
  const url = await page.evaluate(() => state.images[0].img.src);
  expect(url).toMatch(/^blob:/);
  await page.getByRole('button', { name: 'Remove art.png' }).click();
  expect(await revokedUrls(page)).toContain(url);
});

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
