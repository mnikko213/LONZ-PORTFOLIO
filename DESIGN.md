# LONZ portfolio: design system

The site is a retro game you play through: a night **title screen**, then colour-blocked bands for each "screen" of the game, ending on a **CONTINUE?** screen. Everything below is what the built page actually uses; change the tokens in `css/style.css` rather than hard-coding new values.

## Page map

| Screen | Section id | Band | What it holds |
|---|---|---|---|
| Title screen | `#home` | night | Name, one-line pitch, Press start + Resume, CRT monitor cycling real work |
| Hello strip | (no id) | orange | Short intro + four credential badges |
| Level select | `#work` | paper | ONE UP, The Coffee Realm, JMI2 as framed "windows" |
| Bonus stages | `#archive` | teal | Character select (illustrations) + cartridge shelf (graphics, video, ads, web) |
| Player profile | `#about` | paper | Pixel portrait card, bio, education, hi-score (honors) table |
| Quest log | `#experience` | paper | Timeline of roles with In progress / Complete stamps |
| Inventory | `#skills` | purple | Tabbed skill slots |
| Achievements | `#certifications` | purple | Certificates; each opens in the viewer |
| Select a service | `#services-section` | yellow | Service picker with illustration + Email me |
| Continue? | `#contact` | night | Contact menu, Resume, footer |

Section ids are kept from the old site so existing links still work.

## Colour

Full-palette strategy: each band owns its colour; one ink colour outlines everything.

| Token | Value | Use |
|---|---|---|
| `--night` | `#16123a` | Title + contact screens, HUD, hi-score panel |
| `--paper` / `--paper-hi` | `#f3e7cc` / `#fbf4e3` | Day-theme bands / cards |
| `--ink` | `#1a1530` | Text on light, every outline and pixel shadow |
| `--orange` | `#ff7a2f` | Primary buttons, Hello band, bullets |
| `--teal` | `#1fb5a3` | Bonus band, Cisco achievements, complete pins |
| `--purple` | `#5a3fd1` | Window title bars, Inventory band |
| `--yellow` | `#ffd23f` | Focus on dark, cursors, stickers, Services band |
| `--cream` / `--cream-dim` | `#f6ecd6` / `#c9c2e8` | Text on night |

Night theme (`html[data-theme="night"]`) only swaps the paper bands and cards (`--paper-bg`, `--card-*`); the coloured bands stay. The theme follows `prefers-color-scheme` until the visitor uses the HUD toggle (saved as `lonz-theme`).

Small text on a colour must pass 4.5:1. Orange is never used for text on paper; use `--orange-deep` (`#c2410c`) if orange text is ever needed.

## Type

| Role | Face | Notes |
|---|---|---|
| Display (names, section titles, counters) | Jersey 10 | Uppercase, line-height 0.8 to 0.85, stepped `text-shadow` in a darker tone + ink |
| Poster names + body | Archivo (variable, wdth 62 to 125) | Project names at weight 900, stretch 125%; body 17px / 1.6 |
| HUD chrome (nav, buttons, tags, window bars) | Silkscreen 400/700 | Uppercase, never below 11px, never for paragraphs |

Fonts are self-hosted in `assets/fonts/` (OFL).

## Shape and depth

- One shape language: **pixel-notched frames**. Corners stay empty; outline thickness `--b` (usually 4px), hard pixel shadow offset `--s`. The frame is a `box-shadow` stack in the shared selector list near the top of `style.css`; add new framed components to that list instead of using `border` or `border-radius`.
- No rounded corners, no blur shadows, no gradients on UI.
- Bands meet with a stepped "pixel mountain" edge (`.band::before`).

## Icons and sprites

- Icons: [pixelarticons](https://github.com/halfmage/pixelarticons) (MIT), inlined as data URIs in `css/icons.css`. Use `<span class="i i-NAME" aria-hidden="true"></span>`. To add one, drop its SVG into `assets/icons/` and regenerate `icons.css` (see the header comment).
- Sprites (CRT, starburst, coin, smiley, sparkles, cartridges) are drawn in code by `tools/sprites.py` at 1x and scaled up with `image-rendering: pixelated`. Never scale them by a fraction that blurs pixels.
- The pixel portrait (`assets/img/me-pixel.png`) is the graduation photo quantized to the site palette.

## Motion

- Motion moves in frames: every animation and transition uses `steps()`.
- One title-screen moment (name drops in, monitor powers on), windows "open" as they scroll in, the CRT changes channel with a static flicker, buttons press down by one pixel unit.
- Everything is off under `prefers-reduced-motion` (the reel starts paused, nothing is armed or hidden).
- Sound effects are opt-in (HUD speaker button, saved as `lonz-sfx`).

## Interaction patterns

- **Select screens** (character select, inventory, services) are WAI-ARIA tabs: arrow keys, Home and End.
- **Viewer** is one `<dialog>` for every gallery and certificate; galleries are defined in `GALLERIES` in `js/script.js`. Arrow keys and swipe step through items.
- Contact intent is always labelled **Email me**; the resume is always **Resume**.

## Media

- Images are WebP in `assets/img/`, sized for their slot; `loading="lazy"` below the fold, width/height set to avoid layout shift.
- Cartridge previews are 8-second muted loops in `assets/video/` that play only while on screen; full videos live in `assets/video/full/` and load only in the viewer.
- Everything is referenced with relative paths, because the site is served from `https://mnikko213.github.io/LONZ-PORTFOLIO/`.
