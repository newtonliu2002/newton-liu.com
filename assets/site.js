/* ==========================================================================
   newton-liu.com — the whole of the site's behaviour.

   Two page types, told apart by <body data-page="...">:
     home     — renders the hero image and the collection cards
     gallery  — renders one collection's justified photo grid + the lightbox

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

  // Photo paths in the manifest are root-relative; make them page-relative.
  function url(src) { return BASE + src; }

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
  function tileSizes(share) {
    return "(max-width: 1000px) " + Math.round(share * 100) + "vw, " +
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
    return Math.max(0.4, Math.min(4, w / h));   // clamp so nothing wrecks a row
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

  Array.prototype.forEach.call(document.querySelectorAll("[data-year]"), function (n) {
    n.textContent = String(new Date().getFullYear());
  });

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
      var cover = c.cover ? { src: c.cover } : shots[0];

      var card = el("a", "collection-card" + (shots.length ? "" : " is-empty"));
      card.href = BASE + "collections/" + c.slug + "/";

      if (cover) {
        var img = el("img");
        // Cards are a 20rem-minimum auto-fill grid inside --wrap, so they land
        // near 380px on a desktop and go full width on a phone.
        responsive(img, cover, "(max-width: 700px) 100vw, 380px",
                   cover.thumb || cover.src);
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
    var f = famOf(photo);
    return need === "S" ? f !== "W" : need === f;
  }

  // w: share of the row's width. ar: aspect-ratio, on the anchor cell only.
  // pri: tried first when several templates fit. Higher wins.
  var BLOCKS = [
    // Uprights are rarer than landscapes and suffer most from being squeezed,
    // so a block led by one is preferred and gives it the dominant cell: full
    // row height at nearly half the width, with two landscapes stacked beside.
    { pri: 2, need: ["P", "L", "L"],
      cols: [{ w: 46, ar: 0.78, take: 1 }, { w: 54, take: 2 }] },
    { pri: 2, need: ["L", "L", "P"],
      cols: [{ w: 54, take: 2 }, { w: 46, ar: 0.78, take: 1 }] },

    { need: ["L", "L", "L"],                       // big left, two stacked right
      cols: [{ w: 62, ar: 1.45, take: 1 }, { w: 38, take: 2 }] },
    { need: ["L", "L"],                            // unequal pair
      cols: [{ w: 56, ar: 1.62, take: 1 }, { w: 44, take: 1 }] },
    { need: ["L", "L", "L"],                       // three across
      cols: [{ w: 34, ar: 1.42, take: 1 }, { w: 33, take: 1 }, { w: 33, take: 1 }] },
    { need: ["L", "L", "L"],                       // two stacked left, big right
      cols: [{ w: 38, take: 2 }, { w: 62, ar: 1.45, take: 1 }] },
    { need: ["L", "P"],                            // landscape, upright beside it
      cols: [{ w: 66, take: 1 }, { w: 34, ar: 0.76, take: 1 }] },
    { need: ["P", "L"],
      cols: [{ w: 34, ar: 0.76, take: 1 }, { w: 66, take: 1 }] },
    { need: ["P", "P"],                            // two uprights
      cols: [{ w: 50, ar: 0.78, take: 1 }, { w: 50, take: 1 }] },

    // Square-cropping discards the most of a photograph, so it's the last
    // arrangement tried rather than one of the first.
    { pri: -1, need: ["S", "S"],
      cols: [{ w: 50, ar: 1, take: 1 }, { w: 50, take: 1 }] }
  ];

  var WIDE = { need: ["W"], cols: [{ w: 100, ar: 2.45, take: 1 }] };

  // Best-fitting template at this position, or null. `k` rotates the search so
  // that among equally-suited templates the same one doesn't repeat.
  function pickBlock(photos, i, left, k) {
    var best = null, bestScore = -Infinity;

    for (var n = 0; n < BLOCKS.length; n++) {
      var at = (k + n) % BLOCKS.length;
      var cand = BLOCKS[at];
      if (cand.need.length > left) continue;

      var ok = true;
      for (var j = 0; j < cand.need.length; j++) {
        if (!cellFits(cand.need[j], photos[i + j])) { ok = false; break; }
      }
      if (!ok) continue;

      // Priority dominates; the rotation only breaks ties between equals.
      var score = (cand.pri || 0) * 100 - n;
      if (score > bestScore) { bestScore = score; best = { block: cand, at: at }; }
    }
    return best;
  }

  function composeBlocks(photos) {
    var out = [];
    var i = 0, k = 0, guard = 0;

    while (i < photos.length && guard++ < 500) {
      var left = photos.length - i;
      var block = null;

      if (famOf(photos[i]) === "W") {
        block = WIDE;
      } else {
        var hit = pickBlock(photos, i, left, k);
        if (hit) { block = hit.block; k = (hit.at + 1) % BLOCKS.length; }
      }

      if (block) {
        out.push({ block: block, from: i });
        i += block.need.length;
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
  // Never cropped — it keeps its own ratio and the full width of the page.
  function renderOpener(photos) {
    var slot = document.querySelector(".book-opener");
    if (!slot) return 0;

    var at = 0;
    for (var n = 0; n < photos.length; n++) { if (photos[n].featured) { at = n; break; } }
    var photo = photos[at];

    var upright = aspectOf(photo) <= 0.95;
    var img = el("img");
    // 76vh, or 84vh upright — the max-height on .book-opener img in the CSS.
    responsive(img, photo, cappedSizes(photo, upright ? 84 : 76));
    img.alt = altFor(photo);
    img.decoding = "async";

    slot.textContent = "";
    slot.classList.toggle("is-upright", upright);
    slot.appendChild(img);
    slot.addEventListener("click", function () { open(at); });
    return at;
  }

  function renderGrid(photos) {
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

    composeBlocks(rest.map(function (r) { return r.photo; })).forEach(function (step) {
      var row = el("div", "book-row");
      var cursor = step.from;

      if (!step.block) {
        var lone = rest[cursor];
        var col = el("div", "book-col");
        col.style.flex = "0 0 " + (famOf(lone.photo) === "P" ? 34 : 72) + "%";
        var soloShare = famOf(lone.photo) === "P" ? 0.34 : 0.72;   // the flex below
        var soloTile = makeTile(lone.photo, lone.at, photos.length,
                                tileSizes(soloShare));
        soloTile.classList.add("is-natural");
        soloTile.style.setProperty("--cell-ar", aspectOf(lone.photo).toFixed(4));
        col.appendChild(soloTile);
        row.className = "book-row is-solo";
        row.appendChild(col);
        frag.appendChild(row);      // must go in the fragment like every other
        return;                     // row, or it jumps ahead of all of them
      }

      step.block.cols.forEach(function (spec) {
        var col = el("div", "book-col");
        // Grow from a zero basis rather than a percentage: the gaps come out
        // of the free space first, so the columns still add up to exactly the
        // row's width. Percentages summing to 100 plus a gap overflow it.
        col.style.flex = spec.w + " 1 0";
        for (var n = 0; n < spec.take; n++) {
          var item = rest[cursor++];
          var tile = makeTile(item.photo, item.at, photos.length,
                              tileSizes(spec.w / 100));
          if (spec.ar) {
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

    if (dateEl) dateEl.textContent = meta.date || collectionDate(shown);
    renderGrid(shown);
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
