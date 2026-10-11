"""Draws the site logo (a pixel "L" with a sparkle in its open corner) and exports
every icon size the site needs. Run from the repo root:  python tools/logo.py

Outputs (assets/img/icons/): favicon-16.png, favicon-32.png, favicon-48.png,
apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png,
plus favicon.ico at the repo root and assets/img/logo.png (64px, for the page).
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "img" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

PAL = {
    ".": None,
    "n": (22, 18, 58, 255),      # night
    "N": (35, 29, 85, 255),      # night raise (tile bevel)
    "k": (10, 8, 32, 255),       # ink
    "o": (255, 122, 47, 255),    # orange
    "O": (194, 65, 12, 255),     # orange deep
    "h": (255, 170, 120, 255),   # orange highlight
    "y": (255, 210, 63, 255),    # yellow
    "w": (255, 250, 240, 255),   # white
    "t": (31, 181, 163, 255),    # teal
}


def from_rows(rows):
    h, w = len(rows), len(rows[0])
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        assert len(row) == w, (y, len(row))
        for x, ch in enumerate(row):
            if PAL[ch]:
                im.putpixel((x, y), PAL[ch])
    return im


def logo32():
    """32x32 master: notched night tile, orange L with a stepped shadow, sparkle in the corner."""
    g = [["n"] * 32 for _ in range(32)]
    # notched (pixel-rounded) corners
    for (x, y) in [(0, 0), (1, 0), (0, 1), (31, 0), (30, 0), (31, 1), (0, 31), (1, 31), (0, 30), (31, 31), (30, 31), (31, 30)]:
        g[y][x] = "."
    # inner bevel line along the top/left
    for i in range(2, 30):
        g[1][i] = "N"
        g[i][1] = "N"

    def rect(x0, y0, x1, y1, c):
        for yy in range(y0, y1 + 1):
            for xx in range(x0, x1 + 1):
                g[yy][xx] = c

    # stepped shadow (2px down-right): deep orange then ink, like the site's display type
    rect(9, 7, 15, 28, "k"); rect(9, 22, 27, 28, "k")
    rect(8, 6, 14, 27, "O"); rect(8, 21, 26, 27, "O")
    # the L
    rect(7, 5, 13, 26, "o"); rect(7, 20, 25, 26, "o")
    # highlight on the top and left edges
    rect(7, 5, 13, 5, "h"); rect(7, 5, 7, 26, "h"); rect(14, 20, 25, 20, "h")
    # sparkle in the open corner
    cx, cy = 22, 10
    for d in range(-4, 5):
        g[cy][cx + d] = "y"
        g[cy + d][cx] = "y"
    rect(cx - 1, cy - 1, cx + 1, cy + 1, "y")
    g[cy][cx] = "w"
    # tiny teal sparkle for balance
    for (x, y) in [(27, 4), (26, 4), (28, 4), (27, 3), (27, 5)]:
        g[y][x] = "t"
    return from_rows(["".join(r) for r in g])


LOGO16 = [
    ".nnnnnnnnnnnnnn.",
    "nnnnnnnnnnnnnnnn",
    "nnnhoonnnnnynnnn",
    "nnnhooOnnnnynnnn",
    "nnnhooOnnyywyynn",
    "nnnhooOnnnnynnnn",
    "nnnhooOnnnnynnnn",
    "nnnhooOnnnnnnnnn",
    "nnnhooOnnnnnnnnn",
    "nnnhooOnnnnnnnnn",
    "nnnhoohhhhhhhnnn",
    "nnnhoooooooooOnn",
    "nnnhoooooooooOnn",
    "nnnnOOOOOOOOOOnn",
    "nnnnnnnnnnnnnnnn",
    ".nnnnnnnnnnnnnn.",
]


def scaled(im, size):
    """Nearest-neighbour scale to an exact size (only whole-number factors are used)."""
    return im.resize((size, size), Image.NEAREST)


def on_canvas(im, canvas, pad_color=PAL["n"]):
    bg = Image.new("RGBA", (canvas, canvas), pad_color)
    bg.alpha_composite(im, ((canvas - im.width) // 2, (canvas - im.height) // 2))
    return bg


if __name__ == "__main__":
    big = logo32()
    small = from_rows(LOGO16)
    small.resize((16, 16)).save(OUT / "favicon-16.png", optimize=True)
    scaled(big, 32).save(OUT / "favicon-32.png", optimize=True)
    scaled(small, 48).save(OUT / "favicon-48.png", optimize=True)
    on_canvas(scaled(big, 160), 180).convert("RGB").save(OUT / "apple-touch-icon.png", optimize=True)
    scaled(big, 192).save(OUT / "icon-192.png", optimize=True)
    scaled(big, 512).save(OUT / "icon-512.png", optimize=True)
    # maskable: keep the art inside the 80% safe zone on a full-bleed night square
    on_canvas(scaled(big, 384), 512).convert("RGB").save(OUT / "icon-maskable-512.png", optimize=True)
    scaled(big, 64).save(ROOT / "assets" / "img" / "logo.png", optimize=True)
    # one .ico holding the hand-drawn 16px art plus the 32/48 renders (no resampling blur)
    scaled(small, 48).save(ROOT / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)],
                           append_images=[small, scaled(big, 32)])
    print("icons written to", OUT)
