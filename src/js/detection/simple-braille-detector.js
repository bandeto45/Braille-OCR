/**
 * Simple Braille Detector — Canvas API + Template-Photo OCR
 *
 * PRIMARY detector for the Braille OCR app.
 * Loads 36 reference template photos (a–z, 0–9) and uses Normalised
 * Cross-Correlation (NCC) to identify each detected Braille cell.
 * All matched characters across every row are assembled into a full sentence.
 *
 * Exports:
 *   initializeDetector()     async — must resolve before processing frames
 *   assessImageQuality(imageData)
 *   detectBrailleDots(imageData)
 *   segmentCellRegions(imageData, dots, estCellW, estCellH)
 *   matchCellsToTemplates(imageData, cellRegions)
 *   assembleSentence(matchedCells)
 *   groupIntoCells(dots, cellW, cellH)   ← legacy alias
 */

import { TEMPLATE_CHARS, CHAR_DOT_PATTERNS, DOT_PATTERN_TO_CHAR } from '../utils/braille-mappings.js';
import {
  TEMPLATE_W, TEMPLATE_H,
  computeNCC, resizeImageData, renderToGrayscaleImageData, loadImage,
} from '../processing/template-loader.js';
import { preprocessForBraille } from '../processing/image-enhance.js';

// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_TEMPLATE_CONFIDENCE = 0.40;
const WORD_GAP_RATIO          = 1.8;  // gap > ratio × estCellW → word space

// ─── Template store ───────────────────────────────────────────────────────────
/** @type {Object<string, ImageData>} */
let templateImageData = {};
let detectorInitialized = false;

/**
 * True when real PNG photos are NOT present and synthetic dot-pattern images
 * are used instead.  UI may show a "No template photos" banner when true.
 */
export let templatesAreSynthetic = false;

// Vite glob import — resolved URLs for all 36 template photos (.jpg or .png).
// Handles both uppercase (A.jpg) and lowercase (a.png) filenames.
// Returns an empty object when no image files exist in the folder.
const TEMPLATE_URLS = import.meta.glob(
  [
    '../../assets/braille-templates/*.jpg',
    '../../assets/braille-templates/*.jpeg',
    '../../assets/braille-templates/*.png',
  ],
  { eager: false, query: '?url', import: 'default' }
);

// ─── Synthetic template generator ────────────────────────────────────────────
/**
 * Generate a grayscale ImageData for a single Braille character by drawing
 * its dot pattern on a canvas.  Used as a fallback when the real PNG photo
 * is absent from src/assets/braille-templates/.
 *
 * Standard Braille dot numbering applied here:
 *   dot 1 = left col, top row    dot 4 = right col, top row
 *   dot 2 = left col, mid row    dot 5 = right col, mid row
 *   dot 3 = left col, bot row    dot 6 = right col, bot row
 *
 * @param {string} ch  Single character key (e.g. 'a', '3')
 * @returns {ImageData}  Grayscale RGBA ImageData at TEMPLATE_W × TEMPLATE_H
 */
function generateSyntheticTemplate(ch) {
  const w = TEMPLATE_W;   // 64
  const h = TEMPLATE_H;   // 96

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Dot grid: 30 % / 70 % horizontal, 18 % / 50 % / 82 % vertical
  const xL = Math.round(w * 0.30);  // left column  (~19 px)
  const xR = Math.round(w * 0.70);  // right column (~45 px)
  const yT = Math.round(h * 0.18);  // top row      (~17 px)
  const yM = Math.round(h * 0.50);  // mid row      (~48 px)
  const yB = Math.round(h * 0.82);  // bot row      (~79 px)
  const r  = Math.round(w * 0.12);  // dot radius    ( ~8 px)

  // positions[i] = [cx, cy] for dot (i+1)
  const positions = [
    [xL, yT], // dot 1  (bit 0)
    [xL, yM], // dot 2  (bit 1)
    [xL, yB], // dot 3  (bit 2)
    [xR, yT], // dot 4  (bit 3)
    [xR, yM], // dot 5  (bit 4)
    [xR, yB], // dot 6  (bit 5)
  ];

  const pattern = CHAR_DOT_PATTERNS[ch] ?? 0;
  ctx.fillStyle = 'rgb(30,30,30)';
  for (let i = 0; i < 6; i++) {
    if (pattern & (1 << i)) {
      ctx.beginPath();
      ctx.arc(positions[i][0], positions[i][1], r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Convert RGBA → grayscale ImageData
  const rgba = ctx.getImageData(0, 0, w, h);
  const gs   = new Uint8ClampedArray(rgba.data.length);
  for (let i = 0; i < rgba.data.length; i += 4) {
    const luma = Math.round(
      0.299 * rgba.data[i] + 0.587 * rgba.data[i + 1] + 0.114 * rgba.data[i + 2]
    );
    gs[i] = gs[i + 1] = gs[i + 2] = luma;
    gs[i + 3] = 255;
  }
  return new ImageData(gs, w, h);
}

// ─── Initialisation ───────────────────────────────────────────────────────────
/**
 * Async init — loads all 36 template PNGs and builds the NCC reference table.
 * Must be called once (in preloader) before any frame is processed.
 * @returns {Promise<void>}
 */
export async function initializeDetector() {
  if (detectorInitialized) return;

  const resolved = {};
  let photoCount = 0;

  await Promise.all(
    TEMPLATE_CHARS.map(async (ch) => {
      // Try all plausible filename variants: uppercase .jpg (e.g. A.jpg),
      // lowercase .jpg (a.jpg), uppercase .png (A.png), lowercase .png (a.png)
      const upper = ch.toUpperCase();
      const lower = ch.toLowerCase();
      const candidates = [
        `../../assets/braille-templates/${upper}.jpg`,
        `../../assets/braille-templates/${lower}.jpg`,
        `../../assets/braille-templates/${upper}.jpeg`,
        `../../assets/braille-templates/${lower}.jpeg`,
        `../../assets/braille-templates/${upper}.png`,
        `../../assets/braille-templates/${lower}.png`,
      ];
      try {
        const key    = candidates.find(k => TEMPLATE_URLS[k]);
        if (!key) throw new Error('no-glob-entry');
        const loader = TEMPLATE_URLS[key];
        const url    = await loader();
        const img    = await loadImage(typeof url === 'object' ? url.default : url);
        resolved[ch] = renderToGrayscaleImageData(img, TEMPLATE_W, TEMPLATE_H);
        photoCount++;
      } catch {
        // No real photo → render dot-pattern synthetic template
        resolved[ch] = generateSyntheticTemplate(ch);
      }
    })
  );

  // Flag whether we fell back to synthetic templates
  templatesAreSynthetic = photoCount < TEMPLATE_CHARS.length;

  if (templatesAreSynthetic) {
    const missing = TEMPLATE_CHARS.length - photoCount;
    console.info(
      `[BrailleDetector] ${photoCount}/36 real template photos loaded; ` +
      `${missing} synthetic dot-pattern template(s) generated. ` +
      'Add JPG or PNG photos to src/assets/braille-templates/ for better accuracy.'
    );
  }

  templateImageData = resolved;
  detectorInitialized = true;
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
 * Detect Braille dots in a ROI ImageData using adaptive thresholding + blob analysis.
 * @param {ImageData} imageData
 * @returns {{ dots: Array<{x,y,radius,confidence}>, confidence: number, preprocessedImage: ImageData }}
 */
export function detectBrailleDots(imageData) {
  const { embossed } = _quickEmbossCheck(imageData);
  const processed    = preprocessForBraille(imageData, embossed);

  const w = processed.width, h = processed.height;
  const data = processed.data;

  // ── Compute local adaptive threshold ──
  const blockSize = Math.max(11, Math.round(Math.min(w, h) / 20) | 1);
  const integral  = _buildIntegralImage(data, w, h);

  const binary = new Uint8Array(w * h);
  // C is the threshold bias: pixel < (localMean - C) → dot candidate.
  // Positive C = selective (only pixels well below local average are dots).
  // Embossed Braille has subtle shadows — after histogram normalization
  // C=5 reliably separates dot shadows without marking flat background.
  const C = 5; // same value for both modes after preprocessing normalises contrast
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

  // ── Connected-component labelling (simple flood fill) ──
  const dots = [];
  const visited = new Uint8Array(w * h);

  // Scale blob size / radius limits relative to image dimensions so the
  // detector works correctly for both 720p video frames AND full-res photos.
  const imgArea   = w * h;
  const minBlobSz = Math.max(4,   imgArea * 0.00005);  // ≥ 0.005% of image
  const maxBlobSz = Math.max(800, imgArea * 0.04);     // ≤ 4% of image
  const minRadius = Math.max(1.5, Math.sqrt(imgArea) * 0.004);
  const maxRadius = Math.max(20,  Math.sqrt(imgArea) * 0.18);

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
        if (Math.abs(dot.x - cell.meanX) < estCellW * 0.7) {
          cell.dots.push(dot);
          cell.meanX = cell.dots.reduce((s, d) => s + d.x, 0) / cell.dots.length;
          placed = true; break;
        }
      }
      if (!placed) cellClusters.push({ meanX: dot.x, dots: [dot] });
    }

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

    // ── Cluster dots by Y → row 0 (top), 1 (mid), 2 (bot) ──────────────────
    // Threshold: slightly less than the expected inter-dot-row spacing so that
    // the 3 layers (top/mid/bot) within one Braille cell form distinct clusters
    // even when the image is slightly warped.  estCellH ≈ medY×2.6, so
    // inter-dot-row spacing ≈ estCellH/2.6 ≈ 0.38×estCellH; we use 0.30× as
    // a safe threshold that is less than one inter-dot-row gap.
    const Y_THRESH = (cell.h > 0 ? cell.h * 0.30 : 25);
    const yClusters = [];
    for (const d of dedupedDots.slice().sort((a, b) => a.y - b.y)) {
      let placed = false;
      for (const cl of yClusters) {
        if (Math.abs(d.y - cl.meanY) < Y_THRESH) {
          cl.pts.push(d);
          cl.meanY = cl.pts.reduce((s, p) => s + p.y, 0) / cl.pts.length;
          placed = true; break;
        }
      }
      if (!placed) yClusters.push({ meanY: d.y, pts: [d] });
    }
    yClusters.sort((a, b) => a.meanY - b.meanY);
    const rowClusters = yClusters.slice(0, 3); // standard Braille has max 3 dot rows

    // ── Horizontal midpoint for left / right column split ────────────────────
    const cellMidX = cell.x + cell.w / 2;

    // ── Build 6-bit pattern ──────────────────────────────────────────────────
    let pattern = 0;
    rowClusters.forEach((cluster, rowIdx) => {
      for (const pt of cluster.pts) {
        const bitIdx = pt.x > cellMidX ? rowIdx + 3 : rowIdx;
        pattern |= (1 << bitIdx);
      }
    });

    // ── Lookup character via DOT_PATTERN_TO_CHAR Map (letters-first order) ──
    const bestChar = DOT_PATTERN_TO_CHAR.get(pattern) ?? '?';

    console.log(
      `[DotPattern] r${cell.rowIndex}c${cell.colIndex}: ${dedupedDots.length} dots,`,
      `Y-rows=${rowClusters.length}, midX=${cellMidX.toFixed(0)},`,
      `pattern=${pattern.toString(2).padStart(6,'0')} → '${bestChar}'`
    );

    return {
      char:       bestChar,
      confidence: bestChar !== '?' ? 0.9 : 0.1,
      rowIndex:   cell.rowIndex,
      colIndex:   cell.colIndex,
      isSpace:    false,
      dotPattern: pattern,
    };
  });
}

/**
 * Recognise each cell using dot-pattern matching only.
 * NCC template comparison is not used — dot-pattern recognition is
 * lighting/scale-independent and definitively correct for Grade 1 Braille.
 *
 * @param {ImageData} roiData      Full ROI ImageData (kept for API compat)
 * @param {Array}     cellRegions  Must include .dots[] per cell
 * @returns {Array<{char, confidence, rowIndex, colIndex, isSpace}>}
 */
export function matchCellsToTemplates(roiData, cellRegions) {
  if (!cellRegions || cellRegions.length === 0) return [];

  const results  = matchCellsByDotPattern(cellRegions);
  const nonSpace = results.filter(c => !c.isSpace);
  const matched  = nonSpace.filter(c => c.char !== '?');
  console.log(
    `[Detector] Dot-pattern: ${matched.length}/${nonSpace.length} cells recognised`,
    '→', results.filter(c => !c.isSpace).map(c => c.char).join('')
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

function _estimateCellSize(dots) {
  if (dots.length < 2) return { cellW: 30, cellH: 45 };

  const xDeltas = [], yDeltas = [];
  const sorted = [...dots].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) {
    const dx = sorted[i].x - sorted[i - 1].x;
    const dy = Math.abs(sorted[i].y - sorted[i - 1].y);
    if (dx > 2 && dx < 200) xDeltas.push(dx);
    if (dy > 2 && dy < 200) yDeltas.push(dy);
  }

  const medX = _median(xDeltas) || 18;
  const medY = _median(yDeltas) || 14;
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
