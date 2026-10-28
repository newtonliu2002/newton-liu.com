/* ==========================================================================
   newton-liu.com — a travel log (travel-fall-2026.html, under the nav's
   Personal tab; Newton, 2026-10-22): a map of where he went in a season
   and when. The chess map's clothes (chess-map.js, which this began as):
   globe.css's g-* classes on a flat map, the landing's colours, the
   chess map's larger lit pins (travel-map.css), and the list of trips
   in the panel, a month to a heading, oldest first.

   Pointing at a trip's row lights its pins (and its road, when it has
   one) and shows its plate; clicking the row frames the trip on the map
   (and puts its id in the address, so #quebec-2026-10-07 opens on it).
   Pointing at a pin shows that place, with every visit's date; clicking
   it frames the trip. Places within about a kilometre are one pin
   (Washington, D.C., eight times). A trip's `link` (its journal, its
   chess games) is a small link under its row.

   The trips are the page's data-src (data/travel-fall-2026.json; see
   CLAUDE.md, "Travel log"): every stop a public place at its usual
   centre, never a home. A trip's `route` draws a road from
   data/travel-routes.json (his drives and the bike ride; tools/route.py
   --file writes it). MapLibre arrives as a module from the page, as on
   the landing; without it the list still works alone.
   ========================================================================== */

(function () {
  "use strict";

  var NL = window.NLSite;
  var t = NL ? NL.t : function (s, v) { return s.replace(/\{(\w+)\}/g, function (m, k) { return v && k in v ? v[k] : m; }); };
  var ZH = !!(NL && NL.lang() === "zh");
  var pinName = NL ? NL.pin : function (s) { return s; };
  var placeName = NL ? NL.place : function (s) { return s; };
  var whereLine = NL ? NL.where : function (s) { return s; };
  // A trip's name, part by part in Chinese ("Boston – Richmond" 波士顿 –
  // 里士满, "Charlottesville · Washington, D.C."), its dashes and dots kept.
  function tripName(s) {
    if (!ZH || !NL || !NL.zhPlace || !s) return placeName(s);
    return String(s).split(/( · | – )/).map(function (part, i) { return i % 2 ? part : NL.zhPlace(part); }).join("");
  }

  var EAST = [[-125, 24], [-60, 50]];        // the view with no trips yet
  var FIT_MAX = 6;                           // never closer than this framing the whole season
  var TRIP_MAX = 8;                          // nor than this framing one trip
  var MAX_ZOOM = 10, MIN_ZOOM = 1.5;
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
      coast: W(.16), river: W(.06), border: W(.16), state: W(.1), road: W(.3),
      country: W(.28), stateName: W(.2), city: W(.3)
    },
    white: {
      meta: "#f4f4f2",
      land: "#dededa", sea: "#ecece9", ice: W(.4), park: K(.035), parkEdge: K(.22),
      coast: K(.28), river: K(.07), border: K(.18), state: K(.11), road: K(.32),
      country: K(.45), stateName: K(.3), city: K(.42)
    }
  };
  function ground() { return document.documentElement.getAttribute("data-theme") === "light" ? "white" : "black"; }
  function accent() {
    return (getComputedStyle(document.documentElement).getPropertyValue("--accent") || "").trim() || "#d4a24c";
  }

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

  var appEl = $(".g-app"), stage = $("#g-stage"), mapEl = $("#g-map"), listEl = $("#g-list"), plate = $(".g-plate");
  var readEl = $(".g-readout"), fitBtn = $(".g-fit"), fallback = $(".g-fallback"), loadBtn = $(".g-load");
  var wireP = $(".g-wire-p");
  if (!appEl || !stage || !listEl) return;
  var SRC = appEl.getAttribute("data-src");
  if (!SRC) return;
  var themeMeta = $('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = PALETTE[ground()].meta;
  fitBtn.setAttribute("aria-label", t("Show all trips"));
  fitBtn.title = t("Show all");
  $(".g-fallback p").textContent = t("Map unavailable. The trips are listed here.");
  loadBtn.textContent = t("Load map");

  /* ---------- the data -------------------------------------------------- */

  var trips = [], byId = Object.create(null), places = [], summary = "", roads = {};

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];
  function ymd(s) {
    var m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(String(s || ""));
    return m ? { y: +m[1], m: +m[2], d: m[3] ? +m[3] : 0 } : null;
  }
  // "October 8–16, 2026"; 2026年10月8–16日. As the chess map writes it.
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
  // The list's own date, the month being the heading: "Oct 18", "Oct 8–16".
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function shortDate(from, to) {
    var a = ymd(from), b = ymd(to) || a;
    if (!a || !a.d) return "";
    var one = b.m === a.m && b.d === a.d && b.y === a.y, month = b.m === a.m && b.y === a.y;
    if (ZH) return a.m + "月" + a.d + (one ? "" : month ? "–" + b.d : "日–" + b.m + "月" + b.d) + "日";
    return SHORT[a.m - 1] + " " + a.d + (one ? "" : month ? "–" + b.d : " – " + SHORT[b.m - 1] + " " + b.d);
  }
  function monthHead(s) {
    var a = ymd(s);
    if (!a) return "";
    return ZH ? a.m + "月" : MONTHS[a.m - 1];
  }

  function join(data, routes) {
    var list = (data.trips || []).slice().sort(function (a, b) {
      return String(a.start || "").localeCompare(String(b.start || ""));
    });
    list.forEach(function (tr, k) {
      var id = String(tr.id || ("trip-" + (k + 1)));
      var e = {
        id: id, name: tr.name || "", where: tr.where || "",
        date: dateRange(tr.start, tr.end), short: shortDate(tr.start, tr.end), month: monthHead(tr.start),
        link: tr.link && tr.link.href ? tr.link : null, stops: []
      };
      var road = tr.route && routes && routes[tr.route] && routes[tr.route].path;
      if (road && road.length > 1) roads[id] = road;
      (tr.stops || []).forEach(function (s) {
        if (typeof s.lat !== "number" || typeof s.lng !== "number") return;
        var stop = { name: s.name || e.name, ll: [s.lng, s.lat], date: s.date ? dateRange(s.date) : "",
                     short: s.date ? shortDate(s.date) : "", trip: e };
        // One pin per place: a stop within ~1 km of another's pin joins it
        // (Richmond at both ends of the Québec loop; Washington, D.C. eight times).
        var at = places.filter(function (pl) { return Math.abs(pl.ll[0] - stop.ll[0]) < .012 && Math.abs(pl.ll[1] - stop.ll[1]) < .01; })[0];
        if (!at) { at = { ll: stop.ll, name: stop.name, visits: [] }; places.push(at); }
        if (!at.visits.some(function (v) { return v.trip === e; })) at.visits.push(stop);
        else if (stop.date && !at.visits.filter(function (v) { return v.trip === e; })[0].date) {
          var was = at.visits.filter(function (v) { return v.trip === e; })[0];
          was.date = stop.date;
          was.short = stop.short;
        }
        stop.place = at;
        e.stops.push(stop);
      });
      trips.push(e);
      byId[id] = e;
    });
    summary = trips.length
      ? t(trips.length === 1 ? "{n} trip" : "{n} trips", { n: trips.length }) + " · " +
        t(places.length === 1 ? "{n} place" : "{n} places", { n: places.length })
      : t("No trips yet");
  }

  /* ---------- the list: a month to a heading, oldest first --------------- */

  function renderList() {
    listEl.textContent = "";
    if (!trips.length) {
      listEl.appendChild(el("li", "g-list-status", t("No trips yet.")));
      return;
    }
    var group = null, month = null;
    trips.forEach(function (e) {
      if (e.month !== month || !group) {
        month = e.month;
        var g = el("li", "g-region");
        if (month) {
          var h = el("h3", "g-region-head");
          h.appendChild(el("span", "g-region-mark")).setAttribute("aria-hidden", "true");
          h.appendChild(el("span", "g-region-name", month));
          h.appendChild(el("span", "g-region-rule")).setAttribute("aria-hidden", "true");
          g.appendChild(h);
        }
        group = g.appendChild(el("ol", "g-rows"));
        listEl.appendChild(g);
      }
      var li = el("li"), a = el("a", "g-row");
      a.href = "#" + encodeURIComponent(e.id);
      a.setAttribute("data-id", e.id);
      a.appendChild(el("span", "g-row-mark")).setAttribute("aria-hidden", "true");
      a.appendChild(setText(el("span", "g-row-title"), tripName(e.name)));
      if (e.short) a.appendChild(el("span", "tl-row-date", e.short));
      a.addEventListener("pointerenter", function (ev) { if (ev.pointerType !== "touch") light(e); });
      a.addEventListener("pointerleave", function () { unlight(); });
      a.addEventListener("focus", function () { if (a.matches(":focus-visible")) light(e); });
      a.addEventListener("blur", function () { unlight(); });
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        choose(e, true);
      });
      e.row = a;
      li.appendChild(a);
      if (e.link) {
        var go = el("a", "tl-row-link");
        go.href = e.link.href;
        go.appendChild(document.createTextNode(t(e.link.label) + " "));
        go.appendChild(el("span", null, "→")).setAttribute("aria-hidden", "true");
        go.setAttribute("aria-label", t("{label}: {trip}", { label: t(e.link.label), trip: tripName(e.name) }));
        li.appendChild(go);
      }
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

  // The roads of the trips: a quiet grey at rest; a lit or chosen trip's
  // road in the accent, and the others all but gone meanwhile (Newton,
  // 2026-10-28: only that trip's drive should light up).
  function addRoads() {
    var features = Object.keys(roads).map(function (id) {
      return { type: "Feature", properties: { id: id }, geometry: { type: "LineString", coordinates: roads[id] } };
    });
    if (!features.length) return;
    map.addSource("roads", { type: "geojson", data: { type: "FeatureCollection", features: features } });
    map.addLayer({ id: "road", type: "line", source: "roads", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": PALETTE[ground()].road, "line-width": 1, "line-opacity": 1 } });
    map.addLayer({ id: "road-lit", type: "line", source: "roads", filter: ["==", ["get", "id"], ""],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": accent(), "line-width": 2, "line-opacity": 1 } });
  }
  function litRoad(id) {
    if (!map || !ready || !map.getLayer("road-lit")) return;
    map.setFilter("road-lit", ["==", ["get", "id"], id || ""]);
    map.setPaintProperty("road", "line-opacity", id ? .2 : 1);
  }

  // The ground changed (the square at the end of the nav): repaint in place.
  function repaint() {
    if (themeMeta) themeMeta.content = PALETTE[ground()].meta;
    if (!map || !ready) return;
    try {
      buildStyle().layers.forEach(function (ly) {
        for (var k in ly.paint) map.setPaintProperty(ly.id, k, ly.paint[k]);
      });
      if (map.getLayer("road")) {
        map.setPaintProperty("road", "line-color", PALETTE[ground()].road);
        map.setPaintProperty("road-lit", "line-color", accent());
      }
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
  function bounds(lls) {
    var b = new ml.LngLatBounds(lls[0], lls[0]);
    lls.forEach(function (ll) { b.extend(ll); });
    return b;
  }
  // The whole season, or one trip (its stops and its road).
  function frame(animate, trip) {
    if (!map) return;
    var lls = trip ? trip.stops.map(function (s) { return s.ll; }).concat(roads[trip.id] || [])
                   : places.map(function (pl) { return pl.ll; });
    var opts = { padding: padding(), maxZoom: trip ? TRIP_MAX : FIT_MAX, duration: animate && !REDUCED ? 900 : 0 };
    try { map.fitBounds(lls.length ? bounds(lls) : new ml.LngLatBounds(EAST[0], EAST[1]), opts); }
    catch (e) { map.fitBounds(new ml.LngLatBounds(EAST[0], EAST[1]), { duration: 0 }); }
  }

  function warn(e) { if (window.console && console.warn) console.warn("Travel map:", e && e.message || e); }
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
        container: mapEl, style: buildStyle(), bounds: EAST, fitBoundsOptions: { padding: padding() },
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
    try { addRoads(); } catch (e) { warn(e); }
    buildPins();
    var start = chosen();
    frame(false, start);
    if (start) mark(start);
    readout(null);
    stage.classList.add("has-pins");
    if (!REDUCED) {
      pins.forEach(function (p, i) { p.el.style.animationDelay = (i * 45) + "ms"; p.el.classList.add("is-intro"); });
      setTimeout(function () { pins.forEach(function (p) { p.el.classList.remove("is-intro"); }); }, 2600);
    }
  }

  /* ---------- pins, the plate, lighting ---------------------------------- */

  var pins = [], lit = null, hoverTimer = 0, plateFor = null, current = null;

  function buildPins() {
    places.forEach(function (pl) {
      var e = el("span", "g-pin");
      e.setAttribute("aria-hidden", "true");
      e.innerHTML = '<i class="g-pin-in"><i class="g-pin-x"></i><i class="g-pin-ring"></i><i class="g-pin-af"></i></i>';
      if (pl.visits.length > 1) e.classList.add("is-stack");
      var p = { pl: pl, el: e };
      pl.pin = p;
      p.marker = new ml.Marker({ element: e, anchor: "center" }).setLngLat(pl.ll).addTo(map);
      e.addEventListener("pointerenter", function (ev) {
        if (ev.pointerType === "touch") return;
        e.classList.add("is-hover");
        clearTimeout(hoverTimer);
        lightPlace(pl);
      });
      e.addEventListener("pointerleave", function () {
        e.classList.remove("is-hover");
        unlight();
      });
      e.addEventListener("click", function (ev) {
        ev.stopPropagation();
        choose(pl.visits[pl.visits.length - 1].trip, false);
      });
      pins.push(p);
    });
  }

  function pinsOf(trip) {
    return trip.stops.map(function (s) { return s.place.pin; }).filter(Boolean);
  }

  // A trip lit: its row, its pins, its road, its plate (at its first stop).
  function light(e) {
    clearTimeout(hoverTimer);
    if (lit === e) return;
    if (lit) unlightNow();
    lit = e;
    if (e.row) e.row.classList.add("is-lit");
    pinsOf(e).forEach(function (p) { p.el.classList.add("is-lit"); });
    litRoad(e.id);
    readout(e);
    if (e.stops.length) showPlate(e.stops[0].place, tripPlate(e));
  }
  // A place pointed at: the place, and each visit's trip and date.
  function lightPlace(pl) {
    clearTimeout(hoverTimer);
    if (lit) unlightNow();
    lit = pl;
    pl.pin.el.classList.add("is-lit");
    pl.visits.forEach(function (v) { if (v.trip.row) v.trip.row.classList.add("is-lit"); });
    var last = pl.visits[pl.visits.length - 1];
    litRoad(last.trip.id);
    readout(null, [pinName(pl.name), last.date || last.trip.date].join(" · "));
    showPlate(pl, placeLines(pl));
  }
  function unlight() {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(unlightNow, HOVER_DELAY);
  }
  function unlightNow() {
    if (!lit) return;
    var was = lit;
    lit = null;
    if (was.stops) {
      if (was.row) was.row.classList.remove("is-lit");
      pinsOf(was).forEach(function (p) { p.el.classList.remove("is-lit"); });
    } else {
      was.pin.el.classList.remove("is-lit");
      was.visits.forEach(function (v) { if (v.trip.row) v.trip.row.classList.remove("is-lit"); });
    }
    litRoad(current ? current.id : "");
    hidePlate();
    readout(null);
  }

  // Clicked (a row or a pin): the map frames the trip, which stays marked
  // in the list, and the address says which.
  function choose(e, fromRow) {
    mark(e);
    if (map && ready) frame(true, e);
    try { history.replaceState(null, "", "#" + encodeURIComponent(e.id)); } catch (err) {}
    // On a phone the map is above the list: bring it up to see the trip.
    if (fromRow && !app() && stage.getBoundingClientRect().bottom < 80) {
      stage.scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
    }
  }
  function mark(e) {
    if (current && current.row) current.row.removeAttribute("aria-current");
    current = e;
    if (e && e.row) e.row.setAttribute("aria-current", "true");
    litRoad(e ? e.id : "");
  }
  function chosen() {
    var id = "";
    try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
    return id && byId[id] || null;
  }

  function readout(e, line) {
    if (!readEl) return;
    var s = line || (e ? [tripName(e.name), e.date].filter(Boolean).join(" · ") : summary);
    setText(readEl, s || summary);
  }

  // The plate's lines: [title, lines…]. Laptop layout, fine pointers.
  function tripPlate(e) {
    var lines = [];
    if (e.where) lines.push(whereLine(e.where));
    if (e.date) lines.push(e.date);
    return [tripName(e.name), lines];
  }
  function placeLines(pl) {
    // Many visits (Washington, D.C.'s eight): the short dates alone, a
    // line each; the list lights their rows.
    var many = pl.visits.length > 2;
    var lines = pl.visits.map(function (v) {
      if (many) return v.short || v.trip.short || v.date || v.trip.date;
      var when = v.date || v.trip.date;
      return v.trip.name !== pl.name ? tripName(v.trip.name) + " · " + when : when;
    });
    return [pinName(pl.name), lines];
  }
  function showPlate(pl, content) {
    if (!app() || COARSE || !plate || !map) return;    // no map (yet, or failed): no plate to point
    plate.textContent = "";
    plate.appendChild(setText(el("p", "g-plate-title"), content[0]));
    content[1].forEach(function (s, i) {
      plate.appendChild(setText(el("p", "g-plate-where" + (i ? " tl-plate-date" : "")), s));
    });
    plateFor = pl;
    plate.classList.remove("is-on");
    void plate.offsetWidth;                  // restart the shutter
    plate.classList.add("is-on");
    placePlate();
  }
  function hidePlate() {
    plateFor = null;
    if (plate) plate.classList.remove("is-on");
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

  fitBtn.addEventListener("click", function () {
    mark(null);
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    frame(true);
  });
  window.addEventListener("resize", function () { if (map) placePlate(); });

  /* ---------- boot -------------------------------------------------------- */

  var getJSON = NL ? NL.getJSON : function (p) { return fetch(p, { cache: "no-cache" }).then(function (r) { return r.json(); }); };
  // The roads are optional: the trips draw without them.
  var routesReady = getJSON("data/travel-routes.json").then(function (r) { return (r && r.routes) || {}; }, function () { return {}; });
  var dataReady = Promise.all([getJSON(SRC), routesReady]).then(function (res) {
    join(res[0] || {}, res[1]);
    renderList();
    readout(null);
    var start = chosen();
    if (start) mark(start);
  }, function () {
    listEl.textContent = "";
    listEl.appendChild(el("li", "g-list-status", t("Couldn't load the trips.")));
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
