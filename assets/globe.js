/* ==========================================================================
   newton-liu.com — the globe landing.

   A slowly turning globe, day and night on it as they are right now, with
   a pin wherever a collection was photographed, and the list of
   collections beside it. Pointing at a row or pin lights
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
    view: "View collection", arrow: "→", prev: "‹", next: "›", close: "×",
    written: "With writing",
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
     Switches and numbers. Day and night's own (SKY_*, PAPER) and the
     dial's (DIAL_*) head their sections, "THE SKY" and "THE DIAL".
     ------------------------------------------------------------------ */
  var STARS = true;                  // the faint static starfield behind the globe
  var OVERVIEW_LAT = 25;             // the overview looks at this latitude
  var MAX_ZOOM = 9;                  // elevation data stops at 9, so does the camera
  var ARRIVE_ZOOM = 7.8;             // single-pin arrival when places.json gives none
  var SENSITIVE_ZOOM = 7;            // never closer than this for a `sensitive` collection
  var SPIN = 2;                      // degrees per second, westward: the land runs left to right
  var START_LNG = -42;               // the landing has Morocco on the right and the Americas on the left:
                                     // Morocco's card first, then the turn west carries straight on to
                                     // Ecuador's, and on through the Pacific and Asia (Newton asked)
  // Where no pin comes near the middle for a long way (the Pacific after
  // Hawai'i, the Sahara after Sri Lanka, the Atlantic after Morocco) the spin eases up to GAP_BOOST
  // times as fast: from GAP_FROM degrees off the nearest pin, in full by GAP_FULL.
  var GAP_BOOST = 2.5, GAP_FROM = 12, GAP_FULL = 25;
  // The passing card: each up for 4.5 s at least; a pin is due from 6° before
  // the middle to 15° past it, and its card stays until 40° past. On a long
  // empty stretch (where the spin eases up) the next pin is due as soon as it
  // is PASS_REACH degrees off, coming into view: Asia's cards start while the
  // Pacific is still in the middle (Newton asked).
  var PASS_DWELL = 4500, PASS_AHEAD = 6, PASS_BEHIND = 15, PASS_KEEP = 40, PASS_REACH = 60;
  // Newton's running order (2026-10-15), from a landing's first card round to the
  // last. A collection not in it has no passing card (it still shows on hover and
  // in the list): New England and California, for now.
  var PASS_ORDER = ["morocco", "quebec", "ecuador", "peru", "florida", "galapagos", "rio-grande",
    "colorado-nebraska", "desert-west", "yellowstone", "alberta-bc-yukon", "california-film",
    "snowy-west", "alaska", "hawaii", "malaysia", "yunnan", "sri-lanka"];
  // Where cards crowd (the West: six within 15°, each wanting its 4.5 s) the
  // spin slows ahead of time to one even pace that brings every card up by
  // PASS_LATE degrees past its pin. It looks PASS_LOOK degrees ahead, so it
  // eases down from about Florida, holds through the West and eases back up
  // after The Snowy West, its pace changing by PASS_EASE of full speed a
  // second at most (Newton found a last-moment brake too abrupt). Never
  // slower than PASS_BRAKE of full speed.
  var PASS_BRAKE = .35, PASS_LATE = 6, PASS_LOOK = 30, PASS_EASE = .15;
  // Places waiting for their photographs that stay off the globe for now: no
  // pins, road, row or card (Newton, 2026-10-16, until the photographs come).
  // Take a slug out to bring it back. Quebec waits on the globe as usual.
  var HIDE_WAITING = ["morocco", "rio-grande"];
  var SPIN_RESUME = 1000, SPIN_RAMP = 800;
  var HOVER_DELAY = 120, TURN_DELAY = 450;
  var DWELL = 6000, DWELL_REDUCED = 8000;
  var IDLE_RETURN = 10000;           // zoomed in and left alone this long: back out to the turning globe
  var FAIL_AFTER = 20000;            // no map by then (counted while shown) and the list is all there is
  var FAIL_AFTER_ASKED = 60000;      // after "Load globe" (Save-Data, 2G): slow links get a minute
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
     PALETTE — the map's colours on each ground, as a collection arrives
     on it. Black is the default; White, a paper atlas, is
     <html data-theme="light">, set by the square at the end of the nav
     (site.js). Out at the globe both grounds show the same day and night
     (THE SKY): buildStyle() starts from the globe's colours (skyPalette:
     the current ground's, with the Black map's land, sea and ice and the
     day's lines over them), skyBlend() turns them into the ground's own as
     the sky goes, and applyPalette() repaints the map in place when the
     ground changes. What sits over the map in HTML (pins, labels, ring,
     card) takes its colours from the --g-* properties in globe.css; the
     two must agree.
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
  // the plate is always 250px. See .g-card and .g-plate in globe.css.
  var CARD_SIZES = "(min-width: 1024px) max(360px, min(520px, 34vw)), min(440px, 100vw - 32px)";
  var PLATE_SIZES = "250px";

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
  function wrap180(a) { return ((a % 360) + 540) % 360 - 180; }   // any angle (°) to -180..180
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
      // A long hop is drawn as a great-circle arc in steps of a quarter
      // degree at most (32 at most); a road path's short steps stay single.
      var u = vec(pts[i]), v = vec(pts[i + 1]), d = angle(pts[i], pts[i + 1]) * rad, s = Math.sin(d);
      var steps = Math.max(1, Math.min(32, Math.ceil(d / rad / .25)));
      for (var j = i ? 1 : 0; j <= steps; j++) {
        var t = j / steps, k1 = s ? Math.sin((1 - t) * d) / s : 1 - t, k2 = s ? Math.sin(t * d) / s : t;
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
  // Out at the globe each line is cut where it crosses from the paper onto
  // the dark, the night or the slate sea (sun: 1 on the paper), so each
  // stretch can take its own ink (skyBlend); the stretches share the point
  // where they meet, so the line stays whole.
  function lines(groups) {
    var out = [];
    groups.forEach(function (g) {
      var pts = arcs(g.pts), run = [], sun = -1;
      if (!skyOn) { out.push({ type: "Feature", properties: { o: g.o, sun: 0 }, geometry: { type: "LineString", coordinates: pts } }); return; }
      pts.forEach(function (p) {
        var s = skySunlit(p[0], p[1]) ? 1 : 0;
        if (s !== sun && run.length) {
          run.push(p);
          if (run.length > 1) out.push({ type: "Feature", properties: { o: g.o, sun: sun }, geometry: { type: "LineString", coordinates: run } });
          run = [p];
        } else run.push(p);
        sun = s;
      });
      if (run.length > 1) out.push({ type: "Feature", properties: { o: g.o, sun: sun }, geometry: { type: "LineString", coordinates: run } });
    });
    return { type: "FeatureCollection", features: out };
  }

  /* ---------- the page ------------------------------------------------- */

  var body = document.body;
  var NL = window.NLSite;
  var BASE = body.dataset.base || "";
  var stage = $("#g-stage"), mapEl = $("#g-map"), ring = $(".g-ring"), starsEl = $(".g-stars");
  var listEl = $("#g-list"), panel = $(".g-panel"), live = $("#g-live"), readEl = $(".g-readout");
  var card = $(".g-card"), plate = $(".g-plate"), consoleEl = $(".g-console");
  var tourBtn = $(".g-tour"), overviewBtn = $(".g-overview");
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
  var cols = [], bySlug = Object.create(null);   // collections, oldest trip first (the order the pins
                                                 // arrive in; a place waiting for photographs comes last)
  var seq = [];                                  // the same in the list's order, region by region and
                                                 // A to Z (the card's arrows and the tour follow it)
  var regions = [];                              // the list's headings, in order (places.json `regions`)
  function has(slug) { return typeof slug === "string" && Object.prototype.hasOwnProperty.call(bySlug, slug); }
  var pins = [];                            // every pin, oldest trip first
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
     THE SKY: day and night on the globe as they are right now, by the
     visitor's own clock.

     Night is the Black map exactly as it is, nothing laid over it. Day is
     paper: the land in the White ground's paper on a deep slate sea, lit
     as a ball is in sunlight (brightest under the sun, greying toward the
     day's edge), its mountains softly shaded by the real sun, low and long
     toward the dusk, flat under the noon. Out at the globe it is one globe
     on both grounds, whatever page it sits on; coming in to a collection,
     or tilting, the sky goes and each ground has its own plain map again,
     so a card never opens on a lit or darkened map.

     Where the day turns to night runs a crisp gold line, at the middle of
     the dusk (SKY_DUSK), in a faint warm band. It is a vector line over the
     map, not part of the day's tiles: a tile texel is several screen pixels
     out at the globe, so a line drawn in them could only be a soft smear.
     The sun's mark (a ring, a dot, a glow) stands where the sun is
     overhead, and the moon where it is overhead, in its real phase, its
     lit limb toward the sun.

     The day is two raster layers the page draws itself ("nl-day" and
     "nl-land", skyPaperDraw), from the sun's height at each texel. The
     field is smooth, so a few small tiles stretched by MapLibre carry it,
     drawn one at a time between frames, and new every SKY_REFRESH (the line
     moves a quarter of a degree a minute). The day's land half lies under
     the map's water, so its coastlines are the map's own. The relief, and
     whether a pin, a line or the moon stands on land or sea (for its ink),
     come from one tile of elevation: Mapterhorn's whole world at zoom 0
     (512 px, ~120 KB), fetched as the sky comes on; until it is here the
     paper is flat.

     On the paper the night's white ink would vanish, so what is drawn over
     the map changes ink with the ground under it: each pin (.is-sunlit),
     each stretch of a collection's line, the moon (printed over the paper,
     as an almanac prints it) and the sun's mark (a deep amber on the paper,
     Black's own over the slate). The coastlines and borders are one grey
     that reads as light on the night and as graphite on the paper.

     ?t=<an ISO time> (?t=2026-10-14T22:30Z) shows another moment: the sky,
     the moon and the local times on the cards, the clock running on from
     there.
     ------------------------------------------------------------------ */

  var SKY_DUSK = [3, -5];            // the sun's height (°) where the day starts to go, and where it is gone
  // The warm band, by the sun's height (°): [fade in, full, full, fade
  // out]. It spans the dusk and is fullest across its middle, where the
  // paper is half gone to night, so it is the gold line's own light, not a
  // stripe beside it.
  var SKY_GOLD_AT = [3, 0, -2, -5];
  var SKY_GOLD = [236, 186, 118, .12];   // its colour and strength: a gold as pale as late light on paper
  // The gold line: a pale gold hairline in a soft, wider glow of the accent's gold.
  var SKY_LINE_C = { line: "#f3cf86", width: 1.1, glow: "#dca451", glowWidth: 9, glowBlur: 7, glowOp: .5 };
  // The sun's mark: a deep amber over the paper, Black's own amber over the
  // slate (skySunC), in a soft glow of Black's.
  var SKY_SUN_C = { paper: "#8f621a", slate: "#d4a453", glow: "#e0b566", glowOp: .42 };
  var SKY_MOON_C = [214, 218, 226];  // the moon over the night and the slate
  var SKY_MOON_R = 6.5;              // its radius, as the sun's ring
  var SKY_TEX = 128;                 // a day tile's texels a side (MapLibre stretches them to its 256)
  var SKY_REFRESH = 120000;          // new day tiles this often (ms)
  var SKY_RELIEF = true;             // the paper's mountains, in the sun's own light
  var SKY_DEM_TRIES = 3;             // fetches of the relief's tile (one a SKY_REFRESH) before going without
  // The day, in sRGB 0-255. land and sea are under the sun, landEdge and
  // seaEdge where it sets, and between them by the sine of its height to
  // the power `rise`: 1 is how a matte ball takes the light (Lambert), so
  // the paper is brightest under the sun and greys evenly to the edge. The
  // sea is a deep slate, so the day is told by its continents, paper on the
  // dark, and the globe stays a dark thing on the black page: lit, but not
  // grey (a mid-grey sea turned a day facing the Pacific into a flat grey
  // disc). It still takes the light, 68 under the sun to 42 at the day's
  // edge, against the night's 10, so a day that is all ocean is a ball in
  // sunlight. The paper has a whisper of warmth only where the sun is
  // high; at the edge it is neutral, so the dusk never browns.
  // nightLand and nightSea: the map out at the globe, the Black map's land
  // and sea, whatever the ground. ink: how light the ground under a pin, a
  // line or the moon must be (luminance, land and sea as they share the
  // place, skyLandAt) for it to change to the paper's ink; halfway between
  // the two inks reads best on either.
  // The lines: one grey for the coast and the borders that lays down on the
  // night land just what Black's white W(.16) does (59 on 22), and on the
  // paper a graphite hairline (175 on 226); the country names the same way.
  // lineDay and lineNight: a collection's line on the paper and off it.
  // The relief: heights exaggerated `reliefZ` times (the coarse tile's
  // slopes are a few degrees at most), and how far a slope's light moves
  // the paper, per unit of the sine of the sun's height on it, in grey
  // levels. Kept low: a soft relief, as an atlas prints it; at twice this
  // the paper looked like plaster.
  var PAPER = {
    land: [232, 228, 218], landEdge: [166, 165, 162], sea: [66, 68, 72], seaEdge: [40, 42, 47], rise: 1,
    nightLand: rgba(PALETTE.black.land).slice(0, 3), nightSea: rgba(PALETTE.black.sea).slice(0, 3), ink: 135,
    coast: "rgba(108,108,108,.43)", border: "rgba(108,108,108,.43)", country: "rgba(115,115,115,.7)",
    lineDay: "#1b1c20", lineNight: "#fff",
    reliefZ: 16, relief: 80
  };

  // ?t=: the sky's clock, this far from the visitor's (ms).
  var skyOffset = (function () {
    var m = /[?&]t=([^&#]*)/.exec(location.search), t = NaN;
    try { if (m) t = Date.parse(decodeURIComponent(m[1])); } catch (e) {}
    return isFinite(t) ? t - Date.now() : 0;
  })();

  /* ---------- where the sun and the moon are ----------------------------- */

  function skyTime() { return Date.now() + skyOffset; }
  function skyDays(t) { return t / 864e5 - 10957.5; }     // since J2000.0, 2000-01-01 12:00 UT
  // Greenwich mean sidereal time, in degrees: how far the Earth has turned
  // under the stars. The right ascension overhead at longitude λ is GMST + λ.
  function skyGmst(d) {
    var T = d / 36525;
    return ((280.46061837 + 360.98564736629 * d + .000387933 * T * T) % 360 + 360) % 360;
  }
  // The subsolar point [lng, lat]: the sun's position by the US Naval
  // Observatory's approximate formulae (good to a minute of arc for
  // centuries either side of 2000), brought to the ground by GMST.
  function skySunAt(d) {
    var g = (357.529 + .98560028 * d) * rad, q = 280.459 + .98564736 * d;
    var L = (q + 1.915 * Math.sin(g) + .020 * Math.sin(2 * g)) * rad, e = (23.439 - .00000036 * d) * rad;
    var ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad, dec = Math.asin(Math.sin(e) * Math.sin(L)) / rad;
    return [wrap180(ra - skyGmst(d)), dec];
  }
  // The sublunar point [lng, lat]: the moon's ecliptic longitude and
  // latitude by the Astronomical Almanac's low-precision series (good to
  // about 0.3°, 1950-2050), to the equator by the obliquity, to the ground
  // by GMST. Geocentric, as the subsolar point is.
  function skyMoonAt(d) {
    var T = d / 36525, S = function (a, b) { return Math.sin((a + b * T) * rad); };
    var l = 218.32 + 481267.881 * T + 6.29 * S(135.0, 477198.87) - 1.27 * S(259.3, -413335.36) + .66 * S(235.7, 890534.22)
          + .21 * S(269.9, 954397.74) - .19 * S(357.5, 35999.05) - .11 * S(186.5, 966404.03);
    var b = 5.13 * S(93.3, 483202.02) + .28 * S(228.2, 960400.89) - .28 * S(318.3, 6003.15) - .17 * S(217.6, -407332.21);
    var e = (23.439 - .00000036 * d) * rad, L = l * rad, B = b * rad;
    var x = Math.cos(B) * Math.cos(L), y = Math.cos(e) * Math.cos(B) * Math.sin(L) - Math.sin(e) * Math.sin(B);
    var z = Math.sin(e) * Math.cos(B) * Math.sin(L) + Math.cos(e) * Math.sin(B);
    return [wrap180(Math.atan2(y, x) / rad - skyGmst(d)), Math.asin(z) / rad];
  }
  // The moon's lit fraction, from its angle to the sun as seen from the
  // Earth (the two ground points stand for the two directions), and the
  // way to the sun from the point under the moon (degrees from north).
  function skyMoonPhase(sun, moon) {
    var p1 = moon[1] * rad, p2 = sun[1] * rad, dl = (sun[0] - moon[0]) * rad;
    var c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
    var az = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / rad;
    return { lit: (1 - c) / 2, toSun: az };
  }

  /* ---------- the day: two tiles drawn in the page ------------------------ */

  var skySun = [0, 0], skyMoon = [0, 0], skyMoonLit = 0, skyMoonToSun = 0, skyVer = 0, skyRefreshed = 0, skyOp = -1, skyVis = true, skyOn = false;
  var skyQueue = [];
  function skySmooth(a, b, x) { var k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); }
  // A band over the sun's height: [fade in, full, full, fade out], high to low.
  function skyBand(at, A) { return A > at[1] ? skySmooth(at[0], at[1], A) : A < at[2] ? skySmooth(at[3], at[2], A) : 1; }
  // MapLibre asks for every tile in one frame; each is drawn in a task of
  // its own, so the spin never waits on more than one. A tile that fails
  // fails alone: its request is answered, and the queue carries on.
  function skyTile(params) {
    return new Promise(function (done, fail) {
      skyQueue.push(function () { try { done(skyPaperTile(params.url)); } catch (e) { fail(e); } });
      if (skyQueue.length === 1) setTimeout(skyPump, 0);
    });
  }
  function skyPump() {
    var job = skyQueue.shift();
    if (skyQueue.length) setTimeout(skyPump, 0);
    if (job) job();
  }

  // What the day lays down at one place: the land's colour and the sea's
  // (out[0-2], out[3-5]), from h, the sine of the sun's height there.
  // Night is the map's own land and sea; day is paper on slate, from the
  // edge colours at sunset to the full ones under the sun; then the warm
  // band over both, as the dusk's own light. rl: the relief's light on the
  // land (grey levels, + toward the sun, - away), if any.
  function skyPaperAt(h, out, rl) {
    var P = PAPER, c;
    var day = 1 - skySmooth(Math.sin(SKY_DUSK[0] * rad), Math.sin(SKY_DUSK[1] * rad), h);
    var q = h > 0 ? Math.pow(h, P.rise) : 0;
    rl = rl || 0;
    for (c = 0; c < 3; c++) {
      var dl = clamp(P.landEdge[c] + (P.land[c] - P.landEdge[c]) * q + rl, 0, 255), ds = P.seaEdge[c] + (P.sea[c] - P.seaEdge[c]) * q;
      out[c] = P.nightLand[c] + (dl - P.nightLand[c]) * day;
      out[c + 3] = P.nightSea[c] + (ds - P.nightSea[c]) * day;
    }
    var w = Math.min(1, skyBand(SKY_GOLD_AT, Math.asin(clamp(h, -1, 1)) / rad) * SKY_GOLD[3]);
    if (w > 0) { skyTint(out, 0, SKY_GOLD, w); skyTint(out, 3, SKY_GOLD, w); }
    return out;
  }
  // The band over one colour (out[i..i+2]). Over the dark it is light, a
  // glow; over the paper only its hue is taken, the paper's lightness kept,
  // so the dusk warms the paper and never lays a brighter stripe along it
  // (the ramp from paper to night stays a ramp). The glow over the slate
  // and the night is at .6 of the paper's strength: at full strength the
  // gold over the sea ran pole to pole as a tan stripe twice as light as
  // the day's sea beside it.
  function skyTint(out, i, band, w) {
    var l0 = .2126 * out[i] + .7152 * out[i + 1] + .0722 * out[i + 2], c, keep = skySmooth(40, 140, l0);
    w *= .6 + .4 * keep;
    for (c = 0; c < 3; c++) out[i + c] += (band[c] - out[i + c]) * w;
    var l1 = .2126 * out[i] + .7152 * out[i + 1] + .0722 * out[i + 2], l = l1 + (l0 - l1) * keep;
    if (l1 > 0) for (c = 0; c < 3; c++) out[i + c] = Math.min(255, out[i + c] * l / l1);
  }
  // The light under a place, as the eye has it (luminance, 0-255): what
  // decides the ink of a pin, a line or the moon there. Paper and slate
  // are far apart, so it is the two as they share the place (skyLandAt):
  // Hawai'i's pin sits on the sea out at the globe, Arizona's on the paper.
  var skyPaperBuf = new Float32Array(6);
  // `unknown`: how much land to count on while the tile that tells is not
  // here (skyLandAt).
  function skyPaperLum(lng, lat, unknown) {
    var p = lat * rad, h = Math.sin(p) * Math.sin(skySun[1] * rad) + Math.cos(p) * Math.cos(skySun[1] * rad) * Math.cos((lng - skySun[0]) * rad);
    var o = skyPaperAt(h, skyPaperBuf), f = skyLandAt(lng, lat, unknown);
    return f * (.2126 * o[0] + .7152 * o[1] + .0722 * o[2]) + (1 - f) * (.2126 * o[3] + .7152 * o[4] + .0722 * o[5]);
  }
  function skySunlit(lng, lat, unknown) { return skyPaperLum(lng, lat, unknown) > PAPER.ink; }

  // The relief's heights: Mapterhorn's zoom-0 tile (terrarium: metres =
  // R·256 + G + B/256 - 32768), 512 px of Web Mercator, as the arrival's
  // land mask reads it. Fetched as the sky comes on; its arrival redraws
  // the day with its mountains. The same tile says, for the inks, where the
  // land is (Mapterhorn's sea is exactly 0 m, 128,0,0, as landMask reads
  // it): skyLand, 1 on land. The day's own coastlines are the map's water,
  // not this. A fetch that fails is tried again with the next fresh tiles
  // (skyRedraw), SKY_DEM_TRIES in all.
  var skyDem = null, skyLand = null, skyDemAsked = false, skyDemTried = 0;
  function skyDemLoad() {
    if (skyDem || skyDemAsked || skyDemTried >= SKY_DEM_TRIES) return;
    skyDemAsked = true;
    skyDemTried++;
    fetch(demURL(0, 0, 0)).then(function (r) { if (!r.ok) throw r; return r.blob(); })
      .then(function (b) { return createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" }); })
      .then(function (bmp) {
        var cv = el("canvas"), g, d, e = new Float32Array(512 * 512), m = new Uint8Array(512 * 512);
        cv.width = cv.height = 512;
        g = cv.getContext("2d", { willReadFrequently: true });
        g.drawImage(bmp, 0, 0, 512, 512);
        d = g.getImageData(0, 0, 512, 512).data;
        for (var i = 0; i < e.length; i++) {
          e[i] = Math.max(0, d[4 * i] * 256 + d[4 * i + 1] + d[4 * i + 2] / 256 - 32768);
          m[i] = d[4 * i] !== 128 || d[4 * i + 1] || d[4 * i + 2] ? 1 : 0;
        }
        skyDem = e; skyLand = m;
        skyRedraw();
      }).catch(function () { skyDemAsked = false; });
  }
  // How much of the ground round a place is land, 0-1: the tile's pixels
  // (~78 km at the equator) within two of it, about the span of a pin's
  // crosshair out at the globe. Until the tile is here, `unknown`, else
  // land: most pins are inland, and the redraw on its arrival puts the
  // rest right. (The sun's mark counts on sea, as most of the globe is.)
  function skyLandAt(lng, lat, unknown) {
    if (!skyLand) return unknown === undefined ? 1 : unknown;
    var x = Math.floor((wrap180(lng) + 180) / 360 * 512), y = Math.floor((1 - merc(clamp(lat, -85, 85)) / Math.PI) / 2 * 512), n = 0, s = 0;
    for (var j = Math.max(0, y - 2); j <= Math.min(511, y + 2); j++)
      for (var i = x - 2; i <= x + 2; i++) { s += skyLand[j * 512 + (i + 512) % 512]; n++; }
    return s / n;
  }
  // The sine of the sun's height over the ground's own slope at DEM pixel
  // (ix, iy): Horn's 3x3 gradient, exaggerated, against the sun's
  // direction in east, north and up (sE, sN, sU). Rows clamp at the
  // Mercator edge; columns wrap at the antimeridian.
  function skySlopeSun(ix, iy, pix, sE, sN, sU) {
    var E = skyDem, W = 512, xm = (ix + W - 1) % W, xp = (ix + 1) % W, ym = Math.max(0, iy - 1) * W, y0 = iy * W, yp = Math.min(W - 1, iy + 1) * W;
    var gx = (E[ym + xp] + 2 * E[y0 + xp] + E[yp + xp] - E[ym + xm] - 2 * E[y0 + xm] - E[yp + xm]) / (8 * pix);
    var gy = (E[ym + xm] + 2 * E[ym + ix] + E[ym + xp] - E[yp + xm] - 2 * E[yp + ix] - E[yp + xp]) / (8 * pix);   // northward
    var k = PAPER.reliefZ, nx = -k * gx, ny = -k * gy, m = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    return (nx * sE + ny * sN + sU) * m;
  }

  // Two layers make the day, from one set of colours per texel. The map
  // under them is the Black map (land L0, sea S0). "sky-day" lies over land
  // and sea alike (colour C, cover a), so the sea comes out C·a + S0·(1-a);
  // "sky-land" lies on the land alone, under the sea (opaque, colour L1),
  // so the land comes out C·a + L1·(1-a). For the land Ld and the sea Sd
  // wanted, a is the least cover that can make the sea (C at most 255 in
  // every channel), C follows from it, and L1 = S0 + (Ld - Sd) / (1 - a).
  // Least cover, so the night is no cover at all: where the day is gone the
  // first layer is clear and the second is the land's own colour, and the
  // map shows exactly as it is. Both tiles come from one pass; the second
  // asked for waits in skyPair until it is.
  var skyPair = {};
  function skyPaperTile(url) {
    var t = /(\d+)\/(\d+)\/(\d+)/.exec(url), z = +t[1], x = +t[2], y = +t[3], key = z + "/" + x + "/" + y, half = url.indexOf("nl-land") === 0 ? "land" : "day";
    var pair = skyPair[key];
    if (!pair || pair.ver !== skyVer || !pair[half]) {
      for (var k in skyPair) if (skyPair[k].ver !== skyVer) delete skyPair[k];   // an older clock's
      pair = skyPair[key] = skyPaperDraw(z, x, y);
      pair.ver = skyVer;
    }
    var img = pair[half];
    pair[half] = null;
    if (!pair.day && !pair.land) delete skyPair[key];
    // MapLibre's raster shader takes premultiplied colour.
    return createImageBitmap(img, { premultiplyAlpha: "premultiply" }).then(function (bmp) { return { data: bmp }; });
  }
  function skyPaperDraw(z, x, y) {
    var n = 1 << z, S = SKY_TEX, i, j, c;
    var dayImg = new ImageData(S, S), landImg = new ImageData(S, S), dp = dayImg.data, lp = landImg.data, cosH = new Float32Array(S);
    var sd = Math.sin(skySun[1] * rad), cd = Math.cos(skySun[1] * rad), out = new Float32Array(6);
    var S0 = PAPER.nightSea, band = S / 4, sinH = new Float32Array(S), dem = SKY_RELIEF && skyDem, rl = 0;
    for (i = 0; i < S; i++) {
      var hx = ((x + (i + .5) / S) / n * 360 - 180 - skySun[0]) * rad;
      cosH[i] = Math.cos(hx); sinH[i] = Math.sin(hx);
    }
    for (j = 0; j < S; j++) {
      var lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (j + .5) / S) / n))), dg = lat / rad;
      var a0 = Math.sin(lat) * sd, b0 = Math.cos(lat) * cd;
      // MapLibre caps each pole (past 85°) with the edge row of the tiles
      // there, and a cap that small reads the tile's coarse mipmaps, which
      // average many rows. So the tiles at a pole ease into the pole's own
      // light over their last quarter: the cap is one even shade, and the
      // easing bends the sun's height by a few degrees at most, at 83-85°.
      var pole = !y && j < S / 2 ? 1 : y === n - 1 && j >= S / 2 ? -1 : 0, ps = pole * sd;
      var ease = pole ? skySmooth(0, band, pole > 0 ? j : S - 1 - j) : 1;
      // Past 84°N there is only the Arctic Ocean, but MapLibre caps the pole
      // with the land's colour (no sea is drawn there): the land takes the
      // sea's, so the cap is sea by day and by night.
      var arctic = skySmooth(83.6, 84.4, dg);
      // The relief's row: the DEM's row under it, a DEM pixel's size on the
      // ground here (Mercator keeps it square), and the relief fading out
      // toward the pole caps, where the light is eased.
      var cl = Math.cos(lat), sl = Math.sin(lat), iy = Math.min(511, Math.floor((y + (j + .5) / S) / n * 512));
      var pix = 2 * Math.PI * 6371000 * cl / 512, rf = dem ? 1 - skySmooth(78, 82, Math.abs(dg)) : 0;
      for (i = 0; i < S; i++) {
        var h = a0 + b0 * cosH[i], k = 4 * (j * S + i);
        // The sun from here: east and north (the hour angle's sine and
        // cosine), then up; a slope facing it is lit more than the flat, a
        // slope turned away less, as far as the paper is lit at all.
        if (rf > 0 && h > -.05) {
          var sE = -cd * sinH[i], sN = cl * sd - sl * cd * cosH[i];
          rl = (skySlopeSun(Math.floor((x + (i + .5) / S) / n * 512) % 512, iy, pix, sE, sN, h) - h) * PAPER.relief * rf;
        } else rl = 0;
        if (ease < 1) h = ps + (h - ps) * ease;
        skyPaperAt(h, out, rl);
        if (arctic > 0) for (c = 0; c < 3; c++) out[c] += (out[c + 3] - out[c]) * arctic;
        // The least cover that can make the sea, and its 8-bit value.
        var a = 0;
        for (c = 0; c < 3; c++) {
          var s = out[c + 3], s0 = S0[c];
          a = Math.max(a, s > s0 ? (s - s0) / (255 - s0) : s < s0 ? 1 - s / s0 : 0);
        }
        var ab = Math.round(255 * Math.min(a, 1)), af = ab / 255;
        for (c = 0; c < 3; c++) {
          dp[k + c] = af > 0 ? (out[c + 3] - S0[c] * (1 - af)) / af : 0;
          lp[k + c] = af < 1 ? S0[c] + (out[c] - out[c + 3]) / (1 - af) : out[c];
        }
        dp[k + 3] = ab; lp[k + 3] = 255;
      }
    }
    return { day: dayImg, land: landImg };
  }
  function skyURL(protocol) { return protocol + "://{z}/{x}/{y}?v=" + skyVer; }

  /* ---------- the sun, the moon and the gold line -------------------------- */

  // The sun's mark: over the paper the deep amber reads and Black's would
  // fade into it; over the slate it is the other way round. Until the
  // tile that tells land from sea is here, the slate's (skyLandAt).
  function skySunC() { return skySunlit(skySun[0], skySun[1], 0) ? SKY_SUN_C.paper : SKY_SUN_C.slate; }
  function skySunData() {
    return { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [skySun[0], skySun[1]] } };
  }
  function skyMoonData() {
    return { type: "Feature", properties: { rot: skyMoonToSun - 90 },
             geometry: { type: "Point", coordinates: [skyMoon[0], skyMoon[1]] } };
  }
  // The moon's face, drawn here in its phase, the lit limb to the right
  // (the layer turns it to face the sun's mark): the dark of it faint, so
  // a new moon still shows as a disc, and a hairline round the whole.
  // Drawn at the first pixel ratio for good: MapLibre will only swap an
  // image for one of the same size, and a zoomed page or another screen
  // changes the ratio.
  var skyMoonDpr = 0, skyMoonOk = false, skyMoonOp = -1, skyMoonVis = true;
  function skyMoonImage() {
    var dpr = skyMoonDpr || (skyMoonDpr = Math.min(2, window.devicePixelRatio || 1)), R = SKY_MOON_R * dpr, P = Math.ceil(R + 2 * dpr), D = 2 * P;
    var cv = document.createElement("canvas"); cv.width = D; cv.height = D;
    var cx = cv.getContext("2d"), col = "rgb(" + SKY_MOON_C.join(",") + ")", k = skyMoonLit;
    // Over the paper the moon is printed, as an almanac prints it: the
    // dark of it in ink, the lit part paper-white, an ink line round both.
    // (So it is while the tile that tells land from sea is not here: a
    // printed moon reads on the slate too, a light one vanishes on paper.)
    var paper = skySunlit(skyMoon[0], skyMoon[1]), ink = "rgb(27,28,32)";
    function litPart() {
      cx.beginPath();
      cx.arc(P, P, R, -Math.PI / 2, Math.PI / 2, false);
      // The terminator: half an ellipse, bulging out to the dark side past
      // the half moon, back into the lit side before it.
      cx.ellipse(P, P, Math.max(.01, R * Math.abs(1 - 2 * k)), R, 0, Math.PI / 2, -Math.PI / 2, k < .5);
      cx.fill();
    }
    if (paper) {
      cx.fillStyle = ink; cx.globalAlpha = .82; cx.beginPath(); cx.arc(P, P, R, 0, 2 * Math.PI); cx.fill();
      cx.fillStyle = "rgb(250,248,242)"; cx.globalAlpha = 1; litPart();
      cx.globalAlpha = .9; cx.strokeStyle = ink; cx.lineWidth = dpr * .75;
      cx.beginPath(); cx.arc(P, P, R, 0, 2 * Math.PI); cx.stroke();
      return { img: cx.getImageData(0, 0, D, D), dpr: dpr };
    }
    cx.fillStyle = col;
    cx.globalAlpha = .16; cx.beginPath(); cx.arc(P, P, R, 0, 2 * Math.PI); cx.fill();
    cx.globalAlpha = 1; litPart();
    cx.globalAlpha = .55; cx.strokeStyle = col; cx.lineWidth = dpr * .75;
    cx.beginPath(); cx.arc(P, P, R, 0, 2 * Math.PI); cx.stroke();
    return { img: cx.getImageData(0, 0, D, D), dpr: dpr };
  }
  function skyMoonPlace() {
    skyMoon = skyMoonAt(skyDays(skyTime()));
    var ph = skyMoonPhase(skySun, skyMoon);
    skyMoonLit = ph.lit; skyMoonToSun = ph.toSun;
  }
  // The gold line runs where the day is half gone (the middle of SKY_DUSK,
  // by the sine of the sun's height, as the tiles shade it): a small circle
  // that far from the point under the sun, its longitudes kept continuous
  // as arcs() keeps them.
  function skyLineData() {
    var out = [], d = Math.PI / 2 - Math.asin((Math.sin(SKY_DUSK[0] * rad) + Math.sin(SKY_DUSK[1] * rad)) / 2), la = skySun[1] * rad, lo = skySun[0] * rad;
    for (var i = 0; i <= 360; i += 2) {
      var th = i * rad, b = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(th));
      out.push([(lo + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(b))) / rad, b / rad]);
    }
    for (var m = 1; m < out.length; m++) out[m][0] = out[m - 1][0] + wrap180(out[m][0] - out[m - 1][0]);
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: out } };
  }

  /* ---------- on the map ---------------------------------------------------- */

  // From onLoad. The day goes in under the coastlines (and its land half
  // under the sea), so the lines and names draw over it; the gold line and
  // the sun over the coastlines and borders, under the names. Zoom 2 is as
  // fine as the day's field needs.
  var SKY_LAYERS = ["sky-day", "sky-land", "sky-line-glow", "sky-line", "sky-sun-glow", "sky-sun", "sky-sun-ring"];
  var SKY_SOURCES = ["sky-day", "sky-land", "sky-line", "sky-sun"];
  // A circle's paint, flat to the screen, so it stays round at the limb.
  function skyFlat(paint) { paint["circle-pitch-alignment"] = "viewport"; paint["circle-pitch-scale"] = "viewport"; return paint; }
  function skyMapOn() {
    if (skyOn) return;
    try {
      ml.addProtocol("nl-day", skyTile);
      ml.addProtocol("nl-land", skyTile);
      skySun = skySunAt(skyDays(skyTime()));
      skyMoonPlace();
      map.addSource("sky-day", { type: "raster", tiles: [skyURL("nl-day")], tileSize: 256, maxzoom: 2 });
      map.addLayer({ id: "sky-day", type: "raster", source: "sky-day",
        paint: { "raster-fade-duration": 0, "raster-opacity": 1 } }, "coast-lo");
      map.addSource("sky-land", { type: "raster", tiles: [skyURL("nl-land")], tileSize: 256, maxzoom: 2 });
      map.addLayer({ id: "sky-land", type: "raster", source: "sky-land",
        paint: { "raster-fade-duration": 0, "raster-opacity": 1 } }, "water-lo");
      map.addSource("sky-line", { type: "geojson", data: skyLineData() });
      map.addLayer({ id: "sky-line-glow", type: "line", source: "sky-line", layout: { "line-cap": "round" },
        paint: { "line-color": SKY_LINE_C.glow, "line-width": SKY_LINE_C.glowWidth, "line-blur": SKY_LINE_C.glowBlur,
          "line-opacity": SKY_LINE_C.glowOp } }, "country-lo");
      map.addLayer({ id: "sky-line", type: "line", source: "sky-line", layout: { "line-cap": "round" },
        paint: { "line-color": SKY_LINE_C.line, "line-width": SKY_LINE_C.width, "line-opacity": 1 } }, "country-lo");
      // The sun's sign, ☉: a dot in a ring, in a soft glow, flat to the screen.
      var sunC = skySunC();
      map.addSource("sky-sun", { type: "geojson", data: skySunData() });
      map.addLayer({ id: "sky-sun-glow", type: "circle", source: "sky-sun", paint: skyFlat({
        "circle-color": SKY_SUN_C.glow, "circle-radius": 18, "circle-blur": 1, "circle-opacity": SKY_SUN_C.glowOp }) }, "country-lo");
      map.addLayer({ id: "sky-sun", type: "circle", source: "sky-sun", paint: skyFlat({
        "circle-color": sunC, "circle-radius": 2.5, "circle-opacity": 1,
        "circle-stroke-color": "rgba(0,0,0,0)", "circle-stroke-width": 0 }) }, "country-lo");
      map.addLayer({ id: "sky-sun-ring", type: "circle", source: "sky-sun", paint: skyFlat({
        "circle-color": "rgba(0,0,0,0)", "circle-radius": 6.5, "circle-opacity": 1,
        "circle-stroke-color": sunC, "circle-stroke-width": 1, "circle-stroke-opacity": 1 }) }, "country-lo");
      skyOn = true;
      skyRefreshed = now();
    } catch (e) {
      // No sky: each ground's own map throughout, with nothing of a sky
      // half put on left over it (skyFade, which would hide it, never runs).
      SKY_LAYERS.forEach(function (id) { try { if (map.getLayer(id)) map.removeLayer(id); } catch (x) {} });
      SKY_SOURCES.forEach(function (id) { try { if (map.getSource(id)) map.removeSource(id); } catch (x) {} });
      skyBlend(0, true);
      return;
    }
    skyDemLoad();
    skyMoonOn();
  }
  // The moon, in its phase, its lit limb toward the sun. Flat to the
  // screen as the sun is; turned with the map, so it keeps pointing at the
  // sun while the globe turns. On its own, so a moon that fails takes
  // nothing else with it.
  function skyMoonOn() {
    if (!skyOn || skyMoonOk) return;
    try {
      var mi = skyMoonImage();
      map.addImage("sky-moon", mi.img, { pixelRatio: mi.dpr });
      map.addSource("sky-moon", { type: "geojson", data: skyMoonData() });
      map.addLayer({ id: "sky-moon", type: "symbol", source: "sky-moon",
        layout: { "icon-image": "sky-moon", "icon-rotate": ["get", "rot"], "icon-allow-overlap": true, "icon-ignore-placement": true,
                  "icon-pitch-alignment": "viewport", "icon-rotation-alignment": "map" },
        paint: { "icon-opacity": 0 } }, "country-lo");
      skyMoonOk = true;
    } catch (e) {}
  }
  // The clock moved on, or the relief arrived: fresh tiles, drawn anew,
  // and the sun, the moon, the line and every ink put right (and the
  // relief asked for again if it failed to come).
  function skyRedraw() {
    if (!skyOn) return;
    if (!skyDem) skyDemLoad();
    skyVer++;
    skySun = skySunAt(skyDays(skyTime()));
    skyMoonPlace();
    skyRefreshed = now();
    try {
      map.getSource("sky-day").setTiles([skyURL("nl-day")]);
      map.getSource("sky-land").setTiles([skyURL("nl-land")]);
      map.getSource("sky-sun").setData(skySunData());
      map.setPaintProperty("sky-sun", "circle-color", skySunC());
      map.setPaintProperty("sky-sun-ring", "circle-stroke-color", skySunC());
      map.getSource("sky-line").setData(skyLineData());
    } catch (e) {}
    if (skyMoonOk) try {
      map.updateImage("sky-moon", skyMoonImage().img);
      map.getSource("sky-moon").setData(skyMoonData());
    } catch (e) {}
    skyPinsLight();
    if (ready) try { setTether(); } catch (e) {}
  }
  // Each pin's ink from the light under it (skySunlit): ink on the paper,
  // light on the night and the slate (with the stage's is-paper-globe, see
  // globe.css). The sun moves a quarter of a degree a minute, so this keeps
  // up at the tiles' pace; pins arriving later catch up in skyFrame.
  var skyPinsAt = -1;
  function skyPinsLight() {
    pins.forEach(function (p) { p.el.classList.toggle("is-sunlit", skySunlit(p.ll[0], p.ll[1])); });
    skyPinsAt = pins.length;
  }
  // Out at the globe the sky is full. It goes as the camera comes in (over
  // the zoom the rim fades on, a little later) or tilts (gone by 12°, so
  // every pitched arrival lands on a plain map), and once gone its layers
  // are hidden, so they neither draw nor keep tiles. The map's own colours
  // go with it, from the globe's to the ground's (skyBlend), and so do the
  // pins' inks.
  function skyFade() {
    var op = Math.min(clamp((L.zO + 2.2 - sizeZoom()) / 1.2, 0, 1), clamp((12 - map.getPitch()) / 10, 0, 1));
    if (Math.abs(op - skyOp) < .01 && !(op !== skyOp && (op === 0 || op === 1))) return;
    if (skyVis !== op > 0) {
      skyVis = op > 0;
      SKY_LAYERS.forEach(function (id) { map.setLayoutProperty(id, "visibility", skyVis ? "visible" : "none"); });
    }
    skyOp = op;
    stage.classList.toggle("is-paper-globe", op > .5);
    skyBlend(op);
    map.setPaintProperty("sky-day", "raster-opacity", op);
    map.setPaintProperty("sky-land", "raster-opacity", op);
    map.setPaintProperty("sky-sun-glow", "circle-opacity", SKY_SUN_C.glowOp * op);
    map.setPaintProperty("sky-sun", "circle-opacity", op);
    map.setPaintProperty("sky-sun-ring", "circle-stroke-opacity", op);
    map.setPaintProperty("sky-line-glow", "line-opacity", SKY_LINE_C.glowOp * op);
    map.setPaintProperty("sky-line", "line-opacity", op);
  }
  // The moon goes with the sky, and behind the globe's rim the moment it
  // passes it: MapLibre hides an icon on the far side only when it next
  // places its symbols, a beat behind a fast turn. Out at the globe the
  // camera looks straight down at the centre, so it sees as far as
  // horizon() round from it.
  function skyMoonFade() {
    if (!skyMoonOk) return;
    var op = skyOp;
    if (op > 0) {
      var c = map.getCenter(), p1 = c.lat * rad, p2 = skyMoon[1] * rad, rim = Math.cos(horizon(map.getZoom(), c.lat, L.h) * rad);
      var cd = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos((skyMoon[0] - c.lng) * rad);
      op *= skySmooth(rim, rim + .03, cd);
    }
    if (Math.abs(op - skyMoonOp) < .01 && !(op !== skyMoonOp && (op === 0 || op === 1))) return;
    if (skyMoonVis !== op > 0) {
      skyMoonVis = op > 0;
      map.setLayoutProperty("sky-moon", "visibility", skyMoonVis ? "visible" : "none");
    }
    skyMoonOp = op;
    map.setPaintProperty("sky-moon", "icon-opacity", op);
  }
  // Every frame from frame(): the pins' inks as pins arrive, the sky's
  // fade with the zoom and tilt, and fresh tiles when due (only while the
  // sky shows; a hidden one catches up as it comes back).
  function skyFrame() {
    if (!skyOn) return;
    if (skyPinsAt !== pins.length) skyPinsLight();
    skyFade();
    skyMoonFade();
    if (skyOp > 0 && now() - skyRefreshed > SKY_REFRESH) skyRedraw();
  }

  /* ---------- the map under the sky: its colours ---------------------------- */

  // Out at the globe the map is the Black map on either ground (the day is
  // laid over it by the tiles), with PAPER's greys for the lines, which
  // read on the night and on the paper alike. buildStyle() starts it so;
  // coming in to a collection it turns into the ground's own map, step for
  // step with the sky as it goes (skyFade's opacity, in twentieths).
  function skyColors() {
    var B = PALETTE.black;
    return { land: B.land, sea: B.sea, ice: B.ice, coast: PAPER.coast, border: PAPER.border, country: PAPER.country, line: B.line };
  }
  function skyPalette() {
    var G = skyColors(), P = pal(), out = {}, k;
    for (k in P) out[k] = P[k];
    for (k in G) out[k] = G[k];
    return out;
  }
  // "#rgb", "#rrggbb", "rgb()" or "rgba()" → [r, g, b, a]; and a mix of two.
  function rgba(c) {
    var m;
    if ((m = /^#([0-9a-f]{3})$/i.exec(c))) return [0, 1, 2].map(function (i) { return parseInt(m[1][i] + m[1][i], 16); }).concat(1);
    if ((m = /^#([0-9a-f]{6})$/i.exec(c))) return [0, 2, 4].map(function (i) { return parseInt(m[1].substr(i, 2), 16); }).concat(1);
    m = /rgba?\(([^)]*)\)/.exec(c) || [0, "0,0,0,0"];
    var v = m[1].split(",").map(parseFloat);
    return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
  }
  function mix(a, b, k) {
    var x = rgba(a), y = rgba(b), o = x.map(function (v, i) { return v + (y[i] - v) * k; });
    return "rgba(" + Math.round(o[0]) + "," + Math.round(o[1]) + "," + Math.round(o[2]) + "," + o[3].toFixed(3) + ")";
  }
  // Which paint property of which layer each of skyColors() sets.
  var BLEND = {
    land: [["land", "background-color"]], sea: [["water", "fill-color"], ["water-lo", "fill-color"]],
    ice: [["ice", "fill-color"], ["ice-lo", "fill-color"]], coast: [["coast", "line-color"], ["coast-lo", "line-color"]],
    border: [["admin-2", "line-color"], ["admin-2-lo", "line-color"]], country: [["country", "text-color"], ["country-lo", "text-color"]],
    line: [["g-trail", "line-color"], ["g-tether", "line-color"]]
  };
  var skyBlendK = -1;
  function skyBlend(op, force) {
    if (!map) return;
    var k = Math.round(clamp(op, 0, 1) * 20) / 20;
    if (k === skyBlendK && !force) return;
    skyBlendK = k;
    var P = pal(), G = skyColors();
    try {
      for (var key in BLEND) {
        // A collection's line is cut where the day meets the night
        // (lines()), each stretch in its own ink.
        var c = key === "line" ? ["case", ["==", ["get", "sun"], 1], mix(P.line, PAPER.lineDay, k), mix(P.line, PAPER.lineNight, k)]
              : mix(P[key], G[key], k);
        BLEND[key].forEach(function (t) { if (map.getLayer(t[0])) map.setPaintProperty(t[0], t[1], c); });
      }
    } catch (e) {}
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
  // A place with a `title` and no collection yet (Morocco and the Rio
  // Grande, until their photographs come) joins the end: pins, road and
  // row, no photograph and no gallery (`href` null). Once collections.json
  // has it, that entry wins.
  function joinData(collections, photos, places, routes) {
    var byCol = {}, listed = {};
    photos.forEach(function (p) { (byCol[p.collection] = byCol[p.collection] || []).push(p); });
    collections.forEach(function (c) { listed[c.slug] = 1; });
    Object.keys(places).forEach(function (s) {
      var pl = places[s];
      if (HIDE_WAITING.indexOf(s) < 0 && !listed[s] && pl && typeof pl.title === "string" && pl.title) {
        collections = collections.concat([{ slug: s, title: pl.title, date: pl.date || "", waiting: true }]);
      }
    });
    collections.forEach(function (c, i) {
      var shots = byCol[c.slug] || [], pl = places[c.slug] || {}, rt = (routes[c.slug] || {}).path;
      var opener = shots.filter(function (p) { return p.featured; })[0] || shots[0] || null;
      var derived = NL && shots.length ? NL.collectionDate(shots) : "";
      var date = typeof c.date === "string" ? c.date : derived;   // "" hides it
      var col = {
        slug: c.slug, title: c.title || c.slug, sub: c.subtitle || "", date: date,
        // Newton has written something for it (its blurb): it carries the note mark.
        written: !!(c.blurb && String(c.blurb).trim()),
        // A list of places ("Maine · Massachusetts") breaks only after a dot.
        where: (pl.where || "").replace(/ · /g, "\u00a0· "), zoom: pl.zoom, sensitive: !!pl.sensitive, i: i, opener: opener,
        // Its time zone (places.json `tz`, IANA), for the local time on its plate and card.
        tz: typeof pl.tz === "string" ? pl.tz : "",
        // What the console reads while this collection passes (places.json `coords`).
        at: pl.coords && typeof pl.coords.lat === "number" && typeof pl.coords.lng === "number" ? [pl.coords.lat, pl.coords.lng] : null,
        // Its heading in the list (places.json `region`; the order is its `regions`).
        region: typeof pl.region === "string" ? pl.region : "",
        // A several-pin arrival's own turn and tilt (places.json `bearing` and
        // `pitch`, degrees); never turned past 45°, so north stays roughly up.
        bearing: typeof pl.bearing === "number" ? clamp(pl.bearing, -45, 45) : 0,
        pitch: typeof pl.pitch === "number" ? clamp(pl.pitch, 0, 60) : null,
        href: c.waiting ? null : BASE + "collections/" + c.slug + "/", pins: [],
        // The road it took (data/routes.json), drawn in place of the arcs between pins.
        route: rt && rt.length > 1 && rt.every(function (q) { return q && typeof q[0] === "number" && typeof q[1] === "number"; }) ? rt : null
      };
      (pl.pins || []).forEach(function (p) {
        if (typeof p.lat === "number" && typeof p.lng === "number") col.pins.push({ name: p.name || "", ll: [p.lng, p.lat] });
      });
      // The pin that stands for it out at the globe (places.json `lead`, a pin's name); else the first.
      col.lead = col.pins.filter(function (p) { return p.name === pl.lead; })[0] || col.pins[0] || null;
      cols.push(col);
      bySlug[c.slug] = col;
    });
  }

  /* ------------------------------------------------------------------
     THE LIST: ordinary links, grouped under their regions (places.json
     `region`, headings in its `regions` order; A to Z within each, by the
     title as it reads, Newton's call). A pointer click on a row not already
     open flies there instead; a second click, Enter, or a modified click
     follows the link as usual.
     A place waiting for its photographs (no gallery) is a button that flies
     there, listed only while the globe is up.
     While a passing card is up its row is lit too (.is-passing), and on
     the laptop layout the list glides to keep that row in view, unless the
     pointer or keyboard focus is in the list.
     ------------------------------------------------------------------ */

  // A to Z as the title reads ("The Snowy West" under T), accents and case aside.
  function byTitle(a, b) { return a.title.localeCompare(b.title, "en", { sensitivity: "base" }) || a.i - b.i; }

  function renderList() {
    listEl.textContent = "";
    var order = regions.slice(), groups = {};
    seq = [];
    cols.forEach(function (c) { if (c.region && order.indexOf(c.region) < 0) order.push(c.region); });
    order.push("");                         // a collection no region names: last, under no heading
    order.forEach(function (name) {
      var mine = cols.filter(function (c) { return c.region === name; }).sort(byTitle);
      if (!mine.length) return;
      mine.forEach(function (c) { c.n = seq.length; seq.push(c); });
      var g = el("li", "g-region"), ol = el("ol", "g-rows");
      if (name) {
        var h = el("h3", "g-region-head");
        h.appendChild(el("span", "g-region-mark")).setAttribute("aria-hidden", "true");
        h.appendChild(el("span", "g-region-name", name));
        h.appendChild(el("span", "g-region-rule")).setAttribute("aria-hidden", "true");
        g.appendChild(h);
      }
      g.appendChild(ol);
      listEl.appendChild(g);
      groups[name] = ol;
    });
    seq.forEach(function (c) {
      var li = el("li"), a = el("a", "g-row");
      if (c.href) a.href = c.href;
      else { a.setAttribute("role", "button"); a.tabIndex = 0; li.hidden = true; }
      a.setAttribute("data-slug", c.slug);
      a.appendChild(el("span", "g-row-mark")).setAttribute("aria-hidden", "true");
      var t = a.appendChild(el("span", "g-row-title", c.title));
      if (c.written) { t.appendChild(noteMark()); t.appendChild(el("span", "g-sr", ", " + LABELS.written.toLowerCase())); }
      if (visited[c.slug]) a.classList.add("is-visited");
      c.row = a;
      li.appendChild(a);
      groups[c.region].appendChild(li);

      a.addEventListener("pointerenter", function (e) { if (e.pointerType !== "touch") hoverIn(c.slug); });
      a.addEventListener("pointerleave", hoverOut);
      // Keyboard focus lights the row as hover does; the focus a click or a
      // tap leaves behind does not (the pointer already said what it meant).
      a.addEventListener("focus", function () { if (byKeyboard()) hoverIn(c.slug); });
      a.addEventListener("blur", function () { if (lit === c.slug || pending === c.slug) hoverOut(); });
      a.addEventListener("click", function (e) {
        if (!ready || failed || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        // Keyboard (detail 0) follows a row's link; a row with no link is a
        // button, and a screen reader's or voice control's press flies there.
        if (e.detail === 0 && c.href || active === c.slug) return;   // or the second click
        e.preventDefault();
        var r = stage.getBoundingClientRect(), bar = $(".nl-bar"), top0 = bar ? bar.offsetHeight : 0;
        var seen = (Math.min(r.bottom, window.innerHeight) - Math.max(r.top, top0)) / r.height;
        if (!L.app && seen < .6) {          // a phone held sideways: bring the globe back first
          stage.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });   // its scroll-margin clears the ?edit bar
          setTimeout(function () { select(c.slug, "row"); }, 300);
        } else select(c.slug, "row");
      });
      if (!c.href) a.addEventListener("keydown", function (e) {   // a button: Enter or Space presses it
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        a.click();
      });
    });
    showGroups();
    listEl.classList.add("is-new");
    listEl.addEventListener("scroll", overflowCheck, { passive: true });
    listEl.addEventListener("pointerenter", function () { cancelAnimationFrame(glideRaf); });
    ["pointerdown", "wheel", "touchstart", "keydown"].forEach(function (type) {
      listEl.addEventListener(type, function () { cancelAnimationFrame(glideRaf); handled = now(); }, { passive: true });
    });
    overflowCheck();
  }

  // Rows waiting for photographs show only with the globe; a region whose
  // rows are all hidden hides its heading too.
  function showWaiting(on) {
    cols.forEach(function (c) { if (!c.href && c.row) c.row.parentNode.hidden = !on; });
    showGroups();
    overflowCheck();
  }
  function showGroups() {
    Array.prototype.forEach.call(listEl.querySelectorAll(".g-region"), function (g) {
      g.hidden = !g.querySelector(".g-rows > li:not([hidden])");
    });
  }

  // The bottom fade only while there is more list below.
  function overflowCheck() {
    listEl.classList.toggle("is-overflowing", listEl.scrollTop + listEl.clientHeight < listEl.scrollHeight - 2);
  }

  // Where the list should scroll to show a row whole, clear of its region's
  // heading (it sticks at the top) and of the bottom fade; null if it shows.
  // `mid` puts it in the middle instead of just inside the edge.
  function rowScroll(c, mid) {
    if (!L || !L.app || !c.row || c.row.parentNode.hidden) return null;   // stacked: the page scrolls, leave it be
    var head = c.row.closest(".g-region").querySelector(".g-region-head");
    var hh = head ? head.offsetHeight : 0, fade = 24, rr = c.row.getBoundingClientRect();
    var top = rr.top - listEl.getBoundingClientRect().top + listEl.scrollTop, h = rr.height, view = listEl.clientHeight;
    var lo = listEl.scrollTop + hh, hi = listEl.scrollTop + view - fade;
    if (top >= lo && top + h <= hi) return null;
    var to = mid ? top - hh - (view - hh - fade - h) / 2 : top < lo ? top - hh : top + h - view + fade;
    return clamp(Math.round(to), 0, listEl.scrollHeight - view);
  }
  function scrollRowIntoView(c) {
    var to = rowScroll(c, false);
    if (to !== null) { cancelAnimationFrame(glideRaf); listEl.scrollTop = to; }
  }

  // The passing row, glided into view. Hands on the list (the pointer over
  // it, keyboard focus in it, or a press, touch, wheel or key there in the
  // last IDLE_RETURN) leave its scroll alone, and stop a glide under way.
  var glideRaf = 0, handled = -1e9;
  function glideRowIntoView(c) {
    var f = document.activeElement;
    if (listEl.matches(":hover") || now() - handled < IDLE_RETURN) return;
    if (f && listEl.contains(f) && f.matches(":focus-visible")) return;
    var to = rowScroll(c, true);
    if (to === null) return;
    cancelAnimationFrame(glideRaf);
    if (REDUCED) { listEl.scrollTop = to; return; }
    var from = listEl.scrollTop, d = to - from, t0 = 0, dur = clamp(Math.abs(d) * 1.6, 600, 1200);
    if (Math.abs(d) < 2) return;
    glideRaf = requestAnimationFrame(function step(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      listEl.scrollTop = from + d * easeInOut(k);
      if (k < 1) glideRaf = requestAnimationFrame(step);
    });
  }

  /* ------------------------------------------------------------------
     THE MAP: a greyscale style written here, in the globe's colours out
     at the globe and the ground's PALETTE on arrival (skyPalette,
     skyBlend). "omt-low" (zoom 0-1 tiles, ~0.5 MB for the world) draws
     the globe, "omt" takes over at SPLIT for detail (see setSplit).
     Elevation is switched on only once the camera has arrived:
     hillshade, and 3D terrain on laptops.
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
    var P = skyPalette();                  // out at the globe; skyBlend() turns it into the ground's own
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
    skyBlend(skyOn ? Math.max(skyOp, 0) : 0, true);   // the globe's colours, as far as the sky is on
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
    var first = (recent || deep) && bySlug[recent || deep].lead;
    var lng = first ? first.ll[0] : START_LNG;
    // The intro turns the globe at its final size, so it fills the ring
    // from the first frame. Wherever the page scrolls under the globe (the
    // stacked layout), one finger or a plain wheel scrolls the page: turning
    // takes two fingers, zooming Ctrl/⌘ + wheel.
    try {
      map = new ml.Map({
        container: mapEl, style: buildStyle(),
        center: [deep ? lng : lng + 30, OVERVIEW_LAT], zoom: L.zO,
        minZoom: floorZoom(), maxZoom: MAX_ZOOM, maxPitch: 60,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2), renderWorldCopies: false,
        attributionControl: false, keyboard: false, doubleClickZoom: false, boxZoom: false,
        dragRotate: false, pitchWithRotate: false, touchPitch: false, cooperativeGestures: !L.app,
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
    map.on("click", function () { if (active && !afterPlateClick()) dismiss(); });

    var cc = map.getCanvasContainer();
    cc.addEventListener("pointerdown", function () { hold("drag", true); }, { passive: true });
    window.addEventListener("pointerup", function () { hold("drag", false); }, { passive: true });
    // A swipe the browser turns into a page scroll ends in pointercancel.
    window.addEventListener("pointercancel", function () { hold("drag", false); }, { passive: true });
    cc.addEventListener("wheel", function () { spinV = 0; released = now(); }, { passive: true });
    buildPins();
    buildDial();
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
    showWaiting(true);
    map.setMinZoom(floorZoom());
    applyPalette();                         // in case the ground changed while the style loaded
    skyMapOn();                             // day and night on the globe, by the visitor's clock
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
     (layoutPins). At the overview only each collection's lead pin shows;
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
        var p = { c: c, slug: c.slug, pi: pi, lead: pp === c.lead, ll: pp.ll, el: e, show: true, xy: null, stack: null, label: 0, lw: 0 };
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
    if (!ready || afterPlateClick()) return;
    if (p.stack && p.slug !== active) {          // a stack: come closer instead of guessing
      map.easeTo({ center: p.ll, zoom: Math.min(MAX_ZOOM, map.getZoom() + 1.6), duration: REDUCED ? 0 : 700 });
      return;
    }
    if (p.slug === active) { if (p.c.href) location.href = p.c.href; return; }
    select(p.slug, "pin");
  }

  function setPinClasses() {
    pins.forEach(function (p) {
      var cl = p.el.classList;
      cl.toggle("is-active", p.slug === active);
      cl.toggle("is-lit", !!lit && p.slug === lit && p.slug !== active);
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
      var show = !(anchorsOnly && !p.lead && p.slug !== active && p.slug !== lit);
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
  // between them (straight hops only; see below), or another label. The pin with the fewest free places
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
        // The straight hop to the next pin, unless a road is drawn instead (a
        // label's dark ground may sit over a road; it has nowhere else to go).
        if (!c.route && n && n.show && n.xy) segs.push([p.xy.x, p.xy.y, n.xy.x, n.xy.y]);
        if (!p.lw) measureLabel(p);
        // Right, left, above or below; above and below a label may slide
        // sideways to stay on screen, or sit off to one side (its near end
        // just past the pin) when the middle is taken. A long name may also
        // break onto two lines, tried after every one-line place.
        var one = places(p.xy.x, p.xy.y, p.lw, p.lh, 0), two = p.lw2 ? places(p.xy.x, p.xy.y, p.lw2, p.lh2, 1) : [];
        // Right beside the pin first, on one line then two; the corners,
        // where a name could be read as its neighbour's, only after that.
        p.cands = one.slice(0, 4).concat(two.slice(0, 4), one.slice(4), two.slice(4));
        p.cands.sort(function (a, b) { return (b[4] === p.label) - (a[4] === p.label); });
        want.push(p);
      });
    }
    // `loose`: a label may cross the line between pins (its dark ground sits
    // over it) when that is the only way it gets shown at all.
    function places(x, y, lw, lh, wrap) {
      var w = lw / 2 + 2, h = lh / 2, x0 = clamp(x - w, minX, Math.max(minX, maxX - 2 * w)), dx = Math.round(x0 + w - x), r = Math.round(w + 4);
      return [[x + 14, y - h, x + 16 + lw, y + h, 1, 0, wrap], [x - 16 - lw, y - h, x - 14, y + h, -1, 0, wrap],
              [x0, y - 12 - lh, x0 + 2 * w, y - 12, 2, dx, wrap], [x0, y + 12, x0 + 2 * w, y + 12 + lh, -2, dx, wrap],
              [x + 4, y - 12 - lh, x + 4 + 2 * w, y - 12, 2, r, wrap], [x - 4 - 2 * w, y - 12 - lh, x - 4, y - 12, 2, -r, wrap],
              [x + 4, y + 12, x + 4 + 2 * w, y + 12 + lh, -2, r, wrap], [x - 4 - 2 * w, y + 12, x - 4, y + 12 + lh, -2, -r, wrap]];
    }
    function free(b, self, loose) {
      if (b[0] < minX || b[2] > maxX || b[1] < (L.app ? 72 : 8) || b[3] > L.h - 8) return false;
      for (var i = 0; i < boxes.length; i++) {
        var o = boxes[i];
        if (o[4] !== self && b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false;
      }
      if (!loose) for (var j = 0; j < segs.length; j++) if (crosses(b, segs[j])) return false;
      return true;
    }
    want.forEach(function (p) { p.nFree = p.cands.filter(function (b) { return free(b, p); }).length; });
    want.sort(function (a, b) { return a.nFree - b.nFree || a.pi - b.pi; });
    want.forEach(function (p) {
      var b = p.cands.filter(function (b) { return free(b, p); })[0] || p.cands.filter(function (b) { return free(b, p, true); })[0];
      p.side = b ? b[4] : 0;
      p.dx = b && b[5] || 0;
      p.wrapped = !!(b && b[6]);
      if (b) boxes.push(b);
    });
    pins.forEach(function (p) {
      var side = want.indexOf(p) < 0 ? 0 : p.side;
      if (side && p.el.style.getPropertyValue("--dx") !== p.dx + "px") p.el.style.setProperty("--dx", p.dx + "px");
      if (side && p.el.classList.contains("is-wrap") !== p.wrapped) p.el.classList.toggle("is-wrap", p.wrapped);
      if (p.label === side) return;
      p.label = side;
      p.el.classList.toggle("has-label", !!side);
      for (var k in SIDES) if (SIDES[k]) p.el.classList.toggle(SIDES[k], String(side) === k);
    });
  }
  // A label's size on one line, and (for a long name) on two: measured once,
  // hidden labels still take up their room.
  function measureLabel(p) {
    var lab = p.el.querySelector(".g-pin-label"), had = p.el.classList.contains("is-wrap");
    p.el.classList.remove("is-wrap");
    p.lw = lab.offsetWidth; p.lh = lab.offsetHeight || 20;
    p.lw2 = 0;
    var text = lab.textContent.trim(), words = text.split(/\s+/);
    if (p.lw > 130 && words.length > 1) {
      // Two lines, never three: the break that leaves the longer line
      // shortest. The type is monospaced, so width goes by characters.
      var cs = getComputedStyle(lab), pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      var best = text.length;
      for (var i = 1; i < words.length; i++) {
        best = Math.min(best, Math.max(words.slice(0, i).join(" ").length, words.slice(i).join(" ").length));
      }
      p.el.style.setProperty("--wrap", Math.ceil(best * (p.lw - pad) / text.length + pad + 2) + "px");
      p.el.classList.add("is-wrap");
      if (lab.offsetHeight > p.lh * 1.4 && lab.offsetHeight < p.lh * 2.6) { p.lw2 = lab.offsetWidth; p.lh2 = lab.offsetHeight; }
      p.el.classList.remove("is-wrap");
    }
    if (had) p.el.classList.add("is-wrap");
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

  // The line through a collection's places: its road if it has one, else
  // arcs from pin to pin in route order; none for a single pin.
  function tetherOf(c) {
    if (c.route) return c.route;
    return c.pins.length > 1 ? c.pins.map(function (p) { return p.ll; }) : null;
  }

  function setTether() {
    if (!ready) return;
    var g = [];
    if (active && tetherOf(bySlug[active])) g.push({ o: .45, pts: tetherOf(bySlug[active]) });
    if (lit && lit !== active && tetherOf(bySlug[lit])) g.push({ o: .3, pts: tetherOf(bySlug[lit]) });
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
    // Pointing at another collection takes the plate over; pointing at the
    // one passing keeps its card, live, so the pointer can go on to click it.
    if (passing && slug && slug !== passing) endPass();
    lit = slug;
    crowd = null;
    cols.forEach(function (c) { c.row.classList.toggle("is-lit", c.slug === slug); });
    if (!ready) return;
    setPinClasses();
    setTether();
    hold("lit", !!slug);
    if (slug && slug !== active) { prefetch(bySlug[slug]); if (slug !== passing) showPlate(bySlug[slug]); }
    else if (!passing) hidePlate();
    readout();
    dirty = true;
  }

  // While at the overview, a collection round the back turns to face you.
  function turnTo(slug) {
    var c = bySlug[slug];
    if (!ready || !c || !c.pins.length || !inOverview() || state !== "overview") return;
    var ctr = map.getCenter(), p = c.lead.ll;
    if (angle([ctr.lng, ctr.lat], p) <= 70) return;
    map.easeTo({ center: [p[0], OVERVIEW_LAT], duration: REDUCED ? 0 : 900, padding: L.pad });
  }

  /* ---------- the plate: a small preview beside the pin ------------------- */

  var plateFor = null, crowd = null, plateH = 0, plateW = 250, plateBox = null;

  function showPlate(c, at) {
    if (!L.app || COARSE || !c.pins.length) { hidePlate(); return; }
    plate.textContent = "";
    plate.classList.toggle("is-text", !c.opener);   // no photograph yet: the title alone
    if (c.opener && NL) {
      var img = el("img");
      img.alt = "";
      img.draggable = false;               // a drag on the passing card isn't a drag of its photo
      img.style.aspectRatio = NL.aspectOf(c.opener).toFixed(4);
      NL.responsive(img, c.opener, PLATE_SIZES);
      plate.appendChild(img);
    }
    plateTitle(c);
    // The local time floats right after the place, so it ends its last
    // line when there is room, and takes a line of its own when there is not.
    var time = colTime(c);
    if (c.where || time) {
      var where = el("p", "g-plate-where", c.where);
      if (time) where.appendChild(el("span", "g-plate-time", time));
      plate.appendChild(where);
    }
    plateCol = c;
    openPlate(at || c.lead.p);
  }
  // A collection's name on the plate, its note mark (if it has writing) at
  // the far right, over the local time.
  function plateTitle(c) {
    var t = plate.appendChild(el("p", "g-plate-title", c.title));
    if (c.written) t.appendChild(noteMark());
  }
  function crowdPlate(p) {
    if (!L.app || COARSE) return;
    if (passing) endPass();
    light(null);
    crowd = p;
    plate.textContent = "";
    plate.classList.add("is-text");        // titles only, each set apart, the plate as wide as they need
    [p.slug].concat(p.stack).forEach(function (s) { plateTitle(bySlug[s]); });
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
    clockTick();
  }
  function hidePlate() {
    plateFor = null; crowd = null; plateBox = null;
    plate.classList.remove("is-on");
    wireP.classList.remove("is-on");
  }

  function placePlate() {
    var p = plateFor;
    if (!p) return;
    if (!p.show) p = (p.c.pins.filter(function (q) { return q.p.show; })[0] || {}).p;
    if (!p || !p.xy) { plate.style.visibility = "hidden"; wireP.classList.remove("is-on"); plateBox = null; return; }
    plate.style.visibility = "";
    var w = plateW, h = plateH, x = p.xy.x + 16, right = L.w - L.e;
    if (cardShown) right = L.w - L.e - cardWidth() - 16;
    if (x + w > right) x = p.xy.x - 16 - w;
    x = clamp(x, L.F, right - w);
    var y = clamp(p.xy.y - h / 2, 72, L.h - 108 - h);
    plate.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    plateBox = [x, y, x + w, y + h];       // the dial's numbers step aside for it
    var leftSide = x < p.xy.x;
    wireP.setAttribute("x1", p.xy.x + (leftSide ? -8 : 8));
    wireP.setAttribute("y1", p.xy.y);
    wireP.setAttribute("x2", leftSide ? x + w : x);
    wireP.setAttribute("y2", clamp(p.xy.y, y + 1, y + h - 1));
    wireP.classList.toggle("is-on", Math.abs((leftSide ? x + w : x) - p.xy.x) > 10);
  }

  /* ---------- the passing card: the plate, as the globe turns on its own ---

     Out at the overview with nothing pointed at or open, the collections
     take turns in Newton's running order (PASS_ORDER), each card up for
     PASS_DWELL at least. The next one comes up once its pin is due, from
     PASS_AHEAD before the middle; where nothing is near the middle
     (gapBoost), as soon as its pin comes into view (PASS_REACH), once the
     card up is on its way out. Where cards crowd, the spin eases to the pace
     that gives each its time near its pin (passPace, passBrake). A
     landing starts at the top of the order; after anything else (a return
     from a gallery, a drag, a flight home, a stack pointed at) the order
     picks up at the first card whose pin hasn't yet passed the middle and
     that hasn't shown in the last half turn. A card whose pin got more than
     PASS_KEEP past before its turn is skipped, till the next turn.
     Pointing at the plate holds the spin; clicking it flies there. */

  var passing = null, passedAt = 0, passPin = null, lastPassed = {}, passAt = null;
  var passOrder = null, passSlot = null, passNext = -1, passLost = true, passFresh = true, passBrakeTo = 1;
  function passStep(t) {
    var can = ready && !REDUCED && !tour && !active && !crowd && state === "overview" && inOverview();
    if (!can) { passLost = true; passBrakeTo = 1; if (passing) { endPass(); hidePlate(); } return; }
    // Held as it is while pointed at (the card, its pin or row, or a row the
    // pointer is crossing) and while the globe is dragged or eased by hand:
    // a fling across the Americas shouldn't flash a card per pin. A globe
    // that moved picks the order up again from where it stops.
    if (held.drag || map.isMoving()) passLost = true;
    if (held.plate || lit || pending || held.drag || map.isMoving()) return;
    if (!passOrder) passSlots();
    if (!passOrder.length) return;
    var c = map.getCenter(), at = passPins(), cur = null;
    if (passing && at[passing]) {
      var dc = wrap180(c.lng - at[passing].ll[0]);
      if (dc >= -PASS_KEEP && dc <= Math.max(PASS_KEEP, PASS_REACH)) cur = dc;
    }
    var first = false;
    if (passLost || passNext < 0) {
      // The top of the order only while the globe still faces the landing (a
      // visitor may have flown it elsewhere before the first card).
      first = passFresh && !recent && !deep && Math.abs(wrap180(c.lng - passSlot[0])) <= PASS_KEEP;
      passNext = first ? 0 : passFind(c.lng, t);
      passLost = passFresh = false;
    }
    // A card the globe has carried too far before its turn waits for the next turn.
    for (var n = 0; n < passOrder.length && !first && passNext >= 0; n++) {
      if (wrap180(c.lng - bySlug[passOrder[passNext]].lead.ll[0]) >= -PASS_KEEP) break;
      passNext = (passNext + 1) % passOrder.length;
    }
    var s = passNext >= 0 ? passOrder[passNext] : null, p = s && at[s];
    var d = s ? wrap180(c.lng - (p ? p.ll : bySlug[s].lead.ll)[0]) : 0;   // > 0: still to come, left of the middle
    passBrakeTo = passPace(c.lng, t);
    // The card up keeps its time while its pin is in view.
    if (passing && at[passing] && t - passedAt < PASS_DWELL) return;
    var due = p && (first ? Math.abs(d) <= PASS_KEEP : d <= PASS_AHEAD ||
      gapBoost(c.lng) > 1 && d <= PASS_REACH && (cur === null || cur < -PASS_BEHIND));
    if (due) {
      pass(s, p, t);
      passNext = (passNext + 1) % passOrder.length;
    } else if (passing && cur === null) { endPass(); hidePlate(); }
  }
  // The order's collections that are on the globe, and where each stands in
  // it: its lead pin's longitude, never east of the one before (Peru's Lima is
  // 1.7° east of Ecuador's Mindo, but Peru comes second).
  function passSlots() {
    passOrder = PASS_ORDER.filter(function (s) { return bySlug[s] && bySlug[s].lead; });
    passSlot = [];
    passOrder.forEach(function (s, i) {
      var lng = bySlug[s].lead.ll[0];
      if (i) {
        var prev = passSlot[i - 1], back = ((prev - lng) % 360 + 360) % 360;
        lng = back > 180 ? prev : prev - back;
      }
      passSlot.push(lng);
    });
  }
  // The pace (a share of the spin's own there) at which every card coming up
  // within PASS_LOOK has its turn by PASS_LATE past its pin: the k-th card
  // to come can't show until the card up and the k before it have had their
  // PASS_DWELL each. Where they are far apart, full pace.
  function passPace(lng, t) {
    var n = passOrder.length, v = Infinity;
    if (passNext < 0) return 1;
    var rest = passing ? Math.max(0, PASS_DWELL - (t - passedAt)) : 0;
    var ahead = wrap180(lng - passSlot[passNext]);
    for (var k = 0; k < n; k++) {
      var i = (passNext + k) % n, wait = rest + k * PASS_DWELL;
      if (k) ahead += ((passSlot[(i + n - 1) % n] - passSlot[i]) % 360 + 360) % 360;
      if (ahead > PASS_LOOK) break;
      if (wait > 0) v = Math.min(v, (wrap180(lng - bySlug[passOrder[i]].lead.ll[0]) + PASS_LATE) * 1000 / wait);
    }
    return v === Infinity ? 1 : clamp(v / (SPIN * gapBoost(lng)), PASS_BRAKE, 1);
  }
  // The pin that carries each collection's card: its own, or the stack it is in.
  function passPins() {
    var at = {};
    pins.forEach(function (p) {
      if (!p.show || !p.xy) return;
      if (!at[p.slug] || p.lead) at[p.slug] = p;
      (p.stack || []).forEach(function (s) { if (!at[s]) at[s] = p; });
    });
    return at;
  }
  // Where the order picks up: the first card still to come (by passSlot; a pin
  // up to 2° past the middle counts), skipping any shown in the last half turn.
  // Those already past wait for the next turn, so the West isn't replayed at a crawl.
  function passFind(lng, t) {
    var best = -1, soonest = Infinity, halfTurn = 180 / SPIN * 1000;
    passOrder.forEach(function (s, i) {
      if (s === passing || t - (lastPassed[s] === undefined ? -Infinity : lastPassed[s]) < halfTurn) return;
      var left = ((wrap180(lng - passSlot[i]) + 2) % 360 + 360) % 360;
      if (left < soonest) { soonest = left; best = i; }
    });
    return best;
  }
  function pass(slug, at, t) {
    if (passing) endPass();
    passing = slug; passedAt = t; lastPassed[slug] = t;
    passPin = at;
    at.el.classList.add("is-passing");
    var c = bySlug[slug];
    c.row.classList.add("is-passing");      // its row lights with it, and comes into view
    if (L.app) glideRowIntoView(c);
    // The console reads the collection's place from now until the next one
    // passes; a phone (no plates) gets that and the lit pin, no card.
    passAt = bySlug[slug].at || [at.ll[1], at.ll[0]];
    if (L.app && !COARSE) {
      showPlate(bySlug[slug], at);
      plate.classList.add("is-live");
    }
    readout();
  }
  function endPass() {
    if (passPin) passPin.el.classList.remove("is-passing");
    if (passing) bySlug[passing].row.classList.remove("is-passing");
    passing = null; passPin = null;
    plate.classList.remove("is-live");
    hold("plate", false);
  }
  var plateClicked = -1e9;
  plate.addEventListener("pointerenter", function (e) { if (passing && e.pointerType !== "touch") hold("plate", true); });
  plate.addEventListener("pointerleave", function () { hold("plate", false); });
  plate.addEventListener("click", function () {
    if (!passing) return;
    plateClicked = now();                  // the second click of a double-click lands on the map or a pin
    select(passing, "plate");
  });
  // A wheel over the card is meant for the globe: the card steps aside.
  plate.addEventListener("wheel", function () { if (passing) { endPass(); hidePlate(); } }, { passive: true });
  function afterPlateClick() { return now() - plateClicked < 450; }

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
    (c.route || []).forEach(function (q) { b.extend(q); });   // a road can run past its last pin
    map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    var cam = map.cameraForBounds(b, { padding: pad });
    map.setPadding(keep);
    // A long, thin trip may arrive turned (places.json `bearing`) so it lies
    // along the free area's longer side, and comes closer by turnedFit()'s
    // gain. A phone's squarer band can fit it a little wider; its names
    // still find more room there turned than north up.
    var t = cam && c.bearing ? turnedFit(c, pad) : null;
    // The 3.2 floor keeps a laptop arrival close; a phone's small stage
    // follows the fit, so a wide spread (Alaska) still lands above the card.
    // A laptop frames the places close (room for their names beside the
    // card); a phone's short band above the card keeps a wider margin.
    var zoom = cam ? clamp(cam.zoom + (t ? t.gain : 0) - (L.app ? .15 : .45), L.app ? 3.2 : Math.min(3.2, L.zO + .2), 7.4) : 4, y0 = merc(b.getSouth()), y1 = merc(b.getNorth());
    if (c.sensitive) zoom = Math.min(zoom, SENSITIVE_ZOOM);
    var mid = t ? t.mid : [(b.getWest() + b.getEast()) / 2, (2 * Math.atan(Math.exp((y0 + y1) / 2)) - Math.PI / 2) / rad];
    // A lower `pitch` (places.json) squeezes the far end of the trip less.
    return { center: mid, zoom: zoom, pitch: c.pitch == null ? 32 : c.pitch, bearing: t ? c.bearing : 0, padding: pad };
  }
  // cameraForBounds turns only the corners of the bounds, which for a
  // diagonal trip frames it wider, not closer. So the places and road are
  // turned themselves, measured flat in Mercator as cameraForBounds
  // measures: how much closer they fit turned than north up (in zoom
  // levels), and their middle once turned.
  function turnedFit(c, pad) {
    var w = L.w - pad.left - pad.right, h = L.h - pad.top - pad.bottom;
    if (w <= 0 || h <= 0) return null;
    var pts = c.pins.map(function (p) { return p.ll; }).concat(c.route || []);
    function box(cs, sn) {
      var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      pts.forEach(function (q) {
        var e = q[0] * rad, n = merc(q[1]), x = e * cs - n * sn, y = e * sn + n * cs;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      });
      return { s: Math.min(w / Math.max(x1 - x0, 1e-9), h / Math.max(y1 - y0, 1e-9)), x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    }
    var a = c.bearing * rad, cs = Math.cos(a), sn = Math.sin(a), flat = box(1, 0), t = box(cs, sn);
    var e = t.x * cs + t.y * sn, n = t.y * cs - t.x * sn;
    return { gain: Math.log(t.s / flat.s) / Math.LN2, mid: [e / rad, (2 * Math.atan(Math.exp(n)) - Math.PI / 2) / rad] };
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
    say(LABELS.showing.replace("{title}", c.title) + (how === "row" && c.href ? " " + LABELS.again : ""));
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

  // The card goes; the camera stays where it is (overview() then flies home).
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

  // A click on the map: the card goes and the camera stays — unless it is
  // already out at globe zoom, where it settles into the overview. Esc and ×
  // go further: straight back out to the turning globe (overview()).
  function dismiss() { closeCard(); tidy(); }

  function step(d) {
    if (!active) return;
    var i = bySlug[active].n + d;
    if (i >= 0 && i < seq.length) select(seq[i].slug, "key");
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
    if (SAVE_DATA || warmed[c.slug] || active !== c.slug || !NL || !c.href) return;
    warmed[c.slug] = 1;
    var link = el("link");
    link.rel = "prefetch";
    link.href = c.href;
    document.head.appendChild(link);
    // The gallery's own call for its opener, so the browser fetches the same file.
    var ar = c.opener ? NL.aspectOf(c.opener) : 1.5;
    if (c.opener) NL.responsive(new Image(), c.opener, ar <= .95 ? "min(100vw, " + Math.round(88 * ar) + "vh)" : "100vw");
  }

  /* ---------- the local time, on the plate and the card ----------------- */

  // One time to a collection, in its place's zone (places.json `tz`: a
  // collection that crosses a line keeps to the zone of the pin that stands
  // for it), 12-hour with AM/PM ("7:36 AM": Newton asked, since "07:36"
  // alone doesn't say morning or evening), by the sky's clock, so ?t= moves it too. Checked
  // every few seconds while the plate or the card is up, so the minute
  // turns over on time. A place with no `tz` shows no time.
  var clockFmt = {}, cardCol = null, plateCol = null, clockTimer = 0;
  function clockAt(tz) {
    if (!tz || !window.Intl) return "";
    try {
      var f = clockFmt[tz] || (clockFmt[tz] = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }));
      return f.format(new Date(skyTime())).replace(/\s+/g, "\u00a0");   // AM/PM never wraps away from the time
    } catch (e) { return ""; }
  }
  function colTime(c) { return c ? clockAt(c.tz) : ""; }
  function clockTick() {
    var on = false, t;
    if (plateFor && plateCol && !crowd) {
      t = $(".g-plate-time");
      if (t) { var v = colTime(plateCol); if (t.textContent !== v) t.textContent = v; on = true; }
    }
    if (cardShown && cardCol) {
      t = $(".g-card-time");
      var w = colTime(cardCol);
      if (t && t.textContent !== w) { t.textContent = w; t.hidden = !w; }
      on = true;
    }
    clearTimeout(clockTimer);
    if (on) clockTimer = setTimeout(clockTick, 5000);
  }

  /* ------------------------------------------------------------------
     THE CARD
     ------------------------------------------------------------------ */

  // The note mark: a collection Newton has written something for (a blurb
  // on its page) shows a small scroll beside its name, in the list, and at
  // the right end of its name's line on the plate and the card (Newton's
  // pick of eight, 2026-10-16).
  function noteMark() {
    var s = el("span", "g-note");
    s.title = LABELS.written;
    s.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/>' +
      '<path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg>';
    return s;
  }

  function fillCard(c) {
    var media = $(".g-card-media");
    media.textContent = "";
    if (c.href) { media.href = c.href; $(".g-card-go").href = c.href; }
    else { media.removeAttribute("href"); $(".g-card-go").removeAttribute("href"); }
    card.classList.toggle("is-waiting", !c.href);     // no gallery yet: no photograph, no "View collection"
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
    if (c.written) $(".g-card-title").appendChild(noteMark());
    card.classList.toggle("is-written", !!c.written);
    cardCol = c;
    var ct = $(".g-card-time"), foot = $(".g-card-foot");
    if (ct) { ct.textContent = colTime(c); ct.hidden = !ct.textContent; }
    if (foot) foot.hidden = !c.where && !(ct && ct.textContent);   // neither: no gap under the title
    $(".g-card-prev").classList.toggle("is-end", c.n === 0);
    $(".g-card-next").classList.toggle("is-end", c.n === seq.length - 1);
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
    clockTick();
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
     THE DIAL: the ring as an instrument's bezel (laptop layout only).

     It reads longitude, and turns with the globe. A meridian sits at its
     longitude less the camera's, clockwise from 12 o'clock: 12 o'clock is
     the meridian facing the visitor, 3 and 9 o'clock the limbs (on the
     equator), the lower half the far side. It is a heading, not a map
     scale (at the overview the land at the top of the rim is over the
     pole, on the far side), so it is numbered sparingly, every 60°, and
     doesn't invite reading the figures against the coast. As the globe
     turns west the whole bezel turns clockwise, so a collection's dot
     comes up on the left, crosses the top as its passing card shows, and
     sets on the right.
     Outside the rim: a tick every 10°, a longer one under each number. On
     the rim: a small dot at each collection's lead pin (Morocco's too), the
     grey of the list's row marks. The same dot grows into a square when it
     is the one: amber while its card passes (the square that ends its
     row's wire), full ink while it is pointed at or open. A fixed index
     stands at 12 o'clock in a gap the ticks fade out across, so no tick
     ever stands beside it like a second index.

     The lower half fades out by DIAL_FADE_TO, so nothing reaches the
     console (the numbers don't dim: each stays whole to DIAL_NUM_TO,
     then goes). The whole dial fades as the camera leaves the overview
     (sooner than the ring: numbers over a close map are noise) and goes
     with the ring as the camera tilts. Each frame only the turning group's
     transform, the few numbers and, while zooming, the tick path change.
     ------------------------------------------------------------------ */

  var DIAL_TICK = 10, DIAL_MAJOR = 60;   // degrees between ticks; between the long, numbered ones
  var DIAL_GAP = 4, DIAL_MINOR = 4, DIAL_LONG = 7, DIAL_NUM = 6;   // px out from the rim, in order
  var DIAL_BEAD = 4;                     // px: a collection's square when it is the one (half that at rest, in globe.css)
  var DIAL_NOTCH = 20, DIAL_CLEAR = 12;  // px either side of the index: ticks fade from DIAL_NOTCH, gone by DIAL_CLEAR
  var DIAL_FADE_FROM = 76, DIAL_FADE_TO = 118;   // degrees from 12 o'clock: ticks and dots full above, gone below
  var DIAL_NUM_TO = 102;                 // numbers stay whole (never dimmer than --text-faint) to here, then go
  var DIAL_OUT = 1;                      // gone this far (in zoom) in from the overview
  var SVG = "http://www.w3.org/2000/svg";
  var dial = null;

  function svg(tag, cls, parent) {
    var n = document.createElementNS(SVG, tag);
    if (cls) n.setAttribute("class", cls);
    if (parent) parent.appendChild(n);
    return n;
  }
  function gradient(id, defs, stops) {
    var g = svg("linearGradient", null, defs);
    g.id = id;
    g.setAttribute("gradientUnits", "userSpaceOnUse");
    stops.forEach(function (s) {
      var n = svg("stop", null, g);
      n.setAttribute("offset", s[0]); n.setAttribute("stop-color", s[1]);
    });
    return g;
  }

  function buildDial() {
    var root = svg("svg", "g-dial");
    root.setAttribute("aria-hidden", "true");
    var defs = svg("defs", null, root), mask = svg("mask", null, defs);
    // The mask, in the stage's own terms: a sheet fading the lower half
    // out, and over it the gap at 12 o'clock, which only reaches as far in
    // as the ticks, so a dot crossing the index stays whole.
    var k = (DIAL_NOTCH - DIAL_CLEAR) / (2 * DIAL_NOTCH);
    var fade = gradient("g-dial-fade", defs, [[0, "#fff"], [1, "#000"]]);
    var notch = gradient("g-dial-notch", defs, [[0, "#fff"], [k, "#000"], [1 - k, "#000"], [1, "#fff"]]);
    var sheet = svg("rect", null, mask), cut = svg("rect", null, mask);
    mask.id = "g-dial-mask";
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    fade.setAttribute("x1", 0); fade.setAttribute("x2", 0);
    notch.setAttribute("y1", 0); notch.setAttribute("y2", 0);
    sheet.setAttribute("fill", "url(#g-dial-fade)");
    cut.setAttribute("fill", "url(#g-dial-notch)");
    // The index under the dots, so a square crossing 12 o'clock sits on it.
    var all = svg("g", null, root), index = svg("path", "g-dial-index", all), face = svg("g", null, all), numG = svg("g", null, all);
    face.setAttribute("mask", "url(#g-dial-mask)");
    var turn = svg("g", null, face);
    var d = { all: all, fade: fade, notch: notch, mask: mask, sheet: sheet, cut: cut, turn: turn,
              minor: svg("path", "g-dial-tick", turn), major: svg("path", "g-dial-tick is-major", turn),
              markG: svg("g", null, turn), nums: [], marks: [], index: index,
              r: 0, cx: 0, cy: 0, L: null, shut: [], key: "" };
    for (var lng = -180 + DIAL_MAJOR; lng <= 180; lng += DIAL_MAJOR) {
      var t = svg("text", "g-dial-num", numG);
      t.textContent = lng === 0 || lng === 180 ? Math.abs(lng) + "°" : Math.abs(lng) + "°" + (lng > 0 ? LABELS.east : LABELS.west);
      t.setAttribute("data-lng", lng);
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("dy", ".35em");     // the figures' middle on the point
      t.setAttribute("dx", ".07em");     // and their trailing letter-space split evenly
      d.nums.push({ el: t, lng: lng, w: 0, shown: true, gone: false });
    }
    // Each collection's square is drawn at 12 o'clock, centred on the rim's
    // line, and turned to its longitude; globe.css shrinks it to a dot.
    cols.forEach(function (c) {
      if (!c.lead) return;
      var g = svg("g", "g-dial-mark", d.markG);
      g.setAttribute("transform", "rotate(" + c.lead.ll[0] + ")");
      d.marks.push({ c: c, el: g, dot: svg("rect", "g-dial-dot", g) });
    });
    // Above the map and the header's veil, below the wires, plate, console and card.
    stage.insertBefore(root, mapEl);
    dial = d;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { dial.L = null; dirty = true; });
  }

  // Collections passing, pointed at or open: their dots change and come to
  // the top of the pile (the Rockies' dots overlap).
  function dialState() {
    if (!dial) return;
    var key = passing + "|" + lit + "|" + active;
    if (key === dial.key) return;
    dial.key = key;
    var top = [];
    dial.marks.forEach(function (m) {
      var s = m.c.slug, cl = m.el.classList;
      cl.toggle("is-passing", s === passing && s !== active);
      cl.toggle("is-lit", s === lit || s === active);
      if (s === passing || s === lit || s === active) top.push(m.el);
    });
    top.forEach(function (n) { dial.markG.appendChild(n); });
    dirty = true;
  }

  function placeDial() {
    if (!dial) return;
    // Out over the last DIAL_OUT of zoom before the overview, and with the
    // ring as the camera tilts (the ring is gone past 2°).
    var op = L.app ? Math.min(clamp((L.zO + DIAL_OUT - sizeZoom()) / .6, 0, 1), clamp(1 - map.getPitch() / 2, 0, 1)) : 0;
    dial.all.style.opacity = op ? op.toFixed(3) : 0;
    if (!op) return;
    var r = silhouette(map.getZoom(), map.getCenter().lat, L.h), pad = map.getPadding();
    var cx = pad.left + (L.w - pad.left - pad.right) / 2, cy = pad.top + (L.h - pad.top - pad.bottom) / 2;
    if (Math.abs(r - dial.r) > .05 || cx !== dial.cx || cy !== dial.cy || dial.L !== L) dialGeometry(r, cx, cy);
    var c = map.getCenter().lng, num = r + DIAL_GAP + DIAL_LONG + DIAL_NUM;
    dial.turn.setAttribute("transform", "translate(" + cx + " " + cy + ") rotate(" + (-c).toFixed(3) + ")");
    var boxes = plateBox ? dial.shut.concat([plateBox]) : dial.shut;
    dial.nums.forEach(function (n) {
      var a = wrap180(n.lng - c), s = Math.sin(a * rad), k = Math.cos(a * rad), near = Math.abs(a) < DIAL_NUM_TO + 30;
      if (near !== n.shown) { n.shown = near; n.el.style.display = near ? "" : "none"; }
      if (!near) return;
      // Upright figures, their near edge a fixed gap off the ticks all the way round.
      var rho = num + Math.abs(s) * n.w / 2 + Math.abs(k) * 4, x = cx + rho * s, y = cy - rho * k;
      n.el.setAttribute("x", x.toFixed(2));
      n.el.setAttribute("y", y.toFixed(2));
      // Numbers aren't faded with the ticks (no text is fainter than
      // --text-faint): each is whole until DIAL_NUM_TO, then goes. Nor do
      // they run under the masthead, the panel or the plate; they step
      // aside rather than be cut by an edge.
      var gone = Math.abs(a) > DIAL_NUM_TO || boxes.some(function (b) {
        return x + n.w / 2 + 6 > b[0] && x - n.w / 2 - 6 < b[2] && y + 10 > b[1] && y - 10 < b[3];
      });
      if (gone !== n.gone) { n.gone = gone; n.el.classList.toggle("is-gone", gone); }
    });
  }

  // Only when the dial changes size or place (a resize, the zoom fading it
  // out), and once the type has loaded, never once a frame at the overview.
  function dialGeometry(r, cx, cy) {
    dial.r = r; dial.cx = cx; dial.cy = cy;
    if (dial.L !== L) {
      dial.L = L;
      // The wordmark, the nav's words (not their taller hit areas) and the
      // ground switch, and the panel: no number runs under them.
      var s = stage.getBoundingClientRect(), range = document.createRange();
      dial.shut = [];
      [".wordmark", ".masthead .theme-toggle", ".g-panel"].concat(Array.prototype.slice.call(document.querySelectorAll(".masthead .nav > a, .masthead .nav-drop > a")))
        .forEach(function (n) {
          if (typeof n === "string") n = $(n);
          else { range.selectNodeContents(n); n = range; }
          var b = n && n.getBoundingClientRect();
          if (b && b.width) dial.shut.push([b.left - s.left - 12, b.top - s.top - 4, b.right - s.left + 4, b.bottom - s.top + 4]);   // 12: the current tab's square
        });
      dial.nums.forEach(function (n) { n.el.style.display = ""; n.shown = true; n.w = n.el.getComputedTextLength ? n.el.getComputedTextLength() : 30; });
    }
    function spokes(step, r0, r1, skip) {
      var p = "";
      for (var a = 0; a < 360; a += step) {
        if (skip && a % skip === 0) continue;
        var s = Math.sin(a * rad), k = Math.cos(a * rad);
        p += "M" + (r0 * s).toFixed(2) + " " + (-r0 * k).toFixed(2) + "L" + (r1 * s).toFixed(2) + " " + (-r1 * k).toFixed(2);
      }
      return p;
    }
    var r0 = r + DIAL_GAP, rim = r + .5, b = DIAL_BEAD;   // the rim's line is the pixel just outside r
    dial.minor.setAttribute("d", spokes(DIAL_TICK, r0, r0 + DIAL_MINOR, DIAL_MAJOR));
    dial.major.setAttribute("d", spokes(DIAL_MAJOR, r0, r0 + DIAL_LONG));
    dial.marks.forEach(function (m) {
      m.dot.setAttribute("x", -b / 2); m.dot.setAttribute("y", (-rim - b / 2).toFixed(2));
      m.dot.setAttribute("width", b); m.dot.setAttribute("height", b);
    });
    // The index: a hairline up from the rim at 12 o'clock, one pixel past
    // the longest ticks (which float off the rim), on a whole pixel so it
    // stays sharp. A number crossing 12 o'clock clears it by DIAL_NUM.
    var ix = Math.round(cx) + .5, top = cy - r0 - DIAL_LONG - 1;
    dial.index.setAttribute("d", "M" + ix + " " + (cy - r - 1).toFixed(1) + "V" + top.toFixed(1));
    // The gap round it: the tick band only, from just past a grown square out.
    var gapIn = cy - rim - b / 2 - .5;
    dial.notch.setAttribute("x1", (ix - DIAL_NOTCH).toFixed(1)); dial.notch.setAttribute("x2", (ix + DIAL_NOTCH).toFixed(1));
    dial.cut.setAttribute("x", (ix - DIAL_NOTCH).toFixed(1)); dial.cut.setAttribute("width", 2 * DIAL_NOTCH);
    dial.cut.setAttribute("y", (top - 2).toFixed(1)); dial.cut.setAttribute("height", (gapIn - top + 2).toFixed(1));
    // The fade, top to bottom in the stage's own terms, through the middle of the numbers.
    var mid = r + DIAL_GAP + DIAL_LONG;
    dial.fade.setAttribute("y1", (cy - mid * Math.cos(DIAL_FADE_FROM * rad)).toFixed(1));
    dial.fade.setAttribute("y2", (cy - mid * Math.cos(DIAL_FADE_TO * rad)).toFixed(1));
    dial.sheet.setAttribute("x", -L.w); dial.sheet.setAttribute("y", -L.h);
    dial.sheet.setAttribute("width", 3 * L.w); dial.sheet.setAttribute("height", 3 * L.h);
    dial.mask.setAttribute("x", -L.w); dial.mask.setAttribute("y", -L.h);
    dial.mask.setAttribute("width", 3 * L.w); dial.mask.setAttribute("height", 3 * L.h);
  }

  /* ------------------------------------------------------------------
     THE SPIN: 2°/s westward by the clock, from the landing on, whenever the
     camera is out at globe zoom with nothing open, pointed at or held and
     the page in view. It stops at once when touched and ramps back a
     second later, for as long as the visitor leaves it be. It eases up over
     empty stretches (gapBoost) and slows where cards crowd (passBrake).
     ------------------------------------------------------------------ */

  var spinV = 0, lastFrame = 0, lastSpin = 0, held = {}, released = -1e9, passBrake = 1;
  var stageVisible = true, dirty = true, dwell = -1;

  function hold(key, on) {
    if (on) { held[key] = 1; spinV = 0; }
    else if (held[key]) { delete held[key]; released = now(); }
  }
  function isHeld() { for (var k in held) return true; return false; }

  function spinStep(t, dt) {
    var allowed = ready && !failed && !REDUCED && !EDITING && !tour && !document.hidden &&
      stageVisible && state === "overview" && inOverview() && !isHeld() && !map.isMoving() &&
      t - released >= SPIN_RESUME;
    if (!allowed) { spinV = 0; return; }
    spinV = Math.min(1, spinV + dt / SPIN_RAMP);
    if (!spinV || (COARSE && t - lastSpin < 33)) return;   // phones: 30 updates a second
    var c = map.getCenter(), step = Math.min(t - lastSpin, 100);
    lastSpin = t;
    // The pace for a crowd of cards (passStep sets it) changes gently: PASS_EASE a second at most.
    passBrake += clamp(passBrakeTo - passBrake, -PASS_EASE * step / 1000, PASS_EASE * step / 1000);
    map.jumpTo({ center: [c.lng - SPIN * gapBoost(c.lng) * passBrake * spinV * step / 1000, c.lat] }, { gSpin: 1 });
  }
  function gapBoost(lng) {
    var d = 180;
    cols.forEach(function (c) {
      if (c.pins.length && PASS_ORDER.indexOf(c.slug) >= 0) d = Math.min(d, Math.abs(wrap180(lng - c.lead.ll[0])));
    });
    var k = clamp((d - GAP_FROM) / (GAP_FULL - GAP_FROM), 0, 1);
    return 1 + (GAP_BOOST - 1) * k * k * (3 - 2 * k);
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
    passStep(t);
    tourStep(dt);
    idleStep(dt);
    dialState();
    if (dirty) {
      dirty = false;
      layoutPins();
      placeRing();
      placePlate();
      placeDial();
      layoutLabels();
      if (placeWire()) dirty = true;        // still drawing in
    }
    skyFrame();
  }

  // Left alone away from the overview (a card open, or zoomed in by hand),
  // the globe goes back out and turns again, as if × were pressed. Any input
  // starts the clock over; it stands still while the pointer rests on the
  // card, during a drag, with keyboard focus in the list, and while the
  // globe is off screen. The tour keeps its own clock; reduced motion has
  // no spin to go back to.
  var idle = 0;
  function wake() { idle = 0; }
  function idleStep(dt) {
    var away = state === "arrived" || state === "free" || (state === "overview" && (!inOverview() || !level()));
    if (!away || REDUCED || EDITING || tour || document.hidden || !stageVisible ||
        held.card || held.drag || held.focus || map.isMoving()) { idle = 0; return; }
    idle += dt;
    if (idle >= IDLE_RETURN) { idle = 0; overview(); }
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
    var i = active ? bySlug[active].n + 1 : 0;
    tourGo(i < seq.length ? i : 0);
  }
  function tourGo(i) {
    if (i >= seq.length) { endTour(true); return; }
    var from = active && bySlug[active], to = seq[i];
    tourAt = i;
    if (from && from.pins.length && to.pins.length && from !== to) {
      setTrail((trail.length ? trail : [from.lead.ll]).concat([to.lead.ll]));
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

  // [lat, lng], or where the camera is looking, to `dp` decimals (four).
  function coords(at, dp) {
    var c = at ? { lat: at[0], lng: at[1] } : map.getCenter(), lng = wrap180(c.lng);
    if (dp === undefined) dp = 4;
    return Math.abs(c.lat).toFixed(dp) + "° " + (c.lat >= 0 ? LABELS.north : LABELS.south) + " · " +
           Math.abs(lng).toFixed(dp) + "° " + (lng >= 0 ? LABELS.east : LABELS.west);
  }
  function readout() {
    var s, h = lit && bySlug[lit], a = active && bySlug[active];
    if (failed) s = LABELS.rUnavailable;
    else if (deferred && !map) s = LABELS.rDeferred;
    else if (!ready) s = "";
    else if (h && lit !== active) s = h.title + (h.where && !plateFor ? " — " + h.where : "");   // the plate shows it already
    else if (a) s = (state === "selecting" ? "→ " : "") + a.title;
    else if (state === "returning") s = LABELS.rOverview;
    // Out at the globe, the place of the collection passing (or last passed);
    // the camera's own position while the visitor drags or zooms in.
    else {
      // Four decimals, or as many as the bar has room for (a narrow phone).
      var at = passAt && !held.drag && inOverview() ? passAt : null;
      for (var dp = 4; dp >= 1; dp--) {
        readEl.textContent = coords(at, dp);
        if (readEl.scrollWidth <= readEl.clientWidth) break;
      }
      s = readEl.textContent;
    }
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
    if (passing) endPass();
    hidePlate();
    clearTimeout(flatTimer); clearTimeout(hoverTimer); clearTimeout(turnTimer);
    cancelAnimationFrame(terrainRaf);
    tour = false; dwell = -1; active = null; lit = null; held = {};
    stage.classList.remove("is-deferred", "is-ready", "has-card", "has-pins", "is-touring");
    stage.classList.add("is-failed");
    card.classList.remove("is-open", "is-leaving", "is-touring");
    cardShown = false;
    tourBtn.setAttribute("aria-pressed", "false");
    cols.forEach(function (c) { c.row.removeAttribute("aria-current"); c.row.classList.remove("is-lit"); });
    showWaiting(false);                     // no globe, nothing to show for a place without a gallery
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

  // The map can't draw its first frame in a hidden tab (no animation
  // frames there), so a page opened in the background would give up before
  // anyone looked. The clock only runs out while the page is shown.
  function armFail(ms) {
    clearTimeout(failTimer);
    failTimer = setTimeout(function () {
      if (!document.hidden) { fail(); return; }
      document.addEventListener("visibilitychange", function shown() {
        if (document.hidden) return;
        document.removeEventListener("visibilitychange", shown);
        if (!ready && !failed && !stage.classList.contains("is-deferred")) armFail(ms);
      });
    }, ms || FAIL_AFTER);
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
    armFail(FAIL_AFTER_ASKED);
    if (window.NLLoadMapLibre) window.NLLoadMapLibre();
  });

  /* ------------------------------------------------------------------
     WIRING
     ------------------------------------------------------------------ */

  // site.js says so whenever the visitor switches the ground.
  document.addEventListener("nl:theme", applyPalette);

  tourBtn.addEventListener("click", function () { if (tour) endTour(false); else startTour(); });
  overviewBtn.addEventListener("click", overview);

  $(".g-card-prev").addEventListener("click", function (e) { e.stopPropagation(); step(-1); });
  $(".g-card-next").addEventListener("click", function (e) { e.stopPropagation(); step(1); });
  $(".g-card-close").addEventListener("click", function (e) { e.stopPropagation(); overview(); });
  card.addEventListener("click", function (e) {            // a phone: the whole card is the link
    if (!L.app && active && !e.target.closest("a") && bySlug[active].href) location.href = bySlug[active].href;
  });

  // The card and the console stop the spin while they are pointed at. The
  // list doesn't, so a mouse left resting on it doesn't keep the globe still;
  // a row it points at stops the spin by lighting its pin.
  [[card, "card"], [consoleEl, "console"]].forEach(function (pair) {
    pair[0].addEventListener("pointerenter", function (e) {
      if (e.pointerType === "touch") return;
      if (pair[1] === "card" && !cardShown) return;   // fading out after ×: it holds nothing
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
  ["pointermove", "pointerdown", "wheel", "keydown", "scroll"].forEach(function (type) {
    document.addEventListener(type, wake, { capture: true, passive: true });
  });

  document.addEventListener("keydown", function (e) {
    if (tour && e.key !== "Tab" && e.key !== "Shift" && !tourBtn.contains(e.target) && !groundSwitch(e.target)) endTour(false);
    if (!ready) return;
    if (e.key === "Escape") {
      if (active) overview();
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
        map.cooperativeGestures[L.app ? "disable" : "enable"]();
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
    idle = 0;
    dirty = true;
  });

  /* ---------- boot ------------------------------------------------------ */

  L = measure();
  drawStars();
  if (!NL) fail();
  else armFail();

  Promise.all([
    getJSON("data/collections.json"),
    getJSON("data/photos.json").catch(function () { return {}; }),
    getJSON("data/places.json").catch(function () { return {}; }),
    getJSON("data/routes.json").catch(function () { return {}; })
  ]).then(function (r) {
    joinData((r[0] && r[0].collections) || [], (r[1] && r[1].photos) || [], (r[2] && r[2].places) || {},
             (r[3] && r[3].routes) || {});
    if (r[2] && Array.isArray(r[2].regions)) regions = r[2].regions.filter(function (s) { return typeof s === "string" && s; });
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
