/**
 * Unified Text-to-Speech helper.
 *
 * Priority:
 *   1. cordova-plugin-tts  (window.TTS)  — Android & iOS native engine;
 *      always available when running as a Cordova app.
 *   2. Web Speech API (window.speechSynthesis) — browser / PWA fallback.
 *
 * Android System WebView does NOT reliably expose window.speechSynthesis,
 * so we must prefer the native plugin on Cordova.
 */

// Module-level references kept alive to prevent GC on Android
let _webUtterance   = null;
let _webResumeTimer = null;

/** Stop any in-progress speech immediately. */
export function stopTTS() {
  if (_webResumeTimer) { clearInterval(_webResumeTimer); _webResumeTimer = null; }

  if (window.TTS) {
    try { window.TTS.stop(); } catch (_) { /* ignore */ }
  } else {
    const synth = _getSynth();
    if (synth) { try { synth.cancel(); } catch (_) { /* ignore */ } }
  }
  _webUtterance = null;
}

/**
 * Speak the given text.
 * @param {string} text
 * @param {{ rate?: number, locale?: string }} [options]
 * @returns {Promise<void>}
 */
export function speakTTS(text, options = {}) {
  if (!text) return Promise.resolve();

  stopTTS();

  // ── Native Cordova TTS plugin ───────────────────────────────────────────
  if (window.TTS) {
    return window.TTS.speak({
      text,
      rate:       options.rate   ?? 0.9,
      locale:     options.locale ?? 'en-US',
      identifier: 'en-US',
    }).catch(err => console.warn('[TTS] Cordova TTS error:', err));
  }

  // ── Web Speech API fallback ─────────────────────────────────────────────
  const synth = _getSynth();
  if (!synth) {
    console.warn('[TTS] Neither cordova-plugin-tts nor Web Speech API is available.');
    return Promise.reject(new Error('TTS not available'));
  }

  return new Promise((resolve) => {
    const _doSpeak = () => {
      try {
        _webUtterance         = new SpeechSynthesisUtterance(text);
        _webUtterance.rate    = options.rate ?? 0.9;
        _webUtterance.pitch   = 1.0;
        _webUtterance.volume  = 1.0;

        // Prefer a local English voice to avoid network dependency
        const voices = synth.getVoices();
        if (voices.length > 0) {
          const local = voices.find(v => v.localService && v.lang.startsWith('en'))
                     || voices.find(v => v.lang.startsWith('en'))
                     || voices[0];
          if (local) _webUtterance.voice = local;
        }

        _webUtterance.onend = _webUtterance.onerror = () => {
          if (_webResumeTimer) { clearInterval(_webResumeTimer); _webResumeTimer = null; }
          _webUtterance = null;
          resolve();
        };

        // Android WebView pauses synthesis after ~14 s — keep it alive
        _webResumeTimer = setInterval(() => {
          if (synth.speaking && synth.paused) {
            synth.resume();
          } else if (!synth.speaking) {
            clearInterval(_webResumeTimer); _webResumeTimer = null;
          }
        }, 5000);

        synth.speak(_webUtterance);
      } catch (err) {
        console.warn('[TTS] Web Speech speak() error:', err);
        if (_webResumeTimer) { clearInterval(_webResumeTimer); _webResumeTimer = null; }
        _webUtterance = null;
        resolve();
      }
    };

    // Small settle delay after cancel() — required on some Android versions
    setTimeout(() => {
      const voices = synth.getVoices();
      if (voices.length > 0) {
        _doSpeak();
      } else {
        // Wait for voices to load (with a timeout fallback)
        synth.onvoiceschanged = () => {
          synth.onvoiceschanged = null;
          _doSpeak();
        };
        setTimeout(() => {
          if (!_webUtterance) { synth.onvoiceschanged = null; _doSpeak(); }
        }, 800);
      }
    }, 150);
  });
}

/** @returns {SpeechSynthesis|null} */
function _getSynth() {
  return window.speechSynthesis
    || (typeof speechSynthesis !== 'undefined' ? speechSynthesis : null)
    || null;
}
