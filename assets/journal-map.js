/* ==========================================================================
   newton-liu.com — a travel journal's route map (journals/<trip>/).

   The sticky map beside the journal: the trip as far as the reader has
   read it. Only the places reached by the entry being read show (their
   pins and names, one pin per place), with the road travelled up to it in
   the accent, the camera framing just that; the road and places still
   ahead appear as the journal reaches them (Newton, 2026-10-19), and go
   again when the reader goes back. It is the globe's own map,
   flat and small: the same greyscale OpenFreeMap tiles in each ground's
   colours (PALETTE, as in globe.js), the same crosshair pins and mono
   labels, repainted when the ground switches ("nl:theme").

   journal.js calls window.NLJournalMap.create(el, opts) and gets a handle:
     opts.pins     [{ name, label, lat, lng }]   places.json pins; label as shown
     opts.path     [[lng, lat], …]               routes.json path ([] = straight hops)
     opts.visits   [{ name, date }]              journal.json route, repeats allowed
     opts.entries  [{ id, title, place, visit }] reading order; date optional
     opts.onPick   function (entryId, byKey)     the reader asked for that entry
                                                 (byKey: from the keyboard, so focus goes there)
     handle.setActive(id), handle.resize(), handle.ready (a Promise)

   MapLibre arrives as a module from the page ("maplibre:ready", ":failed",
   or ":deferred" on Save-Data). Without it, or without WebGL2, the same
   route and pins are drawn plainly (the fallback), and reading never waits
   on either. The map's labels are HTML, never WebGL text: they may be
   Chinese (the site's rule keeps Chinese out of SVG and WebGL).
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------
     LABELS — every word this script puts on the page (screen readers
     mostly). In Chinese each goes through NLSite.t (site.js ZH_UI, keyed
     by the English here).
     ------------------------------------------------------------------ */
  var LABELS = {
    map: "Route map",
    zoomIn: "Zoom in", zoomOut: "Zoom out",
    pinOne: "{place}: {title}",         // a pin with one entry
    pinMany: "{place}: {n} entries",    // a pin with several; it opens their list
    list: "Entries at {place}",
    plus: "+", minus: "−"
  };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ------------------------------------------------------------------
     Numbers.
     ------------------------------------------------------------------ */
  var PAD_X = 44, PAD_Y = 30;          // px kept clear round the route when it is fitted
  var PAD_NARROW = 26;                 // ...sideways, in a map under 420px wide
  var BEARINGS = [-20, -10, 0, 10, 20];// tried when fitting; north stays roughly up
  var TURN_COST = .008;                // zoom a turn must win per degree to be taken
  var MAX_ZOOM = 11, TILE_MAX = 10;    // the camera, and the detailed tiles, stop here
  var GROW = 450;                      // ms: the travelled road growing (or shrinking) to a new entry
  var WIDEN = 700;                     // ms: the camera taking in (or letting go of) the places reached
  var SOLO_ZOOM = 7;                   // the closest the camera frames the trip so far (one place: its region)
  var GLIDE = 600;                     // ms: the one gentle pan, when the lit pin is out of view
  var WAIT = 15000;                    // no MapLibre by then: the plain drawing instead
  var LINE_CH = 18, LINE_CH_NARROW = 14;   // a label's longest line, in characters (mono)

  var TILES = "https://tiles.openfreemap.org/planet";
  var ATTR_TILES = '<a href="https://openfreemap.org">OpenFreeMap</a> ' +          // the globe's credit line
    '<a href="https://www.openmaptiles.org/">\u00a9 OpenMapTiles</a> ' +
    '<a href="https://www.openstreetmap.org/copyright">\u00a9 OpenStreetMap contributors</a>';
  // The plain drawing has no map under it; its road still comes from
  // OpenStreetMap (routes.json is traced on its roads), so that credit stays.
  var ATTR_FALLBACK = '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>';

  /* ------------------------------------------------------------------
     PALETTE — the map's colours on each ground: globe.js's PALETTE as a
     collection arrives (Black, and White's paper atlas), and the two must
     agree. The road travelled is the accent, read from site.css (the road
     still to come isn't drawn). What sits over the map in HTML
     (pins, labels, credit) takes the --jm-* colours in journal-map.css.
     ------------------------------------------------------------------ */
  function W(a) { return "rgba(255,255,255," + a + ")"; }
  function K(a) { return "rgba(0,0,0," + a + ")"; }
  var PALETTE = {
    black: {
      land: "#161616", sea: "#0a0a0a", park: W(.025), parkEdge: W(.16),
      coast: W(.16), river: W(.06), border: W(.16), state: W(.08)
    },
    white: {
      land: "#dededa", sea: "#ecece9", park: K(.035), parkEdge: K(.22),
      coast: K(.28), river: K(.07), border: K(.18), state: K(.09)
    }
  };
  function ground() { return document.documentElement.getAttribute("data-theme") === "light" ? "white" : "black"; }
  function accent() {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--accent");
    return (v && v.trim()) || "#d4a453";
  }

  function query(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  var COARSE = query("(pointer: coarse)");
  var REDUCED = query("(prefers-reduced-motion: reduce)");
  var rad = Math.PI / 180;
  var NL = window.NLSite || null;
  var ZH = !!(NL && NL.lang && NL.lang() === "zh");
  function t(key, vars) {
    var s = LABELS[key];
    if (NL && NL.t) return NL.t(s, vars);
    return !vars ? s : s.replace(/\{(\w+)\}/g, function (m, k) { return k in vars ? String(vars[k]) : m; });
  }

  /* ------------------------------------------------------------------
     MapLibre's arrival. This file loads before the page's module runs,
     so the news is kept here for maps made later.
     ------------------------------------------------------------------ */
  var lib = window.maplibregl ? "ready" : "waiting", waiters = [];
  function hear(state) {
    return function () {
      lib = state;
      var w = waiters; waiters = [];
      w.forEach(function (f) { f(); });
    };
  }
  window.addEventListener("maplibre:ready", hear("ready"));
  window.addEventListener("maplibre:failed", hear("failed"));
  window.addEventListener("maplibre:deferred", hear("deferred"));

  /* ---------- small helpers ------------------------------------------ */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function num(v) { return typeof v === "number" && isFinite(v); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function byFirst(a, b) { return a.first === b.first ? 0 : a.first < b.first ? -1 : 1; }   // travel order; never-visited last
  // Web Mercator at zoom 0, in tiles of 1: [0..1, 0..1], y down.
  function merc(ll) {
    var s = Math.sin(clamp(ll[1], -85, 85) * rad);
    return [(ll[0] + 180) / 360, .5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
  }
  function unmerc(m) {
    return [m[0] * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * m[1]))) / rad];
  }
  function turn(x, y, deg) {
    var c = Math.cos(deg * rad), s = Math.sin(deg * rad);
    return [x * c - y * s, x * s + y * c];
  }
  function mostlyHan(s) {
    return (s.match(/[㐀-鿿豈-﫿]/g) || []).length > (s.match(/[A-Za-z]/g) || []).length;
  }
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    return ZH ? +m[2] + "月" + +m[3] + "日" : MONTHS[+m[2] - 1] + " " + +m[3];
  }

  // A long place name ("Parc national des Hautes-Gorges-de-la-Rivière-Malbaie")
  // in even lines no longer than `max` characters, broken at spaces or
  // after a hyphen or slash: the fewest lines, then the most even.
  function breakName(s, max) {
    var parts = [], re = /[^\s\-\/]+[\-\/]*|\s+/g, m, glue = "";
    while ((m = re.exec(s))) {
      if (/^\s+$/.test(m[0])) { glue = " "; continue; }
      parts.push({ w: m[0], glue: glue }); glue = "";
    }
    if (!parts.length) return [s];
    function lay(width) {
      var lines = [], cur = "";
      parts.forEach(function (p) {
        var next = cur ? cur + p.glue + p.w : p.w;
        if (cur && next.length > width) { lines.push(cur); cur = p.w; } else cur = next;
      });
      if (cur) lines.push(cur);
      return lines;
    }
    var widest = Math.max.apply(null, parts.map(function (p) { return p.w.length; }));
    var best = lay(Math.max(max, widest)), n = best.length;
    for (var w = widest; w < Math.max(max, widest); w++) {
      var l = lay(w);
      if (l.length <= n) { best = l; break; }
    }
    return best;
  }

  /* ==================================================================
     One map.
     ================================================================== */

  function create(host, opts) {
    opts = opts || {};
    var onPick = typeof opts.onPick === "function" ? opts.onPick : function () {};
    var root = el("div", "jm");
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", t("map"));
    var stage = el("div", "jm-stage");          // MapLibre's container (the pins live in it), or the plain drawing's
    var pinLayer = el("div", "jm-pins");        // the pins, while the plain drawing is up
    root.appendChild(stage);
    root.appendChild(pinLayer);
    host.appendChild(root);

    var mode = "", map = null, ml = null, P = PALETTE[ground()], width = 0, height = 0;
    var cam = null, moved = false, needFit = true, activeId = null, list = null, listFor = null;
    var resolveReady, ready = new Promise(function (r) { resolveReady = r; });

    /* ---------- the data -------------------------------------------- */

    var pins = [], byName = {};
    (opts.pins || []).forEach(function (q) {
      if (!q || !num(q.lat) || !num(q.lng) || !q.name || byName[q.name]) return;
      var p = { name: q.name, label: q.label || q.name, ll: [q.lng, q.lat], entries: [], first: Infinity };
      pins.push(p); byName[p.name] = p;
    });
    var visits = (opts.visits || []).filter(function (v) { return v && byName[v.name]; });
    visits.forEach(function (v, k) { var p = byName[v.name]; p.first = Math.min(p.first, k); });
    var path = (opts.path || []).filter(function (q) { return q && num(q[0]) && num(q[1]); });
    var straight = path.length < 2;
    if (straight) path = visits.map(function (v) { return byName[v.name].ll; });
    var at = visitPoints();
    // How far into the trip the reader is: the last visit (index into
    // visits) the entry being read has reached. A place shows once its first
    // visit is reached. With no route to go by, everything shows.
    var reach = visits.length ? 0 : Infinity, reached = false;

    // Each entry's pin, and the visit its road runs to. An entry without a
    // visit of its own goes by its place (the first visit there not before
    // the last entry's); one with no place keeps the road where it was.
    var entries = [], byId = {}, last = -1;
    (opts.entries || []).forEach(function (e) {
      if (!e || e.id == null) return;
      var x = { id: String(e.id), title: e.title || "", place: byName[e.place] ? e.place : "", date: e.date || "", v: -1 };
      var v = typeof e.visit === "number" ? e.visit : -1;
      if (!(v >= 0 && v < visits.length) || (x.place && visits[v].name !== x.place)) v = -1;
      if (v < 0 && x.place) {
        for (var k = Math.max(last, 0); k < visits.length && v < 0; k++) if (visits[k].name === x.place) v = k;
        for (k = 0; k < visits.length && v < 0; k++) if (visits[k].name === x.place) v = k;
      }
      if (v >= 0) last = v;
      x.v = v; x.road = v >= 0 ? v : last;
      if (!x.date && v >= 0) x.date = visits[v].date || "";
      if (x.place) byName[x.place].entries.push(x);
      entries.push(x); byId[x.id] = x;
    });

    // Where each visit falls along the road: searching on from the visit
    // before, the first close approach rather than the closest point
    // overall, so a place passed twice (Baie-Saint-Paul, before and after
    // Hautes-Gorges) is the first pass the first time and the second after.
    function visitPoints() {
      if (straight) return visits.map(function (v, k) { return k; });
      var out = [], from = 0;
      visits.forEach(function (v) {
        var ll = byName[v.name].ll, cos = Math.cos(ll[1] * rad), d = [], best = Infinity, j;
        for (j = from; j < path.length; j++) {
          var dx = (path[j][0] - ll[0]) * cos, dy = path[j][1] - ll[1];
          d[j] = Math.sqrt(dx * dx + dy * dy);
          if (d[j] < best) best = d[j];
        }
        var near = Math.max(best * 2, best + .03);          // about 3 km
        for (j = from; j < path.length && d[j] > near; j++) {}
        while (j + 1 < path.length && d[j + 1] < d[j]) j++;
        from = Math.min(j, path.length - 1);
        out.push(from);
      });
      return out;
    }

    /* ---------- the pins: buttons where there is something to read -- */

    pins.forEach(function (p) {
      var live = p.entries.length > 0;
      var e = el(live ? "button" : "span", "jm-pin" + (live ? "" : " is-quiet"));
      e.innerHTML = '<i class="jm-pin-x"></i><i class="jm-pin-af"></i>';
      if (live) {
        e.type = "button";
        e.setAttribute("aria-label", p.entries.length > 1 ? t("pinMany", { place: p.label, n: p.entries.length })
          : t("pinOne", { place: p.label, title: p.entries[0].title }));
        if (p.entries.length > 1) { e.setAttribute("aria-haspopup", "dialog"); e.setAttribute("aria-expanded", "false"); }
        e.addEventListener("click", function (ev) {
          ev.stopPropagation();
          // A click from the keyboard (Enter, Space) has no detail; a tap or
          // click answers for the pin nearest it, as on a phone the pins' tap
          // areas overlap where places are close (Saguenay, Charlevoix).
          var byKey = ev.detail === 0, q = byKey ? p : nearest(ev.clientX, ev.clientY) || p;
          if (q.entries.length === 1) { closeList(); onPick(q.entries[0].id, byKey); }
          else if (listFor === q) closeList(byKey);
          else openList(q, byKey);
        });
        e.addEventListener("focus", function () { if (mode === "map") glideTo(p, true); });
        var lab = el("span", "jm-pin-label");
        lab.setAttribute("aria-hidden", "true");
        e.appendChild(lab);
        p.lab = lab;
      } else {
        e.setAttribute("aria-hidden", "true");
      }
      p.el = e;
    });
    // Keyboard order is travel order.
    pins.sort(byFirst);

    // The places still ahead are hidden, and can't be reached by a click or
    // the keyboard.
    function reveal() {
      pins.forEach(function (p) {
        p.ahead = p.first > reach;
        p.el.classList.toggle("is-ahead", p.ahead);
        if (p.ahead) p.el.classList.remove("has-label");     // a name would show through the hidden pin
        if (p.ahead && listFor === p) closeList();
        if (p.ahead && document.activeElement === p.el) p.el.blur();
      });
    }
    reveal();

    // The pin with something to read whose centre is closest to a point on
    // the screen.
    function nearest(x, y) {
      var best = null, bd = Infinity;
      pins.forEach(function (p) {
        if (!p.lab || p.ahead || !p.el.isConnected) return;
        var r = p.el.getBoundingClientRect(), dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y, d = dx * dx + dy * dy;
        if (r.width && d < bd) { bd = d; best = p; }
      });
      return best;
    }

    function writeLabels() {
      var max = width && width < 340 ? LINE_CH_NARROW : LINE_CH;
      pins.forEach(function (p) {
        if (!p.lab) return;
        var lab = p.lab;
        if (mostlyHan(p.label)) { if (NL && NL.text) NL.text(lab, p.label); else lab.textContent = p.label; }
        else {
          lab.textContent = "";
          breakName(p.label, max).forEach(function (line, i) {
            if (i) lab.appendChild(el("br"));
            lab.appendChild(document.createTextNode(line));
          });
        }
        p.lw = 0;
      });
    }
    var written = "";

    /* ---------- the camera: the trip so far in view -------------------- */

    // The road travelled and the places reached, fitted to the box at
    // whichever slight turn fits them largest (north stays up unless a turn
    // wins clearly), never closer than SOLO_ZOOM, so the first place alone
    // shows its region.
    function soFar() {
      if (reach === Infinity) return path;
      if (straight) return path.slice(0, reach + 1);
      return path.slice(0, (at[reach] || 0) + 1);
    }
    function fitCamera() {
      var pts = soFar().concat(pins.filter(function (p) { return p.first <= reach; }).map(function (p) { return p.ll; })).map(merc);
      if (!pts.length || !width || !height) return null;
      // Clear of the credit along the foot too (two lines in a narrow box).
      var credit = root.querySelector(".maplibregl-ctrl-attrib, .jm-credit");
      var px = width < 420 ? PAD_NARROW : PAD_X, top = PAD_Y, foot = PAD_Y + (credit ? credit.offsetHeight : 0);
      var aw = Math.max(40, width - 2 * px), ah = Math.max(40, height - top - foot), best = null;
      BEARINGS.forEach(function (b) {
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        pts.forEach(function (m) {
          var r = turn(m[0], m[1], -b);
          if (r[0] < x0) x0 = r[0]; if (r[0] > x1) x1 = r[0];
          if (r[1] < y0) y0 = r[1]; if (r[1] > y1) y1 = r[1];
        });
        var z = Math.min(SOLO_ZOOM, Math.log(Math.min(aw / Math.max(x1 - x0, 1e-9), ah / Math.max(y1 - y0, 1e-9)) / 512) / Math.LN2);
        // The camera's centre sits that much below the route's, so the
        // route is centred in the space above the credit.
        var score = z - Math.abs(b) * TURN_COST, c = turn((x0 + x1) / 2, (y0 + y1) / 2 + (foot - top) / 2 / (512 * Math.pow(2, z)), b);
        if (!best || score > best.score + 1e-6) best = { score: score, zoom: z, bearing: b, m: c };
      });
      return { center: unmerc(best.m), m: best.m, zoom: best.zoom, bearing: best.bearing };
    }

    // A place on screen, in px from the top left of the box.
    function project(ll) {
      if (mode === "map") { var q = map.project(ll); return { x: q.x, y: q.y }; }
      var m = merc(ll), s = 512 * Math.pow(2, cam.zoom);
      var r = turn((m[0] - cam.m[0]) * s, (m[1] - cam.m[1]) * s, -cam.bearing);
      return { x: width / 2 + r[0], y: height / 2 + r[1] };
    }

    /* ---------- the road travelled -------------------------------------- */

    var shown = -1, tween = 0;    // how far along the path the travelled road reaches (fractional); -1 = none
    function travelled(f) {
      if (f < 0 || path.length < 2) return [];
      var i = Math.floor(f), out = path.slice(0, i + 1), r = f - i;
      if (r > 0 && path[i + 1]) out.push([path[i][0] + (path[i + 1][0] - path[i][0]) * r, path[i][1] + (path[i + 1][1] - path[i][1]) * r]);
      if (out.length === 1) out.push(out[0]);
      return out;
    }
    function growTo(target) {
      cancelAnimationFrame(tween);
      var from = shown, start = 0;
      // The first entry lit (or a reader arriving at #id) shows its road at
      // once; after that it grows or shrinks to the next, briefly.
      if (REDUCED || from < 0 || target < 0 || from === target) { shown = target; drawRoad(); return; }
      tween = requestAnimationFrame(function step(ts) {
        if (!start) start = ts;
        var k = Math.min(1, (ts - start) / GROW), e = 1 - Math.pow(1 - k, 3);
        shown = from + (target - from) * e;
        drawRoad();
        if (k < 1) tween = requestAnimationFrame(step); else shown = target;
      });
    }
    function line(coords) {
      return { type: "FeatureCollection", features: coords.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [] };
    }
    function drawRoad() {
      if (mode === "map") {
        var src = map.getSource("jm-travelled");
        if (src) src.setData(line(travelled(shown)));
      } else if (mode === "plain") drawPlain();
    }

    /* ---------- labels: beside their pins, never over one another ----- */

    var queued = 0;
    function layoutSoon() {
      if (queued) return;
      queued = requestAnimationFrame(function () { queued = 0; layout(); });
    }
    // Pins with entries carry their name (the lit one first, then in
    // travel order): right of the pin, else left, above or below,
    // wherever it is clear of the box's edge, the credit, the zoom
    // buttons, every pin and every name placed before it. A name with
    // nowhere to go is left off.
    function layout() {
      if (!mode || !width || !height || (mode === "plain" && !cam)) return;
      var size = width < 340 ? "narrow" : "wide";
      if (written !== size) { written = size; writeLabels(); }
      var box = root.getBoundingClientRect(), blocks = [];
      [".maplibregl-ctrl-attrib", ".jm-credit", ".jm-zoom"].forEach(function (s) {
        var n = root.querySelector(s);
        if (!n || !n.offsetWidth) return;
        var r = n.getBoundingClientRect();
        blocks.push([r.left - box.left - 4, r.top - box.top - 4, r.right - box.left + 4, r.bottom - box.top + 4]);
      });
      pins.forEach(function (p) {
        p.xy = project(p.ll);
        p.inView = !p.ahead && p.xy.x > -8 && p.xy.y > -8 && p.xy.x < width + 8 && p.xy.y < height + 8;
        if (mode === "plain") p.el.style.transform = "translate(" + p.xy.x.toFixed(1) + "px," + p.xy.y.toFixed(1) + "px)";
        if (p.inView) blocks.push([p.xy.x - 7, p.xy.y - 7, p.xy.x + 7, p.xy.y + 7, p]);
      });
      var act = activeId && byId[activeId] && byId[activeId].place;
      var want = pins.filter(function (p) { return p.lab && p.inView; });
      want.sort(function (a, b) { return (b.name === act) - (a.name === act) || byFirst(a, b); });
      function clear(b, self, loose) {
        if (b[0] < 4 || b[1] < 4 || b[2] > width - 4 || b[3] > height - 4) return false;
        for (var i = 0; i < blocks.length; i++) {
          var o = blocks[i];
          if (loose && o[4] && o[4] !== self && (loose > 1 || !o[4].lab)) continue;
          if (o[4] !== self && b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return false;
        }
        return true;
      }
      want.forEach(function (p) {
        if (!p.lw) { p.lw = p.lab.offsetWidth; p.lh = p.lab.offsetHeight || 20; }
        var x = p.xy.x, y = p.xy.y, w = p.lw, h = p.lh;
        // Above and below, a name slides sideways to stay in the box (--dx),
        // or sits off to one side, its near end just past the pin.
        var x0 = clamp(x - w / 2, 4, Math.max(4, width - 4 - w)), dx = Math.round(x0 + w / 2 - x), r = Math.round(w / 2 + 4);
        var tries = [["", 0, [x + 11, y - h / 2, x + 11 + w, y + h / 2]], ["is-left", 0, [x - 11 - w, y - h / 2, x - 11, y + h / 2]],
                     ["is-up", dx, [x0, y - 10 - h, x0 + w, y - 10]], ["is-down", dx, [x0, y + 10, x0 + w, y + 10 + h]],
                     ["is-up", r, [x + 4, y - 10 - h, x + 4 + w, y - 10]], ["is-up", -r, [x - 4 - w, y - 10 - h, x - 4, y - 10]],
                     ["is-down", r, [x + 4, y + 10, x + 4 + w, y + 10 + h]], ["is-down", -r, [x - 4 - w, y + 10, x - 4, y + 10 + h]]];
        // A name keeps its place while that stays clear, so names don't hop about.
        if (p.side != null) tries.sort(function (a, b) { return (b[0] === p.side && b[1] === p.dx) - (a[0] === p.side && a[1] === p.dx); });
        var pick = tries.filter(function (c) { return clear(c[2], p); })[0];
        // The lit pin's name always shows: if nowhere is clear, over a quiet
        // pin, else over any (a name never takes a click: the pin under it
        // still answers), as long as it stays in the box.
        if (!pick && p.name === act) pick = tries.filter(function (c) { return clear(c[2], p, 1); })[0] || tries.filter(function (c) { return clear(c[2], p, 2); })[0];
        p.on = !!pick;
        if (pick) { p.side = pick[0]; p.dx = pick[1]; blocks.push(pick[2].concat([p])); }
      });
      pins.forEach(function (p) {
        if (!p.lab) return;
        p.el.classList.toggle("has-label", want.indexOf(p) >= 0 && !!p.on);
        p.el.classList.toggle("is-left", p.side === "is-left");
        p.el.classList.toggle("is-up", p.side === "is-up");
        p.el.classList.toggle("is-down", p.side === "is-down");
        p.el.style.setProperty("--dx", (p.dx || 0) + "px");
      });
      if (list) placeList();
    }

    /* ---------- the list beside a pin with several entries ------------ */

    // Opened from the keyboard, focus goes to its first entry; opened by a
    // click or tap, focus stays where it was (Esc and a click away close it).
    function openList(p, byKey) {
      closeList();
      listFor = p;
      list = el("div", "jm-list");
      list.setAttribute("role", "dialog");
      list.setAttribute("aria-label", t("list", { place: p.label }));
      var ul = el("ul");
      p.entries.forEach(function (x) {
        var li = el("li"), b = el("button", "jm-item");
        b.type = "button";
        var tt = el("span", "jm-item-title");
        if (NL && NL.text) NL.text(tt, x.title); else tt.textContent = x.title;
        b.appendChild(tt);
        var d = shortDate(x.date);
        if (d) b.appendChild(el("span", "jm-item-date", d));
        b.addEventListener("click", function (ev) { ev.stopPropagation(); closeList(); onPick(x.id, ev.detail === 0); });
        li.appendChild(b); ul.appendChild(li);
      });
      list.appendChild(ul);
      list.addEventListener("keydown", listKeys);
      list.addEventListener("focusout", function (ev) {
        if (list && ev.relatedTarget && !list.contains(ev.relatedTarget) && ev.relatedTarget !== p.el) closeList();
      });
      root.appendChild(list);
      p.el.setAttribute("aria-expanded", "true");
      p.el.classList.add("is-open");
      placeList();
      var first = list.querySelector("button");
      if (first && byKey) first.focus({ preventScroll: true });
      document.addEventListener("pointerdown", away, true);
      document.addEventListener("keydown", esc, true);
    }
    function closeList(refocus) {
      if (!list) return;
      var p = listFor;
      list.remove(); list = null; listFor = null;
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc, true);
      if (p) { p.el.setAttribute("aria-expanded", "false"); p.el.classList.remove("is-open"); }
      if (refocus && p) p.el.focus({ preventScroll: true });
    }
    function away(ev) {
      if (list && !list.contains(ev.target) && !(listFor && listFor.el.contains(ev.target))) closeList();
    }
    function esc(ev) {
      if (ev.key === "Escape" && list) { ev.preventDefault(); ev.stopPropagation(); closeList(true); }
    }
    function listKeys(ev) {
      var items = [].slice.call(list.querySelectorAll("button")), i = items.indexOf(document.activeElement);
      var to = ev.key === "ArrowDown" ? i + 1 : ev.key === "ArrowUp" ? i - 1 : ev.key === "Home" ? 0 : ev.key === "End" ? items.length - 1 : null;
      if (to === null) return;
      ev.preventDefault();
      items[(to + items.length) % items.length].focus({ preventScroll: true });
    }
    // Right of the pin when it fits, else left; level with it, kept in the box.
    function placeList() {
      var p = listFor;
      if (!p || !p.xy) return;
      var w = list.offsetWidth, h = list.offsetHeight, x = p.xy.x + 16, y = p.xy.y - h / 2;
      if (x + w > width - 8) x = p.xy.x - 16 - w;
      list.style.left = Math.round(clamp(x, 8, Math.max(8, width - w - 8))) + "px";
      list.style.top = Math.round(clamp(y, 8, Math.max(8, height - h - 8))) + "px";
    }

    /* ---------- the lit entry ----------------------------------------- */

    function setActive(id) {
      var x = id != null ? byId[String(id)] : null;
      activeId = x ? x.id : null;
      pins.forEach(function (p) { p.el.classList.toggle("is-active", !!x && p.name === x.place); });
      // The places reached so far, and the camera taking them in (at once
      // the first time, and not while the reader has moved the map).
      var r = !visits.length ? Infinity : x && x.road >= 0 ? x.road : 0, framed = false;
      if (r !== reach) {
        reach = r;
        reveal();
        if (!moved) { fit(reached, WIDEN); framed = true; }
      }
      reached = true;
      growTo(x && x.road >= 0 && at[x.road] != null ? at[x.road] : -1);
      layoutSoon();
      // Framed afresh, the lit pin is in view: a glide now would cut that short.
      if (!framed && x && x.place && mode === "map") glideTo(byName[x.place], false);
    }
    // Only when the pin is out of view (or under the box's edge): one gentle
    // pan at the same zoom, never a jump or a zoom. "Under the edge" is
    // narrower than the padding a fitted view keeps, so the trip so far,
    // fitted, never pans. A view panned that way while the reader hasn't
    // moved the map goes back to the whole trip as soon as the pin lit is
    // in it.
    var drifted = false;
    function glideTo(p, focusing) {
      if (!map || !p || !width) return;
      var q = map.project(p.ll), m = Math.min(28, (width < 420 ? PAD_NARROW : PAD_X) - 8);
      var seen = q.x > m && q.y > m && q.x < width - m && q.y < height - m;
      if (drifted && !moved && cam && inFit(p.ll, m)) { fit(true); return; }
      if (seen) return;
      drifted = true;
      map.easeTo({ center: p.ll, duration: REDUCED ? 0 : focusing ? GLIDE / 2 : GLIDE });
    }
    // Whether a place is in the fitted view (cam), m px clear of its edges.
    function inFit(ll, m) {
      var c = merc(ll), s = 512 * Math.pow(2, cam.zoom);
      var r = turn((c[0] - cam.m[0]) * s, (c[1] - cam.m[1]) * s, -cam.bearing);
      var x = width / 2 + r[0], y = height / 2 + r[1];
      return x > m && y > m && x < width - m && y < height - m;
    }

    /* ---------- size ------------------------------------------------------ */

    function measure() {
      width = stage.clientWidth; height = stage.clientHeight;
      return width > 0 && height > 0;
    }
    function resize() {
      var had = width + "x" + height;
      if (!measure()) return;
      if (map) map.resize();
      if (had !== width + "x" + height && !moved) needFit = true;
      if (needFit) fit(false);
      if (mode === "plain") drawPlain();
      layoutSoon();
    }
    function fit(animate, ms) {
      var c = fitCamera();
      if (!c) return;
      cam = c; needFit = false; moved = false; drifted = false;
      if (mode === "map") {
        map.setMinZoom(Math.max(0, c.zoom - 1.5));
        if (animate && !REDUCED) map.easeTo({ center: c.center, zoom: c.zoom, bearing: c.bearing, duration: ms || 400 });
        else map.jumpTo({ center: c.center, zoom: c.zoom, bearing: c.bearing });
      }
    }
    if (window.ResizeObserver) new ResizeObserver(function () { resize(); }).observe(stage);
    else window.addEventListener("resize", resize);
    // Focus moving onto a pin at the box's edge scrolls the clipped box
    // itself; it is put straight back (the pin's focus handler pans to it).
    [root, stage].forEach(function (n) { n.addEventListener("scroll", function () { n.scrollTop = n.scrollLeft = 0; }); });

    /* ---------- the map (MapLibre) --------------------------------------- */

    function style() {
      var poly = ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false];
      var parks = ["match", ["get", "class"], ["national_park", "nature_reserve"], true, false];
      var A = accent();
      return {
        version: 8,
        sources: {
          omt: { type: "vector", url: TILES, maxzoom: TILE_MAX, attribution: ATTR_TILES },
          "jm-travelled": { type: "geojson", data: line(travelled(shown)) }
        },
        // A change of ground repaints at once, as the page around the map does.
        transition: { duration: 0, delay: 0 },
        layers: [
          { id: "land", type: "background", paint: { "background-color": P.land } },
          { id: "water", type: "fill", source: "omt", "source-layer": "water", filter: ["all", poly, ["!=", ["get", "brunnel"], "tunnel"]], paint: { "fill-color": P.sea, "fill-antialias": false } },
          { id: "park", type: "fill", source: "omt", "source-layer": "park", minzoom: 4.5, filter: ["all", poly, parks], paint: { "fill-color": P.park } },
          { id: "coast", type: "line", source: "omt", "source-layer": "water",
            filter: ["all", poly, ["match", ["get", "class"], ["ocean", "sea", "lake"], true, false], ["!=", ["get", "brunnel"], "tunnel"]],
            paint: { "line-color": P.coast, "line-width": ["interpolate", ["linear"], ["zoom"], 4, .5, 8, .8], "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 1, 7.5, .4] } },
          { id: "river", type: "line", source: "omt", "source-layer": "waterway", minzoom: 6, filter: ["!=", ["get", "brunnel"], "tunnel"], paint: { "line-color": P.river } },
          { id: "park-edge", type: "line", source: "omt", "source-layer": "park", minzoom: 4.5, filter: ["all", poly, parks], paint: { "line-color": P.parkEdge, "line-width": .8, "line-dasharray": [1, 2] } },
          { id: "admin-4", type: "line", source: "omt", "source-layer": "boundary", minzoom: 3,
            filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]], paint: { "line-color": P.state, "line-width": .6, "line-dasharray": [2, 2] } },
          { id: "admin-2", type: "line", source: "omt", "source-layer": "boundary",
            filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]], paint: { "line-color": P.border, "line-width": .6 } },
          { id: "jm-travelled", type: "line", source: "jm-travelled", layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": A, "line-width": 2 } }
        ]
      };
    }
    function repaint() {
      P = PALETTE[ground()];
      if (mode !== "map") return;
      try {
        style().layers.forEach(function (ly) {
          for (var k in ly.paint) map.setPaintProperty(ly.id, k, ly.paint[k]);
        });
      } catch (e) {}
    }
    document.addEventListener("nl:theme", repaint);

    function startMap() {
      if (mode) return;
      ml = window.maplibregl;
      if (!ml || !ml.Map) { startPlain(); return; }
      measure();
      cam = fitCamera();
      try {
        map = new ml.Map({
          container: stage, style: style(),
          center: cam ? cam.center : [-71.5, 47], zoom: cam ? cam.zoom : 5, bearing: cam ? cam.bearing : 0,
          maxZoom: MAX_ZOOM, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), renderWorldCopies: false,
          attributionControl: false, keyboard: false, doubleClickZoom: false, boxZoom: false,
          scrollZoom: false,                       // the wheel always scrolls the page
          dragPan: !COARSE,                        // one finger scrolls the page on a phone; two pinch
          dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0
        });
      } catch (e) { map = null; startPlain(); return; }
      mode = "map";
      needFit = !cam;
      map.touchZoomRotate.disableRotation();
      var canvas = map.getCanvas();
      canvas.setAttribute("tabindex", "-1");
      canvas.setAttribute("aria-hidden", "true");      // the pins and the nav are the way in
      canvas.addEventListener("webglcontextlost", function () { toPlain(); });
      map.addControl(new ml.AttributionControl({ compact: false }), "bottom-right");
      // The credit arrives with the tiles' index and may take two lines:
      // the untouched view is fitted again above it.
      var credit = root.querySelector(".maplibregl-ctrl-attrib"), creditH = 0;
      if (credit && window.ResizeObserver) new ResizeObserver(function () {
        if (!map || credit.offsetHeight === creditH) return;
        creditH = credit.offsetHeight;
        if (!moved && measure()) { fit(false); layoutSoon(); }
      }).observe(credit);
      addZoom();
      pins.forEach(function (p) {
        p.marker = new ml.Marker({ element: p.el, anchor: "center" }).setLngLat(p.ll).addTo(map);
      });
      var loaded = false;
      // A tile that fails is only a gap; anything else before the first
      // drawing (the tiles' index, the style) and the plain drawing takes over.
      map.on("error", function (e) { if (!loaded && !(e && e.tile)) toPlain(); });
      map.on("load", function () { loaded = true; clearTimeout(slow); if (!moved) fit(false); drawRoad(); layout(); resolveReady(); });
      map.on("move", layoutSoon);
      map.on("dragstart", function () { moved = true; closeList(); });
      map.on("zoomstart", function (e) { if (e && e.originalEvent) moved = true; });
      map.on("click", function () { closeList(); });
      // Still nothing after WAIT, counted while the box is shown (a phone's
      // folded map isn't late): the plain drawing instead.
      var slow = setTimeout(function late() {
        if (loaded || mode !== "map") return;
        if (!stage.clientWidth || !stage.clientHeight) { slow = setTimeout(late, WAIT); return; }
        toPlain();
      }, WAIT);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { pins.forEach(function (p) { p.lw = 0; }); layoutSoon(); });
      layoutSoon();
    }

    // The two small buttons: closer, and back out (all the way out, the
    // trip so far fitted again).
    function addZoom() {
      var z = el("div", "jm-zoom");
      [["plus", "zoomIn", 1], ["minus", "zoomOut", -1]].forEach(function (d) {
        var b = el("button", "jm-zoom-btn", t(d[0]));
        b.type = "button";
        b.setAttribute("aria-label", t(d[1]));
        b.addEventListener("click", function (ev) {
          ev.stopPropagation();
          closeList();
          var to = map.getZoom() + d[2];
          if (d[2] < 0 && cam && to <= cam.zoom + .05) { fit(true); return; }
          moved = true;
          map.easeTo({ zoom: Math.min(MAX_ZOOM, to), duration: REDUCED ? 0 : 300 });
        });
        z.appendChild(b);
      });
      root.appendChild(z);
    }

    /* ---------- the plain drawing (no MapLibre, no WebGL2) -------------- */

    var svg = null, travelledEl = null;
    function toPlain() {
      if (mode !== "map") return;
      try { map.remove(); } catch (e) {}
      map = null; mode = "";
      var z = root.querySelector(".jm-zoom");
      if (z) z.remove();
      stage.textContent = "";
      startPlain();
    }
    function startPlain() {
      if (mode) return;
      mode = "plain";
      root.classList.add("is-plain");
      var NS = "http://www.w3.org/2000/svg";
      svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "jm-plain");
      svg.setAttribute("aria-hidden", "true");
      travelledEl = document.createElementNS(NS, "polyline");
      travelledEl.setAttribute("class", "jm-plain-travelled");
      svg.appendChild(travelledEl);
      stage.appendChild(svg);
      pins.forEach(function (p) { pinLayer.appendChild(p.el); });
      var credit = el("div", "jm-credit");
      credit.innerHTML = ATTR_FALLBACK;
      root.appendChild(credit);
      measure();
      needFit = true;
      if (width && height) fit(false);
      drawPlain();
      layout();
      resolveReady();
    }
    function drawPlain() {
      if (!svg) return;
      if (!cam || !width || !height) return;
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      function pts(c) { return c.map(function (ll) { var q = project(ll); return q.x.toFixed(1) + "," + q.y.toFixed(1); }).join(" "); }
      travelledEl.setAttribute("points", pts(travelled(shown)));
    }

    /* ---------- start ------------------------------------------------------- */

    measure();
    function go() {
      if (lib === "ready" && window.maplibregl) startMap();
      else if (lib !== "waiting") startPlain();
    }
    if (lib === "waiting") {
      waiters.push(go);
      setTimeout(function () { if (!mode) startPlain(); }, WAIT);
    } else go();

    return {
      setActive: setActive,
      resize: resize,
      ready: ready
    };
  }

  window.NLJournalMap = { create: create };
})();
