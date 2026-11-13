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

export const AI = {
  random: randomAI,
  greedy: greedyAI,
  "greedy-move": (state, rng) => greedyCore(state, rng, 0.6),
  easy: easyAI,
  normal: greedyAI,
  hard: hardAI,
};
