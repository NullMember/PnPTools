// Corner removal: punches transparent holes into a copy of the source pixel
// data; the holes are patched by fillTransparentPixels() (see edge.js) before
// the bleed is drawn. (Removed edges are cut off instead: see addBleedToCard.)

// Remove pixels from the four corners using circular arc algorithm
// Circle center is inside the card at (radius, radius) from corner
function removeWhiteCorners(sourceData, w, h, cornerSize) {
    const processed = new Uint8ClampedArray(sourceData);

    const corners = [
        { x: 0, y: 0, cx: cornerSize, cy: cornerSize }, // top-left
        { x: w - 1, y: 0, cx: w - 1 - cornerSize, cy: cornerSize }, // top-right
        { x: 0, y: h - 1, cx: cornerSize, cy: h - 1 - cornerSize }, // bottom-left
        { x: w - 1, y: h - 1, cx: w - 1 - cornerSize, cy: h - 1 - cornerSize } // bottom-right
    ];

    for (const corner of corners) {
        const minX = Math.max(0, corner.x - cornerSize);
        const maxX = Math.min(w - 1, corner.x + cornerSize);
        const minY = Math.max(0, corner.y - cornerSize);
        const maxY = Math.min(h - 1, corner.y + cornerSize);

        for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
                // Calculate distance from circle center (which is inside the card)
                const dx = x - corner.cx;
                const dy = y - corner.cy;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // Remove if OUTSIDE the circular arc
                if (distance > cornerSize) {
                    const idx = (y * w + x) * 4;
                    processed[idx + 3] = 0; // Make transparent
                }
            }
        }
    }

    return processed;
}
