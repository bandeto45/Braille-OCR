/**
 * Template loader — loads all 36 Braille reference photos and converts them
 * to normalised grayscale ImageData for NCC template matching.
 *
 * Canonical template size: 64 × 96 px (2-column × 3-row Braille cell).
 */

export const TEMPLATE_W = 64;
export const TEMPLATE_H = 96;

/**
 * Load a single image from a URL/src.
 * @param {string} src
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load template image: ${src}`));
    img.src = src;
  });
}

/**
 * Draw an image onto an off-screen canvas scaled to (w × h),
 * then extract grayscale ImageData (R=G=B=luma, A=255).
 * @param {HTMLImageElement} img
 * @param {number} w  Target width
 * @param {number} h  Target height
 * @returns {ImageData}
 */
export function renderToGrayscaleImageData(img, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const raw = ctx.getImageData(0, 0, w, h);

  const data = raw.data;
  const out  = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const luma = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    out[i] = out[i + 1] = out[i + 2] = luma;
    out[i + 3] = 255;
  }
  return new ImageData(out, w, h);
}

/**
 * Compute Normalised Cross-Correlation between two grayscale ImageData arrays.
 *
 * Both arrays must be same dimensions and already grayscale (uses R channel).
 *
 * @param {Uint8ClampedArray} dataA
 * @param {Uint8ClampedArray} dataB
 * @returns {number}  NCC score in [-1, 1]; higher = better match
 */
export function computeNCC(dataA, dataB) {
  const n = dataA.length / 4; // pixel count (RGBA → 4 bytes each)
  if (n !== dataB.length / 4) return -1;

  // Compute means (use R channel — same as G & B for grayscale)
  let sumA = 0, sumB = 0;
  for (let i = 0; i < dataA.length; i += 4) {
    sumA += dataA[i];
    sumB += dataB[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  // Compute NCC
  let num = 0, varA = 0, varB = 0;
  for (let i = 0; i < dataA.length; i += 4) {
    const dA = dataA[i] - meanA;
    const dB = dataB[i] - meanB;
    num  += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }
  const denom = Math.sqrt(varA * varB);
  if (denom < 1e-6) return 0; // flat image — no structure
  return num / denom;
}

/**
 * Resize an ImageData region to (targetW × targetH) using bilinear interpolation.
 * Input must be full RGBA. Output is RGBA at the new dimensions.
 * @param {ImageData} imageData  Source ImageData
 * @param {number} targetW
 * @param {number} targetH
 * @returns {ImageData}
 */
export function resizeImageData(imageData, targetW, targetH) {
  const src = imageData.data;
  const sw  = imageData.width;
  const sh  = imageData.height;
  const out = new Uint8ClampedArray(targetW * targetH * 4);

  const xRatio = sw / targetW;
  const yRatio = sh / targetH;

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = srcX - x0;
      const fy = srcY - y0;

      const idx = (y * targetW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const tl = src[(y0 * sw + x0) * 4 + c];
        const tr = src[(y0 * sw + x1) * 4 + c];
        const bl = src[(y1 * sw + x0) * 4 + c];
        const br = src[(y1 * sw + x1) * 4 + c];
        out[idx + c] = Math.round(tl * (1 - fx) * (1 - fy) + tr * fx * (1 - fy)
                                + bl * (1 - fx) * fy       + br * fx * fy);
      }
      out[idx + 3] = 255;
    }
  }
  return new ImageData(out, targetW, targetH);
}

/**
 * Load all 36 template images and convert them to normalised grayscale ImageData.
 *
 * @param {Object}  templateMap   { char: resolvedUrl, ... }  (36 entries)
 * @param {number}  targetW       Canonical width  (TEMPLATE_W)
 * @param {number}  targetH       Canonical height (TEMPLATE_H)
 * @returns {Promise<Object>}     { [char]: ImageData }
 */
export async function loadAllTemplates(templateMap, targetW = TEMPLATE_W, targetH = TEMPLATE_H) {
  const results = {};
  const entries = Object.entries(templateMap);

  await Promise.all(
    entries.map(async ([char, src]) => {
      try {
        const img = await loadImage(src);
        results[char] = renderToGrayscaleImageData(img, targetW, targetH);
      } catch (err) {
        console.warn(`[TemplateLoader] Could not load template for '${char}': ${err.message}`);
        // Create blank (0-filled) template so matching still works — will score low
        results[char] = new ImageData(
          new Uint8ClampedArray(targetW * targetH * 4),
          targetW,
          targetH
        );
      }
    })
  );

  return results;
}
