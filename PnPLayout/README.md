# PnP Layout

Client-side tool for print-and-play components that aren't cards: coins, tokens,
hex tiles, boards and other odd shapes. Give it PNGs with transparent
surroundings and it packs every piece tightly onto as few sheets as possible,
following each piece's real outline.

- Per-piece size (mm, prefilled from the image's DPI), quantity and rotation lock (45° steps)
- Optional back image per piece, mirrored for long- or short-edge duplex, with X/Y offset correction
- Outline bleed, printed cut outlines and an SVG cut file for print-then-cut machines
- Everything runs in the browser; nothing is uploaded
