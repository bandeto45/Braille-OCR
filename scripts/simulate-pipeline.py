"""
Simulate the updated dot-pattern matching pipeline for sample.jpeg.
Uses exact same logic as the JS implementation.
"""
import math

# === Known dot data from verify-fix.py ===
# (x, y, radius) for main blobs (r>8) from the fixed pipeline
ALL_DOTS = [
    # Row y≈257 (top dot-row)
    (59,  257, 11.2), (162, 253, 11.8), (262, 253, 11.4), (363, 255, 11.6),
    (463, 257, 12.1), (701, 258, 10.9), (762, 259, 11.9), (861, 261, 12.2),
    (960, 262, 11.6), (1058,263, 11.8), (1097,261, 10.5),
    # Row y≈295 (mid dot-row)
    (57,  290, 11.1), (98,  288, 12.5), (199, 291, 12.1), (262, 293, 11.3),
    (363, 294, 11.8), (503, 295, 11.8), (663, 296, 12.4), (700, 297, 12.2),
    (800, 297, 12.7), (860, 298, 11.9), (900, 299, 11.9), (960, 301, 12.4),
    (1064,300,  5.0), (1092,297, 13.2),  # 1064 is noise!
    # Row y≈334 (bottom dot-row)
    (261, 331, 11.8), (363, 333, 11.9), (465, 333, 12.1),
    (702, 334, 11.3), (762, 336, 12.6), (862, 337, 13.0), (962, 337, 12.2),
]

EST_CELL_W = 85.0
EST_CELL_H = 78.0
WORD_GAP_RATIO = 1.8

# ── Grade 1 Braille dot patterns ─────────────────────────────────────────────
CHAR_DOT_PATTERNS = {
    'a':0b000001,'b':0b000011,'c':0b001001,'d':0b011001,'e':0b010001,
    'f':0b001011,'g':0b011011,'h':0b010011,'i':0b001010,'j':0b011010,
    'k':0b000101,'l':0b000111,'m':0b001101,'n':0b011101,'o':0b010101,
    'p':0b001111,'q':0b011111,'r':0b010111,'s':0b001110,'t':0b011110,
    'u':0b100101,'v':0b100111,'w':0b111010,'x':0b101101,'y':0b111101,
    'z':0b110101,
    '1':0b000001,'2':0b000011,'3':0b001001,'4':0b011001,'5':0b010001,
    '6':0b001011,'7':0b011011,'8':0b010011,'9':0b001010,'0':0b011010,
}

# ── Step 1: Group all dots into Braille lines (Y threshold = estCellH*1.1) ────
Y_ROW_THRESH = EST_CELL_H * 1.1  # 85.8 px
rows = []
for dot in sorted(ALL_DOTS, key=lambda d: d[1]):
    x, y, r = dot
    placed = False
    for row in rows:
        if abs(y - row['meanY']) < Y_ROW_THRESH:
            row['dots'].append(dot)
            row['meanY'] = sum(d[1] for d in row['dots']) / len(row['dots'])
            placed = True
            break
    if not placed:
        rows.append({'meanY': y, 'dots': [dot]})

print(f"Braille rows found: {len(rows)}")
for i, row in enumerate(rows):
    print(f"  Row {i}: meanY={row['meanY']:.1f}, {len(row['dots'])} dots")

# ── Step 2: X-cluster into cells within each row ─────────────────────────────
X_CELL_THRESH = EST_CELL_W * 0.7  # 59.5 px
cell_regions = []

for row_idx, row in enumerate(rows):
    sorted_dots = sorted(row['dots'], key=lambda d: d[0])
    clusters = []
    for dot in sorted_dots:
        x, y, r = dot
        placed = False
        for cl in clusters:
            if abs(x - cl['meanX']) < X_CELL_THRESH:
                cl['dots'].append(dot)
                cl['meanX'] = sum(d[0] for d in cl['dots']) / len(cl['dots'])
                placed = True
                break
        if not placed:
            clusters.append({'meanX': x, 'dots': [dot]})
    
    clusters.sort(key=lambda c: c['meanX'])
    prev_x = None
    for col_idx, cl in enumerate(clusters):
        if prev_x is not None and cl['meanX'] - prev_x > WORD_GAP_RATIO * EST_CELL_W:
            cell_regions.append({'isSpace': True, 'rowIndex': row_idx, 'colIndex': col_idx})
        
        min_dot_x = min(d[0] for d in cl['dots'])
        min_dot_y = min(d[1] for d in cl['dots'])
        cell_x = min_dot_x - EST_CELL_W * 0.25
        cell_y = min_dot_y - EST_CELL_H * 0.2
        real_col = len([c for c in cell_regions if c.get('rowIndex') == row_idx and not c.get('isSpace')])
        
        cell_regions.append({
            'isSpace': False,
            'rowIndex': row_idx,
            'colIndex': real_col,
            'x': cell_x, 'y': cell_y,
            'w': EST_CELL_W, 'h': EST_CELL_H,
            'dots': cl['dots'],
        })
        prev_x = cl['meanX']

print(f"\nCell regions: {len(cell_regions)}")

# ── Step 3: matchCellsByDotPattern ───────────────────────────────────────────
def match_by_pattern(cell):
    if cell.get('isSpace'):
        return ' '
    dots = cell['dots']
    if not dots:
        return '?'
    
    # Deduplicate: filter small blobs + close pairs
    DEDUP_DIST = cell['h'] * 0.20
    radii = sorted(d[2] for d in dots)
    medR = radii[len(radii)//2] if radii else 1
    minR = medR * 0.5
    
    deduped = []
    for d in sorted(dots, key=lambda d: -d[2]):
        r = d[2]
        if r < minR:
            continue
        too_close = any(math.hypot(d[0]-k[0], d[1]-k[1]) < DEDUP_DIST for k in deduped)
        if not too_close:
            deduped.append(d)
    
    if not deduped:
        return '?'
    
    # Y-cluster
    Y_THRESH = cell['h'] * 0.30
    yclusters = []
    for d in sorted(deduped, key=lambda d: d[1]):
        placed = False
        for cl in yclusters:
            if abs(d[1] - cl['meanY']) < Y_THRESH:
                cl['pts'].append(d)
                cl['meanY'] = sum(p[1] for p in cl['pts']) / len(cl['pts'])
                placed = True
                break
        if not placed:
            yclusters.append({'meanY': d[1], 'pts': [d]})
    yclusters.sort(key=lambda c: c['meanY'])
    row_clusters = yclusters[:3]
    
    # L/R split
    mid_x = cell['x'] + cell['w'] / 2
    
    # Build pattern
    pattern = 0
    for row_idx_c, cl in enumerate(row_clusters):
        for pt in cl['pts']:
            bit_idx = row_idx_c + 3 if pt[0] > mid_x else row_idx_c
            pattern |= (1 << bit_idx)
    
    # Lookup
    for ch, pat in CHAR_DOT_PATTERNS.items():
        if pat == pattern:
            return ch
    return f'?({pattern:06b})'

# ── Step 4: Assemble sentence ─────────────────────────────────────────────────
print("\n=== Cell-by-cell results ===")
sorted_cells = sorted(cell_regions, key=lambda c: (c['rowIndex'], c['colIndex']))
text = ''
prev_row = None
for cell in sorted_cells:
    if prev_row is not None and cell['rowIndex'] != prev_row:
        if text and text[-1] != ' ':
            text += ' '
    prev_row = cell['rowIndex']
    
    if cell.get('isSpace'):
        if text and text[-1] != ' ':
            text += ' '
        print(f"  [SPACE]")
    else:
        ch = match_by_pattern(cell)
        info = f"  Cell row={cell['rowIndex']} col={cell['colIndex']}: {len(cell['dots'])} dots -> '{ch}'"
        if 'x' in cell:
            # Show dedup details
            dots = cell['dots']
            radii = [d[2] for d in dots]
            medR = sorted(radii)[len(radii)//2]
            minR = medR * 0.5
            filtered = [d for d in dots if d[2] >= minR]
            info += f"  (dots: {[(round(d[0]),round(d[1]),round(d[2],1)) for d in filtered]})"
        print(info)
        text += ch

text = text.strip()
if text:
    text = text[0].upper() + text[1:]
print(f"\nFinal result: '{text}'")
print(f"Expected:     'Hello world'")
