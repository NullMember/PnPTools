// Full per-card render pipeline: color -> rotation -> position -> crop, at any target resolution.

const Render = (() => {
  function suggestedCrop(width, height, angleDeg) {
    const rad = (Math.abs(angleDeg) * Math.PI) / 180;
    if (rad < 1e-6) return { top: 0, right: 0, bottom: 0, left: 0 };
    const { w: iw, h: ih } = Geometry.rotatedRectWithMaxArea(width, height, rad);
    const tb = Math.ceil((height - ih) / 2) + 1;
    const lr = Math.ceil((width - iw) / 2) + 1;
    return { top: tb, bottom: tb, left: lr, right: lr };
  }

  // Renders one card at the given output max-dimension: color -> rotate -> position -> crop/fill.
  // card: { img, autoColorTransform, autoAngle, autoScale, autoOffset }
  function renderCard(card, options, maxDim) {
    const img = card.img;
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;

    // Resample so printed content matches the reference's physical pixel size.
    const cardScale = options.autoScaleEnabled && card.autoScale ? card.autoScale : 1;
    const targetW = naturalW * cardScale;
    const targetH = naturalH * cardScale;
    const previewScale = maxDim ? Math.min(1, maxDim / Math.max(targetW, targetH)) : 1;
    const w = Math.max(1, Math.round(targetW * previewScale));
    const h = Math.max(1, Math.round(targetH * previewScale));

    // Step 1: draw at working resolution (this also applies the scale correction)
    let canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    let ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    // Step 2: color
    if (options.colorEnabled) {
      const imageData = ctx.getImageData(0, 0, w, h);
      const auto = options.autoColorEnabled ? card.autoColorTransform : null;
      ColorAlign.applyToImageData(imageData, auto, options.manualColor || {});
      ctx.putImageData(imageData, 0, 0);
    }

    // Step 3: rotation
    let effectiveAngle = 0;
    if (options.rotationEnabled) {
      const auto = options.autoAngleEnabled ? card.autoAngle || 0 : 0;
      const manual = options.manualRotationDeg || 0;
      const perCard = options.perCardRotationDeg && options.perCardRotationDeg[card.id] || 0;
      effectiveAngle = auto + manual + perCard;
    }
    if (Math.abs(effectiveAngle) > 0.001) {
      const rotated = document.createElement('canvas');
      rotated.width = w;
      rotated.height = h;
      const rctx = rotated.getContext('2d');
      rctx.translate(w / 2, h / 2);
      rctx.rotate((effectiveAngle * Math.PI) / 180);
      rctx.translate(-w / 2, -h / 2);
      rctx.drawImage(canvas, 0, 0);
      canvas = rotated;
      ctx = rctx;
    }

    // Step 4: position — shifts content to land where the reference's does, so the
    // anchored crop below (step 5) removes the same content on every card.
    if (options.autoPositionEnabled && card.autoOffset) {
      const dx = Math.round(card.autoOffset.dx * previewScale);
      const dy = Math.round(card.autoOffset.dy * previewScale);
      if (dx !== 0 || dy !== 0) {
        const shifted = document.createElement('canvas');
        shifted.width = w;
        shifted.height = h;
        shifted.getContext('2d').drawImage(canvas, dx, dy);
        canvas = shifted;
      }
    }

    // Step 5: crop, anchored at an explicit (left, top) offset rather than re-centered — since
    // step 4 already lined content up, the same pixel amounts should come off the same edges
    // on every card. Clamps (doesn't re-center) if a card's canvas is smaller than the window.
    if (options.crop && options.emptyPixelMode === 'fill') {
      const margins = {
        left: Math.round(options.crop.left * previewScale),
        top: Math.round(options.crop.top * previewScale),
        right: Math.round(options.crop.right * previewScale),
        bottom: Math.round(options.crop.bottom * previewScale),
      };
      canvas = Fill.fillMargins(canvas, margins);
    } else {
      let cw = w, ch = h, left = 0, top = 0;
      if (options.crop) {
        const cropLeft = Math.round(options.crop.left * previewScale);
        const cropTop = Math.round(options.crop.top * previewScale);
        const cropRight = Math.round(options.crop.right * previewScale);
        const cropBottom = Math.round(options.crop.bottom * previewScale);
        left = cropLeft;
        top = cropTop;
        cw = Math.max(1, w - cropLeft - cropRight);
        ch = Math.max(1, h - cropTop - cropBottom);
        if (left + cw > w) left = Math.max(0, w - cw);
        if (top + ch > h) top = Math.max(0, h - ch);
        cw = Math.min(cw, w - left);
        ch = Math.min(ch, h - top);
      }
      if (cw !== w || ch !== h || left !== 0 || top !== 0) {
        const cropped = document.createElement('canvas');
        cropped.width = cw;
        cropped.height = ch;
        cropped.getContext('2d').drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch);
        canvas = cropped;
      }
    }

    return canvas;
  }

  return { renderCard, suggestedCrop };
})();
