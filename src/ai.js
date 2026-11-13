/**
 * 对弈 AI：随机与贪心两档，用于自对弈平衡测试。
 * 后续人机对战的三档 AI 会在此文件继续扩展。
 */

import { applyAction, legalActions, legalDirs, distanceOf, stepTarget, validateAction } from "./rules.js";
import { shortestPathWalls } from "./path.js";

/** 可复现的伪随机数（mulberry32）。 */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomAI(state, rng) {
  const actions = legalActions(state);
  // 随机墙可能封死通路，需要按规则校验；连续命中非法时退化为走子。
  for (let i = 0; i < 200; i++) {
    const a = actions[Math.floor(rng() * actions.length)];
    if (a.type === "move") return a;
    if (validateAction(state, a).ok) return a;
  }
  const p = state.players[state.turn];
  const dirs = legalDirs(state, p.c, p.r);
  return { type: "move", dir: dirs[Math.floor(rng() * dirs.length)] };
}

/** 合法候选：全部走子 + 对手最短路上的墙 + 少量随机墙。 */
function candidateActions(state, rng, extraWalls = 6) {
  const actions = [];
  const mp = state.players[state.turn];
  for (const dir of legalDirs(state, mp.c, mp.r)) {
    actions.push({ type: "move", dir });
  }

  const op = state.players[1 - state.turn];
  const seen = new Set();
  for (const w of shortestPathWalls(state, op.c, op.r)) {
    const k = `${w.kind}:${w.c}:${w.r}`;
    if (seen.has(k)) continue;
    seen.add(k);
    actions.push({ type: "wall", kind: w.kind, c: w.c, r: w.r });
  }

  const legal = legalActions(state).filter((a) => a.type === "wall");
  for (let i = 0; i < extraWalls && legal.length > 0; i++) {
    const w = legal[Math.floor(rng() * legal.length)];
    const k = `${w.kind}:${w.c}:${w.r}`;
    if (seen.has(k)) continue;
    seen.add(k);
    actions.push(w);
  }
  return actions;
}

function staticScore(state, p) {
  return distanceOf(state, 1 - p) - distanceOf(state, p);
}

/**
 * 贪心 AI：
 *   1. 若能直接越线，且结果不是平局，立刻越线；
 *   2. 否则枚举「移动 + 对手最短路上的堵墙 + 少量随机墙」，
 *      以 d(对手) − d(自己) 打分，取最高；
 *   3. 同分时随机。
 */
export function greedyAI(state, rng) {
  return greedyCore(state, rng, 0);
}

/**
 * moveBias > 0 时，在「移动」与「收益相同的墙」之间优先移动。
 * 用来模拟“只在墙能多拖对手一步以上时才封墙”的熟练打法。
 */
function greedyCore(state, rng, moveBias) {
  const me = state.turn;
  const opp = 1 - me;
  const actions = candidateActions(state, rng);

  let best = null;
  let bestScore = -Infinity;
  for (const a of actions) {
    const res = applyAction(state, a);
    if (!res.ok) continue;

    let score;
    if (res.state.winner === me) score = 1e9;
    else if (res.state.winner === "draw") score = 1e8;
    else if (res.state.winner === opp) score = -1e9;
    else score = distanceOf(res.state, opp) - distanceOf(res.state, me);

    score += rng() * 0.01; // 同分随机
    if (a.type === "move") score += moveBias;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }

  return best ?? randomAI(state, rng);
}

/** 简单：偶尔随手一步，其余按贪心走。 */
export function easyAI(state, rng) {
  return rng() < 0.25 ? randomAI(state, rng) : greedyAI(state, rng);
}

/** 对手一步内的最佳静态收益（用于困难档的一层预判）。 */
function bestReplyScore(state, rng) {
  const p = state.turn;
  let best = -Infinity;
  for (const a of candidateActions(state, rng, 3)) {
    const res = applyAction(state, a);
    if (!res.ok) continue;
    if (res.state.winner === p) return 1e9;
    if (res.state.winner === "draw") {
      best = Math.max(best, 5e8);
      continue;
    }
    const s = staticScore(res.state, p);
    if (s > best) best = s;
  }
  return best === -Infinity ? -1e9 : best;
}

/**
 * 困难：在贪心候选上多看对手一步，取“对手最佳应手之后仍然不亏”的一手。
 */
export function hardAI(state, rng) {
  const me = state.turn;
  const actions = candidateActions(state, rng);
  let best = null;
  let bestScore = -Infinity;

  for (const a of actions) {
    const res = applyAction(state, a);
    if (!res.ok) continue;
    if (res.state.winner === me) return a;

    let score;
    if (res.state.winner === "draw") score = 1e8;
    else score = -bestReplyScore(res.state, rng);

    score += rng() * 0.01;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best ?? greedyAI(state, rng);
}

/** 直接越线（若可），否则返回 null。 */
export function takeWin(state) {
  const p = state.players[state.turn];
  if (p.r !== 0) return null;
  const t = stepTarget(state, p.c, p.r, "up");
  if (!t || !t.exit) return null;
  return { type: "move", dir: "up" };
}


/* ---------------------------------------------------------------- 强 AI */

/**
 * 局面评估（站在 p 的角度，越大越好）。
 *
 * 关键点：必须知道“平局规则”——领先 1 手等于和棋，领先 2 手才算赢。
 * 旧版 AI 只比距离差，所以经常一头撞进平局。
 */
export function evaluate(state, p) {
  const opp = 1 - p;
  const dm = distanceOf(state, p);
  const dopp = distanceOf(state, opp);
  if (!Number.isFinite(dm)) return -1e6;
  if (!Number.isFinite(dopp)) return 1e6;

  const margin = dopp - dm; // 我领先几手
  let score = margin * 100;

  // 平局容差：margin 1 → 到达即和棋；margin 0 → 我先到不了
  if (margin === 1) score -= 130;
  else if (margin === 0) score -= 220;

  // 出口控制：上端还剩多少可出的列（靠近我的越多越好）
  const myExits = openExits(state, p);
  const oppExits = openExits(state, opp);
  score += 7 * (myExits - oppExits);

  // 残局：离终点越近，出口价值越高
  if (dm <= 4) score += 12 * (myExits - oppExits);

  return score;
}

/** 从 p 的当前位置出发、上端仍开放的列数（越多越安全）。 */
function openExits(state, p) {
  let n = 0;
  for (let c = 0; c < 10; c++) if (state.topWall[c] === 0) n++;
  return n;
}

/** 走子与封墙的候选集：全部走子 + 对手最短路上的封堵 + 少量随机墙。 */
function searchCandidates(state, rng, wallLimit = 14) {
  const me = state.turn;
  const out = [];
  const mp = state.players[me];
  for (const dir of legalDirs(state, mp.c, mp.r)) out.push({ type: "move", dir });

  const op = state.players[1 - me];
  const seen = new Set();
  for (const w of shortestPathWalls(state, op.c, op.r)) {
    const k = `${w.kind}:${w.c}:${w.r}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ type: "wall", kind: w.kind, c: w.c, r: w.r });
    if (out.length >= 4 + wallLimit) break;
  }

  const legal = legalActions(state).filter((a) => a.type === "wall");
  for (let i = 0; i < 4 && legal.length; i++) {
    const w = legal[Math.floor(rng() * legal.length)];
    const k = `${w.kind}:${w.c}:${w.r}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

/** negamax + alpha-beta；返回从 perspective 看的分值。 */
function negamax(state, depth, alpha, beta, perspective, rng) {
  if (state.winner !== null) {
    if (state.winner === "draw") return 0;
    return state.winner === perspective ? 1e6 - (10 - depth) : -1e6 + (10 - depth);
  }
  if (depth <= 0) return evaluate(state, perspective);

  const acts = searchCandidates(state, rng);
  // 排序：先走子，再封墙（提高剪枝效率）
  acts.sort((a, b) => (a.type === "move" ? -1 : 0) - (b.type === "move" ? -1 : 0));

  let best = -Infinity;
  for (const a of acts) {
    const res = applyAction(state, a);
    if (!res.ok) continue;
    const v = -negamax(res.state, depth - 1, -beta, -alpha, 1 - perspective, rng);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best === -Infinity ? evaluate(state, perspective) : best;
}

/**
 * 搜索型 AI。
 * depth 越大越强、越慢；预算用节点数粗略控制。
 */
export function makeSearchAI({ depth = 3, wallLimit = 14 } = {}) {
  return function searchAI(state, rng) {
    const me = state.turn;
    const acts = searchCandidates(state, rng, wallLimit);

    let best = null;
    let bestScore = -Infinity;

    for (const a of acts) {
      const res = applyAction(state, a);
      if (!res.ok) continue;
      // 根节点每个候选都用完整窗口，避免“剪枝上界”被当成真实分值
      const v = -negamax(res.state, depth - 1, -Infinity, Infinity, 1 - me, rng);
      const score = v + rng() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best ?? randomAI(state, rng);
  };
}

/** 普通：贪心 + 平局规则感知（比旧的“看一步”更强）。 */
export function tacticalAI(state, rng) {
  const me = state.turn;
  const acts = searchCandidates(state, rng, 12);

  let best = null;
  let bestScore = -Infinity;
  for (const a of acts) {
    const res = applyAction(state, a);
    if (!res.ok) continue;
    if (res.state.winner === me) return a;

    let score;
    if (res.state.winner === "draw") score = 0;
    else if (res.state.winner === 1 - me) score = -1e6;
    else score = evaluate(res.state, me);

    score += rng() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best ?? randomAI(state, rng);
}

export const AI = {
  random: randomAI,
  greedy: greedyAI,
  "greedy-move": (state, rng) => greedyCore(state, rng, 0.6),
  easy: easyAI,
  normal: tacticalAI,
  hard: makeSearchAI({ depth: 4 }),
};
