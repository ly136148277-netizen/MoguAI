"""Convert square mushroom icon to circular transparent Windows icon."""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "icon.png"
OUT_PNG = ROOT / "assets" / "icon.png"
OUT_PREVIEW = ROOT / "assets" / "icon-256.png"
OUT_ICO = ROOT / "assets" / "icon.ico"
OUT_BUILD_ICO = ROOT / "build" / "app.ico"
SIZES = (256, 128, 64, 48, 32, 16)


def circle_mask(size: int) -> Image.Image:
    # Supersample for smooth anti-aliased circle edge
    scale = 4
    big = size * scale
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    # inset 1px (in final space) so desktop doesn't clip the edge
    inset = scale
    draw.ellipse((inset, inset, big - 1 - inset, big - 1 - inset), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def to_circle(src: Image.Image, size: int) -> Image.Image:
    base = src.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(base, (0, 0), circle_mask(size))
    return out


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    # Keep a backup of the square source once
    bak = ROOT / "assets" / "icon-square.png"
    if not bak.exists():
        src.save(bak)

    master = to_circle(src, 1024)
    master.save(OUT_PNG, optimize=True)
    to_circle(src, 256).save(OUT_PREVIEW, optimize=True)

    ico_images = [to_circle(src, s) for s in SIZES]
    # Pillow writes multi-size ICO from the largest + appends
    ico_images[0].save(
        OUT_ICO,
        format="ICO",
        sizes=[(s, s) for s in SIZES],
        append_images=ico_images[1:],
    )
    OUT_BUILD_ICO.write_bytes(OUT_ICO.read_bytes())

    # Sanity: corners must be fully transparent
    px = master.getpixel((0, 0))
    cx = master.getpixel((512, 512))
    print(f"corner={px} center_a={cx[3]} wrote={OUT_PNG} {OUT_ICO}")


if __name__ == "__main__":
    main()
