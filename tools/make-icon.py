"""Build the lil view icon from the lil image one. Needs Pillow.

Same black rounded square, same fox, same lavender — only the pictogram beside
the fox changes: lil image's crop marks become a schematic picture (frame, sun,
mountains), because that is what this app is for. Keeping the fox pixel-exact
matters more than redrawing it: the two apps have to read as one family.

The crop marks are removed by inpainting horizontally from the surrounding
background, which is a smooth near-black gradient, so no seam is visible.
"""
from collections import deque

from PIL import Image, ImageDraw

# The 1024px slice of lil image's icns — the largest clean source there is:
#   iconutil -c iconset ../im-mage/src-tauri/icons/icon.icns -o /tmp/lilimage.iconset
SRC = "/tmp/lilimage.iconset/icon_512x512@2x.png"
OUT = "/tmp/lilview-icon-1024.png"  # then: npx tauri icon /tmp/lilview-icon-1024.png

im = Image.open(SRC).convert("RGBA")
W, H = im.size
px = im.load()


def lavender(x, y):
    r, g, b, a = px[x, y]
    return a > 100 and b > 120 and b > r + 8 and r > 90


# --- find the pictogram: the lavender blob that isn't the fox -----------------
seen = [[False] * W for _ in range(H)]
comps = []
for y in range(H):
    for x in range(W):
        if lavender(x, y) and not seen[y][x]:
            q = deque([(x, y)])
            seen[y][x] = True
            pts = []
            while q:
                cx, cy = q.popleft()
                pts.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx] and lavender(nx, ny):
                        seen[ny][nx] = True
                        q.append((nx, ny))
            comps.append(pts)
comps.sort(key=len, reverse=True)
fox, glyph = comps[0], comps[1]
gx0 = min(p[0] for p in glyph); gx1 = max(p[0] for p in glyph)
gy0 = min(p[1] for p in glyph); gy1 = max(p[1] for p in glyph)
print(f"fox {len(fox)}px, pictogram {len(glyph)}px bbox {gx0},{gy0}-{gx1},{gy1}")

# The pictogram is flat-coloured; take its most common pixel as the ink.
from collections import Counter
ink = Counter(px[x, y] for x, y in glyph).most_common(1)[0][0]
print("ink", ink)

# --- erase it -----------------------------------------------------------------
# Dilate so the antialiased fringe and the soft shadow go too.
PAD = 12
mask = [[False] * W for _ in range(H)]
for x, y in glyph:
    for dy in range(-PAD, PAD + 1):
        for dx in range(-PAD, PAD + 1):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H:
                mask[ny][nx] = True

# Never touch the fox, whatever the dilation covered.
for x, y in fox:
    mask[y][x] = False

out = im.copy()
op = out.load()
for y in range(max(0, gy0 - PAD), min(H, gy1 + PAD + 1)):
    row = mask[y]
    x = max(0, gx0 - PAD)
    end = min(W, gx1 + PAD + 1)
    while x < end:
        if not row[x]:
            x += 1
            continue
        run_start = x
        while x < W and row[x]:
            x += 1
        run_end = x - 1
        # Blend between the background either side of the run.
        left = px[max(0, run_start - 1), y]
        right = px[min(W - 1, run_end + 1), y]
        span = run_end - run_start + 1
        for i in range(span):
            t = (i + 1) / (span + 1)
            op[run_start + i, y] = tuple(
                round(left[c] * (1 - t) + right[c] * t) for c in range(4)
            )

# --- draw the new pictogram ---------------------------------------------------
# Box matched to the old one so the composition is unchanged.
BOX = 300
OX, OY = 588, 192
S = 4  # supersample, then downscale for clean edges
layer = Image.new("RGBA", (BOX * S, BOX * S), (0, 0, 0, 0))
d = ImageDraw.Draw(layer)

STROKE = 40
frame = (6, 6, 294, 294)
d.rounded_rectangle(
    [c * S for c in frame], radius=24 * S, outline=ink, width=STROKE * S
)

# Sun and mountains go on their own layer and are clipped to the frame's
# opening, so nothing spills across the border.
inner = Image.new("RGBA", (BOX * S, BOX * S), (0, 0, 0, 0))
di = ImageDraw.Draw(inner)
di.ellipse([(94 - 26) * S, (96 - 26) * S, (94 + 26) * S, (96 + 26) * S], fill=ink)
di.polygon([(176 * S, 130 * S), (300 * S, 254 * S), (28 * S, 254 * S)], fill=ink)
di.polygon([(108 * S, 184 * S), (200 * S, 254 * S), (20 * S, 254 * S)], fill=ink)

# Square corners: a rounded clip left visible notches where the mountains meet
# the frame at the bottom.
clip = Image.new("L", (BOX * S, BOX * S), 0)
ImageDraw.Draw(clip).rounded_rectangle(
    [(6 + STROKE) * S, (6 + STROKE) * S, (294 - STROKE) * S, (294 - STROKE) * S],
    radius=0,
    fill=255,
)
inner.putalpha(Image.composite(inner.getchannel("A"), Image.new("L", clip.size, 0), clip))
layer = Image.alpha_composite(layer, inner)

layer = layer.resize((BOX, BOX), Image.LANCZOS)
out.alpha_composite(layer, (OX, OY))
out.save(OUT)
print("wrote", OUT, out.size)
