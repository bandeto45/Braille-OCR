/**
 * Frame capture and ROI extraction utilities for the Braille camera pipeline.
 */

/**
 * Capture a single frame from a video element onto an off-screen canvas.
 * @param {HTMLVideoElement} videoEl
 * @returns {HTMLCanvasElement}
 */
export function captureFrame(videoEl) {
  const canvas = document.createElement('canvas');
  canvas.width  = videoEl.videoWidth  || videoEl.width  || 1280;
  canvas.height = videoEl.videoHeight || videoEl.height || 720;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Extract the centre region-of-interest (ROI) from a canvas.
 * @param {HTMLCanvasElement} canvas   Source canvas (full frame)
 * @param {number} widthRatio   Fraction of width to keep  (default 0.8)
 * @param {number} heightRatio  Fraction of height to keep (default 0.6)
 * @returns {ImageData}
 */
export function extractCenterROI(canvas, widthRatio = 0.8, heightRatio = 0.6) {
  const ctx = canvas.getContext('2d');
  const w = Math.round(canvas.width  * widthRatio);
  const h = Math.round(canvas.height * heightRatio);
  const x = Math.round((canvas.width  - w) / 2);
  const y = Math.round((canvas.height - h) / 2);
  return ctx.getImageData(x, y, w, h);
}

/**
 * Convert an ImageData (RGBA) to a new ImageData where R=G=B=luminance.
 * @param {ImageData} imageData
 * @returns {ImageData}
 */
export function toGrayscale(imageData) {
  const src  = imageData.data;
  const out  = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const luma = Math.round(0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]);
    out[i] = out[i + 1] = out[i + 2] = luma;
    out[i + 3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}

/**
 * Apply a simple binary threshold to a grayscale ImageData.
 * Pixels at or above `threshold` become 255; below become 0.
 * @param {ImageData} imageData  Grayscale ImageData
 * @param {number}    threshold  0–255, default 128
 * @returns {ImageData}
 */
export function applyThreshold(imageData, threshold = 128) {
  const src = imageData.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const v = src[i] >= threshold ? 255 : 0;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return new ImageData(out, imageData.width, imageData.height);
}
