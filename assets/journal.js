/* ==========================================================================
   newton-liu.com — a travel journal (journals/<place>/index.html).

   Reads the trip (journal.json beside the page) and its entries
   (entries/<id>.txt, one file each), and draws the page from them: the
   cover, the entries, the list of entries grouped by date, and, through
   assets/journal-map.js (window.NLJournalMap), the route map. Everything
   here is reading: plain scrolling, the entry being read lit in the list
   and on the map, jumps from the list and the map, the photographs into
   the gallery's own viewer (NLSite.viewer), the videos.

   The words are Newton's and are never touched: a blank line starts a new
   paragraph, a single line break stays where he put it, leading spaces
   and full-width spaces stay. Nothing is ever read out of the text: an
   entry's place on the map is its `place:` line, nothing else.

   Who sees what (data/places.json, places.<place>.journal):
     the local preview (localhost, 127.0.0.1, [::1])  everything, the
                         placeholders included, draft or not
     the live site       while "draft" is anything but false: a one-line
                         notice, no content. Once false: the journal, with
                         every placeholder left out.

   A test journal can stand in for the real one in the local preview:
   ?content=_arrange/journal-fixture/ (a folder from the site's root with
   its own journal.json and entries/). Never on the live site.

   media.json beside journal.json (written by tools/build.py) holds the
   width and height of each of the journal's media, so every frame has its
   shape before its file arrives. A file it doesn't know yet is laid out as
   3:2 until it arrives.
   ========================================================================== */

(function () {
  "use strict";

  var S = window.NLSite;
  var main = document.getElementById("jn");
  if (!S || !main) return;

  var body = document.body;
  var BASE = body.getAttribute("data-base") || "";
  var LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var ZH = S.lang() === "zh";
  var PLACE = main.getAttribute("data-place") || "";
  var t = S.t;

  // Where the journal's own files are, from the site's root: the page's
  // own folder, or in the local preview a test folder named in the URL.
  var CONTENT = (function () {
    var m = /[?&]content=([^&#]*)/.exec(location.search), asked = "";
    try { asked = m ? decodeURIComponent(m[1]) : ""; } catch (e) {}
    return LOCAL && /^_arrange\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\/$/.test(asked) ? asked : "journals/" + PLACE + "/";
  })();

  // The line an entry has to cross to become the one being read, as a
  // share of the window's height from the top.
  var READ_LINE = 0.35;
  // A row of photographs aims at this sum of aspect ratios (a 3:2 frame
  // alone, two uprights side by side) and holds at most three.
  var ROW_AIM = 1.6, ROW_MAX = 3;
  var MAP_KEY = "journalMap";   // localStorage: "hidden" keeps the phone's map folded

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"];
  var DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var DAYS_ZH = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  var HAN = /[㐀-鿿豈-﫿]/g;

  function mq(q) {
    return window.matchMedia ? window.matchMedia(q) : { matches: false };
  }
  function onChange(m, fn) {
    if (m.addEventListener) m.addEventListener("change", fn);
    else if (m.addListener) m.addListener(fn);
  }
  var WIDE = mq("(min-width: 1000px)");
  var CALM = mq("(prefers-reduced-motion: reduce)");

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function own(o, k) { return o && Object.prototype.hasOwnProperty.call(o, k); }
  function safe(fn) { try { fn(); } catch (e) { if (window.console) console.warn("journal map:", e); } }
  function mostlyHan(s) { return (s.match(HAN) || []).length > (s.match(/[A-Za-z]/g) || []).length; }

  function getText(path) {
    return fetch(BASE + path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + ": HTTP " + r.status);
      return r.text();
    });
  }

  // Each page draws its own scroll position (the #entry, or the top).
  try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) {}

  /* ---------- dates and times ------------------------------------------ */

  function day(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 ? d : null;
  }
  // "Tuesday, October 7" · "10月7日 星期二"
  function dayText(d) {
    return ZH ? (d.getMonth() + 1) + "月" + d.getDate() + "日 " + DAYS_ZH[d.getDay()]
              : DAYS_EN[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
  }
  // "October 3 – 14, 2026" · "2026年10月3日–14日"
  function rangeText(from, to) {
    var a = day(from), b = day(to) || a;
    a = a || b;
    if (!a) return "";
    if (b < a) { var x = a; a = b; b = x; }
    var Y = a.getFullYear(), M = a.getMonth(), D = a.getDate();
    var y = b.getFullYear(), mo = b.getMonth(), d = b.getDate();
    if (ZH) {
      var first = Y + "年" + (M + 1) + "月" + D + "日";
      if (+a === +b) return first;
      return first + "–" + (y !== Y ? y + "年" : "") + (y !== Y || mo !== M ? (mo + 1) + "月" : "") + d + "日";
    }
    if (+a === +b) return MONTHS[M] + " " + D + ", " + Y;
    if (y !== Y) return MONTHS[M] + " " + D + ", " + Y + " – " + MONTHS[mo] + " " + d + ", " + y;
    return MONTHS[M] + " " + D + " – " + (mo !== M ? MONTHS[mo] + " " : "") + d + ", " + y;
  }
  // "15:50" → "3:50 PM" · "下午3:50"; anything else shows no time at all.
  function timeText(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(s || "");
    if (!m || +m[1] > 23 || +m[2] > 59) return "";
    var h = +m[1], h12 = h % 12 || 12;
    return ZH ? (h < 12 ? "上午" : "下午") + h12 + ":" + m[2] : h12 + ":" + m[2] + (h < 12 ? " AM" : " PM");
  }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  // "No. 02" · "第2篇"
  function number(e) { return t("No. {n}", { n: ZH ? e.no : pad(e.no) }); }

  /* ---------- the entry format (SPEC: entries/<id>.txt) ----------------

       title: 法语
       date: 10.12.2026 周一          (or 2026-10-12)
       time: 8:00 AM                  (or 08:00)
       place: Tadoussac               (the pin, for the map)
       where: Tadoussac, QC, Canada   (the place line as he wrote it)
       ---
       the body
       ## 4.1海和我        (a heading inside the entry)

     The lines above the --- are read only if every one of them is a
     "key: value" line, so a body that happens to hold a --- of its own
     and no head is left whole. */

  var MEDIA_LINE = /^@(photo|video|placeholder)(?:\s+(.*))?$/;

  function parseEntry(id, raw) {
    var lines = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
    var head = {}, start = 0;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== "---") continue;
      var top = lines.slice(0, i), ok = true;
      top.forEach(function (line) {
        if (!line.trim()) return;
        var m = /^\s*([A-Za-z]+)\s*:(.*)$/.exec(line);
        if (m) head[m[1].toLowerCase()] = m[2].trim(); else ok = false;
      });
      if (ok) start = i + 1; else head = {};
      break;
    }
    var when = dateLine(head.date || "");
    return {
      id: id,
      title: head.title || "", date: when.date, dateAsWritten: when.written, dayClash: when.clash,
      time: head.time || "", place: head.place || "", where: head.where || "",
      blocks: parseBody(lines.slice(start))
    };
  }

  // The date as he writes it, "10.12.2026 周一" (month.day.year), shows as
  // written; the map and the nav read it as 2026-10-12. If his weekday and
  // the date disagree, the local preview says so rather than guessing which
  // one is right.
  function dateLine(s) {
    if (day(s)) return { date: s, written: "", clash: false };
    var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/.exec(s);
    if (!m) return { date: "", written: "", clash: false };
    var iso = m[3] + "-" + pad(+m[1]) + "-" + pad(+m[2]), d = day(iso);
    if (!d) return { date: "", written: s, clash: false };
    var w = /(?:周|星期|礼拜)([日天一二三四五六])/.exec(s);
    return { date: iso, written: s, clash: !!w && "日一二三四五六".indexOf(w[1] === "天" ? "日" : w[1]) !== d.getDay() };
  }

  // Paragraphs (a blank line between), and groups of media lines (one
  // after another, no blank line between) laid out together.
  function parseBody(lines) {
    var blocks = [], para = null, group = null;
    function endPara() { if (para) { blocks.push({ type: "p", text: para.join("\n") }); para = null; } }
    function endGroup() { if (group) { blocks.push(group); group = null; } }
    lines.forEach(function (line) {
      line = line.replace(/[ \t]+$/, "");
      if (!line) { endPara(); endGroup(); return; }
      var m = MEDIA_LINE.exec(line);
      if (m) {
        endPara();
        var item = mediaItem(m[1], m[2] || "");
        if (item.kind === "note") { endGroup(); blocks.push({ type: "note", item: item }); return; }
        if (!group) group = { type: "media", items: [] };
        group.items.push(item);
        return;
      }
      endGroup();
      // "## 4.1海和我": a heading inside the entry, his words after the ##.
      var h = /^##\s+(.+)$/.exec(line);
      if (h) { endPara(); blocks.push({ type: "h", text: h[1] }); return; }
      if (line.charAt(0) === "\\" && (line.charAt(1) === "@" || line.charAt(1) === "#")) line = line.slice(1);   // "\@", "\#" are literal
      (para = para || []).push(line);
    });
    endPara();
    endGroup();
    return blocks;
  }

  //   @photo <path> | caption
  //   @video <path> | poster <path> | caption
  //   @placeholder photo|video|text | what goes here
  function mediaItem(kind, rest) {
    var parts = rest.split("|").map(function (s) { return s.trim(); });
    if (kind === "placeholder") {
      var what = (parts[0] || "").toLowerCase();
      what = what === "video" || what === "text" ? what : "photo";
      return { kind: what === "text" ? "note" : "hold", what: what, note: parts.slice(1).join(" | ") };
    }
    var item = { kind: kind, raw: parts[0] || "", src: cleanPath(parts[0]), poster: "", caption: "" };
    var words = [];
    parts.slice(1).forEach(function (p) {
      var m = /^poster\s+(.+)$/i.exec(p);
      if (kind === "video" && m && !item.poster) item.poster = cleanPath(m[1]);
      else words.push(p);
    });
    item.caption = words.join(" | ");
    return item;
  }

  // A media path is written from the site's root (images/_journals/…).
  // Anything else (an address, a way up and out) is refused.
  function cleanPath(p) {
    p = (p || "").trim().replace(/^\.\//, "");
    return /^[A-Za-z0-9_][^:?#\\]*$/.test(p) && p.indexOf("..") < 0 ? p : "";
  }

  // A file's width over its height from media.json, or 0 if it isn't there.
  function shapeOf(path) {
    var s = path && own(shapes, path) ? shapes[path] : null;
    return s && s[0] > 0 && s[1] > 0 ? Math.max(0.3, Math.min(4, s[0] / s[1])) : 0;
  }

  /* ---------- state ------------------------------------------------------ */

  var journal = null;
  var photoBySrc = {};
  var shapes = {};        // media.json: { path: [width, height] }
  var cameras = {};       // media.json: { path: { camera, lens, focal, aperture, shutter, iso } }
  var list = [];          // the entries as drawn, in reading order
  var byId = {};
  var pins = [], pinByName = {};
  var map = null;
  var current = null;     // the entry lit in the list and on the map
  var pinned = null;      // ...held there after a jump until the reader scrolls
  var navEl = null, links = [];

  var navHome = main.querySelector(".jn-navhome");
  var bar = document.getElementById("jn-bar");
  var barBtn = bar && bar.querySelector(".jn-bar-btn");
  var barList = document.getElementById("jn-bar-list");
  var readEl = main.querySelector(".jn-readout");
  var mapBlock = main.querySelector(".jn-mapblock");
  var mapToggle = main.querySelector(".jn-map-toggle");

  /* ---------- loading and the gate --------------------------------------- */

  S.getJSON("data/places.json").then(function (data) {
    var place = (data && data.places && data.places[PLACE]) || {};
    var gate = place.journal || null;
    if (!LOCAL && !(gate && gate.draft === false)) return notice();
    return load(place);
  }).catch(function (err) {
    failed(err);
  });

  // The one line shown instead of the journal. In Chinese no space after
  // 。, which carries its own.
  function notice() {
    var p = gate(t("This journal isn't published yet.") + (ZH ? "" : " "));
    var a = p.appendChild(el("a", "text-link", t("See the collections →")));
    a.href = BASE + "#collections";
  }

  function failed(err) {
    gate(t("Couldn't load the journal. {err}", { err: err && err.message ? err.message : "" }));
  }

  // Everything else is hidden, so the skip link leads to this line.
  function gate(words) {
    var p = main.querySelector(".jn-gate");
    p.textContent = words;
    p.id = "jn-gate";
    p.tabIndex = -1;
    var skip = document.querySelector(".skip-link");
    if (skip) skip.setAttribute("href", "#jn-gate");
    p.hidden = false;
    main.classList.remove("is-loading");
    main.classList.add("is-gated");
    return p;
  }

  function load(place) {
    return Promise.all([
      S.getJSON(CONTENT + "journal.json"),
      S.getJSON("data/routes.json").catch(function () { return null; }),
      S.getJSON("data/photos.json").catch(function () { return null; }),
      S.getJSON(CONTENT + "media.json").catch(function () { return null; })
    ]).then(function (r) {
      journal = r[0] || {};
      shapes = (r[3] && r[3].sizes) || {};
      cameras = (r[3] && r[3].exif) || {};
      var routes = r[1], photos = (r[2] && r[2].photos) || [];
      photos.forEach(function (p) { if (p && p.src) photoBySrc[p.src] = p; });
      pins = (place.pins || []).map(function (p) {
        return { name: p.name, label: S.pin(p.name), lat: +p.lat, lng: +p.lng };
      });
      pins.forEach(function (p) { pinByName[p.name] = p; });
      var key = journal.place || PLACE;
      var path = (routes && routes.routes && routes.routes[key] && routes.routes[key].path) || [];

      var seen = {};
      var ids = (journal.entries || []).filter(function (id) {
        var ok = typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id) && !own(seen, id);
        seen[id] = true;
        return ok;
      });
      // An entry Newton has also written in English (listed in "english")
      // reads from entries/<id>.en.txt while the site is in English, as
      // About's English page does; every other entry is the same in both.
      var english = {};
      (journal.english || []).forEach(function (id) { english[id] = true; });
      return Promise.all(ids.map(function (id) {
        var file = CONTENT + "entries/" + id + ".txt";
        var en = !ZH && own(english, id) ? CONTENT + "entries/" + id + ".en.txt" : null;
        return (en ? getText(en).catch(function () { return getText(file); }) : getText(file)).then(function (raw) {
          return parseEntry(id, raw);
        }, function () {
          return { id: id, missing: true };
        });
      })).then(function (entries) { render(entries, path); });
    });
  }

  /* ---------- drawing ---------------------------------------------------- */

  function render(entries, path) {
    // One title in each language (Newton: an English and a Chinese
    // version, not the two side by side).
    var title = (ZH && journal.titleZh) || journal.title || "Quebec";
    document.title = t("{title} Journal — Newton Liu Photography", { title: title });

    drawCover(title);

    var column = el("div", "jn-column");
    var n = 0;
    entries.forEach(function (e) {
      if (e.missing) {
        if (LOCAL) column.appendChild(holdNote(t("Couldn't load {file}", { file: CONTENT + "entries/" + e.id + ".txt" })));
        return;
      }
      e.no = ++n;
      e.el = drawEntry(e);
      column.appendChild(e.el);
      list.push(e);
      byId[e.id] = e;
    });
    var box = document.getElementById("jn-entries");
    box.textContent = "";
    box.appendChild(column);

    var visits = (journal.route || []).filter(function (v) { return v && v.place; })
      .map(function (v) { return { name: v.place, date: v.date || "" }; });
    assignVisits(visits);

    drawNav();
    main.classList.remove("is-loading");
    main.classList.add("is-open");

    wireMapToggle();
    placeNav();
    onChange(WIDE, function () { placeNav(); resizeMap(); });
    wireBar();
    startMap(path, visits);
    wireSpy();
    wireVideos();
    arrive();
  }

  /* --- the cover --- */

  function drawCover(title) {
    var box = document.getElementById("jn-cover");
    var slot = box.querySelector(".jn-cover-media");
    S.text(box.querySelector(".jn-cover-title"), title);

    var month = box.querySelector(".jn-cover-month"), dates = box.querySelector(".jn-cover-dates");
    month.textContent = S.date(journal.month || "");
    var range = rangeText(journal.dates && journal.dates.from, journal.dates && journal.dates.to);
    if (range) dates.textContent = range;
    if (!month.textContent) month.hidden = true;
    if (!dates.textContent) dates.hidden = true;

    // An upright cover is shown whole on the raised ground, as an upright
    // gallery opener is, rather than cut to a band across the window.
    function upright(ar) { box.classList.toggle("is-upright", ar > 0 && ar < 1); }
    var c = journal.cover || {}, src = cleanPath(c.src);
    if (c.type === "photo" && src) {
      var rec = photoBySrc[src] || { src: src };
      var img = el("img");
      img.decoding = "async";
      img.setAttribute("fetchpriority", "high");
      img.alt = c.alt || "";
      var ar = photoBySrc[src] ? S.aspectOf(rec) : shapeOf(src);
      upright(ar);
      img.addEventListener("load", function () { upright(img.naturalWidth / img.naturalHeight); });
      // "fit": "whole" shows a landscape cover in its own proportions, the
      // full width of the window and as tall as that makes it, nothing cut;
      // without it the cover fills the window and is trimmed to fit.
      if (c.fit === "whole" && !(ar > 0 && ar < 1)) {
        box.classList.add("is-whole");
        if (ar) slot.style.aspectRatio = String(ar);
      }
      S.responsive(img, rec, "100vw");
      if (c.focus || rec.focus) img.style.objectPosition = c.focus || rec.focus;
      slot.appendChild(img);
      box.classList.add("has-media");
    } else if (c.type === "video" && src) {
      upright(shapeOf(src) || shapeOf(cleanPath(c.poster)));
      drawCoverVideo(box, slot, c, src).addEventListener("loadedmetadata", function () {
        if (this.videoWidth && this.videoHeight) upright(this.videoWidth / this.videoHeight);
      });
      box.classList.add("has-media", "has-video");
    } else if (LOCAL) {
      var hold = slot.appendChild(el("div", "jn-hold jn-cover-hold"));
      holdLabel(hold, t("Placeholder") + " · " + t("Cover"));
      hold.appendChild(el("p", "jn-hold-note", t("A photograph or a short video to come")));
      hold.appendChild(el("p", "jn-hold-note", t("Shown in the local preview only")));
      box.classList.add("is-hold");
    } else {
      box.classList.add("is-plain");
    }
  }

  // A short, silent loop: muted, inline, never with sound. It plays on its
  // own unless the visitor has asked for less motion, when it waits on its
  // poster for the play button. It rests while scrolled out of sight, and
  // gives way to any video in the entries.
  function drawCoverVideo(box, slot, c, src) {
    var v = el("video", "jn-cover-video");
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.loop = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.preload = CALM.matches ? "none" : "auto";
    var poster = cleanPath(c.poster);
    if (poster) v.poster = S.url(poster);
    if (c.alt) v.setAttribute("aria-label", c.alt); else v.setAttribute("aria-hidden", "true");
    v.src = S.url(src);
    slot.appendChild(v);

    var btn = box.appendChild(el("button", "jn-cover-play"));
    btn.type = "button";
    var held = false;      // the visitor paused it
    var away = false;      // paused because it scrolled out of sight
    function sync() {
      var paused = v.paused;
      btn.classList.toggle("is-paused", paused);
      btn.setAttribute("aria-label", t(paused ? "Play video" : "Pause video"));
      btn.title = t(paused ? "Play video" : "Pause video");
    }
    function play() {
      var p = v.play();
      if (p && p.catch) p.catch(function () { sync(); });
    }
    btn.addEventListener("click", function () {
      if (v.paused) { held = false; play(); }
      else { held = true; v.pause(); }
    });
    v.addEventListener("play", sync);
    v.addEventListener("pause", sync);
    sync();
    if (!CALM.matches) play();
    onChange(CALM, function () { if (CALM.matches && !v.paused) { held = true; v.pause(); } });

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        var seen = es[es.length - 1].isIntersecting;
        if (!seen && !v.paused) { away = true; v.pause(); }
        else if (seen && away) {
          away = false;
          if (!held && !CALM.matches && !otherPlaying(v)) play();
        }
      }, { threshold: 0.15 }).observe(box);
    }
    return v;
  }

  function otherPlaying(v) {
    var any = false;
    each(document.querySelectorAll("video"), function (o) { if (o !== v && !o.paused && !o.ended) any = true; });
    return any;
  }

  /* --- an entry --- */

  function drawEntry(e) {
    var art = el("article", "jn-entry");
    art.id = e.id;
    art.tabIndex = -1;
    var head = art.appendChild(el("header", "jn-entry-head"));

    // His heading, line by line as he writes it:
    //   2. 法语
    //   10.12.2026 周一
    //   Tadoussac, QC, Canada
    //   8:00 AM
    // The number comes from the reading order. A date written 2026-10-12, a
    // time written 08:00 and an empty "where" fall back to the page's own
    // wording (Monday, October 12 · 8:00 AM · the pin's name).
    var h2 = head.appendChild(el("h2", "jn-title"));
    h2.appendChild(el("span", "jn-no", e.no + ". "));
    h2.appendChild(el("span", null, e.title));

    var lines = head.appendChild(el("p", "jn-lines"));
    function line(node) { lines.appendChild(node).classList.add("jn-line"); return node; }
    var d = day(e.date);
    if (d) {
      var time = line(el("time", null, e.dateAsWritten || dayText(d)));
      time.setAttribute("datetime", e.date);
      if (e.dayClash && LOCAL) time.appendChild(el("span", "jn-hold-text", " " + t("weekday doesn't match the date")));
    } else if (e.dateAsWritten) {
      line(el("span", null, e.dateAsWritten));
    } else if (LOCAL) {
      line(el("span", "jn-hold-text", t("Date to come")));
    }
    if (e.where || e.place) line(el("span", e.where ? "jn-where" : "jn-pin", e.where || S.pin(e.place)));
    var tt = timeText(e.time) || e.time;
    if (tt) line(el("span", "jn-time", tt));

    var text = art.appendChild(el("div", "jn-text"));
    var words = e.blocks.filter(function (b) { return b.type === "p"; })
      .map(function (b) { return b.text; }).join("\n");
    // A Chinese entry is set in the Chinese pairing throughout, an English
    // line in it included (as About's sign-off is).
    if (mostlyHan(words || e.title)) text.lang = "zh-Hans";

    e.photos = [];
    e.buttons = [];
    e.blocks.forEach(function (b) {
      if (b.type === "p") text.appendChild(el("p", "jn-p", b.text));
      else if (b.type === "h") {
        // "4.1海和我": the number set apart as the entry's own is, his words kept whole.
        var hn = /^(\d+(?:\.\d+)+\.?)\s*(.*)$/.exec(b.text), h3 = text.appendChild(el("h3", "jn-sub"));
        if (hn && hn[2]) { h3.appendChild(el("span", "jn-sub-no", hn[1])); h3.appendChild(el("span", null, hn[2])); }
        else h3.textContent = b.text;
      }
      else if (b.type === "note") { if (LOCAL) text.appendChild(holdNote(b.item.note, true)); }
      else if (b.type === "media") {
        var g = drawGroup(b.items, e);
        if (g) text.appendChild(g);
      }
    });
    e.buttons.forEach(function (b, i) {
      b.setAttribute("aria-label", t("View photograph {n} of {total} larger", { n: i + 1, total: e.buttons.length }));
    });
    return art;
  }

  // A placeholder's small label: marked English (or Chinese, in the
  // Chinese site), so inside a Chinese entry it keeps the mono.
  function holdLabel(box, s) {
    var p = S.text(box.appendChild(el("p", "jn-hold-label")), s);
    if (!p.hasAttribute("lang")) p.lang = "en";
    return p;
  }

  // A placeholder for words still to come (the local preview only).
  function holdNote(note, isText) {
    var box = el("div", "jn-hold jn-hold-block");
    holdLabel(box, t("Placeholder") + (isText ? " · " + t("Text") : ""));
    if (note) box.appendChild(el("p", "jn-hold-note", note));
    return box;
  }

  /* --- media: a group of photographs, videos and placeholders --- */

  // Rows are found for the whole group at once: each row holds one to three
  // frames side by side at one height, uncropped, and the split is the one
  // whose rows come closest to ROW_AIM (so two uprights pair, a landscape
  // takes the column, a lone upright stands centred, capped in height).
  function rowsFor(ars) {
    var best = [0], from = [];
    for (var i = 1; i <= ars.length; i++) {
      best[i] = Infinity;
      for (var k = 1; k <= ROW_MAX && k <= i; k++) {
        var s = 0;
        for (var j = i - k; j < i; j++) s += ars[j];
        var cost = best[i - k] + Math.pow(Math.log(s / ROW_AIM), 2);
        if (cost < best[i]) { best[i] = cost; from[i] = i - k; }
      }
    }
    var rows = [];
    for (var at = ars.length; at > 0; at = from[at]) {
      var row = [];
      for (var x = from[at]; x < at; x++) row.push(x);
      rows.unshift(row);
    }
    return rows;
  }

  // The width a frame is drawn at, for the browser's choice of file: the
  // reading column (46rem, about 52vw of the window beside the panel, 58vw
  // just past 1000px; the window less its margins below 1000px) times the
  // frame's share of its row. Mirrors --jn-col and .jn-body in journal.css.
  function sizesFor(share) {
    return "(max-width: 999px) " + Math.round(share * 100) + "vw, " +
           "(max-width: 1099px) " + Math.round(share * 58) + "vw, " +
           "(min-width: 1416px) " + Math.round(share * 736) + "px, " + Math.round(share * 52) + "vw";
  }

  function drawGroup(items, e) {
    var cells = [];
    items.forEach(function (item) {
      var c = null;
      if (item.kind === "hold") { if (LOCAL) c = holdCell(item.what, item.note); }
      else if (!item.src) { if (LOCAL) c = holdCell(item.kind, "“" + item.raw + "”"); }
      else if (item.kind === "photo") c = photoCell(item, e);
      else if (item.kind === "video") c = videoCell(item);
      if (c) cells.push(c);
    });
    if (!cells.length) return null;
    var g = el("div", "jn-media");
    g._cells = cells;
    layoutGroup(g);
    return g;
  }

  function layoutGroup(g) {
    var cells = g._cells;
    var rows = rowsFor(cells.map(function (c) { return c._ar || 1.5; }));
    var sig = rows.map(function (r) { return r.join(","); }).join("|");
    if (g._sig !== sig) {
      g._sig = sig;
      g.textContent = "";
      rows.forEach(function (r) {
        var row = g.appendChild(el("div", "jn-row"));
        r.forEach(function (i) { row.appendChild(cells[i]); });
      });
    }
    each(g.children, function (row, ri) {
      var s = 0;
      rows[ri].forEach(function (i) { s += cells[i]._ar || 1.5; });
      row.style.setProperty("--s", s.toFixed(4));
      row.style.setProperty("--gaps", String(rows[ri].length - 1));
      rows[ri].forEach(function (i) {
        var c = cells[i];
        c.style.setProperty("--ar", (c._ar || 1.5).toFixed(4));
        if (c._img && c._rec && !c._sized) {        // a photos.json frame: its size is known now
          c._sized = true;
          S.responsive(c._img, c._rec, sizesFor((c._ar || 1.5) / s));
        }
      });
    });
  }

  // A frame whose shape media.json doesn't know (a file added since
  // tools/build.py last ran) is laid out as 3:2 until it arrives, and its
  // group again after.
  function settleShape(cell, w, h) {
    if (!w || !h) return;
    var ar = Math.max(0.3, Math.min(4, w / h));
    if (cell._ar && Math.abs(cell._ar - ar) < 0.01) return;
    cell._ar = ar;
    var g = cell.closest(".jn-media");
    if (!g) return;
    // What the reader is looking at stays put: a group above it that grows
    // or shrinks moves the page by as much (by hand, as Safari has no
    // scroll anchoring; journal.css turns the browser's own off).
    // During a jump, the jump is aimed again at once (reaim).
    var ref = !landing && readingAt(), before = ref && ref.getBoundingClientRect().top;
    layoutGroup(g);
    if (landing) { reaim(g); return; }
    if (ref && ref !== g && !g.contains(ref) && (g.compareDocumentPosition(ref) & 4)) {
      var dy = ref.getBoundingClientRect().top - before;
      if (Math.abs(dy) >= 1) {
        var root = document.documentElement, was = root.style.scrollBehavior;
        root.style.scrollBehavior = "auto";
        window.scrollBy(0, dy);
        root.style.scrollBehavior = was;
      }
    }
  }

  // The first block of text, heading or group of media still in the window.
  function readingAt() {
    var blocks = document.querySelectorAll(".jn-entry-head, .jn-text > *");
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].getBoundingClientRect().bottom > 0) return blocks[i];
    }
    return null;
  }

  function photoCell(item, e) {
    var rec = photoBySrc[item.src] || null;
    var cell = el("figure", "jn-cell");
    cell._ar = rec ? S.aspectOf(rec) : shapeOf(item.src);
    var btn = cell.appendChild(el("button", "jn-frame jn-open bk-hover"));
    btn.type = "button";
    var img = btn.appendChild(el("img"));
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = item.caption || t("Photograph");
    var view = rec ? copy(rec) : { src: item.src };
    if (!rec && own(shapes, item.src) && cell._ar) { view.width = shapes[item.src][0]; view.height = shapes[item.src][1]; }
    if (!rec && own(cameras, item.src)) view.exif = cameras[item.src];   // the camera line when enlarged
    view.alt = img.alt;
    var at = e.photos.length;
    e.photos.push(view);
    e.buttons.push(btn);          // labelled once the entry's photographs are counted
    if (rec) {
      cell._img = img;
      cell._rec = rec;            // src set by layoutGroup, once its share of the row is known
    } else {
      S.responsive(img, view, sizesFor(1));
      var shape = function () {
        view.width = img.naturalWidth;
        view.height = img.naturalHeight;
        settleShape(cell, img.naturalWidth, img.naturalHeight);
      };
      if (img.complete && img.naturalWidth) shape(); else img.addEventListener("load", shape);
    }
    btn.addEventListener("click", function () {
      if (S.viewer) S.viewer(e.photos, at, btn);
    });
    caption(cell, item.caption);
    return cell;
  }

  function videoCell(item) {
    var cell = el("figure", "jn-cell is-video");
    cell._ar = shapeOf(item.src) || shapeOf(item.poster);
    var frame = cell.appendChild(el("div", "jn-frame"));
    var v = frame.appendChild(el("video"));
    v.controls = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.preload = "none";
    v.setAttribute("aria-label", item.caption || t("Video"));
    if (item.poster) v.setAttribute("data-poster", S.url(item.poster));
    v.src = S.url(item.src);
    v.addEventListener("loadedmetadata", function () {
      if (!cell._ar || !item.poster) settleShape(cell, v.videoWidth, v.videoHeight);
    });
    v._cell = cell;
    caption(cell, item.caption);
    return cell;
  }

  function holdCell(what, note) {
    var cell = el("figure", "jn-cell is-hold");
    cell._ar = what === "video" ? 16 / 9 : 1.5;
    var box = cell.appendChild(el("div", "jn-frame jn-hold"));
    holdLabel(box, t("Placeholder") + " · " + t(what === "video" ? "Video" : "Photo"));
    if (note) box.appendChild(el("p", "jn-hold-note", note));
    return cell;
  }

  function caption(cell, words) {
    if (words) cell.appendChild(el("figcaption", "jn-caption", words));
  }

  function copy(o) {
    var out = {};
    for (var k in o) if (own(o, k)) out[k] = o[k];
    return out;
  }

  // The posters come in only as a video nears the window, and only one
  // video plays at a time (the cover's loop included).
  function wireVideos() {
    var vids = document.querySelectorAll(".jn-entry video[data-poster]");
    function poster(v) {
      var src = v.getAttribute("data-poster");
      v.removeAttribute("data-poster");
      var im = new Image();
      im.onload = function () {
        v.poster = src;
        settleShape(v._cell, im.naturalWidth, im.naturalHeight);
      };
      im.onerror = function () { v.poster = src; };
      im.src = src;
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (en) {
          if (en.isIntersecting) { io.unobserve(en.target); poster(en.target); }
        });
      }, { rootMargin: "800px 0px" });
      each(vids, function (v) { io.observe(v); });
    } else each(vids, poster);

    document.addEventListener("play", function (ev) {
      var v = ev.target;
      if (!v || v.tagName !== "VIDEO") return;
      each(document.querySelectorAll("video"), function (o) { if (o !== v && !o.paused) o.pause(); });
    }, true);
  }

  /* --- the list of entries, grouped by date --- */

  function drawNav() {
    navEl = el("nav", "jn-nav");
    navEl.setAttribute("aria-label", t("Entries"));
    var groupDate = null, ol = null;
    list.forEach(function (e) {
      if (!ol || e.date !== groupDate) {
        groupDate = e.date;
        var day_ = navEl.appendChild(el("div", "jn-day"));
        var d = day(e.date);
        if (d) day_.appendChild(el("p", "jn-day-date", dayText(d)));
        else if (LOCAL) day_.appendChild(el("p", "jn-day-date jn-hold-text", t("Date to come")));
        ol = day_.appendChild(el("ol", "jn-day-list"));
      }
      var li = ol.appendChild(el("li"));
      var a = li.appendChild(el("a", "jn-nav-link"));
      a.href = "#" + e.id;
      a.setAttribute("data-id", e.id);
      a.appendChild(el("span", "jn-nav-no", pad(e.no)));
      S.text(a.appendChild(el("span", "jn-nav-title")), e.title);
      if (e.place) a.appendChild(el("span", "jn-nav-place", S.pin(e.place)));
      links.push(a);
    });
    navEl.addEventListener("click", function (ev) {
      var a = ev.target.closest && ev.target.closest("a[data-id]");
      if (!a) return;
      // Cmd/Ctrl-, Shift- or Alt-click: the browser's own (the entry's
      // address in a new tab or window).
      if (ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      go(a.getAttribute("data-id"), ev.detail === 0);
    });
  }

  // The list sits in the panel beside the map on a wide window, and in the
  // entry bar's drop-down below 1000px.
  function placeNav() {
    if (!navEl) return;
    var to = WIDE.matches ? navHome : barList;
    if (to && navEl.parentNode !== to) to.appendChild(navEl);
    if (WIDE.matches) closeBar();
  }

  /* --- the phone's entry bar --- */

  // The list hangs under the bar and ends inside the window (--jn-room): a
  // bar not yet stuck at the top, with too little room below it, is
  // brought up to the top first.
  var barOpen = false;
  function openBar() {
    if (!barList || barOpen) return;
    var stick = parseFloat(getComputedStyle(bar).top) || 0, r = bar.getBoundingClientRect();
    if (r.top > stick + 1 && window.innerHeight - r.bottom < 320) {
      scrollNow(window.pageYOffset + r.top - stick);
      r = bar.getBoundingClientRect();
    }
    barList.style.setProperty("--jn-room", Math.max(160, Math.floor(window.innerHeight - r.bottom - 8)) + "px");
    barOpen = true;
    barList.hidden = false;
    barBtn.setAttribute("aria-expanded", "true");
    var a = navEl && navEl.querySelector("a[aria-current]");
    if (a) keepInView(a, barList, true);
  }
  function closeBar() {
    if (!barList || !barOpen) return;
    barOpen = false;
    barList.hidden = true;
    barBtn.setAttribute("aria-expanded", "false");
  }
  function wireBar() {
    if (!bar || !barBtn) return;
    barBtn.addEventListener("click", function () { if (barOpen) closeBar(); else openBar(); });
    document.addEventListener("click", function (ev) {
      if (barOpen && !bar.contains(ev.target)) closeBar();
    });
    document.addEventListener("keydown", function (ev) {
      if (barOpen && (ev.key === "Escape" || ev.key === "Esc")) { closeBar(); barBtn.focus(); }
    });
  }

  /* --- the map --- */

  // Which stop on the route each entry belongs to: the first visit to its
  // place still ahead of the entry before it (and on its date, when both
  // have one), so an entry written on the way back through Baie-Saint-Paul
  // lights the second pass, not the first.
  function assignVisits(visits) {
    var at = 0;
    list.forEach(function (e) {
      e.visit = -1;
      if (!e.place) return;
      function match(v) { return v.name === e.place && (!e.date || !v.date || v.date === e.date); }
      var hit = -1, i;
      for (i = at; i < visits.length && hit < 0; i++) if (match(visits[i])) hit = i;
      for (i = 0; i < visits.length && hit < 0; i++) if (visits[i].name === e.place && e.date && visits[i].date === e.date) hit = i;
      for (i = 0; i < visits.length && hit < 0; i++) if (visits[i].name === e.place) hit = i;
      if (hit >= 0) { e.visit = hit; at = hit; }
    });
  }

  function startMap(path, visits) {
    var box = document.getElementById("jn-map");
    if (!box) return;
    var api = window.NLJournalMap;
    function none() {
      box.classList.add("is-empty");
      box.setAttribute("data-empty", t("Map unavailable"));
    }
    if (!api || typeof api.create !== "function") return none();
    try {
      map = api.create(box, {
        pins: pins,
        path: path,
        visits: visits,
        entries: list.map(function (e) { return { id: e.id, title: e.title, place: e.place, visit: e.visit, date: e.date }; }),
        onPick: function (id, byKey) { go(id, !!byKey); }   // from the keyboard: focus goes to the entry, as from the list
      });
    } catch (e) {
      map = null;
      if (window.console) console.warn("journal map:", e);
      return none();
    }
    if (map && map.ready && map.ready.then) {
      map.ready.then(function () { if (current) safe(function () { map.setActive(current); }); });
    }
    if (current) safe(function () { map.setActive(current); });
  }

  function resizeMap() {
    if (map && map.resize) safe(function () { map.resize(); });
  }

  // The phone's map folds away and comes back, remembered per visitor.
  function wireMapToggle() {
    if (!mapToggle || !mapBlock) return;
    var hidden = false;
    try { hidden = localStorage.getItem(MAP_KEY) === "hidden"; } catch (e) {}
    function set(h, save) {
      mapBlock.classList.toggle("is-collapsed", h);
      mapToggle.setAttribute("aria-expanded", h ? "false" : "true");
      mapToggle.textContent = t(h ? "Show map" : "Hide map");
      if (save) { try { localStorage.setItem(MAP_KEY, h ? "hidden" : "shown"); } catch (e) {} }
      if (!h) requestAnimationFrame(resizeMap);
    }
    set(hidden, false);
    mapToggle.addEventListener("click", function () {
      set(!mapBlock.classList.contains("is-collapsed"), true);
    });
  }

  // "Quebec City · 46.8100° N · 71.2100° W", or in Chinese "魁北克市 ·
  // 北纬 46.8100° · 西经 71.2100°": the pin's coordinates, as the globe's
  // console reads them, the Chinese words in spans of their own so the
  // digits keep the mono. The coordinates always show in full; a name too
  // long for the panel (the Hautes-Gorges park) is the part cut short.
  function readout(e) {
    if (!readEl) return;
    readEl.textContent = "";
    if (!e) return;
    if (!e.place) { readEl.appendChild(el("span", null, t("Not on the map"))); return; }
    var p = pinByName[e.place];
    var name = readEl.appendChild(el("b", null, S.pin(e.place)));
    name.title = name.textContent;
    if (!p || isNaN(p.lat) || isNaN(p.lng)) return;
    var at = readEl.appendChild(el("span", "jn-readout-at"));
    var la = Math.abs(p.lat).toFixed(4) + "°", lo = Math.abs(p.lng).toFixed(4) + "°";
    if (ZH) {
      at.appendChild(document.createTextNode(" · "));
      [[p.lat >= 0 ? "北纬" : "南纬", " " + la + " · "], [p.lng >= 0 ? "东经" : "西经", " " + lo]].forEach(function (part) {
        var w = at.appendChild(el("span", null, part[0]));
        w.lang = "zh-Hans";
        at.appendChild(document.createTextNode(part[1]));
      });
    } else {
      at.appendChild(document.createTextNode(" · " + la + " " + (p.lat >= 0 ? "N" : "S") +
        " · " + lo + " " + (p.lng >= 0 ? "E" : "W")));
    }
  }

  /* ---------- reading: the entry being read, jumps, the #address -------- */

  function activate(id) {
    if (id === current) return;
    current = id;
    var e = byId[id];
    links.forEach(function (a) {
      if (a.getAttribute("data-id") === id) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    });
    list.forEach(function (x) { x.el.classList.toggle("is-current", x.id === id); });
    var a = navEl && navEl.querySelector("a[aria-current]");
    if (a && WIDE.matches) keepInView(a, navHome, false);
    if (barBtn && e) {
      barBtn.querySelector(".jn-bar-no").textContent = number(e);
      S.text(barBtn.querySelector(".jn-bar-title"), e.title);
    }
    readout(e);
    if (map && map.setActive) safe(function () { map.setActive(id); });
  }

  // Scrolls the list (never the page) so its lit item is in view.
  function keepInView(a, box, now) {
    if (!box || !box.clientHeight) return;
    var br = box.getBoundingClientRect(), ar = a.getBoundingClientRect();
    if (ar.top >= br.top + 8 && ar.bottom <= br.bottom - 8) return;
    var top = box.scrollTop + ar.top - br.top - box.clientHeight / 3;
    if (box.scrollTo && !now && !CALM.matches) box.scrollTo({ top: top, behavior: "smooth" });
    else box.scrollTop = top;
  }

  // The address follows the entry being read (#rain), without a history
  // entry and without a jump; back at the cover it has none.
  function setHash(id) {
    var want = id ? "#" + id : "";
    if (location.hash === want || body.classList.contains("lb-open")) return;
    try { history.replaceState(history.state, "", location.pathname + location.search + want); } catch (e) {}
  }

  var lastSmooth = false;
  function jump(node, smooth) {
    lastSmooth = smooth;
    var root = document.documentElement, was = root.style.scrollBehavior;
    if (!smooth) root.style.scrollBehavior = "auto";   // site.css scrolls smoothly by default
    node.scrollIntoView(smooth ? { behavior: "smooth", block: "start" } : { block: "start" });
    if (!smooth) root.style.scrollBehavior = was;
  }
  function scrollNow(y) {
    var root = document.documentElement, was = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, Math.max(0, y));
    root.style.scrollBehavior = was;
  }

  // A group of media above the entry being jumped to changed shape on the
  // way (a file media.json doesn't know yet): the entry has moved, so the
  // jump is aimed at it again straight away rather than overshooting.
  var reaimed = false;
  function reaim(g) {
    var e = pinned && byId[pinned];
    if (!e || reaimed || !(g.compareDocumentPosition(e.el) & 4)) return;   // only a group above it
    reaimed = true;
    requestAnimationFrame(function () {
      reaimed = false;
      if (landing && pinned === e.id) { land(600); jump(e.el, lastSmooth); }
    });
  }

  // To an entry, from the list or the map: lit at once, and held lit
  // through the scroll and after it until the reader scrolls on.
  function go(id, byKeyboard) {
    var e = byId[id];
    if (!e) return;
    closeBar();
    pinned = id;
    activate(id);
    setHash(id);
    land(600);
    jump(e.el, !CALM.matches);
    if (byKeyboard) { try { e.el.focus({ preventScroll: true }); } catch (err) {} }
  }

  // A jump's own scroll (smooth or not) doesn't count as the reader
  // scrolling on: until it has settled, scrolling keeps the entry lit;
  // after it, any scroll (the scrollbar included) lets it go.
  var landing = false, landTimer = 0;
  function land(ms) {
    landing = true;
    clearTimeout(landTimer);
    landTimer = setTimeout(landed, ms);
  }
  // The jump is over. If photographs above changed shape on the way (a file
  // of the journal's own, whose shape is known only once it arrives), the
  // entry is no longer where the jump was aimed: glide the rest.
  function landed() {
    clearTimeout(landTimer);
    landing = false;
    var e = pinned && byId[pinned];
    if (!e) return;
    var want = parseFloat(getComputedStyle(e.el).scrollMarginTop) || 0;
    var top = e.el.getBoundingClientRect().top, doc = document.documentElement;
    var atEnd = window.innerHeight + window.pageYOffset >= doc.scrollHeight - 2;
    if (Math.abs(top - want) > 2 && !(atEnd && top > want)) {
      land(600);
      jump(e.el, !CALM.matches);
    }
  }

  var queued = false;
  function spy() {
    queued = false;
    if (!list.length || body.classList.contains("lb-open")) return;
    if (pinned && byId[pinned]) { activate(pinned); return; }
    var line = window.innerHeight * READ_LINE, pick = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].el.getBoundingClientRect().top <= line) pick = list[i]; else break;
    }
    var doc = document.documentElement;
    if (pick && window.innerHeight + window.pageYOffset >= doc.scrollHeight - 2) pick = list[list.length - 1];
    activate((pick || list[0]).id);
    setHash(pick ? pick.id : null);
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(spy); } }

  function wireSpy() {
    window.addEventListener("scroll", function () {
      if (landing) land(180);
      else if (pinned) pinned = null;
      queue();
      rememberSoon();
    }, { passive: true });
    window.addEventListener("scrollend", function () { if (landing) landed(); });
    window.addEventListener("resize", queue);
    ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (type) {
      window.addEventListener(type, function (ev) {
        if ((type === "mousedown" || type === "touchstart") && ev.target.closest &&
            ev.target.closest(".jn-nav, .jn-map, .jn-bar")) return;   // a pick pins instead
        if (pinned) { pinned = null; queue(); }
      }, { passive: true });
    });
    window.addEventListener("hashchange", function () {
      var id = hashId();
      if (id) go(id, false);
    });
  }

  function hashId() {
    var h = "";
    try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
    return own(byId, h) ? h : null;
  }

  // Where the reader is, kept in this page's history entry for a reload or
  // a return by Back or Forward (the browser's own restoring is off, at
  // the top): the entry in the address and how far into it, or above the
  // entries the plain scroll. Written a moment after scrolling stops (a
  // reload takes the entry as it was when it began) and as the page is
  // left; never while the photo viewer has its own history entry.
  var rememberTimer = 0;
  function rememberSoon() { clearTimeout(rememberTimer); rememberTimer = setTimeout(remember, 700); }
  function remember() {
    clearTimeout(rememberTimer);
    if (!list.length || body.classList.contains("lb-open")) return;
    var id = hashId(), old = history.state, st = old && typeof old === "object" ? copy(old) : {};
    st.jn = id ? { at: id, dy: Math.round(-byId[id].el.getBoundingClientRect().top) }
               : { at: null, y: Math.round(window.pageYOffset) };
    try { history.replaceState(st, "", location.href); } catch (e) {}
  }
  window.addEventListener("pagehide", remember);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") remember(); });

  // A reload or Back/Forward to the place remember() kept: there again,
  // and again once the type has come in if the reader hasn't moved.
  function resume() {
    var st = history.state && history.state.jn, id = hashId();
    var nav = window.performance && performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null;
    if (!st || !nav || (nav.type !== "reload" && nav.type !== "back_forward")) return false;
    if ((st.at || null) !== id || !isFinite(id ? st.dy : st.y)) return false;
    var touched = false;
    function put() {
      scrollNow(id ? byId[id].el.getBoundingClientRect().top + window.pageYOffset + st.dy : st.y);
      spy();
    }
    ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (type) {
      window.addEventListener(type, function () { touched = true; }, { passive: true, once: true });
    });
    put();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!touched) put(); });
    return true;
  }

  // Opened at an entry's address: straight there, no glide, and there
  // again once the type has come in if the reader hasn't moved.
  function arrive() {
    if (resume()) return;
    var id = hashId();
    if (!id) { spy(); return; }
    pinned = id;
    activate(id);
    land(400);
    jump(byId[id].el, false);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        if (pinned === id) { land(400); jump(byId[id].el, false); }
      });
    }
  }
})();
