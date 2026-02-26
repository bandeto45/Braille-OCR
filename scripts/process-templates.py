#!/usr/bin/env python3
"""
Braille Template Processor
===========================
Reads raw Braille cell photos from raw-templates/, detects the dot pattern,
identifies the character, and saves a 64x96 px PNG to
src/assets/braille-templates/{char}.png.

Usage:
    python3 scripts/process-templates.py                   # process all in raw-templates/
    python3 scripts/process-templates.py path/to/photo.jpg # single file

The script auto-detects the Braille character from the dot layout.
It also supports an interactive fallback: if confidence is low it asks you
to confirm or manually enter the character.

Requirements: Pillow  (pip3 install Pillow)
"""

import os, sys, math, argparse
from pathlib import Path
from collections import Counter
from typing import Optional

try:
    from PIL import Image, ImageFilter, ImageOps, ImageDraw
except ImportError:
    sys.exit("Install Pillow first:  pip3 install Pillow")

# ─── Paths ────────────────────────────────────────────────────────────────────
REPO_ROOT   = Path(__file__).resolve().parent.parent
RAW_DIR     = REPO_ROOT / "raw-templates"
OUT_DIR     = REPO_ROOT / "src" / "assets" / "braille-templates"
TEMPLATE_W  = 64
TEMPLATE_H  = 96

# ─── Braille dot patterns ─────────────────────────────────────────────────────
# 6-bit mask: bit0=dot1(left-top), bit1=dot2(left-mid), bit2=dot3(left-bot)
#             bit3=dot4(right-top), bit4=dot5(right-mid), bit5=dot6(right-bot)
CHAR_DOT_PATTERNS = {
    'a': 0b000001, 'b': 0b000011, 'c': 0b001001, 'd': 0b011001, 'e': 0b010001,
    'f': 0b001011, 'g': 0b011011, 'h': 0b010011, 'i': 0b001010, 'j': 0b011010,
    'k': 0b000101, 'l': 0b000111, 'm': 0b001101, 'n': 0b011101, 'o': 0b010101,
    'p': 0b001111, 'q': 0b011111, 'r': 0b010111, 's': 0b001110, 't': 0b011110,
    'u': 0b100101, 'v': 0b100111, 'w': 0b111010, 'x': 0b101101, 'y': 0b111101,
    'z': 0b110101,
    '1': 0b000001, '2': 0b000011, '3': 0b001001, '4': 0b011001, '5': 0b010001,
    '6': 0b001011, '7': 0b011011, '8': 0b010011, '9': 0b001010, '0': 0b011010,
}
# Reverse: pattern → list of chars
PATTERN_TO_CHARS = {}  # type: dict[int, list[str]]
for ch, pat in CHAR_DOT_PATTERNS.items():
    PATTERN_TO_CHARS.setdefault(pat, []).append(ch)


# ─── Image helpers ────────────────────────────────────────────────────────────

def load_gray(path: Path) -> Image.Image:
    img = Image.open(path).convert("L")
    return img


def auto_crop_cell(gray: Image.Image, margin_frac: float = 0.05) -> Image.Image:
    """
    Crop to the region containing the Braille dots by finding the bounding box
    of 'interesting' pixels after contrast-stretching + thresholding.
    Falls back to centre-crop if nothing is found.
    """
    w, h = gray.size
    # Stretch contrast
    stretched = ImageOps.autocontrast(gray, cutoff=1)
    # Blur slightly to reduce paper texture noise
    blurred = stretched.filter(ImageFilter.GaussianBlur(radius=max(2, min(w, h) // 80)))

    pixels = list(blurred.getdata())
    mean = sum(pixels) / len(pixels)
    std  = math.sqrt(sum((p - mean) ** 2 for p in pixels) / len(pixels))

    # For embossed white-on-white: dots are slightly lighter OR darker than bg
    # Detect outliers in both directions
    low_thresh  = max(0,   mean - std * 1.2)
    high_thresh = min(255, mean + std * 1.2)

    # Build interest mask
    interest = blurred.point(lambda p: 255 if (p < low_thresh or p > high_thresh) else 0)

    # Dilate to connect nearby blobs
    interest = interest.filter(ImageFilter.MaxFilter(size=max(3, min(w, h) // 30 | 1)))

    bbox = interest.getbbox()
    if bbox is None:
        # Fallback: centre 50% of image
        cw, ch = w // 2, h // 2
        x0, y0 = w // 4, h // 4
        return gray.crop((x0, y0, x0 + cw, y0 + ch))

    # Add margin
    mx = int(w * margin_frac)
    my = int(h * margin_frac)
    x0 = max(0, bbox[0] - mx)
    y0 = max(0, bbox[1] - my)
    x1 = min(w, bbox[2] + mx)
    y1 = min(h, bbox[3] + my)

    # Ensure at least a square aspect ratio close to 2:3
    cw, ch = x1 - x0, y1 - y0
    if cw > 0 and ch > 0:
        target_ratio = TEMPLATE_W / TEMPLATE_H  # 2/3
        cur_ratio = cw / ch
        if cur_ratio > target_ratio:
            # Too wide — expand height
            extra = int(cw / target_ratio - ch) // 2
            y0 = max(0, y0 - extra)
            y1 = min(h, y1 + extra)
        else:
            # Too tall — expand width
            extra = int(ch * target_ratio - cw) // 2
            x0 = max(0, x0 - extra)
            x1 = min(w, x1 + extra)

    return gray.crop((x0, y0, x1, y1))


def detect_dot_blobs(cell_gray: Image.Image) -> list[tuple[float, float, float]]:
    """
    Detect circular dot blobs in a (already cropped) grayscale cell image.
    Returns list of (cx_frac, cy_frac, radius_frac) in [0,1] coordinates.
    cx/cy/radius are expressed as fraction of cell width/height.
    """
    w, h = cell_gray.size
    stretched = ImageOps.autocontrast(cell_gray, cutoff=0.5)
    blurred   = stretched.filter(ImageFilter.GaussianBlur(radius=max(1, min(w, h) // 20)))
    pixels    = list(blurred.getdata())
    mean = sum(pixels) / len(pixels)
    std  = math.sqrt(sum((p - mean) ** 2 for p in pixels) / len(pixels))

    # For embossed Braille: dots are raised — they catch light differently
    # Try both bright-blob and dark-blob detection
    blobs = []
    for polarity in ('bright', 'dark'):
        if polarity == 'bright':
            thresh = mean + std * 0.6
            binary = blurred.point(lambda p: 255 if p > thresh else 0)  # noqa: B023
        else:
            thresh = mean - std * 0.6
            binary = blurred.point(lambda p: 255 if p < thresh else 0)  # noqa: B023

        blobs_p = _connected_components(binary, w, h)
        blobs.extend(blobs_p)

    # Keep the set of blobs that most plausibly forms a 2×3 Braille grid
    blobs = _filter_and_deduplicate(blobs, w, h)
    return blobs


def _connected_components(binary: Image.Image, w: int, h: int) -> list[tuple[float, float, float]]:
    """Simple connected-component analysis; returns (cx_frac, cy_frac, r_frac) list."""
    data = list(binary.getdata())
    visited = [False] * (w * h)
    blobs = []

    def neighbours(idx):
        x, y = idx % w, idx // w
        result = []
        for dx, dy in ((-1,0),(1,0),(0,-1),(0,1)):
            nx, ny = x+dx, y+dy
            if 0 <= nx < w and 0 <= ny < h:
                result.append(ny*w+nx)
        return result

    for start in range(w * h):
        if data[start] < 128 or visited[start]:
            continue
        # BFS
        queue = [start]
        pixels_in_blob = []
        while queue:
            idx = queue.pop()
            if visited[idx]:
                continue
            visited[idx] = True
            pixels_in_blob.append(idx)
            for nb in neighbours(idx):
                if not visited[nb] and data[nb] >= 128:
                    queue.append(nb)

        size = len(pixels_in_blob)
        min_area = max(4, (w * h) // 2000)
        max_area = (w * h) // 4
        if size < min_area or size > max_area:
            continue

        xs = [p % w for p in pixels_in_blob]
        ys = [p // w for p in pixels_in_blob]
        cx = sum(xs) / size
        cy = sum(ys) / size
        bw = max(xs) - min(xs) + 1
        bh = max(ys) - min(ys) + 1
        aspect = bw / bh if bh > 0 else 99
        if aspect < 0.3 or aspect > 3.5:
            continue  # too elongated
        radius = math.sqrt(size / math.pi)
        blobs.append((cx / w, cy / h, radius / min(w, h)))

    return blobs


def _filter_and_deduplicate(
    blobs: list[tuple[float, float, float]],
    w: int, h: int
) -> list[tuple[float, float, float]]:
    """Remove duplicate blobs (same position, different polarity) and outliers."""
    # Merge blobs closer than 5% of image dimension
    merged: list[tuple[float, float, float]] = []
    for cx, cy, r in blobs:
        too_close = False
        for mc, my2, mr in merged:
            dist = math.sqrt((cx - mc)**2 + (cy - my2)**2)
            if dist < 0.07:
                too_close = True
                break
        if not too_close:
            merged.append((cx, cy, r))

    # Keep at most 6 (maximum Braille dots per cell)
    merged.sort(key=lambda b: -b[2])  # largest first
    return merged[:6]


# ─── Grid assignment ──────────────────────────────────────────────────────────

def blobs_to_pattern(blobs: list) -> int:
    """
    Given normalised blob centroids (cx, cy in [0,1]), assign each to one of
    the 6 Braille dot positions and return the 6-bit pattern.

    Dot positions in a 2×3 grid (col × row):
        col 0 (left)  col 1 (right)
        dot1           dot4      row 0 (top)
        dot2           dot5      row 1 (mid)
        dot3           dot6      row 2 (bot)
    """
    if not blobs:
        return 0

    xs = [b[0] for b in blobs]
    ys = [b[1] for b in blobs]

    # Determine column threshold (midpoint of left-most and right-most x)
    x_mid = (min(xs) + max(xs)) / 2 if len(set(xs)) > 1 else 0.5
    # Determine row thresholds
    y_sorted = sorted(set(ys))
    if len(y_sorted) >= 3:
        y_third = (y_sorted[0] + y_sorted[-1]) / 3
        y_two_thirds = (y_sorted[0] + y_sorted[-1]) / 3 * 2
    elif len(y_sorted) == 2:
        span = y_sorted[-1] - y_sorted[0]
        y_third = y_sorted[0] + span * 0.33
        y_two_thirds = y_sorted[0] + span * 0.66
    else:
        y_third = 0.33
        y_two_thirds = 0.66

    pattern = 0
    for cx, cy, _ in blobs:
        col = 1 if cx > x_mid else 0    # 0=left, 1=right
        if cy < y_third:
            row = 0  # top
        elif cy < y_two_thirds:
            row = 1  # mid
        else:
            row = 2  # bot

        # bit index: col0→bits 0,1,2  col1→bits 3,4,5
        bit = col * 3 + row
        pattern |= (1 << bit)

    return pattern


def pattern_to_char(pattern: int) -> list:
    """Return matching character(s) for the given 6-bit pattern; [] if none."""
    return PATTERN_TO_CHARS.get(pattern, [])


# ─── Main processing ──────────────────────────────────────────────────────────

def process_image(
    src_path: Path,
    interactive: bool = True,
    force_char: Optional[str] = None
) -> Optional[str]:
    """
    Process a single raw Braille photo.
    Returns the character it was saved as, or None on failure/skip.
    """
    print(f"\n{'─'*60}")
    print(f"  Image : {src_path.name}")

    gray     = load_gray(src_path)
    cropped  = auto_crop_cell(gray)
    blobs    = detect_dot_blobs(cropped)
    pattern  = blobs_to_pattern(blobs)
    matches  = pattern_to_char(pattern)

    print(f"  Blobs : {len(blobs)} dot(s) detected")
    print(f"  Pattern (6-bit) : {pattern:06b}  ({pattern})")
    if matches:
        print(f"  Matches : {matches}")
    else:
        print(f"  Matches : (none — no matching Braille character)")

    # Visualise (optional — save a debug PNG with dots marked)
    _save_debug(cropped, blobs, src_path)

    # Determine final character
    char = force_char
    if char is None:
        if len(matches) == 1:
            char = matches[0]
            print(f"  → Auto-assigned : '{char}'")
        elif len(matches) > 1:
            # Prefer letter over digit when ambiguous (a=1, b=2, … j=0)
            letters = [m for m in matches if m.isalpha()]
            char = letters[0] if letters else matches[0]
            print(f"  → Auto-assigned (ambiguous {matches}) : '{char}'")
        else:
            print(f"  → Could not identify character automatically.")

    if interactive and (char is None or len(matches) > 1):
        user_input = input(
            f"  Enter character to save as (a-z, 0-9) or ENTER to skip: "
        ).strip().lower()
        if user_input and user_input in CHAR_DOT_PATTERNS:
            char = user_input
        elif user_input == '':
            print(f"  Skipped.")
            return None
        else:
            print(f"  Invalid character '{user_input}'. Skipped.")
            return None

    if char is None:
        print("  No character determined. Skipped.")
        return None

    # Resize to 64×96 and save
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{char}.png"

    # Convert cropped grayscale to RGB for the saved template
    final = cropped.resize((TEMPLATE_W, TEMPLATE_H), Image.LANCZOS)
    final = ImageOps.autocontrast(final, cutoff=0.5)
    final.save(out_path, "PNG")
    print(f"  ✓ Saved → {out_path.relative_to(REPO_ROOT)}")
    return char


def _save_debug(cell_img: Image.Image, blobs: list, src_path: Path) -> None:
    """Save a debug image with detected dots circled into raw-templates/debug/."""
    debug_dir = RAW_DIR / "debug"
    debug_dir.mkdir(exist_ok=True)
    rgb = cell_img.convert("RGB").resize((192, 288), Image.LANCZOS)  # 3× for visibility
    draw = ImageDraw.Draw(rgb)
    rw, rh = 192, 288
    for cx, cy, r in blobs:
        px, py = int(cx * rw), int(cy * rh)
        pr = max(4, int(r * min(rw, rh) * 3))
        draw.ellipse([px-pr, py-pr, px+pr, py+pr], outline=(255, 80, 0), width=2)
    rgb.save(debug_dir / (src_path.stem + "_debug.png"))


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Process raw Braille photos into template PNGs.")
    parser.add_argument(
        "images", nargs="*",
        help="Image files to process. Defaults to all JPG/PNG in raw-templates/."
    )
    parser.add_argument(
        "--char", "-c",
        help="Force a specific character (e.g. --char a). Useful for single-file processing."
    )
    parser.add_argument(
        "--non-interactive", "-n", action="store_true",
        help="Never prompt — skip ambiguous images instead of asking."
    )
    args = parser.parse_args()

    interactive = not args.non_interactive
    force_char  = args.char.lower() if args.char else None

    if args.images:
        paths = [Path(p) for p in args.images]
    else:
        exts = {".jpg", ".jpeg", ".png", ".heic", ".webp"}
        paths = sorted(
            p for p in RAW_DIR.iterdir()
            if p.suffix.lower() in exts and p.name != "README.md"
        )

    if not paths:
        print(f"No images found in {RAW_DIR}/")
        print("Put your raw Braille photos there and re-run, or pass file paths as arguments.")
        return

    print(f"Processing {len(paths)} image(s) → {OUT_DIR}/")
    saved: dict[str, str] = {}

    for path in paths:
        if not path.exists():
            print(f"\n  ✗ File not found: {path}")
            continue
        char = process_image(path, interactive=interactive, force_char=force_char)
        if char:
            saved[path.name] = char

    # Summary
    print(f"\n{'═'*60}")
    print(f"  Done. {len(saved)}/36 templates saved.")
    existing = [f for f in OUT_DIR.iterdir() if f.suffix == '.png']
    print(f"  Total PNGs in templates folder: {len(existing)}")
    missing = [
        ch for ch in CHAR_DOT_PATTERNS
        if not (OUT_DIR / f"{ch}.png").exists()
    ]
    if missing:
        # Show unique patterns (letters a-j overlap with digits 1-0)
        unique_missing = sorted(set(missing) - {'1','2','3','4','5','6','7','8','9','0'})
        digit_missing  = sorted(d for d in missing if d.isdigit())
        if unique_missing:
            print(f"  Missing letters  : {' '.join(unique_missing)}")
        if digit_missing:
            print(f"  Missing digits   : {' '.join(digit_missing)}")
    else:
        print("  All 36 templates present — ready for high-accuracy OCR!")
    print(f"{'═'*60}")


if __name__ == "__main__":
    main()
