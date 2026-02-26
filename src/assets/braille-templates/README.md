# Braille Template Reference Photos

This directory must contain **36 PNG reference photographs** used by the
NCC (Normalised Cross-Correlation) template matcher.

## Required files

| Filename | Character | Filename | Character |
|----------|-----------|----------|-----------|
| `a.png`  | a         | `n.png`  | n         |
| `b.png`  | b         | `o.png`  | o         |
| `c.png`  | c         | `p.png`  | p         |
| `d.png`  | d         | `q.png`  | q         |
| `e.png`  | e         | `r.png`  | r         |
| `f.png`  | f         | `s.png`  | s         |
| `g.png`  | g         | `t.png`  | t         |
| `h.png`  | h         | `u.png`  | u         |
| `i.png`  | i         | `v.png`  | v         |
| `j.png`  | j         | `w.png`  | w         |
| `k.png`  | k         | `x.png`  | x         |
| `l.png`  | l         | `y.png`  | y         |
| `m.png`  | m         | `z.png`  | z         |
| `0.png`  | 0         | `5.png`  | 5         |
| `1.png`  | 1         | `6.png`  | 6         |
| `2.png`  | 2         | `7.png`  | 7         |
| `3.png`  | 3         | `8.png`  | 8         |
| `4.png`  | 4         | `9.png`  | 9         |

## Specifications

- **Format**: PNG (lossless)
- **Dimensions**: **64 × 96 pixels** (width × height)
- **Colour space**: Grayscale or RGB — the loader converts to grayscale automatically
- **Content**: A single Braille cell centred in the frame, photographed under
  consistent lighting with the same camera distance and angle used during scanning
- **Background**: White / off-white page surface — avoid shadows on the dot area
- **Dot fill**: Black raised dots — well-lit, minimal shadow bleed

## How to capture templates

1. Print or obtain a high-quality Grade-1 Braille page covering all 36 characters.
2. Mount the camera **parallel** to the page surface, 15–20 cm above.
3. Use diffuse overhead lighting to minimise dot shadows.
4. Photograph the full page, then crop each character cell to exactly 64 × 96 px.
   - Each cell should have a 4–6 px border of plain background around the dot grid.
4. Save as `<char>.png` (lowercase filename, e.g., `a.png`, `9.png`).
5. Run `node scripts/verify-templates.js` to confirm all 36 files are present and
   the correct size.

## Loader code reference

The templates are loaded in `src/js/processing/template-loader.js` via:

```js
const modules = import.meta.glob('../../assets/braille-templates/*.png', {
  eager: false,
  query: '?url',
  import: 'default',
});
```

Vite resolves these to hashed asset URLs at build time. No runtime file I/O is
needed — the loader uses Canvas to render each PNG to a grayscale `ImageData`
buffer for NCC comparison.
