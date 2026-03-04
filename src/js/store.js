
import { createStore } from 'framework7';

// ── LocalStorage helpers ────────────────────────────────────────────────────
const STORAGE_KEY = 'braille_ocr_settings';

function loadFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (err) {
    console.error('[Store] Failed to load from localStorage:', err);
    return {};
  }
}

function saveToStorage(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.error('[Store] Failed to save to localStorage:', err);
  }
}

// Load saved settings or use defaults
const savedSettings = loadFromStorage();

const store = createStore({
  state: {
    // ── Detection ───────────────────────────────────────────────────────
    lastDetectedText: '',
    detectionHistory: [],        // Last 50 detections { text, confidence, braille, timestamp }
    isDetecting:      false,
    confidence:       0,
    templatesLoaded:  false,     // true once all 36 template PNGs are loaded
    opencvInitialized: false,
    opencvLoading:     false,
    // ── Camera ──────────────────────────────────────────────────────────
    cameraActive:     false,
    flashlightOn:     false,
    facingMode:       'environment',
    // ── Settings ────────────────────────────────────────────────────────
    darkMode:               savedSettings.darkMode ?? false,
    textToSpeechEnabled:    savedSettings.textToSpeechEnabled ?? true,
    soundEffectsEnabled:    savedSettings.soundEffectsEnabled ?? true,
    detectionSensitivity:   savedSettings.detectionSensitivity ?? 3,   // Range 1–5
    autoFocusEnabled:       savedSettings.autoFocusEnabled ?? true,
    textSize:               savedSettings.textSize ?? 16,  // Range 12–24 (default=16, medium=20, large=24)
  },

  getters: {
    lastDetectedText({ state }) { return state.lastDetectedText; },
    detectionHistory({ state }) { return state.detectionHistory; },
    isDetecting({ state })      { return state.isDetecting; },
    confidence({ state })       { return state.confidence; },
    templatesLoaded({ state })  { return state.templatesLoaded; },
    cameraActive({ state })     { return state.cameraActive; },
    darkMode({ state })         { return state.darkMode; },
    settings({ state }) {
      return {
        textToSpeechEnabled:  state.textToSpeechEnabled,
        soundEffectsEnabled:  state.soundEffectsEnabled,
        detectionSensitivity: state.detectionSensitivity,
        autoFocusEnabled:     state.autoFocusEnabled,
        textSize:             state.textSize,
      };
    },
  },

  actions: {
    setDetectedText({ state }, text) {
      state.lastDetectedText = text;
    },
    setConfidence({ state }, value) {
      state.confidence = value;
    },
    addToHistory({ state }, entry) {
      state.detectionHistory = [
        { ...entry, timestamp: Date.now() },
        ...state.detectionHistory,
      ].slice(0, 50);
    },
    clearHistory({ state }) {
      state.detectionHistory = [];
    },
    setDetecting({ state }, value) {
      state.isDetecting = value;
    },
    setTemplatesLoaded({ state }, value) {
      state.templatesLoaded = value;
    },
    setCameraActive({ state }, value) {
      state.cameraActive = value;
    },
    setFlashlight({ state }, value) {
      state.flashlightOn = value;
    },
    setFacingMode({ state }, mode) {
      state.facingMode = mode;
    },
    setDarkMode({ state }, isDark) {
      state.darkMode = isDark;
      if (state.darkMode) {
        document.documentElement.classList.add('theme-dark');
      } else {
        document.documentElement.classList.remove('theme-dark');
      }
      // Save to localStorage
      saveToStorage({
        darkMode: state.darkMode,
        textToSpeechEnabled: state.textToSpeechEnabled,
        soundEffectsEnabled: state.soundEffectsEnabled,
        detectionSensitivity: state.detectionSensitivity,
        autoFocusEnabled: state.autoFocusEnabled,
        textSize: state.textSize,
      });
    },
    toggleDarkMode({ state }) {
      state.darkMode = !state.darkMode;
      if (state.darkMode) {
        document.documentElement.classList.add('theme-dark');
      } else {
        document.documentElement.classList.remove('theme-dark');
      }
      // Save to localStorage
      saveToStorage({
        darkMode: state.darkMode,
        textToSpeechEnabled: state.textToSpeechEnabled,
        soundEffectsEnabled: state.soundEffectsEnabled,
        detectionSensitivity: state.detectionSensitivity,
        autoFocusEnabled: state.autoFocusEnabled,
        textSize: state.textSize,
      });
    },
    updateSettings({ state }, settings) {
      Object.assign(state, settings);
      // Save to localStorage
      saveToStorage({
        darkMode: state.darkMode,
        textToSpeechEnabled: state.textToSpeechEnabled,
        soundEffectsEnabled: state.soundEffectsEnabled,
        detectionSensitivity: state.detectionSensitivity,
        autoFocusEnabled: state.autoFocusEnabled,
        textSize: state.textSize,
      });
    },
  },
});

export default store;
