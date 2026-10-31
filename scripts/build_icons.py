"""App icons for the PWA: a white ballot tick on the site's blue (--accent, #1d4ed8), the same mark as
the inline favicon. An original design; no party logos or other imagery.

Writes site/icons/: icon-192.png and icon-512.png (rounded square, "any"), icon-maskable-512.png
(full bleed, tick inside the 80% safe zone) and apple-touch-icon.png (180px, full bleed; iOS rounds it).

Run by hand after changing the design: python scripts/build_icons.py   (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "site" / "icons"
BLUE = (29, 78, 216, 255)      # --accent
WHITE = (255, 255, 255, 255)
SS = 4                         # supersampling for smooth edges


def tick(draw, size, scale):
    """The favicon's tick (path M8 17 l5 5 11-12 on a 32 grid), scaled about the centre."""
    pts = [(8, 17), (13, 22), (24, 10)]
    c = 16
    pts = [((x - c) * scale + c, (y - c) * scale + c) for x, y in pts]
    pts = [(x * size / 32, y * size / 32) for x, y in pts]
    w = round(3.5 * scale * size / 32)
    draw.line(pts, fill=WHITE, width=w, joint="curve")
    r = w / 2
    for x, y in (pts[0], pts[-1]):   # round caps
        draw.ellipse([x - r, y - r, x + r, y + r], fill=WHITE)


def icon(size, rounded, scale):
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=round(big * 7 / 32), fill=BLUE)
    else:
        d.rectangle([0, 0, big, big], fill=BLUE)
    tick(d, big, scale)
    return img.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    icon(192, True, 1.0).save(OUT / "icon-192.png", optimize=True)
    icon(512, True, 1.0).save(OUT / "icon-512.png", optimize=True)
    icon(512, False, 0.72).save(OUT / "icon-maskable-512.png", optimize=True)   # tick well inside the safe zone
    icon(180, False, 0.85).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    for p in sorted(OUT.glob("*.png")):
        print(p.relative_to(OUT.parent.parent), f"{p.stat().st_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
