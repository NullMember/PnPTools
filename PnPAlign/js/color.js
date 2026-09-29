// Color transform: per-channel linear match to a reference (auto), plus manual batch adjustments.

const ColorAlign = (() => {
  // White-balance style correction: scale each channel to match paper tone to the reference's.
  // Anchored to paper (not a whole-card mean) so colored artwork doesn't skew the result.
  function computeAutoTransform(sourceStats, refStats) {
    const gain = [0, 0, 0];
    const offset = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const srcPaper = sourceStats.paper[c];
      const refPaper = refStats.paper[c];
      let g = srcPaper > 5 ? refPaper / srcPaper : 1;
      g = Math.max(0.5, Math.min(2.0, g));
      gain[c] = g;
      offset[c] = 0;
    }
    return { gain, offset };
  }

  // manual: { brightness:-100..100, contrast:-100..100, saturation:-100..100, rGain,gGain,bGain: 0.5..1.5 }
  function applyToImageData(imageData, autoTransform, manual) {
    const data = imageData.data;
    const gain = autoTransform ? autoTransform.gain : [1, 1, 1];
    const offset = autoTransform ? autoTransform.offset : [0, 0, 0];
    const chGain = [manual.rGain ?? 1, manual.gGain ?? 1, manual.bGain ?? 1];
    const brightness = manual.brightness ?? 0;
    const contrastFactor = (259 * ((manual.contrast ?? 0) + 255)) / (255 * (259 - (manual.contrast ?? 0)));
    const sat = 1 + (manual.saturation ?? 0) / 100;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i] * gain[0] + offset[0];
      let g = data[i + 1] * gain[1] + offset[1];
      let b = data[i + 2] * gain[2] + offset[2];

      r *= chGain[0];
      g *= chGain[1];
      b *= chGain[2];

      r += brightness;
      g += brightness;
      b += brightness;

      r = contrastFactor * (r - 128) + 128;
      g = contrastFactor * (g - 128) + 128;
      b = contrastFactor * (b - 128) + 128;

      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      r = luma + (r - luma) * sat;
      g = luma + (g - luma) * sat;
      b = luma + (b - luma) * sat;

      data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
      data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
    return imageData;
  }

  return { computeAutoTransform, applyToImageData };
})();
