/**
 * 无界面自对弈数据生成器。
 *
 * 用法：node tools/selfplay-gen.mjs <局数> <输出jsonl> [预算ms] [seed基] [配方hell|gm]
 *
 * 每局：前 6 手随机开局，其余用 800ms 预算的引擎。
 * 每手输出一行 JSON：局面特征、选择、决策来源、搜索分数、耗时。
 * 每局结束输出一行 result。
 */

import { createMasterAI, debugPathCount } from "../src/ai-master.js";
import {
  createState, applyAction, validateAction, legalDirs, wallPlaced, distanceOf,
} from "../src/rules.js";
import { allWallSlots, COLS, ROWS } from "../src/board.js";
import { shortestPathWalls } from "../src/path.js";

const GAMES = Number(process.argv[2] || 4);
const OUT = process.argv[3] || "_extract/selfplay.jsonl";
const BUDGET = Number(process.argv[4] || 800);
const SEED_BASE = Number(process.argv[5] || 9000);
const RECIPE = process.argv[6] || "hell";

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hell = createMasterAI({
  timeMs: BUDGET, maxDepth: 12, usePlan: true,
  netWalls: true, avoidRepeat: true, repeatPenalty: 160,
  planMoves: true, planFallback: true, necessaryPathGuard: "soft", endgameDepth: 12,
  routeWalls: 3, smartExit: true,
});
const gm = createMasterAI({
  timeMs: Math.max(100, Math.round(BUDGET * 0.375)), maxDepth: 7, usePlan: true,
  netWalls: true, avoidRepeat: true, repeatPenalty: 160,
  planMoves: true, planFallback: true, necessaryPathGuard: "soft", endgameDepth: 9,
});

function hash(state) {
  let h = 0x811c9dc5;
  const mix = (n) => { h ^= n & 0xff; h = Math.imul(h, 0x01000193); };
  for (const p of state.players) { mix(p.c); mix(p.r); }
  for (const v of state.vWall) mix(v);
  for (const v of state.hWall) mix(v);
  for (const v of state.topWall) mix(v);
  mix(state.turn);
  return (h >>> 0).toString(16);
}

/** 从某个顶部出口反向 BFS：每个格子到该出口的步数（含越线）。 */
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

/** 每个开放出口的 gap（对手步数 - 我步数）。 */
function exitGaps(state, side) {
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
    out.push({ c, dm, dop, gap: dop - dm });
  }
  return out;
}

/** 一条最短路（格子集合）。 */
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

/** 最佳单墙净收益与最大砍路数。 */
function wallStats(state, side) {
  const opp = 1 - side;
  const me = state.players[side];
  const op = state.players[opp];
  const dm0 = distanceOf(state, side);
  const dop0 = distanceOf(state, 1 - side);
  const basePaths = debugPathCount(state, opp);
  let bestNet = -99;
  let bestCut = 0;
  for (const w of allWallSlots()) {
    if (wallPlaced(state, w.kind, w.c, w.r)) continue;
    const a = { type: "wall", kind: w.kind, c: w.c, r: w.r };
    if (!validateAction(state, a).ok) continue;
    const r = applyAction(state, a);
    if (!r.ok) continue;
    const dm = distanceOf(r.state, side);
    const dop = distanceOf(r.state, 1 - side);
    if (!Number.isFinite(dm) || !Number.isFinite(dop)) continue;
    const net = (dop - dop0) - (dm - dm0);
    if (net > bestNet) bestNet = net;
    const cut = basePaths - debugPathCount(r.state, opp);
    if (cut > bestCut) bestCut = cut;
  }
  return { bestNet, bestCut };
}

function features(state, side) {
  const me = state.players[side];
  const opp = state.players[1 - side];
  const dMe = distanceOf(state, side);
  const dOpp = distanceOf(state, 1 - side);
  const exits = state.topWall.filter((v) => v === 0).length;
  const near = (p) => {
    let n = 0;
    for (let c = 0; c < COLS; c++) {
      if (state.topWall[c] === 0 && Math.abs(c - state.players[p].c) <= 3) n++;
    }
    return n;
  };
  const gaps = exitGaps(state, side);
  const gapWorst = gaps.length ? Math.min(...gaps.map((g) => g.gap)) : 0;
  const gapBest = gaps.length ? Math.max(...gaps.map((g) => g.gap)) : 0;
  const gapMean = gaps.length ? gaps.reduce((a, g) => a + g.gap, 0) / gaps.length : 0;
  const pMe = shortestPath(state, side);
  const pOpp = shortestPath(state, 1 - side);
  const setMe = new Set(pMe);
  const overlap = pOpp.filter((cell) => setMe.has(cell)).length;
  const overlapRatio = Math.min(pMe.length, pOpp.length) > 0
    ? overlap / Math.min(pMe.length, pOpp.length) : 0;
  const ws = wallStats(state, side);

  return {
    ply: state.plies,
    exitCount: gaps.length,
    gapWorst, gapBest, gapMean,
    pathLenMe: pMe.length, pathLenOpp: pOpp.length,
    overlap, overlapRatio,
    bestWallNet: ws.bestNet, bestWallCut: ws.bestCut,
    first: state.firstPlayer,
    isFirst: state.firstPlayer === side ? 1 : 0,
    dMe, dOpp, margin: dOpp - dMe,
    exits,
    nearMe: near(side), nearOpp: near(1 - side),
    pathsMe: debugPathCount(state, side),
    pathsOpp: debugPathCount(state, 1 - side),
    movesMe: legalDirs(state, me.c, me.r).length,
    movesOpp: legalDirs(state, opp.c, opp.r).length,
    meC: me.c, meR: me.r, oppC: opp.c, oppR: opp.r,
    colDiff: Math.abs(me.c - opp.c), rowDiff: Math.abs(me.r - opp.r),
    wallsPlaced: state.wallsPlaced,
    wallDensity: Math.round((state.wallsPlaced / 228) * 1000) / 1000,
    atRow0Me: me.r === 0 ? 1 : 0,
    atRow0Opp: opp.r === 0 ? 1 : 0,
  };
}

function randomOpening(state, rng) {
  const acts = [];
  const me = state.turn;
  const p = state.players[me];
  for (const dir of legalDirs(state, p.c, p.r)) acts.push({ type: "move", dir });
  for (const w of shortestPathWalls(state, state.players[0].c, state.players[0].r)) acts.push(w);
  for (const w of shortestPathWalls(state, state.players[1].c, state.players[1].r)) acts.push(w);
  for (let i = acts.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [acts[i], acts[j]] = [acts[j], acts[i]];
  }
  for (const a of acts) if (validateAction(state, a).ok) return a;
  return null;
}

const { writeFileSync } = await import("node:fs");
const lines = [];
let totalMoves = 0;

for (let g = 0; g < GAMES; g++) {
  hell.reset();
  gm.reset();
  const rng = makeRng(SEED_BASE + g);
  const vsGm = RECIPE === "gm";
  const hellSide = vsGm ? Math.floor(g / 2) % 2 : null;
  let s = createState(g % 2, { drawMode: "firstOnly" });
  let ply = 0;
  let outcome = null;
  while (s.winner === null && ply < 240) {
    const side = s.turn;
    const useHell = !vsGm || side === hellSide;
    let a;
    let source = "opening";
    let score = null;
    let nodes = null;
    let elapsed = 0;
    if (ply < 6) {
      a = randomOpening(s, rng);
      if (!a) break;
    } else {
      const t0 = Date.now();
      a = useHell ? hell(s, rng) : gm(s, rng);
      elapsed = Date.now() - t0;
      if (useHell) {
        source = hell.stats.lastLog?.source || "?";
        score = hell.stats.lastLog?.score ?? null;
        nodes = hell.stats.lastLog?.nodes ?? null;
      } else {
        source = "gm";
      }
    }
    const f = features(s, side);
    lines.push(JSON.stringify({
      g: SEED_BASE + g,
      side,
      ...f,
      agent: useHell ? "hell" : "gm",
      source,
      score,
      nodes,
      elapsed,
      action: a,
      hash: hash(s),
    }));
    const r = applyAction(s, a);
    if (!r.ok) break;
    s = r.state;
    ply++;
  }
  if (s.winner !== null) outcome = s.winner;
  lines.push(JSON.stringify({
    g: SEED_BASE + g,
    result: outcome === null ? "truncated" : outcome === "draw" ? "draw" : outcome,
    plies: ply,
    hellSide,
  }));
  totalMoves += ply;
}

writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log(`写入 ${OUT}：${GAMES} 局，${totalMoves} 手，${lines.length} 行`);
