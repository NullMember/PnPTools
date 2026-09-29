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
The smoke test loads CDN libraries, so it needs network access.

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
- UI helpers: `dropzone`, `filePicker`, `outputPreviewButton`/`previewOutput`, `toast`, `guard`/`allowLeave`. Every `dropzone` has a built-in "Pick from Inputs & outputs" button that offers only sets holding files its `accept` list takes. Use `filePicker` (with `browse`) for a file button that isn't a drop zone.
- Project files: `project`. A `.pnp` file is a zip containing `manifest.json` and `files/`, and the manifest's `tool` and project `name` must match the tool opening it. Passing `project` hooks to `PnP.init` shows a project name field and New / Open / Save / Save as in the top bar (Ctrl/⌘ S and Ctrl/⌘ Shift S too). Save names the file after the project name. Where the File System Access API exists (Chrome, Edge), Save writes back to the file the project was opened from or last saved to, and asks again after a rename; otherwise Save and Save as download. New reloads the page without its work, keeps settings and empties Inputs & outputs.
- Output file names: use `PnP.outputName(sources, 'suffix.ext', fallback)`. It gives `<source>_suffix.ext` for one source file, `<project name>_suffix.ext` for several, and the fallback otherwise. Per-file outputs keep the source's name plus a suffix (`Ace.jpg` becomes `Ace_bleed.png`). Helpers: `baseName`, `safeFileName`, `outputBase`.
- Inputs & outputs (the top-bar viewer and every file picker) are file sets in the handoff IndexedDB store, with `kind` set to `input` or `output`. The store keeps the newest 12 output and 8 input sets and stays under 500 MB in total (`MAX_BYTES`), dropping the oldest first; the viewer shows the space used and has Clear all. Recording is mostly automatic: `dropzone` records the files it takes in, and `downloadBlob` records every download (a zip is recorded as its contents). Use `downloadBlob` for all output downloads, and pass `{ record: false }` for project files. A tool that produces results without downloading them calls `PnP.recordFiles({ items })` itself (CardCrop does after cropping).
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
