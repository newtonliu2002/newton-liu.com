# newton-liu.com

Bird, wildlife and landscape photography portfolio. Static HTML, CSS and
JavaScript — no framework, no build step, no `npm install`. Deployed by
pushing to `main`; GitHub Pages serves the repo root. The photographs are not
in git: they live in Cloudflare R2 and the live site loads them from there
(CLAUDE.md, "Where the photographs live").

## New machine or fresh clone

```bash
git config core.hooksPath tools/hooks     # the safety checks on commit
python3 tools/upload.py --download        # bring back images/ from R2
npx wrangler login                        # once, before the first upload
```

## Preview locally

```bash
python3 tools/serve.py
```

Then open <http://localhost:8137>. The preview reads the photographs from
`images/` on disk. Opening `index.html` by double-clicking won't work — the
site loads its data over `fetch`, which browsers block on `file://` URLs.

## Add photographs

1. Export from Lightroom as JPEG — **any size**, the importer downscales.
2. Import them:

```bash
python3 tools/import.py ~/Desktop/"2025.12 West JPEG" --collection west
```

   This resizes to a 4000px long edge, never touches your source folder, and
   refuses to import a photograph carrying GPS coordinates unless you
   explicitly allow or strip it. Filenames stay as the camera wrote them.

3. A new collection also needs its entry in `data/collections.json`.

4. Rebuild, upload and publish:

```bash
python3 tools/build.py
python3 tools/upload.py
git add -A && git commit -m "Add the West, December 2025" && git push
```

`build.py` reads each file's dimensions and EXIF, makes 800/1600/2400px
widths in `images/_thumbs/`, writes `data/photos.json`, and regenerates the
per-collection pages. Text you edit by hand in `photos.json` is preserved.
`upload.py` puts the new photographs in R2 (checking for GPS again) and
proves they're there; the commit is refused until it has.

## Edit the site

| What | Where |
|---|---|
| Colours, type, spacing, grid size | the `:root` block at the top of `assets/site.css` |
| Collection names, subtitles, blurbs, order | `data/collections.json` |
| Home page copy, About, Contact | `index.html`, `about.html`, `contact.html` |
| Gallery and lightbox behaviour | `assets/site.js` |

`collections/<slug>/index.html` is **generated** by `build.py` — edit
`data/collections.json` instead.

See [CLAUDE.md](CLAUDE.md) for the conventions this project follows.

## Rules worth keeping

- **Never commit photographs.** They go to R2 through `tools/upload.py`; git
  keeps every file forever and GitHub Pages refuses a site over 1 GB. Only
  the About page's own images (`images/_about/`) are in git.
- **Strip EXIF GPS at export.** Precise coordinates for nests, roosts and
  rarities shouldn't be published.
- **This repo is public.** Anything pushed is permanent, including files
  deleted later.

## Not built yet

Print sales, the Chinese translation, and the cinematography section. Static
hosting can't do checkout — when prints matter, the plan is a Stripe Payment
Link or Shopify buy button embedded into the page.
