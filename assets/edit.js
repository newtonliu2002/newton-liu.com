/* ==========================================================================
   newton-liu.com — the words layer.

   Two jobs, and it always does the first one:

     1. On every page load, overlay data/text.json onto the page. Any element
        carrying data-edit="<key>" takes its text from that file if the key is
        present there. If the file is missing or the key isn't in it, whatever
        is written in the HTML stands. So the HTML is the default and
        text.json is the override.

     2. When the URL ends in ?edit, turn those same elements into something
        you can type into, and give you a bar at the top with a Save button.

   Saving writes data/text.json (page copy) and data/collections.json
   (collection titles, subtitles and blurbs) — whichever actually changed. If
   a GitHub token has been pasted into the settings panel it commits straight
   to the repo and GitHub Pages redeploys; if not, it hands you the files to
   drop in yourself.

   No libraries, no build step, and nothing in this file runs for a visitor
   who hasn't put ?edit in the URL.
   ========================================================================== */

(function () {
  "use strict";

  /* ---- config ---------------------------------------------------------
     The only two things in this file worth changing. REPO is where Save
     commits to; BRANCH is the branch GitHub Pages serves.
     ------------------------------------------------------------------- */
  var REPO   = "newtonliu2002/newton-liu.com";
  var BRANCH = "main";

  var TOKEN_KEY = "nl-edit-token";

  var body = document.body;
  var BASE = body.dataset.base || "";
  var SLUG = body.dataset.collection || "";
  var EDITING = /[?&]edit\b/.test(location.search);

  /* ---- helpers -------------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function getJSON(path) {
    return fetch(BASE + path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + ": HTTP " + r.status);
      return r.json();
    });
  }

  // btoa() only speaks Latin-1. Anything with an accent or a curly quote in
  // it — which is most of this site's copy — has to go through UTF-8 first.
  function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  /* ---- the slots ------------------------------------------------------
     A slot is one editable thing on the page: where it lives, what key it
     saves under, and whether it holds a single line or a block of prose.
     ------------------------------------------------------------------- */

  function slots() {
    var found = [];
    var nodes = document.querySelectorAll("[data-edit]");
    for (var i = 0; i < nodes.length; i++) {
      found.push({
        node: nodes[i],
        key:   nodes[i].getAttribute("data-edit"),
        rich:  nodes[i].hasAttribute("data-edit-rich"),
        lines: nodes[i].hasAttribute("data-edit-lines")
      });
    }
    return found;
  }

  /* ---- job 1: overlay text.json --------------------------------------- */

  function applyText(text) {
    slots().forEach(function (slot) {
      if (!Object.prototype.hasOwnProperty.call(text, slot.key)) return;
      var value = text[slot.key];
      if (slot.rich) slot.node.innerHTML = clean(value);
      else slot.node.textContent = value;
    });
  }

  /* ---- jump links -----------------------------------------------------
     The rail on a prose page lists that page's own headings. If the words
     get rewritten the old list would point at headings that no longer exist,
     so it is rebuilt from whatever headings are actually on the page. Links
     in the markup that go somewhere else (Contact, say) are kept, and kept
     last.
     ------------------------------------------------------------------- */

  function slugify(s) {
    var slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    // Long enough to stay unique, short enough to be a URL someone could type.
    if (slug.length > 48) slug = slug.slice(0, 48).replace(/-[^-]*$/, "");
    return slug || "section";
  }

  function rebuildJumps() {
    var navs = document.querySelectorAll("[data-jump-from]");
    Array.prototype.forEach.call(navs, function (nav) {
      var source = document.querySelector(nav.getAttribute("data-jump-from"));
      if (!source) return;

      var elsewhere = Array.prototype.filter.call(nav.querySelectorAll("a"), function (a) {
        return (a.getAttribute("href") || "").charAt(0) !== "#";
      });
      var heads = source.querySelectorAll("h2, h3");
      if (!heads.length && !elsewhere.length) return;

      nav.textContent = "";
      Array.prototype.forEach.call(heads, function (h) {
        if (!h.id) h.id = slugify(h.textContent);
        var a = el("a", null, h.textContent);
        a.href = "#" + h.id;
        nav.appendChild(a);
      });
      elsewhere.forEach(function (a) { nav.appendChild(a); });
    });
  }

  /* ---- sanitising -----------------------------------------------------
     Rich slots are stored and re-inserted as HTML, so the set of tags that
     survives a round trip is deliberately small: enough to write an About
     page with, and nothing that can run.
     ------------------------------------------------------------------- */

  var ALLOWED = {
    P: 1, H2: 1, H3: 1, BR: 1, EM: 1, STRONG: 1, I: 1, B: 1,
    A: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1
  };

  function clean(html) {
    var box = document.createElement("div");
    box.innerHTML = String(html == null ? "" : html);
    scrub(box);
    // The indentation of the HTML source is not part of the prose. HTML
    // collapses it on render anyway; collapsing it here keeps text.json
    // readable and its diffs small.
    return box.innerHTML.replace(/\s*\n\s*/g, " ").trim();
  }

  function scrub(root) {
    var kids = Array.prototype.slice.call(root.children);
    kids.forEach(function (node) {
      if (!ALLOWED[node.tagName]) {
        // Keep the words, drop the tag.
        while (node.firstChild) root.insertBefore(node.firstChild, node);
        root.removeChild(node);
        return;
      }
      // id, class, rel, and a non-javascript href survive; everything else
      // goes. class has to stay: the contact list on contact.html is a
      // styling hook living inside an editable block, and stripping it would
      // flatten the page the first time it was saved.
      var attrs = Array.prototype.slice.call(node.attributes);
      attrs.forEach(function (a) {
        var keep = a.name === "id" || a.name === "class" || a.name === "rel" ||
                   (node.tagName === "A" && a.name === "href" &&
                    !/^\s*javascript:/i.test(a.value));
        if (!keep) node.removeAttribute(a.name);
      });
      scrub(node);
    });
  }

  /* ---- boot ----------------------------------------------------------- */

  // Every key in text.json, including the ones belonging to other pages.
  // Saving merges into this rather than replacing it — the Save button on the
  // home page must not delete what the About page put there.
  var everything = {};

  getJSON("data/text.json")
    .then(function (file) {
      everything = (file && file.text) || {};
      applyText(everything);
    })
    .catch(function () { /* No file, or offline. The HTML defaults stand. */ })
    .then(function () {
      rebuildJumps();
      if (EDITING) startEditing();
    });

  /* ======================================================================
     EDIT MODE
     ====================================================================== */

  var dirty = false;
  var baseline = {};      // key -> value as it was when editing began
  var collections = null; // the parsed collections.json, on gallery pages


  // A plain slot's text is read with its whitespace collapsed, because the
  // indentation of the HTML source is not part of the sentence. A slot marked
  // data-edit-lines keeps its newlines — the hero title's line break is a
  // decision, not stray formatting.
  function currentValue(slot) {
    if (slot.rich) return clean(slot.node.innerHTML);
    if (!slot.lines) return slot.node.textContent.replace(/\s+/g, " ").trim();

    // A <br> is worth no characters in textContent, so the break in the
    // markup would be lost on the first read. Turn breaks into newlines
    // first — which also catches the <br> a browser inserts when Enter is
    // pressed in a plain-text field.
    var box = document.createElement("div");
    box.innerHTML = slot.node.innerHTML.replace(/<br\s*\/?>/gi, "\n");
    return box.textContent
      .replace(/[ \t]+/g, " ")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .trim();
  }

  function startEditing() {
    body.classList.add("is-editing");
    document.title = "✏️ " + document.title;

    // Firefox and Safari default to <div> on Enter, which would break the
    // prose styling. Ask for paragraphs instead.
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) {}

    var ready = SLUG
      ? getJSON("data/collections.json").then(function (f) {
          collections = f;
          waitForGallery();
        }).catch(function () {})
      : Promise.resolve();

    ready.then(function () {
      slots().forEach(function (slot) {
        baseline[slot.key] = currentValue(slot);
        arm(slot);
      });
      buildBar();
    });
  }

  // On a collection page the heading, subtitle and blurb are written by
  // site.js once collections.json arrives. Editing has to start after that,
  // or the baseline would be a snapshot of three empty elements.
  function waitForGallery() {
    var meta = null;
    ((collections && collections.collections) || []).forEach(function (c) {
      if (c.slug === SLUG) meta = c;
    });
    if (!meta) return;

    var map = [
      [".gallery-title", "title",    "Collection title"],
      [".gallery-sub",   "subtitle", "Add a subtitle"],
      [".gallery-blurb", "blurb",    "Add a few words about this trip"]
    ];
    map.forEach(function (row) {
      var node = document.querySelector(row[0]);
      if (!node) return;
      node.setAttribute("data-edit", "collection." + SLUG + "." + row[1]);
      node.setAttribute("data-edit-hint", row[2]);
      // site.js may not have run yet; seed from the file so the baseline and
      // the visible text agree either way.
      node.textContent = meta[row[1]] || "";
    });
  }

  function arm(slot) {
    var node = slot.node;
    node.contentEditable = slot.rich ? "true" : "plaintext-only";
    // Safari has no plaintext-only; it falls back to inheriting, so force it.
    if (!slot.rich && node.contentEditable !== "plaintext-only") {
      node.contentEditable = "true";
      node.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") ev.preventDefault();
      });
    }
    node.setAttribute("spellcheck", "true");
    node.addEventListener("input", markDirty);
    node.addEventListener("paste", pasteAsText);
    if (slot.rich) node.addEventListener("blur", rebuildJumps);
  }

  // Pasting from a document otherwise drags in fonts, colours and spans.
  function pasteAsText(ev) {
    ev.preventDefault();
    var text = (ev.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, text);
  }

  function markDirty() {
    if (dirty) return;
    dirty = true;
    var save = document.getElementById("nl-save");
    if (save) { save.disabled = false; save.textContent = "Save"; }
  }

  /* ---- what changed --------------------------------------------------- */

  // Every slot on the page, split by the file it belongs to, plus a count of
  // how many actually moved in each — so a changed blurb doesn't drag an
  // untouched text.json into the commit alongside it.
  function changes() {
    var out = { text: {}, collections: {}, textMoved: 0, collectionsMoved: 0 };
    slots().forEach(function (slot) {
      var now = currentValue(slot);
      var isCollection = /^collection\./.test(slot.key);
      out[isCollection ? "collections" : "text"][slot.key] = now;
      if (now !== baseline[slot.key]) {
        out[isCollection ? "collectionsMoved" : "textMoved"]++;
      }
    });
    out.count = out.textMoved + out.collectionsMoved;
    return out;
  }

  /* ---- the bar -------------------------------------------------------- */

  function buildBar() {
    var bar = el("div", "nl-bar");
    bar.id = "nl-bar";

    bar.appendChild(el("span", "nl-bar-label", "Editing"));
    bar.appendChild(el("span", "nl-bar-hint",
      "Click any highlighted text and type. Enter makes a new paragraph."));

    var right = el("span", "nl-bar-actions");

    var save = el("button", "nl-btn nl-btn-go", "Saved");
    save.id = "nl-save";
    save.type = "button";
    save.disabled = true;
    save.addEventListener("click", save1);
    right.appendChild(save);

    var done = el("button", "nl-btn", "Done");
    done.type = "button";
    done.addEventListener("click", function () {
      if (dirty && !confirm("You have unsaved changes. Leave anyway?")) return;
      location.search = location.search.replace(/[?&]edit\b/, "") || "";
    });
    right.appendChild(done);

    var cog = el("button", "nl-btn nl-btn-quiet", "⚙");
    cog.type = "button";
    cog.title = "Publishing settings";
    cog.addEventListener("click", toggleSettings);
    right.appendChild(cog);

    bar.appendChild(right);
    body.appendChild(bar);
    body.appendChild(buildSettings());
    body.appendChild(buildFormatBar());

    document.addEventListener("selectionchange", showFormatBar);

    document.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "s") {
        ev.preventDefault();
        if (dirty) save1();
      }
    });

    window.addEventListener("beforeunload", function (ev) {
      if (!dirty) return;
      ev.preventDefault();
      ev.returnValue = "";
    });
  }

  function say(message, bad) {
    var bar = document.getElementById("nl-bar");
    if (!bar) return;
    var hint = bar.querySelector(".nl-bar-hint");
    hint.textContent = message;
    hint.classList.toggle("is-bad", !!bad);
  }

  /* ---- the format bar -------------------------------------------------
     Appears over a selection inside a prose block. execCommand is formally
     deprecated and formally irreplaceable: every browser still implements
     it, and the alternative is a rich-text library.
     ------------------------------------------------------------------- */

  function buildFormatBar() {
    var fb = el("div", "nl-format");
    fb.id = "nl-format";
    [
      ["B",  "bold",         "Bold"],
      ["I",  "italic",       "Italic"],
      ["H",  "heading",      "Section heading"],
      ["¶",  "paragraph",    "Plain paragraph"],
      ["🔗", "link",         "Link"]
    ].forEach(function (row) {
      var b = el("button", "nl-fmt", row[0]);
      b.type = "button";
      b.title = row[2];
      b.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
      b.addEventListener("click", function () { format(row[1]); });
      fb.appendChild(b);
    });
    return fb;
  }

  function format(what) {
    if (what === "heading")   document.execCommand("formatBlock", false, "h2");
    else if (what === "paragraph") document.execCommand("formatBlock", false, "p");
    else if (what === "link") {
      var href = prompt("Link to:", "https://");
      if (href) document.execCommand("createLink", false, href);
    } else document.execCommand(what, false, null);
    markDirty();
  }

  function showFormatBar() {
    var fb = document.getElementById("nl-format");
    if (!fb) return;

    var sel = window.getSelection();
    var hide = !sel || sel.isCollapsed || !sel.rangeCount;

    // Only over prose. A selection dragged across the page, or one sitting in
    // a single-line slot, gets no formatting bar — there is nothing it could
    // usefully do there.
    if (!hide) {
      var at = sel.anchorNode;
      if (at && at.nodeType === 3) at = at.parentNode;
      hide = !(at && at.closest && at.closest("[data-edit-rich]"));
    }
    if (hide) { fb.classList.remove("is-on"); return; }

    var box = sel.getRangeAt(0).getBoundingClientRect();
    if (!box.width) { fb.classList.remove("is-on"); return; }
    fb.classList.add("is-on");
    fb.style.top  = (box.top + window.scrollY - fb.offsetHeight - 8) + "px";
    fb.style.left = (box.left + window.scrollX + box.width / 2 - fb.offsetWidth / 2) + "px";
  }

  /* ---- settings ------------------------------------------------------- */

  function buildSettings() {
    var panel = el("div", "nl-settings");
    panel.id = "nl-settings";
    panel.hidden = true;

    panel.appendChild(el("h2", null, "Publishing"));
    panel.appendChild(el("p", null,
      "Without a token, Save hands you the changed files to upload yourself. " +
      "With one, Save commits straight to GitHub and the site updates in about a minute."));

    var input = el("input");
    input.id = "nl-token";
    input.type = "password";
    input.placeholder = "github_pat_…";
    input.value = localStorage.getItem(TOKEN_KEY) || "";
    panel.appendChild(input);

    panel.appendChild(el("p", "nl-fine",
      "A fine-grained token, scoped to this one repository, with Contents set " +
      "to Read and write. It is kept in this browser only — never in the repo. " +
      "Don't paste one on a shared computer."));

    var row = el("div", "nl-settings-row");

    var keep = el("button", "nl-btn nl-btn-go", "Save token");
    keep.type = "button";
    keep.addEventListener("click", function () {
      var v = input.value.trim();
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
      panel.hidden = true;
      say(v ? "Token stored in this browser." : "Token removed.");
    });
    row.appendChild(keep);

    var shut = el("button", "nl-btn", "Close");
    shut.type = "button";
    shut.addEventListener("click", function () { panel.hidden = true; });
    row.appendChild(shut);

    panel.appendChild(row);
    return panel;
  }

  function toggleSettings() {
    var p = document.getElementById("nl-settings");
    p.hidden = !p.hidden;
  }

  /* ---- saving ---------------------------------------------------------- */

  // This page's slots laid over everything already in the file, with the keys
  // sorted so the file reads in a stable order and diffs stay small.
  function merged(mine) {
    var all = {};
    var keys = Object.keys(everything).concat(Object.keys(mine));
    keys.sort().forEach(function (k) {
      if (all[k] === undefined) {
        all[k] = Object.prototype.hasOwnProperty.call(mine, k) ? mine[k] : everything[k];
      }
    });
    return all;
  }

  function save1() {
    var diff = changes();
    if (!diff.count) { say("Nothing has changed."); return; }

    var files = [];

    if (diff.textMoved) files.push({
      path: "data/text.json",
      body: JSON.stringify({
        _comment: "Every word on the site that isn't a photograph's own data. " +
                  "Add ?edit to any page to write these in the browser, or " +
                  "edit them here \u2014 both end up in the same place. A key " +
                  "here overrides whatever the HTML says; delete a key to " +
                  "hand that slot back to the HTML.",
        text: merged(diff.text)
      }, null, 2) + "\n"
    });

    if (diff.collectionsMoved && collections) {
      collections.collections.forEach(function (c) {
        ["title", "subtitle", "blurb"].forEach(function (field) {
          var key = "collection." + c.slug + "." + field;
          if (Object.prototype.hasOwnProperty.call(diff.collections, key)) {
            c[field] = diff.collections[key];
          }
        });
      });
      files.push({
        path: "data/collections.json",
        body: JSON.stringify(collections, null, 2) + "\n"
      });
    }

    var token = localStorage.getItem(TOKEN_KEY);
    if (token) commit(files, token);
    else handOver(files);
  }

  // No token: give him the files. Nothing leaves the browser.
  function handOver(files) {
    files.forEach(function (f) {
      var blob = new Blob([f.body], { type: "application/json" });
      var a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = f.path.split("/").pop();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    });
    dirty = false;
    var save = document.getElementById("nl-save");
    save.disabled = true;
    save.textContent = "Saved";
    var names = files.map(function (f) { return f.path; });
    say("Downloaded " + names.join(" and ") + " — put " +
        (names.length > 1 ? "them" : "it") + " back into the repo over the old " +
        (names.length > 1 ? "files" : "file") + ", or add a token in \u2699 to skip this step.");
  }

  // Token: one commit per file, in sequence. GitHub needs the current blob
  // sha to accept an update, so each file is a read then a write.
  function commit(files, token) {
    var save = document.getElementById("nl-save");
    save.disabled = true;
    save.textContent = "Publishing…";
    say("Publishing to GitHub…");

    var api = "https://api.github.com/repos/" + REPO + "/contents/";
    var head = {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json"
    };

    files.reduce(function (chain, f) {
      return chain.then(function () {
        return fetch(api + f.path + "?ref=" + BRANCH, { headers: head })
          .then(function (r) { return r.ok ? r.json() : { sha: undefined }; })
          .then(function (meta) {
            return fetch(api + f.path, {
              method: "PUT",
              headers: head,
              body: JSON.stringify({
                message: "Edit site copy from the browser",
                content: toBase64(f.body),
                sha: meta.sha,
                branch: BRANCH
              })
            });
          })
          .then(function (r) {
            if (!r.ok) {
              return r.json().then(function (e) {
                throw new Error(f.path + ": " + (e.message || r.status));
              });
            }
          });
      });
    }, Promise.resolve())
      .then(function () {
        dirty = false;
        save.textContent = "Saved";
        say("Published. The live site updates in about a minute.");
      })
      .catch(function (err) {
        save.disabled = false;
        save.textContent = "Save";
        say(err.message + " — check the token in ⚙, or Save without one to " +
            "download the files instead.", true);
      });
  }
})();
