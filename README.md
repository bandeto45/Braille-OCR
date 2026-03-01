# Braille OCR

A mobile web application that scans Braille from camera images or uploaded photos and converts it to readable text in real time. Built with Framework7 and OpenCV.js, deployable as a Progressive Web App (PWA) or a native Android / iOS app via Apache Cordova.

---

## Table of Contents

1. [What the App Does](#what-the-app-does)
2. [What is Braille & How to Scan It](#what-is-braille--how-to-scan-it)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Detection Pipeline — How It Works](#detection-pipeline--how-it-works)
6. [Prerequisites](#prerequisites)
7. [Installation](#installation)
8. [Running in Development](#running-in-development)
9. [Building for Production](#building-for-production)
10. [Building for Android](#building-for-android)
11. [Building for iOS](#building-for-ios)
12. [Project Source Layout](#project-source-layout)
13. [Working With Pages](#working-with-pages)
14. [Working With Styles](#working-with-styles)
15. [Working With the Detection Engine](#working-with-the-detection-engine)
16. [App State / Store](#app-state--store)
17. [PWA & Service Worker](#pwa--service-worker)
18. [Cordova Configuration](#cordova-configuration)
19. [Beginner Developer Guide](#beginner-developer-guide)
20. [Troubleshooting](#troubleshooting)
21. [Documentation & Resources](#documentation--resources)

---

## What the App Does

| Feature | Description |
|---------|-------------|
| **Live camera scan** | Point the camera at a Braille document; the app detects Braille dots in real time and displays the decoded text. |
| **Photo upload** | Pick any image from the device gallery, crop it interactively, and run the full OCR pipeline on the still image. |
| **Multi-line support** | A single capture can contain several lines of Braille; the app reads all rows top-to-bottom and assembles a complete sentence. |
| **Text-to-speech** | Any decoded result is read aloud via the Web Speech API (Android WebView compatible). |
| **Detection history** | The last 50 results are stored in app state and shown on the Home page. |
| **Settings** | Detection sensitivity, text size, dark mode, TTS and sound toggles, auto-focus. |
| **PWA** | Installable on the home screen of any modern browser without an app store. |
| **Android / iOS** | Wrapped in Cordova for native app distribution. |

---

## What is Braille & How to Scan It

### What is Braille?

Braille is a tactile writing system used by people who are visually impaired. Characters are represented as raised dots embossed on paper or plastic, arranged in cells of **two columns and three rows** — giving six possible dot positions per cell.

```
Each cell — 2 columns × 3 rows:

  Col 1 (left)   Col 2 (right)
      ● 1              ● 4      ← top row
      ● 2              ● 5      ← middle row
      ● 3              ● 6      ← bottom row

Dots are numbered 1–6. The combination of raised dots encodes a letter,
number, or punctuation mark.

Examples:
  a = dot 1 only       ●·
                        ··
                        ··

  b = dots 1 + 2       ●·
                        ●·
                        ··

  h = dots 1 + 2 + 5   ●·
                        ●●
                        ··
```

This app supports **Grade 1 (uncontracted) Braille** — each cell maps directly to one letter or punctuation mark. Grade 2 (contracted) Braille uses shorthand cells for common words and is not yet supported.

### Two Types of Braille You Will Encounter

| Type | Description | Appearance | Detection Mode |
|------|-------------|-----------|---------------|
| **Embossed (raised-dot)** | Dots are physically pressed into heavy paper or card. No ink. | White or cream page with small raised bumps arranged in a grid | Embossed mode — `percentileStretch` + adaptive threshold |
| **Printed (ink-on-paper)** | Braille printed as solid ink dots on a flat page, typically in a book or label sheet. | Dark dots on a white or light background | Printed mode — CLAHE + Otsu threshold |

> **Tip for developers:** The app auto-detects which type it is looking at from the image brightness (`mean > 150` with low standard deviation → embossed mode). You do not need to configure this manually.

---

### How to Scan Braille Correctly

Getting a reliable scan depends on **lighting, distance, and angle**. Follow these recommendations for best results.

#### Ideal Camera Setup

```
         Flashlight or lamp
               ↓  ↓  ↓
         ┌─────────────┐
         │  BRAILLE    │  ← document flat on a surface
         │  PAGE       │
         └─────────────┘
               ↑
         phone/camera
         10–20 cm above, held level
```

| Setting | Recommendation |
|---------|---------------|
| **Distance** | Hold the camera **10–20 cm (4–8 inches)** above the page. Too far → dots appear too small for the detector. Too close → cells fall outside the guide box. |
| **Angle** | Keep the camera **parallel to the page** (camera face pointing straight down, not tilted). Tilting causes trapezoidal distortion and lowers the tilt quality score. |
| **Lighting — Printed Braille** | Bright, even, diffuse light from above. Avoid shadows. Natural window light or a desk lamp works well. |
| **Lighting — Embossed Braille** | Use **raking light** — place a lamp at a low angle from the side (not overhead) so shadows form inside the dot wells. This creates the contrast the detector needs. The phone's built-in flashlight is ideal for this. |
| **Focus** | Enable auto-focus in Settings. Tap the screen to force-focus on the page if the camera hunts. |
| **Guide box** | The green rectangle on the camera screen marks the scan area. **Place one or two Braille lines inside the box**. Keep rows level and centred. |
| **Movement** | Hold the device steady. The stability buffer requires **3 matching frames** before accepting a result — any shake resets the counter. |

#### Status Messages and What They Mean

When scanning live, a status pill at the bottom of the guide box tells you exactly what is happening:

| Message | What to do |
|---------|------------|
| `Position Braille in centre guide` | No scanning yet — move the page into the green box |
| `Scanning for Braille...` | Detection is running — hold still |
| `Improve image: blurry` | Camera is out of focus — move slightly and hold steady |
| `Improve image: bad lighting` | Too dark or overexposed — improve your lighting |
| `Improve image: low contrast` | Page is too flat/uniform — try raking light |
| `Embossed Braille — hold steady` | Embossed mode triggered — keep the page still |
| `No Braille detected — move closer or adjust angle` | Dots are not visible — move closer or change the angle |
| `Too many dots/noise — hold steady and move slightly farther` | Background texture or shadows creating false dots — increase distance |
| `Reading... hold steady for a moment` | Cells matched — waiting for 3 consistent frames |
| `Braille detected!` | Result confirmed ✓ |

#### Common Scanning Mistakes and Fixes

| Mistake | Effect | Fix |
|---------|--------|-----|
| Camera too far away | Dots look like single pixels — not enough blob area for detection | Move to 10–15 cm |
| Camera too close | Cells extend outside the guide box — partial reads | Move to 15–20 cm |
| Overhead light on embossed Braille | Even lighting washes out the dot shadows — no contrast | Use a side lamp or enable the device flashlight |
| Phone tilted at an angle | Cells appear as parallelograms — column split detection fails | Hold phone level / flat above the page |
| Page on a patterned or textured surface | Background texture creates false dots | Place page on a plain white surface |
| Multiple pages stacked | Dots from the page below bleed through | Scan one page on a flat backing |
| Wet or creased page | Raised dots are flattened | Use a flat, undamaged page |
| Scanning Grade 2 contracted Braille | Contractions are decoded as individual characters, producing unexpected output | Only Grade 1 (uncontracted) is fully supported |

#### Photo Upload Tips (Home Page)

If you cannot get a good live scan, use the **Upload Photo to Text** feature on the Home page:

1. Take a photo in good lighting first (camera app, not the Braille app).
2. Tap **Upload Photo to Text** and select the image.
3. The crop tool opens. Drag the corner handles to include **only the Braille rows** you want to decode — crop out margins, titles, and any ink text above/below.
4. Tap **Analyse →**.
5. The pipeline runs multiple ROI sizes automatically (`95%×85%`, `88%×72%`, `80%×60%`) and picks the one with the highest recognition score — so even an imperfect crop often produces a result.

> For maximum accuracy on a still photo: crop tightly so each Braille row fills most of the frame width, with minimal blank margin above and below.

---

## Tech Stack

### Runtime Frameworks & Libraries

| Package | Version | Purpose |
|---------|---------|---------|
| [Framework7](https://framework7.io) | ^9.0.3 | Mobile-first UI framework — pages, navigation, dialogs, store |
| [dom7](https://framework7.io/docs/dom7) | ^4.0.6 | Lightweight jQuery-like DOM utility used by Framework7 |
| [Swiper](https://swiperjs.com) | ^12.1.2 | Touch slider (bundled with Framework7) |
| [skeleton-elements](https://skeleton-elements.dev) | ^4.0.1 | Skeleton loading placeholders |
| [framework7-icons](https://framework7.io/icons/) | ^5.0.5 | Framework7 icon font (installed but Material Icons are used instead) |
| [material-icons](https://fonts.google.com/icons) | ^1.13.14 | Self-hosted Material Icons font — all in-app icons |
| [OpenCV.js](https://docs.opencv.org/4.9.0/opencv.js) | 4.9.0 | Computer vision WASM module — dot blob detection via `cv.findContours` |

### Build & Tooling

| Package | Version | Purpose |
|---------|---------|---------|
| [Vite](https://vitejs.dev) | ^7.3.1 | Dev server and production bundler |
| [rollup-plugin-framework7](https://www.npmjs.com/package/rollup-plugin-framework7) | ^1.2.1 | Compiles `.f7` single-file components |
| [vite-plugin-html](https://github.com/vbenjs/vite-plugin-html) | ^3.2.2 | Injects `TARGET` variable into `index.html` at build time |
| [less](https://lesscss.org) | ^4.5.1 | CSS pre-processor for `src/css/*.less` |
| [postcss-preset-env](https://preset-env.cssdb.org) | ^11.2.0 | Modern CSS transforms for browser compatibility |
| [workbox-cli](https://developer.chrome.com/docs/workbox/modules/workbox-cli/) | ^7.4.0 | Generates `service-worker.js` for PWA offline support |
| [cpy-cli](https://github.com/sindresorhus/cpy-cli) | ^7.0.0 | Copies font files from `node_modules` into `src/fonts/` after install |
| [cross-env](https://github.com/kentcdodds/cross-env) | ^10.1.0 | Cross-platform environment variable setting in npm scripts |

### Mobile (Cordova)

| Plugin | Version | Purpose |
|--------|---------|---------|
| [cordova-plugin-android-permissions](https://github.com/dpa99c/cordova-plugin-android-permissions) | ^1.1.5 | Runtime camera permission request on Android |
| [cordova-plugin-statusbar](https://github.com/apache/cordova-plugin-statusbar) | ^4.0.0 | Status bar overlay and colour control |
| [cordova-plugin-keyboard](https://github.com/cjpearson/cordova-plugin-keyboard) | ^1.3.0 | Keyboard resize behaviour and accessory bar |
| [cordova-plugin-splashscreen](https://github.com/apache/cordova-plugin-splashscreen) | bundled | Splash screen hide after app ready |

---

## Project Structure

```
Braille-OCR/
├── src/                   ← All source code (edit files here)
│   ├── index.html         ← Entry HTML — loads OpenCV.js CDN <script>
│   ├── app.f7             ← Root app component
│   ├── manifest.json      ← PWA web app manifest
│   ├── assets/            ← Static assets (sample images)
│   ├── components/        ← Reusable .f7 components
│   ├── css/               ← LESS stylesheets
│   ├── fonts/             ← Self-hosted Material Icons (auto-copied on npm install)
│   ├── js/                ← JavaScript modules
│   │   ├── app.js         ← Framework7 init + service worker registration
│   │   ├── routes.js      ← App routes
│   │   ├── store.js       ← Global state (Framework7 Store)
│   │   ├── camera/        ← Camera capture utilities
│   │   ├── detection/     ← Braille dot detection engine (OpenCV.js + Canvas fallback)
│   │   ├── processing/    ← Image enhancement utilities
│   │   ├── recognition/   ← Pattern matching and result assembly
│   │   └── utils/         ← Braille mappings, throttle helpers
│   └── pages/             ← Page components (.f7 files)
├── public/                ← Static public files copied to build output as-is
│   └── icons/             ← PWA icons
├── www/                   ← Production web build output (auto-generated, do not edit)
├── cordova/               ← Cordova project (do not edit cordova/www manually)
│   ├── config.xml         ← App ID, permissions, plugins, icons
│   └── www/               ← Cordova build output (auto-generated)
├── assets-src/            ← Source artwork for icons and splash screens
├── build/
│   └── build-cordova.js   ← Post-build Cordova assembly script
├── vite.config.js         ← Vite bundler configuration
├── workbox-config.js      ← Service worker generation config
└── package.json
```

---

## Detection Pipeline — How It Works

Understanding this flow helps when modifying or debugging the OCR engine.

```
┌─────────────────────────────────────────────────────────────────┐
│  User points camera at Braille (or uploads a photo)             │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
          captureFrame(videoEl)
          → full-resolution canvas snapshot

                        │
                        ▼
          extractCenterROI(canvas, 0.80, 0.60)
          → crops the centre 80% × 60% of the frame
            (removes edges, focuses on the guide box)

                        │
                        ▼
          assessImageQuality(roiData)
          → scores blur, exposure, contrast, tilt
          → if quality is too low → skip this frame, show advice
          → if embossed (white-on-white) detected → force accept

                        │
                        ▼
          detectBrailleDots(roiData)
          ┌─────────────────────────┐
          │ PRIMARY: OpenCV.js      │  cv.findContours after
          │ (if WASM loaded)        │  adaptive threshold / Otsu
          ├─────────────────────────┤
          │ FALLBACK: Canvas API    │  flood-fill blob detection
          │ (if OpenCV not ready)   │  used automatically
          └─────────────────────────┘
          → dots: [ { x, y, radius, confidence }, ... ]

                        │
                        ▼
          segmentCellRegions(roiData, dots)
          → groups dots into rows (by Y proximity)
          → within each row, clusters dots into cells (by X proximity)
          → detects word gaps (gap > 1.8× cell width → space marker)
          → cellRegions: [ { rowIndex, colIndex, dots[], isSpace } ]

                        │
                        ▼
          matchCellsToTemplates(roiData, cellRegions)
          → calls matchCellsByDotPattern() for each cell
          → deduplicates blobs, Y-clusters dots into top/mid/bot rows
          → finds column split via largest X-gap among dots
          → builds a 6-bit integer from dot positions
          → looks up integer in DOT_PATTERN_TO_CHAR / BRAILLE_PATTERN_MAP
          → matchedCells: [ { char, confidence, rowIndex, colIndex } ]

                        │
                        ▼
          assembleSentence(matchedCells)
          → orders characters left-to-right, top-to-bottom
          → inserts spaces at word gaps and row boundaries
          → trims result, capitalises first letter
          → { text: "Hello world", confidence: 0.82 }

                        │
                        ▼
          processDetectionResult(matchedCells, minConfidence)
          → validates recognized ratio ≥ 34% of cells
          → returns { text, confidence, braille } or null

                        │
                        ▼
          findConsistentResult(recentResults, 3)
          → requires the same text to appear in 3 of the last 6 frames
          → prevents displaying noise or single-frame artefacts

                        │
                        ▼
          ┌─────────────────────────────────────────┐
          │  Stable result confirmed                │
          │  • Show detection dialog (Copy / Close) │
          │  • Speak text via Text-to-Speech        │
          │  • Vibrate device 100 ms                │
          │  • Save to detection history (max 50)   │
          └─────────────────────────────────────────┘
```

### Braille Dot Pattern Encoding

Each Braille cell is a 2-column × 3-row grid of 6 possible dots, numbered:

```
Left col   Right col
  1           4      ← row 1 (top)
  2           5      ← row 2 (mid)
  3           6      ← row 3 (bot)
```

The detector builds a **6-bit integer** where bit 0 = dot 1, bit 1 = dot 2 … bit 5 = dot 6. This integer is looked up in `DOT_PATTERN_TO_CHAR` (e.g. `0b000001` = `'a'`, `0b000011` = `'b'`). 26 letters (a–z) plus space, comma, period, `!`, and `?` are supported.

---

## Prerequisites

Make sure the following are installed before you begin:

| Tool | Minimum Version | Install |
|------|----------------|---------|
| [Node.js](https://nodejs.org) | 18 LTS or newer | https://nodejs.org |
| [npm](https://www.npmjs.com) | 9+ (comes with Node.js) | — |
| [Git](https://git-scm.com) | any | https://git-scm.com |
| [Java JDK](https://adoptium.net) | 17 (Android builds only) | https://adoptium.net |
| [Android Studio](https://developer.android.com/studio) | latest (Android builds only) | https://developer.android.com/studio |
| [Xcode](https://developer.apple.com/xcode/) | 15+ (iOS builds only, macOS) | Mac App Store |
| [Apache Cordova CLI](https://cordova.apache.org) | 12+ (mobile builds only) | `npm install -g cordova` |

---

## Installation

```bash
# 1. Clone the repository
git clone <repository-url>
cd Braille-OCR

# 2. Install all dependencies
#    This also auto-copies Material Icons and Framework7 fonts into src/fonts/
npm install
```

> **What `npm install` does beyond downloading packages:**
> The `postinstall` script runs automatically and copies icon font files from
> `node_modules/material-icons/iconfont/` and `node_modules/framework7-icons/fonts/`
> into `src/fonts/`. These are the self-hosted icon fonts used in the UI.

---

## Running in Development

```bash
npm run dev
```

- Starts the Vite development server (default: http://localhost:5173)
- **Hot Module Replacement (HMR)** — changes to `.f7`, `.js`, and `.less` files reload the browser automatically
- OpenCV.js is loaded from the CDN (`https://docs.opencv.org/4.9.0/opencv.js`) — you need an internet connection for the full OCR pipeline. The Canvas fallback still works offline.

> **Browser tip:** Open DevTools → Application → Service Workers and tick
> **"Update on reload"** during development so the service worker does not
> cache stale files.

### Accessing from a Mobile Device During Development

```bash
# The dev server binds to 0.0.0.0 (all interfaces)
# Find your machine's local IP (e.g. 192.168.1.10) and open:
#   http://192.168.1.10:5173
# in the mobile browser.
# Camera access requires HTTPS on mobile — use ngrok or a local certificate if needed.
```

---

## Building for Production

```bash
npm run build
```

- Output goes to `www/`
- Also generates `www/service-worker.js` via Workbox for PWA offline caching
- Serve the `www/` folder with any static file server to test the production build:

```bash
npx serve www
```

---

## Building for Android

### Prerequisites
- Android Studio installed with an Android SDK (API level 24+)
- `ANDROID_HOME` environment variable set, e.g.:
  ```bash
  export ANDROID_HOME=$HOME/Library/Android/sdk   # macOS
  export PATH=$PATH:$ANDROID_HOME/platform-tools
  ```
- A connected Android device (USB debugging enabled) **or** an Android emulator running

### Commands

```bash
# Build APK only (unsigned debug build)
npm run build-cordova-android

# Build AND deploy to a connected device / running emulator
npm run cordova-android
```

Both commands perform these steps automatically:
1. Vite builds `src/` → `cordova/www/`
2. `build/build-cordova.js` post-processes the output
3. `cordova build android` compiles the Android project

The resulting APK is at:
```
cordova/platforms/android/app/build/outputs/apk/debug/app-debug.apk
```

### Granting Camera Permission on Android
The app requests the `CAMERA` permission at runtime via `cordova-plugin-android-permissions`. If the permission dialog does not appear, go to **Settings → Apps → Braille → Permissions** and enable Camera manually.

---

## Building for iOS

> macOS with Xcode 15+ is required.

```bash
# Build AND deploy to a connected iOS device
npm run cordova-ios

# Build IPA only (no device required)
npm run build-cordova-ios
```

The app scheme is `app://localhost` (set in `cordova/config.xml`). Camera and microphone usage descriptions are injected into `Info.plist` automatically by the build.

---

## Project Source Layout

All files you edit live inside `src/`. Never manually edit `www/` or `cordova/www/` — those are generated.

```
src/
├── index.html                      ← Entry point: viewport meta, OpenCV CDN <script>, app mount
├── app.f7                          ← Root Framework7 app component (<f7-app>)
├── manifest.json                   ← PWA manifest (name, icons, theme colour)
│
├── pages/                          ← One .f7 file per screen
│   ├── preloader.f7                ← Splash screen; waits for OpenCV WASM to load
│   ├── home.f7                     ← Main menu, photo upload, crop tool, history
│   ├── camera.f7                   ← Live Braille scanning with camera
│   ├── settings.f7                 ← User preferences
│   ├── about.f7                    ← App information
│   └── 404.f7                      ← Not found fallback
│
├── components/
│   └── EmptyState.f7               ← Reusable "nothing here yet" placeholder component
│
├── js/
│   ├── app.js                      ← new Framework7({ ... }) — initialises the whole app
│   ├── routes.js                   ← Maps URL paths to page components
│   ├── store.js                    ← Global reactive state (Framework7 createStore)
│   ├── cordova-app.js              ← Cordova device-ready, back button, splash, keyboard
│   ├── framework7-custom.js        ← Selective Framework7 component imports (keeps bundle small)
│   │
│   ├── camera/
│   │   └── frame-capture.js        ← captureFrame(), extractCenterROI(), toGrayscale()
│   │
│   ├── detection/
│   │   ├── simple-braille-detector.js  ← PRIMARY engine: OpenCV.js + dot-pattern OCR
│   │   └── braille-detector.js         ← Unused alternative (do not import)
│   │
│   ├── processing/
│   │   ├── image-enhance.js        ← increaseContrast(), percentileStretch(), unsharpMask()
│   │   └── template-loader.js      ← NCC utilities (legacy, not used by primary detector)
│   │
│   ├── recognition/
│   │   └── pattern-matcher.js      ← recognizeBrailleCells(), processDetectionResult(),
│   │                                  findConsistentResult(), isLikelyGibberishText()
│   │
│   └── utils/
│       ├── braille-mappings.js     ← DOT_PATTERN_TO_CHAR, BRAILLE_PATTERN_MAP, helpers
│       └── throttle.js             ← throttle(), debounce(), createStabilityChecker()
│
└── css/
    ├── app.less                    ← Design system: CSS variables, layout, utilities, components
    ├── framework7-custom.less      ← Framework7 theme colour overrides
    └── icons.css                   ← Material Icons size helpers
```

---

## Working With Pages

Pages are `.f7` single-file components. Each file has three sections:

```html
<template>
  <!-- HTML markup using Framework7 components and $h tagged templates -->
</template>

<script>
export default (props, { $f7, $store, $on, $update, $el }) => {

  // Reactive local state — plain JavaScript variables
  let myValue = 'hello';

  // Lifecycle hook
  $on('pageInit', () => {
    console.log('page loaded');
  });

  // Cleanup — ALWAYS use pageBeforeRemove, not $onBeforeUnmount
  $on('pageBeforeRemove', () => {
    // stop intervals, cancel streams, etc.
  });

  return $render;
};
</script>

<style>
/* Scoped styles for this page only — prefer app.less for shared styles */
</style>
```

### Adding a New Page

1. Create `src/pages/my-page.f7`
2. Add a route in `src/js/routes.js`:
   ```javascript
   import MyPage from '../pages/my-page.f7';
   // inside routes array:
   { path: '/my-page/', component: MyPage }
   ```
3. Navigate to it from any other page:
   ```javascript
   $f7.views.main.router.navigate('/my-page/');
   // or in a template:
   <a href="/my-page/">Go there</a>
   ```

### Key Template Rules

- **Array rendering** — always wrap `.map()` in `$h`:
  ```javascript
  // Correct
  ${items.map(item => $h`<li>${item.name}</li>`)}
  // Wrong — renders as text
  ${items.map(item => `<li>${item.name}</li>`)}
  ```
- **Event handlers** — use function references or arrow functions:
  ```html
  <button @click=${handleClick}>OK</button>
  <button @click=${() => doSomething(id)}>OK</button>
  ```
- **Icons** — use Material Icons, not Framework7 Icons:
  ```html
  <i class="icon material-icons">camera_alt</i>
  ```
- **Images** — always import assets via ES6, never use raw paths in `src`:
  ```javascript
  import logo from '../assets/logo.png';
  // then in template: <img src="${logo}" />
  ```

---

## Working With Styles

All shared styles live in `src/css/app.less`. The design system is built on CSS custom properties:

### Colour Variables
```css
--braille-primary:   #4CAF50;   /* green  — success, CTAs     */
--braille-accent:    #FF5722;   /* red    — errors, alerts    */
--braille-secondary: #232B2B;   /* dark charcoal              */
--braille-bg:        #FFFFFF;   /* page background            */
```

### Spacing Scale (golden ratio, base 8 px)
```
--space-0: 0    --space-1: 8px   --space-2: 13px  --space-3: 16px
--space-4: 21px --space-5: 26px  --space-6: 32px  --space-7: 42px
```

### Typography Scale (golden ratio, base 16 px)
```
--font-xs: 10px   --font-sm: 13px   --font-base: 16px  --font-md: 18px
--font-lg: 22px   --font-xl: 26px   --font-2xl: 32px   --font-3xl: 42px
```

### Dark Mode
The `.theme-dark` class is toggled on `<html>` by the settings page. All dark mode overrides live in `app.less`:
```css
.theme-dark {
  --braille-bg:    #1a1f1f;
  --card-bg:       #263238;
  --navbar-bg:     #232B2B;
}
```

### Rules
- Always use CSS variables — never hardcode colours or pixel values
- Add shared / reusable styles to `app.less`
- Add one-off page-specific overrides to that page's `<style>` block
- Never use inline `style="..."` attributes

---

## Working With the Detection Engine

The full engine is in `src/js/detection/simple-braille-detector.js`. It has two detection modes selected automatically based on image brightness:

| Mode | Triggered when | Preprocessing |
|------|---------------|--------------|
| **Printed** | `mean < 150` or `stdDev ≥ 20` | CLAHE → GaussianBlur → Otsu threshold |
| **Embossed** | `mean > 150` (white-on-white) | percentileStretch → GaussianBlur → adaptiveThreshold |

### Tweaking Detection Sensitivity

The main knobs are at the top of `simple-braille-detector.js`:

```javascript
// Minimum dot circularity — lower = accepts more oval blobs
const MIN_CIRCULARITY_PRINTED  = 0.35;
const MIN_CIRCULARITY_EMBOSSED = 0.20;

// How many consistent frames are needed before displaying a result
// (set in camera.f7 — passed to findConsistentResult)
const REQUIRED_CONSISTENT_FRAMES = 3;
```

And in `src/js/recognition/pattern-matcher.js`:

```javascript
const MIN_TEMPLATE_CONFIDENCE = 0.40; // dot-pattern confidence — below this → '?'
const MIN_CELL_CONFIDENCE     = 0.42; // cell-level acceptance threshold
const MIN_RECOGNIZED_RATIO    = 0.34; // fraction of cells that must be recognised
```

### Adding New Braille Characters

Edit `src/js/utils/braille-mappings.js`:

```javascript
// CHAR_DOT_PATTERNS — add entry: char → 6-bit mask
// bit 0 = dot 1 (left top), bit 1 = dot 2 (left mid), bit 2 = dot 3 (left bot)
// bit 3 = dot 4 (right top), bit 4 = dot 5 (right mid), bit 5 = dot 6 (right bot)
export const CHAR_DOT_PATTERNS = {
  a: 0b000001,  // dot 1 only
  b: 0b000011,  // dots 1+2
  // ... add your character here
};

// DOT_PATTERN_TO_CHAR is built automatically from CHAR_DOT_PATTERNS
// BRAILLE_PATTERN_MAP — add LSB-first 6-char binary string entry:
export const BRAILLE_PATTERN_MAP = {
  '100000': 'a',
  '110000': 'b',
  // ...
};
```

---

## App State / Store

Global state is managed in `src/js/store.js` using Framework7's built-in store (similar to Vuex).

### Reading State in a Page

```javascript
// in a .f7 script section — $store is injected automatically
const text = $store.getters.lastDetectedText.value;

// or reactively in template:
${$store.getters.detectionHistory.value.slice(0, 5).map(item => $h`
  <li>${item.text}</li>
`)}
```

### Dispatching Actions

```javascript
$store.dispatch('setDetectedText', 'hello world');
$store.dispatch('addToHistory', { text, confidence, braille, timestamp: Date.now() });
$store.dispatch('updateSettings', { darkMode: true });
$store.dispatch('clearHistory');
```

### State Shape

```javascript
{
  lastDetectedText: '',
  detectionHistory: [],      // last 50 items: { text, confidence, braille, timestamp }
  isDetecting: false,
  confidence: 0,
  templatesLoaded: false,    // true after initializeDetector() resolves
  cameraActive: false,
  flashlightOn: false,
  facingMode: 'environment',
  darkMode: false,
  textToSpeechEnabled: true,
  soundEffectsEnabled: true,
  detectionSensitivity: 3,   // 1–5
  autoFocusEnabled: true,
  textSize: 16,              // 12–24 px
}
```

---

## PWA & Service Worker

The app is a full PWA — it can be installed on any home screen from a browser (Chrome, Safari, Edge).

- The service worker (`www/service-worker.js`) is **auto-generated** by `workbox-cli` when you run `npm run build`
- It pre-caches all JS, CSS, fonts, images and HTML so the app works offline
- The manifest is at `src/manifest.json` — edit name, colours and icons there

> During development the service worker is **not registered** (`NODE_ENV !== 'production'`). If you see stale content in production, open DevTools → Application → Service Workers → click **"Unregister"** and reload.

---

## Cordova Configuration

All mobile app settings live in `cordova/config.xml`.

| Setting | Value |
|---------|-------|
| App ID | `io.braille.app` |
| Version | `1.0.0` |
| Android minSdk | 24 (Android 7.0+) |
| iOS scheme | `app://localhost` |

### Changing the App ID

1. Edit the `id` attribute in `cordova/config.xml`: `<widget id="com.yourcompany.yourapp" ...>`
2. For Android: also update `cordova/platforms/android/app/build.gradle` if it already exists, or remove and re-add the platform: `cd cordova && cordova platform rm android && cordova platform add android`

### Updating App Icons and Splash Screens

Replace images in `assets-src/` with your own (maintain the same dimensions), then run:

```bash
npx framework7 assets
```

This regenerates all densities in `cordova/res/icon/` and `cordova/res/screen/`.

---

## Beginner Developer Guide

> **New to this project? Start here.** This section explains every key concept you need to make changes confidently.

### 1. Understanding the File You Should Edit

```
src/           ← YOUR work area — all edited files live here
www/           ← GENERATED — do not touch, recreated on every build
cordova/www/   ← GENERATED — do not touch, recreated on every Cordova build
node_modules/  ← INSTALLED packages — do not touch
```

### 2. How a `.f7` File Works

A `.f7` file is a **single-file component** — HTML, JavaScript and CSS all in one file. Think of it like a React component but using tagged template literals instead of JSX.

```
<template>          ← What the user sees (HTML)
<script>            ← What happens (Logic)
<style>             ← How it looks (CSS, scoped to this file)
```

When you run `npm run dev`, Vite + `rollup-plugin-framework7` compiles `.f7` files automatically.

### 3. The Lifecycle of a Page

```
User navigates to /camera/
    ↓
$on('pageInit', ...)           → start camera, start detection interval
    ↓
User is on the page
    ↓
$on('pageBeforeRemove', ...)   → stop camera, clear interval, release memory
    ↓
User navigates away
```

**Key rule:** Always clean up in `pageBeforeRemove`. Forgetting to clear intervals or stop the camera stream will leak memory and drain the battery.

### 4. How to Make a UI Change

**Example: Change the scan button colour**

1. Open `src/css/app.less`
2. Find `.btn-braille-primary` and change `background: var(--braille-primary)` to use a different variable or add a new one in `:root`
3. Save — the browser hot-reloads instantly

**Example: Add a new button to the home page**

1. Open `src/pages/home.f7`
2. Inside `<template>`, add:
   ```html
   <button class="btn-braille-secondary" @click=${myHandler}>My Button</button>
   ```
3. Inside `<script>`, before `return $render;`, add:
   ```javascript
   function myHandler() {
     $f7.dialog.alert('Hello from my button!');
   }
   ```

### 5. How to Change What the App Detects

The entire text recognition engine is in one file:
```
src/js/detection/simple-braille-detector.js
```

The high-level functions you interact with:

| Function | What it does | Where called |
|----------|-------------|-------------|
| `initializeDetector()` | Waits for OpenCV.js WASM to load | `preloader.f7` on app start |
| `assessImageQuality(imageData)` | Checks if image is sharp/well-lit | `camera.f7`, `home.f7` |
| `detectBrailleDots(imageData)` | Finds all dot blobs | `camera.f7`, `home.f7` |
| `segmentCellRegions(imageData, dots)` | Groups dots into Braille cells | `camera.f7`, `home.f7` |
| `matchCellsToTemplates(imageData, cells)` | Converts dot patterns to characters | `camera.f7`, `home.f7` |
| `assembleSentence(matchedCells)` | Joins characters into text | `camera.f7`, `home.f7` |

### 6. How State Flows Through the App

```
User detects Braille
    ↓
camera.f7 / home.f7 calls:
    $store.dispatch('setDetectedText', text)
    $store.dispatch('addToHistory', { text, confidence, braille, timestamp })
    ↓
home.f7 history list reads:
    $store.getters.detectionHistory.value
    ↓
Any page can read:
    $store.getters.lastDetectedText.value
```

### 7. Common Development Tasks

**Run the livedev server:**
```bash
npm run dev
```

**See exactly what the detector is doing:**
On the camera page, a debug overlay appears in the top-left corner showing video dimensions, frame readyState, and dot count. It is always visible during development.

**Test the photo upload pipeline:**
Open the Home page → tap "Upload Photo to Text" → choose any Braille image → crop → tap "Analyse →". The result card shows each detected character with its dot pattern grid.

**Check for JavaScript errors:**
Open browser DevTools Console (F12). Look for red errors. Most detection errors are logged with a descriptive prefix like `[BrailleDetector]`.

**Force-reload without cache:**
```
Cmd+Shift+R  (macOS)   or   Ctrl+Shift+R  (Windows / Linux)
```

**Inspect the Framework7 store state:**
```javascript
// In the browser console:
window.app.store.state
```

### 8. Making a Production Build and Testing It

```bash
npm run build        # builds to www/
npx serve www        # serves on http://localhost:3000
```

Open http://localhost:3000 in Chrome. Open DevTools → Lighthouse → run a PWA audit to verify the service worker, offline support, and manifest are correct.

### 9. Debugging on a Physical Android Device

```bash
# 1. Enable USB debugging on the device (Settings → Developer Options → USB Debugging)
# 2. Connect the device via USB
# 3. Run:
npm run cordova-android

# 4. Open chrome://inspect in Chrome on your computer
#    Find the device under "Remote Target" → click Inspect
#    Full DevTools are available for the WebView
```

### 10. Debugging on iPhone/iPad

```bash
# 1. Connect device via USB
# 2. On device: Settings → Safari → Advanced → Web Inspector ON
# 3. Run:
npm run cordova-ios

# 4. On Mac: Safari → Develop menu → find your device → select the WebView
```

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| "OpenCV not ready" shown for a long time | CDN load failed or slow connection | Check console for network errors; Canvas fallback activates after 15 s automatically |
| Camera shows black screen on Android | `videoEl.load()` not called after `srcObject` assigned | This is handled in `camera.f7`; check that `crosswalk` / WebView version is not very old |
| Camera permission denied silently | Android WebView permission flow skipped | Tap the camera permission card on the Home page or go to device Settings → Apps → Braille → Permissions |
| Detection always shows `?` characters | Image too blurry, low contrast, or dots too small | Move closer; improve lighting; try the photo upload path with a better image |
| Build fails with "ANDROID_HOME not set" | `ANDROID_HOME` env var missing | `export ANDROID_HOME=$HOME/Library/Android/sdk` (add to `~/.zshrc`) |
| Font icons not showing (squares/boxes) | `src/fonts/` files missing | Run `npm install` again — the `postinstall` script copies them |
| Service worker serving stale files | Old SW not updated | DevTools → Application → Service Workers → Unregister, then refresh |
| `$h` template renders as plain text | Missing `$h` tag on `.map()` | Change `items.map(i => \`...\`)` to `items.map(i => $h\`...\`)` |

---

## Documentation & Resources

### Framework7
- [Core Documentation](https://framework7.io/docs/)
- [Router Components (.f7 files)](https://framework7.io/docs/router-component)
- [Store](https://framework7.io/docs/store)
- [Icons Reference](https://framework7.io/icons/)
- [Community Forum](https://forum.framework7.io)

### Computer Vision
- [OpenCV.js Documentation](https://docs.opencv.org/4.9.0/d5/d10/tutorial_js_root.html)
- [OpenCV.js CDN (4.9.0)](https://docs.opencv.org/4.9.0/opencv.js)

### Build Tools
- [Vite Documentation](https://vitejs.dev/guide/)
- [Workbox (PWA / Service Worker)](https://developer.chrome.com/docs/workbox/)

### Mobile
- [Apache Cordova Documentation](https://cordova.apache.org/docs/en/latest/)
- [Cordova Android Platform Guide](https://cordova.apache.org/docs/en/latest/guide/platforms/android/)
- [Cordova iOS Platform Guide](https://cordova.apache.org/docs/en/latest/guide/platforms/ios/)

### Web APIs Used
- [MediaDevices.getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) — camera access
- [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) — frame capture and image processing
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) — text-to-speech
- [Clipboard API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API) — copy to clipboard
- [Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API) — haptic feedback on detection