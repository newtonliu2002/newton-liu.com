/* ==========================================================================
   newton-liu.com — the National Park Ranking (national-park-ranking.html),
   a Projects entry (Newton, 2026-11-06), made like the eBird Site Ranking.

   Rating a park (his steps, 2026-11-06, "like how Beli works"):
   1. "Did you like it?" Yes / Mid / No puts it in one of three groups.
   2. "Which did you like more?" places it inside its group by halving the
      group (Beli-style), so a group of 8 takes at most 3 questions.
   3. Scenery, activities, wildlife, 1–5 each, weighted 40 / 35 / 25 %.
      This step can be skipped.
   So each park has two numbers: a score out of 10 from the group and its
   place in it (Yes 10–6.7, Mid 6.6–3.4, No 3.3–0, in even steps down the
   group, as Beli does), and a weighted category score out of 5 (none if
   skipped). Lists are in the order of the first.

   Newton and his friends (2026-11-06: "both me and my friends could rate,
   and we could see each other's ratings … but this stays between me and my
   friends"; then "when people land, it shows 'what is your name' and then
   all the parks are logged under that person's name"). Everything lives in
   the "park-ranking" Worker (~/Code/park-ranking, D1), one ranking per person:
   - Whoever opens the page is asked "What's your name?". A new name starts
     a new ranking; a name that's already there asks "Is that you?" and, on
     yes, this device edits that ranking too (each device keeps its own
     token in "park_friend_v1"). "Not you?" goes back to the question.
   - Typing "Newton" asks for the Personal password (the same token as
     personal-gate.js, "personal_token_v1"). Signed in, he can also remove
     a person.
   Everyone sees everyone's ratings: the Friends tab lists each friend
   (open one for their ranking), and a park's page shows every friend's
   scores and rank for it, or that they haven't rated it (his ask: "after i
   rate each park i should also be able to see friend's rating … rate &
   rank for all of them"). The old Together tab (group averages) is gone:
   "we dont need this".
   Each save sends one person's whole ranking with the version it was based
   on; if another device saved first, the page takes that version and says
   so. localStorage "park_ranking_v1" keeps a copy of one's own ranking (and
   unsent changes) for when the Worker can't be reached.

   A ranking: { v: 2, rated: { id: { like: "yes"|"mid"|"no", s, a, w (1–5, or all 0
                when skipped), date ("YYYY-MM" or ""), notes } },
                order: { yes: [id, …best first], mid: [], no: [] } }
   (v1, from the first day: three scores whose sum was a tier, order by
   tier; clean() turns it into v2.)
   ========================================================================== */

(function () {
  "use strict";

  var root = document.querySelector(".parks");
  if (!root) return;
  var S = window.NLSite;
  var ZH = !!(S && S.lang && S.lang() === "zh");
  var KEY = "park_ranking_v1";
  var FRIEND = "park_friend_v1";
  var TOKEN = "personal_token_v1";
  var LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]api=local\b/.test(location.search);
  var SYNC = LOCAL ? "http://127.0.0.1:8789" : "https://park-ranking.shoot-planner-worker.workers.dev";
  var PERSONAL = LOCAL ? "http://127.0.0.1:8788" : "https://personal.shoot-planner-worker.workers.dev";
  var OWNER = "newton";
  var GROUPS = [
    { k: "yes", hi: 10, lo: 6.7 },
    { k: "mid", hi: 6.6, lo: 3.4 },
    { k: "no", hi: 3.3, lo: 0 }
  ];
  var WEIGHT = { s: 0.40, a: 0.35, w: 0.25 };

  // No 1–5 descriptions under the scores: he had them removed (2026-11-06).
  var AXES = [
    { k: "s", en: "Scenery", zh: "风景" },
    { k: "a", en: "Activities", zh: "活动" },
    { k: "w", en: "Wildlife", zh: "野生动物" }
  ];

  var L = ZH ? {
    loading: "加载中……", failed: "公园列表加载失败。", ranked: "我的", unrated: "待评分", friendsTab: "朋友",
    count: function (n, all) { return "已评 " + n + " / " + all; },
    noneRanked: "你还没有评过分的公园。去「待评分」里选一个你去过的公园。",
    allRated: "所有公园都评过了。", search: "搜索公园", rate: "评分",
    visited: "到访时间", notes: "备注", save: "保存", cancel: "取消", optional: "（选填）",
    didYouLike: function (n) { return "你喜欢" + n + "吗？"; },
    like: { yes: "喜欢", mid: "一般", no: "不喜欢" }, group: { yes: "喜欢", mid: "一般", no: "不喜欢" },
    which: "你更喜欢哪一个？", close: "差不多，分不出",
    step: function (i) { return "第 " + i + " 题"; }, of: function (r, n) { return "第 " + r + " 名，共 " + n + " 个"; },
    scoresTitle: "分项打分", scoresNote: "每项满分 5 分。加权：风景 40%，活动 35%，野生动物 25%。可以跳过。",
    skipScores: "跳过", weighted: "分项得分", skipped: "没有打分",
    legend: "前一个数字由两两比较得出，满分 10；后一个是分项加权得分，满分 5。",
    editScores: "修改分项打分", addScores: "补上分项打分",
    rerate: "重新评分", recompare: "重新比较", remove: "删除评分", back: "← 返回",
    removeAsk: function (n) { return "删除你对" + n + "的评分？"; },
    saved: "已保存副本。", restored: "已恢复。", badFile: "这个文件读不了。",
    replaceAsk: "用这个文件替换你所有的评分？",
    signIn: "Newton 登录", password: "密码", enter: "进入",
    wrong: "密码不对。", many: "尝试次数太多，请一小时后再试。", offline: "暂时连不上服务器。",
    signedOut: "登录已失效，请重新登录。", newer: "另一台设备刚刚改过，已显示最新版本。",
    unsaved: "没能同步到服务器，已先保存在本浏览器。",
    joinTitle: "你叫什么名字？", joinNote: "你评的每个公园都会记在这个名字下，大家都能看到。换一台设备时，输入同一个名字就行。",
    joinGo: "开始", name: "名字",
    isThatYou: function (n, k) { return n + " 已经在这里了（评了 " + k + " 个公园）。是你吗？"; },
    yesMe: "是我", notMe: "不是，换个名字",
    ownerAsk: "这是 Newton 的名字。Newton，请输入密码：",
    full: "人数已满。", friends: "朋友", you: "你", rankingOf: function (n) { return n + "的排名"; },
    nothingYet: function (n) { return n + "还没有评分。"; },
    youAre: function (n) { return "你是 " + n; }, notYou: "不是你？",
    removePerson: function (n) { return "把" + n + "移出"; },
    removePersonAsk: function (n) { return "把" + n + "和他们的所有评分移出？"; },
    noFriends: "还没有朋友加入。把这个页面发给他们，输入名字就能开始评分。",
    nRated: function (n) { return "评了 " + n + " 个公园"; },
    notRated: "还没评", friendsOn: "朋友的评分", othersOn: "其他人的评分",
    where: { us: "美国", ca: "加拿大", both: "全部" }, whereLabel: "国家", noneHere: "这里还没有评过的公园。"
  } : {
    loading: "Loading…", failed: "The list of parks didn't load.", ranked: "Mine", unrated: "To be rated", friendsTab: "Friends",
    count: function (n, all) { return n + " of " + all + " rated"; },
    noneRanked: "You haven't rated any parks yet. Pick one you've been to under To be rated.",
    allRated: "Every park has been rated.", search: "Find a park", rate: "Rate",
    visited: "Visited", notes: "Notes", save: "Save", cancel: "Cancel", optional: " (optional)",
    didYouLike: function (n) { return "Did you like " + n + "?"; },
    like: { yes: "Yes", mid: "Mid", no: "No" }, group: { yes: "Liked it", mid: "Mid", no: "Didn't like it" },
    which: "Which did you like more?", close: "Too close to call",
    step: function (i) { return "Question " + i; }, of: function (r, n) { return "#" + r + " of " + n; },
    scoresTitle: "Score by category", scoresNote: "Each out of 5. Weighted: scenery 40%, activities 35%, wildlife 25%. You can skip this.",
    skipScores: "Skip", weighted: "Category score", skipped: "Not scored",
    legend: "First number: out of 10, from your comparisons. Second: the weighted category score, out of 5.",
    editScores: "Edit category scores", addScores: "Add category scores",
    rerate: "Rate again", recompare: "Compare again", remove: "Remove rating", back: "← Back",
    removeAsk: function (n) { return "Remove your rating for " + n + "?"; },
    saved: "Copy saved.", restored: "Restored.", badFile: "That file couldn't be read.",
    replaceAsk: "Replace every one of your ratings with the ones in this file?",
    signIn: "Newton: sign in", password: "Password", enter: "Enter",
    wrong: "That password isn't right.", many: "Too many tries. Try again in an hour.", offline: "Can't reach the server just now.",
    signedOut: "Signed out. Sign in again to edit.", newer: "Changed on another device: showing the latest.",
    unsaved: "Couldn't reach the server; kept in this browser for now.",
    joinTitle: "What's your name?", joinNote: "Every park you rate is kept under this name, for everyone here to see. On another device, just type the same name.",
    joinGo: "Start", name: "Name",
    isThatYou: function (n, k) { return n + " is already here (" + (k === 1 ? "1 park" : k + " parks") + " rated). Is that you?"; },
    yesMe: "Yes, that's me", notMe: "No, a different name",
    ownerAsk: "That's Newton's name. Newton, your password:",
    full: "The group is full.", friends: "Friends", you: "You", rankingOf: function (n) { return n + "'s ranking"; },
    nothingYet: function (n) { return n + " hasn't rated any parks yet."; },
    youAre: function (n) { return "You're " + n; }, notYou: "Not you?",
    removePerson: function (n) { return "Remove " + n; },
    removePersonAsk: function (n) { return "Remove " + n + " and all their ratings?"; },
    noFriends: "No friends here yet. Send them this page: they type their name and start rating.",
    nRated: function (n) { return n === 1 ? "1 park rated" : n + " parks rated"; },
    notRated: "Hasn't rated it", friendsOn: "Friends' ratings", othersOn: "Everyone else's ratings",
    where: { us: "US", ca: "Canada", both: "Both" }, whereLabel: "Country", noneHere: "No parks rated here yet."
  };

  var view = root.querySelector(".pk-view");
  var countEl = root.querySelector(".pk-count");
  var tabsBox = root.querySelector(".pk-tabs");
  var tabs = tabsBox.querySelectorAll("button");
  var peopleBox = root.querySelector(".pk-people");
  var shareBox = root.querySelector(".pk-share");
  var backupBox = root.querySelector(".pk-backup");
  // US, Canada or both (his ask, 2026-11-06): only hides parks from the lists.
  // Scores, comparisons and "#r of n" stay over the one combined ranking.
  var WHERE = "park_ranking_where";
  var where = (function () { try { return localStorage.getItem(WHERE) || "both"; } catch (e) { return "both"; } })();
  if (!/^(us|ca|both)$/.test(where)) where = "both";
  // The filter sits at the top of each list, above "Find a park" (his ask).
  function whereBar() {
    var box = el("div", "pk-where");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", L.whereLabel);
    ["us", "ca", "both"].forEach(function (k) {
      var b = button(null, L.where[k], function () {
        where = k;
        try { localStorage.setItem(WHERE, k); } catch (e) {}
        draw();
      });
      b.setAttribute("aria-pressed", String(where === k));
      box.appendChild(b);
    });
    return box;
  }
  function here(id) { var p = byId[id]; return !!p && (where === "both" || (p.country || "US").toLowerCase() === where); }
  var fileIn = backupBox.querySelector('input[type="file"]');
  var parks = [], byId = {}, store = blank(), state = { view: "ranked" }, query = "";
  // owner: Newton's Personal sign-in. friend: {id, token, name} for a friend's browser.
  // me: the person this browser edits (null: not said who yet). people: everyone, from the Worker.
  // base: the server version of my ranking the page holds. pending: a change the server hasn't taken yet.
  var owner = false, friend = {}, me = null, people = [], known = false;
  var base = null, pending = false, sending = false;

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
  // The weighted category score out of 5 (null when skipped).
  function weightOf(r) {
    if (!r || !r.s || !r.a || !r.w) return null;
    return Math.round((r.s * WEIGHT.s + r.a * WEIGHT.a + r.w * WEIGHT.w) * 10) / 10;
  }
  function groupOf(k) { for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].k === k) return GROUPS[i]; return null; }
  // The score out of 10: the group's top for its best park, then even steps of
  // range / n down the group (two liked parks: 10 and 8.4; the last only
  // nears the bottom of the range as the group grows).
  function scoreOf(st, id) {
    var r = st.rated[id], g = r && groupOf(r.like);
    if (!g) return null;
    var list = st.order[g.k], i = list.indexOf(id), n = list.length;
    if (i < 0) return null;
    return Math.round((g.hi - (g.hi - g.lo) * i / n) * 10) / 10;
  }
  function fmt(x) { return x == null ? "—" : x.toFixed(1); }
  function person(id) { for (var i = 0; i < people.length; i++) if (people[i].id === id) return people[i]; return null; }
  function whoName(id) { var p = person(id); return id === me ? L.you : p ? p.name : "?"; }
  function rankingOf(id) { if (id === me) return store; var p = person(id); return p ? p.data : blank(); }

  function blank() {
    return { v: 2, rated: {}, order: { yes: [], mid: [], no: [] } };
  }

  // A ranking made whole: every group list there, each rated park in its
  // group (once), and nothing listed that isn't rated. A v1 ranking (tiers
  // by score sum) becomes v2: sum 11+ is Yes, 8–10 Mid, 7 or less No,
  // keeping its order.
  function clean(raw) {
    var st = blank();
    if (!raw || typeof raw !== "object" || typeof raw.rated !== "object") return st;
    var seq = [];
    if (raw.v === 2 && raw.order) GROUPS.forEach(function (g) { seq = seq.concat(raw.order[g.k] || []); });
    else if (raw.order) for (var t = 15; t >= 3; t--) seq = seq.concat(raw.order[t] || []);
    Object.keys(raw.rated).forEach(function (id) {
      var r = raw.rated[id];
      if (!r || (parks.length && !byId[id])) return;
      var scored = AXES.every(function (ax) { return r[ax.k] >= 1 && r[ax.k] <= 5; });
      var like = groupOf(r.like) ? r.like : null;
      if (!like && scored) { var sum = +r.s + +r.a + +r.w; like = sum >= 11 ? "yes" : sum >= 8 ? "mid" : "no"; }
      if (!like) return;
      st.rated[id] = { like: like, s: scored ? +r.s : 0, a: scored ? +r.a : 0, w: scored ? +r.w : 0,
                       date: typeof r.date === "string" ? r.date : "", notes: typeof r.notes === "string" ? r.notes : "" };
    });
    var placed = {};
    seq.forEach(function (id) {
      if (st.rated[id] && !placed[id]) { st.order[st.rated[id].like].push(id); placed[id] = 1; }
    });
    Object.keys(st.rated).forEach(function (id) {
      if (!placed[id]) st.order[st.rated[id].like].push(id);
    });
    return st;
  }

  // ---- this browser ----------------------------------------------------------

  function read(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function write(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function getToken() { try { return localStorage.getItem(TOKEN); } catch (e) { return null; } }
  function setToken(t) { try { if (t) localStorage.setItem(TOKEN, t); else localStorage.removeItem(TOKEN); } catch (e) {} }
  function unexpired(t) {
    try {
      var p = t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(p + "===".slice((p.length + 3) % 4))).exp * 1000 > Date.now();
    } catch (e) { return false; }
  }

  // My own ranking's copy, kept with whose it is so a shared computer doesn't mix them up.
  function load() {
    var raw = read(KEY);
    if (me && raw && raw.who === me) {
      store = clean(raw.data);
      base = Number.isInteger(raw.base) ? raw.base : null;
      pending = !!raw.pending;
    } else {
      store = blank(); base = null; pending = false;
    }
  }
  function keep() { if (me) write(KEY, { who: me, data: store, base: base, pending: pending }); }
  function save() { pending = true; keep(); push(); }
  function forgetFriend() {
    friend = {};
    write(FRIEND, null);
  }

  // ---- the server -------------------------------------------------------------

  function headers(json) {
    var h = {};
    if (json) h["Content-Type"] = "application/json";
    if (owner) h.Authorization = "Bearer " + getToken();
    else if (friend.id && friend.token) h["X-Park-Me"] = friend.id + "." + friend.token;
    return h;
  }
  function call(method, path, body) {
    return fetch(SYNC + path, {
      method: method, cache: "no-store", credentials: "omit", headers: headers(!!body),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (b) { return { status: r.status, body: b }; });
    });
  }

  function push() {
    if (!me || !pending || sending) return;
    sending = true;
    var sent = JSON.stringify(store);
    call("PUT", "/people/" + me, { data: store, base: base }).then(function (r) {
      sending = false;
      if (r.status === 200 && r.body) {
        base = r.body.updated;
        pending = JSON.stringify(store) !== sent;   // changed again while it was on its way
        keep();
        var p = person(me);
        if (p) { p.data = store; p.updated = base; }
        if (pending) push();
      } else if (r.status === 409 && r.body) {
        adoptMine(r.body);
        flash(L.newer);
        draw();
      } else if (r.status === 401) {
        if (owner) { owner = false; setToken(null); }
        flash(L.signedOut);
        pull().catch(function () {});
      } else {
        keep();
        flash(L.unsaved);
      }
    }, function () {
      sending = false;
      flash(L.unsaved);
    });
  }

  function adoptMine(body) {
    store = clean(body.data);
    base = Number.isInteger(body.updated) ? body.updated : null;
    pending = false;
    keep();
    var p = person(me);
    if (p) { p.data = store; p.updated = base; }
  }

  // Everyone's rankings; mine is merged with what this browser holds.
  function pull() {
    return call("GET", "/all").then(function (r) {
      known = true;
      if (r.status !== 200 || !r.body) throw new Error(r.status);
      var was = me;
      me = r.body.me || null;
      if (owner && me !== OWNER) { owner = false; setToken(null); }   // sign-in ran out
      if (!owner && friend.id && me !== friend.id) forgetFriend();   // removed: back to the name
      if (me !== was) load();
      people = (r.body.people || []).map(function (p) {
        return { id: p.id, name: p.name, data: clean(p.data), updated: p.updated };
      });
      var mine = person(me);
      if (mine) {
        if (pending && mine.updated === base) { mine.data = store; push(); }   // ours is newer: send it
        else if (mine.updated != null) adoptMine({ data: mine.data, updated: mine.updated });
        else if (Object.keys(store.rated).length) { base = null; pending = true; mine.data = store; push(); }
        else { store = blank(); base = null; pending = false; mine.data = store; }
        if (!owner && friend.name !== mine.name) { friend.name = mine.name; write(FRIEND, friend); }
      }
      if (state.who && !person(state.who)) state = { view: "ranked" };
      draw();
    });
  }

  // ---- the rail ---------------------------------------------------------------

  function rail() {
    var inside = !!me;
    tabsBox.hidden = !inside;
    peopleBox.hidden = !inside;
    shareBox.hidden = !inside;
    backupBox.hidden = !inside;
    var looking = state.view === "ranked" || state.view === "detail";
    var shown = looking ? (state.who === undefined ? me : state.who) : me;
    var st = inside && shown ? rankingOf(shown) : null;
    countEl.textContent = st ? (shown !== me ? whoName(shown) + " · " : "") +
      L.count(Object.keys(st.rated).filter(here).length, parks.filter(function (p) { return here(p.id); }).length) : "";
    var on = state.view === "unrated" ? "unrated"
      : state.view === "friends" || shown !== me ? "friends" : "ranked";
    tabs.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === on)); });

    peopleBox.textContent = "";
    peopleBox.hidden = true;

    shareBox.textContent = "";
    if (inside) {
      var mine = person(me);
      shareBox.appendChild(el("p", "pk-you", L.youAre(mine ? mine.name : owner ? "Newton" : friend.name || "")));
      shareBox.appendChild(button("pk-quiet", L.notYou, function () {
        if (owner) { owner = false; setToken(null); } else forgetFriend();
        write(KEY, null);
        me = null; store = blank(); base = null; pending = false; state = { view: "ranked" };
        draw();
      }));
    }
  }

  // Newton's sign-in (he typed his name on a device that isn't signed in yet).
  function ownerLogin(password, msg, btn) {
    btn.disabled = true;
    fetch(PERSONAL + "/login", {
      method: "POST", cache: "no-store", credentials: "omit",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: password })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (b) { return { status: r.status, body: b }; });
    }).then(function (r) {
      btn.disabled = false;
      if (r.status === 200 && r.body && r.body.token) {
        setToken(r.body.token);
        owner = true;
        forgetFriend();
        me = OWNER;
        load();
        state = { view: "ranked" };
        pull().catch(function () { flash(L.offline); });
        return;
      }
      msg.textContent = r.status === 401 ? L.wrong : r.status === 429 ? L.many : L.offline;
    }, function () { btn.disabled = false; msg.textContent = L.offline; });
  }

  function unplace(id) {
    GROUPS.forEach(function (g) {
      var i = store.order[g.k].indexOf(id);
      if (i >= 0) store.order[g.k].splice(i, 1);
    });
  }
  function rankedList(st) {
    var out = [];
    GROUPS.forEach(function (g) { st.order[g.k].forEach(function (id) { out.push(id); }); });
    return out;
  }

  // A park left mid-way through comparing goes last in its group.
  function settle() {
    var placed = rankedList(store), moved = false;
    Object.keys(store.rated).forEach(function (id) {
      if (placed.indexOf(id) < 0) { store.order[store.rated[id].like].push(id); moved = true; }
    });
    if (moved) save();
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
    if (!known) { view.appendChild(el("p", "pk-empty", L.loading)); return; }
    if (!me) return drawJoin();
    if (state.view !== "compare") settle();
    if (state.view === "rate") return drawLike();
    if (state.view === "scores") return drawScores();
    if (state.view === "compare") return drawCompare();
    if (state.view === "detail") return drawDetail();
    if (state.view === "unrated") return drawUnrated();
    if (state.view === "friends") return drawFriends();
    drawRanked();
  }

  function drawJoin() {
    var form = el("form", "pk-join");
    form.appendChild(el("h2", "pk-title", L.joinTitle));
    form.appendChild(el("p", "pk-note", L.joinNote));
    var row = el("div", "pk-join-row");
    var input = el("input");
    input.type = "text";
    input.maxLength = 30;
    input.autocomplete = "given-name";
    input.setAttribute("aria-label", L.name);
    input.placeholder = L.name;
    var go_ = el("button", "pk-primary", L.joinGo);
    go_.type = "submit";
    row.appendChild(input);
    row.appendChild(go_);
    form.appendChild(row);
    var msg = el("p", "pk-msg");
    form.appendChild(msg);
    // "Is that you?" for a name that's already here
    var ask = el("div", "pk-join-ask");
    ask.hidden = true;
    var askText = el("p", "pk-note");
    var yes = button("pk-primary", L.yesMe, function () { send(true); });
    var no = button("pk-quiet", L.notMe, function () { ask.hidden = true; input.disabled = false; go_.disabled = false; input.select(); });
    ask.appendChild(askText);
    ask.appendChild(yes);
    ask.appendChild(no);
    form.appendChild(ask);
    // Newton's password, when the name is his
    var pw = el("div", "pk-join-row");
    pw.hidden = true;
    var pwIn = el("input");
    pwIn.type = "password";
    pwIn.autocomplete = "current-password";
    pwIn.setAttribute("aria-label", L.password);
    pwIn.placeholder = L.password;
    var pwGo = button("pk-primary", L.enter, function () { if (pwIn.value) ownerLogin(pwIn.value, msg, pwGo); });
    pwIn.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); pwGo.click(); } });
    pw.appendChild(pwIn);
    pw.appendChild(pwGo);
    form.appendChild(pw);

    function send(again) {
      var name = input.value.replace(/\s+/g, " ").trim();
      if (!name) { input.focus(); return; }
      go_.disabled = true; yes.disabled = true;
      msg.textContent = "";
      call("POST", "/join", { name: name, again: again }).then(function (r) {
        go_.disabled = false; yes.disabled = false;
        if (r.status === 200 && r.body && r.body.token) {
          friend = { id: r.body.id, token: r.body.token, name: r.body.name };
          write(FRIEND, friend);
          me = friend.id;
          load();
          state = { view: again ? "ranked" : "unrated" };
          pull().catch(function () { flash(L.offline); });
          return;
        }
        var e = r.body && r.body.error;
        if (r.status === 409 && e === "owner") {
          msg.textContent = L.ownerAsk;
          pw.hidden = false;
          pwIn.focus();
        } else if (r.status === 409 && e === "name-taken") {
          askText.textContent = L.isThatYou(r.body.name, r.body.rated || 0);
          ask.hidden = false;
          input.disabled = true; go_.disabled = true;
          yes.focus();
        } else msg.textContent = r.status === 403 && e === "full" ? L.full : L.offline;
      }, function () { go_.disabled = false; yes.disabled = false; msg.textContent = L.offline; });
    }
    form.addEventListener("submit", function (ev) { ev.preventDefault(); pw.hidden = true; send(false); });
    view.appendChild(form);
    if (!("ontouchstart" in window)) setTimeout(function () { input.focus(); }, 0);
  }

  // The two numbers of a rated park: category score (faint, out of 5) and score out of 10.
  function twoScores(st, id) {
    var box = el("span", "pk-two");
    box.appendChild(el("span", "pk-wt", fmt(weightOf(st.rated[id]))));
    box.appendChild(el("span", "pk-sum", fmt(scoreOf(st, id))));
    return box;
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

  function parkRow(p, right, fn, rank) {
    var li = el("li");
    var b = button("pk-row", null, fn);
    if (rank != null) b.appendChild(el("span", "pk-rank", String(rank)));
    var nm = el("span", "pk-name");
    nm.appendChild(el("span", "pk-park", nameOf(p)));
    nm.appendChild(el("span", "pk-state", p.state));
    b.appendChild(nm);
    b.appendChild(right);
    li.appendChild(b);
    return li;
  }

  function drawRanked() {
    var who = state.who === undefined ? me : state.who;
    var st = rankingOf(who);
    if (who !== me) {
      var h = el("div", "pk-head");
      h.appendChild(el("h2", "pk-title", L.rankingOf(whoName(who))));
      view.appendChild(h);
    }
    view.appendChild(whereBar());
    var ids = rankedList(st), shownIds = ids.filter(here);
    if (!ids.length) view.appendChild(el("p", "pk-note", who === me ? L.noneRanked : L.nothingYet(whoName(who))));
    else if (!shownIds.length) view.appendChild(el("p", "pk-note", L.noneHere));
    else view.appendChild(el("p", "pk-note pk-lead", L.legend));
    var rank = 0;
    GROUPS.forEach(function (g) {
      if (!st.order[g.k].filter(here).length) return;
      var sec = el("section", "pk-tier");
      var hd = el("h2", "pk-tier-head");
      hd.appendChild(el("span", "pk-tier-n", L.group[g.k]));
      sec.appendChild(hd);
      var ol = el("ol", "pk-list");
      st.order[g.k].forEach(function (id) {
        if (!here(id)) return;
        rank++;
        ol.appendChild(parkRow(byId[id], twoScores(st, id), function () { go({ view: "detail", id: id, who: who }); }, rank));
      });
      sec.appendChild(ol);
      view.appendChild(sec);
    });
    if (owner && who !== me && who !== OWNER) {
      var acts = el("p", "pk-actions pk-foot");
      acts.appendChild(button("pk-quiet", L.removePerson(whoName(who)), function () {
        if (!window.confirm(L.removePersonAsk(whoName(who)))) return;
        call("DELETE", "/people/" + who).then(function (r) {
          if (r.status !== 200) { flash(r.status === 401 ? L.signedOut : L.offline); return; }
          people = people.filter(function (p) { return p.id !== who; });
          go({ view: "ranked" });
        }, function () { flash(L.offline); });
      }));
      view.appendChild(acts);
    }
  }

  function drawUnrated() {
    view.appendChild(whereBar());
    var left = parks.filter(function (p) { return !store.rated[p.id] && here(p.id); });
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
        ol.appendChild(parkRow(p, el("span", "pk-go", L.rate + " →"), function () { go({ view: "rate", id: p.id }); }));
      });
    }
    box.addEventListener("input", function () { query = box.value; fill(); });
    fill();
  }

  function drawFriends() {
    var others = people.filter(function (p) { return p.id !== me; });
    if (!others.length) { view.appendChild(el("p", "pk-note", L.noFriends)); return; }
    view.appendChild(whereBar());
    var ol = el("ul", "pk-list");
    others.forEach(function (p) {
      var li = el("li");
      var b = button("pk-row", null, function () { go({ view: "ranked", who: p.id }); });
      var nm = el("span", "pk-name");
      nm.appendChild(el("span", "pk-park", p.name));
      nm.appendChild(el("span", "pk-state", L.nRated(Object.keys(p.data.rated).filter(here).length)));
      b.appendChild(nm);
      b.appendChild(el("span", "pk-go", "→"));
      li.appendChild(b);
      ol.appendChild(li);
    });
    view.appendChild(ol);
  }

  function head(p, extra) {
    var h = el("div", "pk-head");
    h.appendChild(button("pk-back", L.back, function () {
      if (state.view === "detail") { go({ view: "ranked", who: state.who }); return; }
      go({ view: store.rated[p.id] && rankedList(store).indexOf(p.id) >= 0 ? "detail" : "unrated", id: p.id, who: me });
    }));
    if (extra) h.appendChild(extra);
    h.appendChild(el("h2", "pk-title", nameOf(p)));
    h.appendChild(el("p", "pk-state", p.state));
    return h;
  }

  // Step 1: did you like it?
  function drawLike() {
    var p = byId[state.id], old = store.rated[p.id];
    view.appendChild(head(p));
    var h = el("h2", "pk-title pk-ask", L.didYouLike(nameOf(p)));
    view.appendChild(h);
    var row = el("div", "pk-likes");
    GROUPS.forEach(function (g) {
      var b = button("pk-like", L.like[g.k], function () {
        var was = snapshot(p.id);
        store.rated[p.id] = {
          like: g.k, s: old ? old.s : 0, a: old ? old.a : 0, w: old ? old.w : 0,
          date: old ? old.date : "", notes: old ? old.notes : ""
        };
        startCompare(p.id, true, was);
      });
      if (old && old.like === g.k) b.setAttribute("aria-pressed", "true");
      row.appendChild(b);
    });
    view.appendChild(row);
    var acts = el("p", "pk-actions");
    acts.appendChild(button("pk-quiet", L.cancel, function () { go({ view: old ? "detail" : "unrated", id: p.id, who: me }); }));
    view.appendChild(acts);
  }

  // Step 2: place it in its group by halving: lo..hi is the stretch it can still go in.
  // then: go on to the category scores (while rating), or back to the park.
  // was: the park's rating and place before this round, so Back can put them back.
  function snapshot(id) {
    var r = store.rated[id];
    return r ? { rec: JSON.parse(JSON.stringify(r)), group: r.like, index: store.order[r.like].indexOf(id) }
             : { rec: null };
  }
  function restore(id, was) {
    unplace(id);
    if (!was.rec) delete store.rated[id];
    else {
      store.rated[id] = was.rec;
      if (was.index >= 0) store.order[was.group].splice(Math.min(was.index, store.order[was.group].length), 0, id);
    }
    save();
  }
  function startCompare(id, then, was) {
    was = was || snapshot(id);
    unplace(id);
    var g = store.rated[id].like;
    var others = store.order[g].length;
    if (!others) { store.order[g].push(id); save(); afterPlace(id, then); return; }
    go({ view: "compare", id: id, group: g, lo: 0, hi: others, n: 1, then: !!then, was: was, prev: null });
  }
  function afterPlace(id, then) {
    go(then ? { view: "scores", id: id, rating: true } : { view: "detail", id: id, who: me });
  }
  function place(at) {
    store.order[state.group].splice(at, 0, state.id);
    save();
    afterPlace(state.id, state.then);
  }

  function drawCompare() {
    var list = store.order[state.group];
    if (state.lo >= state.hi) { place(state.lo); return; }
    var mid = (state.lo + state.hi) >> 1;
    var a = byId[state.id], b = byId[list[mid]];
    var h = el("div", "pk-head");
    // Back (his ask): the previous question, or from the first one the step
    // before (Did you like it?, or the park's page), as it was.
    h.appendChild(button("pk-back", L.back, function () {
      if (state.prev) { state = state.prev; draw(); return; }
      var id = state.id, then = state.then;
      restore(id, state.was);
      go(then ? { view: "rate", id: id } : { view: "detail", id: id, who: me });
    }));
    h.appendChild(el("p", "pk-kicker", L.group[state.group] + " · " + L.step(state.n)));
    h.appendChild(el("h2", "pk-title", L.which));
    view.appendChild(h);
    var pair = el("div", "pk-pair");
    [[a, true], [b, false]].forEach(function (x) {
      var p = x[0];
      var c = button("pk-card", null, function () {
        var next = { view: "compare", id: state.id, group: state.group, n: state.n + 1, lo: state.lo, hi: state.hi, then: state.then, was: state.was, prev: state };
        if (x[1]) next.hi = mid; else next.lo = mid + 1;
        state = next;
        draw();
      });
      c.appendChild(el("span", "pk-park", nameOf(p)));
      c.appendChild(el("span", "pk-state", p.state));
      if (!x[1]) c.appendChild(el("span", "pk-card-score", fmt(scoreOf(store, p.id)) + " / 10"));
      pair.appendChild(c);
    });
    view.appendChild(pair);
    var acts = el("p", "pk-actions");
    acts.appendChild(button("pk-quiet", L.close, function () { place(mid); }));
    view.appendChild(acts);
  }

  // Step 3: scenery, activities, wildlife (weighted), or skip. Also when
  // editing them later from the park's page (state.rating false).
  function drawScores() {
    var p = byId[state.id], old = store.rated[p.id];
    if (!old) { go({ view: "unrated" }); return; }
    var r = { s: old.s, a: old.a, w: old.w };
    view.appendChild(head(p));
    var hd = el("div", "pk-scores-head");
    hd.appendChild(el("h2", "pk-title pk-ask", L.scoresTitle));
    var right = el("div", "pk-head-right");
    var tot = el("p", "pk-total");
    right.appendChild(tot);
    hd.appendChild(right);
    view.appendChild(hd);
    view.appendChild(el("p", "pk-note pk-lead", L.scoresNote));
    var saveB;
    function sync() {
      var done = r.s && r.a && r.w;
      tot.textContent = L.weighted + "  " + fmt(weightOf(r)) + " / 5";
      if (saveB) saveB.disabled = !done;
    }
    AXES.forEach(function (ax) {
      var f = el("fieldset", "pk-axis");
      f.appendChild(el("legend", null, (ZH ? ax.zh : ax.en) + " · " + Math.round(WEIGHT[ax.k] * 100) + "%"));
      var row = el("div", "pk-pick");
      var btns = [];
      for (var v = 1; v <= 5; v++) (function (v) {
        var b = button(null, String(v), function () {
          r[ax.k] = v;
          btns.forEach(function (x, i) { x.setAttribute("aria-pressed", String(i + 1 === v)); });
          sync();
        });
        b.setAttribute("aria-pressed", String(r[ax.k] === v));
        b.setAttribute("aria-label", (ZH ? ax.zh : ax.en) + " " + v);
        btns.push(b);
        row.appendChild(b);
      })(v);
      f.appendChild(row);
      view.appendChild(f);
    });

    var more = el("div", "pk-more");
    var dl = el("label", "pk-field");
    dl.appendChild(el("span", null, L.visited + L.optional));
    var date = el("input");
    date.type = "month";
    date.value = old.date || "";
    dl.appendChild(date);
    var nl = el("label", "pk-field");
    nl.appendChild(el("span", null, L.notes + L.optional));
    var notes = el("textarea");
    notes.rows = 3;
    notes.value = old.notes || "";
    nl.appendChild(notes);
    more.appendChild(dl);
    more.appendChild(nl);
    view.appendChild(more);

    function keepExtras() {
      old.date = /^\d{4}-\d\d$/.test(date.value) ? date.value : "";
      old.notes = notes.value.trim();
    }
    var acts = el("p", "pk-actions");
    saveB = button("pk-primary", L.save, function () {
      old.s = r.s; old.a = r.a; old.w = r.w;
      keepExtras();
      save();
      go({ view: "detail", id: p.id, who: me });
    });
    acts.appendChild(saveB);
    if (state.rating) {
      // Skip sits up top, by the category score (his ask), not under the form.
      right.appendChild(button("pk-quiet pk-skip", L.skipScores, function () {
        old.s = old.a = old.w = 0;
        keepExtras();
        save();
        go({ view: "detail", id: p.id, who: me });
      }));
    } else {
      acts.appendChild(button("pk-quiet", L.cancel, function () { go({ view: "detail", id: p.id, who: me }); }));
    }
    view.appendChild(acts);
    sync();
  }

  function drawDetail() {
    var p = byId[state.id];
    if (!p) { go({ view: "ranked" }); return; }
    var who = state.who == null ? me : state.who;
    var st = rankingOf(who), r = st.rated[p.id];
    if (!r) { go({ view: "ranked", who: who }); return; }
    view.appendChild(head(p, who && who !== me ? el("p", "pk-kicker", L.rankingOf(whoName(who))) : null));
    var box = el("div", "pk-detail");
    var big = el("p", "pk-big");
    {
      var list = rankedList(st), wt = weightOf(r);
      big.appendChild(el("span", "pk-big-n", fmt(scoreOf(st, p.id))));
      big.appendChild(el("span", "pk-big-of", "/ 10"));
      big.appendChild(el("span", "pk-big-rank", L.group[r.like] + " · " + L.of(list.indexOf(p.id) + 1, list.length)));
      box.appendChild(big);
      var wl = el("p", "pk-axis-line pk-wt-line");
      wl.appendChild(el("span", "pk-score-k", L.weighted));
      wl.appendChild(el("span", "pk-score-v", wt == null ? "—" : fmt(wt) + " / 5"));
      if (wt == null) wl.appendChild(el("span", "pk-axis-txt", L.skipped));
      box.appendChild(wl);
      if (wt != null) AXES.forEach(function (ax) {
        var row = el("p", "pk-axis-line");
        row.appendChild(el("span", "pk-score-k", ZH ? ax.zh : ax.en));
        row.appendChild(el("span", "pk-score-v", r[ax.k] + " / 5"));
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
    }
    view.appendChild(box);

    // Every other person's score and rank for this park, or that they haven't rated it.
    var others = people.filter(function (x) { return x.id !== who; });
    if (others.length) {
      var rows = others.map(function (x) {
        var xs = rankingOf(x.id), xr = xs.rated[p.id];
        return { id: x.id, st: xs, r: xr, score: xr ? scoreOf(xs, p.id) : null,
                 rank: xr ? rankedList(xs).indexOf(p.id) + 1 : 0, of: Object.keys(xs.rated).length };
      });
      rows.sort(function (a, b) {
        return (b.r ? 1 : 0) - (a.r ? 1 : 0) || (b.r && a.r ? (b.score || 0) - (a.score || 0) : 0) || whoName(a.id).localeCompare(whoName(b.id));
      });
      var sec = el("section", "pk-everyone");
      sec.appendChild(el("h3", "pk-label", who === me ? L.friendsOn : L.othersOn));
      var ol = el("ul", "pk-list");
      rows.forEach(function (x) {
        var li = el("li");
        var nm = el("span", "pk-name");
        nm.appendChild(el("span", "pk-park", whoName(x.id)));
        if (x.r) {
          var b = button("pk-row", null, function () { go({ view: "detail", id: p.id, who: x.id }); });
          nm.appendChild(el("span", "pk-state", L.group[x.r.like] + " · " + L.of(x.rank, x.of)));
          b.appendChild(nm);
          if (weightOf(x.r) != null) b.appendChild(scoreLine(x.r));
          b.appendChild(twoScores(x.st, p.id));
          li.appendChild(b);
        } else {
          var d = el("div", "pk-row is-off");
          nm.appendChild(el("span", "pk-state", L.notRated));
          d.appendChild(nm);
          li.appendChild(d);
        }
        ol.appendChild(li);
      });
      sec.appendChild(ol);
      view.appendChild(sec);
    }

    var acts = el("p", "pk-actions");
    if (who === me) {
      acts.appendChild(button("pk-primary", L.rerate, function () { go({ view: "rate", id: p.id }); }));
      if (store.order[r.like].length > 1) acts.appendChild(button("pk-quiet", L.recompare, function () { startCompare(p.id, false); }));
      acts.appendChild(button("pk-quiet", weightOf(r) == null ? L.addScores : L.editScores, function () { go({ view: "scores", id: p.id, rating: false }); }));
      acts.appendChild(button("pk-quiet", L.remove, function () {
        if (!window.confirm(L.removeAsk(nameOf(p)))) return;
        unplace(p.id);
        delete store.rated[p.id];
        save();
        go({ view: "ranked" });
      }));
    } else if (!store.rated[p.id]) {
      acts.appendChild(button("pk-primary", L.rate, function () { go({ view: "rate", id: p.id }); }));
    }
    if (acts.children.length) view.appendChild(acts);
  }

  // ---- the rail's buttons -------------------------------------------------------

  tabs.forEach(function (b) {
    b.addEventListener("click", function () { go({ view: b.getAttribute("data-view") }); });
  });

  function flash(msg, ms) {
    var aside = root.querySelector(".about-rail");
    var n = aside.querySelector(".pk-flash") || el("p", "pk-flash");
    n.textContent = msg;
    aside.appendChild(n);
    clearTimeout(flash.t);
    flash.t = setTimeout(function () { n.textContent = ""; }, ms || 4000);
  }

  backupBox.querySelector('[data-act="export"]').addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(store, null, 1)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "national-park-ranking-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    flash(L.saved);
  });
  backupBox.querySelector('[data-act="import"]').addEventListener("click", function () { fileIn.click(); });
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
    tabs[2].textContent = L.friendsTab;
    backupBox.querySelector('[data-act="export"]').textContent = "保存副本";
    backupBox.querySelector('[data-act="import"]').textContent = "恢复副本";
  }

  friend = read(FRIEND) || {};
  if (!friend.id || !friend.token) friend = {};

  draw();
  fetch("data/national-parks.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      parks = (d.parks || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      parks.forEach(function (p) { byId[p.id] = p; });
      var t = getToken();
      owner = !!(t && unexpired(t));
      if (t && !owner) setToken(null);
      me = owner ? OWNER : friend.id || null;
      load();
      pull().catch(function () {
        // offline: still show my own copy if I'm someone
        known = true;
        if (me) people = [{ id: me, name: owner ? "Newton" : friend.name || "", data: store, updated: base }];
        draw();
        flash(L.offline);
      });
      window.addEventListener("focus", function () {
        if (pending) push();
        else if (me && !sending && state.view !== "rate" && state.view !== "compare" && state.view !== "scores") pull().catch(function () {});
      });
    })
    .catch(function () {
      view.textContent = "";
      view.appendChild(el("p", "pk-empty", L.failed));
    });
})();
