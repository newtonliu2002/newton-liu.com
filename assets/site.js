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
  // Also available but deliberately not shown: "focal" (e.g. "500mm").
  var EXIF_FIELDS = ["camera", "lens", "aperture", "shutter", "iso"];

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
      heroMedia.style.backgroundImage = "url('" + url(hero.src) + "')";
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
        img.src = url(cover.thumb || cover.src);
        img.alt = "";                    // decorative; the title carries meaning
        img.loading = "lazy";
        img.decoding = "async";
        card.appendChild(img);
      }

      var count = el("span", "card-count");
      count.textContent = shots.length
        ? shots.length + (shots.length === 1 ? " photo" : " photos")
        : "coming soon";
      card.appendChild(count);

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

  function renderGrid(photos) {
    var grid = document.getElementById("grid");
    if (!photos.length) {
      status(grid, "Photographs from this trip haven't been added yet.");
      return;
    }

    grid.textContent = "";
    var frag = document.createDocumentFragment();

    photos.forEach(function (photo, i) {
      var tile = el("button", "tile");
      tile.type = "button";
      tile.style.setProperty("--ar", aspectOf(photo).toFixed(4));
      tile.setAttribute("aria-label", CAPTIONS.grid.title && photo.title
        ? "View " + photo.title + " larger"
        : "View photograph " + (i + 1) + " of " + photos.length + " larger");

      var img = el("img");
      img.src = url(photo.thumb || photo.src);
      img.alt = altFor(photo);
      img.loading = i < 8 ? "eager" : "lazy";   // first rows shouldn't fade in late
      img.decoding = "async";
      img.dataset.loaded = "false";

      var reveal = function () { img.dataset.loaded = "true"; };
      if (img.complete) reveal();
      else {
        img.addEventListener("load", reveal, { once: true });
        // A missing file shouldn't leave an invisible hole in the grid.
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

      tile.addEventListener("click", function () { open(i); });
      frag.appendChild(tile);
    });

    grid.appendChild(frag);
  }

  function show(i) {
    if (!shown.length) return;
    index = (i + shown.length) % shown.length;       // wrap at both ends

    var photo = shown[index];
    lbImage.src = url(photo.src);
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
      if (next) { var pre = new Image(); pre.src = url(next.src); }
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
