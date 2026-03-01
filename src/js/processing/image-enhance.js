/**
 * Image enhancement helpers for Braille pre-processing.
 *
 * Embossed mode uses a global percentile contrast stretch [p2, p98] → [0, 255]
 * to expand the narrow dynamic range of embossed-Braille photos so the
 * slightly-darker dot shadows reliably separate from background.
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
 * Unsharp mask — amplify local contrast (edges/gradients) in a grayscale
 * ImageData.  Works by subtracting a box-blurred copy and feeding the
 * difference back at `amount`× strength.
 *
 *   sharpened = clamp( original + amount × (original − blurred) )
 *
 * For embossed Braille this is the critical step: the raised-dot shadows are
 * only a few gray levels different from paper; unsharp masking with amount≥2
 * makes those micro-gradients strong enough for the adaptive threshold to fire.
 *
 * @param {ImageData} imageData   Grayscale ImageData (R=G=B=luma)
 * @param {number}    amount      Strength multiplier (default 2.5 — aggressive)
 * @param {number}    blurRadius  Box-blur half-width in pixels (default 5)
 * @returns {ImageData}
 */
export function unsharpMask(imageData, amount = 2.5, blurRadius = 5) {
  const w = imageData.width, h = imageData.height;
  const src = imageData.data;
  const n   = w * h;

  // Extract grayscale channel into a float array
  const gray = new Float32Array(n);
  for (let p = 0; p < n; p++) gray[p] = src[p * 4];

  // ── Separable box-blur (horizontal then vertical pass) ────────────────
  const temp    = new Float32Array(n);
  const blurred = new Float32Array(n);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    // Seed the window: sum of [0 .. blurRadius]
    for (let k = 0; k <= Math.min(blurRadius, w - 1); k++) sum += gray[row + k];
    for (let x = 0; x < w; x++) {
      const rEdge = Math.min(w - 1, x + blurRadius);
      const lEdge = x - blurRadius - 1;
      if (x > 0) {                          // add incoming right edge
        sum += gray[row + rEdge];
        if (lEdge >= 0) sum -= gray[row + lEdge]; // remove outgoing left edge
      }
      const count = rEdge - Math.max(0, lEdge + 1) + 1;
      temp[row + x] = sum / count;
    }
  }

  // Vertical pass (on temp)
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = 0; k <= Math.min(blurRadius, h - 1); k++) sum += temp[k * w + x];
    for (let y = 0; y < h; y++) {
      const bEdge = Math.min(h - 1, y + blurRadius);
      const tEdge = y - blurRadius - 1;
      if (y > 0) {
        sum += temp[bEdge * w + x];
        if (tEdge >= 0) sum -= temp[tEdge * w + x];
      }
      const count = bEdge - Math.max(0, tEdge + 1) + 1;
      blurred[y * w + x] = sum / count;
    }
  }

  // ── Apply unsharp mask ─────────────────────────────────────────────────
  const out = new Uint8ClampedArray(src.length);
  for (let p = 0; p < n; p++) {
    const v = Math.round(Math.min(255, Math.max(0,
      gray[p] + amount * (gray[p] - blurred[p])
    )));
    const i = p * 4;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return new ImageData(out, w, h);
}

/**
 * Percentile contrast stretch only — no sharpening.
 * Maps pixel luminance [p2, p98] → [0, 255] to expand narrow dynamic range
 * of embossed-Braille photos without creating any halo artefacts.
 *
 * Used by the Canvas blob-detection fallback for embossed Braille — the
 * adaptive local-threshold in that path fires on raw dot shadows without
 * needing the extra edge-pop that unsharpMask provides for OpenCV.
 *
 * @param {ImageData} imageData
 * @returns {ImageData}  Grayscale ImageData with expanded contrast
 */
export function percentileStretch(imageData) {
  const src = imageData.data;
  const n   = imageData.width * imageData.height;

  const gray = new Float32Array(n);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    gray[p] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  }

  const sorted = gray.slice().sort((a, b) => a - b);
  const lo     = sorted[Math.floor(n * 0.02)];
  const hi     = sorted[Math.floor(n * 0.98)];
  const range  = Math.max(1, hi - lo);

  const out = new Uint8ClampedArray(src.length);
  for (let p = 0; p < n; p++) {
    const v   = Math.round(Math.min(255, Math.max(0, (gray[p] - lo) / range * 255)));
    const idx = p * 4;
    out[idx] = out[idx + 1] = out[idx + 2] = v;
    out[idx + 3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

/**
 * Full Braille pre-processing pipeline:
 *   1. Grayscale conversion
 *   2. For embossed: global percentile stretch [p2, p98] → [0, 255]
 *      followed by unsharp masking (amount=2.5, radius=5 px) to amplify the
 *      micro-contrast of raised-dot shadows — critical for correct dot detection.
 *   3. For non-embossed: contrast boost 1.5×
 *
 * @param {ImageData} imageData   Raw ROI image data
 * @param {boolean}   isEmbossed  Use embossed-specific settings
 * @returns {ImageData}           Processed grayscale ImageData
 */
export function preprocessForBraille(imageData, isEmbossed = false) {
  const src = imageData.data;
  const w   = imageData.width;
  const h   = imageData.height;
  const n   = w * h;

  // Step 1: RGB → grayscale float array
  const gray = new Float32Array(n);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    gray[p] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  }

  if (isEmbossed) {
    // Global percentile stretch: map [p2, p98] → [0, 255].
    // Sorting a copy of the Float32Array guarantees numerical order.
    const sorted = gray.slice().sort((a, b) => a - b);
    const lo    = sorted[Math.floor(n * 0.02)];
    const hi    = sorted[Math.floor(n * 0.98)];
    const range = Math.max(1, hi - lo);

    const stretched = new Uint8ClampedArray(src.length);
    for (let p = 0; p < n; p++) {
      const v   = Math.round(Math.min(255, Math.max(0, (gray[p] - lo) / range * 255)));
      const idx = p * 4;
      stretched[idx] = stretched[idx + 1] = stretched[idx + 2] = v;
      stretched[idx + 3] = 255;
    }
    // Unsharp mask: gently amplify dot-shadow gradients without creating
    // large halos that would bias Otsu/adaptive thresholding.
    // amount=1.2 (was 2.5) — sufficient edge pop while keeping halo amplitude low.
    return unsharpMask(new ImageData(stretched, w, h), 1.2, 5);
  }

  const out = new Uint8ClampedArray(src.length);
  for (let p = 0; p < n; p++) {
    const v   = Math.round(gray[p]);
    const idx = p * 4;
    out[idx] = out[idx + 1] = out[idx + 2] = v;
    out[idx + 3] = 255;
  }
  return increaseContrast(new ImageData(out, w, h), 1.5);
}

