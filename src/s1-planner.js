/**
 * S1 多步抗牵制原型（实验，默认不接入生产）。
 *
 * 统一根方视角 M = D_O - D_M，有限时域极大极小；
 * 三臂：s0（原候选+浅层）、deep（同候选加深）、s1（分级候选+加深）。
 */

import { applyAction, validateAction, legalActions, distanceOf } from "./rules.js";
import { vIndex, hIndex } from "./board.js";

const WIN = 1e6;

function legalAll(s) {
  const out = [];
  for (const a of legalActions(s)) if (validateAction(s, a).ok) out.push(a);
  return out;
}
function margin(s, root) {
  const dm = distanceOf(s, root), dop = distanceOf(s, 1 - root);
  if (!Number.isFinite(dm) || !Number.isFinite(dop)) return -WIN / 2;
  return dop - dm;
}
function terminal(s, root) {
  if (s.winner === null) return null;
  if (s.winner === "draw") return 0;
  return s.winner === root ? WIN : -WIN;
}
function key(a) {
  return a.type === "move" ? `m:${a.dir}` : `w:${a.kind}:${a.c}:${a.r}`;
}
function rankWalls(s, root, limit) {
  const me = root, opp = 1 - root;
  const dM = distanceOf(s, me), dO = distanceOf(s, opp);
  const out = [];
  for (const a of legalAll(s)) {
    if (a.type !== "wall") continue;
    const r = applyAction(s, a);
    if (!r.ok) continue;
    const dm = distanceOf(r.state, me), dop = distanceOf(r.state, opp);
    const du = Number.isFinite(dm) ? dm - dM : 100;
    const dv = Number.isFinite(dop) ? dop - dO : 100;
    out.push({ a, du, dv, s: dv * 2 - du * 2 });
  }
  out.sort((x, y) => y.s - x.s);
  return out.slice(0, limit);
}

/** 根方最短路上可被对手封堵的边（用于“牵制反制”分支）。 */
function pathWallActions(s, root) {
  const start = s.players[root];
  const q = [[start.c, start.r]];
  const prev = new Map();
  const seen = new Set([`${start.c},${start.r}`]);
  let goal = null;
  while (q.length) {
    const [c, r] = q.shift();
    if (r === 0 && s.topWall[c] === 0) { goal = [c, r]; break; }
    const nbs = [];
    if (r > 0 && !s.hWall[hIndex(c, r - 1)]) nbs.push([c, r - 1]);
    if (r < 11 && !s.hWall[hIndex(c, r)]) nbs.push([c, r + 1]);
    if (c > 0 && !s.vWall[vIndex(c - 1, r)]) nbs.push([c - 1, r]);
    if (c < 9 && !s.vWall[vIndex(c, r)]) nbs.push([c + 1, r]);
    for (const [nc, nr] of nbs) {
      const k = `${nc},${nr}`;
      if (seen.has(k)) continue;
      seen.add(k);
      prev.set(k, `${c},${r}`);
      q.push([nc, nr]);
    }
  }
  if (!goal) return [];
  const cells = [];
  let cur = `${goal[0]},${goal[1]}`;
  while (cur) {
    const [c, r] = cur.split(",").map(Number);
    cells.push({ c, r });
    cur = prev.get(cur);
  }
  cells.reverse();
  const out = [];
  for (let i = 0; i + 1 < cells.length; i++) {
    const a = cells[i], b = cells[i + 1];
    out.push(a.r === b.r
      ? { type: "wall", kind: "v", c: Math.min(a.c, b.c), r: a.r }
      : { type: "wall", kind: "h", c: a.c, r: Math.min(a.r, b.r) });
  }
  out.push({ type: "wall", kind: "top", c: cells[cells.length - 1].c, r: 0 });
  return out;
}

function wallCenter(a) {
  if (a.kind === "v") return [a.c + 0.5, a.r];
  if (a.kind === "h") return [a.c, a.r + 0.5];
  return [a.c, 0.5];
}

/** 只在己方路径附近寻找“零距离损失”的保护墙，避免零收益墙挤占名额。 */
function protectCandidates(s, root, limit) {
  const me = root, opp = 1 - root;
  const p = s.players[me];
  const dM = distanceOf(s, me), dO = distanceOf(s, opp);
  const out = [];
  for (const a of legalAll(s)) {
    if (a.type !== "wall") continue;
    const c = wallCenter(a);
    const near = Math.abs(c[0] - p.c) + Math.abs(c[1] - p.r);
    if (near > 2.5) continue;
    const r = applyAction(s, a);
    if (!r.ok) continue;
    const dm = distanceOf(r.state, me), dop = distanceOf(r.state, opp);
    if (dm !== dM || dop > dO) continue;
    out.push({ a, near, dv: dop - dO });
  }
  out.sort((x, y) => x.near - y.near || x.dv - y.dv);
  return out.slice(0, limit).map((x) => x.a);
}

function rootCandidates(s, root, mode) {
  const moves = legalAll(s).filter((a) => a.type === "move");
  const wallLimit = mode === "s1" ? 26 : 18;
  const walls = rankWalls(s, root, wallLimit);
  const protect = protectCandidates(s, root, mode === "s1" ? 6 : 4);
  const out = [], seen = new Set();
  const add = (a, source) => {
    const k = key(a);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ a, source });
  };
  for (const m of moves) add(m, "advance");
  for (const w of walls) add(w.a, w.dv > 0 ? "attack" : "prep");
  for (const w of protect) add(w, "protect");
  return { list: out, generated: out.length };
}

/** 节点动作：走子 + 预先筛选的墙（复用根墙列表，逐节点重新验证）。 */
function nodeActions(s, root, wallPool, turn, limit) {
  const moves = legalAll(s).filter((a) => a.type === "move");
  const walls = [];
  for (const w of wallPool) {
    if (walls.length >= limit) break;
    if (validateAction(s, w).ok) walls.push(w);
  }
  return [...moves, ...walls];
}

function makeCtx(deadline) {
  return { deadline, nodes: 0, aborted: false };
}

function search(s, root, depth, alpha, beta, ctx, wallPool) {
  ctx.nodes++;
  if ((ctx.nodes & 127) === 0 && Date.now() >= ctx.deadline) { ctx.aborted = true; return margin(s, root); }
  const tv = terminal(s, root);
  if (tv !== null) return tv;
  if (depth <= 0) return margin(s, root);
  const maximizing = s.turn === root;
  const acts = nodeActions(s, root, wallPool, s.turn, 4);
  if (!acts.length) return margin(s, root);
  if (maximizing) {
    let best = -Infinity;
    for (const a of acts) {
      const r = applyAction(s, a);
      if (!r.ok) continue;
      const v = search(r.state, root, depth - 1, alpha, beta, ctx, wallPool);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
      if (ctx.aborted) break;
    }
    return best === -Infinity ? margin(s, root) : best;
  }
  let best = Infinity;
  for (const a of acts) {
    const r = applyAction(s, a);
    if (!r.ok) continue;
    const v = search(r.state, root, depth - 1, alpha, beta, ctx, wallPool);
    if (v < best) best = v;
    if (best < beta) beta = best;
    if (alpha >= beta) break;
    if (ctx.aborted) break;
  }
  return best === Infinity ? margin(s, root) : best;
}

export function s1Evaluate(state, action, { depth = 5, timeMs = 60000 } = {}) {
  const root = state.turn;
  const r = applyAction(state, action);
  if (!r.ok) return null;
  const rc = rootCandidates(state, root, "s1");
  const wallPool = rc.list.filter((c) => c.a.type === "wall").map((c) => c.a);
  for (const w of pathWallActions(state, root)) {
    if (!wallPool.some((x) => key(x) === key(w))) wallPool.push(w);
  }
  const ctx = makeCtx(Date.now() + timeMs);
  const v = search(r.state, root, depth - 1, -Infinity, Infinity, ctx, wallPool);
  return { value: v, nodes: ctx.nodes, aborted: ctx.aborted };
}

export function s1RootActions(state) {
  const rc = rootCandidates(state, state.turn, "s1");
  return rc.list;
}

export function s1Choose(state, { timeMs = 3000, bufferMs = 100, mode = "s1" } = {}) {
  const root = state.turn;
  const start = Date.now();
  const deadline = start + Math.max(50, timeMs - bufferMs);
  const rc = rootCandidates(state, root, mode);
  const wallPool = rc.list.filter((c) => c.a.type === "wall").map((c) => c.a);
  for (const w of pathWallActions(state, root)) {
    if (!wallPool.some((x) => key(x) === key(w))) wallPool.push(w);
  }
  const maxDepth = mode === "s0" ? 3 : 7;
  const depths = mode === "s0" ? [1, 3] : [1, 3, 5, 7];
  let best = rc.list[0]?.a ?? legalAll(state)[0];
  let bestSource = rc.list[0]?.source ?? "fallback";
  let bestScore = -Infinity, doneDepth = 0;
  let lastNodes = 0;

  for (const depth of depths) {
    if (depth > maxDepth) break;
    if (Date.now() >= deadline) break;
    const ctx = makeCtx(deadline);
    lastNodes = ctx.nodes;
    let localBest = null, localScore = -Infinity, localSource = null;
    let complete = true;
    for (const c of rc.list) {
      const r = applyAction(state, c.a);
      if (!r.ok) continue;
      const v = search(r.state, root, depth - 1, -Infinity, Infinity, ctx, wallPool);
      if (ctx.aborted) { complete = false; break; }
      if (v > localScore) { localScore = v; localBest = c.a; localSource = c.source; }
    }
    lastNodes = ctx.nodes;
    if (complete && localBest) {
      best = localBest; bestScore = localScore; bestSource = localSource; doneDepth = depth;
    } else break;
  }
  return {
    action: best, source: bestSource, score: bestScore, depth: doneDepth,
    nodes: lastNodes, elapsed: Date.now() - start, generated: rc.generated,
    mode,
  };
}
