#!/usr/bin/env python3
"""
validate-full-pipeline.py
Emulates the EXACT JS pipeline steps in Python to find where it breaks.
Steps mirrored from:
  image-enhance.js  → preprocessForBraille (embossed mode, fixed percentile)
  simple-braille-detector.js → detectBrailleDots, segmentCellRegions,
                                matchCellsByDotPattern, assembleSentence
"""

import sys, os, math, itertools
from pathlib import Path

try:
    from PIL import Image
    import numpy as np
except ImportError:
    print("ERROR: pip install Pillow numpy")
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────
SAMPLE_PATH   = Path(__file__).parent.parent / "src/assets/sample.jpeg"
TEMPLATE_DIR  = Path(__file__).parent.parent / "src/assets/braille-templates"
MAX_DIM       = 1280
TEMPLATE_W    = 64
TEMPLATE_H    = 96
MIN_TEMPLATE_CONFIDENCE = 0.40
WORD_GAP_RATIO = 1.8

# ── Braille dot patterns (from braille-mappings.js) ──────────────────────────
CHAR_DOT_PATTERNS = {
    'a':0b000001,'b':0b000011,'c':0b001001,'d':0b011001,'e':0b010001,
    'f':0b001011,'g':0b011011,'h':0b010011,'i':0b001010,'j':0b011010,
    'k':0b000101,'l':0b000111,'m':0b001101,'n':0b011101,'o':0b010101,
    'p':0b001111,'q':0b011111,'r':0b010111,'s':0b001110,'t':0b011110,
    'u':0b100101,'v':0b100111,'w':0b111010,'x':0b101101,'y':0b111101,
    'z':0b110101,
}
DOT_PATTERN_TO_CHAR = {}
for ch, pat in CHAR_DOT_PATTERNS.items():
    if pat not in DOT_PATTERN_TO_CHAR:
        DOT_PATTERN_TO_CHAR[pat] = ch

# ── Step 0: Load & resize image ───────────────────────────────────────────────
print("=" * 60)
print("STEP 0 — Load image")
img = Image.open(SAMPLE_PATH).convert("RGB")
w0, h0 = img.size
scale = min(1.0, MAX_DIM / max(w0, h0))
nw, nh = int(w0 * scale), int(h0 * scale)
img = img.resize((nw, nh), Image.LANCZOS)
print(f"  Original: {w0}×{h0},  Resized: {nw}×{nh}")
arr = np.array(img, dtype=np.float32)

# ── Step 1: Centre ROI crop (0.95 × 0.85) ─────────────────────────────────────
print("\nSTEP 1 — Centre ROI crop (0.95 × 0.85)")
roi_fw, roi_fh = 0.95, 0.85
roi_w, roi_h = int(nw * roi_fw), int(nh * roi_fh)
x0 = (nw - roi_w) // 2
y0 = (nh - roi_h) // 2
roi = arr[y0:y0+roi_h, x0:x0+roi_w]    # (H, W, 3)
print(f"  ROI: {roi_w}×{roi_h}, top-left={x0},{y0}")
W, H = roi_w, roi_h
N = W * H

# ── Step 2: assessImageQuality ────────────────────────────────────────────────
print("\nSTEP 2 — assessImageQuality")
gray_raw = 0.299*roi[:,:,0] + 0.587*roi[:,:,1] + 0.114*roi[:,:,2]
mean_v = float(np.mean(gray_raw))
std_v  = float(np.std(gray_raw))
embossed = mean_v > 150
quality_ok = embossed  # score = 0.7 → isAcceptable
print(f"  mean={mean_v:.1f}  std={std_v:.1f}  embossed={embossed}  acceptable={quality_ok}")

# ── Step 3: preprocessForBraille (JS embossed mode, fixed percentile) ────────
print("\nSTEP 3 — preprocessForBraille (embossed)")
gray = gray_raw.flatten()

# Box blur radius
blur_r = max(12, round(min(W, H) / 18))
print(f"  Box blur radius: {blur_r}")

def box_blur(arr2d, r):
    """Two-pass box blur using integral image."""
    h_, w_ = arr2d.shape
    integral = np.zeros((h_ + 1, w_ + 1), dtype=np.float64)
    for y in range(1, h_ + 1):
        for x in range(1, w_ + 1):
            integral[y, x] = (arr2d[y-1, x-1]
                              + integral[y-1, x]
                              + integral[y, x-1]
                              - integral[y-1, x-1])
    out = np.zeros_like(arr2d)
    for y in range(h_):
        for x in range(w_):
            x1 = max(0, x - r); y1 = max(0, y - r)
            x2 = min(w_ - 1, x + r); y2 = min(h_ - 1, y + r)
            cnt = (x2 - x1 + 1) * (y2 - y1 + 1)
            s = (integral[y2+1, x2+1] - integral[y1, x2+1]
                 - integral[y2+1, x1] + integral[y1, x1])
            out[y, x] = s / cnt
    return out

# Use numpy for speed (equivalent result)
from scipy.ndimage import uniform_filter
bg_2d = uniform_filter(gray_raw, size=blur_r*2+1)
diff_2d = np.maximum(0, bg_2d - gray_raw)
diff_flat = diff_2d.flatten()

sorted_diff = np.sort(diff_flat)
lo = 0.0
hi_idx = min(N - 1, int(N * 0.995))
hi = float(max(1.0, sorted_diff[hi_idx]))
print(f"  diff stats: min={diff_flat.min():.2f}, max={diff_flat.max():.2f}, "
      f"  p99.5={hi:.2f} (used as hi)")

# Normalize: norm = 255 - clamp((diff - lo) / hi * 255)
#  → large diff (dots) → small norm (dark)  ✓
processed = 255 - np.clip((diff_2d - lo) / hi * 255, 0, 255)
print(f"  Processed: min={processed.min():.1f} max={processed.max():.1f} mean={processed.mean():.1f}")

# Quick sanity: what are the pixel values at Python-detected dot locations?
# Known dot Y positions in original image ≈ 250-340, shifted by y0={y0}
dot_ys_orig = [251, 253, 253, 255, 257, 258, 259, 261, 262, 263,
               288, 291, 293, 294, 295, 296, 297, 297, 297, 299, 301,
               331, 333, 333, 334, 335, 336, 337, 337]
dot_xs_orig = [59, 162, 262, 363, 463, 701, 762, 861, 960, 1058,
               58, 199, 261, 363, 504, 663, 700, 800, 860, 900, 960,
               261, 308, 363, 465, 702, 762, 862, 962]
print(f"\n  Pixel values at known dot positions (should be DARK, <128):")
dark_count = 0
total_sample = 0
for ox, oy in list(zip(dot_xs_orig, dot_ys_orig))[:12]:
    px = int(ox * scale) - x0
    py = int(oy * scale) - y0
    if 0 <= px < W and 0 <= py < H:
        v = processed[py, px]
        is_dark = v < 128
        if is_dark: dark_count += 1
        total_sample += 1
        print(f"    ({px},{py}) → {v:.0f}  {'✓ dark' if is_dark else '✗ LIGHT'}")
print(f"  Dark hits: {dark_count}/{total_sample}")

# ── Step 4: Adaptive threshold → binary dots ──────────────────────────────────
print("\nSTEP 4 — Adaptive threshold (C=5)")
block = max(11, (round(min(W, H) / 20) | 1))
C = 5
print(f"  Block size: {block}")

# Adaptive threshold using integral image
from scipy.ndimage import uniform_filter as uf
local_mean = uf(processed, size=block)
binary = (processed < (local_mean - C)).astype(np.uint8)
dot_pixels = binary.sum()
print(f"  Dark pixels: {dot_pixels} ({100*dot_pixels/N:.2f}%)")

# ── Step 5: Blob detection ────────────────────────────────────────────────────
print("\nSTEP 5 — Blob detection (radius filter)")
img_area = W * H
min_blob = max(4, img_area * 0.00005)
max_blob = max(800, img_area * 0.04)
min_r = max(1.5, math.sqrt(img_area) * 0.004)
max_r = max(20, math.sqrt(img_area) * 0.18)
print(f"  Blob size: {min_blob:.0f}-{max_blob:.0f}  radius: {min_r:.1f}-{max_r:.1f}")

# Label connected components
from scipy import ndimage
labeled, n_comps = ndimage.label(binary)
print(f"  Connected components: {n_comps}")

dots = []
for comp_id in range(1, n_comps + 1):
    mask = (labeled == comp_id)
    size = mask.sum()
    if min_blob <= size <= max_blob:
        ys, xs = np.where(mask)
        r = math.sqrt(size / math.pi)
        aspect = (ys.max()-ys.min()+1) / max(1, xs.max()-xs.min()+1) if len(xs)>1 else 1
        if r >= min_r and r <= max_r and 0.4 <= aspect <= 2.5:
            cx = xs.mean(); cy = ys.mean()
            conf = min(1.0, (1 - abs(aspect - 1)) * (r / 8))
            dots.append({'x': cx, 'y': cy, 'r': r, 'conf': conf})

print(f"  Raw dots after shape filter: {len(dots)}")

# Radius noise filter
if len(dots) > 2:
    radii = sorted(d['r'] for d in dots)
    med_r = radii[len(radii) // 2]
    strict = len(dots) > 20
    min_rk = med_r * (0.62 if strict else 0.45)
    max_rk = med_r * (1.8 if strict else 2.5)
    kept = [d for d in dots if d['r'] >= min_rk and d['r'] <= max_rk and
            (not strict or d['conf'] >= 0.45)]
    if len(kept) >= 2:
        dots = kept
    print(f"  After radius filter (medR={med_r:.1f}, strict={strict}): {len(dots)} dots")

# Y-band filter
if len(dots) > 20:
    bin_sz = max(12, round(H / 40))
    n_bins = math.ceil(H / bin_sz)
    bins = [0] * n_bins
    for d in dots:
        b = max(0, min(n_bins-1, int(d['y'] / bin_sz)))
        bins[b] += 1
    peak = max(bins)
    min_active = max(3, int(peak * 0.35))
    active = [i for i, cnt in enumerate(bins) if cnt >= min_active]
    if active:
        # merge into bands
        bands = []
        start = prev = active[0]
        for b in active[1:]:
            if b <= prev + 1: prev = b
            else:
                bands.append((start, prev)); start = b; prev = b
        bands.append((start, prev))
        y_margin = max(10, round(math.sqrt(img_area) * 0.01))
        kept = [d for d in dots if any(
            d['y'] >= b0*bin_sz - y_margin and d['y'] <= (b1+1)*bin_sz + y_margin
            for b0, b1 in bands
        )]
        if len(kept) >= 3:
            dots = kept
        print(f"  After Y-band filter: {len(dots)} dots")

print(f"  FINAL dot count: {len(dots)}")

if not dots:
    print("\n  ❌ NO DOTS FOUND — pipeline fails here")
    sys.exit(1)

# ── Step 6: _estimateCellSize ─────────────────────────────────────────────────
print("\nSTEP 6 — Estimate cell size")
def estimate_cell_size(dots):
    if len(dots) < 2: return 40, 60
    med_r = sorted(d['r'] for d in dots)[len(dots)//2]
    xs = sorted(set(round(d['x']) for d in dots))
    ys = sorted(set(round(d['y']) for d in dots))
    def med_diff(vals):
        diffs = [vals[i+1]-vals[i] for i in range(len(vals)-1) if vals[i+1]-vals[i] > med_r*0.8]
        return sorted(diffs)[len(diffs)//2] if diffs else med_r*3
    dx = med_diff(xs); dy = med_diff(ys)
    cw = max(med_r*3, min(dx*2.2, W*0.35))
    ch = max(med_r*3.5, min(dy*2.6, H*0.7))
    return cw, ch

cell_w, cell_h = estimate_cell_size(dots)
print(f"  estCellW={cell_w:.1f}  estCellH={cell_h:.1f}")

# ── Step 7: segmentCellRegions ────────────────────────────────────────────────
print("\nSTEP 7 — Segment cell regions")
dots_sorted_y = sorted(dots, key=lambda d: d['y'])
rows = []
for dot in dots_sorted_y:
    placed = False
    for row in rows:
        if abs(dot['y'] - row['meanY']) < cell_h * 1.1:
            row['dots'].append(dot)
            row['meanY'] = sum(d['y'] for d in row['dots']) / len(row['dots'])
            placed = True; break
    if not placed:
        rows.append({'meanY': dot['y'], 'dots': [dot]})

rows.sort(key=lambda r: r['meanY'])
print(f"  Braille rows: {len(rows)} (dots per row: {[len(r['dots']) for r in rows]})")

cell_regions = []
for row_idx, row in enumerate(rows):
    sorted_dots = sorted(row['dots'], key=lambda d: d['x'])
    clusters = []
    for dot in sorted_dots:
        placed = False
        for cl in clusters:
            if abs(dot['x'] - cl['meanX']) < cell_w * 0.7:
                cl['dots'].append(dot)
                cl['meanX'] = sum(d['x'] for d in cl['dots']) / len(cl['dots'])
                placed = True; break
        if not placed:
            clusters.append({'meanX': dot['x'], 'dots': [dot]})
    clusters.sort(key=lambda c: c['meanX'])

    prev_x = None
    for cl_idx, cl in enumerate(clusters):
        if prev_x is not None and cl['meanX'] - prev_x > WORD_GAP_RATIO * cell_w:
            cell_regions.append({'isSpace': True, 'rowIndex': row_idx, 'colIndex': cl_idx})
        real_col = sum(1 for c in cell_regions if c['rowIndex'] == row_idx and not c.get('isSpace'))
        xs_ = [d['x'] for d in cl['dots']]; ys_ = [d['y'] for d in cl['dots']]
        cell_regions.append({
            'isSpace': False,
            'rowIndex': row_idx,
            'colIndex': real_col,
            'x': min(xs_) - cell_w * 0.25,
            'y': min(ys_) - cell_h * 0.2,
            'w': cell_w, 'h': cell_h,
            'dots': cl['dots'],
        })
        prev_x = cl['meanX']

real_cells = [c for c in cell_regions if not c.get('isSpace')]
print(f"  Cell regions: {len(real_cells)} real + {len(cell_regions)-len(real_cells)} spaces")

# ── Step 8: matchCellsByDotPattern ────────────────────────────────────────────
print("\nSTEP 8 — Dot-pattern matching")
dot_results = []
for cell in cell_regions:
    if cell.get('isSpace'):
        dot_results.append({'char': ' ', 'conf': 1.0, **cell}); continue
    dots_c = cell['dots']
    if not dots_c:
        dot_results.append({'char': '?', 'conf': 0, **cell}); continue
    radii = sorted(d['r'] for d in dots_c)
    med_r = radii[len(radii)//2] if radii else 1
    dedup_dist = cell['h'] * 0.20
    min_dot_r = med_r * 0.5
    deduped = []
    for d in sorted(dots_c, key=lambda x: -x['r']):
        if d['r'] < min_dot_r: continue
        if not any(math.hypot(d['x']-k['x'], d['y']-k['y']) < dedup_dist for k in deduped):
            deduped.append(d)

    sx = sorted(deduped, key=lambda d: d['x'])
    best_gap = 0; gap_idx = -1
    for i in range(1, len(sx)):
        g = sx[i]['x'] - sx[i-1]['x']
        if g > best_gap: best_gap = g; gap_idx = i
    min_col_gap = med_r * 2.4
    if best_gap > min_col_gap and gap_idx > 0:
        left_d = sx[:gap_idx]; right_d = sx[gap_idx:]
    else:
        left_d = sx; right_d = []

    Y_THRESH = cell['h'] * 0.30
    def y_cluster_bits(col_dots, offset):
        bits = 0
        if not col_dots: return bits
        ys_sorted = sorted(col_dots, key=lambda d: d['y'])
        groups = []
        for d in ys_sorted:
            placed = False
            for g in groups:
                if abs(d['y'] - g['meanY']) < Y_THRESH:
                    g['pts'].append(d)
                    g['meanY'] = sum(p['y'] for p in g['pts']) / len(g['pts'])
                    placed = True; break
            if not placed: groups.append({'meanY': d['y'], 'pts': [d]})
        groups.sort(key=lambda g: g['meanY'])
        for ri, _ in enumerate(groups[:3]):
            bits |= (1 << (offset + ri))
        return bits

    pattern = y_cluster_bits(left_d, 0) | y_cluster_bits(right_d, 3)
    best_char = DOT_PATTERN_TO_CHAR.get(pattern, '?')
    n_dots = len(deduped)
    cc = 0.35 if n_dots<=1 else 0.52 if n_dots==2 else 0.68 if n_dots==3 else 0.78
    cq = 1 if right_d or n_dots<=3 else 0.65
    conf = min(0.9, cc * cq) if best_char != '?' else 0.08
    dot_results.append({'char': best_char, 'conf': conf,
                        'rowIndex': cell['rowIndex'], 'colIndex': cell.get('colIndex', 0),
                        'isSpace': False})
    print(f"  Cell r{cell['rowIndex']}c{cell.get('colIndex',0)}: "
          f"{len(deduped)} dots, L={len(left_d)} R={len(right_d)}, "
          f"gap={best_gap:.1f}, pattern={format(pattern,'06b')} → '{best_char}' ({conf:.2f})")

dot_text = ''.join(c['char'] for c in dot_results)
dot_conf = sum(c['conf'] for c in dot_results if not c.get('isSpace')) / max(1, len(real_cells))
print(f"\n  Dot-pattern result: '{dot_text}' (avg conf={dot_conf:.2f})")

# ── Step 9: NCC template matching ─────────────────────────────────────────────
print("\nSTEP 9 — NCC template matching")
TEMPLATE_CHARS = list('abcdefghijklmnopqrstuvwxyz')
templates = {}
template_photos_loaded = 0
for ch in TEMPLATE_CHARS:
    tp = TEMPLATE_DIR / f"{ch}.png"
    if tp.exists():
        t = Image.open(tp).convert("RGB").resize((TEMPLATE_W, TEMPLATE_H), Image.LANCZOS)
        # Grayscale: luma
        ta = np.array(t, dtype=np.float32)
        tg = (0.299*ta[:,:,0] + 0.587*ta[:,:,1] + 0.114*ta[:,:,2]).flatten()
        templates[ch] = tg
        template_photos_loaded += 1

print(f"  Loaded {template_photos_loaded}/{len(TEMPLATE_CHARS)} real template photos")

def compute_ncc(a, b):
    ma = a.mean(); mb = b.mean()
    da = a - ma; db = b - mb
    sa = math.sqrt((da**2).sum()); sb = math.sqrt((db**2).sum())
    if sa < 1e-6 or sb < 1e-6: return 0.0
    return float((da * db).sum() / (sa * sb))

ncc_results = []
for cell_idx, cell in enumerate(cell_regions):
    if cell.get('isSpace'):
        ncc_results.append({'char': ' ', 'conf': 1.0,
                            'rowIndex': cell['rowIndex'], 'colIndex': cell.get('colIndex',0),
                            'isSpace': True}); continue

    # Extract cell region from processed image
    cx = int(max(0, cell['x']))
    cy = int(max(0, cell['y']))
    cw = int(cell['w']); ch_ = int(cell['h'])
    cx2 = min(W, cx + cw); cy2 = min(H, cy + ch_)
    cell_crop = processed[cy:cy2, cx:cx2]

    if cell_crop.size == 0 or cell_crop.shape[0] < 2 or cell_crop.shape[1] < 2:
        dr = dot_results[cell_idx]
        ncc_results.append(dr); continue

    # Resize to template size
    cell_img = Image.fromarray(cell_crop.astype(np.uint8)).resize(
        (TEMPLATE_W, TEMPLATE_H), Image.BILINEAR
    )
    cell_gray = np.array(cell_img, dtype=np.float32).flatten()

    best_char = '?'; best_ncc = -math.inf; second_ncc = -math.inf
    for ch_t, tmpl in templates.items():
        ncc = compute_ncc(cell_gray, tmpl)
        if ncc > best_ncc:
            second_ncc = best_ncc; best_ncc = ncc; best_char = ch_t
        elif ncc > second_ncc:
            second_ncc = ncc

    ncc_conf = (best_ncc + 1) / 2
    margin = best_ncc - second_ncc
    dr = dot_results[cell_idx]

    # Apply same decision logic as JS matchCellsToTemplates
    raw_dot_count = len(cell.get('dots', []))
    if raw_dot_count <= 1 and ncc_conf < 0.70:
        result_char = '?'; result_conf = ncc_conf * 0.5
    elif raw_dot_count == 2 and ncc_conf < 0.60 and dr['conf'] < 0.60:
        result_char = '?'; result_conf = ncc_conf * 0.7
    elif best_char == dr['char'] and dr['char'] != '?':
        result_char = best_char; result_conf = min(1, max(ncc_conf, dr['conf']) + 0.1)
    elif ncc_conf >= 0.62 and margin >= 0.05:
        result_char = best_char; result_conf = ncc_conf
    elif dr['char'] != '?' and dr['conf'] >= 0.55:
        result_char = dr['char']; result_conf = min(dr['conf'], 0.7)
    else:
        result_char = best_char if ncc_conf >= MIN_TEMPLATE_CONFIDENCE else '?'
        result_conf = ncc_conf

    col = cell.get('colIndex', 0)
    print(f"  r{cell['rowIndex']}c{col}: NCC winner='{best_char}'({ncc_conf:.2f}), "
          f"margin={margin:.3f}, dot='{dr['char']}'({dr['conf']:.2f}) → '{result_char}'({result_conf:.2f})")
    ncc_results.append({'char': result_char, 'conf': result_conf,
                        'rowIndex': cell['rowIndex'], 'colIndex': col, 'isSpace': False})

# ── Step 10: assembleSentence ─────────────────────────────────────────────────
print("\nSTEP 10 — assembleSentence")
sorted_cells = sorted(ncc_results, key=lambda c: (c['rowIndex'], c['colIndex']))
text = ''
prev_row = sorted_cells[0]['rowIndex'] if sorted_cells else 0
total_conf = 0; char_count = 0
for cell in sorted_cells:
    if cell['rowIndex'] != prev_row:
        text += ' '; prev_row = cell['rowIndex']
    text += cell['char']
    if not cell.get('isSpace'):
        total_conf += cell['conf']; char_count += 1

text = text.strip()
if text: text = text[0].upper() + text[1:]
avg_conf = total_conf / max(1, char_count)

print(f"\n  ═══════════════════════════════════")
print(f"  RESULT:   '{text}'")
print(f"  EXPECTED: 'Hello world'")
print(f"  MATCH:    {'✓ CORRECT' if text.lower() == 'hello world' else '✗ WRONG'}")
print(f"  Confidence: {avg_conf:.3f}")
print(f"  ═══════════════════════════════════")

# ── Summary: gibberish check ──────────────────────────────────────────────────
print("\nSTEP 11 — isLikelyGibberishText check")
real_res = [c for c in ncc_results if not c.get('isSpace')]
unrecog = sum(1 for c in real_res if c['char'] == '?')
avg_c = sum(c['conf'] for c in real_res) / max(1, len(real_res))
words = text.strip().split()
short_r = sum(1 for w in words if len(w) <= 2) / max(1, len(words))
space_c = text.count(' ')
char_c  = len(text.replace(' ', ''))
gibberish = (
    len(text) < 2 or
    unrecog / max(1, len(real_res)) > 0.5 or
    avg_c < 0.25 or
    (len(words) >= 5 and avg_c < 2.4 and short_r > 0.55) or
    (char_c > 0 and space_c / char_c > 0.35)
)
print(f"  unrecog={unrecog}/{len(real_res)}, avgConf={avg_c:.2f}, "
      f"words={len(words)}, shortWordRatio={short_r:.2f}")
print(f"  isGibberish → {gibberish}")
print(f"\n{'✅ PIPELINE PASSES' if not gibberish and text.lower()=='hello world' else '❌ PIPELINE FAILS'}")
