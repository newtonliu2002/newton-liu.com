#!/usr/bin/env node
/* Engine analysis for the chess database, run on Newton's Mac.

   Reads data/chess.json, plays every game that has a PGN through
   assets/chess-core.js (the site's own rules), asks Stockfish for each
   position, and writes data/chess-eval.json, which the database's board
   reads when it opens: the evaluation of every position (an eval bar and a
   graph), the engine's best move and line, and each move judged as an
   inaccuracy (?!), mistake (?) or blunder (??) by lichess's rule. Visitors
   download a few KB per game; nothing runs in their browser.

     node tools/chess-eval.mjs                 every game not analysed yet
     node tools/chess-eval.mjs --force         every game again
     node tools/chess-eval.mjs --only <id>     one tournament (its id)
     node tools/chess-eval.mjs --depth 22      deeper (default 20)

   The engine: $STOCKFISH, else ~/.local/bin/stockfish (the official
   Stockfish 19 macOS build, installed 2026-10-19 in
   ~/.local/share/stockfish-19). No packages; Node 18+.
   A game is analysed again by itself when its moves change (the stored
   `uci` no longer matches), or at a greater --depth. */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const C = createRequire(import.meta.url)(join(ROOT, "assets", "chess-core.js"));
const DATA = join(ROOT, "data", "chess.json");
const OUT = join(ROOT, "data", "chess-eval.json");

const args = process.argv.slice(2);
function opt(name, dflt) {
  const eq = args.find(a => a.startsWith(name + "="));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  if (v == null || v.startsWith("--")) fail(`${name} needs a value`);
  return v;
}
function fail(msg) { console.error(msg); process.exit(1); }
function whole(name, v) { const n = Number(v); if (!Number.isInteger(n) || n < 1) fail(`${name} needs a positive whole number`); return n; }
const DEPTH = whole("--depth", opt("--depth", 20));
const THREADS = whole("--threads", opt("--threads", Math.max(1, Math.min(8, cpus().length - 2))));
const FORCE = args.includes("--force");
const ONLY = opt("--only", null);
const ENGINE = process.env.STOCKFISH || join(homedir(), ".local", "bin", "stockfish");
const PV_LEN = 8;                          // moves of the best line kept (SAN)

if (!existsSync(ENGINE)) {
  console.error(`No engine at ${ENGINE}. Set STOCKFISH=/path/to/stockfish.`);
  process.exit(1);
}

/* ---------- the engine (UCI over stdin/stdout) ---------------------------- */

const sf = spawn(ENGINE, [], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "", waiters = [], where = "starting the engine";
// The engine stopping (a crash, a kill) ends the run loudly. Every game
// finished so far is already saved (see save()).
function engineGone(why) {
  console.error(`The engine stopped (${why}) while ${where}. Games finished before this are saved; run again to continue.`);
  process.exit(1);
}
sf.on("exit", (code, signal) => { if (!quitting) engineGone(signal || "exit code " + code); });
sf.on("error", err => engineGone(err.message));
let quitting = false;
sf.stdout.setEncoding("utf8");
sf.stdout.on("data", chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    waiters = waiters.filter(w => !w(line));
  }
});
const send = s => sf.stdin.write(s + "\n");
// Resolves with every line up to (and including) the first that `done` accepts.
function until(done) {
  return new Promise(resolve => {
    const lines = [];
    waiters.push(line => {
      lines.push(line);
      // A command the engine refused never gets its answer: stop, don't hang.
      if (/^info string CRITICAL ERROR/.test(line)) { where += ": " + line; engineGone("it refused a command"); }
      if (done(line)) { resolve(lines); return true; }
      return false;
    });
  });
}

let engineName = "Stockfish";
async function init() {
  send("uci");
  const lines = await until(l => l === "uciok");
  const id = lines.find(l => l.startsWith("id name "));
  if (id) engineName = id.slice(8);
  send(`setoption name Threads value ${THREADS}`);
  send("setoption name Hash value 512");
  send("isready");
  await until(l => l === "readyok");
}

// The engine's view of one position: score (side to move) and its line.
async function analyse(start, moves) {
  send(start ? `position fen ${start}${moves.length ? " moves " + moves.join(" ") : ""}`
             : `position startpos${moves.length ? " moves " + moves.join(" ") : ""}`);
  send(`go depth ${DEPTH}`);
  const lines = await until(l => l.startsWith("bestmove"));
  let score = null, pv = [];
  for (const l of lines) {
    if (!l.startsWith("info ") || !/ score /.test(l) || / multipv (?!1 )/.test(l)) continue;
    if (/ (lowerbound|upperbound)/.test(l)) continue;
    const m = / score (cp|mate) (-?\d+)/.exec(l);
    if (m) score = { kind: m[1], n: +m[2] };
    const p = / pv (.+)$/.exec(l);
    if (p) pv = p[1].trim().split(/\s+/);
  }
  const best = /^bestmove (\S+)/.exec(lines[lines.length - 1]);
  if ((!pv.length || pv[0] !== best?.[1]) && best && best[1] !== "(none)") pv = [best[1]];
  return { score, pv };
}

/* ---------- judging a move (lichess's Advice rules) ----------------------- */

// The evaluation from the mover's side: { cp } or { mate } (>0: the mover mates).
function moverView(e, mover) {
  const flip = mover === "w" ? 1 : -1;
  if (e.mated) return { mate: e.mated === mover ? -0 : 0, matedSide: e.mated };
  if (e.m != null) return { mate: e.m * flip };
  return { cp: (e.c || 0) * flip };
}
function judge(prev, next, mover) {
  const p = moverView(prev, mover), n = moverView(next, mover);
  if (n.matedSide) return null;            // he mated (or was mated, which a move can't do)
  const pm = p.mate != null ? p.mate : null, nm = n.mate != null ? n.mate : null;
  const pcp = p.cp != null ? p.cp : 0, ncp = n.cp != null ? n.cp : 0;
  // Now the mover is getting mated, and wasn't before.
  if (nm != null && nm < 0 && !(pm != null && pm < 0)) {
    return pcp < -999 ? "?!" : pcp < -700 ? "?" : "??";
  }
  // The mover had a mate, and lost it.
  if (pm != null && pm > 0 && !(nm != null && nm > 0)) {
    return ncp > 999 ? "?!" : ncp > 700 ? "?" : "??";
  }
  if (pm != null || nm != null) return null;
  // lichess (CpAdvice) caps both scores at ±1000 before the curve, so a
  // decided position isn't marked for drifting from +30 to +8.
  const cap = c => Math.max(-1000, Math.min(1000, c));
  const drop = C.winning(cap(pcp)) - C.winning(cap(ncp));
  return drop >= 0.3 ? "??" : drop >= 0.2 ? "?" : drop >= 0.1 ? "?!" : null;
}

/* ---------- the games ----------------------------------------------------- */

const data = JSON.parse(readFileSync(DATA, "utf8"));
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
out.games = out.games || {};

const list = (data.tournaments || []).slice().sort((a, b) => String(b.start || "").localeCompare(String(a.start || "")));
const ids = C.tournamentIds(list);
const jobs = [];
list.forEach((tm, i) => {
  if (ONLY && ids[i] !== ONLY) return;
  const keys = C.gameKeys(ids[i], tm.games);
  (tm.games || []).forEach((g, n) => { if (g.pgn && g.bye == null) jobs.push({ key: keys[n], g, name: tm.name }); });
});

if (ONLY && !ids.includes(ONLY)) fail(`No tournament has the id "${ONLY}". The ids: ${ids.join(", ") || "(none)"}`);

// Written after every game (tmp + rename), so a crash or Ctrl-C loses at
// most the game being analysed.
function save() {
  const tmp = OUT + ".tmp";
  writeFileSync(tmp, JSON.stringify(out) + "\n");
  renameSync(tmp, OUT);
}

await init();
out.engine = engineName;
const t0 = Date.now();
let done = 0;
const live = new Set(jobs.map(j => j.key));
for (const { key, g, name } of jobs) {
  const line = C.readPGN(g.pgn);
  const uciMoves = line.moves.map(m => m.uci);
  const was = out.games[key];
  if (!FORCE && was && was.uci === uciMoves.join(" ") && was.depth >= DEPTH) continue;
  if (line.broken) console.warn(`${key}: the PGN stops being readable after ${line.moves.length} moves; analysing those.`);

  const ev = [];
  for (let k = 0; k <= uciMoves.length; k++) {
    const pos = line.positions[k], legal = C.legalMoves(pos);
    if (!legal.length) {                   // the game is over on the board
      ev.push(C.inCheck(pos, pos.turn) ? { mated: pos.turn } : { c: 0 });
      continue;
    }
    where = `analysing ${key}, half-move ${k}`;
    const { score, pv } = await analyse(line.start, uciMoves.slice(0, k));
    const flip = pos.turn === "w" ? 1 : -1, e = {};
    if (score && score.kind === "mate") e.m = score.n * flip;
    else e.c = score ? score.n * flip : 0;
    const sanLine = C.uciLineToSAN(pos, pv, PV_LEN);
    if (sanLine.length) { e.b = sanLine[0]; e.pv = sanLine.join(" "); }
    ev.push(e);
  }
  const j = uciMoves.map((u, k) => {
    const mover = line.positions[k].turn;
    // The engine's own first choice is never marked, whatever the scores say.
    if (ev[k].b && line.moves[k].san === ev[k].b) return null;
    return judge(ev[k], ev[k + 1], mover);
  });
  out.games[key] = { uci: uciMoves.join(" "), depth: DEPTH, ev, j };
  out.depth = DEPTH;
  save();
  done++;
  const marks = j.filter(Boolean).length;
  console.log(`${key} (${name}): ${uciMoves.length} moves, ${marks} marked, ${Math.round((Date.now() - t0) / 1000)} s`);
}

// Games no longer in chess.json (or no longer with a PGN) are dropped, at
// the end of a full run only (never by --only or a run that stopped early).
if (!ONLY) for (const key of Object.keys(out.games)) if (!live.has(key)) delete out.games[key];
out.depth = DEPTH;
save();
console.log(`${done} game(s) analysed with ${engineName} at depth ${DEPTH} (${THREADS} threads); ${Object.keys(out.games).length} in ${OUT.replace(ROOT + "/", "")}.`);
quitting = true;
send("quit");
