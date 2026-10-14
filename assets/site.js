/* ==========================================================================
   newton-liu.com — the whole of the site's behaviour.

   Page types, told apart by <body data-page="...">:
     work     — the Index: renders the collection cards (renderHome)
     gallery  — renders one collection's justified photo grid + the lightbox
     globe, prose — the landing and About/Contact: only the nav, the
                ground switch and window.NLSite (globe.js draws the landing)

   <body data-base="../../"> is the path back to the repo root, so the same
   script works from / and from /collections/<slug>/. Keep it relative:
   GitHub Pages preview URLs are served from a subpath and absolute paths
   ("/assets/...") break there.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------
     CAPTIONS — what, if anything, is printed under a photograph.

     Everything is off: the photographs are shown without titles, dates,
     locations or camera data. Flip any of these to true to bring that line
     back; the data is always there, refreshed from the files on every run of
     tools/build.py, so nothing needs regenerating first.

       title     the photograph's name
       location  where it was taken
       date      when it was taken
       exif      camera, lens, focal length, aperture, shutter, ISO

     `grid` controls the caption that slides up over a thumbnail on hover;
     `lightbox` controls the block under the enlarged photograph. A field
     shows only if it is true in both its own row and the surface's row.
     ------------------------------------------------------------------ */
  var CAPTIONS = {
    grid:     { title: false, location: false },
    lightbox: { title: false, location: false, date: false, exif: true }
  };

  // Which EXIF fields print, and in what order. Any field that's missing from
  // a given photograph is skipped, so drone frames (which report no lens
  // worth naming) simply show fewer items.
  var EXIF_FIELDS = ["camera", "lens", "focal", "aperture", "shutter", "iso"];

  var body = document.body;
  var BASE = body.dataset.base || "";
  var PAGE = body.dataset.page || "";

  /* ---------- small helpers ------------------------------------------ */

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function getJSON(path) {
    return fetch(BASE + path, { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error(path + ": HTTP " + res.status);
      return res.json();
    });
  }

  // The photographs live in Cloudflare R2, not in this repo (CLAUDE.md,
  // "Where the photographs live"); the object keys are the repo paths, so
  // "images/peru/EZLE2124.jpg" is R2 + that. The local preview (tools/serve.py,
  // which only listens on 127.0.0.1) reads them from images/ on disk instead,
  // so a collection can be arranged before a single file is uploaded. To check
  // an upload, preview against R2 by running  localStorage.media = "r2"  in the
  // console, and delete it afterwards.
  var R2 = "https://pub-ce9a4b2d164449d8ac95ccbca47549a3.r2.dev/";
  var MEDIA = (function () {
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var force = null;
    try { force = localStorage.getItem("media"); } catch (e) {}
    return local && force !== "r2" ? BASE : R2;
  })();

  // Photo paths in the manifest are root-relative. Each segment is encoded:
  // a space in a filename would otherwise split a srcset entry in two, and an
  // apostrophe (Swainson's Hawk) would end the hero's CSS url('...') early.
  // encodeURIComponent leaves ! ' ( ) * alone, so those are done by hand; the
  // result matches url_for() in tools/upload.py.
  function encodeSegment(seg) {
    return encodeURIComponent(seg).replace(/[!'()*]/g, function (c) {
      return "%" + c.charCodeAt(0).toString(16).toUpperCase();
    });
  }
  function url(src) {
    return MEDIA + src.split("/").map(encodeSegment).join("/");
  }

  // ---- Responsive images -------------------------------------------------
  // build.py writes a ladder of widths for every photograph. A `srcset` lets
  // the browser choose one, but only if `sizes` tells it how wide the slot
  // will be: with no `sizes` it assumes the full viewport and fetches the
  // largest file every time, on a phone as readily as on a 5K display. The
  // originals are 4000px, so getting this wrong is a 2 MB mistake per
  // photograph. Every caller below therefore states its own width.

  function srcsetOf(photo) {
    if (!photo.variants || photo.variants.length < 2) return "";
    return photo.variants.map(function (v) {
      return url(v.src) + " " + v.w + "w";
    }).join(", ");
  }

  // Order matters and is easy to get wrong, so it lives here rather than at
  // the call sites: assigning `src` first starts a fetch immediately and the
  // browser keeps that file, silently ignoring the srcset added afterwards.
  // `sizes` before `srcset` before `src`, always. This function is the only
  // place a photograph's src is assigned.
  function responsive(img, photo, sizes, fallback) {
    var set = srcsetOf(photo);
    if (set) {
      img.sizes = sizes;
      img.srcset = set;
    }
    img.src = url(fallback || photo.src);
    return img;
  }

  // A tile's width as a share of the packed grid — which is the whole page
  // below 1000px and the 62% right-hand column above it (.book-body in the
  // CSS), capped once --wrap-wide stops growing at 108rem.
  // `phone` is the share below 620px, for a row that folds there (PLLL).
  function tileSizes(share, phone) {
    return (phone ? "(max-width: 620px) " + Math.round(phone * 100) + "vw, " : "") +
           "(max-width: 1000px) " + Math.round(share * 100) + "vw, " +
           "(min-width: 1800px) " + Math.round(share * 1042) + "px, " +
           Math.round(share * 62) + "vw";
  }

  // Height-capped slots (the opener, the lightbox) are limited by the window's
  // height, not its width, so their width follows from the photograph's ratio.
  function cappedSizes(photo, vh) {
    return "min(100vw, " + Math.round(vh * aspectOf(photo)) + "vh)";
  }

  function pickForWidth(photo, cssWidth) {
    var want = cssWidth * (window.devicePixelRatio || 1);
    if (!photo.variants || !photo.variants.length) return photo.src;
    var best = photo.variants[photo.variants.length - 1];
    for (var i = 0; i < photo.variants.length; i++) {
      if (photo.variants[i].w >= want) { best = photo.variants[i]; break; }
    }
    return best.src;
  }

  function formatDate(value) {
    if (!value) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return value;                       // freeform dates pass through
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  }

  // The date printed under a gallery's heading — one line for the whole
  // collection rather than a date on every photograph. Derived from the
  // capture dates in the manifest, so it stays right as photographs are
  // added. Set "date" on the collection in data/collections.json to override.
  function collectionDate(photos) {
    var dates = photos
      .map(function (p) { return p.date; })
      .filter(function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); })
      .sort();
    if (!dates.length) return "";

    function parse(s) {
      var b = s.split("-");
      return new Date(Number(b[0]), Number(b[1]) - 1, Number(b[2]));
    }
    var first = parse(dates[0]);
    var last = parse(dates[dates.length - 1]);

    var monthYear = { month: "long", year: "numeric" };
    var full = function (d) { return d.toLocaleDateString(undefined, monthYear); };

    if (first.getFullYear() === last.getFullYear()) {
      if (first.getMonth() === last.getMonth()) return full(last);
      // Same year, different months: "October – December 2025"
      return first.toLocaleDateString(undefined, { month: "long" }) + " – " + full(last);
    }
    return full(first) + " – " + full(last);
  }

  function aspectOf(photo) {
    var w = Number(photo.width), h = Number(photo.height);
    if (!w || !h) return 1.5;
    // Clamp so nothing wrecks a row, but loosely enough that an xPan turned
    // upright (0.37) keeps its own shape rather than being cropped to fit.
    return Math.max(0.3, Math.min(4, w / h));
  }

  // Screen readers still need something, even when nothing is printed on
  // screen. Falls back to the collection, which is the only description
  // that exists when captions are off.
  var collectionName = "";

  function altFor(photo) {
    if (CAPTIONS.lightbox.title && photo.title) {
      return [photo.title, photo.location && "photographed at " + photo.location]
        .filter(Boolean).join(", ");
    }
    return collectionName ? "Photograph from " + collectionName : "Photograph";
  }

  function status(container, message) {
    container.textContent = "";
    var p = el("p", "grid-status");
    p.textContent = message;
    container.appendChild(p);
  }

  // Shared with assets/globe.js so the landing resolves photograph URLs and
  // picks image sizes exactly as the galleries do (and follows the R2 switch).
  window.NLSite = { url: url, responsive: responsive, collectionDate: collectionDate,
                    aspectOf: aspectOf, getJSON: getJSON };

  Array.prototype.forEach.call(document.querySelectorAll("[data-year]"), function (n) {
    n.textContent = String(new Date().getFullYear());
  });

  /* ---------- black / white ground ------------------------------------- */

  // The <head> of every page applies a saved "white" before the first paint;
  // this adds the switch to the nav and remembers the visitor's choice.
  // Black (#121212) is the default, and anything else stored lands in Black,
  // including the old switch's "dark" (gray) and "light" (its white, which
  // is why White is saved under a new word). Storage can be blocked (private
  // windows), so every read and write is guarded and the switch still works
  // for the visit. The window colour is left to that head script until the
  // switch is used (the landing keeps its own), and every change is announced
  // as "nl:theme" so the landing can repaint its map.
  (function themeToggle() {
    var nav = document.querySelector(".nav");
    if (!nav) return;
    var root = document.documentElement;
    var meta = document.querySelector('meta[name="theme-color"]');
    var btn = el("button", "theme-toggle");
    btn.type = "button";
    btn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
      '<path d="M8 1.5a6.5 6.5 0 0 0 0 13z" fill="currentColor"/></svg>';
    // One fixed name; aria-pressed says whether White is on.
    btn.setAttribute("aria-label", "White background");
    function sync() {
      var light = root.dataset.theme === "light";
      btn.setAttribute("aria-pressed", light ? "true" : "false");
      btn.title = light ? "Black background" : "White background";
    }
    function set(light) {
      if (light) root.dataset.theme = "light"; else delete root.dataset.theme;
      sync();
      if (meta) meta.content = light ? "#ffffff" : "#121212";
      document.dispatchEvent(new CustomEvent("nl:theme", { detail: { light: light } }));
    }
    btn.addEventListener("click", function () {
      var light = root.dataset.theme !== "light";
      try { localStorage.setItem("theme", light ? "white" : "black"); } catch (e) {}
      set(light);
    });
    // A page brought back by the Back button is the one that was left, in
    // the ground it was left in: catch it up with a switch made since.
    window.addEventListener("pageshow", function (e) {
      if (!e.persisted) return;
      var light;
      try { light = localStorage.getItem("theme") === "white"; } catch (err) { return; }
      if (light !== (root.dataset.theme === "light")) set(light);
    });
    sync();
    nav.appendChild(btn);
  })();

  /* ---------- home ---------------------------------------------------- */

  function renderHome(collections, photos) {
    var grid = document.getElementById("collection-grid");

    // Hero: whichever photo is flagged `featured`, else the most recent.
    var hero = photos.filter(function (p) { return p.featured; })[0] || photos[0];
    var heroMedia = document.getElementById("hero-media");
    if (hero && heroMedia) {
      // A background-image can't carry a srcset, so pick the width here. The
      // hero is set once and never resized, so there is no handler to add.
      heroMedia.style.backgroundImage =
        "url('" + url(pickForWidth(hero, window.innerWidth)) + "')";
    }

    var byCollection = {};
    photos.forEach(function (p) {
      (byCollection[p.collection] = byCollection[p.collection] || []).push(p);
    });

    if (!collections.length) { status(grid, "No collections defined yet."); return; }

    grid.textContent = "";
    collections.forEach(function (c) {
      var shots = byCollection[c.slug] || [];
      var cover = c.cover
        ? photos.filter(function (p) { return p.src === c.cover; })[0] || { src: c.cover }
        : shots[0];

      var card = el("a", "collection-card" + (shots.length ? "" : " is-empty"));
      card.href = BASE + "collections/" + c.slug + "/";

      if (cover) {
        var img = el("img");
        // Cards are a 20rem-minimum auto-fill grid inside --wrap, so they land
        // near 380px on a desktop and go full width on a phone. A cover wider
        // than 3:2 is cropped to fill the card, so it is drawn that much
        // wider than the card: the hint grows with it.
        var wide = Math.max(1, aspectOf(cover) / 1.5);
        responsive(img, cover, "(max-width: 700px) " + Math.round(100 * wide) + "vw, " +
                   Math.round(380 * wide) + "px", cover.thumb || cover.src);
        img.alt = "";                    // decorative; the title carries meaning
        img.loading = "lazy";
        img.decoding = "async";
        card.appendChild(img);
      }

      // No photo counts, here or anywhere else — a collection is a body of
      // work, not a tally.
      var bodyEl = el("div", "card-body");
      var title = el("h3", "card-title");
      title.textContent = c.title;
      bodyEl.appendChild(title);

      if (c.subtitle) {
        var sub = el("p", "card-sub");
        sub.textContent = c.subtitle;
        bodyEl.appendChild(sub);
      }
      card.appendChild(bodyEl);
      grid.appendChild(card);
    });
  }

  /* ---------- gallery -------------------------------------------------- */

  var lightbox, lbImage, lbTitle, lbMeta, lbExif;
  var shown = [];      // photos currently in the grid — what the arrows walk
  var index = -1;
  var isOpen = false;

  function exifLine(photo) {
    var e = photo.exif;
    if (!CAPTIONS.lightbox.exif || !e) return "";
    return EXIF_FIELDS
      .map(function (field) {
        if (!e[field]) return "";
        return field === "iso" ? "ISO " + e[field] : e[field];
      })
      .filter(Boolean)
      .join("  ·  ");
  }

  function metaLine(photo) {
    return [
      CAPTIONS.lightbox.location && photo.location,
      CAPTIONS.lightbox.date && formatDate(photo.date)
    ].filter(Boolean).join("  ·  ");
  }

  /* ------------------------------------------------------------------
     THE PACKED GRID

     Photographs may be cropped, including to a square, but never across the
     divide: a landscape stays a landscape and an upright stays an upright.

     Each row has one anchor cell carrying an aspect-ratio; the rest stretch to
     the height it sets and take their width from a percentage. So rows sit
     flush at any window width with no measuring and no resize handler.

     Cell needs:  L landscape · P upright · S either, cropped square · W pano
     ------------------------------------------------------------------ */

  function famOf(photo) {
    var ar = aspectOf(photo);
    return ar >= 2.2 ? "W" : ar <= 0.92 ? "P" : "L";
  }

  function cellFits(need, photo) {
    if (need === "?") return true;                  // "?" takes any shape whole
    var f = famOf(photo);
    return need === "*" ? f !== "W" : need === f;   // "*" crops to a square
  }

  /* Row templates.

     `need` is the family pattern the row wants, one letter per photograph in
     manifest order. `cols` are the columns it splits into and `take` is how
     many photographs stack in each. Exactly one column carries either `ar`,
     which anchors the row's height while the rest stretch to it, or `nat`,
     which keeps that photograph's own ratio instead of cropping it.

     Every template fills the width of the grid, whether it holds one
     photograph or three, so the right-hand edge of the page runs straight the
     whole way down. Don't add one that doesn't. */
  var TEMPLATES = {
    // A photograph alone, uncropped, the full width of the grid. A panorama
    // has nowhere else to go, so the packer reaches for W on its own; L is the
    // biggest a single frame can be shown here and is never chosen
    // automatically — giving one photograph a whole row is an editorial call,
    // so it only happens when a plan asks for it.
    W:    { need: "W",   cols: [{ w: 100, nat: true, take: 1 }] },
    L:    { need: "L",   cols: [{ w: 100, nat: true, take: 1 }] },

    // Two panoramas stacked beside one upright. At 66/34 the stacked pair
    // lands at about 2.66 — which is what an xPan frame already is — so the
    // row holds three photographs and crops none of them.
    WWP:  { need: "WWP", cols: [{ w: 66, take: 2 }, { w: 34, ar: 0.667, take: 1 }] },
    PWW:  { need: "PWW", cols: [{ w: 34, ar: 0.667, take: 1 }, { w: 66, take: 2 }] },

    // 0.74 sits between the two upright shapes in the collection: a 2:3 frame
    // keeps 90% of itself and a 3:4 keeps 99%.
    PP:   { need: "PP",  cols: [{ w: 50, ar: 0.74, take: 1 }, { w: 50, take: 1 }] },
    PPP:  { need: "PPP", cols: [{ w: 34, ar: 0.72, take: 1 }, { w: 33, take: 1 }, { w: 33, take: 1 }] },
    LP:   { need: "LP",  cols: [{ w: 66, take: 1 }, { w: 34, ar: 0.74, take: 1 }] },
    PL:   { need: "PL",  cols: [{ w: 34, ar: 0.74, take: 1 }, { w: 66, take: 1 }] },

    // LLe splits evenly and keeps both frames whole; LL is the unequal pair,
    // which crops the second one and is only worth it for variety.
    LLe:  { need: "LL",  cols: [{ w: 50, ar: 1.50, take: 1 }, { w: 50, take: 1 }] },
    LL:   { need: "LL",  cols: [{ w: 56, ar: 1.62, take: 1 }, { w: 44, take: 1 }] },

    // 68/32 rather than 62/38: it leaves the hero its own 3:2 and still lands
    // the two stacked beside it at about 1.45, instead of squeezing them to 1.8.
    LLL:  { need: "LLL", cols: [{ w: 68, ar: 1.50, take: 1 }, { w: 32, take: 2 }] },
    LLLr: { need: "LLL", cols: [{ w: 32, take: 2 }, { w: 68, ar: 1.50, take: 1 }] },
    LLL3: { need: "LLL", cols: [{ w: 34, ar: 1.42, take: 1 }, { w: 33, take: 1 }, { w: 33, take: 1 }] },
    LLL4: { need: "LLL", cols: [{ w: 34, ar: 1.33, take: 1 }, { w: 33, take: 1 }, { w: 33, take: 1 }] },

    // 52/48, again so the pair stacked beside the upright keeps a landscape
    // shape rather than being cropped into strips.
    PLL:  { need: "PLL", cols: [{ w: 52, ar: 0.74, take: 1 }, { w: 48, take: 2 }] },
    LLP:  { need: "LLP", cols: [{ w: 48, take: 2 }, { w: 52, ar: 0.74, take: 1 }] },

    // A collection's one great upright, as big as the grid allows: 64% wide
    // and uncropped, with three landscapes stacked beside it at about 3:2. A
    // 4:5 frame comes out around 825px tall on a laptop, just under the bar,
    // so it is seen whole. On a phone 64% would be a thumbnail, so the row
    // folds (`.is-feature` in site.css): the upright full width, the three
    // below it. Only ever used by a plan — picking the jewel is editorial.
    PLLL: { need: "PLLL", cls: "is-feature", cols: [
            { w: 64, nat: true, take: 1, ph: 1 }, { w: 36, take: 3, ph: 1 }] },

    // Nothing cropped, for a collection shot as 4:5 uprights and 3:2
    // landscapes (Yunnan). The landscapes anchor at their own ratio and the
    // upright stretches beside them; the widths are solved so that stretch
    // lands on 4:5 at laptop size, so on a phone only the upright gives a
    // percent or two. Plan only.
    PLLn: { need: "PLL", cols: [{ w: 52, take: 1 }, { w: 48, nat: true, take: 2 }] },
    LLPn: { need: "LLP", cols: [{ w: 48, nat: true, take: 2 }, { w: 52, take: 1 }] },
    LPn:  { need: "LP",  cols: [{ w: 65.2, nat: true, take: 1 }, { w: 34.8, take: 1 }] },
    PLn:  { need: "PL",  cols: [{ w: 34.8, take: 1 }, { w: 65.2, nat: true, take: 1 }] },
    PPn:  { need: "PP",  cols: [{ w: 50, nat: true, take: 1 }, { w: 50, take: 1 }] },

    // Nothing cropped, whatever the shapes: a vertical xPan beside a 3:4
    // beside a 3:2 (Alberta, British Columbia, Yukon). The columns carry no
    // widths; each grows by its photograph's own aspect ratio, so every frame
    // keeps its ratio and the row comes out one height at any window width.
    // Plan only.
    J2:   { need: "??",  just: true, cols: [{ nat: true, take: 1 }, { nat: true, take: 1 }] },
    J3:   { need: "???", just: true, cols: [{ nat: true, take: 1 }, { nat: true, take: 1 },
                                            { nat: true, take: 1 }] },

    // Square-cropping discards the most of a photograph, so these are the last
    // arrangements tried rather than the first. "*" means either orientation.
    SS:   { need: "**",  cols: [{ w: 50, ar: 1, take: 1 }, { w: 50, take: 1 }] },
    SSS:  { need: "***", cols: [{ w: 34, ar: 1, take: 1 }, { w: 33, take: 1 }, { w: 33, take: 1 }] },

    // Four frames from one burst, read left to right like a strip of film.
    // Every cell anchors itself square, so the strip can fold into two by two
    // on a phone (`.is-seq` in site.css) and still read in order. Only ever
    // used by a plan; the packer has no way to know which frames belong
    // together.
    SSSS: { need: "****", cls: "is-seq", cols: [
            { w: 25, ar: 1, take: 1 }, { w: 25, ar: 1, take: 1 },
            { w: 25, ar: 1, take: 1 }, { w: 25, ar: 1, take: 1 }] }
  };

  // What the packer tries when a collection has no plan of its own, best first.
  // A block led by an upright wins ties: uprights are rarer than landscapes and
  // suffer most from being squeezed.
  var AUTO = [
    { name: "PLL", pri: 2 }, { name: "LLP", pri: 2 },
    { name: "WWP" }, { name: "PWW" }, { name: "W", pri: -1 },
    { name: "LLL" }, { name: "LLe" }, { name: "LLL3" }, { name: "LLLr" },
    { name: "LP" }, { name: "PL" }, { name: "PP" }, { name: "PPP" },
    { name: "SS", pri: -1 }
  ];

  function fits(tpl, photos, i) {
    if (!tpl || i + tpl.need.length > photos.length) return false;
    for (var j = 0; j < tpl.need.length; j++) {
      if (!cellFits(tpl.need.charAt(j), photos[i + j])) return false;
    }
    return true;
  }

  // Best-fitting template at this position, or null. `k` rotates the search so
  // that among equally-suited templates the same one doesn't repeat.
  function pickBlock(photos, i, k) {
    var best = null, bestScore = -Infinity;

    for (var n = 0; n < AUTO.length; n++) {
      var at = (k + n) % AUTO.length;
      var cand = TEMPLATES[AUTO[at].name];
      if (!fits(cand, photos, i)) continue;

      // Priority dominates; the rotation only breaks ties between equals.
      var score = (AUTO[at].pri || 0) * 100 - n;
      if (score > bestScore) { bestScore = score; best = { block: cand, at: at }; }
    }
    return best;
  }

  /* A collection may carry an explicit running order in data/collections.json:
     `"layout": ["PP", "LLL4", "W", ...]`, one template name per row, applied to
     the photographs in manifest order once the opener has been lifted out. That
     is how a gallery gets an arrangement that was designed rather than
     improvised.

     The plan is a suggestion, never a requirement. The moment a row asks for a
     shape the photographs no longer have — because one was added, removed or
     moved — the plan is abandoned from that row on and the packer takes over.
     So a stale plan degrades to an automatic layout instead of a broken page. */
  function composeBlocks(photos, layout) {
    var out = [], i = 0, k = 0, guard = 0;

    for (var n = 0; layout && n < layout.length; n++) {
      var planned = TEMPLATES[layout[n]];
      if (!fits(planned, photos, i)) break;
      out.push({ block: planned, from: i });
      i += planned.need.length;
    }

    while (i < photos.length && guard++ < 500) {
      var hit = pickBlock(photos, i, k);
      if (hit) {
        out.push({ block: hit.block, from: i });
        i += hit.block.need.length;
        k = (hit.at + 1) % AUTO.length;
      } else {
        out.push({ block: null, from: i });        // runs alone, uncropped
        i += 1;
      }
    }
    return out;
  }

  // One thumbnail. `index` is its position in the collection, so the lightbox
  // arrows keep walking the collection's own order.
  function makeTile(photo, index, total, sizes) {
    var tile = el("button", "tile");
    tile.type = "button";
    tile.setAttribute("aria-label", CAPTIONS.grid.title && photo.title
      ? "View " + photo.title + " larger"
      : "View photograph " + (index + 1) + " of " + total + " larger");

    var img = el("img");
    responsive(img, photo, sizes || tileSizes(1), photo.thumb || photo.src);
    // A cell that crops trims evenly from both ends unless the photograph
    // says otherwise: `"focus": "center bottom"` in photos.json keeps a long
    // tail that would otherwise lose its tip.
    if (photo.focus) img.style.objectPosition = photo.focus;
    img.alt = altFor(photo);
    img.loading = index < 8 ? "eager" : "lazy";
    img.decoding = "async";
    img.dataset.loaded = "false";

    var reveal = function () { img.dataset.loaded = "true"; };
    if (img.complete) reveal();
    else {
      img.addEventListener("load", reveal, { once: true });
      img.addEventListener("error", reveal, { once: true });
    }
    tile.appendChild(img);

    var showTitle = CAPTIONS.grid.title && photo.title;
    var showPlace = CAPTIONS.grid.location && photo.location;
    if (showTitle || showPlace) {
      var label = el("span", "tile-label");
      if (showTitle) {
        var t = el("span", "tile-title");
        t.textContent = photo.title;
        label.appendChild(t);
      }
      if (showPlace) {
        var place = el("span", "tile-place");
        place.textContent = photo.location;
        label.appendChild(place);
      }
      tile.appendChild(label);
    }

    tile.addEventListener("click", function () { open(index); });
    return tile;
  }

  // The opener: whichever photograph is flagged `featured`, else the first.
  // A landscape spans the window and is trimmed to its height; an upright is
  // never cropped. See .book-opener in site.css.
  function renderOpener(photos) {
    var slot = document.querySelector(".book-opener");
    if (!slot) return 0;

    var at = 0;
    for (var n = 0; n < photos.length; n++) { if (photos[n].featured) { at = n; break; } }
    var photo = photos[at];

    var upright = aspectOf(photo) <= 0.95;
    var img = el("img");
    // A landscape opener is always the window's width (trimmed to its height,
    // never shrunk), so it asks for 100vw. An upright is capped at
    // --opener-h-upright, repeated here rather than read from the stylesheet
    // because a custom property holding a length comes back as text.
    responsive(img, photo, upright ? cappedSizes(photo, 88) : "100vw");
    // Where the trim falls when the window is wider than the photograph.
    if (photo.focus) img.style.objectPosition = photo.focus;
    img.alt = altFor(photo);
    img.decoding = "async";

    slot.textContent = "";
    slot.classList.toggle("is-upright", upright);
    slot.appendChild(img);
    slot.addEventListener("click", function () { open(at); });
    return at;
  }

  function renderGrid(photos, layout) {
    var grid = document.getElementById("grid");
    var lead = document.querySelector(".book-lead");

    if (!photos.length) {
      // An empty collection has no opener either — otherwise the page starts
      // with a tall band of nothing above the message.
      if (lead) lead.hidden = true;
      status(grid, "Photographs from this trip haven't been added yet.");
      return;
    }
    if (lead) lead.hidden = false;

    var openerAt = renderOpener(photos);
    var rest = [];
    photos.forEach(function (p, i) { if (i !== openerAt) rest.push({ photo: p, at: i }); });

    grid.textContent = "";
    var frag = document.createDocumentFragment();

    composeBlocks(rest.map(function (r) { return r.photo; }), layout)
      .forEach(function (step) {
      var row = el("div", "book-row");
      var cursor = step.from;

      if (!step.block) {
        var lone = rest[cursor];
        var upright = famOf(lone.photo) === "P";
        var col = el("div", "book-col");
        col.style.flex = "0 0 " + (upright ? 34 : 100) + "%";
        var soloShare = upright ? 0.34 : 1;                        // the flex above
        var soloTile = makeTile(lone.photo, lone.at, photos.length,
                                tileSizes(soloShare));
        soloTile.classList.add("is-natural");
        soloTile.style.setProperty("--cell-ar", aspectOf(lone.photo).toFixed(4));
        col.appendChild(soloTile);
        if (upright) row.className = "book-row is-solo";
        row.appendChild(col);
        frag.appendChild(row);      // must go in the fragment like every other
        return;                     // row, or it jumps ahead of all of them
      }

      if (step.block.cls) row.classList.add(step.block.cls);
      // A justified row shares its width out by aspect ratio (see J2).
      var arSum = 0;
      if (step.block.just) {
        for (var j = 0; j < step.block.need.length; j++) arSum += aspectOf(rest[step.from + j].photo);
      }
      step.block.cols.forEach(function (spec) {
        var col = el("div", "book-col");
        var w = step.block.just ? aspectOf(rest[cursor].photo) / arSum * 100 : spec.w;
        // Grow from a zero basis rather than a percentage: the gaps come out
        // of the free space first, so the columns still add up to exactly the
        // row's width. Percentages summing to 100 plus a gap overflow it.
        col.style.flex = w + " 1 0";
        for (var n = 0; n < spec.take; n++) {
          var item = rest[cursor++];
          var tile = makeTile(item.photo, item.at, photos.length,
                              tileSizes(w / 100, spec.ph));
          if (spec.nat) {
            tile.classList.add("is-natural");
            tile.style.setProperty("--cell-ar", aspectOf(item.photo).toFixed(4));
          } else if (spec.ar) {
            tile.classList.add("is-anchor");
            tile.style.setProperty("--cell-ar", String(spec.ar));
          }
          col.appendChild(tile);
        }
        row.appendChild(col);
      });

      frag.appendChild(row);
    });

    grid.appendChild(frag);
  }

  function show(i) {
    if (!shown.length) return;
    index = (i + shown.length) % shown.length;       // wrap at both ends

    var photo = shown[index];
    // .lb-image is capped at roughly 80vh once the caption is allowed for.
    lbImage.removeAttribute("srcset");        // or the old one races the new
    responsive(lbImage, photo, cappedSizes(photo, 80));
    lbImage.alt = altFor(photo);
    lbTitle.textContent = (CAPTIONS.lightbox.title && photo.title) || "";
    lbMeta.textContent = metaLine(photo);
    lbExif.textContent = exifLine(photo);

    // With every caption off there is no text block, so let the photograph
    // use the height the caption would have taken.
    lightbox.classList.toggle("is-bare",
      !lbTitle.textContent && !lbMeta.textContent && !lbExif.textContent);

    // Warm the neighbours so arrowing through feels instant.
    [index + 1, index - 1].forEach(function (n) {
      var next = shown[(n + shown.length) % shown.length];
      // Warm the same file the lightbox will actually ask for — preloading
      // the 4000px original when it will display the 2400px one downloads
      // both.
      if (next) responsive(new Image(), next, cappedSizes(next, 80));
    });
  }

  function open(i) {
    show(i);
    if (isOpen) return;
    isOpen = true;
    lightbox.hidden = false;
    body.classList.add("lb-open");
    lightbox.querySelector(".lb-close").focus();
    // Lets the phone's Back gesture close the viewer rather than leave the page.
    try { history.pushState({ lb: true }, ""); } catch (e) { /* file:// */ }
  }

  function close(fromPopstate) {
    if (!isOpen) return;
    isOpen = false;
    lightbox.hidden = true;
    lbImage.removeAttribute("src");
    body.classList.remove("lb-open");
    if (!fromPopstate && history.state && history.state.lb) {
      try { history.back(); } catch (e) { /* no-op */ }
    }
  }

  function wireLightbox() {
    lightbox = document.getElementById("lightbox");
    if (!lightbox) return;
    lbImage = lightbox.querySelector(".lb-image");
    lbTitle = lightbox.querySelector(".lb-title");
    lbMeta  = lightbox.querySelector(".lb-meta");
    lbExif  = lightbox.querySelector(".lb-exif");

    lightbox.querySelector(".lb-close").addEventListener("click", function () { close(false); });
    lightbox.querySelector(".lb-prev").addEventListener("click", function () { show(index - 1); });
    lightbox.querySelector(".lb-next").addEventListener("click", function () { show(index + 1); });

    // Backdrop closes; the photograph and caption don't.
    lightbox.addEventListener("click", function (ev) {
      if (ev.target === lightbox || ev.target.classList.contains("lb-figure")) close(false);
    });

    window.addEventListener("popstate", function () { close(true); });

    document.addEventListener("keydown", function (ev) {
      if (!isOpen) return;
      if (ev.key === "Escape") close(false);
      else if (ev.key === "ArrowRight") show(index + 1);
      else if (ev.key === "ArrowLeft") show(index - 1);
      else return;
      ev.preventDefault();
    });

    var startX = null, startY = null;
    lightbox.addEventListener("touchstart", function (ev) {
      startX = ev.changedTouches[0].clientX;
      startY = ev.changedTouches[0].clientY;
    }, { passive: true });

    lightbox.addEventListener("touchend", function (ev) {
      if (startX === null) return;
      var dx = ev.changedTouches[0].clientX - startX;
      var dy = ev.changedTouches[0].clientY - startY;
      // Horizontal intent only, and far enough not to be a stray tap.
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) show(dx < 0 ? index + 1 : index - 1);
      startX = startY = null;
    }, { passive: true });
  }

  function renderGallery(collections, photos) {
    var slug = body.dataset.collection;
    var meta = collections.filter(function (c) { return c.slug === slug; })[0] || {};
    collectionName = meta.title || "";           // used for alt text

    var titleEl = document.querySelector(".gallery-title");
    var dateEl  = document.querySelector(".gallery-date");
    var subEl   = document.querySelector(".gallery-sub");
    var blurbEl = document.querySelector(".gallery-blurb");

    if (titleEl && meta.title) {
      titleEl.textContent = meta.title;
      document.title = meta.title + " — Newton Liu Photography";
    }
    if (subEl)   subEl.textContent   = meta.subtitle || "";
    if (blurbEl) blurbEl.textContent = meta.blurb || "";

    shown = photos.filter(function (p) { return p.collection === slug; });

    // A collection's own "date" overrides the one derived from capture dates;
    // an empty one ("date": "") hides the line altogether.
    if (dateEl) dateEl.textContent =
      typeof meta.date === "string" ? meta.date : collectionDate(shown);

    // "opener": "whole" shows the opening photograph entire, below the bar,
    // rather than trimmed to the window. See .book-lead.is-whole in site.css.
    var lead = document.querySelector(".book-lead");
    if (lead) lead.classList.toggle("is-whole", meta.opener === "whole");
    renderGrid(shown, meta.layout);
    wireLightbox();
  }

  /* ---------- boot ------------------------------------------------------ */

  var target = document.getElementById("collection-grid") || document.getElementById("grid");
  if (!target) return;

  Promise.all([getJSON("data/collections.json"), getJSON("data/photos.json")])
    .then(function (results) {
      var collections = (results[0] && results[0].collections) || [];
      var photos = (results[1] && results[1].photos) || [];
      if (PAGE === "gallery") renderGallery(collections, photos);
      else renderHome(collections, photos);
    })
    .catch(function (err) {
      // Nearly always this: opened as a file:// URL, where fetch is blocked.
      status(target, location.protocol === "file:"
        ? "Open this site through a local server, not by double-clicking the file — run: python3 -m http.server 8000"
        : "Couldn't load the site data. " + err.message);
    });
})();
