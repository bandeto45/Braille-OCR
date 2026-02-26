/**
 * braille-detector.js — OpenCV-based Braille detector stub
 *
 * This module is an ALTERNATIVE detector that uses OpenCV.js for more
 * advanced image processing. It falls back gracefully when OpenCV is not
 * loaded.  The primary detector (simple-braille-detector.js) uses only
 * the Canvas API and should be preferred in most cases.
 *
 * To activate:
 *  1. Add opencv.js to www/ or load from CDN in index.html
 *  2. Import this module instead of simple-braille-detector.js in camera.f7
 */

let opencvReady = false;

// ── OpenCV initialisation ─────────────────────────────────────────────────

/**
 * Wait for the `cv` global to be available (async script load).
 * @returns {Promise<boolean>}
 */
export function initOpenCV() {
  return new Promise((resolve) => {
    if (typeof cv !== 'undefined' && cv.Mat) {
      opencvReady = true;
      resolve(true);
      return;
    }
    // Timeout fallback — resolve false so caller uses simple detector
    const timer = setTimeout(() => resolve(false), 8000);
    const check = setInterval(() => {
      if (typeof cv !== 'undefined' && cv.Mat) {
        clearInterval(check);
        clearTimeout(timer);
        opencvReady = true;
        resolve(true);
      }
    }, 200);
  });
}

export function isOpenCVReady() {
  return opencvReady;
}

// ── Dot detection via OpenCV HoughCircles ─────────────────────────────────

/**
 * Detect Braille dots using OpenCV HoughCircles (more robust than canvas
 * blob analysis for low-contrast embossed pages).
 *
 * @param {ImageData} imageData — grayscale or colour ROI
 * @returns {{ dots: Array<{x,y,r}>, confidence: number }}
 */
export function detectBrailleDotsCV(imageData) {
  if (!opencvReady || typeof cv === 'undefined') {
    return { dots: [], confidence: 0 };
  }

  let src, gray, circles;
  try {
    src  = cv.matFromImageData(imageData);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Gaussian blur to reduce noise
    const blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 1.5);

    // HoughCircles — parameters tuned for 64–96 px reference cell size
    circles = new cv.Mat();
    cv.HoughCircles(
      blurred,
      circles,
      cv.HOUGH_GRADIENT,
      1,          // dp — resolution ratio
      8,          // minDist between centres
      50,         // param1 — Canny upper threshold
      20,         // param2 — accumulator threshold
      3,          // minRadius
      12,         // maxRadius
    );

    const dots = [];
    for (let i = 0; i < circles.cols; i++) {
      const x = circles.data32F[i * 3];
      const y = circles.data32F[i * 3 + 1];
      const r = circles.data32F[i * 3 + 2];
      dots.push({ x, y, r });
    }

    const confidence = Math.min(1, dots.length / 6);

    [src, gray, blurred, circles].forEach(m => m.delete());
    return { dots, confidence };

  } catch (err) {
    console.warn('[BrailleDetectorCV] error:', err.message);
    [src, gray, circles].forEach(m => { try { m && m.delete(); } catch {} });
    return { dots: [], confidence: 0 };
  }
}

// ── Adaptive threshold via OpenCV ─────────────────────────────────────────

/**
 * Apply adaptive thresholding to improve dot visibility on embossed pages.
 * Returns the thresholded image as a new ImageData.
 *
 * @param {ImageData} imageData
 * @returns {ImageData}
 */
export function adaptiveThresholdCV(imageData) {
  if (!opencvReady || typeof cv === 'undefined') return imageData;

  let src, gray, dst;
  try {
    src  = cv.matFromImageData(imageData);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    dst = new cv.Mat();
    cv.adaptiveThreshold(gray, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

    // Convert back to RGBA ImageData
    const rgba = new cv.Mat();
    cv.cvtColor(dst, rgba, cv.COLOR_GRAY2RGBA);
    const result = new ImageData(new Uint8ClampedArray(rgba.data), imageData.width, imageData.height);

    [src, gray, dst, rgba].forEach(m => m.delete());
    return result;
  } catch (err) {
    console.warn('[BrailleDetectorCV] adaptiveThreshold error:', err.message);
    [src, gray, dst].forEach(m => { try { m && m.delete(); } catch {} });
    return imageData;
  }
}
