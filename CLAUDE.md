# CLAUDE.md

Guidance for working in this repository.

## What this is

PnPTools is a hub for browser-only print-and-play (board game) prep tools. It uses
plain static HTML/CSS/JS with **no build step and no bundler**. The hub's
`package.json` exists only for the Playwright tests (see Testing below); the tools
have no dependencies. Everything runs client-side and nothing is uploaded. The site is
deployed on GitHub Pages at `https://nullmember.github.io/PnPTools/`.

Each tool is its **own git repo, added here as a submodule** (github.com/NullMember/<Tool>).
Each tool is also deployed standalone on its own Pages site:

| Folder | Purpose | Pages / entry points |
| --- | --- | --- |
| `PnPCardCrop` | Crop cards out of PnP PDF/image sheets | `index.html` (grid), `freeform.html` (vector editor), `script.js`, `js/freeform.js` |
| `PnPAlign` | Align colour/rotation/scale/position of scanned cards | `index.html`, `js/app.js` + helpers |
| `PnPBleed` | Add bleed to card images | `index.html`, `js/app.js`, `bleed.js`, `edge.js`, `sides.js` |
| `PnPLayout` | Pack odd-shaped pieces onto sheets | `index.html`, `js/app.js`, `packer.js` run in the `pack-worker.js` Web Worker |
| `PnPBooklet` | Tile pages / impose saddle-stitch booklets | `index.html`, `js/main.js` + modules |
| `PnPCut` | Cutting-machine grids, line-art editor, sheet assembler | `index.html`, `editor.html`, `sheet.html` |
| `PnPTuckBox` | Tuck boxes, two-piece boxes, sleeves; print PDF + cut/score SVG | `index.html`, `js/app.js`, `geometry.js`, `render.js` |

Hub-level files: `index.html` (landing page), `css/style.css`, `shared/`,
`scripts/sync-shared.sh`, `sw.js`, `manifest.webmanifest`.

## Running locally

Serve the hub root over HTTP. Service workers and workers don't work from `file://`:

```sh
npm run serve                 # tests/serve.mjs, http://localhost:8765/
python3 -m http.server 8000   # or any static server
```

## Testing

The Playwright suite lives in the hub, never in tool folders, because each tool
folder is deployed as-is:

```sh
npm install && npx playwright install chromium   # once
npm test                                         # starts tests/serve.mjs itself
npx playwright test tests/pnpcut-sheet.spec.js   # one file
```

- `playwright.config.js` serves the repo root on port 8765 and blocks the service worker so it can't cache pages between tests.
- `tests/helpers.js` exports a `test` whose `page` fixture **fails the test on any page error or console error**. Import `test`/`expect` from there, not from `@playwright/test`. It also has `download()`, `dropFiles()` (a real drop event), `makeCardImages()` and `jsonFile()`.
- `tests/smoke.spec.js` checks that every page loads without errors. Add new pages to its list.
- Feature specs are named `<tool>-<page>.spec.js`.

Add or update tests with every change, and run the suite before finishing. Drive
the real UI (clicks, `setInputFiles`, drops) and assert on what the user sees or
downloads. Load pages from the hub URL (`PnPBleed/index.html`), not `file://`.
The smoke test loads CDN libraries, so it needs network access.

## Shared code: edit only in the hub, then sync

The canonical shared files live in the hub. **Never edit the per-tool copies** in
`<tool>/shared/`, `<tool>/css/style.css`, `<tool>/sw.js` or `<tool>/manifest.webmanifest`.
The sync overwrites them. After you change shared code, run:

```sh
scripts/sync-shared.sh
```

This script copies:
- `css/style.css` to `<tool>/css/style.css`. This is the shared base with light/dark themes. Tool-specific rules go in `<tool>/css/tool.css`.
- `pnp-shared.js`, `pnp-shared.css`, `pnp-theme.js` and the icons to every `<tool>/shared/`.
- The vector editor (`pnp-editor.js`, `pnp-editor.css`, `pathgeom.js`, `raster.js`) only to the tools listed in `EDITOR_TOOLS` in the script (currently PnPCut and PnPCardCrop).
- `shared/sw.js` to `./sw.js` and to each `<tool>/sw.js`.

It also regenerates each folder's `manifest.webmanifest` from the `TOOLS` table in
the script. If you add a tool, update that table, `.gitmodules`, the `TOOLS` array
in `shared/pnp-shared.js` and the hub `index.html`.

Tools must **never load files from `../`**, because they have to work when deployed standalone.
Cross-tool links go through `PnP` helpers (`toolUrl`/`hubUrl`), which handle the
hub layout and the standalone layout.

## Commit workflow (submodules)

A shared change touches the hub and every tool repo:
1. Edit `shared/*` or `css/style.css` in the hub, then run `scripts/sync-shared.sh`.
2. Commit inside each submodule. By convention the message is `Sync shared runtime: <what changed>`.
3. Commit in the hub. This commit includes the shared source change and the bumped submodule pointers.

A tool-only change is committed in that submodule, then the pointer is bumped in the hub.

**When to commit and push:**
- Commit after every implemented feature and every fixed bug, once its tests pass. Don't batch unrelated work into one commit.
- Push at the end of every session: each changed submodule first, then the hub, so the hub never points at submodule commits that aren't on GitHub.
- Submodules must be on `main` before committing. After `git submodule update` they sit on a detached HEAD; run `git -C <tool> checkout main` first.

## Page conventions

The scripts are classic `<script>` tags, not ES modules. They expose globals (`PnP`,
`PnPEditor`, `PathGeom`, `Raster`) and the load order matters. A typical tool page:

```html
<link rel="stylesheet" href="css/style.css">
<link rel="stylesheet" href="css/tool.css">
<script src="shared/pnp-theme.js"></script>        <!-- in <head>, prevents theme flash -->
<link rel="stylesheet" href="shared/pnp-shared.css">
...
<script src="shared/pnp-shared.js"></script>
<!-- editor pages: pathgeom.js, raster.js, pnp-editor.js (in that order) -->
<script src="js/app.js"></script>
```

- External libraries come from cdnjs with **pinned versions**. The service worker caches them cache-first. Current ones: pdf.js 3.11.174, pdf-lib 1.17.1, jsPDF 2.5.1, JSZip 3.10.1, FileSaver 2.0.5. Only `cdnjs.cloudflare.com` and Google Fonts hosts are cached (`CDN_HOSTS` in `shared/sw.js`).
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
- Cut files for cutting machines: `cutSvg`, `cutPath`, `inDeadMargin`.
- Passing image sets between tools through IndexedDB: `handoff` (`handoff.receive(...)`) and `sendMenu`. See `itemsToFiles`.
- UI helpers: `dropzone`, `filePicker`, `outputPreviewButton`/`previewOutput`, `toast`, `guard`/`allowLeave`. Every `dropzone` has a built-in "Pick from Inputs & outputs" button that offers only sets holding files its `accept` list takes. Use `filePicker` (with `browse`) for a file button that isn't a drop zone.
- Project files: `project`. A `.pnp` file is a zip containing `manifest.json` and `files/`, and the manifest's `tool` must match the tool opening it. Passing `project` hooks to `PnP.init` shows New / Open / Save in the top bar. New reloads the page without its work and keeps settings. It also removes the Inputs & outputs entries recorded on that page (each set stores its `page` path).
- Inputs & outputs (the top-bar viewer and every file picker) are file sets in the handoff IndexedDB store, with `kind` set to `input` or `output`. Recording is mostly automatic: `dropzone` records the files it takes in, and `downloadBlob` records every download (a zip is recorded as its contents). Use `downloadBlob` for all output downloads, and pass `{ record: false }` for project files. A tool that produces results without downloading them calls `PnP.recordFiles({ items })` itself (CardCrop does after cropping).
- File and image helpers: `zip` (dependency-free zip writer/reader), `downloadBlob`, `canvasToBlob`, `readImageDpi`, `setPngDpi`.

`shared/pnp-editor.js` exposes `PnPEditor.create({...})`, the vector editor used by
PnPCut's `editor.html` and PnPCardCrop's `freeform.html`. The options are documented
at the top of that file, and there is one editor per page because its element ids are fixed.
`pathgeom.js` handles Bézier path geometry without touching the DOM. `raster.js` contains
the mask, distance-transform and outline-tracing helpers.

## Offline / PWA

`shared/sw.js` fetches same-origin files network-first and pinned CDN files cache-first.
Pages post the resources they load so the worker precaches them. Bump `CACHE`
(`pnptools-vN`) when old caches need dropping. A service worker must sit next to the
pages it controls, which is why each tool root has a copy.
