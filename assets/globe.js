/* ==========================================================================
   newton-liu.com — the globe landing.

   A slowly turning globe with a pin wherever a collection was photographed,
   and the list of collections beside it. Pointing at a row or pin lights
   that collection; clicking flies there and opens a card with its opening
   photograph. The list is the accessible way to the same thing: keyboard
   and screen-reader users get plain links.

   Places come from data/places.json (region level only, never a
   photograph's own position); the rest from the collections.json and
   photos.json the galleries read. Photograph URLs and sizes go through
   window.NLSite (site.js), so the landing follows whatever site.js does.
   MapLibre arrives as a module from index.html ("maplibre:ready", ":failed"
   or ":deferred" on Save-Data); without it the list still works alone.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------
     LABELS — every word this script puts on the page. Functional only:
     titles, places and dates all come from the data.
     ------------------------------------------------------------------ */
  // The two toggles keep one name and say their state with aria-pressed;
  // only the tooltips change.
  var LABELS = {
    tour: "Tour", tourTip: "Tour",
    overview: "Back to overview", overviewTip: "Overview",
    pause: "Pause globe", pauseTip: "Pause", resumeTip: "Resume",
    view: "View collection", arrow: "→", prev: "‹", next: "›", close: "×",
    index: "Index", load: "Load globe",
    unavailable: "Globe unavailable. The collections are listed here.",
    noData: "Couldn't load the collections.",
    showing: "Showing {title}.", again: "Select again to open the collection.",
    tourStarted: "Tour started.", tourEnded: "Tour ended.",
    rOverview: "Overview", rUnavailable: "Globe unavailable", rDeferred: "Globe not loaded", rTour: "Tour · ",
    gestures: "Use two fingers to turn the globe",
    north: "N", south: "S", east: "E", west: "W"
  };

  /* ------------------------------------------------------------------
     Switches and numbers.
     ------------------------------------------------------------------ */
  var STARS = true;                  // the faint static starfield behind the globe
  var OVERVIEW_LAT = 25;             // the overview looks at this latitude
  var MAX_ZOOM = 9;                  // elevation data stops at 9, so does the camera
  var ARRIVE_ZOOM = 7.8;             // single-pin arrival when places.json gives none
  var SENSITIVE_ZOOM = 7;            // never closer than this for a `sensitive` collection
  var SPIN = 1.5;                    // degrees per second
  var SPIN_RESUME = 1000, SPIN_RAMP = 800;
  var HOVER_DELAY = 120, TURN_DELAY = 450;
  var DWELL = 6000, DWELL_REDUCED = 8000;
  var FAIL_AFTER = 8000;             // no map by then and the list is all there is
  var TERRAIN_EXAGGERATION = 1.25;
  var SPLIT = 3, FLIGHT_SPLIT = 6.5; // see setSplit()
  var FOV = 36.87;                   // MapLibre's vertical field of view

  var TILES = "https://tiles.openfreemap.org/planet";
  var GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
  var DEM = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
  var ATTR_TILES = '<a href="https://openfreemap.org">OpenFreeMap</a> ' +
    '<a href="https://www.openmaptiles.org/">© OpenMapTiles</a> ' +
    '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';
  var ATTR_DEM = '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>';

  /* ------------------------------------------------------------------
     PALETTE — the map's colours on each ground. Black is the default;
     White, a paper atlas, is <html data-theme="light">, set by the square
     at the end of the nav (site.js). buildStyle() reads the current one,
     and applyPalette() repaints the map in place when the ground changes.
     What sits over the map in HTML (pins, labels, ring, card) takes its
     colours from the --g-* properties in globe.css; the two must agree.
     ------------------------------------------------------------------ */
  function W(a) { return "rgba(255,255,255," + a + ")"; }
  function K(a) { return "rgba(0,0,0," + a + ")"; }
  var PALETTE = {
    black: {
      meta: "#050505", stars: true,               // browser chrome = --space
      land: "#161616", sea: "#0a0a0a", ice: W(.04), park: W(.025), parkEdge: W(.16),
      coast: W(.16), river: W(.06), border: W(.16), state: W(.08),
      country: W(.28), stateName: W(.14), parkName: W(.24),
      shadow: "#000000", highlight: W(.18), accent: "#0a0a0a",
      line: "#fff", trail: .22,                   // tether and tour trail: colour; the trail's opacity
      horizon: W(.06), fog: "#050505"
    },
    white: {
      meta: "#f4f4f2", stars: false,
      land: "#dededa", sea: "#ecece9", ice: W(.4), park: K(.035), parkEdge: K(.22),
      coast: K(.28), river: K(.07), border: K(.18), state: K(.09),
      country: K(.45), stateName: K(.26), parkName: K(.4),
      shadow: K(.42), highlight: "#ffffff", accent: K(.08),
      line: "#000", trail: .3,
      horizon: K(.04), fog: "#f4f4f2"
    }
  };
  function ground() { return document.documentElement.getAttribute("data-theme") === "light" ? "white" : "black"; }
  function pal() { return PALETTE[ground()]; }

  // The card's photograph is the card's width on a laptop, and the width of
  // the screen less its margins on a phone, where the card leads with it;
  // the plate is always 200px. See .g-card and .g-plate in globe.css.
  var CARD_SIZES = "(min-width: 1024px) max(360px, min(520px, 34vw)), min(440px, 100vw - 32px)";
  var PLATE_SIZES = "200px";

  function query(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  var COARSE = query("(pointer: coarse)");
  var REDUCED = query("(prefers-reduced-motion: reduce)");
  var SAVE_DATA = !!(navigator.connection && navigator.connection.saveData);
  var TERRAIN_3D = !COARSE && !SAVE_DATA && !REDUCED;   // phones get hillshade only
  var EDITING = /[?&]edit\b/.test(location.search);
  var APP = "(min-width: 1024px) and (min-height: 620px)";
  var rad = Math.PI / 180;

  /* ---------- small helpers ------------------------------------------ */

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function now() { return window.performance ? performance.now() : Date.now(); }
  function easeInOut(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function session(key, value) {            // storage can be blocked; the page works without it
    try {
      if (value === undefined) return sessionStorage.getItem(key);
      sessionStorage.setItem(key, value);
    } catch (e) {}
    return null;
  }

  // Great-circle geometry on [lng, lat] pairs.
  function vec(p) {
    var l = p[0] * rad, b = p[1] * rad;
    return [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
  }
  function angle(a, b) {
    var u = vec(a), v = vec(b);
    return Math.acos(clamp(u[0] * v[0] + u[1] * v[1] + u[2] * v[2], -1, 1)) / rad;
  }
  // A line through `pts` that follows the great circles between them, 32
  // points a segment, with longitudes kept continuous across the antimeridian.
  function arcs(pts) {
    var out = [];
    for (var i = 0; i + 1 < pts.length; i++) {
      var u = vec(pts[i]), v = vec(pts[i + 1]), d = angle(pts[i], pts[i + 1]) * rad, s = Math.sin(d);
      for (var j = i ? 1 : 0; j <= 32; j++) {
        var t = j / 32, k1 = s ? Math.sin((1 - t) * d) / s : 1 - t, k2 = s ? Math.sin(t * d) / s : t;
        var x = k1 * u[0] + k2 * v[0], y = k1 * u[1] + k2 * v[1], z = k1 * u[2] + k2 * v[2];
        out.push([Math.atan2(y, x) / rad, Math.atan2(z, Math.sqrt(x * x + y * y)) / rad]);
      }
    }
    for (var n = 1; n < out.length; n++) {
      while (out[n][0] - out[n - 1][0] > 180) out[n][0] -= 360;
      while (out[n][0] - out[n - 1][0] < -180) out[n][0] += 360;
    }
    return out;
  }
  function merc(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * rad / 2)); }
  function lines(groups) {
    return { type: "FeatureCollection", features: groups.map(function (g) {
      return { type: "Feature", properties: { o: g.o }, geometry: { type: "LineString", coordinates: arcs(g.pts) } };
    }) };
  }

  /* ---------- the page ------------------------------------------------- */

  var body = document.body;
  var NL = window.NLSite;
  var BASE = body.dataset.base || "";
  var stage = $("#g-stage"), mapEl = $("#g-map"), ring = $(".g-ring"), starsEl = $(".g-stars");
  var listEl = $("#g-list"), panel = $(".g-panel"), live = $("#g-live"), readEl = $(".g-readout");
  var card = $(".g-card"), plate = $(".g-plate"), consoleEl = $(".g-console");
  var tourBtn = $(".g-tour"), pauseBtn = $(".g-pause"), overviewBtn = $(".g-overview");
  var fallback = $(".g-fallback"), loadBtn = $(".g-load");
  var wireP = $(".g-wire-p"), wireC = $(".g-wire-c"), wireEnd = $(".g-wire-end");
  if (!stage || !listEl) return;

  // site.js has just set the browser chrome to the gallery ground.
  var themeMeta = $('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = pal().meta;

  function setLabel(btn, label, tip) { btn.setAttribute("aria-label", label); btn.title = tip; }
  setLabel(tourBtn, LABELS.tour, LABELS.tourTip);
  setLabel(overviewBtn, LABELS.overview, LABELS.overviewTip);
  $(".g-fallback p").textContent = LABELS.unavailable;
  loadBtn.textContent = LABELS.load;
  $(".g-index-link").firstChild.nodeValue = LABELS.index + " ";
  $(".g-card-go-label").textContent = LABELS.view;
  $(".g-card-go-arrow").textContent = LABELS.arrow;
  $(".g-card-prev").textContent = LABELS.prev;
  $(".g-card-next").textContent = LABELS.next;
  $(".g-card-close").textContent = LABELS.close;

  /* ---------- state ------------------------------------------------------ */

  // bySlug has no prototype, and has() asks for its own keys only, so a
  // hash or a referrer like "#constructor" can never pass for a collection.
  var cols = [], bySlug = Object.create(null);   // collections, in list order
  function has(slug) { return typeof slug === "string" && Object.prototype.hasOwnProperty.call(bySlug, slug); }
  var pins = [];                            // every pin, in list order
  var map = null, ml = null, attribution = null;
  var dataReady = false, ready = false, failed = false, deferred = false, failTimer = 0;
  var state = "intro";                      // intro · overview · selecting · arrived · free · returning
  var active = null, lit = null, tour = false;
  var flight = 0;                           // bumps on every camera move we start
  var L = null;                             // current layout, see measure()
  var deep = null, recent = null;
  var visited = {};
  try { (JSON.parse(session("nl.visited") || "[]") || []).forEach(function (s) { visited[s] = 1; }); } catch (e) {}

  /* ------------------------------------------------------------------
     LAYOUT. "App" (≥1024×620): the globe sits in the free area right of
     the panel, 64px from the top, 108px from the bottom. "Stacked": it
     fills a stage atop the page. The overview zoom makes the globe's
     outline exactly --d in globe.css, so the ring there matches it.
     ------------------------------------------------------------------ */

  function edge() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--edge")) || 16; }

  // MapLibre's globe radius in px, enlarged by 1/cos of the centre latitude,
  // and the radius of its silhouette as its perspective camera sees it.
  function globeR(z, lat) { return 512 * Math.pow(2, z) / (2 * Math.PI) / Math.cos(lat * rad); }
  function focal(h) { return h / 2 / Math.tan(FOV / 2 * rad); }
  function silhouette(z, lat, h) {
    var f = focal(h), R = globeR(z, lat), D = f + R;
    return f * R / Math.sqrt(D * D - R * R);
  }
  // How far round the globe the camera can see, in degrees from its centre.
  function horizon(z, lat, h) { var R = globeR(z, lat); return Math.acos(R / (focal(h) + R)) / rad; }

  function measure() {
    var w = stage.clientWidth, h = stage.clientHeight, e = edge(), app = query(APP);
    var o = { app: app, w: w, h: h, e: e, F: e + 312 };
    o.pad = app ? { top: 64, right: e, bottom: 108, left: o.F } : { top: 16, right: 16, bottom: 72, left: 16 };
    var D = (app ? .9 : .96) * Math.min(w - o.pad.left - o.pad.right, h - o.pad.top - o.pad.bottom);
    var lo = -2, hi = 6;
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (silhouette(mid, OVERVIEW_LAT, h) * 2 < D) lo = mid; else hi = mid;
    }
    o.zO = Math.max(lo, 1);          // below zoom 1 the one world tile is too big to draw as a globe
    return o;
  }

  function cardWidth() { return clamp(.34 * L.w, 360, 520); }
  function selectPadding() {
    if (L.app) return { top: 80, right: cardWidth() + L.e + 40, bottom: 108, left: L.F };
    // Stacked: clear of the docked card, wherever it sits (it rises above the
    // console during the tour). offsetTop ignores the card's entry transform.
    // And below the attribution, which pins never sit under.
    var top = card.offsetHeight ? card.offsetTop : L.h - 112, at = geom().attrib;
    return { top: Math.max(16, at ? at[3] + 8 : 0), right: 16, bottom: Math.max(72, L.h - top + 12), left: 16 };
  }
  // MapLibre draws the globe larger at the same zoom the further from the
  // equator it looks (globeR), and measures its zoom floor (floorZoom) at
  // the latitude under the camera, which a tilted camera leaves well behind
  // the point it looks at. sizeZoom() measures the same way, in the
  // overview's terms: L.zO is the overview, and as far out as the camera
  // can go, at any latitude and any tilt.
  function latShift(lat) { return Math.log(Math.cos(lat * rad) / Math.cos(OVERVIEW_LAT * rad)) / Math.LN2; }
  function cameraLat() {
    var lat = map.getCenter().lat, p = map.getPitch() * rad, d = focal(L.h);
    var th = Math.atan2(d * Math.sin(p), globeR(map.getZoom(), lat) + d * Math.cos(p));
    var s = Math.sin(lat * rad) * Math.cos(th) - Math.cos(lat * rad) * Math.sin(th) * Math.cos(map.getBearing() * rad);
    return Math.asin(clamp(s, -1, 1)) / rad;
  }
  function sizeZoom() { return map.getZoom() - latShift(cameraLat()); }
  function inOverview() { return !!map && !active && sizeZoom() <= L.zO + .6; }
  // A camera that already is the overview: globe zoom, level, no relief.
  function level() {
    return sizeZoom() <= L.zO + .6 && map.getPitch() < .5 && Math.abs(map.getBearing()) < .5 && !map.getTerrain();
  }
  // The overview is as far out as the camera goes. MapLibre's globe reads
  // its minZoom at the equator and keeps the globe that size at any
  // latitude, so the floor is the overview's zoom carried to the equator.
  // Until the style has loaded the map is flat and reads it as it stands,
  // so until then the floor is the overview's own zoom.
  function floorZoom() { return ready ? L.zO + latShift(0) : L.zO; }

  /* ---------- stars ------------------------------------------------------ */

  // Static and seeded, so the sky is the same on every visit. Paper has none.
  function drawStars() {
    var on = STARS && pal().stars;
    starsEl.hidden = !on;
    if (!on || !starsEl.getContext) return;
    var w = stage.clientWidth, h = stage.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    starsEl.width = Math.round(w * dpr); starsEl.height = Math.round(h * dpr);
    var ctx = starsEl.getContext("2d"), seed = 20261013;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (var n = Math.round(w * h / 7000); n > 0; n--) {
      var x = rnd() * w, y = rnd() * h, s = rnd() < .9 ? 1 : 1.5;
      ctx.fillStyle = "rgba(255,255,255," + (.08 + .22 * rnd()).toFixed(3) + ")";
      ctx.fillRect(Math.round(x), Math.round(y), s, s);
    }
  }

  /* ------------------------------------------------------------------
     DATA
     ------------------------------------------------------------------ */

  function plainJSON(path) {
    return fetch(BASE + path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path);
      return r.json();
    });
  }
  var getJSON = NL ? NL.getJSON : plainJSON;

  // The opener and the date line follow the gallery's own rules: the
  // `featured` photograph else the first; `date` if set, else derived.
  function joinData(collections, photos, places) {
    var byCol = {};
    photos.forEach(function (p) { (byCol[p.collection] = byCol[p.collection] || []).push(p); });
    collections.forEach(function (c, i) {
      var shots = byCol[c.slug] || [], pl = places[c.slug] || {};
      var opener = shots.filter(function (p) { return p.featured; })[0] || shots[0] || null;
      var derived = NL && shots.length ? NL.collectionDate(shots) : "";
      var date = typeof c.date === "string" ? c.date : derived;   // "" hides it, year and all
      var year = /\d{4}/.exec(date) || [""];
      var col = {
        slug: c.slug, title: c.title || c.slug, sub: c.subtitle || "", date: date, year: year[0],
        where: pl.where || "", zoom: pl.zoom, sensitive: !!pl.sensitive, i: i, opener: opener,
        href: BASE + "collections/" + c.slug + "/", pins: []
      };
      (pl.pins || []).forEach(function (p) {
        if (typeof p.lat === "number" && typeof p.lng === "number") col.pins.push({ name: p.name || "", ll: [p.lng, p.lat] });
      });
      cols.push(col);
      bySlug[c.slug] = col;
    });
  }

  /* ------------------------------------------------------------------
     THE LIST: ordinary links. A pointer click on a row not already open
     flies there instead; a second click, Enter, or a modified click
     follows the link as usual.
     ------------------------------------------------------------------ */

  function renderList() {
    listEl.textContent = "";
    var lastYear = "";
    cols.forEach(function (c) {
      var li = el("li"), a = el("a", "g-row");
      a.href = c.href;
      a.setAttribute("data-slug", c.slug);
      a.appendChild(el("span", "g-row-mark")).setAttribute("aria-hidden", "true");
      a.appendChild(el("span", "g-row-title", c.title));
      if (c.where) a.appendChild(el("span", "g-row-where", c.where));
      if (c.year && c.year !== lastYear) a.appendChild(el("span", "g-row-year", c.year)).setAttribute("aria-hidden", "true");
      if (c.year) lastYear = c.year;
      if (visited[c.slug]) a.classList.add("is-visited");
      if (!c.where) a.classList.add("is-one");
      c.row = a;
      li.appendChild(a);
      listEl.appendChild(li);

      a.addEventListener("pointerenter", function (e) { if (e.pointerType !== "touch") hoverIn(c.slug); });
      a.addEventListener("pointerleave", hoverOut);
      // Keyboard focus lights the row as hover does; the focus a click or a
      // tap leaves behind does not (the pointer already said what it meant).
      a.addEventListener("focus", function () { if (byKeyboard()) hoverIn(c.slug); });
      a.addEventListener("blur", function () { if (lit === c.slug || pending === c.slug) hoverOut(); });
      a.addEventListener("click", function (e) {
        if (!ready || failed || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (e.detail === 0 || active === c.slug) return;        // keyboard, or the second click
        e.preventDefault();
        var r = stage.getBoundingClientRect(), bar = $(".nl-bar"), top0 = bar ? bar.offsetHeight : 0;
        var seen = (Math.min(r.bottom, window.innerHeight) - Math.max(r.top, top0)) / r.height;
        if (!L.app && seen < .6) {          // a phone held sideways: bring the globe back first
          stage.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });   // its scroll-margin clears the ?edit bar
          setTimeout(function () { select(c.slug, "row"); }, 300);
        } else select(c.slug, "row");
      });
    });
    listEl.classList.add("is-new");
    listEl.addEventListener("scroll", overflowCheck, { passive: true });
    overflowCheck();
  }

  // The bottom fade only while there is more list below.
  function overflowCheck() {
    listEl.classList.toggle("is-overflowing", listEl.scrollTop + listEl.clientHeight < listEl.scrollHeight - 2);
  }

  function scrollRowIntoView(c) {
    if (!L.app || !c.row) return;           // stacked: the page scrolls, leave it be
    var top = c.row.offsetTop - listEl.offsetTop, h = c.row.offsetHeight;
    if (top < listEl.scrollTop) listEl.scrollTop = top;
    else if (top + h > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = top + h - listEl.clientHeight;
  }

  /* ------------------------------------------------------------------
     THE MAP: a greyscale style written here, in the ground's PALETTE. "omt-low" (zoom 0-1
     tiles, ~0.5 MB for the world) draws the globe, "omt" takes over at
     SPLIT for detail (see setSplit). Elevation is switched on only once
     the camera has arrived: hillshade, and 3D terrain on laptops.
     ------------------------------------------------------------------ */

  var ranges = {};      // id → [minzoom, maxzoom, "lo" | "hi"] for the layers setSplit() moves

  /* Elevation tiles. Mapterhorn answers 404 for a tile with no land in it,
     and the browser logs every one as an error. Its sea is exactly 0 m, so
     before asking for a tile we look at the same place four zooms coarser
     and fetch only where any ground shows; elsewhere a flat sea-level tile
     stands in, which is all the 404 would have meant. */
  var masks = {}, maskKeys = [], flat = null;
  function demURL(z, x, y) { return DEM.replace("{z}", z).replace("{x}", x).replace("{y}", y); }
  function landMask(z, x, y) {             // → 512×512 bits, set wherever the tile isn't sea
    var key = z + "/" + x + "/" + y;
    if (masks[key]) return masks[key];
    maskKeys.push(key);                    // the 64 most recent (2 MB); older ones are re-read from the HTTP cache
    if (maskKeys.length > 64) delete masks[maskKeys.shift()];
    return (masks[key] = hasLand(z, x, y).then(function (land) {
      if (!land) return null;
      return fetch(demURL(z, x, y)).then(function (r) { if (!r.ok) throw r; return r.blob(); })
        .then(function (b) { return createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }); })
        .then(function (bmp) {
          var cv = el("canvas"), g, d, m = new Uint8Array(512 * 512 / 8);
          cv.width = cv.height = 512;
          g = cv.getContext("2d");
          g.drawImage(bmp, 0, 0);
          d = g.getImageData(0, 0, 512, 512).data;
          for (var i = 0; i < 512 * 512; i++) if (d[4 * i] !== 128 || d[4 * i + 1] || d[4 * i + 2]) m[i >> 3] |= 1 << (i & 7);
          return m;
        }).catch(function () { return null; });
    }));
  }
  function hasLand(z, x, y) {
    if (!z) return Promise.resolve(true);
    var dz = Math.min(4, z), s = 1 << dz;
    return landMask(z - dz, x >> dz, y >> dz).then(function (m) {
      if (!m) return false;
      var n = 512 / s, e = n > 8 ? 1 : 0, x0 = (x % s) * n, y0 = (y % s) * n;   // inset: a coast pixel can belong to the neighbour
      for (var j = y0 + e; j < y0 + n - e; j++) for (var i = x0 + e; i < x0 + n - e; i++) if (m[(j * 512 + i) >> 3] & 1 << (i & 7)) return true;
      return false;
    });
  }
  function flatTile() {
    if (!flat) {
      flat = new ImageData(512, 512);
      for (var i = 0; i < flat.data.length; i += 4) { flat.data[i] = 128; flat.data[i + 3] = 255; }
    }
    return createImageBitmap(flat);
  }
  function demTile(params, abort) {
    var t = /(\d+)\/(\d+)\/(\d+)/.exec(params.url), z = +t[1], x = +t[2], y = +t[3];
    return hasLand(z, x, y).then(function (land) {
      if (!land) return flatTile();
      return fetch(demURL(z, x, y), { signal: abort.signal }).then(function (r) { return r.ok ? r.arrayBuffer() : flatTile(); });
    }).then(function (data) { return { data: data }; });
  }

  function buildStyle() {
    var P = pal();
    var poly = ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false];
    // Not "protected_area": that class is mostly marine reserves, and a tint
    // over open sea reads as land (the Galápagos reserve rings the islands).
    var parks = ["match", ["get", "class"], ["national_park", "nature_reserve"], true, false];
    var name = ["coalesce", ["get", "name:en"], ["get", "name:latin"]];    // English only, never local script
    function text(size, op, extra) {
      var layout = { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": size,
        "text-transform": "uppercase", "text-letter-spacing": .2, "text-max-width": 8 };
      for (var k in extra) layout[k] = extra[k];
      return { layout: layout, paint: { "text-color": op, "text-opacity": 1, "text-opacity-transition": { duration: 300 } } };
    }
    function dem() {
      return { type: "raster-dem", tiles: ["nl-dem://{z}/{x}/{y}"], tileSize: 512, encoding: "terrarium", maxzoom: 9, attribution: ATTR_DEM };
    }
    // [id, type, source-layer, minzoom, maxzoom, filter, paint, -, twin?]. A twin
    // also draws the layer from the light tiles. The coastline starts at zoom 1:
    // the one zoom-0 tile's whole-world outline is too big to draw on a globe.
    var V = [
      ["water", "fill", "water", 0, 24, ["all", poly, ["!=", ["get", "brunnel"], "tunnel"]], { "fill-color": P.sea, "fill-antialias": false }, null, 1],
      ["ice", "fill", "landcover", 2, 24, ["match", ["get", "subclass"], ["glacier", "ice_shelf"], true, false], { "fill-color": P.ice, "fill-antialias": false }, null, 1],
      ["park", "fill", "park", 4.5, 24, ["all", poly, parks], { "fill-color": P.park }],
      "hillshade",
      ["coast", "line", "water", 1, 24, ["all", poly, ["match", ["get", "class"], ["ocean", "sea", "lake"], true, false], ["!=", ["get", "brunnel"], "tunnel"]],
        { "line-color": P.coast, "line-width": ["interpolate", ["linear"], ["zoom"], 1, .5, 7, .8],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 1, 7.5, .4] }, null, 1],   // fainter close in, where islets crowd
      ["river", "line", "waterway", 6, 24, ["!=", ["get", "brunnel"], "tunnel"], { "line-color": P.river }],
      ["park-edge", "line", "park", 4.5, 24, ["all", poly, parks], { "line-color": P.parkEdge, "line-width": .8, "line-dasharray": [1, 2] }],
      ["admin-4", "line", "boundary", 3, 24, ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        { "line-color": P.state, "line-width": .6, "line-dasharray": [2, 2] }],
      ["admin-2", "line", "boundary", 1.5, 24, ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]],
        { "line-color": P.border, "line-width": .6 }, null, 1],
      "lines",
      // States and park names stay faint and come in late, so that near a
      // tilted horizon (where the tiles are coarse) nothing crowds the header,
      // and the pins' own labels are the strongest type on an arrival.
      ["country", "symbol", "place", 2.6, 6, ["==", ["get", "class"], "country"], text(11, P.country), null, 1],
      ["state", "symbol", "place", 5.6, 8, ["==", ["get", "class"], "state"], text(11, P.stateName, { "text-max-width": 12, "text-padding": 24 })],
      ["park-name", "symbol", "park", 6.8, 24, ["all", ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false], ["==", ["get", "class"], "national_park"]],
        text(11, P.parkName, { "text-padding": 8, "text-max-width": 10 })]
    ];
    var layers = [{ id: "land", type: "background", paint: { "background-color": P.land } }];
    V.forEach(function (d) {
      if (d === "hillshade") {
        layers.push({ id: "hillshade", type: "hillshade", source: "dem-hs", minzoom: 3.5, layout: { visibility: "none" }, paint: {
          "hillshade-method": "igor", "hillshade-illumination-anchor": "map",
          "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 3.5, 0, 5, .45, 9, .6],
          "hillshade-shadow-color": P.shadow, "hillshade-highlight-color": P.highlight, "hillshade-accent-color": P.accent } });
        return;
      }
      if (d === "lines") {
        // Solid hairlines, like the connector to the card.
        layers.push({ id: "g-trail", type: "line", source: "g-trail", paint: { "line-color": P.line, "line-opacity": P.trail, "line-width": 1, "line-opacity-transition": { duration: 1200 } } });
        layers.push({ id: "g-tether", type: "line", source: "g-tether", paint: { "line-color": P.line, "line-opacity": ["get", "o"], "line-width": 1 } });
        return;
      }
      var base = { type: d[1], "source-layer": d[2], filter: d[5] };
      if (d[1] === "symbol") { base.layout = d[6].layout; base.paint = d[6].paint; } else base.paint = d[6];
      var hi = JSON.parse(JSON.stringify(base));
      hi.id = d[0]; hi.source = "omt"; hi.minzoom = Math.max(d[3], SPLIT); hi.maxzoom = d[4];
      ranges[hi.id] = [d[3], d[4], "hi"];
      if (d[8]) {
        var lo = JSON.parse(JSON.stringify(base));
        lo.id = d[0] + "-lo"; lo.source = "omt-low"; lo.minzoom = d[3]; lo.maxzoom = Math.min(d[4], SPLIT);
        ranges[lo.id] = [d[3], d[4], "lo"];
        layers.push(lo);
      }
      layers.push(hi);
    });
    var empty = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    return {
      version: 8, projection: { type: "globe" }, glyphs: GLYPHS,
      sources: {
        "omt-low": { type: "vector", url: TILES, maxzoom: 1, attribution: ATTR_TILES },
        "omt": { type: "vector", url: TILES, maxzoom: 9, attribution: ATTR_TILES },
        "dem-hs": dem(), "dem-3d": dem(),
        "g-tether": empty, "g-trail": JSON.parse(JSON.stringify(empty))
      },
      // Space stays transparent so the stars (or the paper) show through;
      // MapLibre's own atmosphere reads blue, so the rim is the ring in
      // globe.css instead.
      sky: { "sky-color": "rgba(0,0,0,0)", "horizon-color": P.horizon, "fog-color": P.fog,
             "sky-horizon-blend": .5, "horizon-fog-blend": .6, "fog-ground-blend": .75, "atmosphere-blend": 0 },
      // A change of ground repaints at once, as the page around the map does.
      // (Fades written on a property itself still apply.)
      transition: { duration: 0, delay: 0 },
      layers: layers
    };
  }

  // The ground changed: repaint the map in place from a fresh buildStyle(),
  // colour by colour. The style is never reloaded, so a flight, the relief,
  // the dimmed names of an arrival and an open card all carry on as they
  // were. Opacities the page sets as it goes (the map's names stepping
  // aside, the tour's trail fading) are left to it. Before the map has
  // loaded there is nothing to repaint yet; onLoad catches up.
  var painted = "";                         // the ground the map was last drawn in
  function applyPalette() {
    var P = pal();
    if (themeMeta) themeMeta.content = P.meta;
    drawStars();
    if (!map || !ready || failed || painted === ground()) return;
    painted = ground();
    var style = buildStyle();
    try {
      style.layers.forEach(function (ly) {
        for (var k in ly.paint) {
          if (/-transition$/.test(k) || k === "text-opacity" || (ly.id === "g-trail" && k === "line-opacity")) continue;
          map.setPaintProperty(ly.id, k, ly.paint[k]);
        }
      });
      if (tour && trail.length) map.setPaintProperty("g-trail", "line-opacity", P.trail);
      map.setSky(style.sky);
    } catch (e) {}
    dirty = true;
  }

  // Where the detailed tiles take over from the light ones. In flight it is
  // pushed up to FLIGHT_SPLIT, so the big mid-zoom tiles are not fetched just
  // to be glimpsed on the way past. On landing the detailed layers come on
  // at once but the light ones stay until the map is idle, so the sea never
  // blinks out while the new tiles arrive.
  var splitAt = "";
  function setSplit(lo, hi) {
    if (!map || splitAt === lo + "/" + hi) return;
    splitAt = lo + "/" + hi;
    for (var id in ranges) {
      var r = ranges[id];
      if (r[2] === "lo") map.setLayerZoomRange(id, r[0], Math.max(r[0], Math.min(r[1], lo)));
      else map.setLayerZoomRange(id, Math.min(r[1], Math.max(r[0], hi)), r[1]);
    }
  }
  function land() {
    function done() { if (state !== "selecting" && state !== "returning") setSplit(SPLIT, SPLIT); }
    setSplit(FLIGHT_SPLIT, SPLIT);
    map.once("idle", done);
    setTimeout(done, 4000);                 // a spin can keep the map from ever going idle
  }

  function startMap() {
    if (map || failed || !dataReady || !window.maplibregl) return;
    ml = window.maplibregl;
    ml.addProtocol("nl-dem", demTile);
    L = measure();
    painted = ground();
    var first = (recent || deep) && bySlug[recent || deep].pins[0];
    var lng = first ? first.ll[0] : -100;
    // The intro turns the globe at its final size, so it fills the ring
    // from the first frame. Two-finger turning only where one finger has a
    // page to scroll (the stacked layout on a touch screen).
    try {
      map = new ml.Map({
        container: mapEl, style: buildStyle(),
        center: [deep ? lng : lng + 30, OVERVIEW_LAT], zoom: L.zO,
        minZoom: floorZoom(), maxZoom: MAX_ZOOM, maxPitch: 60,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2), renderWorldCopies: false,
        attributionControl: false, keyboard: false, doubleClickZoom: false, boxZoom: false,
        dragRotate: false, pitchWithRotate: false, touchPitch: false, cooperativeGestures: COARSE && !L.app,
        // The globe's camera can't follow the ground under it (MapLibre 6.11
        // only warns, after every gesture over terrain): measured, the
        // arrivals frame identically without it.
        centerClampedToGround: false,
        locale: { "CooperativeGesturesHandler.MobileHelpText": LABELS.gestures }
      });
    } catch (e) { fail(); return; }               // no WebGL2, most often
    map.setPadding(L.pad);
    map.touchZoomRotate.disableRotation();
    var canvas = map.getCanvas();
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("tabindex", "-1");
    canvas.addEventListener("webglcontextlost", fail);
    addAttribution();

    map.on("error", function (e) { if (!ready && !(e && e.tile)) fail(); });
    map.on("load", onLoad);
    map.on("move", onMove);
    map.on("moveend", onMoveEnd);
    map.on("click", function () { if (active) dismiss(); });

    var cc = map.getCanvasContainer();
    cc.addEventListener("pointerdown", function () { hold("drag", true); }, { passive: true });
    window.addEventListener("pointerup", function () { hold("drag", false); }, { passive: true });
    cc.addEventListener("wheel", function () { spinV = 0; released = now(); }, { passive: true });
    buildPins();
  }

  function addAttribution() {
    if (attribution) map.removeControl(attribution);
    attribution = new ml.AttributionControl({ compact: false, customAttribution: ATTR_DEM });
    map.addControl(attribution, L.app ? "bottom-right" : "top-right");
    var a = mapEl.querySelector(".maplibregl-ctrl-attrib");
    if (watcher && a) watcher.observe(a);   // it grows when the elevation credit arrives
    geo = null;
  }

  function onLoad() {
    if (failed) return;
    ready = true;
    clearTimeout(failTimer);
    stage.classList.add("is-ready");
    map.setMinZoom(floorZoom());
    applyPalette();                         // in case the ground changed while the style loaded
    loop();
    if (deep) {
      stage.classList.add("has-pins");
      state = "overview";
      select(deep, "deep");
      return;
    }
    if (REDUCED) {
      map.jumpTo({ center: [map.getCenter().lng - 30, OVERVIEW_LAT], zoom: L.zO, padding: L.pad });
      stage.classList.add("has-pins");
      settle();
      return;
    }
    // The globe grows into the ring, then the pins arrive oldest trip first.
    map.easeTo({ center: [map.getCenter().lng - 30, OVERVIEW_LAT], zoom: L.zO, duration: 1800, easing: easeOut, padding: L.pad }, { gIntro: 1 });
    setTimeout(function () {
      stage.classList.add("has-pins");
      pins.forEach(function (p) { p.el.style.animationDelay = (p.c.i * 45) + "ms"; p.el.classList.add("is-intro"); });
      setTimeout(function () { pins.forEach(function (p) { p.el.classList.remove("is-intro"); }); }, 2600);
    }, 200);
  }

  function settle() {                      // the intro is over, by whatever route
    if (state !== "intro") return;
    state = "overview";
    released = -1e9;                       // the spin takes over from the intro's turn
    if (recent && bySlug[recent].row) {
      bySlug[recent].row.classList.add("is-recent");
      scrollRowIntoView(bySlug[recent]);
    }
    readout();
    dirty = true;
  }

  var lastCoords = 0;
  function onMove() {
    dirty = true;
    var t = now();
    if (!lit && !active && state !== "returning" && t - lastCoords > 100) { lastCoords = t; readout(); }
    // Zoomed out by hand from an arrival: the relief goes before the wide
    // view asks for a continent of elevation tiles.
    if (state !== "selecting" && state !== "returning" && map.getZoom() < 4) dropRelief();
  }

  function onMoveEnd(e) {
    dirty = true;
    if (e.gSpin) return;
    if (e.gIntro) settle();
    if (e.gFlight && e.gFlight === flight) arrive();
    if (e.gHome && e.gHome === flight) {
      state = "overview";
      land();
      readout();
    }
    if (!e.gIntro && !e.gFlight && !e.gHome) tidy();
  }

  // After the visitor's own drag, wheel or pinch (or a card closed by hand):
  // back at globe zoom with nothing open, the camera settles into the
  // overview — level, relief off, the overview's latitude and padding — so
  // the spin and the row-hover turn work again. In close with a card open,
  // the relief comes back.
  function tidy() {
    if (!map || !ready || state === "intro" || state === "selecting" || state === "returning") return;
    if (active && state === "arrived" && map.getZoom() >= 4) relief();
    if (!active && sizeZoom() <= L.zO + .6 && (state === "free" || !level())) overview();
  }

  /* ------------------------------------------------------------------
     PINS: one marker per place, thinned out on screen every frame
     (layoutPins). At the overview only each collection's first pin shows;
     where pins of different collections would overlap, one stands for
     all as a stacked pin. A collection's own pins never hide each other.
     ------------------------------------------------------------------ */

  function buildPins() {
    cols.forEach(function (c) {
      c.pins.forEach(function (pp, pi) {
        var e = el("span", "g-pin");
        e.setAttribute("aria-hidden", "true");
        e.setAttribute("data-slug", c.slug);
        e.innerHTML = '<i class="g-pin-in"><i class="g-pin-x"></i><i class="g-pin-ring"></i><i class="g-pin-af"></i><i class="g-pin-label"></i></i>';
        e.querySelector(".g-pin-label").textContent = pp.name;
        if (visited[c.slug]) e.classList.add("is-visited");
        var p = { c: c, slug: c.slug, pi: pi, ll: pp.ll, el: e, show: true, xy: null, stack: null, label: 0, lw: 0 };
        p.marker = new ml.Marker({ element: e, anchor: "center", opacityWhenCovered: "0" }).setLngLat(pp.ll).addTo(map);
        // Lighting a pin reveals the rest of its collection, which may land
        // under the pointer: the pin pointed at stays on top (.is-hover), and
        // moving between one collection's own pins counts as staying on it.
        e.addEventListener("pointerenter", function (ev) {
          if (ev.pointerType === "touch") return;
          e.classList.add("is-hover");
          hold("pin", true);
          if (lit === p.slug && !crowd && !p.stack) clearTimeout(hoverTimer);
          else pinHover(p);
        });
        e.addEventListener("pointerleave", function (ev) {
          e.classList.remove("is-hover");
          var to = ev.relatedTarget && ev.relatedTarget.closest ? ev.relatedTarget.closest(".g-pin") : null;
          if (to && to !== e && to.getAttribute("data-slug") === p.slug) return;
          hold("pin", false);
          hoverOut();
        });
        e.addEventListener("click", function (ev) { ev.stopPropagation(); pinClick(p); });
        pins.push(p);
        pp.p = p;
      });
    });
  }

  function pinHover(p) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () {
      if (p.stack && p.slug !== active) crowdPlate(p);
      else light(p.slug);
    }, HOVER_DELAY);
  }

  function pinClick(p) {
    if (!ready) return;
    if (p.stack && p.slug !== active) {          // a stack: come closer instead of guessing
      map.easeTo({ center: p.ll, zoom: Math.min(MAX_ZOOM, map.getZoom() + 1.6), duration: REDUCED ? 0 : 700 });
      return;
    }
    if (p.slug === active) { location.href = p.c.href; return; }
    select(p.slug, "pin");
  }

  function setPinClasses() {
    pins.forEach(function (p) {
      var cl = p.el.classList;
      cl.toggle("is-active", p.slug === active);
      cl.toggle("is-lit", !!lit && p.slug === lit && p.slug !== active);
      cl.toggle("is-dim", !!active && p.slug !== active && p.slug !== lit);
      cl.toggle("is-visited", !!visited[p.slug] && p.slug !== active);
    });
  }

  function layoutPins() {
    var z = map.getZoom(), c = map.getCenter(), cc = [c.lng, c.lat];
    var anchorsOnly = sizeZoom() <= L.zO + .6;
    var far = z < 5 ? horizon(z, c.lat, L.h) - 3 : 181;
    var R = COARSE ? 22 : 14, kept = [], at = geom().attrib;
    // Never a pin in the header's band (laptop) or on the attribution.
    function covered(xy) {
      return (L.app && xy.y < 72) || !!at && xy.x > at[0] - 8 && xy.x < at[2] + 8 && xy.y > at[1] - 8 && xy.y < at[3] + 8;
    }
    var order = [];
    pins.forEach(function (p) { if (p.slug === active) order.push(p); });
    pins.forEach(function (p) { if (p.slug === lit && p.slug !== active) order.push(p); });
    pins.forEach(function (p) { if (p.slug !== lit && p.slug !== active) order.push(p); });
    order.forEach(function (p) {
      var show = !(anchorsOnly && p.pi > 0 && p.slug !== active && p.slug !== lit);
      p.stack = null;
      if (show && far < 181 && angle(cc, p.ll) > far) show = false;
      if (show) {
        p.xy = map.project(p.ll);
        if (covered(p.xy)) show = false;
      }
      if (show) {
        for (var i = 0; i < kept.length; i++) {
          var k = kept[i], dx = k.xy.x - p.xy.x, dy = k.xy.y - p.xy.y;
          if (k.slug !== p.slug && dx * dx + dy * dy < R * R) {
            if (k.slug !== active) {
              k.stack = k.stack || [];
              if (k.stack.indexOf(p.slug) < 0) k.stack.push(p.slug);
            }
            show = false;
            break;
          }
        }
        if (show) kept.push(p);
      }
      p.show = show;
    });
    pins.forEach(function (p) {
      p.el.classList.toggle("is-off", !p.show);
      p.el.classList.toggle("is-stack", !!(p.show && p.stack));
    });
  }

  /* ---------- place labels, on arrival ------------------------------------ */

  var labelsFor = null;
  function labelsOn(c) {
    labelsFor = c.pins.length > 1 || (c.pins[0] && c.pins[0].name !== c.title) ? c.slug : null;
  }
  // Right of the pin, else left, above or below; never over the card, the console, the
  // attribution, the header, another pin of the collection, the tether
  // between them, or another label. The pin with the fewest free places
  // chooses first, so one label's flip can't push out a neighbour's, and a
  // label keeps its side while that side stays free.
  var SIDES = { "1": "", "-1": "is-left", "2": "is-up", "-2": "is-down" };
  function layoutLabels() {
    var g = geom(), boxes = [], segs = [], want = [];
    [g.card, g.attrib, g.console].forEach(function (r) { if (r) boxes.push([r[0] - 6, r[1] - 4, r[2] + 4, r[3] + 4]); });
    var c = labelsFor && bySlug[labelsFor], minX = L.app ? L.F - 16 : 8, maxX = L.w - 8;
    if (c) {
      c.pins.forEach(function (q, i) {
        var p = q.p, n = c.pins[i + 1] && c.pins[i + 1].p;
        if (!p.show || !p.xy) return;
        boxes.push([p.xy.x - 9, p.xy.y - 9, p.xy.x + 9, p.xy.y + 9, p]);
        if (n && n.show && n.xy) segs.push([p.xy.x, p.xy.y, n.xy.x, n.xy.y]);
        if (!p.lw) p.lw = p.el.querySelector(".g-pin-label").offsetWidth;
        // Above and below, a label may slide sideways to stay on screen.
        var x = p.xy.x, y = p.xy.y, w = p.lw / 2 + 2, x0 = clamp(x - w, minX, Math.max(minX, maxX - 2 * w)), dx = Math.round(x0 + w - x);
        p.cands = [[x + 14, y - 10, x + 16 + p.lw, y + 10, 1], [x - 16 - p.lw, y - 10, x - 14, y + 10, -1],
                   [x0, y - 32, x0 + 2 * w, y - 12, 2, dx], [x0, y + 12, x0 + 2 * w, y + 32, -2, dx]];
        p.cands.sort(function (a, b) { return (b[4] === p.label) - (a[4] === p.label); });
        want.push(p);
      });
    }
    function free(b, self) {
      if (b[0] < minX || b[2] > maxX || b[1] < (L.app ? 72 : 8) || b[3] > L.h - 8) return false;
      for (var i = 0; i < boxes.length; i++) {
        var o = boxes[i];
        if (o[4] !== self && b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false;
      }
      for (var j = 0; j < segs.length; j++) if (crosses(b, segs[j])) return false;
      return true;
    }
    want.forEach(function (p) { p.nFree = p.cands.filter(function (b) { return free(b, p); }).length; });
    want.sort(function (a, b) { return a.nFree - b.nFree || a.pi - b.pi; });
    want.forEach(function (p) {
      var b = p.cands.filter(function (b) { return free(b, p); })[0];
      p.side = b ? b[4] : 0;
      p.dx = b && b[5] || 0;
      if (b) boxes.push(b);
    });
    pins.forEach(function (p) {
      var side = want.indexOf(p) < 0 ? 0 : p.side;
      if (side && p.el.style.getPropertyValue("--dx") !== p.dx + "px") p.el.style.setProperty("--dx", p.dx + "px");
      if (p.label === side) return;
      p.label = side;
      p.el.classList.toggle("has-label", !!side);
      for (var k in SIDES) if (SIDES[k]) p.el.classList.toggle(SIDES[k], String(side) === k);
    });
  }
  // Does the segment s = [x1, y1, x2, y2] pass through the box b? (Liang–Barsky)
  function crosses(b, s) {
    var t0 = 0, t1 = 1, dx = s[2] - s[0], dy = s[3] - s[1];
    var P = [-dx, dx, -dy, dy], Q = [s[0] - b[0], b[2] - s[0], s[1] - b[1], b[3] - s[1]];
    for (var i = 0; i < 4; i++) {
      if (!P[i]) { if (Q[i] < 0) return false; continue; }
      var r = Q[i] / P[i];
      if (P[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return true;
  }

  /* ---------- tether and trail -------------------------------------------- */

  function setTether() {
    if (!ready) return;
    var g = [];
    if (active && bySlug[active].pins.length > 1) g.push({ o: .45, pts: bySlug[active].pins.map(function (p) { return p.ll; }) });
    if (lit && lit !== active && bySlug[lit].pins.length > 1) g.push({ o: .3, pts: bySlug[lit].pins.map(function (p) { return p.ll; }) });
    map.getSource("g-tether").setData(lines(g));
  }

  var trail = [];
  function setTrail(pts) {
    trail = pts;
    map.setPaintProperty("g-trail", "line-opacity", pts.length ? pal().trail : 0);
    map.getSource("g-trail").setData(lines(pts.length > 1 ? [{ o: .22, pts: pts }] : []));
  }

  /* ------------------------------------------------------------------
     LIGHTING: pointing at a row or a pin
     ------------------------------------------------------------------ */

  var hoverTimer = 0, turnTimer = 0, pending = null;

  function hoverIn(slug) {
    clearTimeout(hoverTimer); clearTimeout(turnTimer);
    pending = slug;
    hoverTimer = setTimeout(function () { light(slug); }, HOVER_DELAY);
    turnTimer = setTimeout(function () { turnTo(slug); }, TURN_DELAY);
  }
  function hoverOut() {
    clearTimeout(hoverTimer); clearTimeout(turnTimer);
    pending = null;
    light(null);
  }

  function light(slug) {
    if (lit === slug && !crowd) return;
    lit = slug;
    crowd = null;
    cols.forEach(function (c) { c.row.classList.toggle("is-lit", c.slug === slug); });
    if (!ready) return;
    setPinClasses();
    setTether();
    hold("lit", !!slug);
    if (slug && slug !== active) { prefetch(bySlug[slug]); showPlate(bySlug[slug]); } else hidePlate();
    readout();
    dirty = true;
  }

  // While at the overview, a collection round the back turns to face you.
  function turnTo(slug) {
    var c = bySlug[slug];
    if (!ready || !c || !c.pins.length || !inOverview() || state !== "overview") return;
    var ctr = map.getCenter(), p = c.pins[0].ll;
    if (angle([ctr.lng, ctr.lat], p) <= 70) return;
    map.easeTo({ center: [p[0], OVERVIEW_LAT], duration: REDUCED ? 0 : 900, padding: L.pad });
  }

  /* ---------- the plate: a small preview beside the pin ------------------- */

  var plateFor = null, crowd = null, plateH = 0, plateW = 200;

  function showPlate(c) {
    if (!L.app || COARSE || !c.pins.length) { hidePlate(); return; }
    plate.textContent = "";
    plate.classList.remove("is-text");
    if (c.opener && NL) {
      var img = el("img");
      img.alt = "";
      img.style.aspectRatio = NL.aspectOf(c.opener).toFixed(4);
      NL.responsive(img, c.opener, PLATE_SIZES);
      plate.appendChild(img);
    }
    plate.appendChild(el("p", "g-plate-title", c.title));
    if (c.where) plate.appendChild(el("p", "g-plate-where", c.where));
    openPlate(c.pins[0].p);
  }
  function crowdPlate(p) {
    if (!L.app || COARSE) return;
    light(null);
    crowd = p;
    plate.textContent = "";
    plate.classList.add("is-text");        // titles only, each set apart, the plate as wide as they need
    [p.slug].concat(p.stack).forEach(function (s) { plate.appendChild(el("p", "g-plate-title", bySlug[s].title)); });
    openPlate(p);
  }
  function openPlate(p) {
    plateFor = p;
    plate.classList.remove("is-on");
    void plate.offsetWidth;                // restart the shutter
    plateH = plate.offsetHeight;
    plateW = plate.offsetWidth;
    plate.classList.add("is-on");
    dirty = true;
  }
  function hidePlate() {
    plateFor = null; crowd = null;
    plate.classList.remove("is-on");
    wireP.classList.remove("is-on");
  }

  function placePlate() {
    var p = plateFor;
    if (!p) return;
    if (!p.show) p = (p.c.pins.filter(function (q) { return q.p.show; })[0] || {}).p;
    if (!p || !p.xy) { plate.style.visibility = "hidden"; wireP.classList.remove("is-on"); return; }
    plate.style.visibility = "";
    var w = plateW, h = plateH, x = p.xy.x + 16, right = L.w - L.e;
    if (cardShown) right = L.w - L.e - cardWidth() - 16;
    if (x + w > right) x = p.xy.x - 16 - w;
    x = clamp(x, L.F, right - w);
    var y = clamp(p.xy.y - h / 2, 72, L.h - 108 - h);
    plate.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    var leftSide = x < p.xy.x;
    wireP.setAttribute("x1", p.xy.x + (leftSide ? -8 : 8));
    wireP.setAttribute("y1", p.xy.y);
    wireP.setAttribute("x2", leftSide ? x + w : x);
    wireP.setAttribute("y2", clamp(p.xy.y, y + 1, y + h - 1));
    wireP.classList.toggle("is-on", Math.abs((leftSide ? x + w : x) - p.xy.x) > 10);
  }

  /* ------------------------------------------------------------------
     SELECTING: fly there and open the card
     ------------------------------------------------------------------ */

  var cardShown = false, cardTimer = 0, warmTimer = 0, wireStart = 0, how = "";

  function cameraFor(c) {
    if (!c.pins.length) return null;
    var pad = selectPadding();
    if (c.pins.length === 1) {
      var z = Math.min(c.zoom || ARRIVE_ZOOM, MAX_ZOOM);
      if (c.sensitive) z = Math.min(z, SENSITIVE_ZOOM);
      return { center: c.pins[0].ll, zoom: z, pitch: 55, bearing: c.i % 2 ? 14 : -14, padding: pad };
    }
    // Several pins: fit them flat (cameraForBounds ignores pitch), then back
    // off a little before tilting. cameraForBounds also adds the map's own
    // padding to the one it is given, and the map keeps whatever the last
    // flight set, so it measures with none; and since its centre is meant
    // for a camera without padding, the flight aims at the pins' middle.
    var b = new ml.LngLatBounds(), keep = map.getPadding();
    c.pins.forEach(function (p) { b.extend(p.ll); });
    map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    var cam = map.cameraForBounds(b, { padding: pad });
    map.setPadding(keep);
    // The 3.2 floor keeps a laptop arrival close; a phone's small stage
    // follows the fit, so a wide spread (Alaska) still lands above the card.
    var zoom = cam ? clamp(cam.zoom - .45, L.app ? 3.2 : Math.min(3.2, L.zO + .2), 7.4) : 4, y0 = merc(b.getSouth()), y1 = merc(b.getNorth());
    if (c.sensitive) zoom = Math.min(zoom, SENSITIVE_ZOOM);
    var mid = [(b.getWest() + b.getEast()) / 2, (2 * Math.atan(Math.exp((y0 + y1) / 2)) - Math.PI / 2) / rad];
    return { center: mid, zoom: zoom, pitch: 32, bearing: 0, padding: pad };
  }

  function select(slug, from) {
    var c = bySlug[slug];
    if (!c || !ready) return;
    var seq = ++flight, wasOpen = cardShown && active !== slug;
    how = from;
    clearTimeout(cardTimer); clearTimeout(warmTimer);
    dwell = -1;
    active = slug;
    state = "selecting";
    labelsFor = null;
    quietMap(false);
    wireC.classList.remove("is-on"); wireEnd.classList.remove("is-on");
    cols.forEach(function (o) { if (o === c) o.row.setAttribute("aria-current", "true"); else o.row.removeAttribute("aria-current"); });
    scrollRowIntoView(c);
    hidePlate();
    setPinClasses();
    setTether();
    readout();
    prefetch(c);
    if (wasOpen) hideCard(true);
    // Wait out the old card's exit and the terrain settling, then go.
    flatten(function () {
      if (seq !== flight) return;
      fillCard(c);
      var cam = cameraFor(c);
      if (!cam) { showCard(); arrive(); return; }
      if (from === "deep" || REDUCED) { map.jumpTo(cam, { gFlight: seq }); return; }
      var ctr = map.getCenter();
      var ms = clamp(1400 + 9 * angle([ctr.lng, ctr.lat], cam.center), 2000, 3400);
      setSplit(FLIGHT_SPLIT, FLIGHT_SPLIT);
      cam.duration = ms; cam.curve = 1.42; cam.easing = easeInOut;
      map.flyTo(cam, { gFlight: seq });
      cardTimer = setTimeout(function () {    // nearly there: the card, and the detailed tiles
        if (seq === flight) { showCard(); setSplit(FLIGHT_SPLIT, SPLIT); }
      }, ms * .85);
    }, wasOpen ? 170 : 0);
  }

  function arrive() {
    var c = bySlug[active];
    if (!c) return;
    state = "arrived";
    land();
    showCard();
    readout();
    labelsOn(c);
    quietMap(!!labelsFor);
    geo = null;
    wireStart = now();
    dirty = true;
    say(LABELS.showing.replace("{title}", c.title) + (how === "row" ? " " + LABELS.again : ""));
    try { history.replaceState(null, "", "#" + c.slug); } catch (e) {}
    if (!visited[c.slug]) {
      visited[c.slug] = 1;
      c.row.classList.add("is-visited");
      session("nl.visited", JSON.stringify(Object.keys(visited)));
    }
    warmTimer = setTimeout(function () { warm(c); }, 1200);
    if (c.pins.length) relief();
    if (tour) dwell = 0;
  }

  // Esc or ×: the card goes, the camera stays where it is.
  function closeCard() {
    if (!active) return;
    flight++;                               // first, so stopping a flight doesn't count as arriving
    if (state === "selecting") map.stop();
    clearTimeout(cardTimer); clearTimeout(warmTimer);
    if (tour) endTour(false);
    dwell = -1;
    active = null;
    state = map && level() ? "overview" : "free";
    labelsFor = null;
    quietMap(false);
    hideCard(false);
    cols.forEach(function (o) { o.row.removeAttribute("aria-current"); });
    setPinClasses();
    setTether();
    readout();
    dirty = true;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }

  function overview() {
    if (!ready) return;
    closeCard();
    var seq = ++flight;
    state = "returning";
    readout();
    flatten(function () {
      if (seq !== flight) return;
      var cam = { center: [map.getCenter().lng, OVERVIEW_LAT], zoom: L.zO, pitch: 0, bearing: 0, padding: L.pad };
      if (REDUCED) { map.jumpTo(cam, { gHome: seq }); return; }
      setSplit(FLIGHT_SPLIT, FLIGHT_SPLIT);
      cam.duration = 2000; cam.curve = 1.42;
      map.flyTo(cam, { gHome: seq });
    }, 0);
  }

  // Esc, × or a click on the map: the card goes and the camera stays — unless
  // it is already out at globe zoom, where it settles into the overview.
  function dismiss() { closeCard(); tidy(); }

  function step(d) {
    if (!active) return;
    var i = bySlug[active].i + d;
    if (i >= 0 && i < cols.length) select(cols[i].slug, "key");
  }

  /* ---------- relief: hillshade, and the mountains rising ------------------ */

  var terrainRaf = 0, shade = false, flatTimer = 0;
  function animateTerrain(from, to, ms, done) {
    cancelAnimationFrame(terrainRaf);
    var t0 = now();
    (function frame() {
      if (!map) return;
      var k = Math.min(1, (now() - t0) / ms), e = k * k * (3 - 2 * k);
      map.setTerrain({ source: "dem-3d", exaggeration: Math.max(.001, from + (to - from) * e) });
      dirty = true;
      if (k < 1) terrainRaf = requestAnimationFrame(frame);
      else if (done) done();
    })();
  }
  function setShade(on) {
    if (shade === on) return;
    shade = on;
    map.setLayoutProperty("hillshade", "visibility", on ? "visible" : "none");
  }
  function relief() {
    if (!map || map.getZoom() < 4) return;  // a wide view would pull a continent of elevation tiles
    setShade(true);
    if (TERRAIN_3D && !map.getTerrain()) animateTerrain(0, TERRAIN_EXAGGERATION, 1400);
  }
  // Out past zoom 4 by hand: off at once, with nothing left to see of it.
  function dropRelief() {
    if (!shade && !map.getTerrain()) return;
    cancelAnimationFrame(terrainRaf);
    map.setTerrain(null);
    setShade(false);
  }
  // Flatten before any departure: flights over raised terrain jump.
  function flatten(done, wait) {
    cancelAnimationFrame(terrainRaf);
    clearTimeout(flatTimer);
    var t = map.getTerrain(), t0 = now();
    function next() { flatTimer = setTimeout(function () { if (map) done(); }, Math.max(0, wait - (now() - t0))); }
    if (!t) { setShade(false); next(); return; }
    animateTerrain(t.exaggeration || TERRAIN_EXAGGERATION, 0, REDUCED ? 1 : 450, function () {
      map.setTerrain(null);
      setShade(false);
      next();
    });
  }

  // While an arrival's place labels are up, the map's own names step aside:
  // a park's name would only repeat a pin label or crowd it.
  var quiet = false;
  function quietMap(on) {
    if (!map || quiet === on) return;
    quiet = on;
    map.setPaintProperty("state", "text-opacity", on ? 0 : 1);
    map.setPaintProperty("park-name", "text-opacity", on ? 0 : 1);
  }

  /* ---------- warming the gallery the visitor is probably about to open ---- */

  var prefetched = {}, warmed = {};
  function prefetch(c) {
    if (!c || !c.opener || !NL || prefetched[c.slug]) return;
    prefetched[c.slug] = 1;
    NL.responsive(new Image(), c.opener, CARD_SIZES);
  }
  function warm(c) {
    if (SAVE_DATA || warmed[c.slug] || active !== c.slug || !NL) return;
    warmed[c.slug] = 1;
    var link = el("link");
    link.rel = "prefetch";
    link.href = c.href;
    document.head.appendChild(link);
    // The gallery's own call for its opener, so the browser fetches the same file.
    var ar = c.opener ? NL.aspectOf(c.opener) : 1.5;
    if (c.opener) NL.responsive(new Image(), c.opener, ar <= .95 ? "min(100vw, " + Math.round(88 * ar) + "vh)" : "100vw");
  }

  /* ------------------------------------------------------------------
     THE CARD
     ------------------------------------------------------------------ */

  function fillCard(c) {
    var media = $(".g-card-media");
    media.textContent = "";
    media.href = c.href;
    $(".g-card-go").href = c.href;
    if (c.opener && NL) {
      var img = el("img");
      img.alt = "";
      img.decoding = "async";
      img.style.aspectRatio = NL.aspectOf(c.opener).toFixed(4);
      img.addEventListener("load", function () { img.classList.add("is-loaded"); });
      NL.responsive(img, c.opener, CARD_SIZES);
      media.appendChild(img);
    }
    var parts = { title: c.title, where: c.where, date: c.date, sub: c.sub };
    for (var k in parts) {
      var n = $(".g-card-" + k);
      n.textContent = parts[k] || "";
      n.hidden = !parts[k];
    }
    $(".g-card-prev").classList.toggle("is-end", c.i === 0);
    $(".g-card-next").classList.toggle("is-end", c.i === cols.length - 1);
  }

  var leaveTimer = 0;
  function showCard() {
    if (cardShown) return;
    clearTimeout(leaveTimer);
    card.classList.remove("is-leaving", "is-quick");
    card.classList.add("is-open");
    card.classList.toggle("is-touring", tour);
    stage.classList.add("has-card");
    cardShown = true;
    geo = null;
    dirty = true;
  }
  function hideCard(quick) {
    if (!cardShown) return;
    cardShown = false;
    card.classList.toggle("is-quick", quick);
    card.classList.add("is-leaving");
    card.classList.remove("is-open");
    stage.classList.remove("has-card");
    geo = null;
    hold("card", false);
    leaveTimer = setTimeout(function () { card.classList.remove("is-leaving", "is-quick"); }, 240);
  }

  // Where the card, its photograph, the attribution and the console sit in the stage.
  // Measured only after something may have moved them (geo = null on
  // show/hide, the card's transition end, a resize, or a size change the
  // observer reports), never once a frame.
  var geo = null;
  var watcher = window.ResizeObserver ? new ResizeObserver(function () { geo = null; dirty = true; }) : null;
  if (watcher) watcher.observe(card);
  card.addEventListener("transitionend", function () { geo = null; dirty = true; });
  function geom() {
    if (geo) return geo;
    var s = stage.getBoundingClientRect();
    function rel(n) {
      var r = n && n.getBoundingClientRect();
      return r && r.width ? [r.left - s.left, r.top - s.top, r.right - s.left, r.bottom - s.top] : null;
    }
    return (geo = { card: cardShown ? rel(card) : null, media: cardShown ? rel(card.querySelector(".g-card-media")) : null,
                    attrib: rel(mapEl.querySelector(".maplibregl-ctrl-attrib")), console: L.app ? rel(consoleEl) : null });
  }

  // The connector: a hairline from the collection's pin nearest the card to
  // the card's edge, level with the middle of the photograph, ending in a
  // small square just outside the card.
  function placeWire() {
    var on = L.app && cardShown && state === "arrived" && active && bySlug[active].pins.length;
    var best = null, g = on && geom();
    if (g && g.card && g.media) {
      var cx = g.card[0] - 4, cy = clamp((g.media[1] + g.media[3]) / 2, g.card[1] + 12, g.card[3] - 12), d = 1e9;
      bySlug[active].pins.forEach(function (q) {
        var p = q.p;
        if (!p.show || !p.xy || p.xy.x > cx - 24) return;
        var dd = Math.pow(cx - p.xy.x, 2) + Math.pow(cy - p.xy.y, 2);
        if (dd < d) { d = dd; best = p; }
      });
    }
    wireC.classList.toggle("is-on", !!best);
    wireEnd.classList.toggle("is-on", !!best);
    if (!best) return false;
    var k = REDUCED ? 1 : clamp((now() - wireStart) / 300, 0, 1);
    var dx = cx - best.xy.x, dy = cy - best.xy.y, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var x1 = best.xy.x + dx / len * 12, y1 = best.xy.y + dy / len * 12;
    if (best.label === 1 && best.xy.x + best.lw + 30 < cx) { x1 = best.xy.x + best.lw + 22; y1 = best.xy.y; }   // out of the end of its label
    wireC.setAttribute("x1", x1); wireC.setAttribute("y1", y1);
    wireC.setAttribute("x2", x1 + (cx - x1) * k); wireC.setAttribute("y2", y1 + (cy - y1) * k);
    wireEnd.setAttribute("x", cx); wireEnd.setAttribute("y", cy - 2);
    wireEnd.classList.toggle("is-on", k === 1);
    return k < 1;
  }

  function placeRing() {
    if (state === "intro") return;
    var z = map.getZoom(), op = map.getPitch() > 2 ? 0 : clamp((L.zO + 1.6 - sizeZoom()) / 1, 0, 1);
    ring.style.opacity = op.toFixed(3);
    if (!op) return;
    var r = silhouette(z, map.getCenter().lat, L.h), pad = map.getPadding();
    ring.style.left = (pad.left + (L.w - pad.left - pad.right) / 2) + "px";
    ring.style.top = (pad.top + (L.h - pad.top - pad.bottom) / 2) + "px";
    ring.style.width = (2 * r) + "px";
  }

  /* ------------------------------------------------------------------
     THE SPIN: 1.5°/s by the clock, from the landing on, whenever the
     camera is out at globe zoom with nothing open, pointed at or held and
     the page in view. It stops at once when touched and ramps back a
     second later, for as long as the visitor leaves it be.
     ------------------------------------------------------------------ */

  var spinV = 0, lastFrame = 0, lastSpin = 0, held = {}, released = -1e9;
  var paused = session("nl.spin") === "off", stageVisible = true, dirty = true, dwell = -1;

  function hold(key, on) {
    if (on) { held[key] = 1; spinV = 0; }
    else if (held[key]) { delete held[key]; released = now(); }
  }
  function isHeld() { for (var k in held) return true; return false; }

  function spinStep(t, dt) {
    var allowed = ready && !failed && !REDUCED && !EDITING && !paused && !tour && !document.hidden &&
      stageVisible && state === "overview" && inOverview() && !isHeld() && !map.isMoving() &&
      t - released >= SPIN_RESUME;
    if (!allowed) { spinV = 0; return; }
    spinV = Math.min(1, spinV + dt / SPIN_RAMP);
    if (!spinV || (COARSE && t - lastSpin < 33)) return;   // phones: 30 updates a second
    var c = map.getCenter(), step = Math.min(t - lastSpin, 100);
    lastSpin = t;
    map.jumpTo({ center: [c.lng - SPIN * spinV * step / 1000, c.lat] }, { gSpin: 1 });
  }

  // One loop, from the map's load until a failure ends it.
  var looping = false;
  function loop() { if (!looping) { looping = true; lastFrame = now(); requestAnimationFrame(frame); } }
  function frame(t) {
    if (!ready || failed || !map) { looping = false; return; }
    requestAnimationFrame(frame);
    var dt = Math.min(t - lastFrame, 100);
    lastFrame = t;
    if (!spinV) lastSpin = t;
    spinStep(t, dt);
    tourStep(dt);
    if (dirty) {
      dirty = false;
      layoutPins();
      placeRing();
      placePlate();
      layoutLabels();
      if (placeWire()) dirty = true;        // still drawing in
    }
  }

  /* ------------------------------------------------------------------
     THE TOUR: every collection in list order, six seconds each
     ------------------------------------------------------------------ */

  var tourAt = -1, cardHover = false, progress = $(".g-card-progress");

  function startTour() {
    if (!ready || EDITING) return;
    tour = true;
    tourBtn.setAttribute("aria-pressed", "true");
    stage.classList.add("is-touring");      // stacked: the console stays, the card sits above it
    say(LABELS.tourStarted);
    setTrail([]);
    var i = active ? bySlug[active].i + 1 : 0;
    tourGo(i < cols.length ? i : 0);
  }
  function tourGo(i) {
    if (i >= cols.length) { endTour(true); return; }
    var from = active && bySlug[active], to = cols[i];
    tourAt = i;
    if (from && from.pins.length && to.pins.length && from !== to) {
      setTrail((trail.length ? trail : [from.pins[0].ll]).concat([to.pins[0].ll]));
    }
    card.classList.add("is-touring");
    select(to.slug, "tour");
  }
  function tourStep(dt) {
    if (!tour || dwell < 0) return;
    if (!cardHover) dwell += dt;
    var total = REDUCED ? DWELL_REDUCED : DWELL;
    progress.style.transform = "scaleX(" + Math.min(1, dwell / total).toFixed(4) + ")";
    if (dwell >= total) { dwell = -1; tourGo(tourAt + 1); }
  }
  function endTour(finished) {
    if (!tour) return;
    tour = false;
    dwell = -1;
    tourBtn.setAttribute("aria-pressed", "false");
    stage.classList.remove("is-touring");
    card.classList.remove("is-touring");
    progress.style.transform = "scaleX(0)";
    if (map) {
      map.setPaintProperty("g-trail", "line-opacity", 0);   // fades over 1200ms
      setTimeout(function () { if (!tour) setTrail([]); }, 1300);
    }
    say(LABELS.tourEnded);
    if (finished) overview(); else readout();
  }

  /* ------------------------------------------------------------------
     READOUT AND ANNOUNCEMENTS
     ------------------------------------------------------------------ */

  function coords() {
    var c = map.getCenter(), lng = ((c.lng + 540) % 360) - 180;
    return Math.abs(c.lat).toFixed(1) + "° " + (c.lat >= 0 ? LABELS.north : LABELS.south) + " · " +
           Math.abs(lng).toFixed(1) + "° " + (lng >= 0 ? LABELS.east : LABELS.west);
  }
  function readout() {
    var s, h = lit && bySlug[lit], a = active && bySlug[active];
    if (failed) s = LABELS.rUnavailable;
    else if (deferred && !map) s = LABELS.rDeferred;
    else if (!ready) s = "";
    else if (h && lit !== active) s = h.title + (h.where && !plateFor ? " — " + h.where : "");   // the plate shows it already
    else if (a) s = (state === "selecting" ? "→ " : "") + a.title;
    else if (state === "returning") s = LABELS.rOverview;
    else s = coords();
    readEl.textContent = s;
    if (tour) readEl.insertBefore(el("b", null, LABELS.rTour), readEl.firstChild);
  }

  var sayTimer = 0;
  function say(text) {
    clearTimeout(sayTimer);
    live.textContent = "";
    sayTimer = setTimeout(function () { live.textContent = text; }, 60);
  }

  /* ------------------------------------------------------------------
     FAILURE AND SAVE-DATA: until the map arrives, or if it never does,
     every row is a plain link to its gallery.
     ------------------------------------------------------------------ */

  function fail() {
    if (failed) return;
    failed = true;
    // Everything the map was doing stops: flights, relief, the card, the
    // tour. The list keeps no trace of a selection that is no longer shown.
    flight++;
    clearTimeout(failTimer); clearTimeout(cardTimer); clearTimeout(warmTimer); clearTimeout(leaveTimer);
    clearTimeout(flatTimer); clearTimeout(hoverTimer); clearTimeout(turnTimer);
    cancelAnimationFrame(terrainRaf);
    tour = false; dwell = -1; active = null; lit = null; held = {};
    stage.classList.remove("is-deferred", "is-ready", "has-card", "has-pins", "is-touring");
    stage.classList.add("is-failed");
    card.classList.remove("is-open", "is-leaving", "is-touring");
    cardShown = false;
    tourBtn.setAttribute("aria-pressed", "false");
    cols.forEach(function (c) { c.row.removeAttribute("aria-current"); c.row.classList.remove("is-lit"); });
    if (has(location.hash.slice(1))) {
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    }
    fallback.hidden = false;
    loadBtn.hidden = true;
    ring.removeAttribute("style");
    if (map) { try { map.remove(); } catch (e) {} map = null; }
    ready = false;
    readout();
  }

  window.addEventListener("maplibre:ready", function () { deferred = false; startMap(); });
  window.addEventListener("maplibre:failed", fail);
  window.addEventListener("maplibre:deferred", function () {
    deferred = true;
    clearTimeout(failTimer);
    stage.classList.add("is-deferred");
    fallback.hidden = false;
    loadBtn.hidden = false;
    readout();
  });
  loadBtn.addEventListener("click", function () {
    loadBtn.hidden = true;
    fallback.hidden = true;
    stage.classList.remove("is-deferred");
    failTimer = setTimeout(fail, FAIL_AFTER);
    if (window.NLLoadMapLibre) window.NLLoadMapLibre();
  });

  /* ------------------------------------------------------------------
     WIRING
     ------------------------------------------------------------------ */

  // site.js says so whenever the visitor switches the ground.
  document.addEventListener("nl:theme", applyPalette);

  tourBtn.addEventListener("click", function () { if (tour) endTour(false); else startTour(); });
  overviewBtn.addEventListener("click", overview);
  function syncPause() {
    pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
    setLabel(pauseBtn, LABELS.pause, paused ? LABELS.resumeTip : LABELS.pauseTip);
  }
  pauseBtn.addEventListener("click", function () {
    paused = !paused;
    session("nl.spin", paused ? "off" : "on");
    if (!paused) released = -1e9;
    syncPause();
  });
  syncPause();

  $(".g-card-prev").addEventListener("click", function (e) { e.stopPropagation(); step(-1); });
  $(".g-card-next").addEventListener("click", function (e) { e.stopPropagation(); step(1); });
  $(".g-card-close").addEventListener("click", function (e) { e.stopPropagation(); dismiss(); });
  card.addEventListener("click", function (e) {            // a phone: the whole card is the link
    if (!L.app && active && !e.target.closest("a")) location.href = bySlug[active].href;
  });

  // The card and the console stop the spin while they are pointed at. The
  // list doesn't, so a mouse left resting on it doesn't keep the globe still;
  // a row it points at stops the spin by lighting its pin.
  [[card, "card"], [consoleEl, "console"]].forEach(function (pair) {
    pair[0].addEventListener("pointerenter", function (e) {
      if (e.pointerType === "touch") return;
      hold(pair[1], true);
      if (pair[1] === "card") cardHover = true;
    });
    pair[0].addEventListener("pointerleave", function () { hold(pair[1], false); if (pair[1] === "card") cardHover = false; });
  });
  // Focus in the panel holds the spin for keyboard users; the focus a click
  // leaves on a row is not a reason to keep the globe still.
  var lastDown = -1e9;
  function byKeyboard() { return now() - lastDown > 500; }
  panel.addEventListener("focusin", function () { if (byKeyboard()) hold("focus", true); });
  panel.addEventListener("focusout", function (e) { if (!panel.contains(e.relatedTarget)) hold("focus", false); });

  // The tour stops for anything the visitor does, bar the Tour button
  // itself, the card, the ground switch, and moving focus.
  function groundSwitch(t) { return !!(t && t.closest && t.closest(".theme-toggle")); }
  document.addEventListener("pointerdown", function (e) {
    lastDown = now();
    if (tour && !tourBtn.contains(e.target) && !card.contains(e.target) && !groundSwitch(e.target)) endTour(false);
  }, true);
  window.addEventListener("wheel", function () { if (tour) endTour(false); }, { passive: true });

  document.addEventListener("keydown", function (e) {
    if (tour && e.key !== "Tab" && e.key !== "Shift" && !tourBtn.contains(e.target) && !groundSwitch(e.target)) endTour(false);
    if (!ready) return;
    if (e.key === "Escape") {
      if (active) dismiss();
      else if (state !== "returning" && (state === "free" || !inOverview() || !level())) overview();
      return;
    }
    var t = e.target, field = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && active && !EDITING && !field &&
        !body.classList.contains("is-editing") && !e.metaKey && !e.altKey && !e.ctrlKey) {
      e.preventDefault();
      step(e.key === "ArrowLeft" ? -1 : 1);
    }
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) { stageVisible = entries[0].intersectionRatio >= .1; },
      { threshold: [0, .1, .2] }).observe(stage);
  }

  var resizeTimer = 0;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      drawStars();
      overflowCheck();
      if (!map) return;
      var was = L;
      L = measure();
      geo = null;
      map.resize();
      map.setMinZoom(floorZoom());
      if (was.app !== L.app) {
        addAttribution();
        if (COARSE) map.cooperativeGestures[L.app ? "disable" : "enable"]();
      }
      if (state === "overview" && !active) map.jumpTo({ center: [map.getCenter().lng, OVERVIEW_LAT], zoom: L.zO, pitch: 0, bearing: 0, padding: L.pad });
      // An open card's camera was framed for the old stage (its padding stays
      // on the map): frame it again for the new one. A phone's address bar
      // coming and going doesn't change the stage, so it doesn't count.
      else if (active && state === "arrived" && (was.app !== L.app || was.w !== L.w || was.h !== L.h)) {
        var cam = cameraFor(bySlug[active]);
        if (cam) map.jumpTo(cam);
      }
      dirty = true;
    }, 120);
  });

  // Back from a gallery out of the back-forward cache: wake the clocks.
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    released = now() - SPIN_RESUME + 400;
    held = {};
    dirty = true;
  });

  /* ---------- boot ------------------------------------------------------ */

  L = measure();
  drawStars();
  if (!NL) fail();
  else failTimer = setTimeout(fail, FAIL_AFTER);

  Promise.all([
    getJSON("data/collections.json"),
    getJSON("data/photos.json").catch(function () { return {}; }),
    getJSON("data/places.json").catch(function () { return {}; })
  ]).then(function (r) {
    joinData((r[0] && r[0].collections) || [], (r[1] && r[1].photos) || [], (r[2] && r[2].places) || {});
    var hash = location.hash.slice(1);
    try { hash = decodeURIComponent(hash); } catch (e) {}      // a malformed escape is just an unknown hash
    if (has(hash)) deep = hash;
    var ref = document.referrer || "", m = ref.indexOf(location.origin + "/") === 0 && /\/collections\/([^\/?#]+)\/?(?:[?#].*)?$/.exec(ref);
    if (!deep && m && has(m[1]) && bySlug[m[1]].pins.length) recent = m[1];
    renderList();
    dataReady = true;
    startMap();
  }).catch(function () {
    listEl.textContent = "";
    listEl.appendChild(el("li", "g-list-status", LABELS.noData));
  });

  readout();
})();
