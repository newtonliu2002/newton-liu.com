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

  /* ---------- the rules, as much as a PGN needs ------------------------- */

  var FILES = "abcdefgh";
  var GLYPH = { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟" };
  var NAME = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn" };

  function sqIndex(s) { return (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97); }
  function sqName(i) { return FILES.charAt(i & 7) + ((i >> 3) + 1); }
  function side(p) { return p ? (p === p.toUpperCase() ? "w" : "b") : null; }
  function sign(n) { return n > 0 ? 1 : n < 0 ? -1 : 0; }

  function startPosition() {
    var b = [], back = "RNBQKBNR", i;
    for (i = 0; i < 64; i++) b.push(null);
    for (i = 0; i < 8; i++) {
      b[i] = back.charAt(i); b[8 + i] = "P";
      b[48 + i] = "p"; b[56 + i] = back.charAt(i).toLowerCase();
    }
    return { b: b, turn: "w", ep: -1 };
  }

  // A FEN's board, side to move and en passant square (a game set up from
  // a position); null if it doesn't read.
  function fenPosition(fen) {
    var f = String(fen).trim().split(/\s+/), rows = (f[0] || "").split("/"), b = [], r, c, ch, k;
    if (rows.length !== 8) return null;
    for (r = 0; r < 64; r++) b.push(null);
    for (r = 0; r < 8; r++) {
      c = 0;
      for (k = 0; k < rows[r].length; k++) {
        ch = rows[r].charAt(k);
        if (/\d/.test(ch)) c += +ch;
        else if (/[pnbrqk]/i.test(ch) && c < 8) b[(7 - r) * 8 + c++] = ch;
        else return null;
      }
    }
    return { b: b, turn: f[1] === "b" ? "b" : "w", ep: /^[a-h][36]$/.test(f[3] || "") ? sqIndex(f[3]) : -1 };
  }

  // Whether a knight, bishop, rook, queen or king on `from` reaches `to`,
  // with nothing in between.
  function reaches(b, from, to, type) {
    var dx = (to & 7) - (from & 7), dy = (to >> 3) - (from >> 3), ax = Math.abs(dx), ay = Math.abs(dy);
    if (!ax && !ay) return false;
    if (type === "N") return ax * ay === 2;
    if (type === "K") return ax <= 1 && ay <= 1;
    var straight = !ax || !ay, diag = ax === ay;
    if (type === "R" ? !straight : type === "B" ? !diag : !(straight || diag)) return false;
    var sx = sign(dx), sy = sign(dy), x = (from & 7) + sx, y = (from >> 3) + sy;
    while (x !== (to & 7) || y !== (to >> 3)) {
      if (b[y * 8 + x]) return false;
      x += sx; y += sy;
    }
    return true;
  }

  function attacked(b, target, by) {
    for (var i = 0; i < 64; i++) {
      var p = b[i];
      if (!p || side(p) !== by) continue;
      var type = p.toUpperCase();
      if (type === "P") {
        if ((target >> 3) - (i >> 3) === (by === "w" ? 1 : -1) && Math.abs((target & 7) - (i & 7)) === 1) return true;
      } else if (reaches(b, i, target, type)) return true;
    }
    return false;
  }

  // One move on a board (changes `b`): the en passant capture, the promotion.
  function move(b, from, to, ep, promo) {
    var p = b[from], c = side(p);
    if (p.toUpperCase() === "P" && to === ep && !b[to] && (from & 7) !== (to & 7)) b[to + (c === "w" ? -8 : 8)] = null;
    b[to] = promo ? (c === "w" ? promo : promo.toLowerCase()) : p;
    b[from] = null;
  }

  // The position after one move in standard notation, or null if the move
  // can't be played there.
  function play(pos, san) {
    var b = pos.b.slice(), c = pos.turn, opp = c === "w" ? "b" : "w";
    var s = san.replace(/[+#!?]+$/, "").replace(/0/g, "O");
    if (s === "O-O" || s === "O-O-O") {
      var r = c === "w" ? 0 : 56, long = s === "O-O-O", k = r + 4;
      if (b[k] !== (c === "w" ? "K" : "k")) return null;
      var kt = r + (long ? 2 : 6), rf = r + (long ? 0 : 7), rt = r + (long ? 3 : 5);
      b[kt] = b[k]; b[k] = null; b[rt] = b[rf]; b[rf] = null;
      return { pos: { b: b, turn: opp, ep: -1 }, from: k, to: kt };
    }
    var m = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQ]))?$/.exec(s);
    if (!m) return null;
    var type = m[1] || "P", to = sqIndex(m[4]), dir = c === "w" ? 1 : -1, found = [];
    for (var i = 0; i < 64; i++) {
      var p = b[i];
      if (!p || side(p) !== c || p.toUpperCase() !== type) continue;
      if (m[2] && FILES.charAt(i & 7) !== m[2]) continue;
      if (m[3] && String((i >> 3) + 1) !== m[3]) continue;
      if (b[to] && side(b[to]) === c) continue;
      if (type === "P") {
        var dx = (to & 7) - (i & 7), dy = (to >> 3) - (i >> 3);
        if (!dx) {
          if (b[to]) continue;
          if (dy !== dir && !(dy === 2 * dir && (i >> 3) === (c === "w" ? 1 : 6) && !b[i + 8 * dir])) continue;
        } else if (Math.abs(dx) !== 1 || dy !== dir || !(b[to] || to === pos.ep)) continue;
      } else if (!reaches(b, i, to, type)) continue;
      // Not into check: the one way to tell two knights apart when the
      // notation names neither (the other one is pinned).
      var nb = b.slice();
      move(nb, i, to, pos.ep, m[5]);
      var king = nb.indexOf(c === "w" ? "K" : "k");
      if (king >= 0 && attacked(nb, king, opp)) continue;
      found.push(i);
    }
    if (found.length !== 1) return null;
    var from = found[0];
    move(b, from, to, pos.ep, m[5]);
    var ep = type === "P" && Math.abs(to - from) === 16 ? (from + to) / 2 : -1;
    return { pos: { b: b, turn: opp, ep: ep }, from: from, to: to };
  }

  // A PGN: its tags, and its main line played out. Comments in braces stay
  // with the move before them; variations, NAGs and ;-comments are skipped.
  // A move that can't be played ends the line there (`broken`).
  function readPGN(text) {
    var tags = {}, notes = [];
    var body = String(text || "").replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/gm, function (_, k, v) {
      tags[k] = v.replace(/\\(.)/g, "$1");
      return "";
    });
    body = body.replace(/\{([^}]*)\}/g, function (_, note) { notes.push(note.trim()); return " {" + (notes.length - 1) + "} "; })
               .replace(/;[^\n]*/g, " ");
    while (/\([^()]*\)/.test(body)) body = body.replace(/\([^()]*\)/g, " ");
    body = body.replace(/\$\d+/g, " ").replace(/\d+\.(\.\.)?/g, " ");

    var pos = tags.FEN ? fenPosition(tags.FEN) || startPosition() : startPosition();
    var line = { tags: tags, positions: [pos], moves: [], first: 0, broken: false, note: "" };
    if (tags.FEN) line.first = (+(tags.FEN.split(/\s+/)[5]) || 1) * 2 - 2 + (pos.turn === "b" ? 1 : 0);
    body.split(/\s+/).some(function (tok) {
      if (!tok || /^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(tok)) return false;
      var n = /^\{(\d+)\}$/.exec(tok);
      if (n) {
        var last = line.moves[line.moves.length - 1];
        if (last) last.note = (last.note ? last.note + " " : "") + notes[+n[1]];
        else line.note = notes[+n[1]];
        return false;
      }
      var r = play(pos, tok);
      if (!r) { line.broken = true; return true; }
      pos = r.pos;
      line.positions.push(pos);
      line.moves.push({ san: tok.replace(/[!?]+$/, ""), from: r.from, to: r.to, note: "" });
      return false;
    });
    return line;
  }

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

  function gameOf(raw, tournament) {
    var g = {}, k;
    for (k in raw) if (Object.prototype.hasOwnProperty.call(raw, k)) g[k] = raw[k];
    if (g.bye != null) {
      g.points = typeof g.bye === "number" ? g.bye : 0;
      return g;
    }
    if (g.pgn) {
      g.line = readPGN(g.pgn);
      var tg = g.line.tags;
      if (!g.color) g.color = isMe(tg.Black) && !isMe(tg.White) ? "black" : isMe(tg.White) ? "white" : null;
      if (!g.opponent && g.color) g.opponent = g.color === "white" ? tg.Black : tg.White;
      if (g.opponentRating == null && g.color) g.opponentRating = +(g.color === "white" ? tg.BlackElo : tg.WhiteElo) || null;
      if (g.rating == null && g.color) g.rating = +(g.color === "white" ? tg.WhiteElo : tg.BlackElo) || null;
      if (g.result == null && tg.Result && tg.Result !== "*") g.result = tg.Result;
      if (g.round == null && tg.Round && tg.Round !== "?") g.round = tg.Round;
      if (!g.date && tg.Date && !/\?/.test(tg.Date)) g.date = tg.Date.replace(/\./g, "-");
      if (!g.eco && tg.ECO) g.eco = tg.ECO;
      if (!g.opening && tg.Opening) g.opening = tg.Opening + (tg.Variation ? ": " + tg.Variation : "");
    }
    g.points = pointsOf(g.result, g.color);
    g.tournament = tournament;
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

  // Each tournament's anchor: its `id`, else made from its name and start
  // date. chess-map.js has the same function: keep the two alike.
  function tournamentIds(list) {
    var seen = {};
    return list.map(function (tm) {
      var id = tm.id || slug((tm.name || "") + "-" + (tm.start || ""));
      while (seen[id]) id += "-2";
      seen[id] = true;
      return id;
    });
  }

  function slug(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tournament";
  }

  /* ---------- the board ------------------------------------------------- */

  // A board to step through one game's main line, flipped when he had
  // black. ← → Home End while it has focus.
  function viewer(game) {
    var line = game.line, flip = game.color === "black";
    var box = el("div", "cg-viewer");
    var board = el("div", "cg-board");
    board.setAttribute("role", "img");
    var cells = [];
    for (var v = 0; v < 64; v++) {
      var r = flip ? v >> 3 : 7 - (v >> 3), f = flip ? 7 - (v & 7) : v & 7, i = r * 8 + f;
      var cell = el("div", "cg-sq " + ((r + f) % 2 ? "is-light" : "is-dark"));
      if ((v & 7) === 0) cell.appendChild(el("span", "cg-rank", String(r + 1)));
      if (v >> 3 === 7) cell.appendChild(el("span", "cg-file", FILES.charAt(f)));
      cell.appendChild(el("span", "cg-piece"));
      board.appendChild(cell);
      cells[i] = cell;
    }

    var bar = el("div", "cg-bar");
    function button(label, glyph, step) {
      var b = el("button", "cg-step", glyph);
      b.type = "button";
      b.setAttribute("aria-label", t(label));
      b.addEventListener("click", function () { go(step(ply)); });
      bar.appendChild(b);
      return b;
    }
    var bFirst = button("Start", "⏮︎", function () { return 0; });
    var bPrev = button("Previous move", "‹", function (p) { return p - 1; });
    var readout = el("span", "cg-readout");
    readout.setAttribute("aria-live", "polite");
    bar.appendChild(readout);
    var bNext = button("Next move", "›", function (p) { return p + 1; });
    var bLast = button("End", "⏭︎", function () { return line.moves.length; });

    var list = el("ol", "cg-moves"), marks = [];
    var li = null;
    line.moves.forEach(function (mv, k) {
      var n = line.first + k;
      if (n % 2 === 0 || !li) {
        li = el("li");
        li.appendChild(el("span", "cg-num", Math.floor(n / 2) + 1 + (n % 2 ? "…" : ".")));
        list.appendChild(li);
      }
      var b = el("button", "cg-move", mv.san);
      b.type = "button";
      b.addEventListener("click", function () { go(k + 1); });
      li.appendChild(b);
      marks.push(b);
    });

    var note = el("p", "cg-movenote");
    var head = el("div", "cg-side");
    head.appendChild(bar);
    head.appendChild(list);
    if (line.broken) head.appendChild(el("p", "cg-broken", t("The rest of this game's moves couldn't be read.")));
    head.appendChild(note);

    box.appendChild(board);
    box.appendChild(head);
    box.tabIndex = -1;
    box.addEventListener("keydown", function (e) {
      var to = e.key === "ArrowLeft" ? ply - 1 : e.key === "ArrowRight" ? ply + 1 :
               e.key === "Home" ? 0 : e.key === "End" ? line.moves.length : null;
      if (to == null || e.altKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      go(to);
    });

    var ply = -1;
    function moveName(k) {
      var n = line.first + k;
      return Math.floor(n / 2) + 1 + (n % 2 ? "… " : ". ") + line.moves[k].san;
    }
    function go(p) {
      p = Math.max(0, Math.min(line.moves.length, p));
      if (p === ply) return;
      ply = p;
      var pos = line.positions[p], last = p ? line.moves[p - 1] : null;
      for (var i = 0; i < 64; i++) {
        var pc = pos.b[i], piece = cells[i].lastChild;
        piece.textContent = pc ? GLYPH[pc.toUpperCase()] + "︎" : "";
        piece.className = "cg-piece" + (pc ? (side(pc) === "w" ? " is-white" : " is-black") : "");
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
      bNext.disabled = bLast.disabled = p === line.moves.length;
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
    go(line.moves.length);
    return box;
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
      var col = el("span", "cg-color" + (g.color ? " is-" + g.color : ""));
      if (g.color) {
        col.setAttribute("role", "img");
        col.setAttribute("aria-label", t(g.color === "white" ? "White" : "Black"));
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
      btn.addEventListener("click", function () {
        var open = btn.getAttribute("aria-expanded") !== "true";
        if (open && !panel) { panel = viewer(g); item.appendChild(panel); }
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
        item.classList.toggle("is-open", open);
        if (open) { panel.showCurrent(); panel.focus({ preventScroll: true }); }
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

    var ids = tournamentIds(events);
    events.forEach(function (tm, k) {
      tm = Object.assign({}, tm, { id: ids[k] });
      var games = (tm.games || []).map(function (raw) { return gameOf(raw, tm); });
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

  // For the console and tests: the reader on its own.
  window.NLChess = { readPGN: readPGN };
})();
