/**
 * 规则内核：状态、行动、合法性、判定。
 *
 * 纯函数式：applyAction 不修改传入状态，返回新状态；非法行动返回 { ok:false, error }。
 */

import {
  COLS, ROWS, V_COUNT, H_COUNT, TOP_COUNT,
  vIndex, hIndex, topIndex,
} from "./board.js";
import { distanceToGoal, hasPath } from "./path.js";

export const DIRS = ["up", "down", "left", "right"];

export function createState(firstPlayer = 0, { tolerance = 1, wallLimit = Infinity } = {}) {
  return {
    vWall: new Uint8Array(V_COUNT * ROWS),
    hWall: new Uint8Array(H_COUNT * COLS),
    topWall: new Uint8Array(TOP_COUNT),
    players: [
      { c: 0, r: ROWS - 1 },
      { c: COLS - 1, r: ROWS - 1 },
    ],
    turn: firstPlayer,
    tolerance,
    wallLimit: Array.isArray(wallLimit) ? [wallLimit[0], wallLimit[1]] : [wallLimit, wallLimit],
    wallsUsed: [0, 0],
    plies: 0,
    wallsPlaced: 0,
    winner: null, // null | 0 | 1 | "draw"
  };
}

export function cloneState(s) {
  return {
    vWall: s.vWall.slice(),
    hWall: s.hWall.slice(),
    topWall: s.topWall.slice(),
    players: s.players.map((p) => ({ c: p.c, r: p.r })),
    turn: s.turn,
    tolerance: s.tolerance,
    wallLimit: s.wallLimit.slice(),
    wallsUsed: s.wallsUsed.slice(),
    plies: s.plies,
    wallsPlaced: s.wallsPlaced,
    winner: s.winner,
  };
}

export function wallPlaced(s, kind, c, r) {
  if (kind === "v") return s.vWall[vIndex(c, r)] === 1;
  if (kind === "h") return s.hWall[hIndex(c, r)] === 1;
  if (kind === "top") return s.topWall[topIndex(c)] === 1;
  throw new Error(`unknown wall kind: ${kind}`);
}

function setWall(s, kind, c, r) {
  if (kind === "v") s.vWall[vIndex(c, r)] = 1;
  else if (kind === "h") s.hWall[hIndex(c, r)] = 1;
  else if (kind === "top") s.topWall[topIndex(c)] = 1;
  else throw new Error(`unknown wall kind: ${kind}`);
}

/** 墙位是否在合法范围内。 */
export function wallInBounds(kind, c, r) {
  if (kind === "v") return c >= 0 && c < V_COUNT && r >= 0 && r < ROWS;
  if (kind === "h") return c >= 0 && c < COLS && r >= 0 && r < H_COUNT;
  if (kind === "top") return c >= 0 && c < TOP_COUNT && r === 0;
  return false;
}

/**
 * 从 (c,r) 沿 dir 走一步的结果。
 * 返回 { c, r } | { exit:true } | null（不可走）。
 */
export function stepTarget(state, c, r, dir) {
  const { vWall, hWall, topWall } = state;
  if (dir === "up") {
    if (r === 0) return topWall[c] === 0 ? { exit: true } : null;
    return hWall[c * H_COUNT + (r - 1)] === 0 ? { c, r: r - 1 } : null;
  }
  if (dir === "down") {
    if (r === ROWS - 1) return null;
    return hWall[c * H_COUNT + r] === 0 ? { c, r: r + 1 } : null;
  }
  if (dir === "left") {
    if (c === 0) return null;
    return vWall[(c - 1) * ROWS + r] === 0 ? { c: c - 1, r } : null;
  }
  if (dir === "right") {
    if (c === COLS - 1) return null;
    return vWall[c * ROWS + r] === 0 ? { c: c + 1, r } : null;
  }
  return null;
}

export function legalDirs(state, c, r) {
  return DIRS.filter((d) => stepTarget(state, c, r, d) !== null);
}

/**
 * 行动是否合法。不修改状态。
 * 返回 { ok:true } 或 { ok:false, error }。
 */
export function validateAction(state, action) {
  if (state.winner !== null) return { ok: false, error: "game-over" };

  if (action.type === "move") {
    const p = state.players[state.turn];
    if (!DIRS.includes(action.dir)) return { ok: false, error: "bad-action" };
    const t = stepTarget(state, p.c, p.r, action.dir);
    if (!t) return { ok: false, error: "blocked" };
    return { ok: true };
  }

  if (action.type === "wall") {
    const { kind, c, r } = action;
    if (state.wallsUsed[state.turn] >= state.wallLimit[state.turn]) {
      return { ok: false, error: "no-walls" };
    }
    if (!wallInBounds(kind, c, r)) return { ok: false, error: "out-of-bounds" };
    if (wallPlaced(state, kind, c, r)) return { ok: false, error: "occupied" };

    const probe = cloneState(state);
    setWall(probe, kind, c, r);
    for (const pl of probe.players) {
      if (!hasPath(probe, pl.c, pl.r)) return { ok: false, error: "blocks-path" };
    }
    return { ok: true };
  }

  return { ok: false, error: "bad-action" };
}

/**
 * 执行行动，返回新状态。
 * 事件类型：move / exit / wall；若一方越线，winner 已确定（0 | 1 | "draw"）。
 */
export function applyAction(state, action) {
  const check = validateAction(state, action);
  if (!check.ok) return { ok: false, error: check.error };

  const next = cloneState(state);
  const p = state.turn;
  let event;

  if (action.type === "move") {
    const me = next.players[p];
    const t = stepTarget(state, me.c, me.r, action.dir);
    if (t.exit) {
      const opp = next.players[1 - p];
      const oppDist = distanceToGoal(next, opp.c, opp.r);
      const draw = oppDist <= next.tolerance;
      next.winner = draw ? "draw" : p;
      event = { type: "exit", player: p, draw, oppDist };
    } else {
      me.c = t.c;
      me.r = t.r;
      event = { type: "move", player: p, c: t.c, r: t.r };
    }
  } else {
    setWall(next, action.kind, action.c, action.r);
    next.wallsUsed[p] += 1;
    next.wallsPlaced += 1;
    event = { type: "wall", player: p, kind: action.kind, c: action.c, r: action.r };
  }

  next.turn = 1 - p;
  next.plies += 1;
  return { ok: true, state: next, event };
}

/** 枚举全部合法行动（主要用于随机 AI 与测试）。 */
export function legalActions(state) {
  if (state.winner !== null) return [];
  const out = [];
  const p = state.players[state.turn];
  for (const dir of legalDirs(state, p.c, p.r)) {
    out.push({ type: "move", dir });
  }
  if (state.wallsUsed[state.turn] >= state.wallLimit[state.turn]) {
    return out;
  }
  for (let c = 0; c < V_COUNT; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (!wallPlaced(state, "v", c, r)) out.push({ type: "wall", kind: "v", c, r });
    }
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < H_COUNT; r++) {
      if (!wallPlaced(state, "h", c, r)) out.push({ type: "wall", kind: "h", c, r });
    }
  }
  for (let c = 0; c < TOP_COUNT; c++) {
    if (!wallPlaced(state, "top", c, 0)) out.push({ type: "wall", kind: "top", c, r: 0 });
  }
  return out;
}

export function distanceOf(state, player) {
  const p = state.players[player];
  return distanceToGoal(state, p.c, p.r);
}

/**
 * 超时代走：BFS 最短路，同长度时优先向上。
 * 依赖 DIRS 的顺序（up 在最前），只在严格更短时替换，从而保证同长优先“上”。
 */
export function autoMove(state) {
  const p = state.players[state.turn];
  let best = null;
  let bestDist = Infinity;
  for (const dir of DIRS) {
    const t = stepTarget(state, p.c, p.r, dir);
    if (!t) continue;
    if (t.exit) return { type: "move", dir };
    const d = distanceToGoal(state, t.c, t.r);
    if (d < bestDist) {
      bestDist = d;
      best = { type: "move", dir };
    }
  }
  return best;
}
