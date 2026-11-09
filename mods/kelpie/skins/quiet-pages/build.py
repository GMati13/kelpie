#!/usr/bin/env python3
"""Quiet Pages art (needs pillow): the amber lamp pools of the hour.

Writes into art/ beside this file; the Kelpie footer copies art/ to ~/.config/herdr-app/art/kelpie/skins/quiet-pages/
at Herdr's start. Herdr caches images by path: bump VERSION after changing anything, and the skin's
VERSION in skins/quiet-pages.js to match.

  lamp-<step>-<v>.png    an elliptical pool of lamp light, transparent at its edge (drawn 1500x640)
  check-<v>.svg          the done mark (tinted by the view)
"""
import math
import random
from pathlib import Path

from PIL import Image

VERSION = 2
ART = Path(__file__).resolve().parent / "art"

# Lamp: colour and peak opacity per step. By day a soft warm pool, after dark it glows (the peak
# keeps text over its centre at 9.5:1 or better, muted text above 6:1).
LAMPS = {
    "dawn": ("#e8a070", 0.075),
    "day": ("#f2c88c", 0.065),
    "afternoon": ("#f0bc7c", 0.075),
    "dusk": ("#e08a5a", 0.095),
    "night": ("#f2b46c", 0.11),
    "late": ("#c08a5a", 0.085),
}


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lamp(name, colour, peak, w=750, h=320):
    """Elliptical radial falloff: peak at the centre, a third of it at 55%, nothing by 85%. Dithered so
    the low alpha doesn't band."""
    r, g, b = rgb(colour)
    img = Image.new("RGBA", (w, h))
    px = img.load()
    rnd = random.Random(7)
    for y in range(h):
        for x in range(w):
            d = math.hypot((x + 0.5 - w / 2) / (w / 2), (y + 0.5 - h / 2) / (h / 2))
            if d >= 0.85:
                a = 0.0
            elif d <= 0.55:
                a = peak * (1 - (1 - 0.32) * (d / 0.55) ** 1.4)
            else:
                f = (d - 0.55) / 0.30
                a = peak * 0.32 * (1 - f) ** 2
            v = a * 255 + rnd.random() - 0.5
            px[x, y] = (r, g, b, max(0, min(255, round(v))))
    img.save(ART / f"lamp-{name}-{VERSION}.png", optimize=True)


def main():
    ART.mkdir(exist_ok=True)
    for name, (colour, peak) in LAMPS.items():
        lamp(name, colour, peak)
    (ART / f"check-{VERSION}.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><path d="M4.5 9.5l3 2.9L13.8 5.8" fill="none" '
        'stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>\n')


if __name__ == "__main__":
    main()
