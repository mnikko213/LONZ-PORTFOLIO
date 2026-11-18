# LONZ-PORTFOLIO

Portfolio of Engr. Mark Nikko Lonzaga, built as a retro game you play through: a title screen, numbered stages, an arcade with a handheld console that plays video cartridges, and a CONTINUE? screen.

Live: https://mnikko213.github.io/LONZ-PORTFOLIO/

## Add a video or a picture (Google Drive)

Once Drive is connected (next section), this is all it takes:

1. Drop the file into one of the Drive folders listed in `drive.config.json`, or into a subfolder of one.
2. Wait for the next sync, or start one yourself: open [Actions > Sync Google Drive](https://github.com/mnikko213/LONZ-PORTFOLIO/actions/workflows/drive-sync.yml), press **Run workflow**, then **Run workflow** again. The site updates a minute or two after the run turns green.

What happens to it:

| On Drive | On the site |
|---|---|
| A video (`.mp4`, `.mov`, `.webm`, `.m4v`, `.mkv`, `.avi`) | A new **cartridge** on the Arcade shelf. It plays on the LONZ BOY like the others. |
| A picture (`.png`, `.jpg`, `.webp`, `.gif`, `.heic`) | A new poster on the **Poster wall**. |
| The folder's name | The filter button it sits under (Ads, Edits, Posters, ...). |
| The file's name | Its title. The ending and a leading number are dropped, so `02 - Pet care ad.mp4` shows as "Pet care ad" and sorts second. |
| The file's description (right-click the file > File information > Details) | The sentence shown under the title. |
| Deleting the file, or moving it out of the folder | It leaves the site on the next sync. |

Good to know:

- The sync shrinks everything first. Pictures become WebP (1600 px at most). Videos become 720p-class MP4 files, so the site stays fast.
- A video longer than 20 minutes, or still over 45 MB after shrinking, is shown through Google Drive's own player inside the console instead of being copied.
- The scheduled sync is asked for twice an hour, but GitHub starts scheduled jobs only when it has room, which can be hours later. **Run workflow** always starts right away.

### Settings: `drive.config.json`

```json
{
  "folders": ["https://drive.google.com/drive/folders/..."],
  "hidden": [],
  "labels": { "Archives": "Posters", "WEB DESIGNS": "Web designs" },
  "access": "api"
}
```

- `folders`: the Drive folders to show. Paste a folder's share link to add one. Each folder must be shared as **Anyone with the link: Viewer**.
- `hidden`: share links of files or folders to leave off the site. Two pictures are listed there now ("POSTER - 41" and "POSTER - 42" in Archives): both are phone screenshots with a status bar and black bars around the poster. Put the original poster files on Drive and they will show; or delete the two links here to show the screenshots as they are.
- `labels`: gives a Drive folder a different name on the site.
- `access`: how the sync reads Drive. Leave it as `"api"` (see below).

`data/drive-builtin.json` lists Drive files that are already part of the site by hand, so the sync skips them.

### Connect Google Drive (one time, about ten minutes)

The sync reads Drive through Google's official Drive API, which needs a free API key. The key is stored as a GitHub secret; it is never written into this repository.

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and sign in with the Google account that owns the folders.
2. Create a project (any name, for example "portfolio-sync").
3. Open **APIs & Services > Library**, search for **Google Drive API**, open it and press **Enable**.
4. Open **APIs & Services > Credentials > Create credentials > API key**.
5. Edit the new key: under **API restrictions** choose **Restrict key**, tick **Google Drive API** only, and save. Copy the key.
6. In this repository on GitHub: **Settings > Secrets and variables > Actions > New repository secret**. Name it `DRIVE_API_KEY`, paste the key, and press **Add secret**.
7. Run the sync once (step 2 at the top of this page).

Until the secret exists, every sync run simply reports that it is waiting. That is not an error.

About `"access": "public-page"`: the sync can also read Google's public folder pages without a key. Google's `robots.txt` asks automated tools not to read those pages, so the official API above is the supported way. Only switch if you have decided that yourself.

### When new files do not show up

- Open the latest run under **Actions > Sync Google Drive**. A yellow warning means Google did not answer that time and the run was skipped; the next run tries again. A red run names what to fix (a folder that is not shared, a wrong key).
- "waiting for the DRIVE_API_KEY secret": do the one-time setup above.
- The run is green and says files were saved, but the site looks the same: wait a few minutes and reload. If it still looks the same after ten minutes, open **Settings > Pages** and check that the source is **Deploy from a branch**, branch `main`, folder `/ (root)`.
- GitHub pauses scheduled runs in a repository with no activity for 60 days. Open **Actions > Sync Google Drive** and press **Enable workflow**.

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
| `index.html`, `css/style.css` | The page and its styles |
| `js/script.js` | The page: HUD, pause menu, side quests, viewer, project brief |
| `js/arcade.js` | The Arcade: cartridge shelf, LONZ BOY console, poster wall, Drive items |
| `js/game.js` | LONZ RUN, the bonus game (loads only when its cartridge is inserted) |
| `css/icons.css` | Pixel icons ([pixelarticons](https://github.com/halfmage/pixelarticons), MIT), generated from `assets/icons/` |
| `assets/img/` | Optimised WebP images, sprites, icons |
| `assets/video/full/`, `assets/video/label/` | The built-in videos, and the picture on each cartridge |
| `assets/drive/`, `data/drive.json` | Media imported from Google Drive and the list the page reads. Written by the sync; do not edit by hand |
| `drive.config.json` | The Drive folders to show (see above) |
| `tools/drive-sync.mjs`, `.github/workflows/drive-sync.yml` | The sync and the scheduled job that runs it |
| `resume.html` | The resume as a web page, with a PDF download; prints as a plain resume |
| `Resume/` | PDF copy of the resume (no street address or references) |
| `assets/mark-nikko-lonzaga.vcf` | The contact card behind "Save my contact" |
| `tools/sprites.py`, `tools/logo.py` | Redraw the pixel sprites and the logo/favicons: `python tools/sprites.py` |
| `tools/og-card.html` | The link preview picture (see below) |
| `DESIGN.md` | Colours, type, shapes, motion and the game rules |
| `404.html` | "Game over" page for missing links |

## Checks

```bash
node --test tools/
```

Runs the sync's tests without touching the network (the import tests need ffmpeg on the PATH).

To try the sync on this PC, set `DRIVE_API_KEY` in the terminal first:

```bash
node tools/drive-sync.mjs --plan      # only look, change nothing
node tools/drive-sync.mjs             # import what changed
```

## Link preview image

`assets/img/og-card.png` (1200 x 630) is what chat apps and social sites show for the link. It is a screenshot of `tools/og-card.html`, which is drawn with the site's own stylesheet. To rebuild it, serve the folder locally, open `http://localhost:8000/tools/og-card.html` in a window exactly 1200 x 630 and save a screenshot over the PNG.
