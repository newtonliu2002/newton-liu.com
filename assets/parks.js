/* ==========================================================================
   newton-liu.com — the National Park Ranking (national-park-ranking.html),
   a Projects entry (Newton, 2026-11-06), made like the eBird Site Ranking.

   Each park he has been to gets three scores, 1–5 each: scenery,
   activities, wildlife. Their sum (3–15) is the park's tier. Inside a tier
   the order comes from "which did you like more?" questions: a newly rated
   park is placed by halving the tier (as Beli does), so a tier of 8 takes
   at most 3 questions.

   The parks are data/national-parks.json. The ratings live in this browser
   only (localStorage "park_ranking_v1"), like the Site Ranking's; "Save a
   copy" downloads them as a file and "Restore a copy" reads one back, which
   is also how they move to another computer.

   Stored: { v: 1, rated: { id: { s, a, w, date ("YYYY-MM" or ""), notes } },
             order: { "15": [id, …best first], … "3": [] } }
   ========================================================================== */

(function () {
  "use strict";

  var root = document.querySelector(".parks");
  if (!root) return;
  var S = window.NLSite;
  var ZH = !!(S && S.lang && S.lang() === "zh");
  var KEY = "park_ranking_v1";
  var MIN = 3, MAX = 15;

  var AXES = [
    { k: "s", en: "Scenery", zh: "风景", anchors: {
      en: ["Plain: little that stands out", "Pleasant, but ordinary", "Good views and a few memorable spots",
           "Striking: many places worth stopping for", "World-class: unforgettable landscapes"],
      zh: ["平淡，没有突出的景色", "宜人，但普通", "风景不错，有几处难忘的地方", "令人惊叹，处处值得停留", "世界级，令人难忘的风景"] } },
    { k: "a", en: "Activities", zh: "活动", anchors: {
      en: ["Little to do beyond a short look", "A few short walks or drives", "A good day or two of hikes and things to do",
           "Plenty: varied trails, camping, water, days of it", "Endless: backcountry and every kind of adventure"],
      zh: ["除了看一眼没什么可做", "几条短步道或观景路线", "足够一两天的徒步和活动", "内容丰富：多样的步道、露营、水上活动，可以玩好几天", "无穷无尽：荒野深处和各种探险"] } },
    { k: "w", en: "Wildlife", zh: "野生动物", anchors: {
      en: ["Hardly anything seen", "Common animals and birds", "Some good sightings",
           "Rich: notable animals or lots of birds", "Exceptional: the wildlife you came for"],
      zh: ["几乎没看到动物", "常见的动物和鸟", "有一些不错的目击", "丰富：有特别的动物或大量的鸟", "非凡：见到了专程为之而来的野生动物"] } }
  ];

  var L = ZH ? {
    loading: "加载中……", failed: "公园列表加载失败。", ranked: "已排名", unrated: "待评分",
    count: function (n, all) { return "已评 " + n + " / " + all; },
    noneRanked: "还没有评过分的公园。去「待评分」里选一个你去过的公园。",
    allRated: "所有公园都评过了。", search: "搜索公园", rate: "评分", total: "总分",
    visited: "到访时间", notes: "备注", save: "保存", cancel: "取消", optional: "（选填）",
    which: "你更喜欢哪一个？", close: "差不多，分不出", skip: "跳过，放在这一档最后",
    step: function (i) { return "第 " + i + " 题"; }, tier: "档", of: function (r, n) { return "第 " + r + " 名，共 " + n + " 个"; },
    rerate: "重新评分", recompare: "重新比较", remove: "删除评分", back: "← 返回",
    removeAsk: function (n) { return "删除" + n + "的评分？"; },
    saved: "已保存副本。", restored: "已恢复。", badFile: "这个文件读不了。",
    replaceAsk: "用这个文件替换本浏览器里的所有评分？"
  } : {
    loading: "Loading…", failed: "The list of parks didn't load.", ranked: "Ranked", unrated: "To be rated",
    count: function (n, all) { return n + " of " + all + " rated"; },
    noneRanked: "No parks rated yet. Pick one you've been to under To be rated.",
    allRated: "Every park has been rated.", search: "Find a park", rate: "Rate", total: "Total",
    visited: "Visited", notes: "Notes", save: "Save rating", cancel: "Cancel", optional: " (optional)",
    which: "Which did you like more?", close: "Too close to call", skip: "Skip: put it last in this tier",
    step: function (i) { return "Question " + i; }, tier: "Tier", of: function (r, n) { return "#" + r + " of " + n; },
    rerate: "Rate again", recompare: "Compare again", remove: "Remove rating", back: "← Back",
    removeAsk: function (n) { return "Remove the rating for " + n + "?"; },
    saved: "Copy saved.", restored: "Restored.", badFile: "That file couldn't be read.",
    replaceAsk: "Replace every rating in this browser with the ones in this file?"
  };

  var view = root.querySelector(".pk-view");
  var countEl = root.querySelector(".pk-count");
  var tabs = root.querySelectorAll(".pk-tabs button");
  var fileIn = root.querySelector('.pk-backup input[type="file"]');
  var parks = [], byId = {}, store = blank(), state = { view: "ranked" }, query = "";

  // ---- helpers ------------------------------------------------------------

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function button(cls, text, fn) {
    var b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function nameOf(p) { return ZH ? p.name + "国家公园" : p.name; }
  function totalOf(r) { return (r.s || 0) + (r.a || 0) + (r.w || 0); }

  function blank() {
    var order = {};
    for (var t = MIN; t <= MAX; t++) order[t] = [];
    return { v: 1, rated: {}, order: order };
  }

  // A stored copy, made whole: every tier list there, each rated park in the
  // tier its scores say (once), and nothing listed that isn't rated.
  function clean(raw) {
    var st = blank();
    if (!raw || typeof raw !== "object" || typeof raw.rated !== "object") return st;
    Object.keys(raw.rated).forEach(function (id) {
      var r = raw.rated[id];
      if (!r || !byIdOk(id)) return;
      var ok = AXES.every(function (ax) { return r[ax.k] >= 1 && r[ax.k] <= 5; });
      if (!ok) return;
      st.rated[id] = { s: +r.s, a: +r.a, w: +r.w, date: typeof r.date === "string" ? r.date : "",
                       notes: typeof r.notes === "string" ? r.notes : "" };
    });
    var placed = {};
    for (var t = MAX; t >= MIN; t--) {
      ((raw.order && raw.order[t]) || []).forEach(function (id) {
        if (st.rated[id] && !placed[id] && totalOf(st.rated[id]) === t) { st.order[t].push(id); placed[id] = 1; }
      });
    }
    Object.keys(st.rated).forEach(function (id) {
      if (!placed[id]) st.order[totalOf(st.rated[id])].push(id);
    });
    return st;
  }
  function byIdOk(id) { return !parks.length || !!byId[id]; }

  function load() {
    try { store = clean(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { store = blank(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
  }

  function unplace(id) {
    for (var t = MIN; t <= MAX; t++) {
      var i = store.order[t].indexOf(id);
      if (i >= 0) store.order[t].splice(i, 1);
    }
  }

  // Every rated park, best first, with its overall rank.
  function rankedList() {
    var out = [];
    for (var t = MAX; t >= MIN; t--) store.order[t].forEach(function (id) { out.push(id); });
    return out;
  }

  // ---- the rail ---------------------------------------------------------------

  function rail() {
    countEl.textContent = L.count(Object.keys(store.rated).length, parks.length);
    var on = state.view === "unrated" ? "unrated" : "ranked";
    tabs.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === on)); });
  }

  function go(next) {
    state = next;
    draw();
    var top = root.getBoundingClientRect().top + window.scrollY - 80;
    if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
  }

  // ---- views ------------------------------------------------------------------

  function draw() {
    rail();
    view.textContent = "";
    if (state.view === "rate") return drawRate();
    if (state.view === "compare") return drawCompare();
    if (state.view === "detail") return drawDetail();
    if (state.view === "unrated") return drawUnrated();
    drawRanked();
  }

  function scoreLine(r) {
    var line = el("span", "pk-scores");
    AXES.forEach(function (ax) {
      var s = el("span", "pk-score");
      s.appendChild(el("span", "pk-score-k", ZH ? ax.zh : ax.en));
      s.appendChild(el("span", "pk-score-v", String(r[ax.k])));
      line.appendChild(s);
    });
    return line;
  }

  function drawRanked() {
    var ids = rankedList();
    if (!ids.length) { view.appendChild(el("p", "pk-note", L.noneRanked)); return; }
    var rank = 0;
    for (var t = MAX; t >= MIN; t--) {
      if (!store.order[t].length) continue;
      var sec = el("section", "pk-tier");
      var h = el("h2", "pk-tier-head");
      h.appendChild(el("span", "pk-tier-n", String(t)));
      h.appendChild(el("span", "pk-tier-of", "/ " + MAX));
      sec.appendChild(h);
      var ol = el("ol", "pk-list");
      store.order[t].forEach(function (id) {
        rank++;
        var p = byId[id], r = store.rated[id];
        var li = el("li");
        var b = button("pk-row", null, function () { go({ view: "detail", id: id }); });
        b.appendChild(el("span", "pk-rank", String(rank)));
        var nm = el("span", "pk-name");
        nm.appendChild(el("span", "pk-park", nameOf(p)));
        nm.appendChild(el("span", "pk-state", p.state));
        b.appendChild(nm);
        b.appendChild(scoreLine(r));
        li.appendChild(b);
        ol.appendChild(li);
      });
      sec.appendChild(ol);
      view.appendChild(sec);
    }
  }

  function drawUnrated() {
    var left = parks.filter(function (p) { return !store.rated[p.id]; });
    if (!left.length) { view.appendChild(el("p", "pk-note", L.allRated)); return; }
    var box = el("input", "pk-search");
    box.type = "search";
    box.placeholder = L.search;
    box.setAttribute("aria-label", L.search);
    box.value = query;
    view.appendChild(box);
    var ol = el("ul", "pk-list pk-unrated");
    view.appendChild(ol);
    function fill() {
      ol.textContent = "";
      var q = query.trim().toLowerCase();
      left.forEach(function (p) {
        if (q && (p.name + " " + p.state).toLowerCase().indexOf(q) < 0) return;
        var li = el("li");
        var b = button("pk-row", null, function () { go({ view: "rate", id: p.id }); });
        var nm = el("span", "pk-name");
        nm.appendChild(el("span", "pk-park", nameOf(p)));
        nm.appendChild(el("span", "pk-state", p.state));
        b.appendChild(nm);
        b.appendChild(el("span", "pk-go", L.rate + " →"));
        li.appendChild(b);
        ol.appendChild(li);
      });
    }
    box.addEventListener("input", function () { query = box.value; fill(); });
    fill();
  }

  function head(p, extra) {
    var h = el("div", "pk-head");
    h.appendChild(button("pk-back", L.back, function () { go({ view: store.rated[p.id] ? "detail" : "unrated", id: p.id }); }));
    h.appendChild(el("h2", "pk-title", nameOf(p)));
    h.appendChild(el("p", "pk-state", p.state));
    if (extra) h.appendChild(extra);
    return h;
  }

  function drawRate() {
    var p = byId[state.id], old = store.rated[p.id];
    var r = old ? { s: old.s, a: old.a, w: old.w } : { s: 0, a: 0, w: 0 };
    var tot = el("p", "pk-total");
    view.appendChild(head(p, tot));
    var saveB;
    function sync() {
      var done = r.s && r.a && r.w;
      tot.textContent = L.total + "  " + (done ? totalOf(r) : "–") + " / " + MAX;
      if (saveB) saveB.disabled = !done;
    }
    AXES.forEach(function (ax) {
      var f = el("fieldset", "pk-axis");
      f.appendChild(el("legend", null, ZH ? ax.zh : ax.en));
      var row = el("div", "pk-pick");
      var anchors = el("ol", "pk-anchors");
      var btns = [];
      for (var v = 1; v <= 5; v++) (function (v) {
        var b = button(null, String(v), function () {
          r[ax.k] = v;
          btns.forEach(function (x, i) { x.setAttribute("aria-pressed", String(i + 1 === v)); });
          [].forEach.call(anchors.children, function (x, i) { x.classList.toggle("is-on", i + 1 === v); });
          sync();
        });
        b.setAttribute("aria-pressed", String(r[ax.k] === v));
        b.setAttribute("aria-label", (ZH ? ax.zh : ax.en) + " " + v + ": " + ax.anchors[ZH ? "zh" : "en"][v - 1]);
        btns.push(b);
        row.appendChild(b);
      })(v);
      ax.anchors[ZH ? "zh" : "en"].forEach(function (txt, i) {
        var li = el("li", r[ax.k] === i + 1 ? "is-on" : null);
        li.appendChild(el("span", "pk-anchor-n", String(i + 1)));
        li.appendChild(document.createTextNode(txt));
        anchors.appendChild(li);
      });
      f.appendChild(row);
      f.appendChild(anchors);
      view.appendChild(f);
    });

    var more = el("div", "pk-more");
    var dl = el("label", "pk-field");
    dl.appendChild(el("span", null, L.visited + L.optional));
    var date = el("input");
    date.type = "month";
    date.value = old ? old.date : "";
    dl.appendChild(date);
    var nl = el("label", "pk-field");
    nl.appendChild(el("span", null, L.notes + L.optional));
    var notes = el("textarea");
    notes.rows = 3;
    notes.value = old ? old.notes : "";
    nl.appendChild(notes);
    more.appendChild(dl);
    more.appendChild(nl);
    view.appendChild(more);

    var acts = el("p", "pk-actions");
    saveB = button("pk-primary", L.save, function () {
      var was = old ? totalOf(old) : null;
      store.rated[p.id] = { s: r.s, a: r.a, w: r.w, date: /^\d{4}-\d\d$/.test(date.value) ? date.value : "", notes: notes.value.trim() };
      var t = totalOf(r);
      if (was === t) { save(); go({ view: "detail", id: p.id }); return; }
      unplace(p.id);
      startCompare(p.id);
    });
    acts.appendChild(saveB);
    acts.appendChild(button("pk-quiet", L.cancel, function () { go({ view: old ? "detail" : "unrated", id: p.id }); }));
    view.appendChild(acts);
    sync();
  }

  // Place a park in its tier by halving: lo..hi is the stretch it can still go in.
  function startCompare(id) {
    unplace(id);
    var t = totalOf(store.rated[id]);
    var others = store.order[t].length;
    if (!others) { store.order[t].push(id); save(); go({ view: "detail", id: id }); return; }
    go({ view: "compare", id: id, tier: t, lo: 0, hi: others, n: 1 });
  }
  function place(at) {
    store.order[state.tier].splice(at, 0, state.id);
    save();
    go({ view: "detail", id: state.id });
  }

  function drawCompare() {
    var list = store.order[state.tier];
    if (state.lo >= state.hi) { place(state.lo); return; }
    var mid = (state.lo + state.hi) >> 1;
    var a = byId[state.id], b = byId[list[mid]];
    var h = el("div", "pk-head");
    h.appendChild(el("p", "pk-kicker", L.tier + " " + state.tier + " · " + L.step(state.n)));
    h.appendChild(el("h2", "pk-title", L.which));
    view.appendChild(h);
    var pair = el("div", "pk-pair");
    [[a, true], [b, false]].forEach(function (x) {
      var p = x[0];
      var c = button("pk-card", null, function () {
        var next = { view: "compare", id: state.id, tier: state.tier, n: state.n + 1, lo: state.lo, hi: state.hi };
        if (x[1]) next.hi = mid; else next.lo = mid + 1;
        state = next;
        draw();
      });
      c.appendChild(el("span", "pk-park", nameOf(p)));
      c.appendChild(el("span", "pk-state", p.state));
      c.appendChild(scoreLine(store.rated[p.id]));
      pair.appendChild(c);
    });
    view.appendChild(pair);
    var acts = el("p", "pk-actions");
    acts.appendChild(button("pk-quiet", L.close, function () { place(mid); }));
    acts.appendChild(button("pk-quiet", L.skip, function () { place(list.length); }));
    view.appendChild(acts);
  }

  function drawDetail() {
    var p = byId[state.id], r = store.rated[p.id];
    if (!r) { go({ view: "ranked" }); return; }
    var all = rankedList();
    view.appendChild(head(p));
    var box = el("div", "pk-detail");
    var big = el("p", "pk-big");
    big.appendChild(el("span", "pk-big-n", String(totalOf(r))));
    big.appendChild(el("span", "pk-big-of", "/ " + MAX));
    big.appendChild(el("span", "pk-big-rank", L.of(all.indexOf(p.id) + 1, all.length)));
    box.appendChild(big);
    AXES.forEach(function (ax) {
      var row = el("p", "pk-axis-line");
      row.appendChild(el("span", "pk-score-k", ZH ? ax.zh : ax.en));
      row.appendChild(el("span", "pk-score-v", r[ax.k] + " / 5"));
      row.appendChild(el("span", "pk-axis-txt", ax.anchors[ZH ? "zh" : "en"][r[ax.k] - 1]));
      box.appendChild(row);
    });
    if (r.date) {
      var m = r.date.split("-");
      var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      var d = el("p", "pk-axis-line");
      d.appendChild(el("span", "pk-score-k", L.visited));
      d.appendChild(el("span", "pk-axis-txt", ZH ? m[0] + "年" + (+m[1]) + "月" : MON[+m[1] - 1] + " " + m[0]));
      box.appendChild(d);
    }
    if (r.notes) box.appendChild(el("p", "pk-notes", r.notes));
    view.appendChild(box);
    var acts = el("p", "pk-actions");
    acts.appendChild(button("pk-primary", L.rerate, function () { go({ view: "rate", id: p.id }); }));
    if (store.order[totalOf(r)].length > 1) acts.appendChild(button("pk-quiet", L.recompare, function () { startCompare(p.id); }));
    acts.appendChild(button("pk-quiet", L.remove, function () {
      if (!window.confirm(L.removeAsk(nameOf(p)))) return;
      unplace(p.id);
      delete store.rated[p.id];
      save();
      go({ view: "ranked" });
    }));
    view.appendChild(acts);
  }

  // ---- the rail's buttons -------------------------------------------------------

  tabs.forEach(function (b) {
    b.addEventListener("click", function () { go({ view: b.getAttribute("data-view") }); });
  });

  function flash(msg) {
    var n = root.querySelector(".pk-flash") || el("p", "pk-flash");
    n.textContent = msg;
    root.querySelector(".pk-backup").appendChild(n);
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { n.textContent = ""; }, 4000);
  }

  root.querySelector('[data-act="export"]').addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(store, null, 1)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "national-park-ranking-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    flash(L.saved);
  });
  root.querySelector('[data-act="import"]').addEventListener("click", function () { fileIn.click(); });
  fileIn.addEventListener("change", function () {
    var f = fileIn.files && fileIn.files[0];
    fileIn.value = "";
    if (!f) return;
    f.text().then(function (txt) {
      var raw = JSON.parse(txt);
      if (!raw || typeof raw.rated !== "object") throw new Error("bad");
      if (!window.confirm(L.replaceAsk)) return;
      store = clean(raw);
      save();
      go({ view: "ranked" });
      flash(L.restored);
    }).catch(function () { flash(L.badFile); });
  });

  // ---- start ------------------------------------------------------------------

  if (ZH) {
    root.querySelector(".about-title").textContent = "国家公园排名";
    root.querySelector(".about-name").textContent = "项目 · Newton Liu";
    tabs[0].textContent = L.ranked;
    tabs[1].textContent = L.unrated;
    root.querySelector('[data-act="export"]').textContent = "保存副本";
    root.querySelector('[data-act="import"]').textContent = "恢复副本";
  }
  view.textContent = "";
  view.appendChild(el("p", "pk-empty", L.loading));

  fetch("data/national-parks.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      parks = (d.parks || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      parks.forEach(function (p) { byId[p.id] = p; });
      load();
      state = { view: Object.keys(store.rated).length ? "ranked" : "unrated" };
      draw();
    })
    .catch(function () {
      view.textContent = "";
      view.appendChild(el("p", "pk-empty", L.failed));
    });
})();
