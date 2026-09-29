// Shared test helpers. `test` fails any test whose page throws or logs a
// console error; import { test, expect } from here instead of @playwright/test.
// Its pages have no File System Access pickers (a native dialog would hang
// the test), so project Save downloads; `fakeFilePickers` puts fakes back.
const fs = require('node:fs');
const base = require('@playwright/test');

// CDN libraries are pinned versions, so a copy fetched once serves every
// later test from disk (tests/.cdn-cache): a slow or stalled CDN request
// can't time a test out.
const path = require('node:path');
const crypto = require('node:crypto');
const CDN_CACHE = path.join(__dirname, '.cdn-cache');

async function serveCdnFromCache(page) {
  await page.route('https://cdnjs.cloudflare.com/**', async (route) => {
    const url = route.request().url();
    const file = path.join(CDN_CACHE, crypto.createHash('sha1').update(url).digest('hex'));
    if (fs.existsSync(file)) {
      const meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
      await route.fulfill({ status: 200, contentType: meta.type, headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(file) });
      return;
    }
    const response = await route.fetch();
    if (response.ok()) {
      fs.mkdirSync(CDN_CACHE, { recursive: true });
      fs.writeFileSync(file, await response.body());
      fs.writeFileSync(`${file}.json`, JSON.stringify({ type: response.headers()['content-type'] || 'application/javascript' }));
    }
    await route.fulfill({ response });
  });
}

const test = base.test.extend({
  page: async ({ page }, use) => {
    await serveCdnFromCache(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('dialog', (d) => d.accept());
    await page.addInitScript(() => {
      delete window.showSaveFilePicker;
      delete window.showOpenFilePicker;
    });
    await use(page);
    base.expect(errors, 'page errors').toEqual([]);
  },
});

// Click something that downloads a file; returns its name, path and text.
async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const file = test.info().outputPath(dl.suggestedFilename());
  await dl.saveAs(file);
  return { name: dl.suggestedFilename(), path: file, text: () => fs.readFileSync(file, 'utf8') };
}

// Card-sized test images drawn in the page: `alpha` has transparent rounded
// corners and a round transparent hole, `opaque` is a plain card.
async function makeCardImages(page) {
  const b64 = await page.evaluate(() => {
    const make = (alpha) => {
      const c = document.createElement('canvas');
      c.width = 315; c.height = 440;
      const g = c.getContext('2d');
      g.fillStyle = '#3366cc';
      if (alpha) {
        g.beginPath(); g.roundRect(0, 0, 315, 440, 30); g.fill();
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.arc(157, 220, 60, 0, Math.PI * 2); g.fill();
      } else {
        g.fillRect(0, 0, 315, 440);
        g.fillStyle = '#ffffff'; g.fillRect(100, 100, 100, 100);
      }
      return c.toDataURL('image/png').split(',')[1];
    };
    return { alpha: make(true), opaque: make(false) };
  });
  return {
    alpha: { name: 'Sticker.png', mimeType: 'image/png', buffer: Buffer.from(b64.alpha, 'base64') },
    opaque: { name: 'Plain.png', mimeType: 'image/png', buffer: Buffer.from(b64.opaque, 'base64') },
  };
}

// Drop files on an element with a real drop event (as a user dragging would).
async function dropFiles(page, selector, files) {
  await page.evaluate(({ selector, files }) => {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(new File([f.text], f.name, { type: f.type })));
    document.querySelector(selector).dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { selector, files });
}

// A cut-file SVG must state its size in inches that match its mm viewBox:
// Cricut Design Space reads the width/height numbers as inches.
function expectSvgSizeInInches(svgText, wMm, hMm) {
  const m = /<svg[^>]*\swidth="([\d.]+)in"[^>]*\sheight="([\d.]+)in"[^>]*\sviewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svgText);
  base.expect(m, 'svg width/height in inches with a mm viewBox').not.toBeNull();
  const [, wIn, hIn, vbW, vbH] = m.map(Number);
  base.expect(wIn * 25.4).toBeCloseTo(vbW, 2);
  base.expect(hIn * 25.4).toBeCloseTo(vbH, 2);
  if (wMm != null) base.expect(vbW).toBeCloseTo(wMm, 2);
  if (hMm != null) base.expect(vbH).toBeCloseTo(hMm, 2);
}

// Call before page.goto: afterwards `revokedUrls(page)` lists every blob URL
// the page has released (fetching a released URL would log a console error).
async function trackRevokedUrls(page) {
  await page.addInitScript(() => {
    window.__revoked = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (u) => { window.__revoked.push(u); revoke(u); };
  });
}
const revokedUrls = (page) => page.evaluate(() => window.__revoked);

// Call before page.goto: File System Access pickers that answer without a
// dialog. Save pickers return a handle named like the suggested name (or
// the next of `window.__pickNames`); written files land in `window.__fs`
// (name -> Blob). `window.__openFile` (a File) is what the open picker gives.
// `window.__pickerCalls` counts the pickers shown.
async function fakeFilePickers(page) {
  await page.addInitScript(() => {
    window.__fs = {};
    window.__pickNames = [];
    window.__pickerCalls = 0;
    const handle = (name) => ({
      kind: 'file',
      name,
      getFile: async () => new File([window.__fs[name] || window.__openFile], name),
      createWritable: async () => {
        const parts = [];
        return { write: async (b) => { parts.push(b); }, close: async () => { window.__fs[name] = new Blob(parts); } };
      },
    });
    window.showSaveFilePicker = async ({ suggestedName }) => {
      window.__pickerCalls++;
      return handle(window.__pickNames.shift() || suggestedName);
    };
    window.showOpenFilePicker = async () => {
      window.__pickerCalls++;
      window.__fs[window.__openFile.name] = window.__openFile;
      return [handle(window.__openFile.name)];
    };
  });
}

const jsonFile = (name, data) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });

module.exports = { test, fakeFilePickers, expect: base.expect, download, makeCardImages, dropFiles, jsonFile, expectSvgSizeInInches, trackRevokedUrls, revokedUrls };
