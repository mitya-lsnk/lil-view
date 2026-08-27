"""Repaint the lil icon in another hue. Needs Pillow.

The three apps share one drawing — same fox, same rounded square, same
pictogram — and differ only in ink, so the Dock tells them apart at a glance
while they still read as one family.

Point it at **this app's own** icon, not lil edit's. They share the fox and the
square but not the pictogram, and running it on the wrong source silently
replaces the picture with lil edit's crop marks — which looks like a colour
change until someone opens the Dock.

    iconutil -c iconset src-tauri/icons/icon.icns -o /tmp/lv.iconset
    python tools/recolour-icon.py /tmp/lv.iconset/icon_512x512@2x.png /tmp/out.png 145
    npx tauri icon /tmp/out.png

**Hue rotation in HLS, not a multiply.** The original ink is not one flat
colour: it runs from L 0.77 at the top of the fox to L 0.65 at the bottom, and
that fall is most of what makes the icon look drawn rather than stamped.
Scaling a flat target colour by each pixel's brightness keeps the ratio but not
the feel — a 16% fall from a light lavender reads as a gradient, the same 16%
from a mid-dark green reads as noise, and any pixel lighter than the base
clamps flat. Replacing only the hue, and keeping every pixel's own lightness
and saturation, carries the gradient across untouched.
"""

import colorsys
import sys

from PIL import Image

SRC, OUT, HUE = sys.argv[1], sys.argv[2], float(sys.argv[3])


def inked(r: int, g: int, b: int, a: int) -> bool:
    """The lavender ink, including its soft fringe — never the near-black field.

    A wider test than an exact match on purpose: the strict one misses the
    antialiased edge, and a leftover violet halo around a green fox looks like
    a mistake rather than a choice.
    """
    return a >= 20 and b > r + 4


im = Image.open(SRC).convert("RGBA")
W, H = im.size
px = im.load()
out = im.copy()
op = out.load()

n = 0
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if not inked(r, g, b, a):
            continue
        _, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        nr, ng, nb = colorsys.hls_to_rgb(HUE / 360, l, s)
        op[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
        n += 1

print(f"recoloured {n} px to hue {HUE:.0f}")
out.save(OUT)
