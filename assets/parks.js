/* ==========================================================================
   newton-liu.com — the National Park Ranking (national-park-ranking.html),
   a Projects entry (Newton, 2026-11-06), made like the eBird Site Ranking.

   Each park gets three scores, 1–5 each: scenery, activities, wildlife.
   Their sum (3–15) is the park's tier. Inside a tier the order comes from
   "which did you like more?" questions: a newly rated park is placed by
   halving the tier (as Beli does), so a tier of 8 takes at most 3 questions.

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
   Everyone in the group sees everyone's ratings: each person's list, each
   park's scores from everyone, and Together (average totals).
   Each save sends one person's whole ranking with the version it was based
   on; if another device saved first, the page takes that version and says
   so. localStorage "park_ranking_v1" keeps a copy of one's own ranking (and
   unsent changes) for when the Worker can't be reached.

   A ranking: { v: 1, rated: { id: { s, a, w, date ("YYYY-MM" or ""), notes } },
                order: { "15": [id, …best first], … "3": [] } }
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
    loading: "加载中……", failed: "公园列表加载失败。", ranked: "我的", unrated: "待评分", together: "大家",
    count: function (n, all) { return "已评 " + n + " / " + all; },
    noneRanked: "你还没有评过分的公园。去「待评分」里选一个你去过的公园。",
    allRated: "所有公园都评过了。", search: "搜索公园", rate: "评分", total: "总分",
    visited: "到访时间", notes: "备注", save: "保存", cancel: "取消", optional: "（选填）",
    which: "你更喜欢哪一个？", close: "差不多，分不出", skip: "跳过，放在这一档最后",
    step: function (i) { return "第 " + i + " 题"; }, tier: "档", of: function (r, n) { return "第 " + r + " 名，共 " + n + " 个"; },
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
    togetherNote: "至少有一个人评过的公园，按平均总分排列。",
    people: function (n) { return n + " 人"; }, avg: "平均", everyone: "每个人的评分",
    noneTogether: "还没有人评分。"
  } : {
    loading: "Loading…", failed: "The list of parks didn't load.", ranked: "Mine", unrated: "To be rated", together: "Together",
    count: function (n, all) { return n + " of " + all + " rated"; },
    noneRanked: "You haven't rated any parks yet. Pick one you've been to under To be rated.",
    allRated: "Every park has been rated.", search: "Find a park", rate: "Rate", total: "Total",
    visited: "Visited", notes: "Notes", save: "Save rating", cancel: "Cancel", optional: " (optional)",
    which: "Which did you like more?", close: "Too close to call", skip: "Skip: put it last in this tier",
    step: function (i) { return "Question " + i; }, tier: "Tier", of: function (r, n) { return "#" + r + " of " + n; },
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
    togetherNote: "Every park at least one person has rated, by average total.",
    people: function (n) { return n === 1 ? "1 person" : n + " people"; }, avg: "Average", everyone: "Everyone's scores",
    noneTogether: "Nobody has rated a park yet."
  };

  var view = root.querySelector(".pk-view");
  var countEl = root.querySelector(".pk-count");
  var tabsBox = root.querySelector(".pk-tabs");
  var tabs = tabsBox.querySelectorAll("button");
  var peopleBox = root.querySelector(".pk-people");
  var shareBox = root.querySelector(".pk-share");
  var backupBox = root.querySelector(".pk-backup");
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
  function totalOf(r) { return (r.s || 0) + (r.a || 0) + (r.w || 0); }
  function person(id) { for (var i = 0; i < people.length; i++) if (people[i].id === id) return people[i]; return null; }
  function whoName(id) { var p = person(id); return id === me ? L.you : p ? p.name : "?"; }
  function rankingOf(id) { if (id === me) return store; var p = person(id); return p ? p.data : blank(); }

  function blank() {
    var order = {};
    for (var t = MIN; t <= MAX; t++) order[t] = [];
    return { v: 1, rated: {}, order: order };
  }

  // A ranking made whole: every tier list there, each rated park in the
  // tier its scores say (once), and nothing listed that isn't rated.
  function clean(raw) {
    var st = blank();
    if (!raw || typeof raw !== "object" || typeof raw.rated !== "object") return st;
    Object.keys(raw.rated).forEach(function (id) {
      var r = raw.rated[id];
      if (!r || (parks.length && !byId[id])) return;
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
    countEl.textContent = st ? (shown !== me ? whoName(shown) + " · " : "") + L.count(Object.keys(st.rated).length, parks.length) : "";
    var on = state.view === "unrated" ? "unrated"
      : state.view === "together" || (state.view === "detail" && state.who === null) ? "together"
      : shown === me ? "ranked" : "";
    tabs.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === on)); });

    peopleBox.textContent = "";
    var others = people.filter(function (p) { return p.id !== me; });
    peopleBox.hidden = !inside || !others.length;
    if (inside && others.length) {
      peopleBox.appendChild(el("p", "pk-label", L.friends));
      others.forEach(function (p) {
        var b = button("pk-person", null, function () { go({ view: "ranked", who: p.id }); });
        b.appendChild(el("span", "pk-person-name", p.name));
        b.appendChild(el("span", "pk-person-n", String(Object.keys(p.data.rated).length)));
        b.setAttribute("aria-pressed", String(looking && state.who === p.id));
        peopleBox.appendChild(b);
      });
    }

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
    for (var t = MIN; t <= MAX; t++) {
      var i = store.order[t].indexOf(id);
      if (i >= 0) store.order[t].splice(i, 1);
    }
  }
  function rankedList(st) {
    var out = [];
    for (var t = MAX; t >= MIN; t--) st.order[t].forEach(function (id) { out.push(id); });
    return out;
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
    if (state.view === "rate") return drawRate();
    if (state.view === "compare") return drawCompare();
    if (state.view === "detail") return drawDetail();
    if (state.view === "unrated") return drawUnrated();
    if (state.view === "together") return drawTogether();
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
    var ids = rankedList(st);
    if (!ids.length) view.appendChild(el("p", "pk-note", who === me ? L.noneRanked : L.nothingYet(whoName(who))));
    var rank = 0;
    for (var t = MAX; t >= MIN; t--) {
      if (!st.order[t].length) continue;
      var sec = el("section", "pk-tier");
      var hd = el("h2", "pk-tier-head");
      hd.appendChild(el("span", "pk-tier-n", String(t)));
      hd.appendChild(el("span", "pk-tier-of", "/ " + MAX));
      sec.appendChild(hd);
      var ol = el("ol", "pk-list");
      st.order[t].forEach(function (id) {
        rank++;
        ol.appendChild(parkRow(byId[id], scoreLine(st.rated[id]), function () { go({ view: "detail", id: id, who: who }); }, rank));
      });
      sec.appendChild(ol);
      view.appendChild(sec);
    }
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
        ol.appendChild(parkRow(p, el("span", "pk-go", L.rate + " →"), function () { go({ view: "rate", id: p.id }); }));
      });
    }
    box.addEventListener("input", function () { query = box.value; fill(); });
    fill();
  }

  // Every person's rating of one park, in the group's order.
  function ratingsOf(id) {
    var out = [];
    people.forEach(function (p) {
      var st = rankingOf(p.id), r = st.rated[id];
      if (r) out.push({ who: p.id, r: r, rank: rankedList(st).indexOf(id) + 1, of: Object.keys(st.rated).length });
    });
    return out;
  }

  function drawTogether() {
    var rows = [];
    parks.forEach(function (p) {
      var rs = ratingsOf(p.id);
      if (!rs.length) return;
      var sum = 0;
      rs.forEach(function (x) { sum += totalOf(x.r); });
      rows.push({ p: p, avg: sum / rs.length, n: rs.length });
    });
    if (!rows.length) { view.appendChild(el("p", "pk-note", L.noneTogether)); return; }
    rows.sort(function (a, b) { return b.avg - a.avg || b.n - a.n || a.p.name.localeCompare(b.p.name); });
    view.appendChild(el("p", "pk-note pk-lead", L.togetherNote));
    var ol = el("ol", "pk-list");
    rows.forEach(function (x, i) {
      var right = el("span", "pk-avg");
      right.appendChild(el("span", "pk-score-v", x.avg.toFixed(1)));
      right.appendChild(el("span", "pk-state", L.people(x.n)));
      ol.appendChild(parkRow(x.p, right, function () { go({ view: "detail", id: x.p.id, who: null }); }, i + 1));
    });
    view.appendChild(ol);
  }

  function head(p, extra) {
    var h = el("div", "pk-head");
    h.appendChild(button("pk-back", L.back, function () {
      if (state.view === "detail") { go(state.who === null ? { view: "together" } : { view: "ranked", who: state.who }); return; }
      go({ view: store.rated[p.id] ? "detail" : "unrated", id: p.id, who: me });
    }));
    if (extra) h.appendChild(extra);
    h.appendChild(el("h2", "pk-title", nameOf(p)));
    h.appendChild(el("p", "pk-state", p.state));
    return h;
  }

  function drawRate() {
    var p = byId[state.id], old = store.rated[p.id];
    var r = old ? { s: old.s, a: old.a, w: old.w } : { s: 0, a: 0, w: 0 };
    var tot = el("p", "pk-total");
    view.appendChild(head(p));
    view.lastChild.appendChild(tot);
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
      if (was === t) { save(); go({ view: "detail", id: p.id, who: me }); return; }
      unplace(p.id);
      startCompare(p.id);
    });
    acts.appendChild(saveB);
    acts.appendChild(button("pk-quiet", L.cancel, function () { go({ view: old ? "detail" : "unrated", id: p.id, who: me }); }));
    view.appendChild(acts);
    sync();
  }

  // Place a park in its tier by halving: lo..hi is the stretch it can still go in.
  function startCompare(id) {
    unplace(id);
    var t = totalOf(store.rated[id]);
    var others = store.order[t].length;
    if (!others) { store.order[t].push(id); save(); go({ view: "detail", id: id, who: me }); return; }
    go({ view: "compare", id: id, tier: t, lo: 0, hi: others, n: 1 });
  }
  function place(at) {
    store.order[state.tier].splice(at, 0, state.id);
    save();
    go({ view: "detail", id: state.id, who: me });
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
    var p = byId[state.id];
    if (!p) { go({ view: "ranked" }); return; }
    var who = state.who === undefined ? me : state.who;
    var st = who ? rankingOf(who) : null, r = st && st.rated[p.id];
    if (who && !r) { go({ view: "ranked", who: who }); return; }
    var all = ratingsOf(p.id);
    view.appendChild(head(p, who && who !== me ? el("p", "pk-kicker", L.rankingOf(whoName(who))) : null));
    var box = el("div", "pk-detail");
    var big = el("p", "pk-big");
    if (r) {
      var list = rankedList(st);
      big.appendChild(el("span", "pk-big-n", String(totalOf(r))));
      big.appendChild(el("span", "pk-big-of", "/ " + MAX));
      big.appendChild(el("span", "pk-big-rank", L.of(list.indexOf(p.id) + 1, list.length)));
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
    } else if (all.length) {
      var sum = 0;
      all.forEach(function (x) { sum += totalOf(x.r); });
      big.appendChild(el("span", "pk-big-n", (sum / all.length).toFixed(1)));
      big.appendChild(el("span", "pk-big-of", "/ " + MAX));
      big.appendChild(el("span", "pk-big-rank", L.avg + " · " + L.people(all.length)));
      box.appendChild(big);
    }
    view.appendChild(box);

    // Everyone's scores for this park, when anyone besides the person shown has rated it.
    if (all.some(function (x) { return x.who !== who; })) {
      var sec = el("section", "pk-everyone");
      sec.appendChild(el("h3", "pk-label", L.everyone));
      var ol = el("ul", "pk-list");
      all.forEach(function (x) {
        var li = el("li");
        var b = button("pk-row" + (x.who === who ? " is-here" : ""), null, function () { go({ view: "detail", id: p.id, who: x.who }); });
        var nm = el("span", "pk-name");
        nm.appendChild(el("span", "pk-park", whoName(x.who)));
        nm.appendChild(el("span", "pk-state", L.of(x.rank, x.of)));
        b.appendChild(nm);
        b.appendChild(scoreLine(x.r));
        b.appendChild(el("span", "pk-sum", String(totalOf(x.r))));
        li.appendChild(b);
        ol.appendChild(li);
      });
      sec.appendChild(ol);
      view.appendChild(sec);
    }

    var acts = el("p", "pk-actions");
    if (who === me) {
      acts.appendChild(button("pk-primary", L.rerate, function () { go({ view: "rate", id: p.id }); }));
      if (store.order[totalOf(r)].length > 1) acts.appendChild(button("pk-quiet", L.recompare, function () { startCompare(p.id); }));
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
    tabs[2].textContent = L.together;
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
        else if (me && !sending && state.view !== "rate" && state.view !== "compare") pull().catch(function () {});
      });
    })
    .catch(function () {
      view.textContent = "";
      view.appendChild(el("p", "pk-empty", L.failed));
    });
})();
