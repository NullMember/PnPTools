# PnPTools

Browser-only tools for print-and-play board game prep, at
https://nullmember.github.io/PnPTools/. Everything runs in the browser and
works offline.

| Step | Tool | What it does |
| --- | --- | --- |
| 1 | PnPCardCrop | Crop cards out of PnP PDF sheets (duplex/fold aware) |
| 2 | PnPAlign | Align colour/rotation/scale/position of scanned cards |
| 2 | PnPBleed | Add bleed to cards and shapes |
| 3 | PnPLayout | Pack pieces, lay cards out in a grid, or fold fronts and backs |
| 3 | PnPBooklet | Print rulebooks several pages to a sheet, or as booklets |
| 4 | PnPCut | Cutting-machine grids, line-art editor, sheet assembler |
| 5 | PnPTuckBox | Tuck boxes, two-piece boxes and sleeves sized to a deck |

Each tool is a folder of this repository. They used to be separate
repositories; their history was merged in, and their old sites redirect here.
Shared code lives in `shared/` and `css/style.css`, and every page loads it
from there.
