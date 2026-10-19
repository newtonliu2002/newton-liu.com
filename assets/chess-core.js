/* ==========================================================================
   newton-liu.com — the rules of chess, as much as the Chess pages need,
   shared by the database (chess.js), the map (chess-map.js) and the
   analysis tool (tools/chess-eval.mjs, under Node). No library.

   Positions: { b: 64 squares, a1 = 0 … h8 = 63, "P" white, "p" black,
   null empty; turn "w"/"b"; castle "KQkq" (or "-"); ep: the square a pawn
   just skipped, else -1; half: the fifty-move clock; full: the move number }.
   Moves: { from, to, promo ("Q"…), piece, capture, castle ("K"/"Q") }.

   readPGN() plays a game's main line out, every move checked as legal:
   SAN in, SAN, UCI and a FEN out for every position. A move that can't
   be played ends the line there (`broken`). It is checked against perft
   counts (`perft()`), the standard test of a move generator.
   ========================================================================== */

(function (root, make) {
  var api = make();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NLChessCore = api;
})(this, function () {
  "use strict";

  var FILES = "abcdefgh";
  var START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  function sqIndex(s) { return (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97); }
  function sqName(i) { return FILES.charAt(i & 7) + ((i >> 3) + 1); }
  function side(p) { return p ? (p === p.toUpperCase() ? "w" : "b") : null; }
  function other(c) { return c === "w" ? "b" : "w"; }

  /* ---------- FEN --------------------------------------------------------- */

  // A position from a FEN; null if it doesn't read.
  function fromFEN(fen) {
    var f = String(fen || "").trim().split(/\s+/), rows = (f[0] || "").split("/"), b = [], r, c, k, ch;
    if (rows.length !== 8) return null;
    for (r = 0; r < 64; r++) b.push(null);
    for (r = 0; r < 8; r++) {
      c = 0;
      for (k = 0; k < rows[r].length; k++) {
        ch = rows[r].charAt(k);
        if (/[1-8]/.test(ch)) c += +ch;
        else if (/[pnbrqk]/i.test(ch) && c < 8) b[(7 - r) * 8 + c++] = ch;
        else return null;
      }
      if (c !== 8) return null;
    }
    return {
      b: b, turn: f[1] === "b" ? "b" : "w",
      castle: /^[KQkq]+$/.test(f[2] || "") ? f[2] : "-",
      ep: /^[a-h][36]$/.test(f[3] || "") ? sqIndex(f[3]) : -1,
      half: +f[4] || 0, full: Math.max(1, +f[5] || 1)
    };
  }

  function toFEN(pos) {
    var rows = [];
    for (var r = 7; r >= 0; r--) {
      var row = "", empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = pos.b[r * 8 + f];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p;
      }
      rows.push(row + (empty || ""));
    }
    return rows.join("/") + " " + pos.turn + " " + (pos.castle || "-") + " " +
      (pos.ep >= 0 ? sqName(pos.ep) : "-") + " " + pos.half + " " + pos.full;
  }

  function startPosition() { return fromFEN(START); }

  /* ---------- attacks and moves ------------------------------------------- */

  var KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var LINE = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function at(x, y) { return x >= 0 && x < 8 && y >= 0 && y < 8 ? y * 8 + x : -1; }

  // Whether `by` attacks square `sq` on board `b`.
  function attacked(b, sq, by) {
    var x = sq & 7, y = sq >> 3, i, s, p;
    var pawn = by === "w" ? "P" : "p", dy = by === "w" ? -1 : 1;
    if ((s = at(x - 1, y + dy)) >= 0 && b[s] === pawn) return true;
    if ((s = at(x + 1, y + dy)) >= 0 && b[s] === pawn) return true;
    var n = by === "w" ? "N" : "n", k = by === "w" ? "K" : "k";
    for (i = 0; i < 8; i++) {
      if ((s = at(x + KNIGHT[i][0], y + KNIGHT[i][1])) >= 0 && b[s] === n) return true;
      if ((s = at(x + KING[i][0], y + KING[i][1])) >= 0 && b[s] === k) return true;
    }
    function ray(dirs, a, q) {
      for (var d = 0; d < 4; d++) {
        var cx = x + dirs[d][0], cy = y + dirs[d][1], c;
        while ((c = at(cx, cy)) >= 0) {
          p = b[c];
          if (p) { if (p === a || p === q) return true; break; }
          cx += dirs[d][0]; cy += dirs[d][1];
        }
      }
      return false;
    }
    var q = by === "w" ? "Q" : "q";
    return ray(DIAG, by === "w" ? "B" : "b", q) || ray(LINE, by === "w" ? "R" : "r", q);
  }

  function inCheck(pos, c) {
    var k = pos.b.indexOf(c === "w" ? "K" : "k");
    return k >= 0 && attacked(pos.b, k, other(c));
  }

  // Every move the side to move could make, checks on its own king aside.
  function pseudoMoves(pos) {
    var b = pos.b, c = pos.turn, out = [], i, d, s, p, t;
    function add(from, to, extra) {
      var mv = { from: from, to: to, piece: b[from].toUpperCase(), capture: !!b[to] };
      for (var k in extra) mv[k] = extra[k];
      out.push(mv);
    }
    for (i = 0; i < 64; i++) {
      p = b[i];
      if (!p || side(p) !== c) continue;
      var type = p.toUpperCase(), x = i & 7, y = i >> 3;
      if (type === "P") {
        var dir = c === "w" ? 1 : -1, last = c === "w" ? 7 : 0, home = c === "w" ? 1 : 6;
        var push = function (to, extra) {
          if ((to >> 3) === last) ["Q", "R", "B", "N"].forEach(function (pr) {
            var e = { promo: pr }; for (var k in extra) e[k] = extra[k]; add(i, to, e);
          });
          else add(i, to, extra);
        };
        s = at(x, y + dir);
        if (s >= 0 && !b[s]) {
          push(s, {});
          t = at(x, y + 2 * dir);
          if (y === home && !b[t]) add(i, t, {});
        }
        [-1, 1].forEach(function (dx) {
          var to = at(x + dx, y + dir);
          if (to < 0) return;
          if (b[to] && side(b[to]) !== c) push(to, {});
          else if (to === pos.ep && !b[to]) add(i, to, { capture: true, enPassant: true });
        });
      } else if (type === "N" || type === "K") {
        var steps = type === "N" ? KNIGHT : KING;
        for (d = 0; d < 8; d++) {
          s = at(x + steps[d][0], y + steps[d][1]);
          if (s >= 0 && (!b[s] || side(b[s]) !== c)) add(i, s, {});
        }
      } else {
        var dirs = type === "B" ? DIAG : type === "R" ? LINE : DIAG.concat(LINE);
        for (d = 0; d < dirs.length; d++) {
          var cx = x + dirs[d][0], cy = y + dirs[d][1];
          while ((s = at(cx, cy)) >= 0) {
            if (b[s]) { if (side(b[s]) !== c) add(i, s, {}); break; }
            add(i, s, {});
            cx += dirs[d][0]; cy += dirs[d][1];
          }
        }
      }
    }
    // Castling: the right still held, the squares between empty, and the
    // king not in check, not crossing or landing on an attacked square.
    var r0 = c === "w" ? 0 : 56, K = c === "w" ? "K" : "k", R = c === "w" ? "R" : "r", opp = other(c);
    var rights = pos.castle || "";
    if (b[r0 + 4] === K && !attacked(b, r0 + 4, opp)) {
      if (rights.indexOf(c === "w" ? "K" : "k") >= 0 && b[r0 + 7] === R && !b[r0 + 5] && !b[r0 + 6] &&
          !attacked(b, r0 + 5, opp) && !attacked(b, r0 + 6, opp)) add(r0 + 4, r0 + 6, { castle: "K" });
      if (rights.indexOf(c === "w" ? "Q" : "q") >= 0 && b[r0] === R && !b[r0 + 1] && !b[r0 + 2] && !b[r0 + 3] &&
          !attacked(b, r0 + 3, opp) && !attacked(b, r0 + 2, opp)) add(r0 + 4, r0 + 2, { castle: "Q" });
    }
    return out;
  }

  // The position after a move (a new object; `pos` is left as it was).
  function makeMove(pos, mv) {
    var b = pos.b.slice(), c = pos.turn, p = b[mv.from], dir = c === "w" ? 1 : -1;
    var capture = !!b[mv.to] || !!mv.enPassant;
    if (mv.enPassant) b[mv.to - 8 * dir] = null;
    b[mv.to] = mv.promo ? (c === "w" ? mv.promo : mv.promo.toLowerCase()) : p;
    b[mv.from] = null;
    if (mv.castle) {
      var r0 = c === "w" ? 0 : 56;
      if (mv.castle === "K") { b[r0 + 5] = b[r0 + 7]; b[r0 + 7] = null; }
      else { b[r0 + 3] = b[r0]; b[r0] = null; }
    }
    // Rights go when the king moves, or a rook leaves or is taken on its corner.
    var castle = pos.castle === "-" ? "" : pos.castle || "";
    function drop(ch) { castle = castle.replace(ch, ""); }
    [mv.from, mv.to].forEach(function (s) {
      if (s === 4) { drop("K"); drop("Q"); }
      if (s === 60) { drop("k"); drop("q"); }
      if (s === 0) drop("Q");
      if (s === 7) drop("K");
      if (s === 56) drop("q");
      if (s === 63) drop("k");
    });
    var pawn = p.toUpperCase() === "P";
    return {
      b: b, turn: other(c), castle: castle || "-",
      ep: pawn && Math.abs(mv.to - mv.from) === 16 ? (mv.from + mv.to) / 2 : -1,
      half: pawn || capture ? 0 : pos.half + 1,
      full: pos.full + (c === "b" ? 1 : 0)
    };
  }

  function legalMoves(pos) {
    return pseudoMoves(pos).filter(function (mv) { return !inCheck(makeMove(pos, mv), pos.turn); });
  }

  // How many positions lie `depth` moves ahead: the standard check that a
  // move generator is right (startpos: 20, 400, 8902, 197281…).
  function perft(pos, depth) {
    if (!depth) return 1;
    var n = 0;
    legalMoves(pos).forEach(function (mv) { n += depth === 1 ? 1 : perft(makeMove(pos, mv), depth - 1); });
    return n;
  }

  /* ---------- notation ---------------------------------------------------- */

  function uci(mv) { return sqName(mv.from) + sqName(mv.to) + (mv.promo ? mv.promo.toLowerCase() : ""); }

  // Standard notation for a legal move in `pos`: "Nbd7", "exd6", "e8=Q+", "O-O#".
  function san(pos, mv, legal) {
    var s;
    if (mv.castle) s = mv.castle === "K" ? "O-O" : "O-O-O";
    else if (mv.piece === "P") {
      s = (mv.capture ? FILES.charAt(mv.from & 7) + "x" : "") + sqName(mv.to) + (mv.promo ? "=" + mv.promo : "");
    } else {
      var twins = (legal || legalMoves(pos)).filter(function (o) {
        return o.piece === mv.piece && o.to === mv.to && o.from !== mv.from;
      });
      var dis = "";
      if (twins.length) {
        var sameFile = twins.some(function (o) { return (o.from & 7) === (mv.from & 7); });
        var sameRank = twins.some(function (o) { return (o.from >> 3) === (mv.from >> 3); });
        dis = !sameFile ? FILES.charAt(mv.from & 7) : !sameRank ? String((mv.from >> 3) + 1) : sqName(mv.from);
      }
      s = mv.piece + dis + (mv.capture ? "x" : "") + sqName(mv.to);
    }
    var next = makeMove(pos, mv);
    if (inCheck(next, next.turn)) s += legalMoves(next).length ? "+" : "#";
    return s;
  }

  // A move in standard notation, found among the legal ones; null if there
  // is no such move, or more than one ("Nd7" when both knights can go).
  function parseSAN(pos, text, legal) {
    var s = String(text).replace(/[+#!?]+$/, "").replace(/e\.?p\.?$/i, "").replace(/0/g, "O").trim()
      .replace(/=([nbrq])$/, function (_, pr) { return "=" + pr.toUpperCase(); });
    legal = legal || legalMoves(pos);
    if (s === "O-O" || s === "O-O-O") {
      var want = s === "O-O" ? "K" : "Q";
      return legal.filter(function (mv) { return mv.castle === want; })[0] || null;
    }
    var m = /^([NBRQK])?([a-h])?([1-8])?x?-?([a-h][1-8])(?:=?([NBRQ]))?$/.exec(s);
    if (!m) return null;
    var type = m[1] || "P";
    var found = legal.filter(function (mv) {
      if (mv.piece !== type || sqName(mv.to) !== m[4] || mv.castle) return false;
      if (m[2] && FILES.charAt(mv.from & 7) !== m[2]) return false;
      if (m[3] && String((mv.from >> 3) + 1) !== m[3]) return false;
      return (mv.promo || "") === (m[5] || (mv.promo ? "Q" : ""));
    });
    return found.length === 1 ? found[0] : null;
  }

  function parseUCI(pos, text, legal) {
    var m = /^([a-h][1-8])([a-h][1-8])([nbrq])?$/.exec(String(text));
    if (!m) return null;
    var from = sqIndex(m[1]), to = sqIndex(m[2]), promo = m[3] ? m[3].toUpperCase() : "";
    return (legal || legalMoves(pos)).filter(function (mv) {
      return mv.from === from && mv.to === to && (mv.promo || "") === promo;
    })[0] || null;
  }

  // A line of UCI moves (an engine's) from `pos`, as SAN, as far as it plays.
  function uciLineToSAN(pos, list, max) {
    var out = [];
    for (var i = 0; i < list.length && (!max || i < max); i++) {
      var legal = legalMoves(pos), mv = parseUCI(pos, list[i], legal);
      if (!mv) break;
      out.push(san(pos, mv, legal));
      pos = makeMove(pos, mv);
    }
    return out;
  }

  /* ---------- PGN ----------------------------------------------------------- */

  // A comment as a reader should see it: chess.com's and lichess's
  // machine commands ([%clk 1:29:55], [%cal Ge2e4], [%eval 0.3]) taken out.
  function cleanNote(s) {
    return String(s || "").replace(/\[%[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  }

  // A PGN: its tags, and its main line played out. Comments in braces stay
  // with the move before them; variations, NAGs and ;-comments are skipped.
  // The PGN's tags: only the leading run of them (a second game's, or a
  // tag-like string in a comment, is not the header), each read strictly
  // ([Event "A \"B\" C"]) or, failing that, as a whole line, so an
  // unescaped quote ([Event "The "Big" Open"]) still reads. Tags may share
  // a line, and the moves may follow the last one on its line.
  function readTags(text) {
    var src = String(text || ""), tags = {}, at = 0, m;
    var strict = /\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]/y;
    var loose = /\s*\[(\w+)[ \t]+"(.*)"[ \t]*\][ \t]*(?=\r?\n|$)/y;
    for (;;) {
      strict.lastIndex = at;
      if ((m = strict.exec(src))) { tags[m[1]] = m[2].replace(/\\(.)/g, "$1"); at = strict.lastIndex; continue; }
      loose.lastIndex = at;
      if ((m = loose.exec(src))) { tags[m[1]] = m[2]; at = loose.lastIndex; continue; }
      break;
    }
    return { tags: tags, body: src.slice(at) };
  }

  function readPGN(text) {
    var head = readTags(text), tags = head.tags, notes = [];
    var body = head.body;
    body = body.replace(/\{([^}]*)\}/g, function (_, note) { notes.push(cleanNote(note)); return " {" + (notes.length - 1) + "} "; })
               .replace(/;[^\n]*/g, " ");
    while (/\([^()]*\)/.test(body)) body = body.replace(/\([^()]*\)/g, " ");
    body = body.replace(/\$\d+/g, " ")
               .replace(/(^|\s)\d+\s*(?:\.|…)+/g, "$1 ")          // "12.", "12...", "12. ...", "12…"
               .replace(/(^|\s)(?:\.{2,}|…)(?=\s|$)/g, "$1 ");

    var pos = (tags.FEN && fromFEN(tags.FEN)) || startPosition();
    var line = {
      tags: tags, positions: [pos], fens: [toFEN(pos)], moves: [], broken: false, note: "",
      first: (pos.full - 1) * 2 + (pos.turn === "b" ? 1 : 0),   // half-moves before the first move
      start: tags.FEN && fromFEN(tags.FEN) ? toFEN(pos) : null
    };
    body.split(/\s+/).some(function (tok) {
      if (!tok || /^e\.?p\.?$/i.test(tok)) return false;   // "exd6 e.p."
      if (/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(tok)) return true;   // the game ends here
      var n = /^\{(\d+)\}$/.exec(tok);
      if (n) {
        var note = notes[+n[1]], last = line.moves[line.moves.length - 1];
        if (!note) return false;
        if (last) last.note = (last.note ? last.note + " " : "") + note;
        else line.note = (line.note ? line.note + " " : "") + note;
        return false;
      }
      var legal = legalMoves(pos), mv = parseSAN(pos, tok, legal);
      if (!mv) { line.broken = true; return true; }
      line.moves.push({ san: san(pos, mv, legal), uci: uci(mv), from: mv.from, to: mv.to, promo: mv.promo || "", note: "" });
      pos = makeMove(pos, mv);
      line.positions.push(pos);
      line.fens.push(toFEN(pos));
      return false;
    });
    var end = line.positions[line.positions.length - 1];
    line.mate = !line.broken && inCheck(end, end.turn) && !legalMoves(end).length;
    return line;
  }

  // The move number before a half-move: "12." or "12…" (Black's).
  function moveNumber(line, k) {
    var n = line.first + k;
    return Math.floor(n / 2) + 1 + (n % 2 ? "…" : ".");
  }

  // The game as a short, clean PGN: the main tags and the moves, no
  // comments (for lichess's link and for Claude).
  function cleanPGN(line, extraTags) {
    var keep = ["Event", "Site", "Date", "Round", "White", "Black", "Result", "WhiteElo", "BlackElo", "FEN", "SetUp"];
    var tags = {}, k;
    keep.forEach(function (t) { if (line.tags[t]) tags[t] = line.tags[t]; });
    for (k in extraTags || {}) if (extraTags[k]) tags[k] = extraTags[k];
    if (line.start) { tags.SetUp = "1"; tags.FEN = line.start; }
    var head = Object.keys(tags).map(function (t) { return "[" + t + " \"" + String(tags[t]).replace(/["\\]/g, "") + "\"]"; });
    var moves = [];
    line.moves.forEach(function (mv, i) {
      var n = line.first + i;
      if (n % 2 === 0) moves.push(Math.floor(n / 2) + 1 + ".");
      else if (i === 0) moves.push(Math.floor(n / 2) + 1 + "...");
      moves.push(mv.san);
    });
    moves.push(tags.Result || "*");
    return head.join("\n") + (head.length ? "\n\n" : "") + moves.join(" ");
  }

  /* ---------- the data ------------------------------------------------------ */

  function slug(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tournament";
  }

  // Each tournament's anchor in the database (chess-games.html#<id>): its
  // `id`, else made from its name and start date. The map, the database
  // and the analysis tool all call this, so they agree.
  function tournamentIds(list) {
    var seen = {};
    return list.map(function (tm) {
      var id = tm.id || slug((tm.name || "") + "-" + (tm.start || ""));
      while (seen[id]) id += "-2";
      seen[id] = true;
      return id;
    });
  }

  // Each game's key in data/chess-eval.json: "<tournament id>/r<round>",
  // or "/g<n>" for a game with no round.
  function gameKeys(id, games) {
    var seen = {};
    return (games || []).map(function (g, n) {
      var key = id + "/" + (g.round != null && g.round !== "" ? "r" + g.round : "g" + (n + 1));
      while (seen[key]) key += "-2";
      seen[key] = true;
      return key;
    });
  }

  // Winning chances (−1 … 1) from centipawns, lichess's curve.
  function winning(cp) { return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1; }

  return {
    START: START, sqIndex: sqIndex, sqName: sqName, side: side,
    fromFEN: fromFEN, toFEN: toFEN, startPosition: startPosition,
    attacked: attacked, inCheck: inCheck, legalMoves: legalMoves, makeMove: makeMove, perft: perft,
    uci: uci, san: san, parseSAN: parseSAN, parseUCI: parseUCI, uciLineToSAN: uciLineToSAN,
    cleanNote: cleanNote, readTags: readTags, readPGN: readPGN, moveNumber: moveNumber, cleanPGN: cleanPGN,
    slug: slug, tournamentIds: tournamentIds, gameKeys: gameKeys, winning: winning
  };
});
