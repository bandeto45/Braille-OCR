/**
 * Braille Mappings — Grade 1 (Uncontracted) Braille
 * 26 template characters: a-z (letters only)
 *
 * Unicode Braille Patterns: U+2800–U+28FF
 * Standard Braille dot numbering (2×3 grid):
 *   Col1 (left)  Col2 (right)
 *       1            4        <- row 1 (top)
 *       2            5        <- row 2 (mid)
 *       3            6        <- row 3 (bot)
 *
 * bit 0 = dot 1 · bit 1 = dot 2 · bit 2 = dot 3
 * bit 3 = dot 4 · bit 4 = dot 5 · bit 5 = dot 6
 *
 * BRAILLE_PATTERN_MAP — 6-char binary string → character (used by dot-detection OCR)
 * String format: "dot1 dot2 dot3 dot4 dot5 dot6"  (positions 0–5 = dots 1–6)
 * Example: "100000" = dot1 only = 'a'
 *          "110000" = dots 1,2   = 'b'
 *          "100100" = dots 1,4   = 'c'
 */

// ─── Grade 1 mapping: Braille Unicode char → plain text char ──────────────────
export const grade1Mapping = {
  '\u2801': 'a', // dots 1
  '\u2803': 'b', // dots 1,2
  '\u2809': 'c', // dots 1,4
  '\u2819': 'd', // dots 1,4,5
  '\u2811': 'e', // dots 1,5
  '\u280B': 'f', // dots 1,2,4
  '\u281B': 'g', // dots 1,2,4,5
  '\u2813': 'h', // dots 1,2,5
  '\u280A': 'i', // dots 2,4
  '\u281A': 'j', // dots 2,4,5
  '\u2805': 'k', // dots 1,3
  '\u2807': 'l', // dots 1,2,3
  '\u280D': 'm', // dots 1,3,4
  '\u281D': 'n', // dots 1,3,4,5
  '\u2815': 'o', // dots 1,3,5
  '\u280F': 'p', // dots 1,2,3,4
  '\u281F': 'q', // dots 1,2,3,4,5
  '\u2817': 'r', // dots 1,2,3,5
  '\u280E': 's', // dots 2,3,4
  '\u281E': 't', // dots 2,3,4,5
  '\u2825': 'u', // dots 1,3,6
  '\u2827': 'v', // dots 1,2,3,6
  '\u283A': 'w', // dots 2,4,5,6
  '\u282D': 'x', // dots 1,3,4,6
  '\u283D': 'y', // dots 1,3,4,5,6
  '\u2835': 'z', // dots 1,3,5,6
  // Number sign (prefix for digits)
  '\u283C': '#', // dots 3,4,5,6
  // Punctuation
  '\u2800': ' ', // space
  '\u2802': ',', // dots 2
  '\u2832': '.', // dots 2,5,6
  '\u2816': '!', // dots 2,3,5
  '\u2826': '?', // dots 2,3,5,6
};

// ─── Reverse mapping: plain text char → Braille Unicode char ─────────────────
export const textToBraille = Object.fromEntries(
  Object.entries(grade1Mapping).map(([k, v]) => [v, k])
);

// ─── 26 Template Characters (letters a–z only) ───────────────────────────────
export const TEMPLATE_CHARS = [
  'a','b','c','d','e','f','g','h','i','j',
  'k','l','m','n','o','p','q','r','s','t',
  'u','v','w','x','y','z',
];

// ─── Explicit dot patterns for each template character ───────────────────────
// 6-bit mask: bit 0 = dot 1 (left-top), bit 1 = dot 2 (left-mid),
//             bit 2 = dot 3 (left-bot), bit 3 = dot 4 (right-top),
//             bit 4 = dot 5 (right-mid), bit 5 = dot 6 (right-bot)
export const CHAR_DOT_PATTERNS = {
  a: 0b000001, b: 0b000011, c: 0b001001, d: 0b011001, e: 0b010001,
  f: 0b001011, g: 0b011011, h: 0b010011, i: 0b001010, j: 0b011010,
  k: 0b000101, l: 0b000111, m: 0b001101, n: 0b011101, o: 0b010101,
  p: 0b001111, q: 0b011111, r: 0b010111, s: 0b001110, t: 0b011110,
  u: 0b100101, v: 0b100111, w: 0b111010, x: 0b101101, y: 0b111101,
  z: 0b110101,
};

/**
 * 6-bit binary string → lowercase character.
 * String positions 0–5 correspond to dots 1–6:
 *   pos 0 = dot 1 (left-top)   pos 3 = dot 4 (right-top)
 *   pos 1 = dot 2 (left-mid)   pos 4 = dot 5 (right-mid)
 *   pos 2 = dot 3 (left-bot)   pos 5 = dot 6 (right-bot)
 *
 * Used by the OpenCV dot-detection path to map a detected cell's
 * 6-bit pattern string directly to a character, without NCC template matching.
 *
 * Examples (matching user-specified format "100000"→"A" etc, stored lowercase):
 *   "100000" → 'a'   "110000" → 'b'   "100100" → 'c'
 *   "100110" → 'd'   "100010" → 'e'   "110100" → 'f'
 */
export const BRAILLE_PATTERN_MAP = {
  // ── Letters a–z ──────────────────────────────────────────────────────────
  '100000': 'a',  // dot 1
  '110000': 'b',  // dots 1,2
  '100100': 'c',  // dots 1,4
  '100110': 'd',  // dots 1,4,5
  '100010': 'e',  // dots 1,5
  '110100': 'f',  // dots 1,2,4
  '110110': 'g',  // dots 1,2,4,5
  '110010': 'h',  // dots 1,2,5
  '010100': 'i',  // dots 2,4
  '010110': 'j',  // dots 2,4,5
  '101000': 'k',  // dots 1,3
  '111000': 'l',  // dots 1,2,3
  '101100': 'm',  // dots 1,3,4
  '101110': 'n',  // dots 1,3,4,5
  '101010': 'o',  // dots 1,3,5
  '111100': 'p',  // dots 1,2,3,4
  '111110': 'q',  // dots 1,2,3,4,5
  '111010': 'r',  // dots 1,2,3,5
  '011100': 's',  // dots 2,3,4
  '011110': 't',  // dots 2,3,4,5
  '101001': 'u',  // dots 1,3,6
  '111001': 'v',  // dots 1,2,3,6
  '010111': 'w',  // dots 2,4,5,6
  '101101': 'x',  // dots 1,3,4,6
  '101111': 'y',  // dots 1,3,4,5,6
  '101011': 'z',  // dots 1,3,5,6
  // ── Punctuation & special ─────────────────────────────────────────────────
  '000000': ' ',  // space (no dots)
  '010000': ',',  // dot 2
  '010011': '.',  // dots 2,5,6   (Grade 1 period)
  '010001': '!',  // dots 2,3,5   (Grade 1 exclamation)
  '001011': '?',  // dots 2,3,5,6 (Grade 1 question)
};

/**
 * Reverse lookup: 6-bit dot pattern → character.
 * Letters (a–z) take priority over digits, which share the same dot patterns
 * as a–j in Grade 1 Braille.  We build the Map manually so duplicate patterns
 * keep the FIRST (letter) entry rather than being overwritten by the digit.
 */
export const DOT_PATTERN_TO_CHAR = (() => {
  const m = new Map();
  const order = [
    'a','b','c','d','e','f','g','h','i','j',
    'k','l','m','n','o','p','q','r','s','t',
    'u','v','w','x','y','z',
  ];
  for (const ch of order) {
    const pat = CHAR_DOT_PATTERNS[ch];
    if (!m.has(pat)) m.set(pat, ch); // first entry wins → letters beat digits
  }
  return m;
})();

/**
 * Convert a Braille Unicode string to plain text.
 * @param {string} str  Braille Unicode string
 * @returns {string}
 */
export function brailleToText(str) {
  return [...str].map(ch => grade1Mapping[ch] ?? '?').join('');
}

/**
 * Convert plain text to a Braille Unicode string.
 * @param {string} text
 * @returns {string}
 */
export function textToBrailleString(text) {
  return [...text.toLowerCase()]
    .map(ch => textToBraille[ch] ?? '\u2800')
    .join('');
}

/**
 * Returns true if the string consists entirely of Braille Unicode characters.
 * @param {string} str
 * @returns {boolean}
 */
export function isValidBraille(str) {
  return /^[\u2800-\u28FF]+$/.test(str);
}

/**
 * Create a Braille Unicode character from an array of dot numbers (1–6).
 * @param {number[]} dotNumbers  e.g. [1,2] → 'b'
 * @returns {string}
 */
export function createBrailleFromDots(dotNumbers) {
  let code = 0;
  for (const dot of dotNumbers) {
    if (dot >= 1 && dot <= 6) code |= (1 << (dot - 1));
  }
  return String.fromCharCode(0x2800 + code);
}

/**
 * Return the PNG filename for a given template character.
 * @param {string} ch  One of TEMPLATE_CHARS (e.g. 'a', 'Z', '3')
 * @returns {string}   e.g. 'a.png', 'z.png', '3.png'
 */
export function charToTemplateName(ch) {
  return `${ch.toLowerCase()}.png`;
}
