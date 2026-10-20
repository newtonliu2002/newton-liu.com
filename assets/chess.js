/* ==========================================================================
   newton-liu.com — the chess database (chess-games.html): every game from
   Newton's tournaments. The map (chess.html, chess-map.js) pins each
   tournament and links here, to its section: chess-games.html#<id>.

   Everything on it is data/chess.json (see CLAUDE.md, "Chess"):
   tournaments, newest first, each with its games. A game is a round, his
   colour, the opponent (and rating), the result and its chess.com `link`.
   A PGN (`pgn`) is optional: its tags fill in whatever the entry leaves out
   (White, Black, Result, Round, Date, WhiteElo, BlackElo) and its moves
   become a board to step through under the row. A bye is
   { "round": 4, "bye": 0.5 }.

   No chess library: the PGN reader below knows just enough of the rules to
   place each move (which knight, en passant, castling, promotion, a piece
   pinned to its king). Reads through window.NLSite like the other pages.
   ========================================================================== */

(function () {
  "use strict";

  var S = window.NLSite;
  var root = document.querySelector(".chess");
  if (!S || !root) return;
  var t = S.t, ZH = S.lang() === "zh";

  // The rules (FEN, legal moves, notation, the PGN reader) are
  // assets/chess-core.js, shared with the map and the analysis tool.
  var R = window.NLChessCore;
  if (!R) return;
  var GLYPH = { K: "\u265A", Q: "\u265B", R: "\u265C", B: "\u265D", N: "\u265E", P: "\u265F" };

  /* ---------- the data -------------------------------------------------- */

  var player = [];

  function isMe(name) {
    var n = String(name || "").toLowerCase().replace(/[^a-z]/g, "");
    return n && player.some(function (p) { return String(p).toLowerCase().replace(/[^a-z]/g, "") === n; });
  }

  // His points from a result: a PGN result ("1-0") read by his colour, or
  // his own word ("win", "draw", "loss", "1", "½", "0").
  function pointsOf(result, color) {
    var r = String(result == null ? "" : result).trim().toLowerCase().replace(/\s/g, "");
    if (/^(win|w|1|\+)$/.test(r)) return 1;
    if (/^(loss|lose|lost|l|0|-)$/.test(r)) return 0;
    if (/^(draw|d|½|0\.5|1\/2|=)$/.test(r)) return 0.5;
    if (/^(1\/2-1\/2|½-½)$/.test(r)) return 0.5;
    if (r === "1-0" || r === "1-0f") return color === "black" ? 0 : color ? 1 : null;
    if (r === "0-1" || r === "0-1f") return color === "white" ? 0 : color ? 1 : null;
    return null;
  }

  function gameOf(raw, tournament, key) {
    var g = {}, k;
    for (k in raw) if (Object.prototype.hasOwnProperty.call(raw, k)) g[k] = raw[k];
    if (g.bye != null) {
      g.points = typeof g.bye === "number" ? g.bye : 0;
      return g;
    }
    if (g.pgn) {
      g.line = R.readPGN(g.pgn);
      var tg = g.line.tags;
      if (!g.color) g.color = isMe(tg.Black) && !isMe(tg.White) ? "black" : isMe(tg.White) ? "white" : null;
      if (!g.opponent && g.color) g.opponent = g.color === "white" ? tg.Black : tg.White;
      if (g.opponentRating == null && g.color) g.opponentRating = +(g.color === "white" ? tg.BlackElo : tg.WhiteElo) || null;
      if (g.rating == null && g.color) g.rating = +(g.color === "white" ? tg.WhiteElo : tg.BlackElo) || null;
      if (g.result == null && tg.Result && tg.Result !== "*") g.result = tg.Result;
      if (g.round == null && tg.Round && !/^\s*[-?]\s*$/.test(tg.Round)) g.round = tg.Round;   // chess.com writes "-"
      if (!g.date && tg.Date && !/\?/.test(tg.Date)) g.date = tg.Date.replace(/\./g, "-");
      if (!g.eco && tg.ECO) g.eco = tg.ECO;
      if (!g.opening && tg.Opening) g.opening = tg.Opening + (tg.Variation ? ": " + tg.Variation : "");
    }
    g.points = pointsOf(g.result, g.color);
    g.tournament = tournament;
    g.key = key;
    return g;
  }

  /* ---------- words and numbers ---------------------------------------- */

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                "August", "September", "October", "November", "December"];

  function ymd(s) {
    var m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(String(s || ""));
    return m ? { y: +m[1], m: +m[2], d: m[3] ? +m[3] : 0 } : null;
  }

  // "October 11–12, 2026", "September 30 – October 1, 2026"; in Chinese
  // 2026年10月11–12日. A date that doesn't read is shown as written.
  function dateRange(from, to) {
    var a = ymd(from), b = ymd(to) || a;
    if (!a) return from || "";
    if (ZH) {
      var head = a.y + "年" + a.m + "月" + (a.d ? a.d + "日" : "");
      if (b === a || (b.y === a.y && b.m === a.m && b.d === a.d)) return head;
      if (b.y === a.y && b.m === a.m) return a.y + "年" + a.m + "月" + a.d + "–" + b.d + "日";
      return head + "–" + (b.y !== a.y ? b.y + "年" : "") + b.m + "月" + (b.d ? b.d + "日" : "");
    }
    var ma = MONTHS[a.m - 1], mb = MONTHS[b.m - 1];
    if (!a.d) return ma + " " + a.y;
    if (b === a || (b.y === a.y && b.m === a.m && b.d === a.d)) return ma + " " + a.d + ", " + a.y;
    if (b.y === a.y && b.m === a.m) return ma + " " + a.d + "–" + b.d + ", " + a.y;
    if (b.y === a.y) return ma + " " + a.d + " – " + mb + " " + b.d + ", " + a.y;
    return ma + " " + a.d + ", " + a.y + " – " + mb + " " + b.d + ", " + b.y;
  }

  function score(n) {
    if (n == null) return "";
    var whole = Math.floor(n), half = n - whole >= 0.5;
    return half ? (whole ? whole + "½" : "½") : String(whole);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------- the engine's analysis (data/chess-eval.json) ------------- */

  // Written on Newton's Mac by tools/chess-eval.mjs: per game (by key), the
  // evaluation of every position (`ev`: `c` centipawns or `m` mate, White's
  // side; `mated`: the side checkmated; `b` the best move, `pv` the line),
  // and each move's mark (`j`: "?!", "?", "??"). Loaded when the first
  // board opens; a game whose moves have changed since (`uci`) is skipped.
  var evals = null;
  function loadEvals() {
    return evals || (evals = S.getJSON("data/chess-eval.json").then(function (d) { return d || {}; },
                                                                   function () { return {}; }));
  }
  function analysisFor(game, data) {
    var a = data && data.games && data.games[game.key];
    if (!a || !game.line || a.uci !== game.line.moves.map(function (m) { return m.uci; }).join(" ")) return null;
    if (!a.ev || a.ev.length !== game.line.positions.length) return null;
    return { ev: a.ev, j: a.j || [], depth: a.depth || data.depth, engine: data.engine || "Stockfish" };
  }

  var MARK_WORD = { "?!": "Inaccuracy", "?": "Mistake", "??": "Blunder" };
  var MARK_CLASS = { "?!": "is-inaccuracy", "?": "is-mistake", "??": "is-blunder" };

  // White's share of the bar, 0…1.
  function whiteShare(e) {
    if (!e) return .5;
    if (e.mated) return e.mated === "w" ? 0 : 1;
    if (e.m != null) return e.m > 0 ? 1 : 0;
    return (R.winning(e.c || 0) + 1) / 2;
  }
  // "+0.45", "−1.20", "#3", "#−2" (mate, from White's side).
  function evalText(e) {
    if (!e) return "";
    if (e.mated) return e.mated === "w" ? "0–1" : "1–0";
    if (e.m != null) return "#" + (e.m < 0 ? "−" + -e.m : e.m);
    var v = (e.c || 0) / 100;
    return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2);
  }
  // An engine line with its move numbers, from the position after `p` half-moves.
  function numbered(line, p, pv) {
    var n = line.first + p, out = [];
    String(pv || "").split(" ").filter(Boolean).forEach(function (s, i) {
      if ((n + i) % 2 === 0) out.push(Math.floor((n + i) / 2) + 1 + ". " + s);
      else out.push(i ? s : Math.floor((n + i) / 2) + 1 + "… " + s);
    });
    return out.join(" ");
  }

  /* ---------- the board ------------------------------------------------- */

  var AUTOPLAY_MS = 1000;                  // one move a second when it plays itself
  var SVG = "http://www.w3.org/2000/svg";

  // A board to step through one game's main line, flipped when he had
  // black: ← → Home End while it has focus, Space plays and pauses. With the
  // engine's analysis: the eval bar, the graph under the board (click to
  // jump), the marks in the move list and the best line for each position.
  function viewer(game, data) {
    var line = game.line, flip = game.color === "black", N = line.moves.length;
    var an = analysisFor(game, data);
    var box = el("div", "cg-viewer");

    var left = el("div", "cg-left");
    var boardRow = el("div", "cg-boardrow" + (an ? " has-bar" : ""));
    var evalbar = null;
    if (an) {
      evalbar = el("div", "cg-evalbar" + (flip ? " is-flipped" : ""));
      evalbar.setAttribute("aria-hidden", "true");
      evalbar.appendChild(el("i"));
      boardRow.appendChild(evalbar);
    }
    var board = el("div", "cg-board");
    board.setAttribute("role", "img");
    var cells = [];
    for (var v = 0; v < 64; v++) {
      var r = flip ? v >> 3 : 7 - (v >> 3), f = flip ? 7 - (v & 7) : v & 7, i = r * 8 + f;
      var cell = el("div", "cg-sq " + ((r + f) % 2 ? "is-light" : "is-dark"));
      if ((v & 7) === 0) cell.appendChild(el("span", "cg-rank", String(r + 1)));
      if (v >> 3 === 7) cell.appendChild(el("span", "cg-file", "abcdefgh".charAt(f)));
      cell.appendChild(el("span", "cg-piece"));
      board.appendChild(cell);
      cells[i] = cell;
    }
    boardRow.appendChild(board);
    left.appendChild(boardRow);

    // The graph: White's share, move by move, as the bar shows it; the
    // marks as ticks; the current move as an amber line. Click to jump.
    var graph = null, cursor = null;
    if (an && N) {
      graph = document.createElementNS(SVG, "svg");
      graph.setAttribute("class", "cg-graph");
      graph.setAttribute("viewBox", "0 0 " + N + " 100");
      graph.setAttribute("preserveAspectRatio", "none");
      graph.setAttribute("aria-hidden", "true");
      var pts = an.ev.map(function (e, k) { return k + "," + (100 - 100 * whiteShare(e)).toFixed(1); });
      var area = document.createElementNS(SVG, "polygon");
      area.setAttribute("class", "cg-graph-white");
      area.setAttribute("points", "0,100 " + pts.join(" ") + " " + N + ",100");
      graph.appendChild(area);
      var mid = document.createElementNS(SVG, "line");
      mid.setAttribute("class", "cg-graph-mid");
      mid.setAttribute("x1", 0); mid.setAttribute("x2", N); mid.setAttribute("y1", 50); mid.setAttribute("y2", 50);
      graph.appendChild(mid);
      an.j.forEach(function (mark, k) {
        if (!mark) return;
        var tick = document.createElementNS(SVG, "line");
        tick.setAttribute("class", "cg-graph-tick " + MARK_CLASS[mark]);
        tick.setAttribute("x1", k + 1); tick.setAttribute("x2", k + 1);
        tick.setAttribute("y1", 0); tick.setAttribute("y2", 100);
        graph.appendChild(tick);
      });
      cursor = document.createElementNS(SVG, "line");
      cursor.setAttribute("class", "cg-graph-cursor");
      cursor.setAttribute("y1", 0); cursor.setAttribute("y2", 100);
      graph.appendChild(cursor);
      graph.addEventListener("click", function (e) {
        var rect = graph.getBoundingClientRect();
        go(Math.round((e.clientX - rect.left) / rect.width * N));
      });
      left.appendChild(graph);
    }

    var bar = el("div", "cg-bar");
    function button(label, glyph, step) {
      var b = el("button", "cg-step", glyph);
      b.type = "button";
      b.setAttribute("aria-label", t(label));
      b.title = t(label);
      b.addEventListener("click", function () { go(step(ply)); });
      bar.appendChild(b);
      return b;
    }
    var bFirst = button("Start", "⏮︎", function () { return 0; });
    var bPrev = button("Previous move", "‹", function (p) { return p - 1; });
    var bPlay = el("button", "cg-step cg-play", "▶︎");
    bPlay.type = "button";
    bPlay.setAttribute("aria-pressed", "false");
    bPlay.setAttribute("aria-label", t("Play through"));
    bPlay.title = t("Play through");
    bPlay.addEventListener("click", function () { autoplay(!timer); });
    bar.appendChild(bPlay);
    var bNext = button("Next move", "›", function (p) { return p + 1; });
    var bLast = button("End", "⏭︎", function () { return N; });
    var readout = el("span", "cg-readout");
    readout.setAttribute("aria-live", "polite");
    bar.appendChild(readout);

    // What the engine says: the mark on the move just played (and what it
    // preferred), then this position's evaluation and best line.
    var engine = an ? el("div", "cg-engine") : null, verdict = null, best = null;
    if (engine) {
      verdict = engine.appendChild(el("p", "cg-verdict"));
      best = engine.appendChild(el("p", "cg-best"));
    }

    var list = el("ol", "cg-moves"), marks = [];
    var li = null;
    line.moves.forEach(function (mv, k) {
      var n = line.first + k;
      if (n % 2 === 0 || !li) {
        li = el("li");
        li.appendChild(el("span", "cg-num", R.moveNumber(line, k)));
        if (n % 2) li.appendChild(el("span", "cg-move is-blank"));
        list.appendChild(li);
      }
      var b = el("button", "cg-move", mv.san);
      b.type = "button";
      var mark = an && an.j[k];
      if (mark) {
        b.classList.add(MARK_CLASS[mark]);
        b.appendChild(el("span", "cg-mark", mark)).setAttribute("aria-hidden", "true");
        b.setAttribute("aria-label", mv.san + ", " + t(MARK_WORD[mark]));
      }
      b.addEventListener("click", function () { go(k + 1); });
      li.appendChild(b);
      marks.push(b);
    });

    var note = el("p", "cg-movenote");
    var side = el("div", "cg-side");
    side.appendChild(bar);
    if (engine) side.appendChild(engine);
    side.appendChild(list);
    if (line.broken) side.appendChild(el("p", "cg-broken", t("The rest of this game's moves couldn't be read.")));
    side.appendChild(note);

    // Each side's marks, and where the analysis comes from.
    if (an) {
      var sum = el("div", "cg-summary");
      ["w", "b"].forEach(function (c) {
        var count = { "?!": 0, "?": 0, "??": 0 };
        an.j.forEach(function (mark, k) { if (mark && line.positions[k].turn === c) count[mark]++; });
        var p = el("p");
        p.appendChild(el("span", "cg-summary-side", t(c === "w" ? "White" : "Black")));
        ["?!", "?", "??"].forEach(function (m) {
          var s = el("span", "cg-summary-n " + MARK_CLASS[m] + (count[m] ? "" : " is-zero"), count[m] + " " + m);
          s.title = t(MARK_WORD[m]);
          p.appendChild(s);
        });
        sum.appendChild(p);
      });
      sum.appendChild(el("p", "cg-credit", t("{engine}, depth {depth}", { engine: an.engine, depth: an.depth })));
      side.appendChild(sum);
    }

    // Elsewhere: the same move on lichess's analysis board, and Claude.
    var tools = el("p", "cg-tools");
    var lichess = el("a", "cg-tool", t("Analyse on lichess") + " ↗");
    lichess.target = "_blank"; lichess.rel = "noopener";
    tools.appendChild(lichess);
    var claude = el("a", "cg-tool", t("Ask Claude") + " ↗");
    var phone = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
    if (phone) { claude.target = "_blank"; claude.rel = "noopener"; }
    claude.title = t("Opens Claude with this position and the engine's view; the text is copied too");
    tools.appendChild(claude);
    // On a laptop the link asks for the Claude app; nothing tells a page
    // whether that worked, so the status offers claude.ai itself, a link
    // the visitor clicks (no detection, no pop-up blocker), and the same
    // text goes to the clipboard.
    var status = el("span", "cg-tool-status");
    status.setAttribute("aria-live", "polite");
    tools.appendChild(status);
    var statusTimer = 0;
    claude.addEventListener("click", function () {
      var text = claudePrompt(game, an, ply);
      status.textContent = "";
      if (!phone) {
        status.appendChild(document.createTextNode(t("Claude app didn't open?") + " "));
        var web = el("a", "cg-tool-web", "claude.ai \u2197");
        web.href = claudeURL(text, true);
        web.target = "_blank"; web.rel = "noopener";
        status.appendChild(web);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          status.appendChild(document.createTextNode((phone ? "" : " \u00b7 ") + t("The position is on your clipboard too.")));
        }, function () {});
      }
      clearTimeout(statusTimer);
      statusTimer = setTimeout(function () { status.textContent = ""; }, 20000);
    });
    side.appendChild(tools);

    box.appendChild(left);
    box.appendChild(side);
    box.tabIndex = -1;
    // After a click (not a keyboard press) on a step, a move or the graph,
    // the board takes the focus back, so the arrow keys and Space keep working.
    box.addEventListener("click", function (e) {
      if (e.detail > 0 && e.target.closest && e.target.closest(".cg-step:not(.cg-play), .cg-move, .cg-graph"))
        box.focus({ preventScroll: true });
    });
    box.addEventListener("keydown", function (e) {
      if (e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === " " && e.target === box) { e.preventDefault(); autoplay(!timer); return; }
      var to = e.key === "ArrowLeft" ? ply - 1 : e.key === "ArrowRight" ? ply + 1 :
               e.key === "Home" ? 0 : e.key === "End" ? N : null;
      if (to == null) return;
      e.preventDefault();
      go(to);
    });

    var ply = -1, timer = 0;
    function autoplay(on) {
      clearInterval(timer);
      timer = 0;
      if (on && N) {
        if (ply >= N) go(0, true);
        timer = setInterval(function () { if (ply >= N) autoplay(false); else go(ply + 1, true); }, AUTOPLAY_MS);
      }
      bPlay.textContent = timer ? "⏸︎" : "▶︎";
      bPlay.setAttribute("aria-pressed", timer ? "true" : "false");
      bPlay.setAttribute("aria-label", t(timer ? "Pause" : "Play through"));
      bPlay.title = t(timer ? "Pause" : "Play through");
      bPlay.classList.toggle("is-on", !!timer);
    }
    box.stop = function () { autoplay(false); };

    function moveName(k) { return R.moveNumber(line, k) + " " + line.moves[k].san; }
    function go(p, auto) {
      if (!auto && timer) autoplay(false);
      p = Math.max(0, Math.min(N, p));
      if (p === ply) return;
      ply = p;
      var pos = line.positions[p], last = p ? line.moves[p - 1] : null;
      for (var i = 0; i < 64; i++) {
        var pc = pos.b[i], piece = cells[i].lastChild;
        piece.textContent = pc ? GLYPH[pc.toUpperCase()] + "︎" : "";
        piece.className = "cg-piece" + (pc ? (R.side(pc) === "w" ? " is-white" : " is-black") : "");
        cells[i].classList.toggle("is-last", !!last && (i === last.from || i === last.to));
      }
      marks.forEach(function (b, k) {
        var on = k === p - 1;
        b.classList.toggle("is-current", on);
        if (on) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
      });
      showCurrent();
      var said = p ? moveName(p - 1) : t("Starting position");
      readout.textContent = said;
      board.setAttribute("aria-label", p ? t("Position after {move}", { move: said }) : said);
      note.textContent = p ? last.note : line.note;
      note.hidden = !note.textContent;
      bFirst.disabled = bPrev.disabled = p === 0;
      bNext.disabled = bLast.disabled = p === N;

      if (an) {
        var e = an.ev[p];
        evalbar.style.setProperty("--w", whiteShare(e).toFixed(4));
        var mark = p ? an.j[p - 1] : null, before = p ? an.ev[p - 1] : null;
        verdict.textContent = "";
        verdict.className = "cg-verdict" + (mark ? " " + MARK_CLASS[mark] : "");
        if (mark) {
          verdict.appendChild(el("span", "cg-mark", mark));
          verdict.appendChild(document.createTextNode(" " + t(MARK_WORD[mark]) +
            (before && before.b ? " · " + t("best was {move}", { move: R.moveNumber(line, p - 1) + " " + before.b }) : "")));
        }
        verdict.hidden = !mark;
        best.textContent = "";
        best.appendChild(el("span", "cg-eval", evalText(e)));
        if (e && e.pv) best.appendChild(el("span", "cg-pv", numbered(line, p, e.pv)));
        if (cursor) { cursor.setAttribute("x1", p); cursor.setAttribute("x2", p); }
      }
      lichess.href = lichessURL(game, p);
      claude.href = claudeURL(claudePrompt(game, an, p), phone);
    }
    // The current move kept in view in the move list (once the board is on
    // the page: gameRow asks again when it opens it).
    function showCurrent() {
      var cur = marks[ply - 1];
      if (!cur || list.scrollHeight <= list.clientHeight) return;
      var top = cur.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
      if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - cur.offsetHeight)
        list.scrollTop = top - list.clientHeight / 2;
    }
    box.showCurrent = showCurrent;
    go(N);
    return box;
  }

  /* ---------- lichess and Claude ----------------------------------------- */

  // The game's tags as the database knows them (the PGN's own where it has them).
  function gameTags(g) {
    var tm = g.tournament || {}, tags = {};
    var me = (player[0] || "Newton Liu"), them = g.opponent || "?";
    if (!g.line.tags.White && g.color) tags.White = g.color === "white" ? me : them;
    if (!g.line.tags.Black && g.color) tags.Black = g.color === "black" ? me : them;
    if (!g.line.tags.Event && tm.name) tags.Event = tm.name;
    if (!g.line.tags.Round && g.round != null) tags.Round = String(g.round);
    if (!g.line.tags.Result && g.result && /^(1-0|0-1|1\/2-1\/2)$/.test(g.result)) tags.Result = g.result;
    if (!g.line.tags.Result && g.points != null && g.color) {
      tags.Result = g.points === .5 ? "1/2-1/2" : (g.points === 1) === (g.color === "white") ? "1-0" : "0-1";
    }
    return tags;
  }

  // lichess.org/analysis/pgn/<the game>#<half-move>: lichess's own analysis
  // board, opened on this move, turned to his side. lichess reads "_" as a
  // space and drops "+", and keeps 5000 characters of the address.
  function lichessURL(g, p) {
    var pgn = R.cleanPGN(g.line, gameTags(g)).replace(/[+#]/g, "");
    var path = encodeURIComponent(pgn.replace(/ /g, "_")).replace(/%5F/g, "_");
    if (path.length > 5000) {
      var moves = pgn.split("\n\n").pop();
      path = encodeURIComponent(moves.replace(/ /g, "_")).replace(/%5F/g, "_");
    }
    return "https://lichess.org/analysis/pgn/" + path + (g.color === "black" ? "?color=black" : "") +
      "#" + (g.line.first + p);
  }

  // What Claude is given: the game, where we are, and the engine's view of
  // it, so that it explains rather than calculates (language models misplay
  // long variations). Under the 14,000 characters the app's link keeps.
  function claudePrompt(g, an, p) {
    var line = g.line, tm = g.tournament || {}, out = [];
    var me = player[0] || "Newton Liu";
    out.push("Help me review this chess game.");
    var who = g.color ? me + " played " + (g.color === "white" ? "White" : "Black") +
      (g.opponent ? " against " + g.opponent + (g.opponentRating ? " (" + g.opponentRating + ")" : "") : "") : "";
    var where = [g.round != null ? "round " + g.round : "", tm.name, tm.where].filter(Boolean).join(", ");
    if (who || where) out.push((who ? who + (where ? ", " : "") : "") + where + ".");
    out.push("");
    if (p) out.push("We are at the position after " + R.moveNumber(line, p - 1) + " " + line.moves[p - 1].san + ".");
    else out.push("We are at the starting position.");
    out.push("FEN: " + line.fens[p]);
    if (an) {
      var e = an.ev[p], mark = p ? an.j[p - 1] : null, before = p ? an.ev[p - 1] : null;
      if (e && !e.mated) out.push(an.engine + " (depth " + an.depth + ") rates this position " + evalText(e) +
        " from White's side" + (e.pv ? "; its best line: " + numbered(line, p, e.pv) : "") + ".");
      if (mark && before) out.push("It marks " + R.moveNumber(line, p - 1) + " " + line.moves[p - 1].san + " as " +
        { "?!": "an inaccuracy", "?": "a mistake", "??": "a blunder" }[mark] + " (" + mark + "); before it the position was " +
        evalText(before) + (before.b ? " and it preferred " + R.moveNumber(line, p - 1) + " " + before.b : "") + ".");
    }
    out.push("");
    out.push("Please lean on the engine's numbers and lines above rather than calculating long variations yourself, " +
             "don't invent moves, and say when you're unsure.");
    if (ZH) out.push("Please answer in Simplified Chinese.");
    out.push("");
    out.push("The game (PGN):");
    out.push(R.cleanPGN(line, gameTags(g)));
    out.push("");
    out.push("My question: ");
    var text = out.join("\n");
    return text.length > 13000 ? text.slice(0, 13000) : text;
  }

  // The Claude desktop app's documented link (it fills in the prompt, he
  // sends it); on a phone, claude.ai's own new-chat page with the same text.
  function claudeURL(text, phone) {
    return (phone ? "https://claude.ai/new?q=" : "claude://claude.ai/new?q=") + encodeURIComponent(text);
  }

  /* ---------- the page -------------------------------------------------- */

  var RESULT_WORD = { 1: "Win", 0.5: "Draw", 0: "Loss" };

  // A row: round, his colour, the opponent and their rating, his points,
  // then the game on chess.com (`link`) and, where there is a PGN, a button
  // that opens the board under the row.
  function gameRow(g) {
    var item = el("li", "cg-game");
    var playable = g.line && g.line.moves.length;
    var row = el("div", "cg-row");

    row.appendChild(el("span", "cg-round", g.round != null ? t("R{n}", { n: g.round }) : ""));
    if (g.bye != null) {
      row.appendChild(el("span", "cg-color"));
      row.appendChild(el("span", "cg-opp is-bye", t(g.points === 1 ? "Full-point bye" : g.points ? "Half-point bye" : "Bye")));
    } else {
      // The opponent's colour, beside the opponent's name (Newton read it
      // that way, 2026-10-20): his own is the other one.
      var theirs = g.color === "white" ? "black" : g.color === "black" ? "white" : null;
      var col = el("span", "cg-color" + (theirs ? " is-" + theirs : ""));
      if (theirs) {
        col.setAttribute("role", "img");
        col.setAttribute("aria-label", t(theirs === "white" ? "White" : "Black"));
      }
      row.appendChild(col);
      var opp = el("span", "cg-opp", g.opponent || t("Opponent to come"));
      if (g.opponentRating) opp.appendChild(el("span", "cg-elo", String(g.opponentRating)));
      row.appendChild(opp);
    }
    var res = el("span", "cg-result" + (g.points === 1 ? " is-win" : g.points === 0 ? " is-loss" : ""),
                 g.points == null ? "\u2013" : score(g.points));
    if (g.points != null && g.bye == null) res.setAttribute("aria-label", t(RESULT_WORD[g.points]));
    row.appendChild(res);

    var link = el("span", "cg-linkcell");
    if (typeof g.link === "string" && /^https?:\/\//.test(g.link)) {
      var a = el("a", "cg-game-link", t("Game") + " \u2197");
      a.href = g.link; a.target = "_blank"; a.rel = "noopener";
      if (g.opponent) a.setAttribute("aria-label", t("Game against {name} on chess.com", { name: g.opponent }));
      link.appendChild(a);
    }
    row.appendChild(link);

    var toggle = el("span", "cg-boardcell");
    row.appendChild(toggle);
    item.appendChild(row);

    if (g.note) item.appendChild(el("p", "cg-note", g.note));

    if (playable) {
      var btn = el("button", "cg-board-toggle", "+");
      btn.type = "button";
      btn.setAttribute("aria-label", t("Board"));
      btn.title = t("Board");
      btn.setAttribute("aria-expanded", "false");
      toggle.appendChild(btn);
      var panel = null;
      var opening = false;
      btn.addEventListener("click", function () {
        var open = btn.getAttribute("aria-expanded") !== "true";
        if (opening) return;
        function show() {
          panel.hidden = !open;
          btn.setAttribute("aria-expanded", String(open));
          item.classList.toggle("is-open", open);
          if (open) { panel.showCurrent(); panel.focus({ preventScroll: true }); }
          else panel.stop();
        }
        if (open && !panel) {
          opening = true;
          loadEvals().then(function (data) {
            opening = false;
            panel = viewer(g, data);
            item.appendChild(panel);
            show();
          });
        } else show();
      });
    }
    return item;
  }

  function tournamentBlock(tm, games) {
    var sec = el("section", "cg-event");
    sec.id = tm.id;
    var h = el("h2", "cg-name", tm.name || t("Tournament"));
    sec.appendChild(h);

    var meta = el("p", "cg-meta");
    [dateRange(tm.start, tm.end), tm.where, tm.section, tm.timeControl].forEach(function (s) {
      if (s) meta.appendChild(el("span", null, s));
    });
    if (meta.childNodes.length) sec.appendChild(meta);

    var counted = games.filter(function (g) { return g.points != null; });
    var pts = counted.reduce(function (a, g) { return a + g.points; }, 0);
    var line = el("p", "cg-score");
    if (counted.length) line.appendChild(el("span", null, t("Score {pts} / {n}", { pts: score(pts), n: tm.rounds || games.length })));
    var rt = tm.rating;
    if (rt && (rt.before || rt.after)) {
      var s = (rt.system ? rt.system + " " : "") + (rt.before || "?") + (rt.after ? " → " + rt.after : "");
      if (rt.before && rt.after) s += " (" + (rt.after - rt.before >= 0 ? "+" : "−") + Math.abs(rt.after - rt.before) + ")";
      line.appendChild(el("span", null, s));
    }
    if (tm.place) line.appendChild(el("span", null, t("Place {n}", { n: tm.place })));
    if (tm.url) {
      var a = el("a", "cg-link", t("Crosstable") + " ↗");
      a.href = tm.url; a.target = "_blank"; a.rel = "noopener";
      line.appendChild(a);
    }
    if (line.childNodes.length) sec.appendChild(line);
    if (tm.note) sec.appendChild(el("p", "cg-tnote", tm.note));

    var list = el("ol", "cg-games");
    games.forEach(function (g) { list.appendChild(gameRow(g)); });
    if (games.length) sec.appendChild(list);
    return sec;
  }

  function render(data) {
    player = [].concat(data.player || []);
    var events = (data.tournaments || []).slice().sort(function (a, b) {
      return String(b.start || "").localeCompare(String(a.start || ""));
    });
    var all = [];
    var col = root.querySelector(".cg-events"), jump = root.querySelector(".cg-jump"), stats = root.querySelector(".cg-stats");
    col.textContent = "";

    var ids = R.tournamentIds(events);
    events.forEach(function (tm, k) {
      tm = Object.assign({}, tm, { id: ids[k] });
      var keys = R.gameKeys(ids[k], tm.games);
      var games = (tm.games || []).map(function (raw, n) { return gameOf(raw, tm, keys[n]); });
      games.sort(function (a, b) { return (parseFloat(a.round) || 0) - (parseFloat(b.round) || 0); });
      all = all.concat(games);
      col.appendChild(tournamentBlock(tm, games));
      var a = el("a", null, tm.name || t("Tournament"));
      a.href = "#" + ids[k];
      jump.appendChild(a);
    });

    if (!events.length) {
      col.appendChild(el("p", "cg-empty", t("No games logged yet.")));
      return;
    }

    // The rail: games, wins, draws, losses (byes aside), and the latest rating.
    var played = all.filter(function (g) { return g.bye == null && g.points != null; });
    var tally = function (p) { return played.filter(function (g) { return g.points === p; }).length; };
    [["Games", played.length], ["Won", tally(1)], ["Drawn", tally(0.5)], ["Lost", tally(0)]].forEach(function (row) {
      var d = el("div", "cg-stat");
      d.appendChild(el("dt", null, t(row[0])));
      d.appendChild(el("dd", null, String(row[1])));
      stats.appendChild(d);
    });
    var latest = null;
    events.some(function (tm) { if (tm.rating && tm.rating.after) { latest = tm.rating; return true; } return false; });
    if (latest) {
      var d = el("div", "cg-stat");
      d.appendChild(el("dt", null, latest.system || t("Rating")));
      d.appendChild(el("dd", null, String(latest.after)));
      stats.appendChild(d);
    }
    stats.hidden = false;
    jump.hidden = false;

    // Arriving from a pin on the map (#a-tournament): the anchor exists
    // only now, so the jump is made here, and the section is marked.
    function arrive() {
      var id = decodeURIComponent(location.hash.slice(1));
      Array.prototype.forEach.call(col.querySelectorAll(".cg-event"), function (sec) {
        sec.classList.toggle("is-target", !!id && sec.id === id);
      });
      var target = id && document.getElementById(id);
      if (target && target.classList.contains("cg-event")) target.scrollIntoView();
    }
    arrive();
    window.addEventListener("hashchange", arrive);
  }

  S.getJSON("data/chess.json").then(render, function () {
    var col = root.querySelector(".cg-events");
    col.textContent = "";
    col.appendChild(el("p", "cg-empty", t("Couldn't load the games.")));
  });

})();
