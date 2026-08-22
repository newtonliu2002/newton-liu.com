# newton-liu.com

Bird, wildlife and landscape photography portfolio. Static HTML, CSS and
JavaScript — no framework, no build step, no `npm install`. Deployed by
pushing to `main`; GitHub Pages serves the repo root.

## Preview locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Opening `index.html` by double-clicking
won't work — the site loads its data over `fetch`, which browsers block on
`file://` URLs.

## Add photographs

1. Export from Lightroom: **sRGB, quality 80, long edge 2000px**, and tick
   *Remove Location Info*.
2. Drop them into `images/<collection>/`, named
   `Title_Location_YYYY-MM-DD.jpg` — for example
   `images/peru/Hoatzin_Tambopata_2024-07-18.jpg`. Location and date are
   optional; a missing date is read from EXIF.
3. Rebuild and publish:

```bash
python3 tools/build.py
git add -A && git commit -m "Add Peru 2024" && git push
```

`build.py` reads each file's dimensions and EXIF, generates 1200px thumbnails
into `images/_thumbs/`, writes `data/photos.json`, and regenerates the
per-collection pages. Text you edit by hand in `photos.json` is preserved.

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

- **Never commit full-resolution originals.** Git keeps them forever and the
  repo has a 1 GB soft limit. Web-sized exports only.
- **Strip EXIF GPS at export.** Precise coordinates for nests, roosts and
  rarities shouldn't be published.
- **This repo is public.** Anything pushed is permanent, including files
  deleted later.

## Not built yet

Print sales, the Chinese translation, and the cinematography section. Static
hosting can't do checkout — when prints matter, the plan is a Stripe Payment
Link or Shopify buy button embedded into the page.
