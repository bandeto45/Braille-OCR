"""
Verify the fixed preprocessing (min-max stretch + C=5) on sample.jpeg.
"""
import math, os
from PIL import Image, ImageDraw, ImageOps

SRC = '/Volumes/BackUP/Braille-OCR/src/assets/sample.jpeg'
OUT = '/Volumes/BackUP/Braille-OCR/scripts/debug'
os.makedirs(OUT, exist_ok=True)

img_orig = Image.open(SRC).convert('L')
w_o, h_o = img_orig.size
scale = min(1.0, 1280 / max(w_o, h_o))
w, h = round(w_o * scale), round(h_o * scale)
img = img_orig.resize((w, h), Image.LANCZOS)
print(f"Resized: {w}x{h}")

# ── NEW preprocessing: min-max normalization ──────────────────────────────────
px_list = list(img.getdata())
lo, hi = min(px_list), max(px_list)
rng = hi - lo or 1
stretched = img.point(lambda p: round((p - lo) * 255 / rng))
stretched.save(f'{OUT}/06_new_preprocessed.png')
print(f"Min-max stretch: {lo}→{hi}, range={rng}")

sp = list(stretched.getdata())
mean = sum(sp)/len(sp)
std  = math.sqrt(sum((p-mean)**2 for p in sp)/len(sp))
print(f"After stretch: mean={mean:.1f} std={std:.1f}")

# ── Adaptive threshold C=5 ────────────────────────────────────────────────────
block = max(11, int(min(w, h) / 20) | 1)
if block % 2 == 0: block += 1
C = 5
print(f"Block size: {block}, C: {C}")

px = stretched.load()
integral = [[0]*(w+1) for _ in range(h+1)]
for y in range(h):
    rs = 0
    for x in range(w):
        rs += px[x, y]
        integral[y+1][x+1] = integral[y][x+1] + rs

half = block // 2
binary = []
for y in range(h):
    for x in range(w):
        x1,y1 = max(0,x-half), max(0,y-half)
        x2,y2 = min(w-1,x+half), min(h-1,y+half)
        cnt = (x2-x1+1)*(y2-y1+1)
        s = integral[y2+1][x2+1]-integral[y1][x2+1]-integral[y2+1][x1]+integral[y1][x1]
        lm = s / cnt
        binary.append(0 if px[x,y] < (lm - C) else 1)

dark = sum(1 for b in binary if b == 0)
print(f"Dark pixels: {dark} ({dark*100/(w*h):.1f}%)")

# ── Blob detection ────────────────────────────────────────────────────────────
area = w * h
min_sz = max(4, area * 0.00005)
max_sz = max(800, area * 0.04)
min_r  = max(1.5, math.sqrt(area) * 0.004)
max_r  = max(20, math.sqrt(area) * 0.18)

visited = [False] * (w * h)
blobs = []
for y in range(h):
    for x in range(w):
        idx = y*w+x
        if binary[idx] == 0 and not visited[idx]:
            stack = [(x,y)]
            pts = []
            while stack:
                cx,cy = stack.pop()
                cidx = cy*w+cx
                if cx<0 or cx>=w or cy<0 or cy>=h: continue
                if visited[cidx] or binary[cidx]!=0: continue
                visited[cidx]=True
                pts.append((cx,cy))
                for dx,dy in [(-1,0),(1,0),(0,-1),(0,1)]:
                    nx,ny=cx+dx,cy+dy
                    nidx=ny*w+nx
                    if 0<=nx<w and 0<=ny<h and not visited[nidx] and binary[nidx]==0:
                        stack.append((nx,ny))
            sz = len(pts)
            if min_sz <= sz <= max_sz:
                cxm = sum(p[0] for p in pts)/sz
                cym = sum(p[1] for p in pts)/sz
                r   = math.sqrt(sz/math.pi)
                bw  = max(p[0] for p in pts)-min(p[0] for p in pts)
                bh2 = max(p[1] for p in pts)-min(p[1] for p in pts)
                asp = bh2/bw if bw>0 else 1
                if min_r <= r <= max_r and 0.4 <= asp <= 2.5:
                    blobs.append({'x':cxm,'y':cym,'r':r})

print(f"Blobs detected: {len(blobs)}")

# Filter to main Braille cluster (radius > 8 = real dots)
main_blobs = [b for b in blobs if b['r'] > 8]
print(f"Main Braille blobs (r>8): {len(main_blobs)}")

# ── Draw overlay ──────────────────────────────────────────────────────────────
img_rgb = img.convert('RGB')
draw = ImageDraw.Draw(img_rgb)
for b in blobs:
    r = b['r']
    color = 'red' if r > 8 else 'blue'
    draw.ellipse([b['x']-r,b['y']-r,b['x']+r,b['y']+r], outline=color, width=2)
img_rgb.save(f'{OUT}/07_fixed_dots.jpg')
print(f"Saved: {OUT}/07_fixed_dots.jpg  (red=main dots, blue=small)")

# ── Group into Braille rows ───────────────────────────────────────────────────
if main_blobs:
    ys = [b['y'] for b in main_blobs]
    sorted_y = sorted(ys)
    y_diffs = [sorted_y[i+1]-sorted_y[i] for i in range(len(sorted_y)-1) if sorted_y[i+1]-sorted_y[i]>5]
    if y_diffs:
        med_dy = sorted(y_diffs)[len(y_diffs)//2]
        print(f"Median inter-dot Y: {med_dy:.1f}px  → est cell height: {med_dy*2.6:.0f}px")
    
    # Simple row grouping
    rows = []
    for b in sorted(main_blobs, key=lambda b: b['y']):
        placed = False
        for row in rows:
            if abs(b['y'] - row['mean_y']) < 30:
                row['dots'].append(b)
                row['mean_y'] = sum(d['y'] for d in row['dots'])/len(row['dots'])
                placed = True; break
        if not placed:
            rows.append({'mean_y': b['y'], 'dots': [b]})
    
    print(f"\nBraille dot rows: {len(rows)}")
    for i, row in enumerate(rows):
        xs = sorted(d['x'] for d in row['dots'])
        print(f"  Row {i}: y≈{row['mean_y']:.0f}, {len(row['dots'])} dots at x={[round(x) for x in xs]}")
    
    # Estimate cell x positions
    all_xs = sorted(b['x'] for b in main_blobs)
    x_diffs = [all_xs[j+1]-all_xs[j] for j in range(len(all_xs)-1) if 20 < all_xs[j+1]-all_xs[j] < 80]
    if x_diffs:
        med_dx = sorted(x_diffs)[len(x_diffs)//2]
        print(f"Median inter-dot X: {med_dx:.1f}px  → est cell width: {med_dx*2.2:.0f}px")
        print(f"\nExpected 'Hello World' (10 cells, ~30-40 dots) at ~{10*med_dx*2.2:.0f}px wide")
