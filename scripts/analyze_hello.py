from PIL import Image
import numpy as np
from scipy import ndimage

img = Image.open('src/assets/sample.jpeg').convert('L')
arr = np.array(img)
h, w = arr.shape

# Otsu threshold
hist, _ = np.histogram(arr.flatten(), 256, [0, 256])
total = arr.size
sumT = np.dot(np.arange(256), hist)
sumB = 0; wB = 0; maxVar = 0; thresh = 128
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

print(f"Image: {w}x{h}, Otsu threshold: {thresh}")
binary = (arr < thresh).astype(np.uint8)  # 1 = dot (dark), 0 = background

labeled, num_features = ndimage.label(binary)
print(f"Dark blobs found: {num_features}")

sizes = ndimage.sum(binary, labeled, range(1, num_features+1))
centroids = ndimage.center_of_mass(binary, labeled, range(1, num_features+1))

# Filter by blob area - Braille dots at this resolution should be reasonably sized
img_area = w * h
min_area = 50
max_area = img_area * 0.002
print(f"Area filter: {min_area} - {max_area:.0f} px^2")

valid_dots = [(c, s) for c, s in zip(centroids, sizes) if min_area <= s <= max_area]
print(f"Valid dot blobs: {len(valid_dots)}")

if valid_dots:
    ys = [c[0][0] for c in valid_dots]
    xs = [c[0][1] for c in valid_dots]
    print(f"X range: {min(xs):.0f} - {max(xs):.0f}")
    print(f"Y range: {min(ys):.0f} - {max(ys):.0f}")

    # Sort by x
    sorted_by_x = sorted(valid_dots, key=lambda c: c[0][1])
    print("All dots sorted by X:")
    for i, (c, s) in enumerate(sorted_by_x):
        print(f"  dot {i+1:2d}: x={c[1]:6.1f}, y={c[0]:6.1f}, area={int(s)}")

    # Now group into cells
    # Estimate dot spacing
    all_xs = sorted([c[0][1] for c in valid_dots])
    all_ys = sorted([c[0][0] for c in valid_dots])

    # Try to cluster rows
    row_gap_threshold = (max(all_ys) - min(all_ys)) * 0.15 if len(all_ys) > 1 else 50
    print(f"\nRow gap threshold: {row_gap_threshold:.1f}")

    rows = []
    current_row = [valid_dots[sorted([valid_dots.index(d) for d in valid_dots], key=lambda i: valid_dots[i][0][0])[0]]]
    for d in sorted(valid_dots, key=lambda c: c[0][0])[1:]:
        if d[0][0] - current_row[-1][0][0] < row_gap_threshold:
            current_row.append(d)
        else:
            rows.append(current_row)
            current_row = [d]
    rows.append(current_row)

    print(f"Row clusters found: {len(rows)}")
    for ri, row in enumerate(rows):
        row_xs = sorted([d[0][1] for d in row])
        row_ys = [d[0][0] for d in row]
        print(f"  Row {ri+1}: {len(row)} dots, X={min(row_xs):.0f}-{max(row_xs):.0f}, Y={min(row_ys):.0f}-{max(row_ys):.0f}")
        for d, s in sorted(row, key=lambda c: c[0][1]):
            print(f"    x={d[1]:.0f}, y={d[0]:.0f}, area={int(s)}")
