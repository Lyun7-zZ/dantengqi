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
/** p 附近（列差 ≤3）仍开放的出口数量。 */
function nearExits(state, p) {
  const pc = state.players[p].c;
  let n = 0;
  for (let c = 0; c < COLS; c++) {
    if (state.topWall[c] === 0 && Math.abs(c - pc) <= 3) n++;
  }
  return n;
}

/**
 * 局面评估（站在 state.turn 的角度）。
 *
 * v2 相比 v1：
 *   - 领先时用连续的速度项代替粗糙的分档，引导搜索找更快的赢法；
 *   - 所有区间都计入「最短路条数」与「近端出口」两个结构项，
 *     因为残局里“能封我几条路”比“我还差几步”更能决定胜负；
 *   - 显式惩罚对手站在终点线（下一步就能出）的局面。
 */
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
  // 规则 1.3（drawMode=firstOnly）：先手领先 1 手只是平局，后手领先 1 手却是直接取胜
  const firstOnly = state.drawMode === "firstOnly";
  const meIsFirst = state.firstPlayer === undefined ? true : state.firstPlayer === me;

  const ways = pathCount(state, me, 20) - pathCount(state, opp, 20);
  const near = nearExits(state, me) - nearExits(state, opp);
  const doorstep = (dm === 1 ? 120 : 0) - (dop === 1 ? 120 : 0);
  const openPenalty = 10 - exits;

  const winning = m >= 2 || (firstOnly && !meIsFirst && m === 1);
  const drawish = m === 1 && !winning;

  if (winning) {
    // 赢面：优先缩短自己的步数，其次保住路线，不再堆墙
    return 6000 - 18 * dm - 20 * openPenalty
      + Math.min(m, 6) * 25 + 6 * ways + 4 * near + doorstep;
  }
  if (drawish) {
    // 先手只领先 1 手：想赢就必须再拉开，否则只能保平
    return -60 + 20 * ways + 12 * near - 8 * openPenalty + doorstep;
  }
  // 落后（含均势）：出口越少越可能逼平，差距越大越糟
  return -5400 + 14 * m + 26 * openPenalty + 5 * ways + 6 * near + doorstep;
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
  const op = state.players[opp];
  for (const dir of legalDirs(state, mp.c, mp.r)) add({ type: "move", dir });

  // 只保留真正让对手更慢的墙；不制造“双方一起被拖慢”的无效墙。
  const netWalls = !!opts.netWalls;
  const topWallMinPlies = Number(opts.topWallMinPlies ?? 0);
  const dm0 = netWalls ? distanceToGoal(state, mp.c, mp.r) : 0;
  const dop0 = netWalls ? distanceToGoal(state, op.c, op.r) : 0;
  const wallGain = (w) => {
    const probe = cloneState(state);
    setWall(probe, w.kind, w.c, w.r);
    if (!hasPath(probe, mp.c, mp.r)) return null;
    const dm = distanceToGoal(probe, mp.c, mp.r);
    const dop = distanceToGoal(probe, op.c, op.r);
    if (!Number.isFinite(dm) || !Number.isFinite(dop)) return null;
    return { gainMe: dm - dm0, gainOpp: dop - dop0 };
  };
  const addWall = (w, top = false) => {
    const a = w.type === "wall" ? w : { type: "wall", kind: w.kind, c: w.c, r: w.r };
    if (top && state.plies < topWallMinPlies) return;
    if (wallPlaced(state, a.kind, a.c, a.r)) return;
    if (netWalls) {
      const g = wallGain(a);
      if (!g) return;
      const diff = g.gainOpp - g.gainMe;
      if (top ? diff < 0 : diff <= 0) return;
    }
    add(a);
  };

  for (const w of shortestPathWalls(state, op.c, op.r)) addWall(w, w.kind === "t" || w.kind === "top");

  if (opts.scanAll) {
    const scored = [];
    for (const w of allWallSlots()) {
      if (wallPlaced(state, w.kind, w.c, w.r)) continue;
      if ((w.kind === "top" || w.kind === "t") && state.plies < topWallMinPlies) continue;
      const probe = cloneState(state);
      setWall(probe, w.kind, w.c, w.r);
      if (!hasPath(probe, mp.c, mp.r)) continue;
      const dm = netWalls ? distanceToGoal(probe, mp.c, mp.r) : 0;
      const dop = distanceToGoal(probe, op.c, op.r);
      if (!Number.isFinite(dop)) continue;
      const gainOpp = dop - dop0;
      const score = netWalls ? gainOpp - (dm - dm0) : gainOpp;
      if (netWalls) {
        if (w.kind === "t" || w.kind === "top" ? score < 0 : score <= 0) continue;
      } else if (gainOpp < 1) continue;
      scored.push([score, { type: "wall", kind: w.kind, c: w.c, r: w.r }]);
    }
    scored.sort((x, y) => y[0] - x[0]);
    for (let i = 0; i < Math.min(opts.scanAll, scored.length); i++) add(scored[i][1]);
  }
  if ((opts.topWalls || marginFor(state, me) <= 0) && state.plies >= topWallMinPlies) {
    const topKind = opts.topWallKind === "top" ? "top" : "t";
    for (let c = 0; c < COLS; c++) {
      if (state.topWall[c] !== 0) continue;
      const w = { type: "wall", kind: topKind, c, r: 0 };
      if (topKind === "top") addWall(w, true);
      else add(w);
    }
  }
  if (opts.planWall) addWall(opts.planWall);
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

  const cands = candidatesAI(state, ctx.candOpts ?? {});
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
function rootSearch(state, rng, timeMs, maxDepth, opts = {}) {
  const win = takeWin(state);
  if (win) return win;

  const me = state.turn;
  const cands = candidatesAI(state, { scanAll: 6, ...(opts.candOpts ?? {}) });
  const ordered = [];
  const startWallBias = Number(opts.startWallBias ?? 0);
  const startWallPlies = Number(opts.startWallPlies ?? 0);
  for (const a of cands) {
    const r = applyAction(state, a);
    if (!r.ok) continue;
    let s = orderScore(r.state);
    if (a.type === "move") s += 0.01;
    if (startWallBias && state.plies < startWallPlies && a.type === "wall") {
      if (a.kind === "h" && a.r >= ROWS - 3) s += startWallBias;
      else if (a.kind === "h" && a.r >= ROWS - 6) s += startWallBias * 0.4;
      else if (a.kind === "top") s -= startWallBias;
      else if (a.kind === "h" && a.r <= 2) s -= startWallBias * 0.6;
    }
    ordered.push({ a, st: r.state, score: s });
  }
  if (!ordered.length) return autoMove(state);
  ordered.sort((x, y) => y.score - x.score);

  const ctx = {
    deadline: aiNow() + Math.max(20, timeMs),
    nodes: 0,
    abort: false,
    candOpts: opts.candOpts ?? {},
  };
  const repeatSet = opts.repeatSet;
  const repeatPenalty = Number(opts.repeatPenalty ?? 0);
  let best = ordered[0].a;
  let bestScore = -Infinity;

  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -Infinity;
    let localBest = null;
    let localScore = -Infinity;
    for (const item of ordered) {
      let v = -searchAI(item.st, depth - 1, -Infinity, -alpha, ctx);
      if (ctx.abort) break;
      // 两格来回：最近回到过的格子（墙数没变）降权。
      if (repeatSet && repeatPenalty > 0 && item.a.type === "move") {
        const np = item.st.players[me];
        const key = `${np.r * COLS + np.c}:${item.st.wallsPlaced}`;
        if (repeatSet.has(key)) v -= repeatPenalty;
      }
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

/** 模拟“我按计划封墙、对手每步走最优应手”的完整过程（大师旧行为）。 */
function simulatePlanLegacy(state, walls, me) {
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

/** BFS：从 (c0,r0) 出发、绕开 avoid 格，是否还能到终点。 */
function hasPathAvoiding(state, c0, r0, ac, ar) {
  const { vWall, hWall, topWall } = state;
  const seen = new Uint8Array(AI2_SIZE);
  const q = [];
  const startK = ai2Key(c0, r0);
  seen[startK] = 1;
  q.push(c0, r0);
  for (let head = 0; head < q.length; head += 2) {
    const c = q[head];
    const r = q[head + 1];
    if (r === 0 && topWall[c] === 0) return true;
    const tryCell = (nc, nr) => {
      if (nc === ac && nr === ar) return;
      const k = ai2Key(nc, nr);
      if (seen[k]) return;
      seen[k] = 1;
      q.push(nc, nr);
    };
    if (r > 0 && hWall[c * H_COUNT + (r - 1)] === 0) tryCell(c, r - 1);
    if (r < ROWS - 1 && hWall[c * H_COUNT + r] === 0) tryCell(c, r + 1);
    if (c > 0 && vWall[(c - 1) * ROWS + r] === 0) tryCell(c - 1, r);
    if (c < COLS - 1 && vWall[c * ROWS + r] === 0) tryCell(c + 1, r);
  }
  return false;
}

/** 对手是否站在我“未来必经之路”上。 */
function opponentOnNecessaryPath(state, me) {
  const p = state.players[me];
  const op = state.players[1 - me];
  if (!hasPath(state, p.c, p.r)) return false;
  return !hasPathAvoiding(state, p.c, p.r, op.c, op.r);
}

/** 自己走一步：合法走子里离终点最近的。 */
function bestProgressMove(state, me) {
  const p = state.players[me];
  let best = null;
  let bestD = Infinity;
  for (const dir of legalDirs(state, p.c, p.r)) {
    const a = { type: "move", dir };
    const r = applyAction(state, a);
    if (!r.ok) continue;
    if (r.state.winner !== null) return a;
    const d = distanceOf(r.state, me);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/** 宗师计划一步：会走；软/硬必经路保护；自堵检查。 */
function planStepFor(state, walls, me, opts = {}) {
  const move = bestProgressMove(state, me);
  const w = nextPlanWallFor(state, walls, me);
  const guard = opts.necessaryPathGuard;
  if (w && guard && opponentOnNecessaryPath(state, me)) {
    if (guard === "hard" || (guard === "soft" && planWallNetBad(state, me, w))) {
      return move;
    }
  }
  if (!w) return move;
  const res = applyAction(state, w);
  if (!res.ok) return move;
  const dm0 = distanceOf(state, me);
  const dop0 = distanceOf(state, 1 - me);
  const dm = distanceOf(res.state, me);
  const dop = distanceOf(res.state, 1 - me);
  if (!Number.isFinite(dm) || !Number.isFinite(dop)) return move;
  const gainMe = dm - dm0;
  const gainOpp = dop - dop0;
  if (gainMe > 0 && gainOpp <= gainMe) return move;
  if (dm0 <= 3) return move;
  return w;
}

/** 宗师计划：放墙/自己走交替模拟。 */
function simulatePlanMoves(state, walls, me, opts = {}) {
  let s = state;
  let placed = 0;
  for (let i = 0; i < walls.length * 2 + 6; i++) {
    if (s.winner !== null) break;
    if (s.turn !== me) {
      const a = bestOpponentAction(s, 1 - me);
      if (!a) return null;
      const r = applyAction(s, a);
      if (!r.ok) return null;
      s = r.state;
      continue;
    }
    const step = planStepFor(s, walls, me, opts);
    if (!step) return null;
    const r = applyAction(s, step);
    if (!r.ok) return null;
    if (step.type === "wall") placed++;
    s = r.state;
  }
  if (!placed) return null;
  return s;
}

function simulatePlan(state, walls, me, opts = {}) {
  return opts.planMoves ? simulatePlanMoves(state, walls, me, opts) : simulatePlanLegacy(state, walls, me);
}

/** 生成并评估锁路计划：横排留一个缺口，缺口在离对手最远一侧。 */
function makePlanAI(state, opts = {}) {
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
  const rows = [];
  if (opts.startPlan && my.r >= 8) rows.push(10, 9);
  rows.push(my.r, my.r - 1);
  const uniqRows = [...new Set(rows)];
  for (const row of uniqRows) {
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
      const sims = [];
      const primary = simulatePlan(state, walls, me, opts);
      if (primary) sims.push(primary);
      // 宗师：如果“会走”的模拟没有计划，回退到大师的旧模拟，保证不丢锁路机会。
      if (opts.planFallback) {
        const legacy = simulatePlanLegacy(state, walls, me);
        if (legacy && legacy !== primary) sims.push(legacy);
      }
      if (!sims.length) continue;
      for (const sim of sims) {
        if (sim.winner === opp) continue;
        const sdm = distanceOf(sim, me);
        const sdo = distanceOf(sim, opp);
        if (!Number.isFinite(sdm) || !Number.isFinite(sdo)) continue;
        if (countOpenExits(sim) === 0) continue;
        const m = sim.winner === "draw" ? 0 : sdo - sdm;
        const netOk = !opts.planWallNet || (sdm - dm <= sdo - dop);
        if (m >= 2 && netOk && (!best || m > best.margin)) {
          best = { row, gap, walls, margin: m, dMe: dm, dOpp: dop, ply: state.plies };
        }
      }
    }
  }
  return best;
}

/** 计划墙是否“损己不划算”：自己变长，且对手没有变得比自己更惨。 */
function planWallNetBad(state, me, w) {
  const opp = 1 - me;
  const res = applyAction(state, w);
  if (!res.ok) return true;
  const dm0 = distanceOf(state, me);
  const dop0 = distanceOf(state, opp);
  const dm = distanceOf(res.state, me);
  const dop = distanceOf(res.state, opp);
  if (!Number.isFinite(dm) || !Number.isFinite(dop)) return true;
  const gainMe = dm - dm0;
  const gainOpp = dop - dop0;
  return gainMe > 0 && gainOpp <= gainMe;
}

/** 构建一个带计划层的 AI。 */
function createMasterAI({
  timeMs = 1200,
  maxDepth = 6,
  usePlan = true,
  netWalls = false,
  avoidRepeat = false,
  repeatPenalty = 120,
  planMoves = false,
  planWallNet = false,
  planFallback = false,
  necessaryPathGuard = false,
  startWallBias = 0,
  startWallPlies = 0,
  topWallMinPlies = 0,
  topWallKind = "t",
  startPlan = false,
  endgameDepth = 0,
} = {}) {
  let plan = null;
  let plansUsed = 0;
  let history = [];
  const stats = { plans: 0, planWalls: 0, searches: 0, maxPlies: 0 };
  if (planMoves) stats.planMoves = 0;
  if (necessaryPathGuard) stats.necessaryMoves = 0;

  function choose(state, rng) {
    const win = takeWin(state);
    if (win) return win;

    const me = state.turn;
    const opp = 1 - me;
    const mePos = state.players[me];

    if (avoidRepeat) {
      history.push(`${mePos.r * COLS + mePos.c}:${state.wallsPlaced}`);
      if (history.length > 12) history.shift();
    }
    const repeatSet = avoidRepeat ? new Set(history.slice(0, -1)) : undefined;

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
      } else if (planMoves) {
        // 宗师：计划生成时已算过，执行期只走一步，避免重复整段模拟。
        const step = planStepFor(state, plan.walls, me, { necessaryPathGuard });
        if (step) {
          if (step.type === "wall" && netWalls && planWallNetBad(state, me, step)) {
            plan = null;
          } else {
            if (step.type === "wall") stats.planWalls++;
            else stats.planMoves++;
            return step;
          }
        }
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
            if (w && !(netWalls && planWallNetBad(state, me, w))) {
              stats.planWalls++;
              return w;
            }
            plan = null;
          }
        }
        plan = null;
      }
    }

    if (usePlan && plansUsed < 2) {
      const p = makePlanAI(state, { planMoves, planWallNet, planFallback, necessaryPathGuard, startPlan });
      if (p) {
        plan = p;
        plansUsed++;
        stats.plans++;
        const step = planMoves
          ? planStepFor(state, p.walls, me, { necessaryPathGuard })
          : nextPlanWallFor(state, p.walls, me);
        if (step && !(step.type === "wall" && netWalls && planWallNetBad(state, me, step))) {
          if (step.type === "wall") stats.planWalls++;
          else stats.planMoves++;
          return step;
        }
        plan = null;
      }
    }

    stats.searches++;
    const dm = distanceOf(state, me);
    const dop = distanceOf(state, opp);
    const endgame = endgameDepth > 0 &&
      countOpenExits(state) <= 4 &&
      Number.isFinite(dm) && Number.isFinite(dop) &&
      Math.max(dm, dop) <= 5;
    const depth = endgame ? Math.max(maxDepth, endgameDepth) : maxDepth;
    const action = rootSearch(state, rng, timeMs, depth, {
      candOpts: { netWalls, topWallMinPlies, topWallKind },
      startWallBias,
      startWallPlies,
      repeatSet,
      repeatPenalty: avoidRepeat ? repeatPenalty : 0,
    });
    if (necessaryPathGuard && action.type === "wall" && opponentOnNecessaryPath(state, me)) {
      const should = necessaryPathGuard === "hard" || planWallNetBad(state, me, action);
      if (should) {
        const mv = bestProgressMove(state, me);
        if (mv) {
          stats.necessaryMoves++;
          return mv;
        }
      }
    }
    return action;
  }

  choose.stats = stats;
  choose.planBudget = () => plansUsed;
  choose.reset = () => {
    plan = null;
    plansUsed = 0;
    history = [];
    stats.plans = 0;
    stats.planWalls = 0;
    stats.searches = 0;
    stats.maxPlies = 0;
    if (planMoves) stats.planMoves = 0;
    if (necessaryPathGuard) stats.necessaryMoves = 0;
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

export { createMasterAI, candidatesAI as _candidatesAI, rootSearch as _rootSearch, planWallNetBad as _planWallNetBad, planStepFor as _planStepFor, opponentOnNecessaryPath as _opponentOnNecessaryPath };
