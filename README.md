# LONZ-PORTFOLIO

Portfolio of Engr. Mark Nikko Lonzaga, built as a retro game: title screen, level select, quest log, inventory, achievements and a CONTINUE? screen.

Live: https://mnikko213.github.io/LONZ-PORTFOLIO/

## Run it locally

Static files only, no build step. From this folder:

```bash
python -m http.server 8000
```

Then open http://localhost:8000/index.html. To open it from another device on the same Wi-Fi, add `--bind 0.0.0.0` and use this PC's IPv4 address instead of `localhost`.

## Deploy

GitHub Pages serves the repo root of `main`. Every path in the site is relative, so it works under the `/LONZ-PORTFOLIO/` sub-path and on a custom domain. `.nojekyll` makes Pages publish the files as they are.

## Where things live

| Path | What it is |
|---|---|
| `index.html`, `css/style.css`, `js/script.js` | The whole site |
| `css/icons.css` | Pixel icons ([pixelarticons](https://github.com/halfmage/pixelarticons), MIT), generated from `assets/icons/` |
| `assets/img/` | Optimised WebP images, sprites, icons |
| `assets/video/` | 8-second cartridge previews; `full/` holds the gallery videos |
| `resume.html` | The resume as a web page, with a PDF download; prints as a plain resume |
| `Resume/` | PDF copy of the resume (no street address or references) |
| `tools/sprites.py`, `tools/logo.py` | Redraw the pixel sprites and the logo/favicons: `python tools/logo.py` |
| `DESIGN.md` | Colours, type, shapes and motion rules |
| `404.html` | "Game over" page for missing links |
