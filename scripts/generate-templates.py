#!/usr/bin/env python3
"""
Generate Photorealistic Embossed Braille Templates
=====================================================
Creates all 36 template PNGs (a-z, 0-9) at 64×96 px suitable for
grayscale-normalised NCC template matching.

Design philosophy (facial-recognition style matching):
  Both the reference templates AND the camera-extracted cell regions are
  converted to the SAME normalised binary representation before NCC:
    1. Convert to grayscale (luma)
    2. Otsu threshold → binary (black dot blobs on white background)
  This makes NCC purely structural — it compares WHERE the dots are.

  Templates look like real photographed Braille — raised dots on cream
  paper, hemisphere-shaded with a directional light source:
    • Cream paper background (~215 gray + subtle grain)
    • Each dot is a 3-D hemisphere: bright highlight + directional shadow
    • Contact-shadow ring at the dot base (darker than paper)
    • After Otsu binarization → clean black filled circle on white
  Net effect: realistic visual appearance AND Otsu-separable from background
  (average dot brightness ~150 vs background ~215, Δ = 65 gray levels).

Output:  src/assets/braille-templates/{char}.png   (36 files)

Requirements:  pip3 install Pillow numpy

Usage:
    python3 scripts/generate-templates.py
    python3 scripts/generate-templates.py --preview   # also save 3× debug versions
"""

import sys
import argparse
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("Install Pillow first:  pip3 install Pillow")

try:
    import numpy as np
except ImportError:
    sys.exit("Install numpy first:  pip3 install numpy")

# ─── Paths ────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR   = REPO_ROOT / "src" / "assets" / "braille-templates"

# ─── Template dimensions ──────────────────────────────────────────────────────
TEMPLATE_W = 64
TEMPLATE_H = 96

# ─── Braille dot patterns (6-bit masks) ───────────────────────────────────────
# bit0=dot1(left-top), bit1=dot2(left-mid), bit2=dot3(left-bot)
# bit3=dot4(right-top), bit4=dot5(right-mid), bit5=dot6(right-bot)
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

# ─── Dot grid positions ──────────────────────────────────────────────────────
DOT_POSITIONS = [
    (0.30, 0.18),  # dot 1: left-top
    (0.30, 0.50),  # dot 2: left-mid
    (0.30, 0.82),  # dot 3: left-bot
    (0.70, 0.18),  # dot 4: right-top
    (0.70, 0.50),  # dot 5: right-mid
    (0.70, 0.82),  # dot 6: right-bot
]

# ─── Rendering parameters — Photorealistic Embossed ─────────────────────────
# Dots are rendered as 3-D hemispheres on cream paper under a directional light.
# The resulting image looks like a real Braille photo while still being cleanly
# separable by Otsu binarization (average dot brightness ~150 vs paper ~215, Δ65).
#
#   After Otsu binarization: dot region → 0 (black), paper → 255 (white)
#   NCC is then purely structural — position-only matching, lighting-invariant.

BG_MEAN         = 215    # cream/off-white paper base brightness
BG_NOISE        = 8      # ± paper grain amplitude (simulates paper texture)
DOT_RADIUS_FRAC = 0.148  # dot radius as fraction of TEMPLATE_W (~9.5 px at 64 px)
OUTER_FRAC      = 1.35   # contact-shadow ring extends to this × radius

# Directional light: upper-left at ~45° elevation (common desk/camera lighting)
# Normalised direction vector pointing FROM scene TO light source.
_LX = -0.5774   # ← left
_LY = -0.5774   # ↑ up
_LZ =  0.5774   # toward viewer

# DOT brightness range — both values intentionally below BG_MEAN (215) so
# Otsu binarization always produces a FULL FILLED CIRCLE (not a crescent).
# The range gives visible 3-D shading (dark shadow → lighter highlight) while
# keeping every dot pixel darker than the paper, ensuring clean binarization.
DOT_DARK    = 30    # shadow side (facing away from light) — deep gray
DOT_BRIGHT  = 172   # highlight side (facing light)       — must be < BG_MEAN

# Shadow ring: contact shadow just outside dot base, up to (SHADOW_DEPTH × 100)%
# darkening at the dot rim, fading to zero at OUTER_FRAC × radius.
SHADOW_DEPTH = 0.22


def render_dot(canvas: np.ndarray, cx: float, cy: float, radius: float) -> None:
    """
    Render one photorealistic embossed Braille dot using Lambertian hemisphere shading.

    Model
    -----
    The dot is a hemi-sphere of radius `radius`.  For each pixel (x,y) inside
    the dot, the surface normal is computed from the spherical dome profile:

        n = normalise( (dx/r, dy/r, sqrt(1 - (dist/r)²) ) )

    Lambertian shading:
        intensity = AMBIENT + DIFFUSE × max(0, n · L)

    where L = (_LX, _LY, _LZ) (normalised directional light).

    Mapping to gray:
        pixel = intensity × BG_MEAN   (clamped to [70, 255])

    This gives:
      • highlight side (n·L ≈ 1):  (0.55+0.65)×215 = 258 → clamped 255 (bright)
      • shadow  side (n·L ≈ 0):    0.55×215 = 118 (dark)
      • hemisphere average (n·L ≈ 0.25): (0.55+0.65×0.25)×215 ≈ 153

    Paper background = 215.  Dot average ≈ 153.  Δ ≈ 62 gray levels → clean Otsu.

    A contact-shadow ring (just outside the dot rim) adds a soft darkening to
    mimic the shadow cast at the base of a real raised dot.
    """
    h, w = canvas.shape
    outer = radius * OUTER_FRAC  # maximum render distance

    y0 = max(0, int(cy - outer - 1))
    y1 = min(h, int(cy + outer + 2))
    x0 = max(0, int(cx - outer - 1))
    x1 = min(w, int(cx + outer + 2))

    # Build coordinate grids (numpy for speed)
    yy = np.arange(y0, y1, dtype=np.float64)
    xx = np.arange(x0, x1, dtype=np.float64)
    XX, YY = np.meshgrid(xx, yy)

    DX   = (XX - cx) / radius          # normalised x offset (in dot-radius units)
    DY   = (YY - cy) / radius
    DIST = np.sqrt(DX ** 2 + DY ** 2)  # normalised distance

    inside      = DIST <= 1.0
    shadow_ring = (DIST > 1.0) & (DIST < OUTER_FRAC)

    # ── Hemisphere shading (inside dot) ────────────────────────────────────
    safe_dist = np.minimum(DIST, 1.0)  # avoid sqrt of negative
    NZ = np.sqrt(np.maximum(0.0, 1.0 - safe_dist ** 2))  # dome Z-normal
    NX = DX  # already normalised by radius; NLen ≈ 1 on dome surface
    NY = DY

    # Normalise the surface normal (NX,NY,NZ)
    NLen = np.sqrt(NX ** 2 + NY ** 2 + NZ ** 2)
    NLen = np.where(NLen < 1e-9, 1.0, NLen)
    NX /= NLen;  NY /= NLen;  NZ /= NLen

    # N·L (Lambertian dot product, clamped to [0,1])
    NdotL = np.maximum(0.0, NX * _LX + NY * _LY + NZ * _LZ)

    # Map NdotL [0,1] → dot gray value [DOT_DARK, DOT_BRIGHT].
    # DOT_BRIGHT < BG_MEAN guarantees ALL dot pixels are darker than paper,
    # so Otsu binarization always produces a clean FULL FILLED CIRCLE —
    # not a crescent — regardless of lighting in real photographs.
    dot_gray  = np.clip(
        DOT_DARK + NdotL * (DOT_BRIGHT - DOT_DARK),
        0, 255
    ).astype(np.int32)

    # ── Contact shadow ring (outside dot rim) ──────────────────────────────
    t_ring      = np.where(shadow_ring, (DIST - 1.0) / (OUTER_FRAC - 1.0), 0.0)
    shadow_fade = np.where(shadow_ring, SHADOW_DEPTH * (1.0 - t_ring) ** 2, 0.0)

    # Blend shadow onto existing canvas values (paper texture already applied)
    region   = canvas[y0:y1, x0:x1].astype(np.float64)
    shadowed = np.clip(region * (1.0 - shadow_fade), 70, 255).astype(np.int32)

    canvas[y0:y1, x0:x1] = np.where(inside, dot_gray,
                                     np.where(shadow_ring, shadowed, canvas[y0:y1, x0:x1]))


def generate_template(char: str, rng=None) -> Image.Image:
    """
    Generate a single 64×96 px photorealistic embossed Braille template.

    Appearance: cream paper with raised hemisphere dots and directional shadows.
    Pipeline:
      1. Fill canvas with cream paper (BG_MEAN ± BG_NOISE grain).
      2. Render each active dot as a 3-D hemisphere (Lambertian shading).
      3. Apply mild 1 px Gaussian blur to simulate shallow camera depth-of-field.

    The resulting image, when binarized with Otsu's threshold, produces a
    perfectly clean binary dot pattern matching real camera cell images.
    """
    if rng is None:
        rng = np.random.default_rng(42 + ord(char))

    pattern = CHAR_DOT_PATTERNS.get(char)
    if pattern is None:
        raise ValueError(f"Unknown character: '{char}'")

    w, h = TEMPLATE_W, TEMPLATE_H
    r = w * DOT_RADIUS_FRAC

    # ── Step 1: cream paper canvas with subtle grain ─────────────────────
    noise   = rng.integers(-BG_NOISE, BG_NOISE + 1, size=(h, w), dtype=np.int32)
    canvas  = np.clip(BG_MEAN + noise, 0, 255).astype(np.int32)

    # ── Step 2: render each active dot ───────────────────────────────────
    for i in range(6):
        if pattern & (1 << i):
            px = DOT_POSITIONS[i][0] * w
            py = DOT_POSITIONS[i][1] * h
            render_dot(canvas, px, py, r)

    canvas = np.clip(canvas, 0, 255).astype(np.uint8)
    img = Image.fromarray(canvas, mode='L')

    # ── Step 3: mild blur — camera depth-of-field simulation ─────────────
    img = img.filter(ImageFilter.GaussianBlur(radius=1.0))

    return img


def main():
    parser = argparse.ArgumentParser(
        description="Generate photorealistic embossed Braille template PNGs."
    )
    parser.add_argument(
        "--preview", action="store_true",
        help="Also save 3× preview images to scripts/debug/."
    )
    parser.add_argument(
        "--chars",
        help="Generate only specific characters (e.g. --chars abcdef123)"
    )
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Determine which characters to generate
    if args.chars:
        chars = list(args.chars.lower())
    else:
        # All 36: a-z then 0-9
        chars = list("abcdefghijklmnopqrstuvwxyz0123456789")

    # Filter to valid characters
    chars = [c for c in chars if c in CHAR_DOT_PATTERNS]
    if not chars:
        print("No valid characters specified.")
        return

    print(f"Generating {len(chars)} photorealistic Braille templates → {OUT_DIR}/")

    for i, char in enumerate(chars):
        # Reproducible but unique grain per character
        rng = np.random.default_rng(42 + ord(char))

        img = generate_template(char, rng=rng)
        out_path = OUT_DIR / f"{char}.png"
        img.save(out_path, "PNG")

        # Pattern info for display
        pattern = CHAR_DOT_PATTERNS[char]
        dots = [j + 1 for j in range(6) if pattern & (1 << j)]
        print(f"  [{i+1:2d}/{len(chars)}] {char} → dots {dots}  ✓ {out_path.name}")

        # Optional preview
        if args.preview:
            preview_dir = REPO_ROOT / "scripts" / "debug"
            preview_dir.mkdir(exist_ok=True)
            preview = img.resize(
                (TEMPLATE_W * 3, TEMPLATE_H * 3), Image.NEAREST
            )
            preview.save(preview_dir / f"template_{char}_preview.png")

    print(f"\nDone. {len(chars)} templates saved to {OUT_DIR.relative_to(REPO_ROOT)}/")

    # Verify completeness
    existing = [
        f.stem for f in OUT_DIR.iterdir()
        if f.suffix == '.png' and f.stem in CHAR_DOT_PATTERNS
    ]
    missing = [c for c in "abcdefghijklmnopqrstuvwxyz0123456789" if c not in existing]
    if missing:
        print(f"  Still missing: {' '.join(missing)}")
    else:
        print("  All 36 templates present — ready for template-OCR matching!")


if __name__ == "__main__":
    main()
