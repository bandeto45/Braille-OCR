"""Analyze sample.jpeg: detect Braille dots and verify HELLO WORLD layout."""
from PIL import Image
import numpy as np
from scipy import ndimage

img = Image.open('src/assets/sample.jpeg').convert('L')
arr = np.array(img)
h, w = arr.shape
print(f"Image: {w}x{h}")

# Invert if background is bright (embossed = dots are lighter bumps on white paper,
# but printed Braille = dark dots on light background)
mean_brightness = arr.mean()
print(f"Mean brightness: {mean_brightness:.1f}")

# Otsu threshold
hist, bins = np.histogram(arr.flatten(), 256, [0, 256])
total = arr.size
sumT = np.dot(np.arange(256), hist)
sumB, wB, maxVar, thresh = 0, 0, 0, 128
for t in range(256):
    wB += hist[t]
    if wB == 0: continue
    wF = total - wB
    if wF == 0: break
    sumB += t * hist[t]
    mB = sumB / wB
    mF = (sumT - sumB) / wF
    v = wB * wF * (mB - mF) ** 2
    if v > maxVar:
        maxVar = v; thresh = t
print(f"Otsu threshold: {thresh}")

# Since mean=165 (bright image), dots are dark -> threshold inverts to pick dark
binary = (arr < thresh).astype(np.uint8)
dot_count_below = np.sum(binary)
print(f"Dark pixel fraction: {dot_count_below/total*100:.1f}%")

# Find connected components
labeled, num_features = ndimage.label(binary)
print(f"Connected components: {num_features}")

sizes = np.array(ndimage.sum(binary, labeled, range(1, num_features+1)))
centroids = ndimage.center_of_mass(binary, labeled, range(1, num_features+1))

# For a 4096x3072 image with ~10 cells and ~3 dots/cell ≈ 30 dots total
# Standard Braille cell is ~6mm wide × 10mm tall at 600 DPI (≈150px × 240px)
# But at 4096 px wide for a document, cells could be 200-400px wide
# Dots would be roughly 50-100 px diameter = 2000-8000 px² area
# Let's use circularity to filter: circularity = 4π·area/perimeter²

def circularity(label_id, arr):
    mask = (labeled == label_id)
    from scipy import ndimage as ndi
    # Get perimeter using erosion
    eroded = ndi.binary_erosion(mask)
    perimeter_px = np.sum(mask & ~eroded)
    area = np.sum(mask)
    if perimeter_px == 0: return 0
    return 4 * np.pi * area / (perimeter_px ** 2)

# First pass: get all blobs and their properties
print("\nAnalyzing blob size distribution:")
size_buckets = [0]*10
for s in sizes:
    bucket = min(9, int(np.log10(max(1, s))))
    size_buckets[bucket] += 1
for i, cnt in enumerate(size_buckets):
    if cnt > 0:
        print(f"  10^{i} - 10^{i+1} px²: {cnt} blobs")

# Looking at image content: for HELLO WORLD Braille at this resolution,
# dots should be large, round blobs. Let's try several size ranges.
# Test range: 1000 - 100000 px²
for min_s, max_s in [(500, 50000), (1000, 30000), (2000, 20000), (3000, 15000)]:
    valid = [(c, s) for c, s in zip(centroids, sizes) if min_s <= s <= max_s]
    print(f"Size range {min_s}-{max_s}: {len(valid)} blobs")

# Use the range that gives us closest to 30-35 dots
target_range = (2000, 20000)
valid_dots = [(c, s) for c, s in zip(centroids, sizes) if target_range[0] <= s <= target_range[1]]
print(f"\nUsing {len(valid_dots)} blobs (size {target_range[0]}-{target_range[1]} px²)")

if valid_dots:
    ys = [c[0][0] for c in valid_dots]
    xs = [c[0][1] for c in valid_dots]
    print(f"X range: {min(xs):.0f} - {max(xs):.0f}")
    print(f"Y range: {min(ys):.0f} - {max(ys):.0f}")
    
    # Cluster into rows by Y (threshold = 15% of Y span)
    y_span = max(ys) - min(ys)
    row_threshold = max(80, y_span * 0.15) if y_span > 0 else 80
    print(f"Row threshold: {row_threshold:.0f}px")
    
    sorted_by_y = sorted(valid_dots, key=lambda c: c[0][0])
    rows = []
    for d, s in sorted_by_y:
        placed = False
        for row in rows:
            if abs(d[0] - row['meanY']) < row_threshold:
                row['pts'].append((d, s))
                row['meanY'] = np.mean([p[0][0] for p in row['pts']])
                placed = True; break
        if not placed:
            rows.append({'meanY': d[0], 'pts': [(d, s)]})
    
    print(f"Row clusters: {len(rows)}")
    for ri, row in enumerate(rows):
        pts = sorted(row['pts'], key=lambda p: p[0][1])
        xs_row = [p[0][1] for p in pts]
        ys_row = [p[0][0] for p in pts]
        print(f"  Row {ri+1}: {len(pts)} dots, X={min(xs_row):.0f}-{max(xs_row):.0f}, Y={min(ys_row):.0f}-{max(ys_row):.0f}")

    # Try to group dots into cells (cell width ≈ span/num_cells)
    # For HELLO WORLD: 10 cells + 1 space = 11 positions
    all_xs = sorted([d[0][1] for d in valid_dots])
    x_span = all_xs[-1] - all_xs[0]
    print(f"\nX span: {x_span:.0f}px, estimated cell width: {x_span/10:.0f}px")
    
    # Try cell grouping with estimated cell width
    est_cell_w = x_span / 10
    est_cell_h = y_span if y_span > 50 else 200
    
    cell_threshold = est_cell_w * 0.7
    print(f"Cell X threshold: {cell_threshold:.0f}px")
    
    # Group by X into cells
    cells = []
    for d, s in sorted(valid_dots, key=lambda p: p[0][1]):
        placed = False
        for cell in cells:
            if abs(d[1] - cell['meanX']) < cell_threshold:
                cell['pts'].append((d, s))
                cell['meanX'] = np.mean([p[0][1] for p in cell['pts']])
                placed = True; break
        if not placed:
            cells.append({'meanX': d[1], 'pts': [(d, s)]})
    
    cells.sort(key=lambda c: c['meanX'])
    print(f"Cell clusters: {len(cells)}")
    
    # Expected HELLO WORLD chars and their dot counts
    expected = [
        ('H', [1,2,5], 3), ('E', [1,5], 2), ('L', [1,2,3], 3),
        ('L', [1,2,3], 3), ('O', [1,3,5], 3), 
        ('W', [2,4,5,6], 4), ('O', [1,3,5], 3), 
        ('R', [1,2,3,5], 4), ('L', [1,2,3], 3), ('D', [1,4,5], 3)
    ]
    
    for ci, cell in enumerate(cells):
        pts = cell['pts']
        dot_count = len(pts)
        hint = ""
        if ci < len(expected):
            ch, dots, expected_count = expected[ci]
            if dot_count == expected_count:
                hint = f"✓ {ch} (dots {dots})"
            else:
                hint = f"? expected {ch}={expected_count} (dots {dots})"
        ys_c = [p[0][0] for p in pts]
        xs_c = [p[0][1] for p in pts]
        print(f"  Cell {ci+1:2d}: {dot_count} dots @ X={np.mean(xs_c):.0f}  Y_range={min(ys_c):.0f}-{max(ys_c):.0f}  {hint}")
