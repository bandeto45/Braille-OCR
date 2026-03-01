"""Diagnose preprocessing amplification on sample.jpeg."""
from PIL import Image
import numpy as np
from scipy.ndimage import uniform_filter

img = Image.open('src/assets/sample.jpeg').convert('L')
w, h = img.size
scale = min(1, 1280 / max(w, h))
nw, nh = round(w * scale), round(h * scale)
img = img.resize((nw, nh), Image.LANCZOS)
print(f'Resized: {nw}x{nh}')

# ROI 0.8x0.6
rw, rh = round(nw * 0.8), round(nh * 0.6)
rx, ry = (nw - rw) // 2, (nh - rh) // 2
roi = np.array(img)[ry:ry+rh, rx:rx+rw].astype(float)
print(f'ROI (0.8,0.6): {rw}x{rh} offset=({rx},{ry})')
print(f'ROI stats: mean={roi.mean():.1f} std={roi.std():.1f} range={roi.min():.0f}-{roi.max():.0f}')

# Wider ROI
rw2 = round(nw * 0.95)
rh2 = round(nh * 0.85)
rx2 = (nw - rw2) // 2
ry2 = (nh - rh2) // 2
roi2 = np.array(img)[ry2:ry2+rh2, rx2:rx2+rw2].astype(float)
print(f'ROI (0.95,0.85): {rw2}x{rh2} offset=({rx2},{ry2})')
print(f'ROI2 stats: mean={roi2.mean():.1f} std={roi2.std():.1f}')

# Current embossed preprocessing
blur_r = max(1, round(min(rw, rh) / 200))
blurred = uniform_filter(roi, size=2 * blur_r + 1)
print(f'\n=== Current embossed path: blur r={blur_r} ===')
print(f'  After blur: std={blurred.std():.1f}')

p1 = np.percentile(blurred, 1)
p99 = np.percentile(blurred, 99)
rng = max(p99 - p1, 1)
stretched = np.clip((blurred - p1) * 255.0 / rng, 0, 255)
print(f'  After stretch (p1={p1:.0f} p99={p99:.0f}): std={stretched.std():.1f}, factor={255.0/rng:.1f}x')

block = max(11, round(min(rw, rh) / 20)) | 1
local_mean = uniform_filter(stretched, size=block)
for C in [8, 12, 15, 20]:
    fg = np.sum(stretched < (local_mean - C))
    print(f'  C={C}: foreground={fg} ({100*fg/(rw*rh):.2f}%)')

# Conservative path
blur_r2 = max(2, round(min(rw, rh) / 120))
blurred2 = uniform_filter(roi, size=2 * blur_r2 + 1)
conservative = np.clip(128 + (blurred2 - 128) * 1.3, 0, 255)
print(f'\n=== Conservative path: blur r={blur_r2}, contrast 1.3x ===')
print(f'  After: mean={conservative.mean():.1f} std={conservative.std():.1f}')
local_mean2 = uniform_filter(conservative, size=block)
for C in [8, 10, 12, 15]:
    fg = np.sum(conservative < (local_mean2 - C))
    print(f'  C={C}: foreground={fg} ({100*fg/(rw*rh):.2f}%)')

# H character check
print(f'\nH cell leftmost dot x=57: ROI(0.8,0.6) rx={rx} -> {"INSIDE" if 57 >= rx else "OUTSIDE"}')
print(f'H cell leftmost dot x=57: ROI(0.95,0.85) rx={rx2} -> {"INSIDE" if 57 >= rx2 else "OUTSIDE"}')
