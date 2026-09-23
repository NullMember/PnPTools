#!/bin/sh
# Copy the canonical shared files from the hub into every tool submodule, so
# each tool also works when deployed on its own. Run after editing any of:
#   css/style.css        shared base stylesheet (tools add css/tool.css)
#   shared/*             runtime, theme script, icons, service worker
# Also writes each folder's sw.js (service workers must sit next to the pages
# they serve) and manifest.webmanifest (installable app metadata).
set -e
cd "$(dirname "$0")/.."

# folder|app name|short name|description
TOOLS="PnPCardCrop|PnP Card Cropper|CardCrop|Crop cards out of print-and-play PDF sheets.
PnPAlign|PnP Align|Align|Align colour, rotation, scale and position of scanned cards.
PnPBleed|PnP Bleed|Bleed|Add printer bleed to card images.
PnPLayout|PnP Layout|Layout|Pack mixed-shape pieces tightly onto printable sheets.
PnPBooklet|PnP Booklet|Booklet|Tile pages into sheets or impose saddle-stitch booklets.
PnPCut|PnP Cut|Cut|Cutting-machine grids and line art for print-and-play cards.
PnPTuckBox|PnP Tuck Box|TuckBox|Printable tuck boxes, two-piece boxes and sleeves for card decks."

# Tools that host the shared vector editor (shared/pnp-editor.js)
EDITOR_TOOLS="PnPCut PnPCardCrop"

manifest() { # dir name short description
    cat > "$1/manifest.webmanifest" <<EOF
{
  "name": "$2",
  "short_name": "$3",
  "description": "$4",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#0f1117",
  "theme_color": "#1a1d27",
  "icons": [
    { "src": "shared/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "shared/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "shared/icon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
EOF
}

cp shared/sw.js sw.js
manifest . "PnPTools" "PnPTools" "Print-and-play preparation tools that run entirely in your browser."

echo "$TOOLS" | while IFS='|' read -r tool name short desc; do
    mkdir -p "$tool/shared" "$tool/css"
    cp shared/pnp-shared.js shared/pnp-shared.css shared/pnp-theme.js \
       shared/icon.svg shared/icon-192.png shared/icon-512.png "$tool/shared/"
    # The vector editor only goes to tools that use it.
    case " $EDITOR_TOOLS " in
        *" $tool "*) cp shared/pnp-editor.js shared/pnp-editor.css shared/pathgeom.js shared/raster.js "$tool/shared/" ;;
    esac
    cp css/style.css "$tool/css/style.css"
    cp shared/sw.js "$tool/sw.js"
    manifest "$tool" "$name" "$short" "$desc"
    echo "synced $tool"
done
