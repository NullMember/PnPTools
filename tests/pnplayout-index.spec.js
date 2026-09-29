// PnPLayout (PnPLayout/index.html): piece sizes, quantities, backs and exports.
const fs = require('node:fs');
const { test, expect, download, makeCardImages } = require('./helpers');

const status = (page) => page.locator('#status');
const rows = (page) => page.locator('#pieceList .piece');

// A plain 63 × 88 mm card image at `dpi`, with the DPI recorded or not;
// `bleed` mm of bleed around it makes the image that much bigger.
async function card(page, dpi, { record = true, name = 'Card.png', bleed = 0, color = '#3366cc' } = {}) {
  const b64 = await page.evaluate(async ({ dpi, record, bleed, color }) => {
    const c = document.createElement('canvas');
    c.width = Math.round((63 + 2 * bleed) / 25.4 * dpi);
    c.height = Math.round((88 + 2 * bleed) / 25.4 * dpi);
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    let blob = await PnP.canvasToBlob(c);
    if (record) blob = await PnP.setImageDpi(blob, dpi);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s);
  }, { dpi, record, bleed, color });
  return { name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

const pdfPages = (page, file) => page.evaluate(async (bytes) => (await PDFLib.PDFDocument.load(new Uint8Array(bytes))).getPageCount(), [...fs.readFileSync(file.path)]);

test.beforeEach(async ({ page }) => {
  await page.goto('PnPLayout/index.html');
});

test('a piece is sized from the DPI in its file', async ({ page }) => {
  await page.setInputFiles('#imageInput', await card(page, 600));
  await expect(status(page)).toContainText('1 piece(s)');
  await expect(rows(page).locator('.piece-size')).toContainText('63');
});

test('images without DPI use the default DPI setting', async ({ page }) => {
  await page.fill('#defaultDpi', '150');
  await page.setInputFiles('#imageInput', await card(page, 300, { record: false }));
  await expect(status(page)).toContainText('1 piece(s)');
  const width = await page.evaluate(() => [...state.pieces.values()][0].widthMm);
  expect(width).toBeCloseTo(126, 0); // 744 px at 150 DPI
});

test('the quantity fills more sheets', async ({ page }) => {
  await page.setInputFiles('#imageInput', await card(page, 300));
  await expect(status(page)).toContainText('1 piece(s) on 1 sheet(s)');
  await rows(page).getByLabel('Quantity').fill('12');
  await expect(status(page)).toContainText('12 piece(s) on 2 sheet(s)');
});

test('a piece too large for the page is reported by name', async ({ page }) => {
  await page.setInputFiles('#imageInput', await card(page, 300, { name: 'Board.png' }));
  await expect(status(page)).toContainText('1 piece(s)');
  await page.fill('#pw1__display', '400');
  await expect(status(page)).toContainText('Too large for the printable area: Board');
});

test('removing the last piece empties the layout', async ({ page }) => {
  const img = await makeCardImages(page);
  await page.setInputFiles('#imageInput', [img.alpha, img.opaque]);
  await expect(rows(page)).toHaveCount(2);
  await rows(page).first().getByRole('button', { name: 'Remove piece' }).click();
  await rows(page).first().getByRole('button', { name: 'Remove piece' }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator('#downloadPdf')).toBeDisabled();
});

test('a back image adds a back page after each front page', async ({ page }) => {
  await page.setInputFiles('#imageInput', await card(page, 300));
  await expect(status(page)).toContainText('1 piece(s) on 1 sheet(s)');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), rows(page).locator('.piece-face.back').click()]);
  await chooser.setFiles(await card(page, 300, { name: 'Back.png' }));
  await expect(rows(page).locator('.piece-face.back img, .piece-face.back canvas')).toHaveCount(1);
  await expect(status(page)).toContainText('back');
  const pdf = await download(page, () => page.click('#downloadPdf'));
  expect(await pdfPages(page, pdf)).toBe(2);
});

test.describe('grid mode', () => {
  const setMode = async (page, mode) => {
    await page.selectOption('#packMode', mode);
  };
  // Is something drawn at (x, y) mm on the first sheet (not white paper)?
  const darkAt = (page, x, y) => page.evaluate(({ x, y }) => {
    const c = document.querySelector('#sheetGrid canvas');
    const k = c.width / readSettings().paper.w;
    const [r, g, b] = c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
    return r + g + b < 700;
  }, { x, y });

  test('cards line up in rows and columns, centred on the page', async ({ page }) => {
    await expect(page.locator('#cropMarksGroup')).toBeHidden();
    await setMode(page, 'grid');
    await expect(page.locator('#cropMarksGroup')).toBeVisible();
    await expect(page.locator('#precisionGroup')).toBeHidden();
    await page.setInputFiles('#imageInput', await card(page, 300));
    await rows(page).getByLabel('Quantity').fill('10');
    // A4, 7 mm margins, 2 mm gap: 3 × 3 poker cards.
    await expect(status(page)).toContainText('10 piece(s) on 2 sheet(s)');
    await expect(status(page)).toContainText('3 × 3 per sheet');
    const first = await page.evaluate(() => state.layout.sheets[0].slice(0, 2));
    // (196 − 193) / 2 + 7 + 31.5 across; the card image is 87.98 mm tall.
    expect(first[0].angle).toBe(0);
    expect(first[0].cx).toBeCloseTo(40, 5);
    expect(first[0].cy).toBeCloseTo(58.5, 1);
    expect(first[1].cx - first[0].cx).toBeCloseTo(65, 5); // card + gap
  });

  test('cards turn sideways when that fits more, unless rotation is off', async ({ page }) => {
    await setMode(page, 'grid');
    await page.fill('#paperW__display', '297');
    await page.fill('#paperH__display', '210');
    await page.setInputFiles('#imageInput', await card(page, 300));
    await rows(page).getByLabel('Quantity').fill('9');
    await expect(status(page)).toContainText('3 × 3 per sheet'); // 4 × 2 upright
    expect(await page.evaluate(() => state.layout.sheets[0][0].angle)).toBe(90);
    await rows(page).getByLabel('Allow rotation').uncheck();
    await expect(status(page)).toContainText('4 × 2 per sheet');
  });

  test('crop marks sit in the margin in line with the cuts', async ({ page }) => {
    await setMode(page, 'grid');
    await page.setInputFiles('#imageInput', await card(page, 300));
    await expect(status(page)).toContainText('3 × 3 per sheet');
    // First cut at x = 8.5 mm; the grid starts at y = 14.5 mm, bleed 1 mm, marks 1 mm further out.
    const marks = await page.evaluate(() => cropMarks(state.layout.grid, readSettings().paper, readSettings().bleed));
    expect(marks).toHaveLength(24); // 6 vertical cut lines × 2 + 6 horizontal × 2
    const mark = marks.find(([x1, y1]) => x1 === 8.5 && y1 < 20);
    [8.5, 7.5, 8.5, 12.5].forEach((v, i) => expect(mark[i]).toBeCloseTo(v, 1));
    expect(await darkAt(page, 8.5, 10)).toBe(true);
    await page.uncheck('#cropMarks');
    await expect.poll(() => darkAt(page, 8.5, 10)).toBe(false);
  });

  test('a card too big for the page is reported', async ({ page }) => {
    await setMode(page, 'grid');
    await page.setInputFiles('#imageInput', await card(page, 300, { name: 'Board.png' }));
    await expect(status(page)).toContainText('1 piece(s)');
    await page.fill('#pw1__display', '400');
    await expect(status(page)).toContainText('Too large for the printable area: Board');
  });

  test('exports the grid with back pages', async ({ page }) => {
    await setMode(page, 'grid');
    await page.setInputFiles('#imageInput', await card(page, 300));
    await rows(page).getByLabel('Quantity').fill('10');
    await expect(status(page)).toContainText('on 2 sheet(s)');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), rows(page).locator('.piece-face.back').click()]);
    await chooser.setFiles(await card(page, 300, { name: 'Back.png' }));
    await expect(status(page)).toContainText('2 back page(s)');
    const pdf = await download(page, () => page.click('#downloadPdf'));
    expect(await pdfPages(page, pdf)).toBe(4);
  });
});

test.describe('images that already include bleed', () => {
  const piece = (page) => page.evaluate(() => {
    const p = [...state.pieces.values()][0];
    const s = readSettings();
    const outline = outlineOnSheet(p, { cx: 0, cy: 0, angle: 0 });
    const xs = outline.map(([x]) => x), ys = outline.map(([, y]) => y);
    return {
      widthMm: p.widthMm,
      heightMm: pieceHeightMm(p),
      cutW: Math.max(...xs) - Math.min(...xs),
      cutH: Math.max(...ys) - Math.min(...ys),
      printedExtra: faceComposite(p, p.front, s.bleed).extraMm,
    };
  });

  test('the card inside the bleed sets the size and the cut line', async ({ page }) => {
    await page.fill('#bleed__display', '0');
    await page.setInputFiles('#imageInput', await card(page, 300, { bleed: 3 }));
    await expect(status(page)).toContainText('1 piece(s)');
    expect((await piece(page)).widthMm).toBeCloseTo(69, 0); // the whole image

    await page.fill('#imageBleed__display', '3');
    await page.press('#imageBleed__display', 'Tab');
    await expect.poll(async () => (await piece(page)).widthMm).toBeCloseTo(63, 0);
    const p = await piece(page);
    expect(p.heightMm).toBeCloseTo(88, 0);
    expect(p.cutW).toBeCloseTo(63, 0);
    expect(p.cutH).toBeCloseTo(88, 0);
    expect(p.printedExtra).toBeCloseTo(3, 1); // the image's own bleed is still printed
  });

  test('pieces added later are trimmed too, and grid gaps leave room for the bleed', async ({ page }) => {
    await page.fill('#bleed__display', '0');
    await page.fill('#spacing__display', '0');
    await page.fill('#imageBleed__display', '3');
    await page.press('#imageBleed__display', 'Tab');
    await page.selectOption('#packMode', 'grid');
    await page.setInputFiles('#imageInput', await card(page, 300, { bleed: 3 }));
    await expect(status(page)).toContainText('1 piece(s)');
    expect((await piece(page)).widthMm).toBeCloseTo(63, 0);
    const grid = await page.evaluate(() => state.layout.grid);
    expect(grid.gap).toBeCloseTo(3, 5); // bleed of one card may reach the next card's cut, no further
  });
});

test.describe('adding backs', () => {
  const addBacks = async (page, files) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add backs…' }).click()]);
    await chooser.setFiles(files);
  };
  const backsOf = (page) => page.evaluate(() => [...state.pieces.values()].map((p) => (p.back ? p.back.file.name : null)));

  test('backs are matched to fronts by name', async ({ page }) => {
    await page.setInputFiles('#imageInput', [
      await card(page, 300, { name: 'Ace_front.png' }),
      await card(page, 300, { name: 'Game_front_0002.png' }),
      await card(page, 300, { name: 'King.png' }),
    ]);
    await expect(rows(page)).toHaveCount(3);
    await addBacks(page, [
      await card(page, 300, { name: 'Game_back_0002.png' }),
      await card(page, 300, { name: 'Ace back.png' }),
    ]);
    await expect(page.locator('.pnp-toast').last()).toContainText('2 of 3 pieces got a back');
    expect(await backsOf(page)).toEqual(['Ace back.png', 'Game_back_0002.png', null]);
  });

  test('without matching names, backs go on in order when the counts agree', async ({ page }) => {
    await page.setInputFiles('#imageInput', [await card(page, 300, { name: 'a.png' }), await card(page, 300, { name: 'b.png' })]);
    await expect(rows(page)).toHaveCount(2);
    await addBacks(page, [await card(page, 300, { name: 'x.png' }), await card(page, 300, { name: 'y.png' })]);
    await expect(page.locator('.pnp-toast').last()).toContainText('Every piece has a back');
    expect(await backsOf(page)).toEqual(['x.png', 'y.png']);
  });

  test('backs that match nothing are reported', async ({ page }) => {
    await page.setInputFiles('#imageInput', [await card(page, 300, { name: 'a.png' }), await card(page, 300, { name: 'b.png' })]);
    await expect(rows(page)).toHaveCount(2);
    await addBacks(page, [await card(page, 300, { name: 'x.png' }), await card(page, 300, { name: 'y.png' }), await card(page, 300, { name: 'z.png' })]);
    await expect(page.locator('.pnp-toast').last()).toContainText("Couldn't match 3 backs to 2 pieces");
    expect(await backsOf(page)).toEqual([null, null]);
  });
});

test('corner radius rounds the cut outline of rectangular cards only', async ({ page }) => {
  const img = await makeCardImages(page); // alpha: its own rounded shape
  await page.setInputFiles('#imageInput', [await card(page, 300, { name: 'Plain.png' }), img.alpha]);
  await expect(rows(page)).toHaveCount(2);
  await page.fill('#cornerRadius__display', '3');
  await page.press('#cornerRadius__display', 'Tab');
  const outlines = await page.evaluate(() => {
    const s = readSettings();
    return [...state.pieces.values()].map((p) => outlineOnSheet(p, { cx: 0, cy: 0, angle: 0 }, s.cornerRadius));
  });
  // Rounded rectangle: no point sits in the square corner, the arcs are 3 mm.
  const [rect, shaped] = outlines;
  const w = 63 / 2, h = 88 / 2;
  expect(rect.length).toBeGreaterThan(40);
  expect(rect.some(([x, y]) => Math.abs(x) > w - 0.5 && Math.abs(y) > h - 0.5)).toBe(false);
  expect(Math.max(...rect.map(([x]) => x))).toBeCloseTo(w, 0);
  // The traced shape is used as it is.
  const traced = await page.evaluate(() => { const p = [...state.pieces.values()][1]; return outlineOnSheet(p, { cx: 0, cy: 0, angle: 0 }, 0).length; });
  expect(shaped.length).toBe(traced);

  await expect(status(page)).toContainText('2 piece(s)');
  const svg = await download(page, () => page.click('#downloadSvg'));
  expect((svg.text().match(/<path /g) || []).length).toBeGreaterThanOrEqual(2);
});

test.describe('fold mode', () => {
  const setup = async (page, { qty = 4, back = true } = {}) => {
    await page.selectOption('#packMode', 'fold');
    await expect(page.locator('#foldGroup')).toBeVisible();
    await page.setInputFiles('#imageInput', await card(page, 300));
    await rows(page).getByLabel('Quantity').fill(String(qty));
    if (back) {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add backs…' }).click()]);
      await chooser.setFiles(await card(page, 300, { name: 'Back.png', color: '#cc3333' }));
      await expect(rows(page).locator('.piece-face.back img')).toHaveCount(1);
      // The status can still show the layout from before the back: wait for the repack.
      await expect.poll(() => page.evaluate(() => (state.layout && state.layout.fold ? state.layout.fold.backs[0].length : 0))).toBeGreaterThan(0);
    }
  };
  const layout = (page) => page.evaluate(() => ({ sheets: state.layout.sheets, fold: state.layout.fold, grid: state.layout.grid }));

  test('backs are the fronts mirrored across the fold', async ({ page }) => {
    await setup(page);
    // A4: four cards on their side fit either fold; auto takes the vertical one.
    await expect(status(page)).toContainText('4 piece(s) on 1 sheet(s)');
    await expect(status(page)).toContainText('backs across a vertical fold');
    const { sheets, fold } = await layout(page);
    expect(fold.at).toBeCloseTo(105, 5); // middle of the printable area
    expect(fold.backs[0]).toHaveLength(4);
    sheets[0].forEach((front, i) => {
      const back = fold.backs[0][i];
      expect(back.cx).toBeCloseTo(2 * fold.at - front.cx, 5);
      expect(back.cy).toBeCloseTo(front.cy, 5);
      expect(back.angle).toBe(-front.angle);
      expect(front.cx).toBeLessThan(fold.at); // fronts on one half
    });
    // Fold margin 2 mm: the grid ends 2 mm before the fold.
    const right = Math.max(...sheets[0].map((p) => p.cx)) + 88 / 2;
    expect(fold.at - right).toBeCloseTo(2, 0);
  });

  test('a horizontal fold turns the backs upside down', async ({ page }) => {
    await setup(page, { qty: 3 });
    await page.selectOption('#foldDirection', 'horizontal');
    await rows(page).getByLabel('Allow rotation').uncheck();
    await expect(status(page)).toContainText('3 × 1 per sheet, backs across a horizontal fold');
    const { sheets, fold } = await layout(page);
    expect(fold.backs[0][0].angle).toBe(180);
    expect(fold.backs[0][0].cy).toBeCloseTo(2 * fold.at - sheets[0][0].cy, 5);
  });

  test('the preview shows the backs beside the fronts, and the PDF has no back pages', async ({ page }) => {
    await setup(page);
    await expect(status(page)).toContainText('(1 PDF page(s))');
    await expect(page.locator('#sideToggle')).toBeHidden();
    const colours = await page.evaluate(() => {
      const c = document.querySelector('#sheetGrid canvas');
      const k = c.width / readSettings().paper.w;
      const at = (p) => [...c.getContext('2d').getImageData(Math.round(p.cx * k), Math.round(p.cy * k), 1, 1).data.slice(0, 3)];
      return { front: at(state.layout.sheets[0][0]), back: at(state.layout.fold.backs[0][0]) };
    });
    expect(colours.front[2]).toBeGreaterThan(150); // blue front
    expect(colours.back[0]).toBeGreaterThan(150); // red back
    const pdf = await download(page, () => page.click('#downloadPdf'));
    expect(await pdfPages(page, pdf)).toBe(1);
  });

  test('crop marks stay off the fold side', async ({ page }) => {
    await setup(page, { back: false });
    await expect(status(page)).toContainText('backs across a vertical fold');
    const { marks, fold } = await page.evaluate(() => {
      const s = readSettings();
      return { marks: cropMarks(state.layout.grid, s.paper, s.reach, state.layout.fold), fold: state.layout.fold };
    });
    expect(marks.length).toBeGreaterThan(0);
    marks.forEach(([x1, , x2]) => expect(Math.max(x1, x2)).toBeLessThan(fold.at));
    expect((await layout(page)).fold.backs[0]).toHaveLength(0); // no back image, nothing mirrored
  });
});

test.describe('grid size', () => {
  const manual = async (page, cols, rows) => {
    await page.selectOption('#gridSizeMode', 'manual');
    await page.fill('#gridCols', String(cols));
    await page.fill('#gridRows', String(rows));
  };

  test('rows and columns can be set by hand', async ({ page }) => {
    await page.selectOption('#packMode', 'grid');
    await expect(page.locator('#gridCountGroup')).toBeHidden();
    await page.setInputFiles('#imageInput', await card(page, 300));
    await rows(page).getByLabel('Quantity').fill('5');
    await manual(page, 2, 2);
    await expect(page.locator('#gridCountGroup')).toBeVisible();
    await expect(status(page)).toContainText('5 piece(s) on 2 sheet(s)');
    await expect(status(page)).toContainText('2 × 2 per sheet');
  });

  test('a grid that only fits on its side turns the cards', async ({ page }) => {
    await page.selectOption('#packMode', 'grid');
    await page.setInputFiles('#imageInput', await card(page, 300));
    await manual(page, 2, 4); // A4: 3 × 3 upright, 2 × 4 turned
    await expect(status(page)).toContainText('2 × 4 per sheet');
    expect(await page.evaluate(() => state.layout.sheets[0][0].angle)).toBe(90);
  });

  test('a grid too big for the page says so and uses the most that fits', async ({ page }) => {
    await page.selectOption('#packMode', 'grid');
    await page.setInputFiles('#imageInput', await card(page, 300));
    await rows(page).getByLabel('Allow rotation').uncheck();
    await manual(page, 5, 5);
    await expect(status(page)).toContainText("A 5 × 5 grid doesn't fit the printable area; using the most that fits: 3 × 3");
  });
});

test('each mode shows only its own settings', async ({ page }) => {
  const visible = async () => Object.fromEntries(await Promise.all(
    ['precisionGroup', 'cropMarksGroup', 'gridSizeGroup', 'foldGroup'].map(async (id) => [id, await page.locator(`#${id}`).isVisible()])));
  expect(await visible()).toEqual({ precisionGroup: true, cropMarksGroup: false, gridSizeGroup: false, foldGroup: false });
  await page.selectOption('#packMode', 'grid');
  expect(await visible()).toEqual({ precisionGroup: false, cropMarksGroup: true, gridSizeGroup: true, foldGroup: false });
  await page.selectOption('#packMode', 'fold');
  expect(await visible()).toEqual({ precisionGroup: false, cropMarksGroup: true, gridSizeGroup: true, foldGroup: true });
});

test('back pages get crop marks mirrored like the backs', async ({ page }) => {
  await page.selectOption('#packMode', 'grid');
  await page.setInputFiles('#imageInput', await card(page, 300));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Add backs…' }).click()]);
  await chooser.setFiles(await card(page, 300, { name: 'Back.png' }));
  await expect(status(page)).toContainText('1 back page(s)');
  const marks = await page.evaluate(() => {
    const s = readSettings();
    return { front: pageMarks(state.layout, s.paper, s, 'front'), back: pageMarks(state.layout, s.paper, s, 'back') };
  });
  expect(marks.back).toHaveLength(marks.front.length);
  // A4 portrait, long-edge flip: mirrored left to right.
  marks.front.forEach(([x1, y1], i) => {
    expect(marks.back[i][0]).toBeCloseTo(210 - x1, 5);
    expect(marks.back[i][1]).toBeCloseTo(y1, 5);
  });
  await page.locator('#sideToggle').getByRole('button', { name: 'Back' }).click();
  const drawn = await page.evaluate(() => {
    const c = document.querySelector('#sheetGrid canvas');
    const k = c.width / 210;
    const [r, g, b] = c.getContext('2d').getImageData(Math.round((210 - 8.5) * k), Math.round(10 * k), 1, 1).data;
    return r + g + b < 700;
  });
  expect(drawn).toBe(true);
});

test('zoom resizes the sheet previews', async ({ page }) => {
  await page.setInputFiles('#imageInput', await card(page, 300));
  await expect(status(page)).toContainText('1 piece(s)');
  const width = () => page.locator('#sheetGrid canvas').first().evaluate((c) => c.getBoundingClientRect().width);
  const before = await width();
  await page.locator('#sheetZoom').fill('200');
  await expect(page.locator('#sheetZoomValue')).toHaveText('200%');
  expect(await width()).toBeCloseTo(before * 2, 0);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(fits).toBe(true); // the sheets scroll, not the page
});

test('pieces sit side by side in one row that scrolls sideways', async ({ page }) => {
  const files = [];
  for (let i = 0; i < 10; i++) files.push(await card(page, 300, { name: `Card${i}.png` }));
  await page.setInputFiles('#imageInput', files);
  await expect(rows(page)).toHaveCount(10);
  const layout = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#pieceList .piece')].map((el) => el.getBoundingClientRect());
    const strip = document.querySelector('.piece-strip');
    return {
      oneRow: cards.every((r) => Math.abs(r.top - cards[0].top) < 1),
      scrolls: strip.scrollWidth > strip.clientWidth,
      pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    };
  });
  expect(layout).toEqual({ oneRow: true, scrolls: true, pageFits: true });
});
