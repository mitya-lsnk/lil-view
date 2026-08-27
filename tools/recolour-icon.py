"""Repaint the lil view icon green. Needs Pillow.

The fox, the rounded square and the pictogram all stay exactly where they are —
only the ink changes, so the three apps still read as one family in the Dock
while telling themselves apart at a glance: lil edit lavender, lil view green,
lil download red.

Recolouring is a **scale, not a hue swap**. Against the near-black background a
pixel is roughly `t · ink`, so solving for `t` and re-multiplying by the new ink
keeps every antialiased edge exactly as soft as it was. A hue rotation would
leave a violet fringe on every curve.

    iconutil -c iconset src-tauri/icons/icon.icns -o /tmp/lv.iconset
    python tools/recolour-icon.py /tmp/lv.iconset/icon_512x512@2x.png /tmp/lilview-1024.png
    npx tauri icon /tmp/lilview-1024.png
"""

import sys
from collections import Counter

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/lv.iconset/icon_512x512@2x.png"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/lilview-1024.png"

# Apple's system green — sibling of the system red lil download already wears,
# so the two look like decisions from the same palette rather than two guesses.
GREEN = (52, 199, 89)

im = Image.open(SRC).convert("RGBA")
W, H = im.size
px = im.load()


def inked(r: int, g: int, b: int, a: int) -> bool:
    """Lavender, including its soft fringe — never the near-black background.

    A wider test than an exact colour match on purpose: the strict one misses
    the antialiased edge, and a leftover violet halo around a green fox looks
    like a mistake rather than a choice.
    """
    return a >= 20 and b > r + 4


peak = max(
    Counter(
        px[x, y][:3] for y in range(H) for x in range(W) if inked(*px[x, y])
    ).most_common(1)[0][0]
)
print("ink peak", peak)

out = im.copy()
op = out.load()
n = 0
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if not inked(r, g, b, a):
            continue
        t = min(1.0, max(r, g, b) / peak)
        op[x, y] = (round(GREEN[0] * t), round(GREEN[1] * t), round(GREEN[2] * t), a)
        n += 1

print("recoloured", n, "px")
out.save(OUT)
print("wrote", OUT)
