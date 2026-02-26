/**
 * Pattern Matcher — recognition and sentence assembly from template-matched cells.
 */

const MIN_TEMPLATE_CONFIDENCE = 0.40;
const MIN_CELL_CONFIDENCE     = 0.42;
const MIN_RECOGNIZED_RATIO    = 0.34;

/**
 * Recognise Braille cells from a matched-cells array.
 * @param {Array<{char, confidence, rowIndex, colIndex, isSpace}>} cells
 * @returns {{ text: string, confidence: number, cellCount: number }}
 */
export function recognizeBrailleCells(cells) {
  if (!cells || cells.length === 0) return { text: '', confidence: 0, cellCount: 0 };

  const realCells = cells.filter(c => !c.isSpace);
  const recognised = realCells.filter(c => c.confidence >= MIN_CELL_CONFIDENCE && c.char !== '?');

  if (recognised.length / realCells.length < MIN_RECOGNIZED_RATIO) {
    return { text: '', confidence: 0, cellCount: realCells.length };
  }

  const text = cells.map(c => c.char).join('').trim();
  const confidence = realCells.reduce((s, c) => s + c.confidence, 0) / (realCells.length || 1);

  return { text, confidence, cellCount: realCells.length };
}

/**
 * Process a detection result into a { text, confidence, braille } object.
 * @param {Array<{char, confidence, rowIndex, colIndex, isSpace}>} matchedCells
 * @param {number} minConfidence  Minimum acceptable confidence (default 0.45)
 * @returns {{ text: string, confidence: number, braille: string } | null}
 */
export function processDetectionResult(matchedCells, minConfidence = 0.45) {
  if (!matchedCells || matchedCells.length === 0) return null;

  const { text, confidence, cellCount } = recognizeBrailleCells(matchedCells);
  if (!text || confidence < minConfidence) return null;

  // Build approximate Braille Unicode string from characters
  const braille = [...text]
    .map(ch => {
      // Lookup Unicode Braille from grade1Mapping reverse
      const code = _charToBrailleCode(ch);
      return code ? String.fromCharCode(code) : '\u2800';
    })
    .join('');

  return { text, confidence, braille, cellCount };
}

/**
 * Find a consistent (stable) result from a rolling buffer of recent results.
 *
 * Groups results by text content; returns the majority result if it appears
 * in at least `requiredMatches` of the buffer entries.
 *
 * @param {Array<{text, confidence, braille}>} recentResults  Rolling buffer (max 6)
 * @param {number} requiredMatches  Minimum occurrences (default 3)
 * @returns {{ text: string, confidence: number, braille: string } | null}
 */
export function findConsistentResult(recentResults, requiredMatches = 3) {
  if (!recentResults || recentResults.length < requiredMatches) return null;

  const groups = new Map(); // text → [result, ...]
  for (const result of recentResults) {
    if (!result || !result.text) continue;
    if (!groups.has(result.text)) groups.set(result.text, []);
    groups.get(result.text).push(result);
  }

  let bestText = null, bestGroup = null;
  for (const [text, group] of groups) {
    if (group.length >= requiredMatches) {
      if (!bestGroup || group.length > bestGroup.length) {
        bestText  = text;
        bestGroup = group;
      }
    }
  }

  if (!bestGroup) return null;

  // Return result with highest confidence from the winning group
  return bestGroup.reduce((best, r) => r.confidence > best.confidence ? r : best);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────
// Minimal grade1Mapping (text char → Braille Unicode codepoint)
const _BRAILLE_CODES = {
  a: 0x2801, b: 0x2803, c: 0x2809, d: 0x2819, e: 0x2811,
  f: 0x280B, g: 0x281B, h: 0x2813, i: 0x280A, j: 0x281A,
  k: 0x2805, l: 0x2807, m: 0x280D, n: 0x281D, o: 0x2815,
  p: 0x280F, q: 0x281F, r: 0x2817, s: 0x280E, t: 0x281E,
  u: 0x2825, v: 0x2827, w: 0x283A, x: 0x282D, y: 0x283D, z: 0x2835,
  ' ': 0x2800, ',': 0x2802, '.': 0x2832, '!': 0x2816, '?': 0x2826,
};

function _charToBrailleCode(ch) {
  return _BRAILLE_CODES[ch.toLowerCase()] || null;
}
