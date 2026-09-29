// Every page of the hub and every tool loads without errors. The shared
// `page` fixture fails the test on any page error or console error.
const { test, expect } = require('./helpers');

const PAGES = [
  'index.html',
  'PnPCardCrop/index.html',
  'PnPCardCrop/freeform.html',
  'PnPAlign/index.html',
  'PnPBleed/index.html',
  'PnPLayout/index.html',
  'PnPBooklet/index.html',
  'PnPCut/index.html',
  'PnPCut/editor.html',
  'PnPCut/sheet.html',
  'PnPTuckBox/index.html',
];

for (const path of PAGES) {
  test(`${path} loads`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toBeVisible();
    await page.waitForLoadState('networkidle');
  });
}

// Tool headings: title, description and page links on a single row.
for (const path of PAGES.filter((p) => p !== 'index.html')) {
  test(`${path} heading is one line`, async ({ page }) => {
    await page.goto(path);
    const boxes = await page.locator('header > h1, header > .subtitle, header > .tool-nav').evaluateAll((els) =>
      els.map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
    const rowTop = Math.max(...boxes.map((b) => b.top));
    const rowBottom = Math.min(...boxes.map((b) => b.bottom));
    expect(rowTop).toBeLessThan(rowBottom); // every part overlaps the same row
    const subtitle = page.locator('header > .subtitle');
    await expect(subtitle).toHaveAttribute('title', await subtitle.textContent());
  });
}

// Help tooltips: every "?" has text and can be reached with the keyboard.
for (const path of PAGES) {
  test(`${path} help tooltips have text`, async ({ page }) => {
    await page.goto(path);
    const tips = await page.locator('.help').evaluateAll((els) => els.map((el) => ({
      tip: (el.dataset.tip || '').trim(),
      tabindex: el.getAttribute('tabindex'),
    })));
    for (const t of tips) {
      expect(t.tip.length).toBeGreaterThan(20);
      expect(t.tabindex).toBe('0');
    }
  });
}

// Phone width: nothing scrolls sideways, and the top bar fits the screen.
test.describe('at phone width', () => {
  test.use({ viewport: { width: 390, height: 800 } });
  for (const path of PAGES) {
    test(`${path} fits a phone screen`, async ({ page }) => {
      await page.goto(path);
      const fit = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const bar = document.querySelector('.pnp-topbar');
        return {
          page: document.documentElement.scrollWidth <= width,
          bar: !bar || [...bar.querySelectorAll('*')].every((el) => el.getBoundingClientRect().right <= width + 1),
        };
      });
      expect(fit).toEqual({ page: true, bar: true });
    });
  }
});
