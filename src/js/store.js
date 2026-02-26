
import { createStore } from 'framework7';

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
    darkMode:               false,
    textToSpeechEnabled:    true,
    soundEffectsEnabled:    true,
    detectionSensitivity:   3,   // Range 1–5
    autoFocusEnabled:       true,
    textSize:               16,  // Range 12–24
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
    toggleDarkMode({ state }) {
      state.darkMode = !state.darkMode;
      if (state.darkMode) {
        document.documentElement.classList.add('theme-dark');
      } else {
        document.documentElement.classList.remove('theme-dark');
      }
    },
    updateSettings({ state }, settings) {
      Object.assign(state, settings);
    },
  },
});

export default store;
