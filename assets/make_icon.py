"""Draws the Wellsprings app icon (Murmur's sigil) and writes every size Tauri needs.

    python assets/make_icon.py

Needs Pillow. Output: assets/app-icon.png (1024px) and src-tauri/icons/*.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
S = 2048  # draw big, scale down for smooth edges
BG, ROSE, PHOS, GOLD = (7, 8, 11, 255), (255, 138, 223, 255), (157, 255, 138, 255), (255, 215, 138, 255)


def draw() -> Image.Image:
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad = S * 0.04
    d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=S * 0.2, fill=BG)
    c = S / 2
    def ring(r, w, col):
        d.ellipse([c - r, c - r, c + r, c + r], outline=col, width=int(w))
    ring(S * 0.40, S * 0.022, ROSE)
    ring(S * 0.33, S * 0.010, (255, 138, 223, 140))
    import math
    w = int(S * 0.026)
    # a nine-pointed star {9/4} for 9990, with a gold droplet (the wellspring) in the middle
    R = S * 0.30
    pts = [(c + R * math.sin(2 * math.pi * k / 9), c - R * math.cos(2 * math.pi * k / 9)) for k in range(9)]
    order = [pts[(i * 4) % 9] for i in range(10)]
    d.line(order, fill=PHOS, width=w, joint='curve')
    for (x, y) in pts:
        rr = S * 0.022
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=GOLD)
    # droplet: a circle with a point on top
    r = S * 0.085
    cy = c + S * 0.03
    d.ellipse([c - r, cy - r, c + r, cy + r], fill=GOLD)
    d.polygon([(c - r * 0.82, cy - r * 0.55), (c + r * 0.82, cy - r * 0.55), (c, cy - r * 2.1)], fill=GOLD)
    return im


def main():
    big = draw()
    (ROOT / 'assets').mkdir(exist_ok=True)
    icons = ROOT / 'src-tauri' / 'icons'
    icons.mkdir(parents=True, exist_ok=True)
    big.resize((1024, 1024), Image.LANCZOS).save(ROOT / 'assets' / 'app-icon.png')
    for name, size in [('32x32.png', 32), ('128x128.png', 128), ('128x128@2x.png', 256), ('icon.png', 512)]:
        big.resize((size, size), Image.LANCZOS).save(icons / name)
    big.resize((256, 256), Image.LANCZOS).save(icons / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('icons written to', icons)


if __name__ == '__main__':
    main()
