"""Draws the site's pixel-art sprites at 1x and saves them to assets/img/sprites/.

The PNGs are tiny on purpose: the page scales them up with `image-rendering: pixelated`.
Run from the repo root:  python tools/sprites.py
"""
from pathlib import Path
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "assets" / "img" / "sprites"
OUT.mkdir(parents=True, exist_ok=True)

C = {
    ".": None,
    "k": "#1a1530",  # ink outline
    "K": "#2e2752",  # soft ink
    "w": "#fffaf0",  # highlight
    "b": "#efe3c6",  # beige body
    "B": "#d8c7a0",  # beige shade
    "d": "#b4a27c",  # beige deep
    "s": "#3b3550",  # bezel
    "S": "#26203d",  # bezel deep
    "g": "#36d27a",  # led green
    "o": "#ff7a2f",  # orange
    "O": "#c2410c",  # orange deep
    "t": "#1fb5a3",  # teal
    "T": "#0b6e64",  # teal deep
    "p": "#5a3fd1",  # purple
    "P": "#3a2896",  # purple deep
    "y": "#ffd23f",  # yellow
    "Y": "#d99a00",  # yellow deep
    "r": "#ff5c7a",  # cheek pink
    "f": "#eaa06f",  # skin (the tone of the pixel portrait)
    "F": "#c06a45",  # skin shade
    "c": "#f6ecd6",  # cream
    "C": "#c9c2e8",  # cream dim
    "v": "#7b61ff",  # purple hi
    "n": "#16123a",  # night
    "N": "#231d55",  # night raise
}


def rgba(key):
    v = C[key]
    if v is None:
        return (0, 0, 0, 0)
    v = v.lstrip("#")
    return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


class Canvas:
    def __init__(self, w, h):
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.px = self.im.load()
        self.w, self.h = w, h

    def dot(self, x, y, k):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = rgba(k)

    def rect(self, x, y, w, h, k):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.dot(xx, yy, k)

    def clear(self, x, y, w, h):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                if 0 <= xx < self.w and 0 <= yy < self.h:
                    self.px[xx, yy] = (0, 0, 0, 0)

    def box(self, x, y, w, h, fill, line="k", notch=True):
        """Filled box with a 1px outline and pixel-notched corners."""
        self.rect(x + 1, y, w - 2, 1, line)
        self.rect(x + 1, y + h - 1, w - 2, 1, line)
        self.rect(x, y + 1, 1, h - 2, line)
        self.rect(x + w - 1, y + 1, 1, h - 2, line)
        self.rect(x + 1, y + 1, w - 2, h - 2, fill)
        if not notch:
            for cx, cy in ((x, y), (x + w - 1, y), (x, y + h - 1), (x + w - 1, y + h - 1)):
                self.dot(cx, cy, line)

    def save(self, name):
        self.im.save(OUT / name, optimize=True)
        return self.im.size


def from_map(rows):
    h, w = len(rows), max(len(r) for r in rows)
    cv = Canvas(w, h)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                cv.dot(x, y, ch)
    return cv


# --- CRT computer --------------------------------------------------------
# 128 x 112. The screen hole is left transparent: x 25..102, y 14..60 (78 x 47).
def crt():
    cv = Canvas(128, 112)
    # monitor shell
    cv.box(14, 4, 100, 74, "b")
    cv.rect(15, 5, 98, 2, "w")           # top highlight
    cv.rect(15, 5, 2, 71, "w")           # left highlight
    cv.rect(110, 7, 3, 70, "B")          # right shade
    cv.rect(17, 74, 93, 3, "B")          # bottom shade
    # bezel
    cv.box(21, 10, 86, 55, "s", line="d")
    cv.rect(22, 11, 84, 2, "S")
    cv.rect(22, 11, 2, 53, "S")
    cv.clear(25, 14, 78, 47)             # screen hole
    # chin: vents, badge, led, knobs
    for i in range(6):
        cv.rect(24 + i * 4, 68, 2, 5, "d")
    cv.rect(56, 68, 16, 4, "B")
    cv.rect(57, 69, 14, 2, "d")
    cv.rect(92, 69, 3, 3, "k")
    cv.dot(93, 70, "g")
    cv.rect(99, 68, 6, 6, "B")
    cv.rect(100, 69, 4, 4, "d")
    # neck + foot
    cv.rect(50, 78, 28, 4, "k")
    cv.rect(51, 78, 26, 3, "B")
    cv.box(40, 81, 48, 6, "b")
    cv.rect(41, 85, 46, 1, "B")
    # keyboard
    cv.box(10, 92, 108, 18, "b")
    cv.rect(11, 93, 106, 1, "w")
    cv.rect(11, 107, 106, 2, "B")
    for row in range(3):
        y = 95 + row * 4
        off = row * 2
        for col in range(16):
            x = 15 + off + col * 6
            if x + 4 > 112:
                break
            cv.rect(x, y, 4, 3, "w")
            cv.rect(x, y + 2, 4, 1, "B")
    cv.rect(35, 107, 50, 1, "d")  # space bar shadow line
    # cable
    for i, (x, y) in enumerate([(114, 40), (115, 41), (116, 42), (117, 44), (118, 47), (119, 51), (120, 56), (120, 62),
                                (121, 68), (121, 74), (122, 80), (122, 86), (121, 90)]):
        cv.dot(x, y, "k")
        cv.dot(x + 1, y, "K")
    return cv.save("crt.png")


# --- jagged starburst ----------------------------------------------------
def burst(name, fill, edge, size=96, spikes=14):
    import math
    cv = Canvas(size, size)
    cx = cy = (size - 1) / 2
    r_out, r_in = size / 2 - 1, size / 2 * 0.62
    pts = []
    for i in range(spikes * 2):
        a = math.pi * i / spikes - math.pi / 2
        r = r_out if i % 2 == 0 else r_in
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))

    def inside(x, y):
        n, c = len(pts), False
        j = n - 1
        for i in range(n):
            xi, yi = pts[i]
            xj, yj = pts[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi:
                c = not c
            j = i
        return c

    grid = [[inside(x + 0.5, y + 0.5) for x in range(size)] for y in range(size)]
    for y in range(size):
        for x in range(size):
            if grid[y][x]:
                edge_px = any(not (0 <= x + dx < size and 0 <= y + dy < size and grid[y + dy][x + dx])
                              for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                cv.dot(x, y, edge if edge_px else fill)
    # 2x2 halftone dots over the lower right like the reference print texture
    for y in range(size // 2, size, 4):
        for x in range(size // 2, size, 4):
            if grid[y][x] and (x + y) % 8 == 0:
                cv.dot(x, y, edge)
    return cv.save(name)


SPARKLE = [
    "...y...",
    "...y...",
    "..yyy..",
    "yyywyyy",
    "..yyy..",
    "...y...",
    "...y...",
]

SPARKLE_SM = [
    "..y..",
    "..y..",
    "yywyy",
    "..y..",
    "..y..",
]

# 4-frame spinning coin, 12 x 14 each
COIN = [
    [
        "...kkkkkk...",
        "..kyyyyyyk..",
        ".kyywwyyyYk.",
        "kyywyyyyyyYk",
        "kywyyYYyyyYk",
        "kyyyYyyyyyYk",
        "kyyyYyyyyyYk",
        "kyyyYyyyyyYk",
        "kyyyYyyyyyYk",
        "kyyyyYYyyyYk",
        "kyyyyyyyyyYk",
        ".kyyyyyyyYk.",
        "..kYYYYYYk..",
        "...kkkkkk...",
    ],
    [
        "....kkkk....",
        "...kyyyyk...",
        "..kywyyyYk..",
        "..kwyyyyYk..",
        "..kyyYyyYk..",
        "..kyyYyyYk..",
        "..kyyYyyYk..",
        "..kyyYyyYk..",
        "..kyyYyyYk..",
        "..kyyYyyYk..",
        "..kyyyyyYk..",
        "..kyyyyyYk..",
        "...kYYYYk...",
        "....kkkk....",
    ],
    [
        ".....kk.....",
        "....kyYk....",
        "....kwYk....",
        "....kyYk....",
        "....kyYk....",
        "....kyYk....",
        "....kyYk....",
        "....kyYk....",
        "....kyYk....",
        "....kyYk....",
        "....kyYk....",
        "....kyYk....",
        "....kyYk....",
        ".....kk.....",
    ],
]
COIN.append(COIN[1])


def sheet(frames, name):
    fw, fh = len(frames[0][0]), len(frames[0])
    cv = Canvas(fw * len(frames), fh)
    for i, f in enumerate(frames):
        for y, row in enumerate(f):
            for x, ch in enumerate(row):
                if ch != ".":
                    cv.dot(i * fw + x, y, ch)
    return cv.save(name)


# --- LONZ RUN (js/game.js) and the header progress track ------------------
# The engineer, facing right. Six frames of 12 x 14: 0-3 run cycle, 4 idle, 5 jump.
# Strides (0, 2) sit one pixel higher than the passing frames (1, 3), which gives
# the bob. The near leg carries a teal highlight and a cream shoe, the far leg is
# plain deep teal with a dimmer shoe, so the four run frames really alternate.
# Every fill reads without the ink outline, because on the night HUD ink disappears.
RUNNER = [
    [   # 0 stride: near leg reaches forward, near arm back
        "....kkkkk...",
        "...kPppPPk..",
        "...kPPfffk..",
        "...kPffkfk..",
        "....kFfffk..",
        "..kkooookFk.",
        ".kfOooooOk..",
        "..kkooook...",
        "...kTTTtk...",
        ".kkkTkTTtk..",
        "kCTTk.kkTtk.",
        ".kkk...kTtk.",
        ".......kccck",
        "........kkk.",
    ],
    [   # 1 passing: near leg planted, far knee forward
        "............",
        "....kkkkk...",
        "...kPppPPk..",
        "...kPPfffk..",
        "...kPffkfk..",
        "....kFfffk..",
        "...kooook...",
        "...koOook...",
        "...koofok...",
        "...kTTtTk...",
        "...kTtkTTk..",
        "...kTtkkCk..",
        "...kccckk...",
        "...kkkkk....",
    ],
    [   # 2 stride: far leg reaches forward, near arm forward
        "....kkkkk...",
        "...kPppPPk..",
        "...kPPfffk..",
        "...kPffkfk..",
        "....kFfffk..",
        "..kkooookfk.",
        ".kFOooooOk..",
        "..kkooook...",
        "...kTtTTk...",
        ".kkkTkTTTk..",
        "kcTTk.kkTTk.",
        ".kkk...kTTk.",
        ".......kCCCk",
        "........kkk.",
    ],
    [   # 3 passing: far leg planted, near knee forward
        "............",
        "....kkkkk...",
        "...kPppPPk..",
        "...kPPfffk..",
        "...kPffkfk..",
        "....kFfffk..",
        "...kooook...",
        "...kooOok...",
        "...kofook...",
        "...kTTTtk...",
        "...kTTkTtk..",
        "...kTTkkck..",
        "...kCCCkk...",
        "...kkkkk....",
    ],
    [   # 4 idle
        "............",
        "....kkkkk...",
        "...kPppPPk..",
        "...kPPfffk..",
        "...kPffkfk..",
        "....kFfffk..",
        "...kooook...",
        "...koOook...",
        "...kofook...",
        "...kTTTtk...",
        "...kTTkTtk..",
        "...kTTkTtk..",
        "...kCCkccck.",
        "...kkkkkkk..",
    ],
    [   # 5 jump: near arm up, legs tucked
        "....kkkkk...",
        "...kPppPPkk.",
        "...kPPfffkfk",
        "...kPffkfkOk",
        "....kFfffkOk",
        "..kkooooook.",
        ".kFOooookk..",
        "..kkooook...",
        "...kTTTtk...",
        ".kkkTkTTtk..",
        "kCTTk.kkTtk.",
        ".kkk...kccck",
        "........kkk.",
        "............",
    ],
]

# The obstacle, a "software bug": a purple beetle facing the runner. Two frames of
# 12 x 10; the antenna and the feet swap sides between them, which is the wiggle.
BUG = [
    [
        ".v..........",
        "..v..kkkkk..",
        "..v.kvvpPpk.",
        ".kkkvvppPppk",
        "kppkvpppPppk",
        "kcpkppppPpPk",
        "kPPkpppPPPPk",
        ".kkpkkpkkpk.",
        "...p..p..p..",
        "..p..p..p...",
    ],
    [
        "...v........",
        "...v.kkkkk..",
        "..v.kvvpPpk.",
        ".kkkvvppPppk",
        "kppkvpppPppk",
        "kcpkppppPpPk",
        "kPPkpppPPPPk",
        ".kkpkkpkkpk.",
        "...p..p..p..",
        "....p..p..p.",
    ],
]

# Goal flag, 10 x 14: yellow pennant on an ink pole. The pole has a pale core so it
# does not vanish on the night HUD.
FLAG = [
    "..k.......",
    ".kCkkkkkk.",
    ".kCkyyyyyk",
    ".kCkyyyyk.",
    ".kCkyyyk..",
    ".kCkyyyYk.",
    ".kCkYYYYYk",
    ".kCkkkkkk.",
    ".kCk......",
    ".kCk......",
    ".kCk......",
    ".kCk......",
    "kCCCk.....",
    "kkkkk.....",
]


def runner():
    """runner.png, 72 x 14: six 12 x 14 frames (0-3 run cycle, 4 idle, 5 jump)."""
    return sheet(RUNNER, "runner.png")


def bug():
    """bug.png, 24 x 10: two 12 x 10 wiggle frames."""
    return sheet(BUG, "bug.png")


def flag():
    """flag.png, 10 x 14 (the pole is at x 1..3, the pennant flies to the right)."""
    return from_map(FLAG).save("flag.png")


# --- label of the bonus game cartridge (LONZ RUN) --------------------------
# 44 x 28, shown at 5x on the cartridge: the runner, a bug and a coin over the night skyline.
PAK_RUN = [
    "nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn",
    "nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn",
    "nnnnnnnnnnnnnnnnnnnnnncnnnnnnnnnnnnnnnnnnnnn",
    "nnnncnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnncnnn",
    "nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnyyyknnn",
    "nnnnnnnnnnnnkkkkknnnnnnnnnnnnncnnnnnywyyyknn",
    "nnnnnnnnnnnkPppPPkknnnnnnnnnnnnnnnnnyyyyyknn",
    "nnnnnnnnnnnkPPfffkfknnnnnnnnnnnnnnnnyyyyyknn",
    "nnnnnnnnnnnkPffkfkOknnnnnnnnnnnnnnnnyyYyyknn",
    "nnnnnnnnnnnnkFfffkOknnnnnnnnnnnnnnnnkyyyYnnn",
    "nnnnnnnnnnkkooooooknnnnnnnnnnnnnnnnnnkkknnnn",
    "nnnnnnnnnkFOooookkNNNNNnnnnnnnnnnnnnnnnnnnnn",
    "nnnnnnnnnnkkooookNNNNNNnnnnnvnnnnNNNNNNNNNnn",
    "NNNNNNNnnnnkTTTtkNNNNNNnnnnnnvnnkkkkkNNNNNnn",
    "NNNNNNNnnkkkTkTTtkNNNNNnnnnnnvnkvvpPpkNNNNnn",
    "NNNNNNNnkCTTknkkTtkNNNNnnnNNkkkvvppPppkNNNnn",
    "NNNNNNNnNkkkNnnkccckNNNnnnNkppkvpppPppkNNNnn",
    "NNNNNNNnNNNNNnnNkkkNNNNnnnNkcpkppppPpPkNNNnn",
    "NNNNNNNnNNNNNnnNNNNNNNNnnnNkPPkpppPPPPkNNNnn",
    "NNNNNNNnNNNNNnnNNNNNNNNnnnNNkkpkkpkkpkNNNNnn",
    "NNNNNNNnNNNNNnnNNNNNNNNnnnNNNNpNnpNNpNNNNNnn",
    "NNNNNNNnNNNNNnnNNNNNNNNnnnNNNpNNpNNpNNNNNNnn",
    "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
    "vvvvPPPPvvvvPPPPvvvvPPPPvvvvPPPPvvvvPPPPvvvv",
    "PPPPppppPPPPppppPPPPppppPPPPppppPPPPppppPPPP",
    "PPPPppppPPPPppppPPPPppppPPPPppppPPPPppppPPPP",
    "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
    "PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP",
]


def pak_run():
    """pak-run.png, 44 x 28: the picture on the LONZ RUN cartridge."""
    return from_map(PAK_RUN).save("pak-run.png")


if __name__ == "__main__":
    print("crt", crt())
    print("burst", burst("burst.png", "p", "P"))
    print("sparkle", from_map(SPARKLE).save("sparkle.png"))
    print("sparkle-sm", from_map(SPARKLE_SM).save("sparkle-sm.png"))
    print("coin", sheet(COIN, "coin.png"))
    print("runner", runner())
    print("bug", bug())
    print("flag", flag())
    print("pak-run", pak_run())
