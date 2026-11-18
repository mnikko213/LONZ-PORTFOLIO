# LONZ portfolio: design system

The site is a retro game the visitor plays through: a **title screen** with a menu, numbered **stages**, an **arcade** with a handheld console that plays video cartridges, and a **CONTINUE?** screen at the end. Everything below describes what the built page actually uses. Change the tokens in `css/style.css` rather than hard-coding new values.

Two rules sit above the rest:

1. **The game carries the facts, it never hides them.** Every game label is paired with its plain word (the Inventory lede starts "Skills:", the pause menu reads "Quest log ... Experience"). Nothing a client or an employer needs is locked behind play.
2. **Nothing is invented.** No made-up numbers, prices, client names, quotes or claims. The ONE UP client is not named and that project's site and code are not linked. The Cisco entries are course completions.

## Page map

| Stage | Section id | Ground | What it holds |
|---|---|---|---|
| 1. Title screen | `#home` | night + grid | Name, one-line pitch, title menu (I need something made / I'm hiring for a role / Sound), CRT monitor cycling real work |
| (intro) | `#intro` | night-deep | RPG text box that types one line, and a Status window (freelance, full-time, live work, courses, honors) |
| 2. Level select | `#work` | paper | Stage tiles 1-1, 1-2, 1-3, then one window per client project |
| 3. Arcade | `#archive` (`#videos`, `#gallery`, `#characters`) | night-deep + grid, dark in both themes | LONZ BOY console and cartridge shelf, poster wall, character select |
| 4. Select a service | `#services-section` | purple | Shop list with examples per service, then "How to start" |
| 5. Player profile | `#about` | paper | Portrait card, bio, resume buttons, education, hi-scores (honors) |
| 6. Quest log | `#experience` | paper | Timeline of roles with In progress / Complete stamps |
| 7. Inventory | `#skills` | purple | One sheet of seven bags; every skill visible, tagged with the level it was used in |
| 8. Achievements | `#certifications` | purple | Certificates; each opens in the viewer |
| 9. Continue? | `#contact` | night | Countdown, narrator, project brief form, direct contact list |
| Pause menu | `dialog#pause` | card | Stage map, side quests, options |

Section ids are kept from the old site so existing links still work.

## Colour

Each colour has one job.

| Token | Value | Job |
|---|---|---|
| `--night` / `--night-deep` | `#16123a` / `#0d0a26` | The dark grounds: title, intro, arcade, contact, HUD |
| `--paper` / `--paper-hi` | `#f3e7cc` / `#fbf4e3` | Day-palette bands and cards |
| `--ink` | `#1a1530` | Text on light; outlines and pixel shadows in the day palette |
| `--purple` / `--purple-hi` / `--purple-deep` | `#5a3fd1` / `#7b61ff` / `#3a2896` | The system colour: window bars, the shop and inventory bands, level tags, lit outlines on dark |
| `--orange` | `#ff7a2f` | The primary action: "Hire me" in the HUD plus at most one more orange button in a section. Also the first name on the title |
| `--yellow` | `#ffd23f` | The player: cursor, selected row, coins, focus ring on dark, and the game's own voice (CONTINUE?, HELLO!) |
| `--teal` / `--teal-deep` | `#1fb5a3` / `#0b6e64` | Done and safe: Complete stamps, ticked quests, visited stages, the B keycap |
| `--led` | `#36d27a` | Live: the status lamp and the debug readout |
| `--cream` / `--cream-dim` | `#f6ecd6` / `#c9c2e8` | Text on dark |

Night is the default palette (`data-theme="night"`); the day palette is an option in the pause menu, saved as `lonz-theme`. The palette only swaps the paper bands and cards (`--paper-bg`, `--card-*`, `--line`, `--shadow`); the night, arcade and purple grounds stay.

Small text on a colour must pass 4.5:1. Orange is never used for text on paper; use `--orange-deep` (`#c2410c`) if orange text is ever needed.

## Type

| Role | Face | Rules |
|---|---|---|
| Display: names, stage titles, counters | Jersey 10 | Uppercase, line-height 0.8 to 0.9. Sizes are whole pixel multiples of `28px / 3` so the pixels stay square (`font-size: round(down, clamp(...), 28px / 3)`) |
| Real names of real things, and all reading text | Archivo (variable, wdth 62 to 125) | Project names at weight 850 to 900, stretch 112 to 125%; body 17px / 1.6 |
| HUD and metadata: nav, buttons, tags, window bars | Silkscreen 400 | Uppercase, **12px or 16px only**, never bold, never for sentences |

Fonts are self-hosted in `assets/fonts/` (OFL).

## Shape and depth

- One shape language: **pixel-notched frames**. Corners stay empty; outline thickness `--b` (4px), hard pixel shadow offset `--s` (0, 4 or 8px). The frame is a `box-shadow` stack in the shared selector list near the top of `style.css`; add new framed components to that list instead of using `border` or `border-radius`.
- Dense lists (inventory slots) are flat inset tiles with no frame, so 49 of them stay calm.
- No rounded corners, no blur shadows, no gradients on UI.
- Bands meet with a stepped "pixel mountain" edge (`.band::before`).

## Selection: one cursor

Every select screen uses the same grammar: a yellow pixel arrow (drawn once with `clip-path`) plus yellow text or an inverted row. It marks the current nav word, the title menu, the narrator's choices, the shop list, the contact list and the stage map. When nothing is hovered or focused, the cursor rests on the first choice.

## Game systems

- **HUD**: brand, nav words (or the stage readout `3/9 Videos and design` where they do not fit), coin counter, Hire me, menu. A runner sprite jogs along the progress bar as the page scrolls.
- **Pause menu** (`dialog#pause`, the menu button or the coin counter): stage map with visited stages ticked, side quests, options (night palette, sound effects, animations, debug stats). `B` closes it, like every dialog.
- **Side quests and coins** belong to the visitor: one coin for each thing they try (open a level, play a cartridge, flip the portrait). Saved in `localStorage` only. Five coins unlock the bonus game cartridge.
- **Debug stats**: an options switch, or the cheat code (up up down down left right left right B A), shows requests, page weight, requests to other sites, largest paint, element count and frames per second. Every number is measured live in the visitor's browser; none is hard-coded.
- **Sound effects** are opt-in (title menu or options, saved as `lonz-sfx`).

## The arcade

- A cartridge is a real link to its MP4 (`<a class="pak" href="...">`), so videos open without JavaScript. With JavaScript the cartridge flies into the LONZ BOY and plays on its screen.
- The console is drawn in CSS in "console units" (`--cu`); it steps down a size on short or narrow screens instead of scaling by a fraction (4px, 3px, and 2.5px on the narrowest phones, which is whole screen pixels there). The cartridges on the shelf are 140px wide, five pixels to each of their 28 units. The bonus game draws at a whole multiple of its 152 x 164 picture.
- Controls: A play or pause, B eject, Start full screen, Select sound, Left and Right change cartridge, Up and Down volume. The same keys work on a keyboard while focus is inside the console. The key legend and the buttons' spoken names change with the cartridge (video, Drive player, game), and on the seek bar an arrow key moves five seconds.
- On a phone the shelf is one row that scrolls sideways; a blinking "Swipe" hint beside its title shows whenever more than two cartridges are listed.
- The video starts muted inside the visitor's click and gets its sound when the boot screen ends; nothing plays without a click, and it pauses when the console scrolls out of view.
- Effects are never drawn over the work: scanlines only on the idle screen and the title monitor.
- The poster wall is justified rows (each `li` carries its aspect ratio in `--r`); a poster opens in the viewer.
- Media added through Google Drive arrives in `data/drive.json` and joins the shelf and the wall (see README). Imported files are served from `assets/drive/`; a video too large to copy plays in Google Drive's own player inside the console.

## Motion

- Motion moves in frames: every animation and transition uses `steps()`.
- Nothing on the title screen starts invisible: the title drops in with a transform only and the monitor opens behind two shutters, so the first paint already shows the name.
- Windows "open" as they scroll in; the CRT changes channel with a static flicker; the intro line types itself once; buttons press down by one pixel unit; a cartridge flies to the slot in six frames.
- Everything stops under `prefers-reduced-motion` and under Options > Animations (`html.motion-off`): no typing, no flights, no countdown, instant scrolling.

## Interaction and access

- **Works without JavaScript**: cartridges, posters, project screens and certificates are plain links; all four service panels and all characters are visible; the nav stays in the HUD; the brief form falls back to a plain `mailto:`.
- **Tabs** (character select, services) are WAI-ARIA tabs: arrow keys, Home and End.
- **Viewer** is one `<dialog>` for every gallery and certificate; galleries are defined in `GALLERIES` in `js/script.js`. Arrow keys and swipe step through items.
- **Project brief** writes the message in the visitor's own email, messages or share app. Nothing is sent to the site; the draft is kept in this browser until it is emailed or texted.
- Touch targets are at least 44px on touch screens. Windows contrast themes (`forced-colors`) get real outlines and icon colours. Printing gives black text on white with every panel open.

## Icons and sprites

- Icons: [pixelarticons](https://github.com/halfmage/pixelarticons) (MIT), inlined as data URIs in `css/icons.css`, always at 24px. Use `<span class="i i-NAME" aria-hidden="true"></span>`. To add one, drop its SVG into `assets/icons/` and regenerate `icons.css` (see the header comment).
- Sprites (CRT, starburst, coin, runner, flag, bug, sparkles) are drawn in code by `tools/sprites.py` at 1x and shown at whole multiples with `image-rendering: pixelated`.
- The pixel portrait (`assets/img/me-pixel.png`) is the graduation photo quantized to the site palette.

## Media

- Images are WebP in `assets/img/`, sized for their slot; `loading="lazy"` below the fold, width and height set to avoid layout shift.
- Videos are H.264 MP4 in `assets/video/full/` with a poster and a 220 by 140 cartridge label in `assets/video/label/`; they load only when a cartridge is inserted.
- Everything is referenced with relative paths, because the site is served from `https://mnikko213.github.io/LONZ-PORTFOLIO/`.
