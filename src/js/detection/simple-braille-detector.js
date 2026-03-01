/**
 * Braille Detector — OpenCV.js + Dot Pattern OCR
 *
 * PRIMARY detector for the Braille OCR app.
 * Uses OpenCV.js (cv.threshold + cv.findContours) to detect Braille dots,
 * then groups them into 2×3 Braille cells and maps each cell's 6-bit dot
 * pattern to a character via BRAILLE_PATTERN_MAP — no template photos needed.
 *
 * Two detection modes — selected automatically from image statistics:
 *
 *   PRINTED Braille (mean < 150 or stdDev ≥ 20):
 *     CLAHE(2.0, 8×8) → GaussianBlur(5,5) → Otsu INV → MorphOpen(3×3)
 *     circularity ≥ 0.35
 *
 *   EMBOSSED Braille (white-on-white, mean > 150):
 *     Dots are raised bumps with very subtle shadow contrast.
 *     percentileStretch [p2,p98]→[0,255] ONLY (no unsharpMask — halos from
 *     unsharp inflate stdDev to ~67 causing adaptive threshold noise explosion).
 *     Then: GaussianBlur(3,3,0.8) → adaptiveThreshold(MEAN_C, INV, ~2×dotDiam, C=10)
 *     → MorphOpen(3×3) → circularity ≥ 0.20 (shadows can be oval)
 *
 * Falls back to Canvas API blob detection when OpenCV.js is not yet loaded.
 *
 * Exports:
 *   initializeDetector()     async — loads OpenCV.js WASM from CDN <script> tag
 *   assessImageQuality(imageData)
 *   detectBrailleDots(imageData)
 *   segmentCellRegions(imageData, dots, estCellW, estCellH)
 *   matchCellsToTemplates(imageData, cellRegions)  ← dot-pattern lookup, no NCC
 *   assembleSentence(matchedCells)
 *   groupIntoCells(dots, cellW, cellH)             ← legacy alias
 */

import { BRAILLE_PATTERN_MAP, CHAR_DOT_PATTERNS, DOT_PATTERN_TO_CHAR } from '../utils/braille-mappings.js';
import { preprocessForBraille, percentileStretch } from '../processing/image-enhance.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_CELL_CONFIDENCE = 0.40;  // minimum dot-pattern match confidence
const WORD_GAP_RATIO      = 1.8;   // gap > ratio × estCellW → word space

// ─── OpenCV state ─────────────────────────────────────────────────────────────
/** The live cv instance set by initializeDetector(); null until OpenCV loads. */
let _cv           = null;
let _opencvReady  = false;

/**
 * Compatibility shims — these were used by the old NCC template approach.
 * No templates are loaded in the new OpenCV dot-detection approach, so both
 * are always false / 0.  Preloader.f7 reads these to show status text.
 */
export let templatesAreSynthetic = false;
export let templatesMissingCount = 0;

// ─── OpenCV dot detection ─────────────────────────────────────────────────────
/**
 * Shared contour → dot extractor used by both detection paths.
 * Filters by area and circularity, then returns centroid + radius arrays.
 *
 * @param {object}    cv              OpenCV.js instance
 * @param {MatVector} contours        Result of findContours
 * @param {ImageData} imageData       Original image (for area bounds)
 * @param {number}    minCircularity  Reject blobs below this circularity (4π·A/P²)
 * @returns {Array<{x, y, radius, confidence}>}
 */
function _extractDots(cv, contours, imageData, minCircularity, isEmbossed = false) {
  const imgArea = imageData.width * imageData.height;
  // Scale-aware area bounds.
  // Embossed path uses tight bounds (same as the Canvas fallback) to reject
  // large paper-texture blobs that pass the loose defaults at high resolution.
  // At 1280px a Braille dot has radius ≈9-12px → area ≈260-450px.
  const minArea = isEmbossed
    ? Math.max(200, imgArea * 0.0003)   // ≥ r≈8px at 1280px
    : Math.max(20,  imgArea * 0.0002);
  const maxArea = isEmbossed
    ? Math.max(2000, imgArea * 0.006)   // ≤ r≈34px at 1280px
    : Math.max(300,  imgArea * 0.012);

  const dots = [];
  for (let i = 0; i < contours.size(); i++) {
    const contour = contours.get(i);
    const area    = cv.contourArea(contour);

    if (area < minArea || area > maxArea) { contour.delete(); continue; }

    const perimeter = cv.arcLength(contour, true);
    if (perimeter === 0) { contour.delete(); continue; }
    const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
    if (circularity < minCircularity) { contour.delete(); continue; }

    const moments = cv.moments(contour);
    if (moments.m00 === 0) { contour.delete(); continue; }
    const cx = moments.m10 / moments.m00;
    const cy = moments.m01 / moments.m00;
    const radius = Math.sqrt(area / Math.PI);

    dots.push({ x: cx, y: cy, radius, confidence: Math.min(1, circularity) });
    contour.delete();
  }
  return dots;
}

/**
 * Detect Braille dots using OpenCV.js.
 *
 * NON-EMBOSSED path (printed/photographed Braille):
 *   1. Grayscale → CLAHE(2.0, 8×8) → GaussianBlur(5,5) → Otsu INV
 *   2. MorphOpen(3×3) → findContours → circularity ≥ 0.35
 *
 * EMBOSSED path (white-on-white raised-dot Braille):
 *   Dots cast only subtle shadows.  Using unsharpMask before adaptive
 *   threshold creates halos that inflate stdDev (~12→67), causing 40%+
 *   false-positive dark pixels.  Solution: percentileStretch ONLY so the
 *   local adaptive threshold fires on true dot shadows:
 *   1. percentileStretch → GaussianBlur(3,3,0.8)
 *      → adaptiveThreshold(MEAN_C, INV, ~2×dotDiam, C=10)
 *   2. MorphOpen(3×3) → findContours → circularity ≥ 0.20 (oval shadows OK)
 *
 * @param {ImageData} imageData
 * @param {boolean}   isEmbossed  Use embossed preprocessing when true
 * @returns {Array<{x, y, radius, confidence}>} detected dot centroids
 */
function _detectDotsOpenCV(imageData, isEmbossed = false) {
  const cv   = _cv;
  const mats = [];
  const track = (m) => { mats.push(m); return m; };

  try {
    if (isEmbossed) {
      // ── EMBOSSED PATH ──────────────────────────────────────────────────────
      // Pre-process: percentile stretch [p2,p98]→[0,255] ONLY — NO unsharp mask.
      // unsharpMask(1.2) raises image stdDev from ~12 to ~67, creating halos that
      // cause adaptive threshold to mark 40%+ of pixels dark and merge/miss dots.
      // percentileStretch alone expands the narrow dynamic range so the subtle
      // raised-dot shadows are visible to the local adaptive threshold.
      const preprocessed = percentileStretch(imageData);
      const src  = track(cv.matFromImageData(preprocessed));
      const gray = track(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      // Light blur removes high-frequency noise before thresholding
      const blurred = track(new cv.Mat());
      cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0.8);

      // Adaptive mean-C threshold: measures local contrast around each pixel so
      // only genuine dot-shaped dark spots relative to their neighbourhood are
      // marked positive.  Without unsharp halos, C=10 is the right bias:
      // pixels must be 10 below their local mean to qualify as a dot candidate.
      // blockSize ≈ 2× dot diameter; must be odd and ≥11.
      const binary = track(new cv.Mat());
      const estDotDiam = Math.max(11, Math.round(Math.sqrt(imageData.width * imageData.height) * 0.022));
      const blockSize  = estDotDiam % 2 === 0 ? estDotDiam + 1 : estDotDiam;
      cv.adaptiveThreshold(blurred, binary, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, blockSize, 10);

      // 3×3 kernel open — removes thin noise specks, preserves dot blobs
      const kernel  = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)));
      const cleaned = track(new cv.Mat());
      cv.morphologyEx(binary, cleaned, cv.MORPH_OPEN, kernel);

      const contours  = track(new cv.MatVector());
      const hierarchy = track(new cv.Mat());
      cv.findContours(cleaned, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      // Embossed dot shadows can be slightly oval (raking-light effect) so
      // lower circularity threshold to 0.20; use tight area bounds matching
      // the Canvas-path embossed bounds to reject large noise regions.
      return _extractDots(cv, contours, imageData, 0.20, true);

    } else {
      // ── NON-EMBOSSED PATH (original pipeline) ──────────────────────────────
      const src = track(cv.matFromImageData(imageData));
      const gray = track(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      const enhanced = track(new cv.Mat());
      const clahe    = new cv.CLAHE(2.0, new cv.Size(8, 8));
      clahe.apply(gray, enhanced);
      clahe.delete();

      const blurred = track(new cv.Mat());
      cv.GaussianBlur(enhanced, blurred, new cv.Size(5, 5), 1.5);

      const binary = track(new cv.Mat());
      cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);

      const kernel  = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)));
      const cleaned = track(new cv.Mat());
      cv.morphologyEx(binary, cleaned, cv.MORPH_OPEN, kernel);

      const contours  = track(new cv.MatVector());
      const hierarchy = track(new cv.Mat());
      cv.findContours(cleaned, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      return _extractDots(cv, contours, imageData, 0.35);
    }

  } finally {
    mats.forEach(m => { try { if (m && !m.isDeleted?.()) m.delete(); } catch {} });
  }
}

// ─── Initialisation ───────────────────────────────────────────────────────────
/**
 * Async init — loads OpenCV.js WASM.
 * When OpenCV loads successfully _cv is populated and _opencvReady is true;
 * frames can be processed immediately.  If OpenCV fails to load within 10 s
 * the detector gracefully falls back to the Canvas blob-detection code.
 * @returns {Promise<void>}
 */
export async function initializeDetector() {
  if (_opencvReady) return;

  return new Promise((resolve) => {
    /**
     * Wait for the global `cv` object to be populated by the async OpenCV.js
     * script tag in index.html (https://docs.opencv.org/4.9.0/opencv.js).
     *
     * Three possible states:
     *  A. cv already fully initialised (fast path — script loaded early)
     *  B. cv object exists but WASM still loading — attach onRuntimeInitialized
     *  C. cv not yet in scope — poll with setInterval until the script tag sets it
     */
    const onReady = () => {
      _cv          = cv; // eslint-disable-line no-undef
      _opencvReady = true;
      console.info('[BrailleDetector] OpenCV.js ready — using cv.findContours dot detection');
      resolve();
    };

    // Check if already ready (Pattern A)
    if (typeof cv !== 'undefined' && cv.Mat) { // eslint-disable-line no-undef
      onReady();
      return;
    }

    // Check if cv exists but onRuntimeInitialized hook needed (Pattern B)
    if (typeof cv !== 'undefined') { // eslint-disable-line no-undef
      cv.onRuntimeInitialized = onReady; // eslint-disable-line no-undef
    }

    // Poll for cv global — set by the async <script> tag (Pattern C)
    const poll = setInterval(() => {
      if (typeof cv === 'undefined') return; // eslint-disable-line no-undef
      clearInterval(poll);
      clearTimeout(timeout);
      if (cv.Mat) { // eslint-disable-line no-undef
        onReady();
      } else {
        // WASM still initialising
        cv.onRuntimeInitialized = onReady; // eslint-disable-line no-undef
      }
    }, 200);

    // 15 s timeout — resolve without OpenCV so the app still works
    const timeout = setTimeout(() => {
      clearInterval(poll);
      if (!_opencvReady) {
        console.warn('[BrailleDetector] OpenCV.js did not load in 15 s — Canvas fallback active');
        resolve();
      }
    }, 15000);
  });
}

// ─── Legacy template state sentinel ──────────────────────────────────────────
// Kept so preloader.f7 / home.f7 imports don't break; values are always falsy.
let detectorInitialized = true; // always true — no async template loads needed

// ─── Otsu binarizer (kept for internal Canvas path) ──────────────────────────
/**
 * Convert a grayscale ImageData to a binary ImageData using Otsu's threshold.
 * Used by the Canvas fallback dot-detection path.
 * Inversion guard: if >60% of pixels are dark the result is flipped so the
 * convention is always  dark dot blobs on white background.
 * @param {ImageData} gs  Grayscale source (R = G = B = luma, A = 255)
 * @returns {ImageData}   Binary ImageData (0 = dot, 255 = background)
 */
function _otsuBinarize(gs) {
  const src = gs.data;
  const n   = gs.width * gs.height;

  // Build 256-bin histogram (R channel == luma for grayscale)
  const hist = new Int32Array(256);
  for (let i = 0; i < src.length; i += 4) hist[src[i]]++;

  // Otsu's between-class variance maximisation
  let total = 0;
  for (let t = 0; t < 256; t++) total += t * hist[t];

  let sumB = 0, wB = 0, maxVar = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (total - sumB) / wF;
    const v  = wB * wF * (mB - mF) ** 2;
    if (v > maxVar) { maxVar = v; threshold = t; }
  }

  // Apply threshold and count dark pixels
  const out = new Uint8ClampedArray(src.length);
  let dark = 0;
  for (let i = 0; i < src.length; i += 4) {
    const v = src[i] <= threshold ? 0 : 255;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
    if (v === 0) dark++;
  }

  // Inversion guard — flip if image is mostly dark (white dots on dark bg)
  if (dark / n > 0.60) {
    for (let i = 0; i < out.length; i += 4) {
      const v = out[i] === 0 ? 255 : 0;
      out[i] = out[i + 1] = out[i + 2] = v;
    }
  }

  return new ImageData(out, gs.width, gs.height);
}





// ─── Image Quality Assessment ─────────────────────────────────────────────────
/**
 * Assess whether the captured image frame is suitable for Braille detection.
 * @param {ImageData} imageData  ROI image data
 * @returns {{ isAcceptable: boolean, score: number, summary: string, advice: string, embossed: boolean }}
 */
export function assessImageQuality(imageData) {
  const data   = imageData.data;
  const pixels = imageData.width * imageData.height;

  if (pixels === 0) {
    return { isAcceptable: false, score: 0, summary: 'empty', advice: 'No image data', embossed: false };
  }

  // ── Grayscale stats ──
  let sum = 0, darkCount = 0, brightCount = 0;
  const gray = new Float32Array(pixels);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    gray[p] = luma;
    sum     += luma;
    if (luma < 50)  darkCount++;
    if (luma > 220) brightCount++;
  }
  const mean   = sum / pixels;
  let variance = 0;
  for (let p = 0; p < pixels; p++) variance += (gray[p] - mean) ** 2;
  variance /= pixels;
  const stdDev = Math.sqrt(variance);
  const darkRatio   = darkCount   / pixels;
  const brightRatio = brightCount / pixels;

  // ── Embossed detection ──
  const embossed = mean > 150 && stdDev < 38;

  // ── Blur score (Laplacian variance) ──
  let laplacianVar = 0;
  const w = imageData.width, h = imageData.height;
  let laplacianCount = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const lap = -gray[p - w - 1] - gray[p - w] - gray[p - w + 1]
                  - gray[p - 1]    + 8 * gray[p]  - gray[p + 1]
                  - gray[p + w - 1] - gray[p + w]  - gray[p + w + 1];
      laplacianVar += lap * lap;
      laplacianCount++;
    }
  }
  laplacianVar /= (laplacianCount || 1);
  const blurScore = Math.min(1, laplacianVar / 500);

  // ── Exposure score ──
  let exposureScore = 1;
  if (mean < 30 || mean > 240) exposureScore = 0.2;
  else if (mean < 60 || mean > 210) exposureScore = 0.5;
  else if (darkRatio > 0.5 || brightRatio > 0.5) exposureScore = 0.4;

  // ── Contrast score ──
  const contrastScore = embossed ? 0.7 : Math.min(1, stdDev / 60);

  // ── Tilt score (gradient orientation coherence) ──
  let hGrad = 0, vGrad = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      hGrad += Math.abs(gray[p + 1] - gray[p - 1]);
      vGrad += Math.abs(gray[p + w] - gray[p - w]);
    }
  }
  const total = hGrad + vGrad || 1;
  const coherence = Math.abs(hGrad - vGrad) / total;
  const tiltScore = embossed ? 0.7 : Math.min(1, coherence * 2);

  // ── Weighted composite ──
  const score = embossed
    ? 0.7  // embossed always "good enough"
    : blurScore * 0.40 + exposureScore * 0.30 + contrastScore * 0.15 + tiltScore * 0.15;

  const isAcceptable = score >= 0.35;

  let summary = '';
  let advice  = '';
  if (!isAcceptable) {
    if (blurScore < 0.3)      { summary = 'blurry';    advice = 'Hold camera steady'; }
    else if (exposureScore < 0.4) { summary = 'bad lighting'; advice = 'Improve lighting'; }
    else if (contrastScore < 0.3) { summary = 'low contrast'; advice = 'Adjust angle'; }
    else                          { summary = 'poor quality'; advice = 'Centre the document'; }
  }

  return { isAcceptable, score: Math.round(score * 100) / 100, summary, advice, embossed };
}

// ─── Dot Detection ────────────────────────────────────────────────────────────
/**
 * Detect Braille dots in a ROI ImageData.
 *
 * Automatically detects embossed (white-on-white, mean > 150) vs. printed
 * Braille and applies the appropriate pipeline for each case.
 *
 * PRIMARY path (OpenCV.js loaded) — see _detectDotsOpenCV() for details:
 *   Embossed:     preprocessForBraille → GaussianBlur(3,3) → Otsu INV → MorphOpen(5×5)
 *   Non-embossed: CLAHE → GaussianBlur(5,5) → Otsu INV → MorphOpen(3×3)
 *
 * FALLBACK (Canvas API, no OpenCV):
 *   preprocessForBraille + adaptive local threshold + flood-fill blob analysis.
 *
 * @param {ImageData} imageData
 * @returns {{ dots: Array<{x,y,radius,confidence}>, confidence: number, preprocessedImage: ImageData }}
 */
export function detectBrailleDots(imageData) {
  // Determine embossed state once so both paths use the same decision.
  const { embossed } = _quickEmbossCheck(imageData);

  // ── PRIMARY: OpenCV dot detection ────────────────────────────────────────
  if (_opencvReady && _cv) {
    try {
      const dots = _detectDotsOpenCV(imageData, embossed);
      if (dots.length > 0) {
        const confidence = dots.reduce((s, d) => s + d.confidence, 0) / dots.length;
        return { dots, confidence, preprocessedImage: imageData };
      }
      // OpenCV returned 0 dots — fall through to Canvas path below
      console.warn('[BrailleDetector] OpenCV found 0 dots (embossed=' + embossed + '), trying Canvas fallback');
    } catch (err) {
      console.warn('[BrailleDetector] OpenCV detection failed, using Canvas fallback:', err.message);
    }
  }

  // ── FALLBACK: Canvas adaptive-threshold + blob analysis ──────────────────
  // For embossed Braille the adaptive local threshold fires directly on raw
  // dot shadows — no unsharp mask is needed (and is actively harmful here:
  // unsharpMask(1.2) raises image stdDev from ~12 to ~67, causing ~45% of
  // pixels to be flagged dark even at C=2, producing 1000+ noise blobs).
  // Only a percentile stretch is applied so that dot shadows are scaled to
  // a useful dynamic range before thresholding.
  const processed = embossed
    ? percentileStretch(imageData)
    : preprocessForBraille(imageData, false);

  const w = processed.width, h = processed.height;
  const data = processed.data;

  // ── Compute local adaptive threshold ──
  // blockSize: for embossed use the same formula as the OpenCV path
  // (≈ 2× estimated dot diameter) so local contrast is measured at the
  // right spatial scale, not at the coarser min(w,h)/20 scale.
  // For non-embossed keep the existing min(w,h)/20 formula.
  const estDotDiamCanvas = Math.max(11, Math.round(Math.sqrt(w * h) * 0.022));
  const blockSize = embossed
    ? (estDotDiamCanvas % 2 === 0 ? estDotDiamCanvas + 1 : estDotDiamCanvas)
    : Math.max(11, Math.round(Math.min(w, h) / 20) | 1);
  const integral  = _buildIntegralImage(data, w, h);

  let binary = new Uint8Array(w * h);
  // C is the threshold bias: pixel < (localMean - C) → dot candidate.
  // Embossed path (percentile-stretch only, no unsharp): C=10 produces ~18%
  // dark pixels and ~30 valid dot blobs for a one-line HELLO WORLD at 1280px.
  // Non-embossed (printed) path: C=5 keeps existing behaviour.
  const C = embossed ? 10 : 5;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const half = Math.floor(blockSize / 2);
      const x1 = Math.max(0, x - half);
      const y1 = Math.max(0, y - half);
      const x2 = Math.min(w - 1, x + half);
      const y2 = Math.min(h - 1, y + half);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum   = _integralSum(integral, w, x1, y1, x2, y2);
      const localMean = sum / count;
      const pixel = data[(y * w + x) * 4]; // grayscale: R = G = B
      binary[y * w + x] = pixel < (localMean - C) ? 0 : 1;
    }
  }

  binary = _morphCloseBinary(binary, w, h, 2);

  // ── Connected-component labelling (simple flood fill) ──
  const dots = [];
  const visited = new Uint8Array(w * h);

  // Scale blob size / radius limits relative to image dimensions so the
  // detector works correctly for both 720p video frames AND full-res photos.
  // Embossed path: tighter bounds reject tiny noise blobs (paper texture)
  // and large paper regions that pass the loose defaults and contaminate
  // the radius filter.  At 1280px ROI a Braille dot has radius ≈ 10-15px
  // (area ≈ 300-700px²).  The non-embossed (printed) path retains the
  // original wider bounds for ink dots which vary more in size.
  const imgArea   = w * h;
  const minBlobSz = embossed
    ? Math.max(200, imgArea * 0.0003)    // ≥ r≈8px at 1280px
    : Math.max(4,   imgArea * 0.00005);  // ≥ 0.005% of image
  const maxBlobSz = embossed
    ? Math.max(2000, imgArea * 0.006)    // ≤ r≈34px at 1280px
    : Math.max(800,  imgArea * 0.04);    // ≤ 4% of image
  const minRadius = embossed
    ? Math.max(6, Math.sqrt(imgArea) * 0.008)
    : Math.max(1.5, Math.sqrt(imgArea) * 0.004);
  const maxRadius = embossed
    ? Math.max(30, Math.sqrt(imgArea) * 0.05)
    : Math.max(20, Math.sqrt(imgArea) * 0.18);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!binary[y * w + x] && !visited[y * w + x]) {
        const blob = _floodFill(binary, visited, w, h, x, y);
        if (blob.size >= minBlobSz && blob.size <= maxBlobSz) {
          const radius = Math.sqrt(blob.size / Math.PI);
          const aspect = blob.maxX - blob.minX > 0
            ? (blob.maxY - blob.minY) / (blob.maxX - blob.minX) : 1;
          // Braille dots are roughly circular
          if (radius >= minRadius && radius <= maxRadius && aspect >= 0.4 && aspect <= 2.5) {
            const confidence = Math.min(1, (1 - Math.abs(aspect - 1)) * (radius / 8));
            dots.push({
              x: blob.cx / blob.size,
              y: blob.cy / blob.size,
              radius,
              confidence,
            });
          }
        }
      }
    }
  }

  if (dots.length > 2) {
    const radii = dots.map(d => d.radius).sort((a, b) => a - b);
    const medR  = radii[Math.floor(radii.length / 2)] || 1;
    const strict = dots.length > 20;
    const minRKeep = medR * (strict ? 0.62 : 0.45);
    const maxRKeep = medR * (strict ? 1.8 : 2.5);
    const keep  = dots.filter(d => (
      d.radius >= minRKeep
      && d.radius <= maxRKeep
      && (!strict || d.confidence >= 0.45)
    ));
    if (keep.length >= 2) {
      dots.length = 0;
      dots.push(...keep);
    }
  }

  if (dots.length > 20) {
    const binSize = Math.max(12, Math.round(h / 40));
    const binCount = Math.ceil(h / binSize);
    const bins = new Array(binCount).fill(0);
    for (const d of dots) {
      const b = Math.max(0, Math.min(binCount - 1, Math.floor(d.y / binSize)));
      bins[b]++;
    }

    const peak = Math.max(...bins);
    const minActive = Math.max(3, Math.floor(peak * 0.35));
    const active = [];
    for (let i = 0; i < binCount; i++) {
      if (bins[i] >= minActive) active.push(i);
    }

    if (active.length > 0) {
      const bands = [];
      let start = active[0], prev = active[0];
      for (let i = 1; i < active.length; i++) {
        const b = active[i];
        if (b <= prev + 1) prev = b;
        else {
          bands.push([start, prev]);
          start = b;
          prev = b;
        }
      }
      bands.push([start, prev]);

      const yMargin = Math.max(10, Math.round(Math.sqrt(imgArea) * 0.01));
      const keep = dots.filter((d) => bands.some(([b0, b1]) => {
        const y0 = b0 * binSize - yMargin;
        const y1 = (b1 + 1) * binSize + yMargin;
        return d.y >= y0 && d.y <= y1;
      }));

      if (keep.length >= 3) {
        dots.length = 0;
        dots.push(...keep);
      }
    }
  }

  const confidence = dots.length > 0
    ? Math.min(1, dots.reduce((s, d) => s + d.confidence, 0) / dots.length)
    : 0;

  return { dots, confidence, preprocessedImage: processed };
}

// ─── Cell Segmentation ────────────────────────────────────────────────────────
/**
 * Segment detected dots into ordered Braille cell regions.
 * Groups dots into rows, then into columns within each row.
 * Inserts word-space markers where horizontal gap > WORD_GAP_RATIO × estCellW.
 *
 * @param {ImageData} imageData   ROI ImageData (for dimensions only)
 * @param {Array<{x,y,radius,confidence}>} dots
 * @param {number} estCellW   Estimated cell width  (pixels)
 * @param {number} estCellH   Estimated cell height (pixels)
 * @returns {{ cellRegions: Array<{x,y,w,h,rowIndex,colIndex,isSpace}>, confidence: number }}
 */
export function segmentCellRegions(imageData, dots, estCellW, estCellH) {
  if (!dots || dots.length === 0) return { cellRegions: [], confidence: 0 };

  // ── Estimate cell size if not provided ──
  if (!estCellW || !estCellH) {
    const est = _estimateCellSize(dots);
    estCellW  = est.cellW;
    estCellH  = est.cellH;
  }

  if (estCellW <= 0 || estCellH <= 0) return { cellRegions: [], confidence: 0 };

  // ── Group dots into rows by Y proximity ──
  const sortedByY = [...dots].sort((a, b) => a.y - b.y);
  const rows = [];
  for (const dot of sortedByY) {
    let placed = false;
    for (const row of rows) {
      // Threshold must be large enough to merge all 3 dot-rows within a single
      // Braille line (span ≈ estCellH) yet small enough to keep separate text
      // lines apart (inter-line gap typically ≥ 2× estCellH).
      if (Math.abs(dot.y - row.meanY) < estCellH * 1.1) {
        row.dots.push(dot);
        row.meanY = row.dots.reduce((s, d) => s + d.y, 0) / row.dots.length;
        placed = true; break;
      }
    }
    if (!placed) rows.push({ meanY: dot.y, dots: [dot] });
  }

  // ── Within each row, cluster dots into cells by X ──
  const cellRegions = [];
  rows.sort((a, b) => a.meanY - b.meanY);

  rows.forEach((row, rowIndex) => {
    const sortedDots = [...row.dots].sort((a, b) => a.x - b.x);
    const cellClusters = [];
    for (const dot of sortedDots) {
      let placed = false;
      for (const cell of cellClusters) {
        // 0.48 × cellW keeps within-cell cols together (gap ≈ 0.38 × cellW)
        // while separating adjacent cells (gap ≈ 0.62 × cellW).
        if (Math.abs(dot.x - cell.meanX) < estCellW * 0.48) {
          cell.dots.push(dot);
          cell.meanX = cell.dots.reduce((s, d) => s + d.x, 0) / cell.dots.length;
          placed = true; break;
        }
      }
      if (!placed) cellClusters.push({ meanX: dot.x, dots: [dot] });
    }

    // ── Re-merge cells that share dots across the within-cell column gap ──
    // (already handled by the if-placed logic above)

    // Build bounding boxes and detect word spaces
    let prevCellX = null;
    cellClusters.sort((a, b) => a.meanX - b.meanX);
    cellClusters.forEach((cell, colIndex) => {
      const xs = cell.dots.map(d => d.x);
      const ys = cell.dots.map(d => d.y);
      const minX = Math.min(...xs) - estCellW * 0.25;
      const minY = Math.min(...ys) - estCellH * 0.2;
      const cellW = estCellW;
      const cellH = estCellH;

      // Insert space marker if gap from previous cell is large
      if (prevCellX !== null && cell.meanX - prevCellX > WORD_GAP_RATIO * estCellW) {
        cellRegions.push({ x: 0, y: 0, w: 0, h: 0, rowIndex, colIndex, isSpace: true });
      }

      cellRegions.push({
        x: Math.max(0, minX),
        y: Math.max(0, minY),
        w: cellW,
        h: cellH,
        rowIndex,
        colIndex: cellRegions.filter(c => c.rowIndex === rowIndex && !c.isSpace).length,
        isSpace: false,
        dots: cell.dots,   // carry detected dot positions for pattern-based matching
      });

      prevCellX = cell.meanX;
    });
  });

  // Noise guard
  const realCells = cellRegions.filter(c => !c.isSpace);
  if (realCells.length === 0 || realCells.length > 60) {
    return { cellRegions: [], confidence: 0 };
  }

  return { cellRegions, confidence: 0.8 };
}

// ─── Template Matching ────────────────────────────────────────────────────────
/**
 * Match each cell region against all 36 templates using NCC.
 *
 * @param {ImageData} roiData      Full ROI ImageData
 * @param {Array<{x,y,w,h,rowIndex,colIndex,isSpace}>} cellRegions
 * @returns {Array<{char, confidence, rowIndex, colIndex, isSpace}>}
 */

// ─── Dot-Pattern Matching ─────────────────────────────────────────────────────
/**
 * Primary recognition method: lighting-independent character identification
 * by mapping each cell's detected dots onto the standard 2×3 Braille grid
 * (dots 1–6) and looking up the resulting 6-bit pattern in CHAR_DOT_PATTERNS.
 *
 * Dot-position algorithm:
 *   Rows  → Y-cluster the dots into up to 3 groups (sorted top→bot).
 *           Group 0 = row 1 (top), group 1 = row 2 (mid), group 2 = row 3 (bot).
 *   Cols  → compare each dot's X against the cell horizontal midpoint;
 *           left  → bits 0/1/2  (dots 1,2,3)
 *           right → bits 3/4/5  (dots 4,5,6)
 *
 * @param {Array} cellRegions  Each entry must include a `dots` array.
 * @returns {Array<{char, confidence, rowIndex, colIndex, isSpace, dotPattern}>}
 */
export function matchCellsByDotPattern(cellRegions) {
  return cellRegions.map(cell => {
    if (cell.isSpace) {
      return { char: ' ', confidence: 1, rowIndex: cell.rowIndex, colIndex: cell.colIndex, isSpace: true };
    }

    const dots = cell.dots || [];
    if (dots.length === 0) {
      console.warn(`[DotPattern] Cell r${cell.rowIndex}c${cell.colIndex} has no dots`);
      return { char: '?', confidence: 0, rowIndex: cell.rowIndex, colIndex: cell.colIndex, isSpace: false, dotPattern: 0 };
    }

    // ── Deduplicate blobs that are too close together (noise / split blobs) ──
    // Also discard small blobs whose radius is less than half the median radius
    // within this cell (noise blobs are typically 3-5× smaller than real dots).
    const DEDUP_DIST = (cell.h > 0 ? cell.h * 0.20 : 15);
    const radii = dots.map(d => d.radius || 0).sort((a, b) => a - b);
    const medRadius = radii[Math.floor(radii.length / 2)] || 1;
    const minDotRadius = medRadius * 0.5;

    const dedupedDots = [];
    for (const d of dots.slice().sort((a, b) => (b.radius || 0) - (a.radius || 0))) {
      if ((d.radius || 0) < minDotRadius) continue; // too small → noise
      const tooClose = dedupedDots.some(
        k => Math.hypot(d.x - k.x, d.y - k.y) < DEDUP_DIST
      );
      if (!tooClose) dedupedDots.push(d);
    }

    if (dedupedDots.length === 0) {
      console.warn(`[DotPattern] Cell r${cell.rowIndex}c${cell.colIndex} all dots filtered as noise (medR=${medRadius.toFixed(1)})`);
      return { char: '?', confidence: 0, rowIndex: cell.rowIndex, colIndex: cell.colIndex, isSpace: false, dotPattern: 0 };
    }

    // ── Step 1: Unified Y-clustering across ALL dots in this cell ─────────────
    // The old approach clustered Y independently per column group, which caused
    // a single dot in the right column to always land in rowIdx=0 (dot 4)
    // regardless of its actual vertical position — e.g. a lone mid-row dot (dot 5)
    // was mistakenly assigned as dot 4.  Clustering by Y first, across both
    // columns, gives each dot its correct row position (0=top, 1=mid, 2=bot)
    // before column membership is determined.
    const Y_THRESH = (cell.h > 0 ? cell.h * 0.30 : 25);
    const allYSorted = [...dedupedDots].sort((a, b) => a.y - b.y);
    const yGroups = [];
    for (const d of allYSorted) {
      let placed = false;
      for (const g of yGroups) {
        if (Math.abs(d.y - g.meanY) < Y_THRESH) {
          g.pts.push(d);
          g.meanY = g.pts.reduce((s, p) => s + p.y, 0) / g.pts.length;
          placed = true; break;
        }
      }
      if (!placed) yGroups.push({ meanY: d.y, pts: [d] });
    }
    yGroups.sort((a, b) => a.meanY - b.meanY);

    // ── Step 2: Find column split point (largest X-gap among all dots) ────────
    const sortedByX = [...dedupedDots].sort((a, b) => a.x - b.x);
    let bestGap = 0, gapIdx = -1;
    for (let i = 1; i < sortedByX.length; i++) {
      const gap = sortedByX[i].x - sortedByX[i - 1].x;
      if (gap > bestGap) { bestGap = gap; gapIdx = i; }
    }
    const minColGap = medRadius * 2.4;
    let colMidX;
    if (bestGap > minColGap && gapIdx > 0) {
      // Column split detected: midpoint between the two flanking dots
      colMidX = (sortedByX[gapIdx - 1].x + sortedByX[gapIdx].x) / 2;
    } else {
      // No real column gap — all dots are in the same (left) column.
      // Setting colMidX = max(x) + 1 places every dot strictly to the left,
      // correctly assigning all bits to the left-column offsets (0/1/2).
      // The old formula (min+max)/2+1 failed when X range was < 4px because
      // the rightmost dot could land exactly on or above colMidX (e.g. for 'l'
      // with xs=[926,927,929]: (926+929)/2+1=928.5, and 929≥928.5 → right col).
      colMidX = Math.max(...dedupedDots.map(d => d.x)) + 1;
    }

    // ── Step 3: Build 6-bit pattern — rowIdx from yGroups, col from X vs midX ─
    let pattern = 0;
    yGroups.slice(0, 3).forEach((g, rowIdx) => {
      for (const d of g.pts) {
        const colOffset = d.x < colMidX ? 0 : 3;  // left col = bits 0-2, right = 3-5
        pattern |= (1 << (colOffset + rowIdx));
      }
    });

    // ── Lookup: DOT_PATTERN_TO_CHAR (numeric bitmask, letters-first order)
    //           then BRAILLE_PATTERN_MAP (binary string LSB-first: pos0=dot1…pos5=dot6)
    // pattern integer: bit0=dot1, bit1=dot2, …, bit5=dot6
    // toString(2).padStart(6,'0') gives MSB-first → must reverse for BRAILLE_PATTERN_MAP keys
    const binStr   = pattern.toString(2).padStart(6, '0').split('').reverse().join('');
    const bestChar = DOT_PATTERN_TO_CHAR.get(pattern)
                  ?? BRAILLE_PATTERN_MAP[binStr]
                  ?? '?';

    const leftDots  = sortedByX.slice(0, gapIdx > 0 && bestGap > minColGap ? gapIdx : sortedByX.length);
    const rightDots = sortedByX.slice(gapIdx > 0 && bestGap > minColGap ? gapIdx : sortedByX.length);

    console.log(
      `[DotPattern] r${cell.rowIndex}c${cell.colIndex}: ${dedupedDots.length} dots,`,
      `L=${leftDots.length} R=${rightDots.length}, gap=${bestGap.toFixed(1)},`,
      `yGroups=${yGroups.length}, colMid=${colMidX.toFixed(0)}, pattern=${binStr} → '${bestChar}'`
    );

    const dotCount = dedupedDots.length;
    const countConfidence =
      dotCount <= 1 ? 0.35 :
      dotCount === 2 ? 0.52 :
      dotCount === 3 ? 0.68 : 0.78;
    const colQuality = rightDots.length > 0 || dotCount <= 3 ? 1 : 0.65;
    const patternConfidence = bestChar !== '?'
      ? Math.min(0.9, countConfidence * colQuality)
      : 0.08;

    return {
      char:       bestChar,
      confidence: patternConfidence,
      rowIndex:   cell.rowIndex,
      colIndex:   cell.colIndex,
      isSpace:    false,
      dotPattern: pattern,
    };
  });
}

/**
 * Match each cell to a character using the detected dot positions.
 *
 * Replaces NCC template matching: each cell's dot coordinates (populated by
 * segmentCellRegions) are classified into their 2×3 Braille grid positions,
 * then the resulting 6-bit binary string is looked up in BRAILLE_PATTERN_MAP.
 *
 * This function is a thin wrapper around matchCellsByDotPattern() that:
 *  - Handles space markers (isSpace cells)
 *  - Logs the recognised string for debugging
 *
 * @param {ImageData} roiData      Not used in this implementation (kept for API compatibility)
 * @param {Array<{x,y,w,h,rowIndex,colIndex,isSpace,dots}>} cellRegions
 * @returns {Array<{char, confidence, rowIndex, colIndex, isSpace}>}
 */
export function matchCellsToTemplates(roiData, cellRegions) {
  if (!cellRegions || cellRegions.length === 0) return [];

  const results = matchCellsByDotPattern(cellRegions);

  const nonSpace = results.filter(c => !c.isSpace);
  const matched  = nonSpace.filter(c => c.char !== '?');
  console.log(
    `[Detector] Dot-pattern matched: ${matched.length}/${nonSpace.length}`,
    '→', nonSpace.map(c => c.char).join(''),
  );
  return results;
}

// ─── Sentence Assembly ────────────────────────────────────────────────────────
/**
 * Assemble all matched cells into a human-readable sentence.
 *
 * Ordering: rowIndex ASC → colIndex ASC.
 * Word spaces are inserted where isSpace=true (gap analysis done in segmentCellRegions).
 * Row boundaries → space.
 *
 * @param {Array<{char, confidence, rowIndex, colIndex, isSpace}>} matchedCells
 * @returns {{ text: string, confidence: number, charCount: number }}
 */
export function assembleSentence(matchedCells) {
  if (!matchedCells || matchedCells.length === 0) {
    return { text: '', confidence: 0, charCount: 0 };
  }

  // Sort by row then column
  const sorted = [...matchedCells].sort(
    (a, b) => a.rowIndex !== b.rowIndex ? a.rowIndex - b.rowIndex : a.colIndex - b.colIndex
  );

  let text       = '';
  let prevRow    = sorted[0].rowIndex;
  let sumConf    = 0;
  let charCount  = 0;

  for (const cell of sorted) {
    if (cell.rowIndex !== prevRow) {
      // Row boundary → word space
      if (text.length > 0 && text[text.length - 1] !== ' ') text += ' ';
      prevRow = cell.rowIndex;
    }

    if (cell.isSpace) {
      if (text.length > 0 && text[text.length - 1] !== ' ') text += ' ';
    } else {
      text      += cell.char;
      sumConf   += cell.confidence;
      charCount++;
    }
  }

  // Clean up and capitalise first letter
  text = text.trim();
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  const confidence = charCount > 0 ? sumConf / charCount : 0;
  return { text, confidence, charCount };
}

// ─── Legacy alias ─────────────────────────────────────────────────────────────
/**
 * @deprecated Use segmentCellRegions + matchCellsToTemplates + assembleSentence instead.
 * Kept for backward compatibility.
 */
export function groupIntoCells(dots, estCellW, estCellH) {
  const fakeImageData = { width: 9999, height: 9999 };
  const { cellRegions, confidence } = segmentCellRegions(fakeImageData, dots, estCellW, estCellH);
  // Convert to old format
  const cells = cellRegions
    .filter(c => !c.isSpace)
    .map(c => ({ dotCount: 0, pattern: 0, confidence: 0.5, rowIndex: c.rowIndex, colIndex: c.colIndex }));
  return { cells, confidence };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
function _quickEmbossCheck(imageData) {
  const data = imageData.data;
  let sum = 0;
  const step = Math.max(1, Math.floor(data.length / (400 * 4)));
  let count = 0;
  for (let i = 0; i < data.length; i += step * 4) {
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count++;
  }
  const mean = sum / count;
  return { embossed: mean > 150 };
}

function _buildIntegralImage(data, w, h) {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y++) {
    for (let x = 1; x <= w; x++) {
      const luma = data[((y - 1) * w + (x - 1)) * 4]; // grayscale R channel
      integral[y * (w + 1) + x] =
        luma +
        integral[(y - 1) * (w + 1) + x] +
        integral[y * (w + 1) + (x - 1)] -
        integral[(y - 1) * (w + 1) + (x - 1)];
    }
  }
  return integral;
}

function _integralSum(integral, w, x1, y1, x2, y2) {
  const W = w + 1;
  return (
    integral[(y2 + 1) * W + (x2 + 1)]
    - integral[y1 * W + (x2 + 1)]
    - integral[(y2 + 1) * W + x1]
    + integral[y1 * W + x1]
  );
}

function _floodFill(binary, visited, w, h, startX, startY) {
  const queue = [[startX, startY]];
  let size = 0, sumX = 0, sumY = 0;
  let minX = startX, maxX = startX, minY = startY, maxY = startY;
  let cx = 0, cy = 0;
  while (queue.length > 0) {
    const [x, y] = queue.pop();
    const idx = y * w + x;
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    if (visited[idx] || binary[idx]) continue;
    visited[idx] = 1;
    size++;
    sumX += x; sumY += y;
    cx   += x; cy   += y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return { size, cx, cy, minX, maxX, minY, maxY };
}

function _morphCloseBinary(binary, w, h, r) {
  const dilated = new Uint8Array(w * h);
  dilated.fill(1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (binary[y * w + x] === 0) {
        const ylo = Math.max(0, y - r), yhi = Math.min(h - 1, y + r);
        const xlo = Math.max(0, x - r), xhi = Math.min(w - 1, x + r);
        for (let ny = ylo; ny <= yhi; ny++) {
          for (let nx = xlo; nx <= xhi; nx++) dilated[ny * w + nx] = 0;
        }
      }
    }
  }

  const result = new Uint8Array(w * h);
  result.fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (dilated[y * w + x] === 1) {
        const ylo = Math.max(0, y - r), yhi = Math.min(h - 1, y + r);
        const xlo = Math.max(0, x - r), xhi = Math.min(w - 1, x + r);
        for (let ny = ylo; ny <= yhi; ny++) {
          for (let nx = xlo; nx <= xhi; nx++) result[ny * w + nx] = 1;
        }
      }
    }
  }
  return result;
}

function _estimateCellSize(dots) {
  if (dots.length < 2) return { cellW: 30, cellH: 45 };

  const xDeltas = [], yDeltas = [];
  const sorted = [...dots].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const dx = sorted[i].x - sorted[i - 1].x;
    const dy = Math.abs(sorted[i].y - sorted[i - 1].y);
    if (dx > 8 && dx < 160) xDeltas.push(dx);
    if (dy > 8 && dy < 160) yDeltas.push(dy);
  }

  const medRadius = _median(dots.map(d => d.radius).filter(r => r > 0)) || 8;
  const robustX = xDeltas.filter(v => v >= medRadius * 1.2 && v <= medRadius * 8);
  const robustY = yDeltas.filter(v => v >= medRadius * 1.2 && v <= medRadius * 8);
  const medX = _median(robustX.length ? robustX : xDeltas) || Math.max(18, medRadius * 2.6);
  const medY = _median(robustY.length ? robustY : yDeltas) || Math.max(14, medRadius * 2.1);
  return {
    cellW: Math.max(12, Math.min(120, medX * 2.2)),
    cellH: Math.max(18, Math.min(180, medY * 2.6)),
  };
}

function _median(arr) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function _toGrayscaleData(rgbaData) {
  const out = new Uint8ClampedArray(rgbaData.length);
  for (let i = 0; i < rgbaData.length; i += 4) {
    const luma = Math.round(0.299 * rgbaData[i] + 0.587 * rgbaData[i + 1] + 0.114 * rgbaData[i + 2]);
    out[i] = out[i + 1] = out[i + 2] = luma;
    out[i + 3] = 255;
  }
  return out;
}
