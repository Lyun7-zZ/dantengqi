/**
 * Stage 1b：更大样本 + 更丰富动作特征。
 * 用法：node tools/label-positions2.mjs <目标数> <输出> [深度] [每局上限] [分片] [总分片]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createState, applyAction, legalDirs, distanceOf } from "../src/rules.js";
import { debugRootScores, debugPathCount } from "../src/ai-master.js";
import { COLS, ROWS } from "../src/board.js";

const TARGET = Number(process.argv[2] || 250);
const OUT = process.argv[3] || "_extract/labels2.jsonl";
const DEPTH = Number(process.argv[4] || 8);
const PER_GAME = Number(process.argv[5] || 6);
const SHARD = Number(process.argv[6] || 0);
const STRIDE = Number(process.argv[7] || 1);
const SRC = process.argv[8] || "_extract/sp2/all.jsonl";

const lines = readFileSync(SRC, "utf8").split("\n").filter(Boolean);
const games = new Map();
for (const line of lines) {
  const r = JSON.parse(line);
  if (!games.has(r.g)) games.set(r.g, { moves: [] });
  if (!("result" in r)) games.get(r.g).moves.push(r);
}

/** 每个格子到某出口的步数（含越线）。 */
function distToExit(state, exitCol) {
  const dist = new Int16Array(COLS * ROWS).fill(-1);
  const q = [];
  const push = (c, r, d) => {
    const k = r * COLS + c;
    if (dist[k] !== -1) return;
    dist[k] = d;
    q.push(c, r);
  };
  push(exitCol, 0, 1);
  for (let head = 0; head < q.length; head += 2) {
    const c = q[head];
    const r = q[head + 1];
    const d = dist[r * COLS + c];
    if (r > 0 && state.hWall[c * (ROWS - 1) + (r - 1)] === 0) push(c, r - 1, d + 1);
    if (r < ROWS - 1 && state.hWall[c * (ROWS - 1) + r] === 0) push(c, r + 1, d + 1);
    if (c > 0 && state.vWall[(c - 1) * ROWS + r] === 0) push(c - 1, r, d + 1);
    if (c < COLS - 1 && state.vWall[c * ROWS + r] === 0) push(c + 1, r, d + 1);
  }
  return dist;
}

function gaps(state, side) {
  const opp = 1 - side;
  const mp = state.players[side];
  const op = state.players[opp];
  const out = [];
  for (let c = 0; c < COLS; c++) {
    if (state.topWall[c] !== 0) continue;
    const d = distToExit(state, c);
    const dm = d[mp.r * COLS + mp.c];
    const dop = d[op.r * COLS + op.c];
    if (dm < 0 || dop < 0) continue;
    out.push(dop - dm);
  }
  if (!out.length) return { worst: 0, best: 0, mean: 0 };
  return {
    worst: Math.min(...out),
    best: Math.max(...out),
    mean: out.reduce((a, b) => a + b, 0) / out.length,
  };
}

function shortestPath(state, side) {
  const start = state.players[side];
  const key = (c, r) => r * COLS + c;
  const prev = new Map();
  const dist = new Map([[key(start.c, start.r), 0]]);
  const q = [[start.c, start.r]];
  let exit = null;
  for (let head = 0; head < q.length; head++) {
    const [c, r] = q[head];
    if (r === 0 && state.topWall[c] === 0) { exit = [c, r]; break; }
    const d = dist.get(key(c, r));
    const tryCell = (nc, nr) => {
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) return;
      const k = key(nc, nr);
      if (dist.has(k)) return;
      dist.set(k, d + 1);
      prev.set(k, [c, r]);
      q.push([nc, nr]);
    };
    if (r > 0 && state.hWall[c * (ROWS - 1) + (r - 1)] === 0) tryCell(c, r - 1);
    if (r < ROWS - 1 && state.hWall[c * (ROWS - 1) + r] === 0) tryCell(c, r + 1);
    if (c > 0 && state.vWall[(c - 1) * ROWS + r] === 0) tryCell(c - 1, r);
    if (c < COLS - 1 && state.vWall[c * ROWS + r] === 0) tryCell(c + 1, r);
  }
  if (!exit) return [];
  const cells = [];
  let cur = exit;
  while (cur) {
    cells.push(cur[0] + "," + cur[1]);
    cur = prev.get(key(cur[0], cur[1])) || null;
  }
  return cells.reverse();
}

function overlapRatio(state) {
  const a = shortestPath(state, 0);
  const b = shortestPath(state, 1);
  const sa = new Set(a);
  const common = b.filter((x) => sa.has(x)).length;
  const min = Math.min(a.length, b.length);
  return min > 0 ? common / min : 0;
}

function feats(state, side, before) {
  const me = state.players[side];
  const opp = state.players[1 - side];
  const dMe = distanceOf(state, side);
  const dOpp = distanceOf(state, 1 - side);
  const g = gaps(state, side);
  const ov = overlapRatio(state);
  return {
    dMe, dOpp, margin: dOpp - dMe,
    exits: state.topWall.filter((v) => v === 0).length,
    pathsMe: debugPathCount(state, side),
    pathsOpp: debugPathCount(state, 1 - side),
    movesMe: legalDirs(state, me.c, me.r).length,
    movesOpp: legalDirs(state, opp.c, opp.r).length,
    wallsPlaced: state.wallsPlaced,
    gainMe: before ? dMe - before.dMe : 0,
    gainOpp: before ? dOpp - before.dOpp : 0,
    net: before ? (dOpp - before.dOpp) - (dMe - before.dMe) : 0,
    cut: before ? before.pathsOpp - debugPathCount(state, 1 - side) : 0,
    gapWorst: g.worst, gapBest: g.best, gapMean: g.mean,
    dGapWorst: before ? g.worst - before.gapWorst : 0,
    dGapBest: before ? g.best - before.gapBest : 0,
    overlapRatio: ov,
    dOverlap: before ? ov - before.overlapRatio : 0,
    isMove: 0, isTop: 0, isWall: 0,
  };
}

function buildState(st, first) {
  const s = createState(first, { drawMode: "firstOnly" });
  s.vWall.set(st.vWall);
  s.hWall.set(st.hWall);
  s.topWall.set(st.topWall);
  s.players = st.players.map((p) => ({ c: p.c, r: p.r }));
  s.turn = st.turn;
  s.firstPlayer = st.firstPlayer;
  s.wallsPlaced = st.wallsPlaced;
  return s;
}

const PLIES = [15, 30, 45, 60, 75, 90, 105, 120, 140, 160];
const out = [];
let t0 = Date.now();
let gi = 0;

for (const [gid, g] of games) {
  if (out.length >= TARGET) break;
  if (gi++ % STRIDE !== SHARD) continue;
  if (!g.moves.length) continue;
  const first = g.moves[0].first;
  let s = createState(first, { drawMode: "firstOnly" });
  let taken = 0;
  for (const m of g.moves) {
    if (taken < PER_GAME && PLIES.includes(m.ply) && out.length < TARGET) {
      const side = s.turn;
      const before = feats(s, side, null);
      const res = debugRootScores(s, { depth: DEPTH, candOpts: { netWalls: true }, routeWalls: 3 });
      const items = [];
      for (const it of res.items) {
        const r = applyAction(s, it.action);
        if (!r.ok) continue;
        const f = feats(r.state, side, before);
        f.isMove = it.action.type === "move" ? 1 : 0;
        f.isTop = it.action.kind === "top" ? 1 : 0;
        f.isWall = it.action.type === "wall" && it.action.kind !== "top" ? 1 : 0;
        items.push({ action: it.action, score: it.score, f });
      }
      if (items.length >= 2) {
        out.push({
          gid, ply: m.ply, side, first,
          state: {
            vWall: Array.from(s.vWall),
            hWall: Array.from(s.hWall),
            topWall: Array.from(s.topWall),
            players: s.players.map((p) => ({ c: p.c, r: p.r })),
            turn: s.turn, firstPlayer: s.firstPlayer, wallsPlaced: s.wallsPlaced,
          },
          depth: res.depth, items,
        });
        taken++;
      }
    }
    const r = applyAction(s, m.action);
    if (!r.ok) break;
    s = r.state;
  }
  if (out.length % 20 === 0 && out.length) {
    console.log(`分片 ${SHARD}：${out.length}/${TARGET}，${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
console.log(`分片 ${SHARD} 完成：${out.length} 个局面，${((Date.now() - t0) / 1000).toFixed(0)}s`);
