/* ==========================================================================
   newton-liu.com — the podcast tracker (podcast-tracker.html), under the
   nav's Personal tab: every episode on Newton's listening list, the ones he
   has finished marked.

   Everything on it is data/podcasts.json (see CLAUDE.md, "Podcast
   Tracker"): podcasts, each in sections, each section a run of episodes in
   listening order. An episode is a row: its number (none for a members'
   extra), its title linking to the show's own page, a BONUS / EXTRACT /
   SPECIAL label, the release date (a * when it is the catalogue's date),
   and a note.

   What he has finished is not in that file (2026-10-22): the ticks live in
   the "personal" Worker (~/Code/personal, D1 "personal"), keyed by the
   episode's number, or for an extra the last part of its link (tickKey).
   Every square is a checkbox: a click saves at once. There is no password
   (Newton, 2026-10-23): the Personal pages will go behind one general
   password later, so until then anyone could tick (the Worker's limits keep
   that small; see its README).

   The rail: how many he has finished, a filter (all, still to listen,
   finished; remembered in this browser only), and the sections, lit as
   they pass. Reads through window.NLSite like the other pages.
   ========================================================================== */

(function () {
  "use strict";

  var S = window.NLSite;
  var root = document.querySelector(".podcasts");
  if (!S || !root) return;
  var t = S.t, ZH = S.lang() === "zh";
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var KINDS = { bonus: "Bonus", extract: "Extract", special: "Special" };
  var KEY = "podcasts.show";
  // The Worker; ?api=local on the local preview uses `wrangler dev` (port 8788).
  var API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]api=local\b/.test(location.search)
    ? "http://127.0.0.1:8788" : "https://personal.shoot-planner-worker.workers.dev";

  // The ticks: undefined while they load, null when the Worker couldn't be
  // reached (then nothing shows as finished or not, and nothing can be
  // ticked).
  var ticks, rows = [], redraw = function () {};

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // "2024-06-02" → "2 Jun 2024" (2024年6月2日 in Chinese).
  function dateOf(iso) {
    var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso || "");
    if (!m) return "";
    var d = +m[3], mo = +m[2];
    return ZH ? m[1] + "年" + mo + "月" + d + "日" : d + " " + MON[mo - 1] + " " + m[1];
  }

  function outLink(href, cls, label) {
    var a = el("a", cls);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.appendChild(document.createTextNode(label));
    var out = el("span", "pt-out", "↗");
    out.setAttribute("aria-hidden", "true");
    a.appendChild(out);
    return a;
  }

  /* ---------- an episode ------------------------------------------------- */

  // The episode's key among the ticks: its number, or the end of its link.
  function tickKey(ep) {
    if (ep.n != null) return String(ep.n);
    var m = /([^\/]+)\/?$/.exec(ep.href || "");
    return m ? m[1] : null;
  }

  // The square: blank while the ticks load (or when they couldn't), then a
  // checkbox. Changed in place when it stays the same kind of element, so
  // keyboard focus stays on it.
  function paintMark(row) {
    var ep = row.ep, known = !!ticks, can = known && !!row.key;
    var tag = can ? "BUTTON" : "SPAN", mark = row.mark;
    if (!mark || mark.tagName !== tag) {
      var had = mark && document.activeElement === mark;
      var next = el(tag.toLowerCase(), "pt-mark");
      if (can) {
        next.type = "button";
        next.setAttribute("role", "checkbox");
        next.setAttribute("aria-label", ep.title);
        next.addEventListener("click", function () { toggle(row); });
      }
      if (mark) row.li.replaceChild(next, mark);
      else row.li.insertBefore(next, row.li.firstChild);
      row.mark = mark = next;
      if (had && can) mark.focus();
    }
    if (can) {
      mark.setAttribute("aria-checked", ep.done ? "true" : "false");
    } else if (known) {
      mark.removeAttribute("aria-hidden");
      mark.setAttribute("role", "img");
      mark.setAttribute("aria-label", ep.done ? t("Finished") : t("Not finished yet"));
    } else {
      mark.removeAttribute("role");
      mark.removeAttribute("aria-label");
      mark.setAttribute("aria-hidden", "true");
    }
    row.li.classList.toggle("is-unknown", !known);
    row.li.classList.toggle("is-done", known && !!ep.done);
  }

  function episodeRow(ep, pod) {
    var li = el("li", "pt-ep");
    var row = { ep: ep, li: li, list: pod.id, key: tickKey(ep), mark: null };
    rows.push(row);
    li.appendChild(el("span", "pt-num", ep.n != null ? String(ep.n) : "–"));

    var main = el("div", "pt-main");
    var head = el("p", "pt-title");
    if (ep.href) head.appendChild(outLink(ep.href, "pt-link", ep.title));
    else head.appendChild(document.createTextNode(ep.title));
    if (ep.kind && KINDS[ep.kind]) head.appendChild(el("span", "pt-kind", t(KINDS[ep.kind])));
    main.appendChild(head);
    if (ep.note) main.appendChild(el("p", "pt-note", ep.note));
    li.appendChild(main);

    var date = el("span", "pt-date", dateOf(ep.date) + (ep.catalogueDate ? "*" : ""));
    if (ep.catalogueDate) date.title = t("Date shown in the catalogue");
    li.appendChild(date);
    paintMark(row);
    return li;
  }

  /* ---------- a podcast -------------------------------------------------- */

  // The words before a section title's colon, when the section before or
  // after it starts with the same ones.
  function leadOf(sections, k) {
    var head = function (i) {
      var m = sections[i] && /^([^:]+): ./.exec(sections[i].title || "");
      return m ? m[1] : null;
    };
    var h = head(k);
    return h && (head(k - 1) === h || head(k + 1) === h) ? h : null;
  }

  function podcastBlock(pod, jump, many) {
    var box = el("section", "pt-podcast");
    box.id = pod.id;
    var name = el("h2", "pt-name", pod.name);
    box.appendChild(name);
    var meta = el("p", "pt-meta");
    if (pod.subtitle) meta.appendChild(el("span", null, pod.subtitle));
    if (pod.checked) meta.appendChild(el("span", null, t("Checked {date}", { date: dateOf(pod.checked) })));
    if (pod.href) {
      var s = el("span");
      s.appendChild(outLink(pod.href, "pt-meta-link", t("Episode archive")));
      meta.appendChild(s);
    }
    box.appendChild(meta);
    if (pod.lede) box.appendChild(el("p", "pt-lede", pod.lede));
    (pod.guide || []).forEach(function (p) { box.appendChild(el("p", "pt-guide", p)); });

    if (many) jump.appendChild(el("p", "pt-jump-pod", pod.name));
    (pod.sections || []).forEach(function (sec, k) {
      var part = el("section", "pt-section");
      part.id = pod.id + "-" + (k + 1);
      var h = el("h3", "pt-section-head");
      h.appendChild(el("span", "pt-section-no", sec.no || String(k + 1)));
      h.appendChild(el("span", "pt-section-title", sec.title));
      part.appendChild(h);
      if (sec.intro) part.appendChild(el("p", "pt-section-intro", sec.intro));
      var list = el("ol", "pt-eps");
      (sec.items || []).forEach(function (ep) { list.appendChild(episodeRow(ep, pod)); });
      part.appendChild(list);
      if (sec.after) part.appendChild(el("p", "pt-after", sec.after));
      box.appendChild(part);

      // In the rail, a run of sections sharing a lead ("More subscriber
      // listening: …") gets it once, above them, and each its own part.
      var lead = leadOf(pod.sections, k), title = sec.title;
      if (lead) {
        if (leadOf(pod.sections, k - 1) !== lead) jump.appendChild(el("p", "pt-jump-lead", lead));
        title = sec.title.slice(lead.length + 2);
      }
      var a = el("a", lead ? "is-led" : null);
      a.href = "#" + part.id;
      a.appendChild(el("span", "pt-jump-no", sec.no || String(k + 1)));
      a.appendChild(el("span", "pt-jump-title", title));
      jump.appendChild(a);
    });

    if ((pod.notes || []).length || (pod.sources || []).length) {
      var notes = el("section", "pt-notes");
      notes.appendChild(el("h3", "pt-notes-head", t("Catalogue notes and sources")));
      (pod.notes || []).forEach(function (n) {
        if (n.title) notes.appendChild(el("p", "pt-notes-label", n.title));
        (n.text || []).forEach(function (p) { notes.appendChild(el("p", "pt-notes-text", p)); });
      });
      if ((pod.sources || []).length) {
        notes.appendChild(el("p", "pt-notes-label", t("Sources")));
        var ul = el("ul", "pt-sources");
        pod.sources.forEach(function (src) {
          var li = el("li");
          li.appendChild(outLink(src.href, "pt-link", src.label));
          ul.appendChild(li);
        });
        notes.appendChild(ul);
      }
      box.appendChild(notes);
    }
    return box;
  }

  /* ---------- the rail ---------------------------------------------------- */

  function progress(box, eps) {
    box.textContent = "";
    box.hidden = ticks === undefined;
    if (ticks === undefined) return;
    if (!ticks) {
      box.appendChild(el("p", "pt-owner-note", t("Couldn't load what's finished.")));
      return;
    }
    var done = eps.filter(function (e) { return e.done; }).length;
    var numbered = eps.filter(function (e) { return e.n != null; });
    var extras = eps.filter(function (e) { return e.n == null; });
    var count = function (list) { return list.filter(function (e) { return e.done; }).length; };
    var dl = el("dl", "pt-stats");
    [["Finished", done + " / " + eps.length],
     ["Episodes", count(numbered) + " / " + numbered.length],
     ["Extras", count(extras) + " / " + extras.length]].forEach(function (row, i) {
      var d = el("div", "pt-stat" + (i ? "" : " is-main"));
      d.appendChild(el("dt", null, t(row[0])));
      d.appendChild(el("dd", null, row[1]));
      dl.appendChild(d);
    });
    box.appendChild(dl);
    var bar = el("div", "pt-bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", t("Finished"));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(eps.length));
    bar.setAttribute("aria-valuenow", String(done));
    var fill = el("span", "pt-bar-fill");
    fill.style.width = (eps.length ? 100 * done / eps.length : 0).toFixed(2) + "%";
    bar.appendChild(fill);
    box.appendChild(bar);
    box.hidden = false;
  }

  // All, still to listen, or finished: rows that don't match are hidden,
  // and a section left with none goes too, with its line in the rail.
  function filter(col, jump, buttons) {
    var show = "all";
    try { show = localStorage.getItem(KEY) || "all"; } catch (e) {}
    function apply(which) {
      show = /^(all|open|done)$/.test(which) ? which : "all";
      col.setAttribute("data-show", show);
      // a row just ticked stays in view until the filter is used again
      Array.prototype.forEach.call(col.querySelectorAll(".pt-ep.is-fresh"), function (li) { li.classList.remove("is-fresh"); });
      buttons.forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-show") === show ? "true" : "false"); });
      Array.prototype.forEach.call(col.querySelectorAll(".pt-section"), function (sec) {
        var any = show === "all" || !!sec.querySelector(show === "done" ? ".pt-ep.is-done" : ".pt-ep:not(.is-done)");
        sec.hidden = !any;
        var a = jump.querySelector('a[href="#' + sec.id + '"]');
        if (a) a.hidden = !any;
      });
      // a shared lead goes with the last of its sections
      Array.prototype.forEach.call(jump.querySelectorAll(".pt-jump-lead"), function (lead) {
        var any = false;
        for (var n = lead.nextElementSibling; n && n.classList.contains("is-led"); n = n.nextElementSibling) {
          if (!n.hidden) any = true;
        }
        lead.hidden = !any;
      });
      light();
    }
    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        apply(b.getAttribute("data-show"));
        try { localStorage.setItem(KEY, show); } catch (e) {}
      });
    });
    apply(show);
  }

  // The section being read: the last whose heading has passed the top.
  var light = function () {};
  function lights(col, jump) {
    var links = Array.prototype.slice.call(jump.querySelectorAll("a"));
    var rail = jump.closest(".about-rail") || jump;
    var ticking = false;
    light = function () {
      ticking = false;
      var top = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--masthead-h")) || 64) + 48;
      var current = null;
      Array.prototype.forEach.call(col.querySelectorAll(".pt-section"), function (sec) {
        if (!sec.hidden && sec.getBoundingClientRect().top <= top) current = sec.id;
      });
      links.forEach(function (a) {
        var on = a.getAttribute("href") === "#" + current;
        a.classList.toggle("is-current", on);
        // The rail scrolls on its own when it is taller than the screen:
        // keep the lit line in view.
        if (on && rail.scrollHeight > rail.clientHeight) {
          var r = a.getBoundingClientRect(), box = rail.getBoundingClientRect();
          if (r.bottom > box.bottom - 8) rail.scrollTop += r.bottom - box.bottom + 48;
          else if (r.top < box.top + 8) rail.scrollTop -= box.top - r.top + 48;
        }
      });
    };
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(light); }
    }, { passive: true });
    window.addEventListener("resize", light);
    light();
  }

  /* ---------- ticking ----------------------------------------------------- */

  // A request to the Worker, given up after 10 s (reading the answer
  // included): {status, body} (body null when it isn't JSON).
  function call(method, path, body) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl && setTimeout(function () { ctl.abort(); }, 10000);
    var head = {};
    if (body) head["Content-Type"] = "application/json";
    return fetch(API + path, {
      method: method, headers: head, cache: "no-store", credentials: "omit",
      body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (b) {
        clearTimeout(timer);
        return { status: r.status, body: b };
      });
    }, function (err) { clearTimeout(timer); throw err; });
  }

  function loadTicks(list) {
    return call("GET", "/ticks?list=" + encodeURIComponent(list), null).then(function (r) {
      if (r.status !== 200 || !r.body || !r.body.done || typeof r.body.done !== "object") throw new Error("ticks");
      return r.body.done;
    });
  }

  // The rail's status line, for a tick that didn't save (one, kept, so a
  // screen reader hears each change).
  var note = null;
  function say(msg) { if (note) note.textContent = msg || ""; }

  // A click on a square: it changes at once, and back if the save fails.
  function toggle(row) {
    if (row.busy) return;
    var to = !row.ep.done;
    row.busy = true;
    row.ep.done = to;
    row.li.classList.add("is-saving", "is-fresh");
    paintMark(row);
    redraw();
    say("");
    call("PUT", "/ticks", { list: row.list, key: row.key, done: to }).then(function (r) {
      if (r.status === 200) return true;
      return Promise.reject(new Error("save"));
    }).catch(function () {
      row.ep.done = !to;
      paintMark(row);
      say(t("Couldn't save that. Try again."));
      return false;
    }).then(function (ok) {
      row.busy = false;
      row.li.classList.remove("is-saving");
      if (!ok) redraw();
    });
  }

  /* ---------- the page ---------------------------------------------------- */

  function render(data) {
    var pods = (data && data.podcasts) || [];
    var col = root.querySelector(".pt-podcasts"), jump = root.querySelector(".pt-jump");
    col.textContent = "";
    if (!pods.length) {
      col.appendChild(el("p", "pt-empty", t("Nothing on the list yet.")));
      return;
    }
    var eps = [];
    pods.forEach(function (pod) {
      (pod.sections || []).forEach(function (sec) {
        (sec.items || []).forEach(function (ep) { ep.done = false; });
        eps = eps.concat(sec.items || []);
      });
      col.appendChild(podcastBlock(pod, jump, pods.length > 1));
    });
    // The column was a live region only for "Loading…": the squares
    // changing all at once later shouldn't be read out.
    col.removeAttribute("aria-live");
    var box = root.querySelector(".pt-progress");
    redraw = function () { progress(box, eps); };
    redraw();
    jump.hidden = false;
    var bar = root.querySelector(".pt-filter");
    bar.setAttribute("aria-label", t(bar.getAttribute("aria-label")));
    Array.prototype.forEach.call(bar.querySelectorAll("button"), function (b) { b.textContent = t(b.textContent.trim()); });
    jump.setAttribute("aria-label", t(jump.getAttribute("aria-label")));
    lights(col, jump);

    note = el("p", "pt-owner-note");
    note.setAttribute("role", "status");
    bar.parentNode.insertBefore(note, bar.nextSibling);
    toHash();
  }

  // A link to a section (#the-rest-is-history-4): the anchor exists only
  // once the list is drawn.
  function toHash() {
    var target = null;
    try { target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) {}
    var col = root.querySelector(".pt-podcasts");
    if (target && col.contains(target) && !target.hidden) target.scrollIntoView();
  }

  // The ticks are in (got: {podcast id: {key: when}}), or couldn't be had
  // (null): every square shows its state, and the filter (which hides rows
  // by it) comes in only now.
  function applyTicks(pods, got) {
    ticks = got;
    pods.forEach(function (pod) {
      var mine = (got && got[pod.id]) || {};
      (pod.sections || []).forEach(function (sec) {
        (sec.items || []).forEach(function (ep) {
          var k = tickKey(ep);
          ep.done = !!(k && Object.prototype.hasOwnProperty.call(mine, k));
        });
      });
    });
    rows.forEach(paintMark);
    redraw();
    if (got) {
      var bar = root.querySelector(".pt-filter");
      bar.hidden = false;
      filter(root.querySelector(".pt-podcasts"), root.querySelector(".pt-jump"),
             Array.prototype.slice.call(bar.querySelectorAll("button")));
      if (location.hash) toHash();
    }
  }

  // The list draws at once; the ticks follow, and the list stays whole when
  // the Worker can't be reached.
  S.getJSON("data/podcasts.json").then(function (data) {
    render(data);
    var pods = (data && data.podcasts) || [], got = {};
    if (!pods.length) return;
    Promise.all(pods.map(function (pod) {
      return loadTicks(pod.id).then(function (done) { got[pod.id] = done; });
    })).then(function () { return got; }, function () { return null; })
      .then(function (res) { applyTicks(pods, res); });
  }, function () {
    var col = root.querySelector(".pt-podcasts");
    col.textContent = "";
    col.appendChild(el("p", "pt-empty", t("Couldn't load the list.")));
  });

})();
