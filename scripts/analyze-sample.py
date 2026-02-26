"""
Analyze sample.jpeg Braille image and simulate the JS detection pipeline.
Outputs debug images to scripts/debug/ folder.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.join(os.path.dirname(__file__), 'debug')
os.makedirs(OUT_DIR, exist_ok=True)

# ── Load + resize ─────────────────────────────────────────────────────────────
img_path = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'sample.jpeg')
img_orig = Image.open(img_path).convert('L')
w_orig, h_orig = img_orig.size

MAX_DIM = 1280
scale = min(1.0, MAX_DIM / max(w_orig, h_orig))
w = round(w_orig * scale)
h = round(h_orig * scale)
img = img_orig.resize((w, h), Image.LANCZOS)
print(f"Original: {w_orig}x{h_orig}, Resized: {w}x{h}")

# Save the resized image
img.save(os.path.join(OUT_DIR, '01_resized.jpg'))

# ── Stats ──────────────────────────────────────────────────────────────────────
pixels_list = list(img.getdata())
mean = sum(pixels_list) / len(pixels_list)
std = math.sqrt(sum((p - mean)**2 for p in pixels_list) / len(pixels_list))
print(f"Mean: {mean:.1f}, StdDev: {std:.1f}")
embossed = mean > 150 and std < 38
print(f"Embossed: {embossed}")

# ── Apply contrast enhancement (like preprocessForBraille) ────────────────────
# Increase contrast by stretching
img_enhanced = img.point(lambda p: min(255, max(0, (p - mean + 128) * 1.5)))
img_enhanced.save(os.path.join(OUT_DIR, '02_enhanced.jpg'))

# ── Adaptive threshold ────────────────────────────────────────────────────────
# Simulate the JS adaptive binarization
block_size = max(11, int(min(w, h) / 20) | 1)
if block_size % 2 == 0: block_size += 1
C = -8 if embossed else 5
print(f"Block size: {block_size}, C: {C}, Embossed: {embossed}")

px = img_enhanced.load()
binary = Image.new('L', (w, h), 255)
bpx = binary.load()

# Build integral image
integral = [[0] * (w + 1) for _ in range(h + 1)]
for y in range(h):
    row_sum = 0
    for x in range(w):
        row_sum += px[x, y]
        integral[y+1][x+1] = integral[y][x+1] + row_sum

def integral_sum(x1, y1, x2, y2):
    return integral[y2+1][x2+1] - integral[y1][x2+1] - integral[y2+1][x1] + integral[y1][x1]

half = block_size // 2
for y in range(h):
    for x in range(w):
        x1 = max(0, x - half)
        y1 = max(0, y - half)
        x2 = min(w - 1, x + half)
        y2 = min(h - 1, y + half)
        count = (x2 - x1 + 1) * (y2 - y1 + 1)
        s = integral_sum(x1, y1, x2, y2)
        local_mean = s / count
        pixel_val = px[x, y]
        # dark = pixel < (localMean - C); binary 0=dark, 1=light
        bpx[x, y] = 0 if pixel_val < (local_mean - C) else 255

binary.save(os.path.join(OUT_DIR, '03_binary.png'))
print("Saved binary image")

# ── Connected components (simple BFS) ─────────────────────────────────────────
bin_data = [bpx[x, y] for y in range(h) for x in range(w)]
visited = [False] * (w * h)

img_area = w * h
min_blob = max(4, img_area * 0.00005)
max_blob = max(800, img_area * 0.04)
min_radius = max(1.5, math.sqrt(img_area) * 0.004)
max_radius = max(20, math.sqrt(img_area) * 0.18)
print(f"Blob size range: {min_blob:.0f}–{max_blob:.0f}")
print(f"Radius range: {min_radius:.1f}–{max_radius:.1f}")

def flood_fill(sx, sy):
    stack = [(sx, sy)]
    pixels_in = []
    while stack:
        cx, cy = stack.pop()
        idx = cy * w + cx
        if cx < 0 or cx >= w or cy < 0 or cy >= h: continue
        if visited[idx] or bin_data[idx] != 0: continue
        visited[idx] = True
        pixels_in.append((cx, cy))
        for dx, dy in [(-1,0),(1,0),(0,-1),(0,1)]:
            nx, ny = cx+dx, cy+dy
            nidx = ny * w + nx
            if 0 <= nx < w and 0 <= ny < h and not visited[nidx] and bin_data[nidx] == 0:
                stack.append((nx, ny))
    return pixels_in

dots = []
for y in range(h):
    for x in range(w):
        idx = y * w + x
        if bin_data[idx] == 0 and not visited[idx]:
            blob_pixels = flood_fill(x, y)
            size = len(blob_pixels)
            if min_blob <= size <= max_blob:
                xs = [p[0] for p in blob_pixels]
                ys = [p[1] for p in blob_pixels]
                cx = sum(xs) / size
                cy = sum(ys) / size
                radius = math.sqrt(size / math.pi)
                bw = max(xs) - min(xs)
                bh = max(ys) - min(ys)
                aspect = bh / bw if bw > 0 else 1
                if min_radius <= radius <= max_radius and 0.4 <= aspect <= 2.5:
                    dots.append({'x': cx, 'y': cy, 'r': radius, 'aspect': aspect})

print(f"\nDetected dots: {len(dots)}")

# Draw dots on original resized image
img_dots = img.convert('RGB')
draw = ImageDraw.Draw(img_dots)
for d in dots:
    r = d['r']
    draw.ellipse([d['x']-r, d['y']-r, d['x']+r, d['y']+r], outline='red', width=2)

img_dots.save(os.path.join(OUT_DIR, '04_dots.jpg'))
print(f"Saved dots overlay to {OUT_DIR}/04_dots.jpg")

# ── Dot clustering analysis ───────────────────────────────────────────────────
if dots:
    xs = sorted(set(round(d['x']) for d in dots))
    ys = sorted(set(round(d['y']) for d in dots))
    print(f"\nDot Y positions (approx): {sorted(set(round(d['y']/10)*10 for d in dots))}")
    print(f"Dot X range: {min(d['x'] for d in dots):.0f}–{max(d['x'] for d in dots):.0f}")
    print(f"Dot Y range: {min(d['y'] for d in dots):.0f}–{max(d['y'] for d in dots):.0f}")
    
    # Estimate cell size
    y_sorted = sorted(d['y'] for d in dots)
    y_diffs = [y_sorted[i+1] - y_sorted[i] for i in range(len(y_sorted)-1) if y_sorted[i+1] - y_sorted[i] > 5]
    if y_diffs:
        median_y_diff = sorted(y_diffs)[len(y_diffs)//2]
        print(f"Median Y inter-dot distance: {median_y_diff:.1f}")
        print(f"Estimated cell height: {median_y_diff * 2.6:.0f}px")

print("\nDone! Check scripts/debug/ for output images.")
