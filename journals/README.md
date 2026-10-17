# Travel journals

Each trip's journal is a folder here. Quebec's is `journals/quebec/`:

- `journal.json`: the trip (title, month, dates, cover, route, entry order)
- `entries/`: one text file per entry, such as `rain.txt`
- `index.html`: the page's layout; nothing to edit there

Preview it at http://localhost:8137/journals/quebec/ after
`python3 tools/serve.py`. The preview shows everything, the grey
placeholders included; the live site shows only what is real.

## Add an entry

1. Make a new file in `entries/`. Its name is the entry's address, so keep
   it short, lower case, no spaces: `entries/fjord.txt` is
   `…/journals/quebec/#fjord`. Not the date: two entries can share a day.
2. Write it like this:

   ```
   title: 法语
   date: 10.12.2026 周一
   time: 8:00 AM
   place: Tadoussac
   where: Tadoussac, QC, Canada
   ---
   Your text. A blank line starts a new paragraph.
   A single line break stays a line break, for poems and dialogue.

   @photo images/_journals/quebec/IMG_0001.jpg | a caption, if you want one
   ```

   A line starting `## ` is a heading inside the entry, such as
   `## 4.1海和我`. `date`, `time` and `where` show exactly as you write them, under the
   title. `time` is optional; leave it empty and no time shows. `place` is
   one of the trip's pins (as on the globe) and puts the entry on the map;
   it isn't shown when `where` is filled in. Places you only mention in the
   text never go on the map.
3. Add its name to `"entries"` in `journal.json`, where it falls in the
   reading order: `"entries": ["rain", "french", "fjord"]`.
4. An English version, if you write one: `entries/fjord.en.txt` in the same
   format, and its name in `"english"` in `journal.json`
   (`"english": ["fjord"]`). It shows when the site is in English; an entry
   without one reads the same in both languages.

## Add or replace a photo, a video or the cover

1. Export it without location (keep the camera info: it shows under the
   photo when it's enlarged): a photo as JPEG, about 2400 px on the long
   side; a video as MP4 (H.264, 1080p at most) plus a JPEG of one frame as
   its poster. Phones put the location into videos too: export with
   location removed.
2. Put it in `images/_journals/quebec/` (images/ stays out of git).
3. In the entry, one line per photo or video, where it should appear:
   `@photo images/_journals/quebec/IMG_0001.jpg | caption` or
   `@video images/_journals/quebec/clip.mp4 | poster images/_journals/quebec/clip.jpg | caption`.
   Lines with no blank line between them sit together (two uprights side
   by side). A photo already in a collection can be used by its own path,
   such as `images/quebec/0Z9A0001.jpg`.
4. The cover is in `journal.json`:
   `"cover": { "type": "photo", "src": "images/_journals/quebec/cover.jpg", "fit": "whole", "alt": "…" }`,
   or `"type": "video"` with a `"poster"`. `"fit": "whole"` shows the photo
   in its own proportions; leave it out and the cover fills the screen,
   trimmed to fit.
5. Run `python3 tools/build.py` (it notes each file's shape in
   `media.json` beside `journal.json`, so the page doesn't jump about as
   photos arrive), then `python3 tools/upload.py`. It refuses anything that
   still carries a location.

To replace one, give the new file a new name and change the line;
a file replaced under the same name can look unchanged for a day.

## Add a stop to the route

The route is `"route"` in `journal.json`, in the order you travelled:
`{ "place": "Tadoussac", "date": "2026-10-09" }`. A place visited twice
appears twice. A brand-new place needs its pin in `data/places.json` (and
its road in `data/routes.json`) first; ask Claude.

## Live or not

Quebec's journal is live. The switch is in `data/places.json`, under
`quebec`: `"journal": { "href": "journals/quebec/", "draft": false }`.
`"draft": true` takes the page, the globe card's "Journal →" and the
collection's link down together, and visitors see a one-line "not
published yet" instead.
