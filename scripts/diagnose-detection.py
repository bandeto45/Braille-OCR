"""
Diagnose and fix embossed Braille dot detection for sample.jpeg.
Tests different combinations of preprocessing + thresholding.
"""
import math, os
from PIL import Image, ImageDraw, ImageFilter, ImageOps

SRC = '/Volumes/BackUP/Braille-OCR/src/assets/sample.jpeg'
OUT = '/Volumes/BackUP/Braille-OCR/scripts/debug'
os.makedirs(OUT, exist_ok=True)

img_orig = Image.open(SRC).convert('L')
w_o, h_o = img_orig.size
scale = min(1.0, 1280 / max(w_o, h_o))
w, h = round(w_o * scale), round(h_o * scale)
img = img_orig.resize((w, h), Image.LANCZOS)
print(f"Resized: {w}x{h}")

def img_stats(im):
    px = list(im.getdata())
    mn, mx = min(px), max(px)
    mean = sum(px) / len(px)
    std  = math.sqrt(sum((p - mean)**2 for p in px) / len(px))
    return mn, mx, mean, std

def adaptive_binary(im, block_size, C):
    """Returns list: 0=dark 1=light, same size as image pixels."""
    px = im.load()
    ww, hh = im.size
    # Build integral image
    integral = [[0] * (ww + 1) for _ in range(hh + 1)]
    for y in range(hh):
        row_sum = 0
        for x in range(ww):
            row_sum += px[x, y]
            integral[y+1][x+1] = integral[y][x+1] + row_sum

    half = block_size // 2
    binary = []
    for y in range(hh):
        for x in range(ww):
            x1, y1 = max(0, x-half), max(0, y-half)
            x2, y2 = min(ww-1, x+half), min(hh-1, y+half)
            count = (x2-x1+1)*(y2-y1+1)
            s = integral[y2+1][x2+1] - integral[y1][x2+1] - integral[y2+1][x1] + integral[y1][x1]
            lm = s / count
            binary.append(0 if px[x, y] < (lm - C) else 1)
    return binary

def count_dark(binary):
    return sum(1 for b in binary if b == 0)

def find_blobs(binary, ww, hh, min_sz, max_sz, min_r, max_r):
    visited = [False] * (ww * hh)
    blobs = []
    for y in range(hh):
        for x in range(ww):
            idx = y * ww + x
            if binary[idx] == 0 and not visited[idx]:
                # BFS
                stack = [(x, y)]
                pts = []
                while stack:
                    cx, cy = stack.pop()
                    cidx = cy * ww + cx
                    if cx < 0 or cx >= ww or cy < 0 or cy >= hh: continue
                    if visited[cidx] or binary[cidx] != 0: continue
                    visited[cidx] = True
                    pts.append((cx, cy))
                    for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)]:
                        nx, ny = cx+dx, cy+dy
                        nidx = ny * ww + nx
                        if 0 <= nx < ww and 0 <= ny < hh and not visited[nidx] and binary[nidx] == 0:
                            stack.append((nx, ny))
                sz = len(pts)
                if sz == 0: continue
                if min_sz <= sz <= max_sz:
                    cxm = sum(p[0] for p in pts) / sz
                    cym = sum(p[1] for p in pts) / sz
                    r = math.sqrt(sz / math.pi)
                    bw = max(p[0] for p in pts) - min(p[0] for p in pts)
                    bh_v = max(p[1] for p in pts) - min(p[1] for p in pts)
                    aspect = bh_v / bw if bw > 0 else 1
                    if min_r <= r <= max_r and 0.4 <= aspect <= 2.5:
                        blobs.append({'x': cxm, 'y': cym, 'r': r})
    return blobs

area = w * h
min_sz = max(4, area * 0.00005)
max_sz = max(800, area * 0.04)
min_r  = max(1.5, math.sqrt(area) * 0.004)
max_r  = max(20, math.sqrt(area) * 0.18)
print(f"Blob limits: size {min_sz:.0f}-{max_sz:.0f}, radius {min_r:.1f}-{max_r:.1f}")

# ─────────────────────────────────────────────────────────────────────────────
# Test different preprocessing + C values
# ─────────────────────────────────────────────────────────────────────────────
block = max(11, int(min(w, h) / 20) | 1)
if block % 2 == 0: block += 1
print(f"\nBlock size: {block}")

mn, mx, mean, std = img_stats(img)
print(f"Base image: mean={mean:.1f} std={std:.1f}")

# Preprocessing options to test
def preprocess_v1(im):
    """Current: contrast*2 + brightness -15"""
    px = im.load()
    ww, hh = im.size
    out = Image.new('L', (ww, hh))
    op = out.load()
    for y in range(hh):
        for x in range(ww):
            p = px[x, y]
            p2 = min(255, max(0, 128 + (p - 128) * 2))  # contrast 2.0
            p3 = min(255, max(0, p2 - 15))               # brightness -15
            op[x, y] = p3
    return out

def preprocess_v2(im):
    """Aggressive: CLAHE-like local enhance then sharpen"""
    # Normalize to 0-255 using min-max stretch
    px_list = list(im.getdata())
    lo, hi = min(px_list), max(px_list)
    if hi == lo: return im
    stretch = im.point(lambda p: int((p - lo) * 255 / (hi - lo)))
    # Sharpen to enhance edges
    return stretch.filter(ImageFilter.SHARPEN).filter(ImageFilter.SHARPEN)

def preprocess_v3(im):
    """Equalize histogram for max contrast, then sharpen"""
    eq = ImageOps.equalize(im)
    return eq.filter(ImageFilter.SHARPEN)

def preprocess_v4(im):
    """CLAHE-like: divide image into tiles and equalize each"""
    ww, hh = im.size
    tile_w, tile_h = ww // 8, hh // 8
    out = Image.new('L', (ww, hh))
    for ty in range(8):
        for tx in range(8):
            x1 = tx * tile_w
            y1 = ty * tile_h
            x2 = x1 + tile_w if tx < 7 else ww
            y2 = y1 + tile_h if ty < 7 else hh
            tile = im.crop((x1, y1, x2, y2))
            tile_eq = ImageOps.equalize(tile)
            out.paste(tile_eq, (x1, y1))
    return out.filter(ImageFilter.SHARPEN)

configs = [
    ('v1_C-8_current',   preprocess_v1,  -8),
    ('v1_C5',            preprocess_v1,   5),
    ('v1_C15',           preprocess_v1,  15),
    ('v2_C5',            preprocess_v2,   5),
    ('v2_C10',           preprocess_v2,  10),
    ('v2_C15',           preprocess_v2,  15),
    ('v3_equalHist_C5',  preprocess_v3,   5),
    ('v3_equalHist_C10', preprocess_v3,  10),
    ('v4_CLAHE_C5',      preprocess_v4,   5),
    ('v4_CLAHE_C10',     preprocess_v4,  10),
    ('v4_CLAHE_C15',     preprocess_v4,  15),
]

best_name, best_blobs, best_img = None, [], None
for name, prep_fn, C in configs:
    enhanced = prep_fn(img)
    mn2, mx2, mean2, std2 = img_stats(enhanced)
    binary = adaptive_binary(enhanced, block, C)
    dark = count_dark(binary)
    blobs = find_blobs(binary, w, h, min_sz, max_sz, min_r, max_r)
    pct = dark * 100 / (w * h)
    print(f"  [{name}] mean={mean2:.1f} std={std2:.1f} dark={dark}({pct:.1f}%) blobs={len(blobs)}")
    
    # Save the best result (closest to expected ~10-60 dots for "Hello World")
    if 10 <= len(blobs) <= 100 and len(blobs) > len(best_blobs):
        best_blobs = blobs
        best_name = name
        best_img = enhanced
        best_binary = binary

print(f"\nBest config: {best_name} with {len(best_blobs)} blobs")

if best_blobs:
    # Save overlay
    img_rgb = img.convert('RGB')
    draw = ImageDraw.Draw(img_rgb)
    for d in best_blobs:
        r = d['r']
        draw.ellipse([d['x']-r, d['y']-r, d['x']+r, d['y']+r], outline='red', width=2)
    img_rgb.save(f"{OUT}/05_best_{best_name}.jpg")
    print(f"Saved to {OUT}/05_best_{best_name}.jpg")
    
    # Print blob positions
    blobs_sorted = sorted(best_blobs, key=lambda b: (round(b['y']/20)*20, b['x']))
    print("\nBlob positions (x, y, r):")
    for b in blobs_sorted:
        print(f"  ({b['x']:.0f}, {b['y']:.0f}, r={b['r']:.1f})")
