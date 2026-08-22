# Photography Portfolio

A static, dependency-free portfolio site for landscape, wildlife and bird
photography. Plain HTML, CSS and JavaScript — no framework, no build step, no
npm install. It deploys to GitHub Pages by pushing it.

## Adding photographs

1. **Export web-sized JPEGs** from Lightroom or Photos. Recommended: sRGB,
   quality 80, long edge **2000px**. Anything much larger just costs your
   visitors bandwidth; anything smaller looks soft on a retina screen.

2. **Drop them into a category folder**, naming each file like this:

   ```
   images/birds/Snowy Owl_Amherst Island ON_2026-01-12.jpg
   images/wildlife/Bull Moose_Denali NP AK_2025-09-21.jpg
   images/landscape/Alpenglow_Torres del Paine CL_2025-10-30.jpg
   ```

   The pattern is `Title_Location_YYYY-MM-DD.jpg`. Location and date are
   optional — `Snowy Owl.jpg` works, and a missing date is filled in from the
   photo's EXIF capture date. The **folder name becomes the category**, which
   is what the filter buttons across the top are built from. Add a new folder
   (`images/insects/`, `images/macro/`) and a new filter button appears by
   itself.

3. **Rebuild the manifest:**

   ```bash
   python3 tools/build_manifest.py
   ```

   This reads each file's real dimensions and EXIF (camera, lens, focal
   length, aperture, shutter, ISO), generates 1200px thumbnails into
   `images/_thumbs/` so the grid loads fast, and writes `photos.json`.

4. **Preview it locally.** The page loads `photos.json` over `fetch`, which
   browsers block on `file://` URLs — so open it through a local server rather
   than double-clicking `index.html`:

   ```bash
   python3 -m http.server 8000
   ```

   Then visit <http://localhost:8000>.

### Fixing a title or caption

Edit `photos.json` directly. Your edits to `title`, `location`, `date`,
`caption` and `category` are **preserved** when you re-run
`build_manifest.py` — only the mechanical fields (dimensions, EXIF, thumbnail
path) get refreshed. To have a field re-derived from the filename, delete it
from the entry and rebuild.

## Editing the words

Your name, tagline, the About text and the contact links are all plain HTML in
[`index.html`](index.html), each marked with an `EDIT ME` comment. Colours,
type and the grid row height live in the `:root` block at the top of
[`assets/site.css`](assets/site.css) — `--row-h` is the one to change if you
want bigger or smaller thumbnails.

## Publishing to GitHub Pages

The repo is already initialised locally with a first commit. To put it online:

1. Create a new **public, empty** repository on GitHub — no README, no
   `.gitignore`, no licence (those would collide with what's already here).
   Name it whatever you like; `photography-portfolio` is fine.

2. Connect and push:

   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/photography-portfolio.git
   git push -u origin main
   ```

3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from
   a branch**, branch `main`, folder `/ (root)`. Save.

4. A minute or so later the site is live at
   `https://YOUR-USERNAME.github.io/photography-portfolio/`.

To publish at `https://YOUR-USERNAME.github.io/` instead, name the repository
exactly `YOUR-USERNAME.github.io`.

Afterwards, every update is the usual three commands:

```bash
git add -A && git commit -m "Add March shorebirds" && git push
```

### A note on file sizes

GitHub Pages has a soft limit of **1 GB per repository** and recommends
keeping sites under that comfortably. At 2000px/quality-80 a JPEG runs roughly
0.5–1.5 MB, so you have room for several hundred photographs. If you ever
outgrow it, the fix is moving the images to an image host or object storage
and pointing `src` at the new URLs — the site itself won't need changing.

Also: **everything you push to a public repo is public and stays in the git
history**, including anything you later delete. Don't commit full-resolution
masters or anything with location data you'd rather not share — EXIF GPS tags
are not stripped by this project. Lightroom's export dialog can remove
location metadata for you.

## Layout of the project

```
index.html                  the whole site — one page
assets/site.css             theme, grid, lightbox
assets/gallery.js           reads photos.json, renders grid + lightbox
photos.json                 generated manifest (safe to hand-edit)
tools/build_manifest.py     scans images/, writes photos.json
images/<category>/          your photographs
images/_thumbs/             generated, committed so Pages can serve them
images/_placeholders/       sample tiles — delete once real photos are in
```

Folders beginning with `_` are skipped by the scanner, which is how
`_thumbs` and `_placeholders` stay out of the gallery.
