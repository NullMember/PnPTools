# PnPTools

Browser-only tools for print-and-play board game prep. Each tool is its own
repository (git submodule) and is also deployed on its own GitHub Pages site;
this hub links them together.

| Step | Tool | What it does |
| --- | --- | --- |
| 1 | PnPCardCrop | Crop cards out of PnP PDF sheets (duplex/fold aware) |
| 2 | PnPAlign | Align colour/rotation/scale/position of scanned cards |
| 2 | PnPBleed | Add bleed to card images |
| 3 | PnPLayout | Pack mixed-shape pieces (coins, tiles, tokens) onto sheets |
| 3 | PnPBooklet | Tile pages or impose saddle-stitch booklets |
| 4 | PnPCut | Cutting-machine grids, line-art editor, sheet assembler |
| 5 | PnPTuckBox | Tuck boxes, two-piece boxes and sleeves sized to a deck |

## Shared files

Edit shared code **only in the hub**, then run:

```sh
scripts/sync-shared.sh
```

It copies into every tool:

- `css/style.css` → `<tool>/css/style.css` (shared base + light/dark themes; tool rules live in `<tool>/css/tool.css`)
- `shared/*` → `<tool>/shared/` (runtime `pnp-shared.js`, theme script, icons)
- `shared/sw.js` → `<tool>/sw.js` and `./sw.js` (offline support)

and writes each folder's `manifest.webmanifest`. Tools never load files from
`../`, so they keep working when deployed standalone.
