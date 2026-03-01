# Braille Project - AI Coding Agent Instructions

## Project Overview
A mobile web application built with Framework7 v9.0.3 that scans Braille from camera images and converts it to readable text. The recognition engine uses **template-photo OCR**: 26 pre-captured reference photos of individual Braille characters (a–z) are stored as assets; each detected cell in a live frame or uploaded image is compared against all 26 templates using Canvas-based pixel similarity to identify the character. All matched characters are assembled left-to-right, top-to-bottom into complete words and sentences. Deployed as both a progressive web app and a Cordova-wrapped Android/iOS app. Enables sighted users to read Braille documents and helps visually impaired users digitize Braille content.

## Tech Stack
- **Framework**: Framework7 v9.0.3 (mobile-first web framework)
- **Languages**: HTML, CSS/LESS, JavaScript (ES Modules)
- **Computer Vision**: Canvas API-based (`simple-braille-detector.js`) — primary, no external libs; uses **26 reference template photos** stored in `src/assets/braille-templates/` for character-level OCR matching; `@techstark/opencv-js` ^4.12.0 — optional alternative detector
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
  detectionHistory: [],   // Last 50 detections
  isDetecting: false,
  confidence: 0,
  templatesLoaded: false, // true once all 26 template PNGs are loaded by initializeDetector()
  opencvInitialized: false,
  opencvLoading: false,
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

## Detection Pipeline (Template-Photo OCR Implementation)

All pages use `simple-braille-detector.js` (Canvas API only, no external CV library). Recognition is driven by **26 pre-captured Braille character reference photos** stored in `src/assets/braille-templates/`. Each detected cell region from the live frame or uploaded image is matched against all 26 templates via pixel-level similarity to identify its character. The complete pipeline extracts **all Braille codes** present—spanning one or more rows—and assembles them into a full sentence.

### 26 Template Reference Photos

| Set | File names | Characters |
|-----|-----------|------------|
| Letters | `a.png` … `z.png` | `a` – `z` (26 files) |

**Total: 26 PNG files** located in `src/assets/braille-templates/`.

Each template photo:
- Must be a **clean, well-lit, front-facing** image of a single embossed or printed Braille cell.
- Stored at **64 × 96 px** (2 columns × 3 rows dot grid, 16 px horizontal / 16 px vertical cell margin).
- Loaded once at detector initialisation via ES6 imports and drawn into off-screen `<canvas>` elements to produce normalised `ImageData` for comparison.

### Template Loading & Initialisation (`initializeDetector`)

```javascript
// src/js/detection/simple-braille-detector.js
import templateA from '../../assets/braille-templates/a.png';
// ... repeat for all 26 files (b.png … z.png)

const TEMPLATE_MAP = {
  a: templateA, b: templateB, /* … */ z: templateZ,
};

const TEMPLATE_SIZE = { w: 64, h: 96 };  // canonical cell canvas size

let templateImageData = {};  // char -> ImageData (normalised grayscale)

export async function initializeDetector() {
  for (const [char, src] of Object.entries(TEMPLATE_MAP)) {
    const img = await loadImage(src);
    templateImageData[char] = renderToGrayscaleImageData(img, TEMPLATE_SIZE.w, TEMPLATE_SIZE.h);
  }
}

// loadImage(src)  -> Promise<HTMLImageElement>
// renderToGrayscaleImageData(img, w, h) -> ImageData (grayscale via luminance)
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
   Embossed Braille detection (white-on-white, high brightness, low contrast)
   If not acceptable -> show quality hint toast (5s cooldown)

4. detectBrailleDots(roiData)
   -> { dots: [{x, y, radius, confidence}], confidence, preprocessedImage }
   Canvas-only blob detection with adaptive preprocessing

5. Estimate cell size from dot spacing (median inter-dot distances)
   estCellW = median(xDeltas) × 2.2  (clamped to ROI-relative bounds)
   estCellH = median(yDeltas) × 2.6

6. segmentCellRegions(roiData, dots, estCellW, estCellH)
   -> cellRegions: [{ x, y, w, h, rowIndex, colIndex }]
   Groups dots into rows (by Y proximity ≤ 0.5 × estCellH).
   Within each row, sorts cells left-to-right by X.
   Word-space gap: if horizontal gap between consecutive cells > 1.8 × estCellW -> insert space marker.
   Rejects if cellRegions.length === 0 or > 60 (noise guard for multi-line content).

7. matchCellsToTemplates(roiData, cellRegions)
   -> matchedCells: [{ char, confidence, rowIndex, colIndex }]
   For each cell region:
     a. Extract cell ImageData from ROI, resize to TEMPLATE_SIZE (64 × 96 px) via bilinear scaling.
     b. Convert to grayscale ImageData.
     c. For each of the 26 templateImageData entries compute NCC (Normalised Cross-Correlation):
          ncc = Σ( (A[i] - meanA)(B[i] - meanB) ) / (stdA × stdB × N)
     d. Best template character = argmax(ncc).
     e. confidence = (ncc + 1) / 2  (mapped from [-1,1] to [0,1]).
     f. If best confidence < MIN_TEMPLATE_CONFIDENCE (0.40) -> char = '?' (unrecognised).

8. assembleSentence(matchedCells)
   -> { text: string, confidence: number, charCount: number }
   Iterates matchedCells ordered by (rowIndex ASC, colIndex ASC).
   Appends space character between rows (line break treated as word boundary).
   Inserts space wherever a space marker was inserted in step 6.
   Trims leading/trailing whitespace. Capitalises first letter of each sentence.
   Returns full decoded text (may span multiple Braille rows = multiple words).

9. processDetectionResult(matchedCells, 0.45)
   -> { text, confidence, braille }

10. Stability check — rolling buffer of 6 recent results
    findConsistentResult(recentResults, 3) — need 3 matching results

11. Combine confidences:
    final = detection × 0.3 + template_match × 0.4 + assembly × 0.3

12. On stable result:
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
  |-- waitForCordova()          [2s timeout if deviceready doesn't fire]
       |-- requestCamera()
            |-- requestCameraPermission()
                 |-- Android (Cordova): cordova.plugins.permissions.requestPermissions([CAMERA])
                 |-- Web/iOS fallback: requestCameraPermissionFallback()
                      |-- navigator.mediaDevices.getUserMedia() -> test stream -> stop tracks
            |-- getUserMediaWithTimeout(constraints, 10000)   [10s timeout]
            |-- videoEl.srcObject = stream
            |-- videoEl.play() after 200ms delay
            |-- startProcessing() after 500ms delay
```

### Video Element Setup (Android WebView compatibility)
```javascript
videoEl.muted = true;
videoEl.playsInline = true;
videoEl.autoplay = true;
videoEl.setAttribute('playsinline', 'true');
videoEl.setAttribute('webkit-playsinline', 'true');
// Force explicit dimensions for Android WebView
videoEl.width = 1280;
videoEl.height = 720;
videoEl.style.objectFit = 'cover';
videoEl.style.position = 'absolute';
```

### MediaDevices Constraints
```javascript
{
  video: {
    facingMode: 'environment',   // Back camera default
    width: { ideal: 1280 },
    height: { ideal: 720 }
  }
}
```

### Camera Controls
- **Flashlight**: `track.applyConstraints({ advanced: [{ torch: true }] })` - checks `capabilities.torch` first
- **Flip Camera**: Stop all tracks -> update `facingMode` -> call `requestCamera()` again
- **Grayscale overlay**: CSS `filter: grayscale(100%)` on the `<video>` element (toggle)

### Cleanup (`$onBeforeUnmount`)
```javascript
clearInterval(processingInterval);
stream.getTracks().forEach(track => track.stop());
videoEl.srcObject = null;
$store.dispatch('setCameraActive', false);
$store.dispatch('setDetecting', false);
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
|-- index.html                # Entry HTML
|-- test-detection.html       # Standalone detection test page
|-- assets/
|   |-- braille/              # Test Braille image assets (full-document scans)
|   |-- braille-templates/    # 26 reference template photos (64x96 px each)
|   |   |-- a.png  b.png  c.png  d.png  e.png  f.png  g.png
|   |   |-- h.png  i.png  j.png  k.png  l.png  m.png  n.png
|   |   |-- o.png  p.png  q.png  r.png  s.png  t.png  u.png
|   |   |-- v.png  w.png  x.png  y.png  z.png
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
|   |-- app.js                # Framework7 initialization entry point
|   |-- routes.js             # All app routes
|   |-- store.js              # Framework7 createStore - full app state
|   |-- cordova-app.js        # Cordova lifecycle handlers
|   |-- framework7-custom.js  # Selective F7 component imports
|   |-- camera/
|   |   |-- frame-capture.js  # captureFrame(), extractCenterROI(), toGrayscale(), applyThreshold()
|   |-- detection/
|   |   |-- simple-braille-detector.js  # PRIMARY: Template-photo OCR detector
|   |   |                               # exports: assessImageQuality, detectBrailleDots,
|   |   |                               #          segmentCellRegions, matchCellsToTemplates,
|   |   |                               #          assembleSentence, initializeDetector
|   |   |-- braille-detector.js         # ALTERNATIVE: OpenCV.js detector (not active)
|   |                                   # exports: initializeOpenCV, detectBrailleDots, groupIntoCells
|   |-- processing/
|   |   |-- image-enhance.js  # increaseContrast(), adjustBrightness(), preprocessForBraille()
|   |   |-- template-loader.js  # loadAllTemplates(), renderToGrayscaleImageData(), computeNCC()
|   |-- recognition/
|   |   |-- pattern-matcher.js  # recognizeBrailleCells(), processDetectionResult(), findConsistentResult()
|   |-- utils/
|       |-- braille-mappings.js  # TEMPLATE_CHARS (26-char set), grade1Mapping, brailleToText(),
|       |                        # createBrailleFromDots(), isValidBraille(), charToTemplateName()
|       |-- throttle.js          # throttle(), debounce(), createStabilityChecker()
|-- pages/
    |-- preloader.f7   # Splash + async template loading (initializeDetector) -> /home/
    |-- home.f7        # Main menu + photo upload feature
    |-- camera.f7      # Live scanning (full template-OCR pipeline)
    |-- settings.f7    # App settings (sensitivity, dark mode, text size, TTS, sound)
    |-- about.f7       # App info
    |-- 404.f7         # Not found
```

---

## `app.js` Initialization
```javascript
import Framework7, { getDevice } from './framework7-custom.js';
import routes from './routes.js';
import store from './store.js';
import App from '../app.f7';

const app = new Framework7({
  name: 'Braille',
  theme: 'auto',          // Automatic iOS/MD theme detection
  el: '#app',
  component: App,
  store,
  routes,
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

### 26 Supported Characters (Template-OCR Set)

| Group | Characters | Count | Template files |
|-------|-----------|-------|---------------|
| Lowercase letters | `a` – `z` | 26 | `a.png` → `z.png` |
| **Total** | | **26** | |

> **Space** is not a template — it is inferred from the gap between cells (gap > 1.8 × estCellW).

### Grade 1 (Uncontracted) Braille — Unicode Reference
- Letters `a`–`z` (Unicode U+2801–U+2835)
- Punctuation: space (U+2800), comma `,`, period `.`, exclamation `!`, question `?`

### Cell Structure
```
Dot layout (2×3 grid):
  Col1  Col2
  1     2    <- row 1
  3     4    <- row 2
  5     6    <- row 3
```

### Key Functions
```javascript
TEMPLATE_CHARS           // Array of 26 chars: ['a','b',...,'z']
charToTemplateName(ch)   // e.g. 'a' -> 'a.png'
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
MIN_TEMPLATE_CONFIDENCE  = 0.40;  // NCC score mapped to [0,1]; below this -> '?' (unrecognised)
MIN_CELL_CONFIDENCE      = 0.42;  // Used when falling back to dot-pattern matching
MIN_RECOGNIZED_RATIO     = 0.34;  // Fraction of cells that must be recognised in a result
```

### Key Functions
```javascript
matchCellsToTemplates(roiData, cellRegions)
  // For each cellRegion: extract -> resize to 64x96 -> grayscale -> NCC against all 26 templates
  // -> matchedCells: [{ char, confidence, rowIndex, colIndex }]

assembleSentence(matchedCells)
  // Orders matchedCells by (rowIndex ASC, colIndex ASC)
  // Inserts spaces at word gaps; inserts space between rows
  // -> { text: string, confidence: number, charCount: number }

recognizeBrailleCells(cells)
  // -> { text: string, confidence: number, cellCount: number }

processDetectionResult(matchedCells, minConfidence = 0.45)
  // -> { text, confidence, braille } | null

findConsistentResult(recentResults[], requiredMatches = 3)
  // Groups by text, finds majority result, requires >= requiredMatches
  // -> { text, confidence, braille } | null
```

### Template Matching — NCC Algorithm
For each cell candidate vs each template:
```javascript
// A = cell ImageData (grayscale, 64x96)
// B = template ImageData (grayscale, 64x96)
ncc = Σ( (A[i] - meanA)(B[i] - meanB) ) / (stdA × stdB × N)
confidence = (ncc + 1) / 2   // maps [-1,1] -> [0,1]
```
Best match is `argmax(confidence)` across all 26 templates. If `confidence < MIN_TEMPLATE_CONFIDENCE` the cell is marked `'?'`.

## Sentence Assembly Rules
1. Characters ordered left-to-right within each detected row.
2. Rows processed top-to-bottom (by ascending `rowIndex`).
3. Horizontal gap > 1.8 × `estCellW` between consecutive cells in the same row → insert `' '` (word space).
4. Every row boundary → insert `' '` (treat line break as word separator).
5. Resulting string is trimmed and the first letter capitalised.
6. Unrecognised cells (confidence < `MIN_TEMPLATE_CONFIDENCE`) are marked `'?'` and excluded from the output string.

---

## Template Loader (`src/js/processing/template-loader.js`)

Responsible for loading all 26 reference photos at startup and producing normalised `ImageData` used by the NCC matcher.

### Key Functions
```javascript
loadImage(src)
  // -> Promise<HTMLImageElement>
  // Creates an <img> element, sets .src, resolves on 'load', rejects on 'error'

renderToGrayscaleImageData(img, w, h)
  // -> ImageData (w × h, single luminance channel stored as RGBA where R=G=B=luma)
  // Draws img onto off-screen canvas scaled to w×h, then converts RGBA -> grayscale via:
  //   luma = 0.299*R + 0.587*G + 0.114*B

computeNCC(dataA, dataB)
  // dataA, dataB: Uint8ClampedArray (same length, grayscale RGBA)
  // -> number in [-1, 1]
  // ncc = Σ( (A[i]-meanA)(B[i]-meanB) ) / ( stdA × stdB × N )
  // Returns 0 if either std deviation is 0 (flat image)

loadAllTemplates(templateMap, targetW, targetH)
  // templateMap: { char: importedSrc, ... }  (26 entries)
  // -> Promise<{ [char: string]: ImageData }>
  // Resolves when all 26 images are loaded and converted
```

### Canonical Template Size
```javascript
export const TEMPLATE_W = 64;   // pixels — 2-column Braille cell width
export const TEMPLATE_H = 96;   // pixels — 3-row Braille cell height
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

**Embossed Braille**: `mean > 150 && stdDev < 38` - treated as valid (white-on-white raised dots), not penalized for low contrast or high brightness.

---

## Home Page - Photo Upload Feature (`home.f7`)

In addition to the "Start Scanning" button, the home page has a photo upload option:
```html
<button @click=${triggerPhotoPicker}>Upload Photo to Text</button>
<input type="file" accept="image/*" @change=${handlePhotoUpload} />
```
Processing: load image → draw to canvas → full template-OCR pipeline:
`assessImageQuality()` → `detectBrailleDots()` → `segmentCellRegions()` → `matchCellsToTemplates()` → `assembleSentence()`

The uploaded photo may contain **multiple Braille characters and multiple rows**. All detected characters are assembled into a complete sentence before display.

Results displayed inline showing the full decoded sentence with overall confidence percentage. Errors shown in a red error card.

---

## Preloader Page (`preloader.f7`)
- Calls `initializeDetector()` from `simple-braille-detector.js` — **async**: loads all 26 template PNG images into off-screen canvases and builds `templateImageData` map
- Animates progress bar 0→100% in 20% increments per 100 ms (progress tied to template loading callbacks)
- Sets `$f7.data.detectorReady = true` only after the `initializeDetector()` promise resolves
- Navigates to `/home/` after 300 ms when complete
- Shows retry button on error (e.g. a template file failed to load)

---

## Settings Page (`settings.f7`)
- **Detection Sensitivity**: `<input type="range" min="1" max="5">` -> `updateSettings({ detectionSensitivity })`
- **Auto-focus**: toggle checkbox -> `updateSettings({ autoFocusEnabled })`
- **Dark Mode**: toggle -> `toggleDarkMode` action + adds/removes `.theme-dark` on `<html>`
- **Text Size**: `<input type="range" min="12" max="24" step="2">` -> `updateSettings({ textSize })`
- **Text-to-Speech**: toggle -> `updateSettings({ textToSpeechEnabled })`
- **Sound Effects**: toggle -> `updateSettings({ soundEffectsEnabled })`

---

## Camera Page (`camera.f7`) - Key State & Behaviors

### Local State Variables
```javascript
let cameraAvailable = true;
let detectedText = '';
let confidence = 0;
let flashlightOn = false;
let grayscaleOn = false;
let stream = null;                  // MediaStream
let facingMode = 'environment';     // 'environment' | 'user'
let processingInterval = null;      // setInterval handle
let videoEl = null;                 // <video> DOM reference
let cordovaReady = false;
let isLoading = true;
let loadingMessage = 'Initializing...';
let detectorReady = true;           // simple detector is always ready
let scanningStatus = 'Position Braille in center guide';
let recentRecognitionResults = [];  // Rolling buffer, max 6 entries
let activeDetectionDialog = null;   // Only one dialog at a time
let isDetectionPaused = false;      // True while dialog is open
const ALERT_COOLDOWN_MS = 30000;    // 30s cooldown per unique message
const messageAlertHistory = new Map();  // text -> last alert timestamp
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
- **Loading overlay**: absolute position, `rgba(0,0,0,0.85)`, preloader + message, z-index 100
- **`<video>` element**: `id="camera-video"`, `autoplay playsinline muted`, optional grayscale CSS filter
- **Center guide**: crosshairs (`.braille-guide-crosshair-h/v`), title "Align one Braille line inside this box", hint "Keep rows level and centered"
- **Scanning status pill**: below center guide, shows `scanningStatus` (hidden when text detected)
- **Detected message box**: 52% from top, semi-transparent dark bg, `border: 2px solid var(--braille-primary)`, slideUp animation
- **Camera controls row**: flashlight, flip camera, grayscale toggle - icon buttons
- **Detected text overlay**: below the camera view, with speak + copy buttons
- **Debug overlay**: top-left corner, shows video dimensions / readyState / stream / detector / processing state, `pointer-events: none`
- **Empty state**: shown when `!cameraAvailable` - "Camera Access Required" with enable button
- **10s force-hide loading failsafe**: `setTimeout(() => { isLoading = false; $update(); }, 10000)`

### Detection Alert Dialog
```javascript
$f7.dialog.create({
  title: 'Braille Detected',
  text: detectedText,
  buttons: [
    { text: 'Copy', bold: true, onClick: () => copyDetectedString(text) },
    { text: 'Close' }
  ],
  on: {
    closed: () => {
      isDetectionPaused = false;
      recentRecognitionResults = [];
      scanningStatus = 'Resuming scan... align Braille in center guide';
    }
  }
});
```

### Text-to-Speech
```javascript
const utterance = new SpeechSynthesisUtterance(detectedText);
window.speechSynthesis.speak(utterance);
```

### Clipboard Copy
```javascript
navigator.clipboard.writeText(text).then(() => showToast('Text copied to clipboard'));
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
--braille-primary: #4CAF50;
--braille-accent:  #FF5722;
--braille-secondary: #232B2B;
--braille-bg:      #FFFFFF;
--braille-success: #4CAF50;
--braille-warning: #FFC107;
--braille-error:   #F44336;
--braille-info:    #2196F3;

/* Golden Ratio Typography (Base: 16px, Scale x1.618) */
--font-xs: 10px;  --font-sm: 13px;  --font-base: 16px;
--font-md: 18px;  --font-lg: 22px;  --font-xl: 26px;
--font-2xl: 32px; --font-3xl: 42px;

/* Golden Ratio Spacing (Base: 8px, Scale x1.618) */
--space-0: 0px;  --space-1: 8px;   --space-2: 13px;
--space-3: 16px; --space-4: 21px;  --space-5: 26px;
--space-6: 32px; --space-8: 52px;
```

### Dark Mode
```css
.theme-dark {
  --braille-bg: #1a1f1f;
  --braille-secondary: #FFFFFF;
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
- `.items-{start,center,end}`
- `.justify-{start,center,end,between,around}`

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
| `center_focus_strong` | Auto-focus setting |
| `wb_sunny` | Flashlight feature card |
| `chevron_right` | List item arrow |

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
11. **Import assets via ES6** — never direct paths in `src` attributes; this includes all 26 template PNGs which must be individually imported in `simple-braille-detector.js`
12. **Self-closing void elements** — always include `/>`
13. **Primary detector is `simple-braille-detector.js` with template-photo OCR** — do not switch to OpenCV (`braille-detector.js`) unless explicitly requested; do not revert to dot-counting-only recognition
14. **All 26 template images must be loaded before scanning starts** — `initializeDetector()` is async and must fully resolve before any frame is processed; preloader page awaits this promise
15. **Frame stability required** — always use `findConsistentResult()` before displaying detected text; never display single-frame results directly
16. **Quality gate always first** — always call `assessImageQuality()` before detection; skip frames below threshold
17. **Permission handling order** — always check Cordova `permissions` plugin first (Android), fall back to `getUserMedia` for web/iOS
18. **Throttle frame processing** — use `throttle()` utility; never process every single animation frame
19. **Alert cooldown** — respect `ALERT_COOLDOWN_MS = 30000` to avoid spam-alerting for the same detected text
20. **Multi-character sentence output** — the pipeline must always process the **entire ROI**, not just the first detected cell; `assembleSentence()` must concatenate all matched cells across all rows into a single output string
21. **Template size is canonical** — always resize cell regions to exactly 64 × 96 px before NCC comparison; never compare at original scale
22. **Word-space detection is mandatory** — always run gap analysis in `segmentCellRegions()` to insert spaces between words; do not rely solely on Braille space cell (U+2800) detection

---

## Future Enhancements
- Grade 2 (contracted) Braille support — requires expanded template set beyond 26 base characters
- Non-English Braille systems (French, Spanish, Arabic UEB, etc.) — language-specific template packs
- Additional punctuation template photos (`.`, `,`, `?`, `!`, `;`, `:`, `'`) and digit templates (`0`–`9`) to expand beyond the 26-letter set
- Digit recognition — add `0.png`–`9.png` templates and restore digit entries in `braille-mappings.js`
- TensorFlow.js CNN model to replace NCC template matching for higher accuracy on embossed/worn Braille
- Template capture tool — in-app guided flow to photograph and register custom Braille templates
- PWA offline mode with service worker (template assets pre-cached)
- Detection history page with timestamps, copy, and per-result character breakdown
- User feedback loop — thumbs up/down per detection to refine template confidence thresholds
- Torch/flashlight availability detection before showing button
- Freeze/capture frame for detailed cell-by-cell review with character overlays
- Adjustable ROI size (centre guide box) in settings
- Confidence threshold slider in settings (maps to `MIN_TEMPLATE_CONFIDENCE`)
- Multi-language sentence output with auto-detected locale
