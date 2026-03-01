# Braille Project - AI Coding Agent Instructions

## Project Overview
A mobile web application built with Framework7 v9.0.3 that scans Braille from camera images and converts it to readable text. The recognition engine uses **OpenCV.js dot-pattern OCR**: OpenCV.js (loaded from CDN as a WASM module) detects Braille dot blobs via adaptive thresholding and contour analysis; the detected dots per cell are clustered into the standard 2×3 grid and the resulting 6-bit pattern is looked up in `BRAILLE_PATTERN_MAP` to identify the character. A Canvas API blob-detection path serves as an automatic fallback when OpenCV.js has not yet loaded. All matched characters are assembled left-to-right, top-to-bottom into complete words and sentences. Deployed as both a progressive web app and a Cordova-wrapped Android/iOS app. Enables sighted users to read Braille documents and helps visually impaired users digitize Braille content.

## Tech Stack
- **Framework**: Framework7 v9.0.3 (mobile-first web framework)
- **Languages**: HTML, CSS/LESS, JavaScript (ES Modules)
- **Computer Vision**: OpenCV.js (`simple-braille-detector.js`) — **primary**; uses `@techstark/opencv-js` ^4.12.0 loaded as a WASM module via CDN `<script>` tag; dot-pattern 6-bit lookup in `BRAILLE_PATTERN_MAP` — no NCC, no template photos at runtime; Canvas API blob-detection — **automatic fallback** when OpenCV.js WASM is not yet loaded
- **Camera Access**: MediaDevices API (`getUserMedia`) for web/iOS; `cordova-plugin-android-permissions` for Android permission gating
- **Build System**: Vite ^7.3.1, `rollup-plugin-framework7` for `.f7` files, `less` for styles
- **Mobile Wrapper**: Apache Cordova (Android + iOS targets)
- **Icons**: Material Icons (self-hosted from `material-icons` npm package, fonts copied to `src/fonts/` via postinstall)

## Actual Dependencies (`package.json`)

```json
{
  "dependencies": {
    "@techstark/opencv-js": "^4.12.0-release.1",
    "dom7": "^4.0.6",
    "framework7": "^9.0.3",
    "framework7-icons": "^5.0.5",
    "material-icons": "^1.13.14",
    "skeleton-elements": "^4.0.1",
    "swiper": "^12.1.1"
  },
  "devDependencies": {
    "cpy-cli": "^7.0.0",
    "cross-env": "^10.1.0",
    "less": "^4.5.1",
    "postcss-preset-env": "^11.1.3",
    "rollup": "^4.57.1",
    "rollup-plugin-framework7": "^1.2.1",
    "vite": "^7.3.1",
    "vite-plugin-html": "^3.2.2"
  }
}
```

## Development Commands
```bash
npm install            # Installs deps and copies Material Icons fonts to src/fonts/
npm run dev            # Vite dev server (web)
npm run build          # Production build -> www/
npm run build-cordova  # Build + copy to cordova/www/ + cordova build
npm run cordova-android # Full build + run on connected Android device
npm run cordova-ios    # Full build + run on iOS device
```

## Theming & UI
- **Primary Color**: `#4CAF50` (Green - success/detected)
- **Secondary Color**: `#232B2B` (Dark Charcoal)
- **Accent Color**: `#FF5722` (Red - errors/alerts)
- **Background**: `#FFFFFF` (light) / `#1a1f1f` (dark)
- **Dark Mode**: `.theme-dark` class with CSS variable overrides

## App ID & Versioning
- **Cordova App ID**: `io.braille.app`
- **Version**: `1.0.0`
- **Android minSdkVersion**: 24

---

## App Architecture

### Routes (`src/js/routes.js`)
| Path | Component | Purpose |
|------|-----------|---------|
| `/` | `PreloaderPage` | Detector init + splash |
| `/home/` | `HomePage` | Main menu + photo upload |
| `/camera/` | `CameraPage` | Live scanning |
| `/settings/` | `SettingsPage` | App configuration |
| `/about/` | `AboutPage` | Info |
| `(.*)` | `NotFoundPage` | 404 fallback |

### Store State (`src/js/store.js`)
```javascript
state: {
  // Detection
  lastDetectedText: '',
  detectionHistory: [],   // Last 50 detections { text, confidence, braille, timestamp }
  isDetecting: false,
  confidence: 0,
  templatesLoaded: false, // true once initializeDetector() resolves (OpenCV WASM or timeout)
  opencvInitialized: false,  // unused — kept for backward compat
  opencvLoading: false,      // unused — kept for backward compat
  // Camera
  cameraActive: false,
  flashlightOn: false,
  facingMode: 'environment',
  // Settings
  darkMode: false,
  textToSpeechEnabled: true,
  soundEffectsEnabled: true,
  detectionSensitivity: 3,   // Range 1-5
  autoFocusEnabled: true,
  textSize: 16,              // Range 12-24
}
```

---

## Detection Pipeline (OpenCV.js Dot-Pattern OCR)

All pages use `simple-braille-detector.js`. The **primary** path uses OpenCV.js (cv.findContours + adaptive threshold) to locate dot blobs; the **fallback** uses Canvas API blob detection when OpenCV has not loaded. Both paths then hand off to the shared dot-pattern recogniser which maps detected dot positions onto the standard 2×3 Braille grid and looks up the resulting 6-bit integer in `DOT_PATTERN_TO_CHAR` / `BRAILLE_PATTERN_MAP`.

> **No template photos are loaded at runtime.** The `src/assets/braille-templates/` folder exists but is not used by the current detection engine.

### `initializeDetector()` — OpenCV.js WASM Loading

```javascript
// Exported compatibility shims — always false/0 (kept so preloader.f7 doesn't break)
export let templatesAreSynthetic = false;
export let templatesMissingCount = 0;

/**
 * Async init — waits for OpenCV.js WASM loaded via <script> tag in index.html.
 * Three phases:
 *   A. cv.Mat already exists     → resolve immediately
 *   B. cv exists, WASM loading   → attach cv.onRuntimeInitialized
 *   C. cv not yet in scope       → poll setInterval(200ms)
 * 15 s timeout → resolve without OpenCV so the Canvas fallback stays active.
 */
export async function initializeDetector() { ... }
```

After `initializeDetector()` resolves `_opencvReady = true` and `_cv` is set. If it times out, both remain falsy and the Canvas fallback handles all frames.

### Two Detection Modes (selected from image statistics)

**PRINTED Braille** (`mean < 150` or `stdDev ≥ 20`):
```
CLAHE(2.0, 8×8) → GaussianBlur(5,5,1.5) → Otsu INV threshold
→ MorphOpen(3×3) → findContours → circularity ≥ 0.35
```

**EMBOSSED Braille** (white-on-white, `mean > 150`):
```
percentileStretch [p2,p98]→[0,255]  (NO unsharpMask — halos cause noise explosion)
→ GaussianBlur(3,3,0.8)
→ adaptiveThreshold(MEAN_C, INV, blockSize≈2×dotDiam, C=10)
→ MorphOpen(3×3) → findContours → circularity ≥ 0.20
```

### `_extractDots(cv, contours, imageData, minCircularity, isEmbossed=false)`

Shared contour→dot extractor for both OpenCV paths. Filters by area and circularity.

```javascript
// Scale-aware area bounds
const minArea = isEmbossed
  ? Math.max(200,  imgArea * 0.0003)  // ≥ r≈8px at 1280px
  : Math.max(20,   imgArea * 0.0002);
const maxArea = isEmbossed
  ? Math.max(2000, imgArea * 0.006)   // ≤ r≈34px at 1280px
  : Math.max(300,  imgArea * 0.012);
```

### Step-by-step pipeline in `camera.f7` and `home.f7`:

```
1. captureFrame(videoEl)
   -> HTMLCanvasElement (full video frame)

2. extractCenterROI(canvas, 0.8, 0.6)
   -> ImageData (80% width × 60% height centre crop)

3. assessImageQuality(roiData)
   -> { isAcceptable, score, summary, advice, embossed }
   Scores: blur (Laplacian variance), exposure, contrast, tilt (gradient orientation)
   Embossed: mean > 150 && stdDev < 38 → score forced to 0.7
   If !isAcceptable && !embossed → show status hint, skip frame

4. detectBrailleDots(roiData)
   -> { dots: [{x, y, radius, confidence}], confidence, preprocessedImage }
   PRIMARY: _detectDotsOpenCV(imageData, embossed) — cv.findContours
   FALLBACK: Canvas adaptive-threshold + flood-fill blob analysis
   embossed flag determined by _quickEmbossCheck(imageData) (mean > 150)

5. segmentCellRegions(roiData, dots)
   -> { cellRegions: [{ x, y, w, h, rowIndex, colIndex, isSpace, dots }], confidence }
   Cell size estimated internally from dot spacing (median deltas × 2.2/2.6).
   Groups dots into Braille-line rows (Y proximity < estCellH × 1.1).
   Within each row, clusters dots into cells (X proximity < estCellW × 0.48).
   Word-space gap: horizontal gap > 1.8 × estCellW → insert isSpace marker.
   Noise guard: rejects result if realCells.length === 0 or > 60.
   Each cellRegion carries a `dots` array of the raw dot positions.

6. matchCellsToTemplates(roiData, cellRegions)
   -> matchedCells: [{ char, confidence, rowIndex, colIndex, isSpace, dotPattern }]
   Wrapper around matchCellsByDotPattern(cellRegions) — no NCC, no template images.
   For each non-space cell:
     a. Deduplicate blobs (radius < 0.5 × medRadius → noise; within-cell dedup).
     b. Y-cluster ALL dots to assign row positions (top/mid/bot = rowIdx 0/1/2).
     c. Find column split: largest X-gap among dots.
        If gap > medRadius × 2.4 → colMidX = midpoint of flanking dots.
        Else (all left col) → colMidX = max(X) + 1.
     d. Build 6-bit pattern: for each dot, bit = colOffset + rowIdx
        (left col: offset 0, right col: offset 3).
     e. Lookup: DOT_PATTERN_TO_CHAR.get(pattern) ?? BRAILLE_PATTERN_MAP[binStr] ?? '?'.
     f. confidence = countConfidence × colQuality (range 0.35–0.90); '?' → 0.08.

7. assembleSentence(matchedCells)
   -> { text: string, confidence: number, charCount: number }
   Ordered by (rowIndex ASC, colIndex ASC).
   Inserts space at row boundaries and at isSpace markers.
   Trims and capitalises first letter.

8. processDetectionResult(matchedCells, 0.38)   [home.f7] / 0.45 [camera.f7]
   -> { text, confidence, braille } | null
   Calls recognizeBrailleCells — requires MIN_RECOGNIZED_RATIO (0.34) of cells recognised
   and confidence ≥ minConfidence.

9. Stability check — rolling buffer of 6 recent results
   findConsistentResult(recentResults, 3) — need 3 matching results

10. On stable result:
    - navigator.vibrate(100)
    - showDetectionAlert() dialog (Copy / Close buttons)
    - ALERT_COOLDOWN_MS = 30000 (same message not re-alerted for 30 s)
    - dispatch setDetectedText, setConfidence, addToHistory to store
```

### Multi-Character / Multi-Row Sentence Support

A single captured frame or uploaded photo may contain **one or more lines of Braille**, each line comprising multiple cells. The pipeline:

1. Detects **all** Braille dots across the entire ROI — no limit to one line.
2. `segmentCellRegions` automatically groups dots into rows; rows are ordered top-to-bottom.
3. All recognised characters across all rows are concatenated into one sentence string.
4. A **word space** is inserted wherever the gap between adjacent cells in the same row exceeds 1.8 × estimated cell width.
5. A **line break → space** is inserted between rows so multi-line Braille becomes a continuous readable sentence.

### Processing Interval
```javascript
processingInterval = setInterval(() => throttledProcessFrame(), 200);
// throttle() utility: leading + trailing, 200 ms minimum between calls
```

### Scanning Status Messages
The `scanningStatus` string updates each frame and displays in the centre guide overlay:
- `'Position Braille in centre guide'` — idle
- `'Scanning for Braille...'` — active
- `'Improve image: <summary> (<score>%)'` — quality gate reject
- `'Embossed Braille — hold steady'` — embossed mode detected
- `'No Braille detected — move closer or adjust angle'`
- `'Cells found, matching characters...'` — template matching in progress
- `'Too many dots/noise detected — hold steady and move slightly farther'`
- `'Reading... hold steady for a moment'` — cells matched, waiting for stability
- `'Braille detected!'` — success

---

## Camera Implementation

### Permission Flow
```
$onMounted()
  |
  +-- waitForCordova()          [2 s timeout if deviceready doesn't fire]
       |
       +-- requestCamera()
            |
            +-- requestCameraWithPermission(constraints)
                 |-- Android (Cordova): cordova.plugins.permissions.requestPermissions([CAMERA])
                 |-- Web/iOS: _queryCameraPermission() via Permissions API
                 |     -> 'denied'  => return null (skip getUserMedia)
                 |     -> 'granted'|'prompt'|'unknown' => fall through
                 +-- navigator.mediaDevices.getUserMedia(constraints)
                     with 15 s timeout via Promise.race
            |
            +-- videoEl.srcObject = stream; videoEl.load()
            +-- _playVideoWhenReady(videoEl)
                 |-- waits for 'loadedmetadata' | 'canplay' events
                 |-- fallback: el.load() + play() after 2 s
                 |-- ultimate safety: resolves after 5 s regardless
            |
            +-- isLoading = false; $store.dispatch('setCameraActive', true); $update()
            +-- requestAnimationFrame -> re-attach srcObject if vDOM replaced <video>
            +-- setTimeout(() => startProcessing(), 500)
```

### Video Element Setup (Android WebView compatibility)
```javascript
videoEl.muted = true;
videoEl.setAttribute('muted', '');
videoEl.setAttribute('playsinline', 'true');
videoEl.setAttribute('webkit-playsinline', 'true');
videoEl.setAttribute('autoplay', 'true');
videoEl.playsInline = true;
videoEl.autoplay    = true;
// CSS handles all sizing — do NOT set videoEl.width / videoEl.height
videoEl.style.objectFit = 'cover';
// Assign stream and force Android WebView to process it:
videoEl.srcObject = stream;
videoEl.load();  // Critical for Android WebView — triggers source processing
```

### MediaDevices Constraints
```javascript
{
  video: {
    facingMode: { ideal: facingMode },  // 'ideal' = preference, not mandatory
    width:  { ideal: 1280 },
    height: { ideal: 720  },
  },
}
// Note: mandatory facingMode can fail silently on some Android WebViews.
```

### Camera Controls
- **Flashlight**: `track.applyConstraints({ advanced: [{ torch: true }] })` - checks `capabilities.torch` first
- **Flip Camera**: Stop all tracks -> update `facingMode` -> call `requestCamera()` again
- **Grayscale overlay**: CSS `filter: grayscale(100%)` on the `<video>` element (toggle)

### Cleanup (`$on('pageBeforeRemove', ...)` — NOT `$onBeforeUnmount`)
```javascript
$on('pageBeforeRemove', () => {
  clearInterval(processingInterval);
  if (_ttsResumeTimer) { clearInterval(_ttsResumeTimer); _ttsResumeTimer = null; }
  if (_ttsUtterance)   { window.speechSynthesis.cancel(); _ttsUtterance = null; }
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (videoEl) { videoEl.srcObject = null; }
  $store.dispatch('setCameraActive', false);
  $store.dispatch('setDetecting',    false);
});
```

---

## Cordova Configuration

### `cordova/config.xml`
- **App ID**: `io.braille.app`
- **Android**: `minSdkVersion` 24, `StatusBarOverlaysWebView` false
- **iOS**: `scheme: app`, `hostname: localhost`, `StatusBarOverlaysWebView` true

### Android Manifest Permissions (via config-file in config.xml)
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-feature android:name="android.hardware.camera" android:required="true" />
<uses-feature android:name="android.hardware.camera.autofocus" />
```

### iOS Info.plist Keys (via edit-config in config.xml)
```
NSCameraUsageDescription      -> "This app requires camera access to scan Braille documents..."
NSMicrophoneUsageDescription  -> "...for text-to-speech functionality."
NSPhotoLibraryUsageDescription -> "...may save scanned images to your photo library."
```

### Cordova Plugins
| Plugin | Purpose |
|--------|---------|
| `cordova-plugin-android-permissions` | Runtime CAMERA permission request on Android |
| `cordova-plugin-keyboard` | Keyboard shrinkView + hideFormAccessoryBar |
| `cordova-plugin-splashscreen` | Splash screen hide (2s delay via `window.navigator.splashscreen.hide()`) |
| `cordova-plugin-statusbar` | Status bar overlay/color control |

### `cordova-app.js` Lifecycle
```javascript
cordovaApp.init(f7)              // Called in app.js on Framework7 init
  |-- document.addEventListener('deviceready', ...)
       |-- handleAndroidBackButton()   // Closes modals/navigates back
       |-- handleSplashscreen()        // Hides after 2000ms
       |-- handleKeyboard()           // shrinkView + accessory bar handling
```

---

## Build System

### Vite Config (`vite.config.js`)
- **Root**: `src/`
- **Public dir**: `public/`
- **Output**: `www/` (web) or `cordova/www/` (cordova target, via `TARGET=cordova`)
- **Plugins**: `rollup-plugin-framework7` (processes `.f7` files), `vite-plugin-html` (injects `TARGET`)
- **Alias**: `@` -> `src/`
- **esbuild**: `jsxFactory: '$jsx'`, `jsxFragment: '"Fragment"'`
- **treeshake**: `false` (required for Framework7 components)

### Build Targets
```bash
# Web build
cross-env NODE_ENV=production vite build  ->  www/

# Cordova build
cross-env TARGET=cordova NODE_ENV=production vite build  ->  cordova/www/
node ./build/build-cordova.js     # post-processing
cd cordova && cordova build android
```

---

## Code Organization (`src/`)

```
src/
|-- app.f7                    # Root app component - single <div id="app"> with main view
|-- index.html                # Entry HTML (loads OpenCV.js <script> tag from CDN)
|-- assets/
|   |-- braille-originals/    # Original reference JPGs — not loaded at runtime
|   |-- braille-templates/    # PNG files exist on disk but NOT used by current detector
|   |-- sample.jpeg           # "HELLO WORLD" embossed test image (imported in home.f7)
|-- components/
|   |-- EmptyState.f7         # Reusable empty state component
|-- css/
|   |-- app.less              # Design system: CSS variables, utility classes, components
|   |-- framework7-custom.less # Framework7 theme overrides
|   |-- icons.css             # Icon sizing helpers
|-- fonts/
|   |-- material-icons.css    # Self-hosted Material Icons (copied by npm postinstall)
|   |-- filled.css / outlined.css / round.css / sharp.css / two-tone.css
|   |-- _variables.scss / _mixins.scss
|-- js/
|   |-- app.js                # Framework7 init; also registers service worker (production)
|   |-- routes.js             # All app routes
|   |-- store.js              # Framework7 createStore - full app state
|   |-- cordova-app.js        # Cordova lifecycle handlers
|   |-- framework7-custom.js  # Selective F7 component imports
|   |-- camera/
|   |   |-- frame-capture.js  # captureFrame(), extractCenterROI(), toGrayscale(), applyThreshold()
|   |-- detection/
|   |   |-- simple-braille-detector.js  # PRIMARY: OpenCV.js + dot-pattern OCR
|   |   |                               # exports: initializeDetector, assessImageQuality,
|   |   |                               #          detectBrailleDots, segmentCellRegions,
|   |   |                               #          matchCellsToTemplates, matchCellsByDotPattern,
|   |   |                               #          assembleSentence, groupIntoCells (legacy),
|   |   |                               #          templatesAreSynthetic=false, templatesMissingCount=0
|   |   |-- braille-detector.js         # Unused alternative detector (not imported anywhere)
|   |-- processing/
|   |   |-- image-enhance.js  # increaseContrast(), adjustBrightness(), unsharpMask(),
|   |   |                     # percentileStretch(), preprocessForBraille()
|   |   |-- template-loader.js  # Utility: loadImage(), renderToGrayscaleImageData(),
|   |   |                       # computeNCC(), resizeImageData(), loadAllTemplates()
|   |   |                       # (not actively used by primary detector)
|   |-- recognition/
|   |   |-- pattern-matcher.js  # recognizeBrailleCells(), processDetectionResult(),
|   |   |                       # findConsistentResult(), isLikelyGibberishText()
|   |-- utils/
|       |-- braille-mappings.js  # TEMPLATE_CHARS, CHAR_DOT_PATTERNS, DOT_PATTERN_TO_CHAR,
|       |                        # BRAILLE_PATTERN_MAP, grade1Mapping, brailleToText(), etc.
|       |-- throttle.js          # throttle(), debounce(), createStabilityChecker()
|-- pages/
    |-- preloader.f7   # Splash + initializeDetector (OpenCV WASM) -> /home/
    |-- home.f7        # Main menu + photo upload + crop + permissions + history
    |-- camera.f7      # Live scanning (full dot-pattern OCR pipeline)
    |-- settings.f7    # App settings (sensitivity, dark mode, text size, TTS, sound, clear history)
    |-- about.f7       # App info
    |-- 404.f7         # Not found
```

---

## `app.js` Initialization
```javascript
import $ from 'dom7';
import Framework7, { getDevice } from './framework7-custom.js';
import routes from './routes.js';
import store from './store.js';
import App from '../app.f7';

const device = getDevice();
const app = new Framework7({
  name: 'Braille',
  theme: 'auto',          // Automatic iOS/MD theme detection
  el: '#app',
  component: App,
  store,
  routes,
  // PWA service worker (production only)
  serviceWorker: process.env.NODE_ENV === 'production' ? { path: '/service-worker.js' } : {},
  input: {
    scrollIntoViewOnFocus: device.cordova,
    scrollIntoViewCentered: device.cordova,
  },
  statusbar: {
    iosOverlaysWebView: true,
    androidOverlaysWebView: false,
  },
  on: {
    init() {
      if (this.device.cordova) cordovaApp.init(this);
    },
  },
});
```

---

## Template Character Set & Braille Mappings (`src/js/utils/braille-mappings.js`)

### 26 Supported Characters (Dot-Pattern OCR Set)

| Group | Characters | Count |
|-------|-----------|-------|
| Lowercase letters | `a` – `z` | 26 |
| **Total** | | **26** |

> **Space** is not a template — it is inferred from the gap between cells (gap > 1.8 × estCellW).

### Grade 1 (Uncontracted) Braille — Unicode Reference
- Letters `a`–`z` (Unicode U+2801–U+2835)
- Punctuation: space (U+2800), comma `,`, period `.`, exclamation `!`, question `?`

### Cell Structure
```
Dot layout (2×3 grid — standard Braille numbering):
  Col1 (left)  Col2 (right)
      1            4        ← row 1 (top)
      2            5        ← row 2 (mid)
      3            6        ← row 3 (bot)

bit 0 = dot 1 · bit 1 = dot 2 · bit 2 = dot 3
bit 3 = dot 4 · bit 4 = dot 5 · bit 5 = dot 6
```

### Key Exports
```javascript
TEMPLATE_CHARS           // Array of 26 chars: ['a','b',...,'z']
CHAR_DOT_PATTERNS        // { a: 0b000001, b: 0b000011, ... }  char -> 6-bit dot mask
                         // bit 0=dot1(L-top), 1=dot2(L-mid), 2=dot3(L-bot)
                         // bit 3=dot4(R-top), 4=dot5(R-mid), 5=dot6(R-bot)
DOT_PATTERN_TO_CHAR      // Map<number, string>  6-bit integer -> char (letters beat digits)
BRAILLE_PATTERN_MAP      // { '100000':'a', '110000':'b', ... }  LSB-first 6-char string -> char
                         // Used by matchCellsByDotPattern for secondary lookup
grade1Mapping            // { '\u2801': 'a', ... }  Braille Unicode -> text char
textToBraille            // { 'a': '\u2801', ... }  text char -> Braille Unicode (reverse map)
brailleToText(str)       // Converts Braille Unicode string to plain text
textToBrailleString(text)// Converts plain text to Braille Unicode string
isValidBraille(str)      // Regex: /^[\u2800-\u28FF]+$/  returns boolean
createBrailleFromDots(dotNumbers[])  // e.g. [1,2] -> '\u2803' (b)
```

---

## Pattern Matcher (`src/js/recognition/pattern-matcher.js`)

### Confidence Thresholds
```javascript
MIN_TEMPLATE_CONFIDENCE  = 0.40;  // dot-pattern confidence below this -> '?' (in simple-braille-detector.js)
MIN_CELL_CONFIDENCE      = 0.42;  // used by recognizeBrailleCells
MIN_RECOGNIZED_RATIO     = 0.34;  // fraction of cells that must be recognised
// MIN_NCC_MARGIN has been removed — NCC is no longer used
```

### Key Functions
```javascript
// In simple-braille-detector.js:
matchCellsByDotPattern(cellRegions)
  // For each cell: Y-cluster dots → assign row positions → find column split via
  // largest X-gap → build 6-bit integer → lookup DOT_PATTERN_TO_CHAR / BRAILLE_PATTERN_MAP
  // -> Array<{ char, confidence, rowIndex, colIndex, isSpace, dotPattern }>

matchCellsToTemplates(roiData, cellRegions)
  // Thin wrapper around matchCellsByDotPattern(). roiData is unused (kept for API compat).
  // -> Array<{ char, confidence, rowIndex, colIndex, isSpace, dotPattern }>

assembleSentence(matchedCells)
  // Orders matchedCells by (rowIndex ASC, colIndex ASC)
  // Inserts spaces at isSpace markers and row boundaries
  // Trims and capitalises first letter
  // -> { text: string, confidence: number, charCount: number }

// In pattern-matcher.js:
recognizeBrailleCells(cells)
  // -> { text: string, confidence: number, cellCount: number }

processDetectionResult(matchedCells, minConfidence = 0.45)
  // -> { text, confidence, braille } | null

findConsistentResult(recentResults[], requiredMatches = 3)
  // Groups by text, finds majority result, requires >= requiredMatches
  // -> { text, confidence, braille } | null

isLikelyGibberishText(text, matchedCells)
  // Returns true if result looks like noise/random characters.
  // Checks: >50% unrecognised ('?') cells, avg confidence <0.25,
  // word-length distribution anomalies, excessive space/char ratio.
  // -> boolean
```

### Dot-Pattern Recognition Algorithm
No NCC. No template images. Pure geometric analysis of detected dot centroids:
```
1. Deduplicate blobs: radius < 0.5 × medRadius → discard; within DEDUP_DIST (cell.h × 0.20) → keep largest.
2. Y-cluster ALL dots by threshold (cell.h × 0.30) → up to 3 row groups (top/mid/bot).
3. Find largest X-gap among all dots. If gap > medRadius × 2.4 → two columns.
   colMidX = midpoint of flanking dots.  Else → colMidX = max(x) + 1 (all left col).
4. Build 6-bit pattern:
   bit = colOffset + rowIdx  where  left→offset=0, right→offset=3
5. Lookup: DOT_PATTERN_TO_CHAR.get(pattern)  →  then fallback BRAILLE_PATTERN_MAP[binStr]  →  '?'
6. Confidence by dot count: 1→0.35, 2→0.52, 3→0.68, 4+→0.78. '?'→0.08.
```

## Sentence Assembly Rules
1. Characters ordered left-to-right within each detected row.
2. Rows processed top-to-bottom (by ascending `rowIndex`).
3. Horizontal gap > 1.8 × `estCellW` between consecutive cells → `isSpace` marker → `' '` in output.
4. Every row boundary → `' '` (treat Braille line break as word separator).
5. Resulting string is trimmed and the first letter capitalised.
6. Unrecognised cells are marked `'?'` in `matchCellsByDotPattern`; `assembleSentence` includes `'?'` characters as-is in the output string.

---

## Template Loader (`src/js/processing/template-loader.js`)

Utility file that **exists on disk but is not actively called by the primary detector** (`simple-braille-detector.js` no longer uses NCC or template images). Functions remain available for future use or external callers.

### Key Functions
```javascript
loadImage(src)
  // -> Promise<HTMLImageElement>

renderToGrayscaleImageData(img, w, h)
  // -> ImageData (w × h, R=G=B=luma via 0.299R+0.587G+0.114B)

computeNCC(dataA, dataB)
  // dataA, dataB: same-length grayscale RGBA Uint8ClampedArrays
  // -> number in [-1, 1]  (returns 0 if either std dev is 0)

resizeImageData(imageData, targetW, targetH)
  // Bilinear interpolation resize of any RGBA ImageData.
  // -> ImageData at targetW × targetH

loadAllTemplates(templateMap, targetW, targetH)
  // templateMap: { char: importedSrc, ... }
  // -> Promise<{ [char: string]: ImageData }>

export const TEMPLATE_W = 64;   // pixels
export const TEMPLATE_H = 96;   // pixels
```

---

## Image Quality Assessment (`assessImageQuality`)

Returns: `{ isAcceptable: boolean, score: 0-1, summary: string, advice: string, embossed: boolean }`

| Component | Weight | Method |
|-----------|--------|--------|
| Blur | 40% | Laplacian variance of grayscale pixels |
| Exposure | 30% | Mean brightness + dark/bright pixel ratios |
| Contrast | 15% | Pixel standard deviation |
| Tilt | 15% | Gradient orientation coherence |

**Embossed Braille**: `mean > 150 && stdDev < 38` - treated as valid (white-on-white raised dots). Score is forced to `0.7` regardless of blur/contrast/tilt sub-scores.

---

## Image Enhancement (`src/js/processing/image-enhance.js`)

### Key Functions
```javascript
increaseContrast(imageData, factor = 1.5)
  // Linear stretch around mid=128 — boosts contrast for printed Braille
  // -> ImageData

adjustBrightness(imageData, value = 20)
  // Adds fixed value to each channel (positive = brighter)
  // -> ImageData

unsharpMask(imageData, amount = 2.5, blurRadius = 5)
  // Separable box-blur then: sharpened = clamp(original + amount × (original − blurred))
  // Critical for embossed Braille: amplifies dot-shadow micro-gradients so
  // adaptive threshold fires reliably on barely-raised dots.
  // -> ImageData (grayscale)

preprocessForBraille(imageData, isEmbossed = false)
  // Full pipeline:
  //   1. RGB → grayscale float array
  //   2a. Embossed path: percentileStretch [p2, p98] → [0, 255]
  //                      then unsharpMask(amount=1.2, radius=5)  ← gentle, reduced from 2.5
  //   2b. Non-embossed:  increaseContrast(factor=1.5)
  // NOTE: preprocessForBraille(embossed=true) is NOT called by either detection path.
  //   Canvas embossed path → percentileStretch() directly.
  //   OpenCV embossed path → percentileStretch() directly.
  //   Only non-embossed Canvas path calls preprocessForBraille(imageData, false).
  // -> ImageData (grayscale)
```

---

## Home Page (`home.f7`)

### Photo Upload Feature
In addition to "Start Scanning", the home page has a photo upload option:
```html
<button @click=${triggerPhotoPicker}>Upload Photo to Text</button>
<input type="file" accept="image/*" @change=${handlePhotoUpload} id="photo-upload-input" />
```
Processing: load image → **interactive crop step** → draw cropped area to canvas → full dot-pattern OCR pipeline:
`assessImageQuality()` → `detectBrailleDots()` → `segmentCellRegions()` → `matchCellsToTemplates()` → `assembleSentence()`

A "Try Hello World Sample" button exists in the template but is **commented out**.

After pipeline: `isLikelyGibberishText()` is called — if the result looks like noise it is discarded.

Results show the full decoded sentence, confidence %, char count, and a **Braille dot-pattern grid** for each matched cell (rendered via `getDisplayDots(char)` + `CHAR_DOT_PATTERNS`).

Errors shown in a red error card with `error_outline` icon.

### Crop Feature
After a photo is chosen, the user is taken into a full-screen crop UI before analysis:

```javascript
// Crop state variables
let cropActive  = false;    // true = crop overlay is visible
let cropImgEl   = null;     // HTMLImageElement of the chosen photo
let cropNatW, cropNatH;     // natural (original) image dimensions
// Crop rectangle in normalised image-space [0..1]
let cropNX = 0.03, cropNY = 0.03, cropNW = 0.94, cropNH = 0.94;
// Corner drag handles (hit-radius 30 px, visual dot radius 9 px)
let _cropDragMode  = null;  // null | 'move' | 'tl' | 'tr' | 'bl' | 'br'
```

- Canvas stretches to fill the screen (`flex:1`); bound via `touch-action:none` for drag.
- Corners are draggable handles (30 px hit radius); interior drag moves the whole rectangle.
- "Analyse →" button commits the crop and runs the OCR pipeline.
- "Cancel" button discards and returns to normal home view.

### Permission Cards
The home page shows live permission status cards for camera and audio:

```javascript
let cameraPermission = 'unknown';  // 'unknown' | 'granted' | 'denied' | 'prompt'
let audioPermission  = 'unknown';
```

Each card shows a colour-coded icon (green=granted, red=denied, yellow=prompt/unknown) and a
tap target that opens system settings or triggers the permission request.

### History List
The last 5 items from `$store.getters.detectionHistory` are shown in a media list. Tapping an item copies the text to clipboard.

---

## Preloader Page (`preloader.f7`)
- Calls `initializeDetector()` from `simple-braille-detector.js` — **async**: waits for OpenCV.js WASM to finish loading (polls global `cv` variable, 15 s timeout).
- Animates progress bar 0→80% during loading (20% per 100 ms tick), then jumps to 100% on resolve.
- Sets `$f7.data.detectorReady = true` and dispatches `setTemplatesLoaded(true)` after the promise resolves.
- Status text variants:
  - `'Ready!'` — OpenCV loaded successfully (or timed out with Canvas fallback active)
  - `'Initialization failed.'` — unexpected error
- No `synthWarning` or template-count banner — those were part of the old template-photo approach.
- Navigates to `/home/` after **300 ms** on success.
- Shows **Retry** button on error.

---

## Settings Page (`settings.f7`)
- **Detection Sensitivity**: `<input type="range" min="1" max="5">` -> `updateSettings({ detectionSensitivity })`
- **Auto-focus**: toggle checkbox -> `updateSettings({ autoFocusEnabled })`
- **Dark Mode**: toggle -> `toggleDarkMode` action + adds/removes `.theme-dark` on `<html>`
- **Text Size**: `<input type="range" min="12" max="24" step="2">` -> `updateSettings({ textSize })`
- **Text-to-Speech**: toggle -> `updateSettings({ textToSpeechEnabled })`
- **Sound Effects**: toggle -> `updateSettings({ soundEffectsEnabled })`
- **Clear Detection History**: `$f7.dialog.confirm(...)` → `$store.dispatch('clearHistory')`

---

## Camera Page (`camera.f7`) - Key State & Behaviors

### Local State Variables
```javascript
let cameraAvailable = true;
let detectedText    = '';
let confidence      = 0;
let flashlightOn    = false;
let grayscaleOn     = false;
let stream          = null;                  // MediaStream
let facingMode      = 'environment';         // 'environment' | 'user'
let processingInterval = null;               // setInterval handle
let videoEl         = null;                  // <video> DOM reference
let cordovaReady    = false;
let isLoading       = true;
let loadingMessage  = 'Initializing...';
let detectorReady   = true;                  // simple detector is always ready
let scanningStatus  = 'Position Braille in centre guide';  // UK spelling
let debugInfo       = '';                    // shown in debug overlay (top-left)
let recentRecognitionResults = [];           // Rolling buffer, max 6 entries
let activeDetectionDialog    = null;         // Only one dialog at a time
let isDetectionPaused        = false;        // True while dialog is open

const ALERT_COOLDOWN_MS   = 30000;           // 30 s cooldown per unique message
const messageAlertHistory = new Map();       // text -> last alert timestamp
```

### Imports Used
```javascript
import { captureFrame, extractCenterROI } from '../js/camera/frame-capture.js';
import {
  assessImageQuality,
  detectBrailleDots,
  segmentCellRegions,
  matchCellsToTemplates,
  assembleSentence,
} from '../js/detection/simple-braille-detector.js';
import { findConsistentResult, processDetectionResult } from '../js/recognition/pattern-matcher.js';
import { throttle } from '../js/utils/throttle.js';
```

### Camera Page UI Elements
- **Loading overlay**: absolute position, `rgba(0,0,0,0.85)`, green preloader + message, z-index 100
- **Back button**: top-left, links to `/home/`, uses `.camera-control-btn` style
- **`<video>` element**: `id="camera-video"`, `autoplay playsinline muted`, optional `filter:grayscale(100%)` CSS
- **Debug overlay**: top-left (z-index 60), shows `debugInfo` (video dimensions, readyState, etc.), `pointer-events:none`, monospace font
- **Centre guide box** (`.braille-guide-box`): 80% wide × 40% tall, green border, crosshairs (`.braille-guide-crosshair-h/v`), label "Align one Braille line inside this box" / "Keep rows level and centred"
- **Scanning status pill** (`.scanning-status-pill`): shows `scanningStatus`, hidden when `detectedText` is truthy
- **Detected text overlay**: commented out in template (was at `top:52%`)
- **Camera controls row**: bottom of screen, flashlight / flip camera / grayscale toggle buttons
- **Camera unavailable state**: shown when `!cameraAvailable && !isLoading`

### Detection Alert Dialog
```javascript
activeDetectionDialog = $f7.dialog.create({
  title: 'Braille Detected',
  text,
  buttons: [
    {
      text: 'Copy', bold: true,
      onClick: () => navigator.clipboard.writeText(text).then(() =>
        $f7.toast.show({ text: 'Copied!', closeTimeout: 1500 })
      ),
    },
    { text: 'Close' },
  ],
  on: {
    closed: () => {
      activeDetectionDialog = null;
      isDetectionPaused     = false;
      recentRecognitionResults = [];
      scanningStatus = 'Resuming scan... align Braille in centre guide';
      $update();
    },
  },
});
activeDetectionDialog.open();
```

### Text-to-Speech (camera page: `_doTTS(text)`, home page: `speakText(text)`)
Both pages implement the same TTS pattern with Android WebView workarounds:
```javascript
// Retain utterance reference to prevent GC on Android
_ttsUtterance = new SpeechSynthesisUtterance(text);
_ttsUtterance.rate = 0.9; _ttsUtterance.pitch = 1.0; _ttsUtterance.volume = 1.0;
// Prefer local English voice
// Periodic resume() timer prevents Android WebView 14 s pause bug
window.speechSynthesis.speak(_ttsUtterance);
// Always use 150ms settle delay after cancel() on Android
```

### Clipboard Copy
```javascript
navigator.clipboard.writeText(text).then(() =>
  $f7.toast.show({ text: 'Text copied to clipboard', closeTimeout: 2000 })
);
```

### Vibration on New Detection
```javascript
if (isNewText && navigator.vibrate) navigator.vibrate(100);
```

---

## Styling System (`src/css/app.less`)

### CSS Variables (`:root`)
```css
--f7-theme-color: #4CAF50;
--braille-primary:   #4CAF50;   /* green – success / detected */
--braille-accent:    #FF5722;   /* red   – errors / alerts    */
--braille-secondary: #232B2B;   /* dark charcoal               */
--braille-bg:        #FFFFFF;

/* Semantic colours */
--braille-success: #4CAF50;
--braille-warning: #FFC107;
--braille-error:   #F44336;
--braille-info:    #2196F3;

/* Component variables */
--navbar-bg:    #FFFFFF;
--card-bg:      #FFFFFF;
--border-color: rgba(0,0,0,0.08);
--shadow-sm:    0 2px 8px rgba(0,0,0,0.08);
--shadow-md:    0 4px 16px rgba(0,0,0,0.12);
--radius-sm:    8px;
--radius-md:    12px;
--radius-lg:    16px;
--radius-xl:    24px;

/* Golden Ratio Typography (Base: 16px, Scale x1.618) */
--font-xs: 10px;  --font-sm: 13px;  --font-base: 16px;
--font-md: 18px;  --font-lg: 22px;  --font-xl: 26px;
--font-2xl: 32px; --font-3xl: 42px;

/* Golden Ratio Spacing (Base: 8px, Scale x1.618) */
--space-0: 0px;  --space-1: 8px;   --space-2: 13px;
--space-3: 16px; --space-4: 21px;  --space-5: 26px;
--space-6: 32px; --space-7: 42px;  --space-8: 52px;
```

### Dark Mode
```css
.theme-dark {
  --braille-bg:        #1a1f1f;
  --braille-secondary: #ECEFF1;  /* light gray – NOT pure white */
  --navbar-bg:         #232B2B;
  --card-bg:           #263238;
  --border-color:      rgba(255,255,255,0.08);
  --shadow-sm:         0 2px 8px rgba(0,0,0,0.30);
  --shadow-md:         0 4px 16px rgba(0,0,0,0.40);
}
/* Cordova iOS height fix */
.device-cordova.device-ios { height: 100vh; }
```

### Utility Class Reference (all defined in `app.less`)

**Spacing**
- Margin: `.m-{0-8}`, `.mt-/mb-/ml-/mr-{0-8}`, `.mx-/my-{0-4}`
- Padding: `.p-{0-8}`, `.pt-/pb-/px-/py-{0-4}`, `.pl-4`, `.pr-4`

**Typography**
- Size: `.text-{xs,sm,base,md,lg,xl,2xl,3xl}`
- Weight: `.font-{light,normal,medium,semibold,bold}`
- Align: `.text-{left,center,right}`

**Colors**
- Text: `.color-{primary,secondary,accent,success,warning,error,info,white}`
- Background: `.bg-{primary,secondary,accent,white,success,error}`

**Flexbox**
- `.flex`, `.flex-{col,row}`
- `.flex-1` (flex: 1), `.flex-wrap`
- `.items-{start,center,end}`
- `.justify-{start,center,end,between,around}`
- `.gap-{1,2,3,4}` (uses `--space-{1,2,3,4}`)

---

## Framework7 v9 Development Guidelines

When developing features for this application, always follow the official Framework7 v9 documentation and best practices. Refer to these essential resources:

### Core Concepts
- **Events**: https://framework7.io/docs/events
- **Routes**: https://framework7.io/docs/routes
- **Router Component**: https://framework7.io/docs/router-component
- **View**: https://framework7.io/docs/view
- **Store**: https://framework7.io/docs/store
- **App**: https://framework7.io/docs/app

### Layout & Styling
- **App Layout**: https://framework7.io/docs/app-layout
- **Color Themes**: https://framework7.io/docs/color-themes
- **Typography**: https://framework7.io/docs/typography
- **CSS Variables**: https://framework7.io/docs/css-variables

### UI Components (Most Relevant)
- **Button**: https://framework7.io/docs/button
- **Block**: https://framework7.io/docs/block
- **Card**: https://framework7.io/docs/cards
- **Page**: https://framework7.io/docs/page
- **Navbar**: https://framework7.io/docs/navbar
- **Toolbar Tabbar**: https://framework7.io/docs/toolbar-tabbar
- **Toast**: https://framework7.io/docs/toast
- **Sheet Modal**: https://framework7.io/docs/sheet-modal
- **Popup**: https://framework7.io/docs/popup
- **Preloader**: https://framework7.io/docs/preloader
- **Icons**: https://framework7.io/docs/icons
- **Framework7 Icons**: https://framework7.io/icons/

### Key Development Practices
1. Always use Framework7 Router Components (`.f7` files) for page structure
2. Leverage Framework7 Store (`createStore` from `'framework7'`) for state management
3. Follow Framework7's event system for component communication
4. Use Framework7's built-in color theme system (`theme: 'auto'`)
5. Implement proper safe area handling for modern devices
6. Use DOM7 (`dom7`) for DOM manipulation instead of jQuery
7. Follow Framework7's app initialization patterns in `app.js`
8. Support both light and dark mode with `.theme-dark` CSS variable overrides
9. Always wrap array mappings with `$h` tagged template literals in templates
10. Never use plain template literals for array rendering - use `$h\`...\`` pattern

### Framework7 v9 Template Syntax Rules

Framework7 uses **tagged template literals** with the `$h` function for proper virtual DOM rendering. This is critical for arrays and dynamic content.

#### **CRITICAL: Array Mapping Syntax**

**Correct - Always use `$h` wrapper for array mappings:**
```javascript
${items.map((item) => $h`
  <li>${item.name}</li>
`)}
```

**Incorrect - Never use plain template literals for arrays:**
```javascript
// This will render as TEXT, not HTML
${items.map((item) => `
  <li>${item.name}</li>
`)}
```

**Why?** Framework7's virtual DOM engine requires `$h` tagged template literals to properly process and render HTML elements. Without `$h`, the entire HTML renders as plain text strings visible in the UI.

#### **Conditional Rendering**

```javascript
// Ternary
${condition ? $h`<div>True content</div>` : $h`<div>False content</div>`}

// Logical AND
${isVisible && $h`<div>Visible content</div>`}
```

#### **Event Handlers in Templates**

```javascript
// Correct - function reference
<button @click=${handleClick}>Click Me</button>

// Correct - inline arrow function
<a href="#" @click=${() => setFilter('all')}>Filter</a>
<button @click=${(e) => handleAction(e, item.id)}>Action</button>
<input @input=${(e) => updateField('name', e.target.value)} />

// Incorrect - string name does NOT work
<button @click="handleClick">Click Me</button>
```

**Reference Documentation**: https://framework7.io/docs/router-component

---

## Coding Standards & Design System

### Centralized Styling Approach

**IMPORTANT**: Always use centralized styling through CSS variables and reusable classes defined in `app.less`. Never use inline styles or hardcoded values.

```css
/* Correct */
color: var(--braille-primary);
background: var(--braille-secondary);
padding: var(--space-4);

/* Incorrect */
color: #4CAF50;
background: #232B2B;
padding: 21px;
```

### Centralized .LESS Styling Architecture

**CRITICAL**: Define shared component styles in centralized `.less` files, NOT in individual `.f7` files.

#### Where to Define Styles

**In .less files (`src/css/`):**
- Component styles used across multiple pages
- Utility classes (spacing, typography, colors)
- Layout patterns (grids, flexbox)
- Shared animations and transitions

**`<style scoped>` in `.f7` files ONLY for:**
1. Page-specific overrides that do not apply elsewhere
2. Unique page layouts that are not reusable (e.g., camera overlay positioning in `camera.f7`)
3. One-off styling for specific page functionality

### HTML/JSX Syntax Rules

**Asset Import Rules:**
**CRITICAL**: Always import images and videos using ES6 import statements. Never use direct paths in `src` attributes.

```javascript
// Correct: Import assets
import logo from '../assets/images/logo.png';
// Use in template:
<img src="${logo}" alt="Logo" />

// Incorrect: Direct path in src
// <img src="assets/images/logo.png" alt="Logo" />
```

**Self-Closing Tags:**
Always use proper self-closing tag syntax with `/` before the closing `>`.

```html
<!-- Correct -->
<img src="path/to/image.jpg" alt="Description" />
<input type="text" placeholder="Enter text" />
<br />
<hr />
```

**Void Elements Requiring Self-Closing:** `<img />`, `<input />`, `<br />`, `<hr />`, `<meta />`, `<link />`, `<source />`

### Material Icons Usage

**CRITICAL**: Use Material Icons (NOT Framework7 Icons) for all icon elements throughout the application. Material Icons are self-hosted via the `material-icons` npm package - fonts are copied to `src/fonts/` by the `postinstall` script (`cpy-cli`). CSS is imported in `app.js` via `import '../css/icons.css'`.

```html
<!-- Correct - Material Icons syntax -->
<i class="icon material-icons">camera_alt</i>
<i class="icon material-icons">text_fields</i>

<!-- Incorrect - Framework7 Icons (do not use) -->
<i class="icon f7-icons">camera_fill</i>
```

**Common Icons Used in This App:**
| Icon name | Usage |
|-----------|-------|
| `camera_alt` | Camera/scanning, app icon |
| `home` | Home navigation |
| `settings` | Settings nav |
| `arrow_back` | Back button |
| `flash_on` / `flash_off` | Flashlight toggle |
| `flip_camera_ios` | Switch camera front/back |
| `filter_b_and_w` / `filter` | Grayscale toggle |
| `volume_up` | Text-to-speech |
| `content_copy` | Copy text |
| `upload` | Photo upload |
| `visibility` | Preloader splash icon |
| `info` | About page |
| `dark_mode` | Dark mode setting |
| `text_fields` | Text size setting |
| `speed` | Detection sensitivity |
| `center_focus_strong` | Auto-focus setting / feature card |
| `wb_sunny` | Flashlight feature card |
| `chevron_right` | List item arrow |
| `videocam_off` | Camera unavailable state |
| `videocam` | Camera permission prompt card |
| `mic` | Microphone permission card |
| `mic_off` | Microphone denied card |
| `check_circle` | Permission granted icon |
| `error_outline` | Upload error card |
| `science` | Sample image button |
| `refresh` | Retry button (preloader) |

**Note**: Material Icons are NOT loaded from Google Fonts CDN - they are self-hosted.

---

## Reusable .f7 Components

**CRITICAL**: Create reusable `.f7` components for UI elements used across multiple pages. Currently implemented: `EmptyState.f7`.

### Component Structure

```html
<!-- /src/components/ComponentName.f7 -->
<template>
  <div class="component-name ${variant}">
    <span>${propValue}</span>
  </div>
</template>

<script>
export default (props, { $f7 }) => {
  const {
    propValue = 'default',
    variant = 'primary'
  } = props;

  return $render;
};
</script>

<style>
.component-name {
  background: var(--braille-primary);
  padding: var(--space-4);
}
</style>
```

### How to Use Components

**Step 1: Import Component**
```javascript
import MyComponent from '../components/MyComponent.f7';
```

**Step 2: Use in Template with `<${} />` syntax**
```html
<template>
  <div class="page">
    <${MyComponent}
      prop-value="Custom"
      variant="primary"
    />
  </div>
</template>
```

### Recommended Components to Create
1. **CameraOverlay.f7** - camera viewfinder with center guide
2. **DetectedTextCard.f7** - display detected Braille text with confidence
3. **ActionButton.f7** - standardized camera control buttons
4. **LoadingSpinner.f7** - loading indicator overlay
5. **SettingsItem.f7** - settings list row (toggle or range)
6. **HistoryCard.f7** - detection history entry display

### Component Best Practices
1. **Props** - always destructure with default values
2. **Events** - pass callback functions as props
3. **Naming**: Component files -> PascalCase (`CameraOverlay.f7`); import var -> PascalCase; props -> camelCase; CSS classes -> kebab-case

---

## Implementation Rules

1. **Never use inline styles** — all styling in `<style>` blocks or `.less` files
2. **Always use CSS variables** — reference variables from `app.less` `:root`
3. **Use reusable classes** — create utility classes for common patterns
4. **Follow golden ratio** — all sizing must use `--font-*` and `--space-*` scales
5. **DRY principle** — do not repeat styles; create reusable classes/components
6. **Semantic naming** — class names describe purpose, not appearance
7. **Mobile-first** — base styles for mobile, scale up with media queries
8. **Max 3 levels CSS nesting** — minimise specificity
9. **Use `$h` for arrays** — always wrap `.map()` in `$h` tagged template literals
10. **Material Icons only** — never Framework7 Icons
11. **Import assets via ES6** — never direct paths in `src` attributes. `sample.jpeg` is imported in `home.f7` via ES6 `import`. No asset glob is used by the current detector.
12. **Self-closing void elements** — always include `/>`
13. **Primary detector is `simple-braille-detector.js` with OpenCV.js dot-pattern OCR** — uses `cv.findContours` + 6-bit pattern lookup; do NOT switch to the old `braille-detector.js`; do NOT reintroduce NCC template matching unless explicitly requested
14. **`initializeDetector()` must resolve before scanning** — it waits for OpenCV.js WASM; preloader awaits this. If OpenCV times out after 15 s, the Canvas fallback becomes active — scanning STILL works.
15. **Frame stability required** — always use `findConsistentResult()` before displaying detected text; never display single-frame results directly
16. **Quality gate always first** — always call `assessImageQuality()` before detection; skip frames where `!isAcceptable && !embossed`
17. **Permission handling order** — always check Cordova `permissions` plugin first (Android), fall back to `getUserMedia` for web/iOS
18. **Throttle frame processing** — use `throttle()` utility; never process every single animation frame
19. **Alert cooldown** — respect `ALERT_COOLDOWN_MS = 30000` to avoid spam-alerting for the same detected text
20. **Multi-character sentence output** — the pipeline must always process the **entire ROI**, not just the first detected cell; `assembleSentence()` must concatenate all matched cells across all rows into a single output string
21. **`segmentCellRegions` call signature** — call as `segmentCellRegions(roiData, dots)` — cell size is estimated internally; do NOT pass raw `estCellW`/`estCellH` from outside unless you have a specific reason
22. **Word-space detection is mandatory** — always run gap analysis in `segmentCellRegions()` to insert `isSpace` markers between words; these become spaces in `assembleSentence()`
23. **Camera page lifecycle** — use `$on('pageBeforeRemove', ...)` for cleanup; do NOT use `$onBeforeUnmount` (not a valid Framework7 Router Component hook)

---

## Future Enhancements
- **Digit recognition** — add digit entries to `BRAILLE_PATTERN_MAP` and `DOT_PATTERN_TO_CHAR` (digits share dot patterns with a–j in Grade 1; number sign prefix cell U+283C needed for disambiguation)
- **Grade 2 (contracted) Braille** — requires a contraction lookup table applied after sequence assembly
- **Non-English Braille systems** (French, Spanish, Arabic UEB, etc.) — swap `BRAILLE_PATTERN_MAP` with locale-specific variant
- **Additional punctuation** — add `;`, `:`, `'`, `-`, `"` entries to `BRAILLE_PATTERN_MAP`
- **TensorFlow.js CNN model** — replace dot-pattern lookup with on-device ML for higher accuracy on worn/embossed Braille
- **Template capture tool** — in-app guided flow to optionally re-enable the NCC template path with user-captured photos
- **Confidence threshold slider in settings** — maps to `MIN_CELL_CONFIDENCE` in `pattern-matcher.js`
- **Detection history page** — full history with timestamps and per-result character breakdown
- **Freeze/capture frame** — for detailed cell-by-cell review with character overlays
- **Adjustable ROI size** — expose `extractCenterROI` width/height ratios as settings
- **Torch/flashlight availability detection** — show button only when `capabilities.torch` is present
- **Multi-language sentence output** — auto-detected locale post-processing
- **PWA offline mode** — service worker already registered in production; add pre-cache of detector assets
