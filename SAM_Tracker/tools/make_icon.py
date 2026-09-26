"""Draw the app icon (assets/icon.ico): a magnifying glass on the app's dark blue.

Run once: python tools/make_icon.py (the .ico is committed, no need at build time).
"""
from pathlib import Path

from PIL import Image, ImageDraw

BLUE = (36, 64, 95)       # --head-bg of the app
ACCENT = (110, 168, 255)  # active tab underline
WHITE = (255, 255, 255)
OUT = Path(__file__).resolve().parent.parent / "assets" / "icon.ico"


def draw(size: int = 512) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size / 512
    d.rounded_rectangle([16 * s, 16 * s, 496 * s, 496 * s], radius=96 * s, fill=BLUE)
    # lens
    d.ellipse([110 * s, 100 * s, 330 * s, 320 * s], outline=WHITE, width=int(34 * s))
    # handle
    d.line([300 * s, 290 * s, 405 * s, 395 * s], fill=WHITE, width=int(52 * s))
    # three "result" lines inside the lens
    for i, width in enumerate((110, 80, 95)):
        y = (175 + i * 36) * s
        d.rounded_rectangle([165 * s, y, (165 + width) * s, y + 16 * s], radius=8 * s, fill=ACCENT)
    return img


if __name__ == "__main__":
    OUT.parent.mkdir(exist_ok=True)
    draw().save(OUT, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    draw().save(OUT.with_suffix(".png"))
    print("written", OUT)
