# CLAUDE.md

Guidance for working in this repository.

## What this is

PnPTools is a set of browser-only print-and-play (board game) prep tools in one
repository. It uses plain static HTML/CSS/JS with **no build step and no bundler**.
`package.json` exists only for the Playwright tests (see Testing below). Everything
runs client-side and nothing is uploaded. The site is deployed on GitHub Pages at
`https://nullmember.github.io/PnPTools/`.

Each tool is a folder. (They used to be separate repos added as submodules; their
history was merged in with `git subtree`, and the old repos are archived with their
Pages sites redirecting here.)

| Folder | Purpose | Pages / entry points |
| --- | --- | --- |
| `PnPCardCrop` | Crop cards out of PnP PDF/image sheets | `index.html` (grid), `freeform.html` (vector editor), `script.js`, `js/freeform.js` |
| `PnPAlign` | Align colour/rotation/scale/position of scanned cards | `index.html`, `js/app.js` + helpers |
| `PnPBleed` | Add bleed to card images | `index.html`, `js/app.js`, `bleed.js`, `edge.js`, `sides.js` |
| `PnPLayout` | Pack odd-shaped pieces onto sheets, lay cards out in a grid with crop marks, or put fronts and backs on one page to fold | `index.html` (pack), `grid.html` (card grid), `fold.html`; one `js/app.js` reads the page's `data-mode`; `packer.js` runs in the `pack-worker.js` Web Worker, `grid.js` does grid and fold |
| `PnPBooklet` | Tile pages / impose saddle-stitch booklets | `index.html`, `js/main.js` + modules |
| `PnPCut` | Cutting-machine grids, line-art editor, sheet assembler | `index.html`, `editor.html`, `sheet.html` |
| `PnPTuckBox` | Tuck boxes, two-piece boxes, sleeves; print PDF + cut/score SVG | `index.html`, `js/app.js`, `geometry.js`, `render.js`, `art-editor.js` (per-panel crop / zoom / pan dialog) |

Root files: `index.html` (landing page), `css/style.css` (shared base styles),
`shared/` (shared scripts and icons), `sw.js` (the one service worker, serving every
page), `manifest.webmanifest`.

## Running locally

Serve the hub root over HTTP. Service workers and workers don't work from `file://`:

```sh
npm run serve                 # tests/serve.mjs, http://localhost:8765/
python3 -m http.server 8000   # or any static server
```

## Testing

The Playwright suite lives in `tests/`:

```sh
npm install && npx playwright install chromium   # once
npm test                                         # starts tests/serve.mjs itself
npx playwright test tests/pnpcut-sheet.spec.js   # one file
```

- `playwright.config.js` serves the repo root on port 8765 and blocks the service worker so it can't cache pages between tests.
- `tests/helpers.js` exports a `test` whose `page` fixture **fails the test on any page error or console error**. Import `test`/`expect` from there, not from `@playwright/test`. It also has `download()`, `dropFiles()` (a real drop event), `makeCardImages()` and `jsonFile()`. The fixture removes the File System Access pickers, because a native dialog would hang the test, so project Save downloads; `fakeFilePickers(page)` installs fakes that record writes in `window.__fs`.
- `tests/smoke.spec.js` checks that every page loads without errors. Add new pages to its list.
- Feature specs are named `<tool>-<page>.spec.js`.

Add or update tests with every change, and run the suite before finishing. Drive
the real UI (clicks, `setInputFiles`, drops) and assert on what the user sees or
downloads. Load pages by their path (`PnPBleed/index.html`), not `file://`.
CDN libraries are fetched once and then served from `tests/.cdn-cache/` (git-ignored),
so only the first run needs network access.

## Shared code

Tool pages load the shared files from the root: `../css/style.css` (base styles with
light/dark themes; tool-specific rules go in `<tool>/css/tool.css`) and `../shared/`
(`pnp-shared.js`, `pnp-shared.css`, `pnp-theme.js`, icons, and the vector editor:
`pnp-editor.js`, `pnp-editor.css`, `pathgeom.js`, `raster.js`). Cross-tool links go
through `PnP.toolUrl`/`PnP.hubUrl`, which resolve from the site root.

If you add a tool, add it to the `TOOLS` array in `shared/pnp-shared.js` and to the
hub `index.html`.

## Commits

**When to commit and push:**
- Commit after every implemented feature and every fixed bug, once its tests pass. Don't batch unrelated work into one commit.
- Push at the end of every session.

## Page conventions

The scripts are classic `<script>` tags, not ES modules. They expose globals (`PnP`,
`PnPEditor`, `PathGeom`, `Raster`) and the load order matters. A typical tool page:

```html
<link rel="stylesheet" href="../css/style.css">
<link rel="stylesheet" href="css/tool.css">
<link rel="manifest" href="../manifest.webmanifest">
<script src="../shared/pnp-theme.js"></script>        <!-- in <head>, prevents theme flash -->
<link rel="stylesheet" href="../shared/pnp-shared.css">
...
<script src="../shared/pnp-shared.js"></script>
<!-- editor pages: pathgeom.js, raster.js, pnp-editor.js (in that order) -->
<script src="js/app.js"></script>
```

- External libraries come from cdnjs with **pinned versions**. The service worker caches them cache-first. Current ones: pdf.js 3.11.174, pdf-lib 1.17.1, jsPDF 2.5.1, JSZip 3.10.1, FileSaver 2.0.5. Only `cdnjs.cloudflare.com` and Google Fonts hosts are cached (`CDN_HOSTS` in `sw.js`).
- All lengths are stored in **millimetres**. Mark length inputs with `data-unit="mm"`. `PnP.units` adds an mm/inch display proxy, and `.value` still returns mm.
- Sidebar `input`/`select`/`textarea` elements that have an `id` are auto-persisted to localStorage by `PnP.settings`. Use `data-persist="false"` to opt a field out. Use `data-persist="project"` to save a field only in `.pnp` project files.
- localStorage keys use the `pnp:` prefix (e.g. `pnp:theme`, `pnp:units`).

## `shared/pnp-shared.js`: the `PnP` global

Every tool calls this once:

```js
PnP.init({
  tool: 'PnPBleed',             // id from TOOLS
  settingsKey, settingsRoot,    // optional; defaults: tool id, .sidebar
  project: { getFiles, setFiles, getState, setState, fileName }, // enables .pnp save/load
  hasUnsavedWork: () => bool,   // beforeunload guard
  offlineFiles: [url],          // lazily loaded files (e.g. workers) to precache
});
```

Other APIs:
- Presets: `presets`, `bindPreset`, `swapButton`, `machinePresets`, `bindMachinePreset`.
- Cut files for cutting machines: `cutSvg`, `cutPath`, `inDeadMargin`, `svgSize`. Every exported SVG must get its size from `svgSize(wMm, hMm)`: width and height in inches with a mm viewBox. Cricut Design Space reads the width/height numbers as inches, so `mm` sizes import about 25× too large.
- Passing image sets between tools through IndexedDB: `handoff` (`handoff.receive(...)`) and `sendMenu`. See `itemsToFiles`.
- UI helpers: `dropzone`, `filePicker`, `outputPreviewButton`/`previewOutput`, `toast`, `guard`/`allowLeave`. Every `dropzone` has a built-in "Pick from library" button that offers only batches holding files its `accept` list takes. Use `filePicker` (with `browse`) for a file button that isn't a drop zone.
- The project: `project`, stored by `store` in IndexedDB (`pnptools-project`: `blobs` by content hash, so a file is kept once however many tools use it; `batches`, the library; `pages`, each tool page's work under its path such as `PnPCut/sheet.html`; `info`, the name and changed/saved times). Passing `project` hooks (`getFiles`, `setFiles`, `getState`, `setState`) to `PnP.init` makes the page restore its work when it opens and save it back as the user works (every 2 s while active, and when the tab is hidden; `PnP.project.autosave()` does it now, which tests use). The top bar has the project name and New / Open / Save / Save as (Ctrl/⌘ S, Ctrl/⌘ Shift S). A `.pnp` file is the whole project: a zip of `manifest.json` (version 2: name, every tool's settings from localStorage, pages, library, blob list) and `files/<hash>`. Version 1 files (one tool's settings, state and files) still open on their tool's page. Where the File System Access API exists, Save writes back to the file the project was opened from or last saved to, and asks again after a rename; otherwise Save and Save as download. New empties the project (settings stay) and asks first only if it changed since it was last saved. Leaving a page never warns: the work is already kept.
- Output file names: use `PnP.outputName(sources, 'suffix.ext', fallback)`. It gives `<source>_suffix.ext` for one source file, `<project name>_suffix.ext` for several, and the fallback otherwise. Per-file outputs keep the source's name plus a suffix (`Ace.jpg` becomes `Ace_bleed.png`). Helpers: `baseName`, `safeFileName`, `outputBase`.
- The library (top-bar "Library" and every file picker): files loaded into (`kind: 'input'`) or made by (`'output'`) the tools, in batches. Recording is mostly automatic: `dropzone` records the files it takes in, and `downloadBlob` records every download (a zip is recorded as its contents). Use `downloadBlob` for all output downloads, and pass `{ record: false }` for project files. A tool that produces results without downloading them calls `PnP.recordFiles({ items })` itself (CardCrop does after cropping). "Send to" still passes files through the separate `handoff` store.
- The library window (`PnP.library.open()`, the top-bar button): select items (click toggles, Shift-click selects a range), set their size in mm (card presets or typed), the bleed already in the image, front or back and a back image, edit one image (double-click: crop and quarter turns), View, Remove, and "Use in this tool", which hands them to the page's first image drop zone. Item edits live in each item's `meta` (`widthMm`, `heightMm`, `bleedMm`, `role`, `back`, `rotate`, `crop` as fractions) and don't change the stored file: `PnP.library.itemFile(item)` makes the file a tool gets, turned, cropped, stretched to the mm proportions and stamped with its DPI and `PnPTools:bleed`, so tools that read those (Layout, Bleed, TuckBox) size it right. `itemsForTool` adds the chosen backs after the fronts, as backs. Pickers deliver items the same way.
- Size notes: PNGs carry their card size (`PnP.setSizeNote`, text note `PnPTools:size` = `63x88`, mm without bleed) and bleed (`PnPTools:bleed`); `PnP.readSizeNotes(blob)` reads both. CardCrop writes the size on every crop, Bleed on every output, the library on items with a size. The library fills in an item's properties from its notes when it arrives (kept as `meta.file`, so an unedited item reaches tools as it is), and Bleed and Layout prefer a recorded size over DPI, which many images carry as a meaningless 72.
- File and image helpers: `zip` (dependency-free zip writer/reader), `downloadBlob`, `canvasToBlob`, `readImageDpi`, `setPngDpi`.

`shared/pnp-editor.js` exposes `PnPEditor.create({...})`, the vector editor used by
PnPCut's `editor.html` and PnPCardCrop's `freeform.html`. The options are documented
at the top of that file, and there is one editor per page because its element ids are fixed.
`pathgeom.js` handles Bézier path geometry without touching the DOM. `raster.js` contains
the mask, distance-transform and outline-tracing helpers.

## Offline / PWA

`sw.js` (at the root, serving every page) fetches same-origin files network-first and
pinned CDN files cache-first. Pages post the resources they load so the worker
precaches them. Bump `CACHE` (`pnptools-vN`) when old caches need dropping. Pages
unregister any other service worker (the per-tool ones from before the merge).
