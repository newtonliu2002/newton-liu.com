/* ==========================================================================
   newton-liu.com — the chess map (chess.html): a pin wherever Newton has
   played a tournament, mostly in the United States, so a flat map rather
   than the landing's globe, dressed as the landing is: its stylesheet
   (globe.css: the panel, the list, the crosshair pins, the plate, the
   console) and its map colours (PALETTE below is globe.js's).

   Pointing at a pin or a row lights it and shows its plate (name, place,
   dates, score); clicking either opens the database at that tournament:
   chess-games.html#<id>. Pins at one place (the same city twice) are one
   ringed pin, whose click opens its plate as a short list to pick from.

   The tournaments are data/chess.json (see CLAUDE.md, "Chess"): `lat` and
   `lng` set the pin, the city's centre or the venue's, never a home.
   MapLibre arrives as a module from chess.html, as on the landing; without
   it the list still works alone.
   ========================================================================== */

(function () {
  "use strict";

  var NL = window.NLSite;
  var t = NL ? NL.t : function (s, v) { return s.replace(/\{(\w+)\}/g, function (m, k) { return v && k in v ? v[k] : m; }); };
  var ZH = !!(NL && NL.lang() === "zh");

  var DB = "chess-games.html";
  var US = [[-125, 24], [-66.5, 49.5]];      // the contiguous states: the view with no pins yet
  var FIT_MAX = 6;                           // never closer than this when framing the pins
  var MAX_ZOOM = 9, MIN_ZOOM = 1.5;
  var HOVER_DELAY = 80;
  var TILES = "https://tiles.openfreemap.org/planet";
  var GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
  var ATTR_TILES = '<a href="https://openfreemap.org">OpenFreeMap</a> ' +
    '<a href="https://www.openmaptiles.org/">© OpenMapTiles</a> ' +
    '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';

  // The landing's map colours on each ground (globe.js PALETTE; keep alike).
  function W(a) { return "rgba(255,255,255," + a + ")"; }
  function K(a) { return "rgba(0,0,0," + a + ")"; }
  var PALETTE = {
    black: {
      meta: "#050505",
      land: "#161616", sea: "#0a0a0a", ice: W(.04), park: W(.025), parkEdge: W(.16),
      coast: W(.16), river: W(.06), border: W(.16), state: W(.1),
      country: W(.28), stateName: W(.2), city: W(.3)
    },
    white: {
      meta: "#f4f4f2",
      land: "#dededa", sea: "#ecece9", ice: W(.4), park: K(.035), parkEdge: K(.22),
      coast: K(.28), river: K(.07), border: K(.18), state: K(.11),
      country: K(.45), stateName: K(.3), city: K(.42)
    }
  };
  function ground() { return document.documentElement.getAttribute("data-theme") === "light" ? "white" : "black"; }

  var REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  var COARSE = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
  var APP = "(min-width: 1024px) and (min-height: 620px)";
  function app() { return !!(window.matchMedia && matchMedia(APP).matches); }

  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function setText(n, s) { if (NL && NL.text) NL.text(n, s); else n.textContent = s; return n; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var stage = $("#g-stage"), mapEl = $("#g-map"), listEl = $("#g-list"), plate = $(".g-plate");
  var readEl = $(".g-readout"), fitBtn = $(".g-fit"), fallback = $(".g-fallback"), loadBtn = $(".g-load");
  var wireP = $(".g-wire-p");
  if (!stage || !listEl) return;
  var themeMeta = $('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = PALETTE[ground()].meta;
  fitBtn.setAttribute("aria-label", t("Show all tournaments"));
  fitBtn.title = t("Show all");
  $(".g-fallback p").textContent = t("Map unavailable. The tournaments are listed here.");
  loadBtn.textContent = t("Load map");

  /* ---------- the data -------------------------------------------------- */

  var events = [], byId = Object.create(null), places = [], summary = "";

  // Each tournament's anchor in the database: its `id`, else made from its
  // name and start date. chess.js has the same function: keep the two alike.
  function slug(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tournament";
  }
  function tournamentIds(list) {
    var seen = {};
    return list.map(function (tm) {
      var id = tm.id || slug((tm.name || "") + "-" + (tm.start || ""));
      while (seen[id]) id += "-2";
      seen[id] = true;
      return id;
    });
  }

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  function ymd(s) {
    var m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(String(s || ""));
    return m ? { y: +m[1], m: +m[2], d: m[3] ? +m[3] : 0 } : null;
  }
  // "October 11–12, 2026"; 2026年10月11–12日. As chess.js writes it.
  function dateRange(from, to) {
    var a = ymd(from), b = ymd(to) || a;
    if (!a) return from || "";
    var same = b.y === a.y && b.m === a.m && b.d === a.d, month = b.y === a.y && b.m === a.m;
    if (ZH) {
      if (!a.d) return a.y + "年" + a.m + "月";
      if (same) return a.y + "年" + a.m + "月" + a.d + "日";
      if (month) return a.y + "年" + a.m + "月" + a.d + "–" + b.d + "日";
      return a.y + "年" + a.m + "月" + a.d + "日–" + (b.y !== a.y ? b.y + "年" : "") + b.m + "月" + b.d + "日";
    }
    var ma = MONTHS[a.m - 1], mb = MONTHS[b.m - 1];
    if (!a.d) return ma + " " + a.y;
    if (same) return ma + " " + a.d + ", " + a.y;
    if (month) return ma + " " + a.d + "–" + b.d + ", " + a.y;
    if (b.y === a.y) return ma + " " + a.d + " – " + mb + " " + b.d + ", " + a.y;
    return ma + " " + a.d + ", " + a.y + " – " + mb + " " + b.d + ", " + b.y;
  }
  function score(n) {
    var whole = Math.floor(n), half = n - whole >= .5;
    return half ? (whole ? whole + "½" : "½") : String(whole);
  }
  // His points in a game: chess.js's rule. A result or colour the entry
  // leaves out is read from its PGN's tags (Result, White, Black).
  var player = [];
  function me(name) {
    var n = String(name || "").toLowerCase().replace(/[^a-z]/g, "");
    return n && player.some(function (p) { return String(p).toLowerCase().replace(/[^a-z]/g, "") === n; });
  }
  function tag(pgn, k) { var m = new RegExp("\\[" + k + "\\s+\"([^\"]*)\"\\]").exec(pgn); return m ? m[1] : ""; }
  function points(g) {
    if (g.bye != null) return typeof g.bye === "number" ? g.bye : 0;
    if (g.pgn && (g.result == null || !g.color)) {
      var c = g.color || (me(tag(g.pgn, "Black")) && !me(tag(g.pgn, "White")) ? "black" : me(tag(g.pgn, "White")) ? "white" : null);
      g = { result: g.result != null ? g.result : tag(g.pgn, "Result"), color: c };
    }
    var r = String(g.result == null ? "" : g.result).trim().toLowerCase().replace(/\s/g, "");
    if (/^(win|w|1|\+)$/.test(r)) return 1;
    if (/^(loss|lose|lost|l|0|-)$/.test(r)) return 0;
    if (/^(draw|d|½|0\.5|1\/2|=|1\/2-1\/2|½-½)$/.test(r)) return .5;
    if (r === "1-0" && g.color) return g.color === "white" ? 1 : 0;
    if (r === "0-1" && g.color) return g.color === "black" ? 1 : 0;
    return null;
  }

  function join(data) {
    player = [].concat(data.player || []);
    var list = (data.tournaments || []).slice().sort(function (a, b) {
      return String(b.start || "").localeCompare(String(a.start || ""));
    });
    var ids = tournamentIds(list), games = 0;
    list.forEach(function (tm, k) {
      var gs = tm.games || [], counted = 0, pts = 0;
      gs.forEach(function (g) {
        var p = points(g);
        if (g.bye == null) games++;
        if (p != null) { counted++; pts += p; }
      });
      var e = {
        id: ids[k], name: tm.name || t("Tournament"), where: tm.where || "",
        date: dateRange(tm.start, tm.end), year: (ymd(tm.start) || {}).y || "",
        score: counted ? t("Score {pts} / {n}", { pts: score(pts), n: tm.rounds || gs.length }) : "",
        href: DB + "#" + encodeURIComponent(ids[k]),
        ll: typeof tm.lat === "number" && typeof tm.lng === "number" ? [tm.lng, tm.lat] : null
      };
      events.push(e);
      byId[e.id] = e;
      if (!e.ll) return;
      // One pin per place: a tournament within ~1 km of another's pin joins it.
      var at = places.filter(function (pl) { return Math.abs(pl.ll[0] - e.ll[0]) < .012 && Math.abs(pl.ll[1] - e.ll[1]) < .01; })[0];
      if (at) at.events.push(e);
      else places.push({ ll: e.ll, events: [e] });
      e.place = at || places[places.length - 1];
    });
    summary = events.length
      ? t(events.length === 1 ? "{n} tournament" : "{n} tournaments", { n: events.length }) + " · " +
        t(games === 1 ? "{n} game" : "{n} games", { n: games })
      : t("No tournaments yet");
  }

  /* ---------- the list: a year to a heading, newest first --------------- */

  function renderList() {
    listEl.textContent = "";
    if (!events.length) {
      listEl.appendChild(el("li", "g-list-status", t("No tournaments yet.")));
      return;
    }
    var group = null, year = null;
    events.forEach(function (e) {
      if (e.year !== year || !group) {
        year = e.year;
        var g = el("li", "g-region");
        if (year) {
          var h = el("h3", "g-region-head");
          h.appendChild(el("span", "g-region-mark")).setAttribute("aria-hidden", "true");
          h.appendChild(el("span", "g-region-name", String(year)));
          h.appendChild(el("span", "g-region-rule")).setAttribute("aria-hidden", "true");
          g.appendChild(h);
        }
        group = g.appendChild(el("ol", "g-rows"));
        listEl.appendChild(g);
      }
      var li = el("li"), a = el("a", "g-row");
      a.href = e.href;
      a.setAttribute("data-id", e.id);
      a.appendChild(el("span", "g-row-mark")).setAttribute("aria-hidden", "true");
      a.appendChild(setText(el("span", "g-row-title"), e.name));
      a.addEventListener("pointerenter", function (ev) { if (ev.pointerType !== "touch") light(e, "row"); });
      a.addEventListener("pointerleave", function () { unlight(); });
      a.addEventListener("focus", function () { if (a.matches(":focus-visible")) light(e, "row"); });
      a.addEventListener("blur", function () { unlight(); });
      e.row = a;
      li.appendChild(a);
      group.appendChild(li);
    });
    listEl.classList.add("is-new");
    listEl.addEventListener("scroll", overflowCheck, { passive: true });
    overflowCheck();
  }
  function overflowCheck() {
    listEl.classList.toggle("is-overflowing", listEl.scrollTop + listEl.clientHeight < listEl.scrollHeight - 2);
  }

  /* ---------- the map ---------------------------------------------------- */

  var map = null, ml = null, ready = false, failed = false, failTimer = 0;

  function buildStyle() {
    var P = PALETTE[ground()];
    var poly = ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false];
    var parks = ["match", ["get", "class"], ["national_park", "nature_reserve"], true, false];
    var name = ["coalesce", ["get", "name:en"], ["get", "name:latin"]];    // English only, never local script
    function text(size, color, extra) {
      var layout = { "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": size,
        "text-transform": "uppercase", "text-letter-spacing": .2, "text-max-width": 8 };
      for (var k in extra) layout[k] = extra[k];
      return { layout: layout, paint: { "text-color": color } };
    }
    var V = [
      ["water", "fill", "water", 0, ["all", poly, ["!=", ["get", "brunnel"], "tunnel"]], { "fill-color": P.sea, "fill-antialias": false }],
      ["ice", "fill", "landcover", 2, ["match", ["get", "subclass"], ["glacier", "ice_shelf"], true, false], { "fill-color": P.ice, "fill-antialias": false }],
      ["park", "fill", "park", 4.5, ["all", poly, parks], { "fill-color": P.park }],
      ["coast", "line", "water", 0, ["all", poly, ["match", ["get", "class"], ["ocean", "sea", "lake"], true, false], ["!=", ["get", "brunnel"], "tunnel"]],
        { "line-color": P.coast, "line-width": ["interpolate", ["linear"], ["zoom"], 1, .5, 7, .8],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 1, 7.5, .4] }],
      ["river", "line", "waterway", 6, ["!=", ["get", "brunnel"], "tunnel"], { "line-color": P.river }],
      ["park-edge", "line", "park", 4.5, ["all", poly, parks], { "line-color": P.parkEdge, "line-width": .8, "line-dasharray": [1, 2] }],
      ["admin-4", "line", "boundary", 2.5, ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        { "line-color": P.state, "line-width": .6, "line-dasharray": [2, 2] }],
      ["admin-2", "line", "boundary", 0, ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]],
        { "line-color": P.border, "line-width": .6 }],
      // Names stay faint, so the pins are the strongest marks on the map.
      ["country", "symbol", "place", 1.5, ["==", ["get", "class"], "country"], text(11, P.country)],
      ["state", "symbol", "place", 3.4, ["==", ["get", "class"], "state"], text(10, P.stateName, { "text-max-width": 12, "text-padding": 16 })],
      ["city", "symbol", "place", 6, ["==", ["get", "class"], "city"], text(10, P.city, { "text-padding": 12 })]
    ];
    var layers = [{ id: "land", type: "background", paint: { "background-color": P.land } }];
    V.forEach(function (d) {
      var ly = { id: d[0], type: d[1], source: "omt", "source-layer": d[2], minzoom: d[3], filter: d[4] };
      if (d[1] === "symbol") { ly.layout = d[5].layout; ly.paint = d[5].paint; } else ly.paint = d[5];
      layers.push(ly);
    });
    return {
      version: 8, projection: { type: "mercator" }, glyphs: GLYPHS,
      sources: { omt: { type: "vector", url: TILES, maxzoom: 9, attribution: ATTR_TILES } },
      transition: { duration: 0, delay: 0 },
      layers: layers
    };
  }

  // The ground changed (the square at the end of the nav): repaint in place.
  function repaint() {
    if (themeMeta) themeMeta.content = PALETTE[ground()].meta;
    if (!map || !ready) return;
    try {
      buildStyle().layers.forEach(function (ly) {
        for (var k in ly.paint) map.setPaintProperty(ly.id, k, ly.paint[k]);
      });
    } catch (e) {}
  }
  document.addEventListener("nl:theme", repaint);

  // The free area the pins are framed in: right of the panel, under the
  // bar, above the console (the landing's own allowances, globe.css).
  function padding() {
    var w = stage.clientWidth, h = stage.clientHeight;
    if (app()) {
      var edge = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--edge")) || 24;
      return { left: Math.min(edge + 312 + 96, w / 2), right: edge + 120, top: 140, bottom: 170 };
    }
    return { left: 48, right: 48, top: 48, bottom: Math.min(96, h / 3) };
  }
  function frame(animate) {
    if (!map) return;
    var b = new ml.LngLatBounds(US[0], US[1]);
    if (places.length) {
      b = new ml.LngLatBounds(places[0].ll, places[0].ll);
      places.forEach(function (pl) { b.extend(pl.ll); });
    }
    var opts = { padding: padding(), maxZoom: places.length ? FIT_MAX : 5, duration: animate && !REDUCED ? 900 : 0 };
    try { map.fitBounds(b, opts); } catch (e) { map.fitBounds(new ml.LngLatBounds(US[0], US[1]), { duration: 0 }); }
  }

  function warn(e) { if (window.console && console.warn) console.warn("Chess map:", e && e.message || e); }
  function fail() {
    if (failed) return;
    failed = true;
    clearTimeout(failTimer);
    stage.classList.add("is-failed");
    fallback.hidden = false;
    loadBtn.hidden = true;
    if (map) try { map.remove(); } catch (e) {}
    map = null;
  }

  function startMap() {
    if (map || failed || !window.maplibregl) return;
    ml = window.maplibregl;
    try {
      map = new ml.Map({
        container: mapEl, style: buildStyle(), bounds: US, fitBoundsOptions: { padding: padding() },
        minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, renderWorldCopies: false,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        attributionControl: false, keyboard: false, boxZoom: false,
        dragRotate: false, pitchWithRotate: false, touchPitch: false, cooperativeGestures: !app(),
        locale: { "CooperativeGesturesHandler.MobileHelpText": t("Use two fingers to move the map"),
                  "CooperativeGesturesHandler.WindowsHelpText": t("Use Ctrl + scroll to zoom the map"),
                  "CooperativeGesturesHandler.MacHelpText": t("Use ⌘ + scroll to zoom the map") }
      });
    } catch (e) { warn(e); fail(); return; }    // no WebGL2, most often
    map.touchZoomRotate.disableRotation();
    var canvas = map.getCanvas();
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("tabindex", "-1");
    canvas.addEventListener("webglcontextlost", fail);
    map.addControl(new ml.AttributionControl({ compact: false }), app() ? "bottom-right" : "top-right");
    map.on("error", function (e) { if (!ready && !(e && e.tile)) { warn(e && e.error || e); fail(); } });
    map.on("load", onLoad);
    map.on("move", placePlate);
    map.on("click", function () { if (open) closePlate(); });
    failClock();
  }

  // No map after 20 s while the page is in view (a hidden tab draws
  // nothing, so that time doesn't count), and the list is all there is.
  var waited = 0, since = 0;
  function failClock() {
    clearTimeout(failTimer);
    if (ready || failed) return;
    if (document.hidden) { if (since) waited += Date.now() - since; since = 0; return; }
    since = Date.now();
    failTimer = setTimeout(function () { if (!ready) fail(); }, Math.max(0, 20000 - waited));
  }
  document.addEventListener("visibilitychange", function () { if (map) failClock(); });

  function onLoad() {
    if (failed) return;
    ready = true;
    clearTimeout(failTimer);
    stage.classList.add("is-ready");
    repaint();                                // in case the ground changed while the style loaded
    buildPins();
    frame(false);
    readout(null);
    stage.classList.add("has-pins");
    if (!REDUCED) {
      pins.forEach(function (p, i) { p.el.style.animationDelay = (i * 45) + "ms"; p.el.classList.add("is-intro"); });
      setTimeout(function () { pins.forEach(function (p) { p.el.classList.remove("is-intro"); }); }, 2600);
    }
  }

  /* ---------- pins, the plate, lighting ---------------------------------- */

  var pins = [], lit = null, open = null, hoverTimer = 0, plateFor = null;

  function buildPins() {
    places.forEach(function (pl) {
      var e = el("span", "g-pin");
      e.setAttribute("aria-hidden", "true");
      e.innerHTML = '<i class="g-pin-in"><i class="g-pin-x"></i><i class="g-pin-ring"></i><i class="g-pin-af"></i></i>';
      if (pl.events.length > 1) e.classList.add("is-stack");
      var p = { pl: pl, el: e };
      pl.pin = p;
      p.marker = new ml.Marker({ element: e, anchor: "center" }).setLngLat(pl.ll).addTo(map);
      e.addEventListener("pointerenter", function (ev) {
        if (ev.pointerType === "touch") return;
        e.classList.add("is-hover");
        clearTimeout(hoverTimer);
        if (!open) light(pl.events[0], "pin");
      });
      e.addEventListener("pointerleave", function () {
        e.classList.remove("is-hover");
        if (!open) unlight();
      });
      e.addEventListener("click", function (ev) {
        ev.stopPropagation();
        // One tournament here: straight to it. Several: pick from the plate
        // (on a phone, where there is no plate, the newest of them).
        if (pl.events.length === 1 || !app() || COARSE) location.href = pl.events[0].href;
        else openPlate(pl);
      });
      pins.push(p);
    });
  }

  function light(e, from) {
    clearTimeout(hoverTimer);
    if (lit === e) return;
    if (lit) unlightNow();
    lit = e;
    if (e.row) e.row.classList.add("is-lit");
    readout(e);
    if (!e.place || !e.place.pin) return;
    e.place.pin.el.classList.add("is-lit");
    showPlate(e.place, e);
  }
  function unlight() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () { if (!open) unlightNow(); }, HOVER_DELAY);
  }
  function unlightNow() {
    if (!lit) return;
    if (lit.row) lit.row.classList.remove("is-lit");
    if (lit.place && lit.place.pin) lit.place.pin.el.classList.remove("is-lit");
    lit = null;
    hidePlate();
    readout(null);
  }

  function readout(e) {
    if (!readEl) return;
    var s = e ? [e.where, e.date].filter(Boolean).join(" · ") : summary;
    setText(readEl, s || summary);
  }

  // The plate: the tournament pointed at, or, at a place with several, all
  // of them (the one pointed at first lit). Laptop layout, fine pointers.
  function showPlate(pl, e) {
    if (!app() || COARSE || !plate) return;
    plate.textContent = "";
    plate.classList.remove("is-live");
    var list = pl.events.length > 1 ? pl.events : [e];
    plate.classList.toggle("is-text", list.length > 1);
    list.forEach(function (x) { plateEntry(x, false); });
    plateFor = pl;
    plate.classList.remove("is-on");
    void plate.offsetWidth;                  // restart the shutter
    plate.classList.add("is-on");
    placePlate();
  }
  function plateEntry(e, linked) {
    var title = setText(el(linked ? "a" : "p", "g-plate-title"), e.name);
    if (linked) title.href = e.href;
    plate.appendChild(title);
    if (e.where) plate.appendChild(setText(el("p", "g-plate-where"), e.where));
    if (e.date) plate.appendChild(setText(el("p", "g-plate-where cm-plate-date"), e.date));
    if (e.score) plate.appendChild(setText(el("p", "g-plate-where cm-plate-date"), e.score));
  }
  // Several tournaments at one place: the plate stays up as their links.
  function openPlate(pl) {
    open = pl;
    plate.textContent = "";
    plate.classList.add("is-text", "is-live", "is-on");
    pl.events.forEach(function (e) { plateEntry(e, true); });
    plateFor = pl;
    pl.pin.el.classList.add("is-active");
    placePlate();
    var first = plate.querySelector("a");
    if (first) first.focus({ preventScroll: true });
  }
  function closePlate() {
    if (open && open.pin) open.pin.el.classList.remove("is-active");
    open = null;
    unlightNow();
    hidePlate();
  }
  function hidePlate() {
    if (open) return;
    plateFor = null;
    if (plate) plate.classList.remove("is-on", "is-live");
    if (wireP) wireP.classList.remove("is-on");
  }
  function placePlate() {
    if (!plateFor || !map) return;
    var xy = map.project(plateFor.ll), w = plate.offsetWidth, h = plate.offsetHeight;
    var W0 = stage.clientWidth, H0 = stage.clientHeight, pad = padding();
    var left = pad.left - 96, right = W0 - 24;
    var x = xy.x + 16;
    if (x + w > right) x = xy.x - 16 - w;
    x = clamp(x, left, right - w);
    var y = clamp(xy.y - h / 2, 72, H0 - 108 - h);
    plate.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
    if (!wireP) return;
    var leftSide = x < xy.x;
    wireP.setAttribute("x1", xy.x + (leftSide ? -8 : 8));
    wireP.setAttribute("y1", xy.y);
    wireP.setAttribute("x2", leftSide ? x + w : x);
    wireP.setAttribute("y2", clamp(xy.y, y + 1, y + h - 1));
    wireP.classList.toggle("is-on", Math.abs((leftSide ? x + w : x) - xy.x) > 10);
  }

  if (plate) {
    plate.addEventListener("pointerleave", function () { if (open) closePlate(); });
    plate.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var pin = open;
      closePlate();
      if (pin && pin.events[0].row) pin.events[0].row.focus();
    });
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && open) closePlate(); });

  fitBtn.addEventListener("click", function () { closePlate(); frame(true); });
  window.addEventListener("resize", function () { if (map) placePlate(); });

  /* ---------- boot -------------------------------------------------------- */

  var getJSON = NL ? NL.getJSON : function (p) { return fetch(p, { cache: "no-cache" }).then(function (r) { return r.json(); }); };
  var dataReady = getJSON("data/chess.json").then(function (data) {
    join(data || {});
    renderList();
    readout(null);
  }, function () {
    listEl.textContent = "";
    listEl.appendChild(el("li", "g-list-status", t("Couldn't load the tournaments.")));
  });

  function go() { dataReady.then(startMap); }
  if (window.maplibregl) go();
  window.addEventListener("maplibre:ready", go);
  window.addEventListener("maplibre:failed", function () { dataReady.then(fail); });
  // Save-Data or 2G: nothing loads until asked for.
  window.addEventListener("maplibre:deferred", function () {
    stage.classList.add("is-deferred");
    fallback.hidden = false;
    loadBtn.hidden = false;
  });
  loadBtn.addEventListener("click", function () {
    stage.classList.remove("is-deferred");
    fallback.hidden = true;
    if (window.NLLoadMapLibre) window.NLLoadMapLibre();
  });
})();
