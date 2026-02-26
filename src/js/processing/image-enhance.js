/**
 * Image enhancement helpers for Braille pre-processing.
 */

/**
 * Increase contrast using a linear stretch on the luma channel.
 * @param {ImageData} imageData
 * @param {number}    factor   Multiplier >1 increases contrast (default 1.5)
 * @returns {ImageData}
 */
export function increaseContrast(imageData, factor = 1.5) {
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);
  const mid = 128;
  for (let i = 0; i < src.length; i += 4) {
    out[i]     = Math.min(255, Math.max(0, mid + (src[i]     - mid) * factor));
    out[i + 1] = Math.min(255, Math.max(0, mid + (src[i + 1] - mid) * factor));
    out[i + 2] = Math.min(255, Math.max(0, mid + (src[i + 2] - mid) * factor));
    out[i + 3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

/**
 * Adjust brightness by adding a fixed value to each channel.
 * @param {ImageData} imageData
 * @param {number}    value   Positive brightens, negative darkens (default 20)
 * @returns {ImageData}
 */
export function adjustBrightness(imageData, value = 20) {
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    out[i]     = Math.min(255, Math.max(0, src[i]     + value));
    out[i + 1] = Math.min(255, Math.max(0, src[i + 1] + value));
    out[i + 2] = Math.min(255, Math.max(0, src[i + 2] + value));
    out[i + 3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

/**
 * Full Braille pre-processing pipeline:
 *   1. Grayscale conversion
 *   2. Contrast boost
 *   3. Optional brightness adjustment for embossed images
 *
 * @param {ImageData} imageData   Raw ROI image data
 * @param {boolean}   isEmbossed  Use embossed-specific settings
 * @returns {ImageData}           Processed grayscale ImageData
 */
export function preprocessForBraille(imageData, isEmbossed = false) {
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);

  // Step 1: RGB → grayscale
  for (let i = 0; i < src.length; i += 4) {
    const luma = Math.round(0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]);
    out[i] = out[i + 1] = out[i + 2] = luma;
    out[i + 3] = 255;
  }

  if (isEmbossed) {
    // Embossed Braille often has very low contrast (std-dev < 20).
    // Linear contrast boost is insufficient — use min-max histogram
    // normalization to stretch the full luminance range to 0–255, making
    // subtle dot shadows clearly visible for adaptive thresholding.
    let minL = 255, maxL = 0;
    for (let i = 0; i < out.length; i += 4) {
      if (out[i] < minL) minL = out[i];
      if (out[i] > maxL) maxL = out[i];
    }
    const range = maxL - minL || 1;
    for (let i = 0; i < out.length; i += 4) {
      const stretched = Math.round((out[i] - minL) * 255 / range);
      out[i] = out[i + 1] = out[i + 2] = stretched;
    }
    return new ImageData(out, imageData.width, imageData.height);
  }

  let processed = new ImageData(out, imageData.width, imageData.height);

  // Step 2: Contrast boost for non-embossed images
  processed = increaseContrast(processed, 1.5);

  return processed;
}
