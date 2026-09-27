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
