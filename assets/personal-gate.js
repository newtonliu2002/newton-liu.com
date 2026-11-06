/* The Personal pages' password (Podcast Tracker, Travel Log, Chess), asked
   for 2026-11-06: "front door lock" (his pick). It hides the page until the
   "personal" Worker accepts the password, and a computer that has signed in
   stays signed in for a year (the Worker's token). It is a front door only:
   the site repo is public, so the data files behind these pages
   (data/podcasts.json, data/travel-*.json, data/chess*.json) can still be
   read by anyone who looks for them. See CLAUDE.md, "Personal password".

   Loaded in <head>, before the body exists, so the page never shows before
   the box does. Newton sets the password himself (Cloudflare dashboard:
   Worker "personal" → Settings → Variables → add a Secret named PASSWORD,
   8+ characters). Until then the Worker answers 503 and the box says so. */
(function () {
  "use strict";
  var root = document.documentElement;
  var KEY = "personal_token_v1";
  var API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /[?&]api=local\b/.test(location.search)
    ? "http://127.0.0.1:8788" : "https://personal.shoot-planner-worker.workers.dev";
  var asked = /[?&]lang=(zh|en)\b/.exec(location.search);
  var zh = asked ? asked[1] === "zh" : root.getAttribute("data-site-lang") === "zh";
  var T = zh ? {
    title: "个人页面", lead: "这些页面需要密码。", label: "密码", go: "进入",
    wrong: "密码不对。", many: "尝试次数太多，请一小时后再试。", unset: "还没有设置密码。",
    offline: "暂时连不上服务器，请稍后再试。", busy: "正在检查……"
  } : {
    title: "Personal", lead: "These pages need a password.", label: "Password", go: "Enter",
    wrong: "That password isn't right.", many: "Too many tries. Try again in an hour.",
    unset: "No password has been set yet.", offline: "Can't reach the server just now. Try again in a moment.",
    busy: "Checking…"
  };

  function getToken() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function setToken(t) { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) {} }

  // A token's own expiry (its payload is base64url JSON {role, exp}); the
  // Worker still has the last word, below.
  function unexpired(t) {
    try {
      var p = t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(p + "===".slice((p.length + 3) % 4))).exp * 1000 > Date.now();
    } catch (e) { return false; }
  }

  function call(method, path, body, token) {
    var head = {};
    if (body) head["Content-Type"] = "application/json";
    if (token) head.Authorization = "Bearer " + token;
    return fetch(API + path, {
      method: method, headers: head, cache: "no-store", credentials: "omit",
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.status; });
  }

  var css = document.createElement("style");
  css.textContent =
    "html.pg-locked main,html.pg-locked .footer{visibility:hidden}" +
    "html.pg-locked body{overflow:hidden}" +
    // the masthead stays above the box, so the nav still works
    // (!important: site.css and globe.css set its position with selectors this can't outrank)
    "html.pg-locked body .masthead{position:relative!important;z-index:var(--z-masthead,50)!important}" +
    ".pg-gate{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;" +
    "padding:96px 16px 16px;background:var(--bg,#121212);color:var(--text,#ededea);font-family:var(--sans,sans-serif)}" +
    "html:not(.pg-locked) .pg-gate{display:none}" +
    ".pg-gate form{width:100%;max-width:320px}" +
    ".pg-gate h1{margin:0 0 .5rem;font-size:.8rem;font-weight:500;letter-spacing:.24em;text-transform:uppercase}" +
    ".pg-gate p{margin:0 0 1.5rem;color:var(--text-dim,#a8a8a5);font-size:.95rem;line-height:1.5}" +
    ".pg-gate label{display:block;margin-bottom:.4rem;font-size:.75rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim,#a8a8a5)}" +
    ".pg-gate .pg-row{display:flex;gap:8px}" +
    ".pg-gate input{flex:1;min-width:0;padding:10px 12px;font:inherit;font-size:16px;color:inherit;background:var(--bg-raised,#1c1c1c);" +
    "border:1px solid var(--hairline-strong,rgba(255,255,255,.28));border-radius:0}" +
    ".pg-gate input:focus{outline:2px solid var(--accent,#d4a453);outline-offset:1px}" +
    ".pg-gate button{padding:10px 16px;font:inherit;font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;" +
    "color:inherit;background:none;border:1px solid var(--hairline-strong,rgba(255,255,255,.28));border-radius:0}" +
    ".pg-gate button:hover{background:var(--wash,rgba(255,255,255,.06))}" +
    ".pg-gate button:disabled{opacity:.5;cursor:default}" +
    ".pg-gate .pg-msg{min-height:1.5em;margin:.75rem 0 0;font-size:.9rem;color:var(--accent,#d4a453)}";
  document.head.appendChild(css);

  var token = getToken();
  var open = !!(token && unexpired(token));
  if (!open) { setToken(null); root.classList.add("pg-locked"); }

  // A remembered computer is let in at once, then asked about: a token the
  // Worker no longer takes (the password was changed) locks the page again.
  // A network failure leaves it open.
  if (open) {
    call("GET", "/session", null, token).then(function (status) {
      if (status === 401) { setToken(null); lock(); }
    }, function () {});
  }

  var gate = null;
  function build() {
    if (gate) return;
    gate = document.createElement("div");
    gate.className = "pg-gate";
    gate.innerHTML =
      '<form novalidate><h1></h1><p></p><label for="pg-pass"></label>' +
      '<div class="pg-row"><input id="pg-pass" type="password" autocomplete="current-password" required>' +
      '<button type="submit"></button></div><p class="pg-msg" role="status" aria-live="polite"></p></form>';
    gate.querySelector("h1").textContent = T.title;
    gate.querySelector("p").textContent = T.lead;
    gate.querySelector("label").textContent = T.label;
    gate.querySelector("button").textContent = T.go;
    var form = gate.querySelector("form"), input = gate.querySelector("input"),
        button = gate.querySelector("button"), msg = gate.querySelector(".pg-msg");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var pw = input.value;
      if (!pw) { input.focus(); return; }
      button.disabled = true;
      msg.textContent = T.busy;
      fetch(API + "/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", credentials: "omit",
        body: JSON.stringify({ password: pw })
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (b) { return { status: r.status, body: b }; });
      }).then(function (r) {
        button.disabled = false;
        if (r.status === 200 && r.body && r.body.token) {
          setToken(r.body.token);
          input.value = "";
          msg.textContent = "";
          root.classList.remove("pg-locked");
          // the globe pages size their map on resize
          try { window.dispatchEvent(new Event("resize")); } catch (e) {}
          return;
        }
        msg.textContent = r.status === 401 ? T.wrong : r.status === 429 ? T.many : r.status === 503 ? T.unset : T.offline;
        input.select();
      }, function () {
        button.disabled = false;
        msg.textContent = T.offline;
      });
    });
    document.body.appendChild(gate);
  }

  function lock() {
    root.classList.add("pg-locked");
    if (document.body) { build(); var i = gate.querySelector("input"); if (i) i.focus(); }
    else document.addEventListener("DOMContentLoaded", lock);
  }

  if (!open) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", lock);
    else lock();
  }
})();
