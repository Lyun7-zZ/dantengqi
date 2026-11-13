/**
 * 大师 AI：迭代加深 αβ + 结构评估 + 锁路计划层。
 * 移植自朋友的分支（ai2.js），仅补上模块 import 与 path 内部常量。
 */

import { COLS, ROWS, H_COUNT, allWallSlots } from "./board.js";
import { distanceOf, legalDirs, applyAction, validateAction, cloneState, wallPlaced, stepTarget, autoMove, setWall } from "./rules.js";
import { shortestPathWalls, distanceToGoal, hasPath } from "./path.js";
import { randomAI } from "./ai-random.js";

const AI2_SIZE = COLS * ROWS;

function takeWin(state) {
  const p = state.players[state.turn];
  if (p.r !== 0) return null;
  const t = stepTarget(state, p.c, p.r, "up");
  if (!t || !t.exit) return null;
  return { type: "move", dir: "up" };
}
const ai2Key = (c, r) => r * COLS + c;

/**
 * 强 AI：迭代加深 αβ + 结构评估 + 锁路计划层。
 * 纯逻辑，不依赖 DOM，便于自对弈测试。
 */

const AI_WIN = 1e9;

function aiNow() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function marginFor(state, p) {
  return distanceOf(state, 1 - p) - distanceOf(state, p);
}

function countOpenExits(state) {
  let n = 0;
  for (let c = 0; c < COLS; c++) if (state.topWall[c] === 0) n++;
  return n;
}

/** 到终点的最短路条数（截断），衡量备选路是否被砍光。 */
function pathCount(state, p, cap = 24) {
  const { vWall, hWall, topWall } = state;
  const pl = state.players[p];
  const dist = new Int16Array(AI2_SIZE).fill(-1);
  const ways = new Int16Array(AI2_SIZE);
  const q = new Int16Array(AI2_SIZE * 2);
  let head = 0;
  let tail = 0;
  const sk = ai2Key(pl.c, pl.r);
  dist[sk] = 0;
  ways[sk] = 1;
  q[tail++] = pl.c;
  q[tail++] = pl.r;
  while (head < tail) {
    const c = q[head++];
    const r = q[head++];
    const k = ai2Key(c, r);
    const d = dist[k];
    const w = ways[k];
    const relax = (nc, nr) => {
      const nk = ai2Key(nc, nr);
      if (dist[nk] < 0) {
        dist[nk] = d + 1;
        ways[nk] = w;
        q[tail++] = nc;
        q[tail++] = nr;
      } else if (dist[nk] === d + 1) {
        ways[nk] = Math.min(cap, ways[nk] + w);
      }
    };
    if (r > 0 && hWall[c * H_COUNT + (r - 1)] === 0) relax(c, r - 1);
    if (r < ROWS - 1 && hWall[c * H_COUNT + r] === 0) relax(c, r + 1);
    if (c > 0 && vWall[(c - 1) * ROWS + r] === 0) relax(c - 1, r);
    if (c < COLS - 1 && vWall[c * ROWS + r] === 0) relax(c + 1, r);
  }
  let gd = Infinity;
  for (let c = 0; c < COLS; c++) {
    if (topWall[c] !== 0) continue;
    const d = dist[ai2Key(c, 0)];
    if (d >= 0 && d + 1 < gd) gd = d + 1;
  }
  if (!Number.isFinite(gd)) return 0;
  let count = 0;
  for (let c = 0; c < COLS; c++) {
    if (topWall[c] !== 0) continue;
    const d = dist[ai2Key(c, 0)];
    if (d + 1 === gd) count += ways[ai2Key(c, 0)];
  }
  return Math.min(cap, count);
}

/** 结构评估：胜势奖励“更快到达”，并把“出口被关光”视为平局。 */
function evalAI(state) {
  if (state.winner !== null) {
    if (state.winner === "draw") return 0;
    return state.winner === state.turn ? AI_WIN : -AI_WIN;
  }
  const me = state.turn;
  const opp = 1 - me;
  const dm = distanceOf(state, me);
  const dop = distanceOf(state, opp);
  const exits = countOpenExits(state);
  if (!Number.isFinite(dm) || !Number.isFinite(dop)) {
    if (!Number.isFinite(dm) && !Number.isFinite(dop)) return 0;
    if (!Number.isFinite(dm)) return -AI_WIN / 2;
    return AI_WIN / 2;
  }
  if (exits === 0) return 0;
  const m = dop - dm;
  let s;
  if (m >= 2) {
    // 领先：出口越少，越要立刻冲线；堆墙没有收益
    s = 5000 - 12 * dm - 35 * (10 - exits);
  } else if (m === 1) {
    // 差 1 步：出口越少越接近平局
    s = -100 - 20 * (10 - exits);
  } else if (m === 0) {
    s = -250;
  } else {
    // 落后：出口越少越容易逼平
    s = -5000 + 10 * m + 30 * (10 - exits);
  }
  if (m >= -2 && m <= 2) {
    s += 5 * (pathCount(state, me, 20) - pathCount(state, opp, 20));
  }
  s += 6;
  return s;
}

/** 走法生成：走子 + 对手最短路墙 + （根节点）全墙扫描的高收益墙 + 计划墙。 */
function candidatesAI(state, opts = {}) {
  const me = state.turn;
  const opp = 1 - me;
  const out = [];
  const seen = new Set();
  const add = (a) => {
    const k = a.type === "move" ? `m:${a.dir}` : `w:${a.kind}:${a.c}:${a.r}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(a);
  };
  const mp = state.players[me];
  for (const dir of legalDirs(state, mp.c, mp.r)) add({ type: "move", dir });

  const op = state.players[opp];
  for (const w of shortestPathWalls(state, op.c, op.r)) {
    if (!wallPlaced(state, w.kind, w.c, w.r)) add({ type: "wall", kind: w.kind, c: w.c, r: w.r });
  }

  if (opts.scanAll) {
    const base = distanceToGoal(state, op.c, op.r);
    const scored = [];
    for (const w of allWallSlots()) {
      if (wallPlaced(state, w.kind, w.c, w.r)) continue;
      const probe = cloneState(state);
      setWall(probe, w.kind, w.c, w.r);
      if (!hasPath(probe, probe.players[me].c, probe.players[me].r)) continue;
      const dop = distanceToGoal(probe, op.c, op.r);
      if (!Number.isFinite(dop)) continue;
      const gain = dop - base;
      if (gain >= 1) scored.push([gain, { type: "wall", kind: w.kind, c: w.c, r: w.r }]);
    }
    scored.sort((x, y) => y[0] - x[0]);
    for (let i = 0; i < Math.min(opts.scanAll, scored.length); i++) add(scored[i][1]);
  }
  if (opts.topWalls || marginFor(state, me) <= 0) {
    for (let c = 0; c < COLS; c++) {
      if (state.topWall[c] === 0) add({ type: "wall", kind: "t", c, r: 0 });
    }
  }
  if (opts.planWall) add(opts.planWall);
  return out;
}

/** 排序用：刚走完一方的静态优势。 */
function orderScore(state) {
  return distanceOf(state, state.turn) - distanceOf(state, 1 - state.turn);
}

function searchAI(state, depth, alpha, beta, ctx) {
  ctx.nodes++;
  if ((ctx.nodes & 255) === 0 && aiNow() >= ctx.deadline) {
    ctx.abort = true;
    return 0;
  }
  if (state.winner !== null || depth === 0) return evalAI(state);

  const cands = candidatesAI(state);
  const scored = [];
  for (const a of cands) {
    const r = applyAction(state, a);
    if (!r.ok) continue;
    scored.push([orderScore(r.state), a, r.state]);
  }
  scored.sort((x, y) => y[0] - x[0]);

  let best = -Infinity;
  for (const [, , st] of scored) {
    const v = -searchAI(st, depth - 1, -beta, -alpha, ctx);
    if (ctx.abort) return 0;
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best === -Infinity ? evalAI(state) : best;
}

/** 迭代加深根搜索。 */
function rootSearch(state, rng, timeMs, maxDepth) {
  const win = takeWin(state);
  if (win) return win;

  const me = state.turn;
  const cands = candidatesAI(state, { scanAll: 6 });
  const ordered = [];
  for (const a of cands) {
    const r = applyAction(state, a);
    if (!r.ok) continue;
    let s = orderScore(r.state);
    if (a.type === "move") s += 0.01;
    ordered.push({ a, st: r.state, score: s });
  }
  if (!ordered.length) return autoMove(state);
  ordered.sort((x, y) => y.score - x.score);

  const ctx = { deadline: aiNow() + Math.max(20, timeMs), nodes: 0, abort: false };
  let best = ordered[0].a;
  let bestScore = -Infinity;

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -Infinity;
    let localBest = null;
    let localScore = -Infinity;
    for (const item of ordered) {
      const v = -searchAI(item.st, depth - 1, -Infinity, -alpha, ctx);
      if (ctx.abort) break;
      if (v > localScore) {
        localScore = v;
        localBest = item.a;
      }
      if (v > alpha) alpha = v;
    }
    if (ctx.abort) break;
    if (localBest) {
      best = localBest;
      bestScore = localScore;
      ordered.sort((x, y) => (x.a === best ? -1 : y.a === best ? 1 : y.score - x.score));
    }
    if (bestScore >= AI_WIN * 0.9) break;
    if (aiNow() >= ctx.deadline) break;
  }
  return best;
}

/* ---------- 锁路计划层 ---------- */

/** 对手一步内的最佳“反切/前进”应手（用于计划模拟）。 */
function bestOpponentAction(state, opp) {
  let best = null;
  let bestScore = -Infinity;
  for (const a of candidatesAI(state, { topWalls: true })) {
    const r = applyAction(state, a);
    if (!r.ok) continue;
    if (r.state.winner === opp) return a;
    let s;
    if (r.state.winner === "draw") s = 5e8;
    else if (r.state.winner !== null) s = -1e9;
    else {
      s = marginFor(r.state, opp);
      if (s <= 0) s += 30 * (10 - countOpenExits(r.state));
    }
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best;
}

/** 自适应执行：优先封对手当前列，把对手往缺口赶。 */
function nextPlanWallFor(state, walls, me) {
  const op = state.players[1 - me];
  const remaining = walls.filter((w) => !wallPlaced(state, w.kind, w.c, w.r));
  if (!remaining.length) return null;
  remaining.sort((a, b) => Math.abs(a.c - op.c) - Math.abs(b.c - op.c));
  for (const w of remaining) {
    if (validateAction(state, w).ok) return w;
  }
  return null;
}

/** 模拟“我按计划封墙、对手每步走最优应手”的完整过程。 */
function simulatePlan(state, walls, me) {
  let s = state;
  let placed = 0;
  for (let i = 0; i < walls.length + 2; i++) {
    const w = nextPlanWallFor(s, walls, me);
    if (!w) break;
    placed++;
    const ra = applyAction(s, w);
    if (!ra.ok) return null;
    s = ra.state;
    if (s.winner !== null) break;
    const a = bestOpponentAction(s, 1 - me);
    if (!a) return null;
    const rb = applyAction(s, a);
    if (!rb.ok) return null;
    s = rb.state;
    if (s.winner !== null) break;
  }
  if (!placed) return null;
  if (s.winner === null && walls.some((w) => !wallPlaced(s, w.kind, w.c, w.r))) return null;
  return s;
}

/** 生成并评估锁路计划：横排留一个缺口，缺口在离对手最远一侧。 */
function makePlanAI(state) {
  const me = state.turn;
  const opp = 1 - me;
  const my = state.players[me];
  const op = state.players[opp];
  const dm = distanceOf(state, me);
  const dop = distanceOf(state, opp);
  if (!Number.isFinite(dm) || !Number.isFinite(dop)) return null;
  if (countOpenExits(state) < 5) return null;    // 出口快关光时锁路=送平局，必须冲线
  if (dop - dm < 2 || dop - dm > 4) return null; // 只在领先脆弱时锁路；大幅领先直接冲线
  if (dop <= 1) return null;
  if (dm <= 3) return null;                      // 自己已很近，冲线更快
  if (my.r > 10) return null;

  let best = null;
  const rows = [my.r, my.r - 1];
  for (const row of rows) {
    if (row < 1 || row > 10) continue;
    if (op.r <= row) continue;
    for (const gap of [0, 9, my.c]) {
      const walls = [];
      for (let c = 0; c < COLS; c++) {
        if (c === gap) continue;
        if (wallPlaced(state, "h", c, row)) continue;
        walls.push({ type: "wall", kind: "h", c, r: row });
      }
      if (!walls.length) continue;
      const sim = simulatePlan(state, walls, me);
      if (!sim) continue;
      if (sim.winner === opp) continue;
      const sdm = distanceOf(sim, me);
      const sdo = distanceOf(sim, opp);
      if (!Number.isFinite(sdm) || !Number.isFinite(sdo)) continue;
      if (countOpenExits(sim) === 0) continue;
      const m = sim.winner === "draw" ? 0 : sdo - sdm;
      if (m >= 2 && (!best || m > best.margin)) {
        best = { row, gap, walls, margin: m, dMe: dm, dOpp: dop, ply: state.plies };
      }
    }
  }
  return best;
}

/** 构建一个带计划层的 AI。 */
function createMasterAI({ timeMs = 1200, maxDepth = 6, usePlan = true } = {}) {
  let plan = null;
  let plansUsed = 0;
  const stats = { plans: 0, planWalls: 0, searches: 0, maxPlies: 0 };

  function choose(state, rng) {
    const win = takeWin(state);
    if (win) return win;

    const me = state.turn;
    const opp = 1 - me;

    if (plan) {
      const my = state.players[me];
      const op = state.players[opp];
      const stale =
        op.r <= plan.row ||
        my.r > plan.row + 1 ||
        distanceOf(state, me) > plan.dMe + 2 ||
        state.winner !== null;
      if (stale) {
        plan = null;
      } else {
        // 用当前局面重算计划价值；变差就放弃
        const sim = simulatePlan(state, plan.walls, me);
        if (sim && sim.winner !== opp) {
          const sm = distanceOf(sim, me);
          const so = distanceOf(sim, opp);
          const m = sim.winner === "draw" ? 0 : (Number.isFinite(sm) && Number.isFinite(so) ? so - sm : -1);
          if (m >= 2) {
            const w = nextPlanWallFor(state, plan.walls, me);
            if (w) { stats.planWalls++; return w; }
          }
        }
        plan = null;
      }
    }

    if (usePlan && plansUsed < 2) {
      const p = makePlanAI(state);
      if (p) {
        plan = p;
        plansUsed++;
        stats.plans++;
        const w = nextPlanWallFor(state, p.walls, me);
        if (w) { stats.planWalls++; return w; }
        plan = null;
      }
    }

    stats.searches++;
    return rootSearch(state, rng, timeMs, maxDepth);
  }

  choose.stats = stats;
  choose.planBudget = () => plansUsed;
  choose.reset = () => {
    plan = null;
    plansUsed = 0;
    stats.plans = 0;
    stats.planWalls = 0;
    stats.searches = 0;
    stats.maxPlies = 0;
  };
  choose.planInfo = () => plan;
  return choose;
}

/**
 * 档位：
 *   easy   偶尔随机
 *   normal 一步贪心
 *   hard   4 层 αβ + 结构评估（不锁路）
 *   master 6 层 αβ + 结构评估 + 锁路计划层
 */


// 调试/自测入口（不参与对局逻辑）

export { createMasterAI };
