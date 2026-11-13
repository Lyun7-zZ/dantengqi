/**
 * 同时行动规则。
 *
 * 每回合每人只做一件事，并可公开存至多 1 个行动点。
 * 双方先选定，再一起结算：先放墙，再走棋，最后看越线。
 * 自己的墙不挡自己。撞上对方本回合新放的墙就停在墙前，已付的点数不退。
 */

import {
  COLS, ROWS, V_COUNT, H_COUNT, TOP_COUNT,
  vIndex, hIndex, topIndex,
} from "./board.js";
import { blocksMover, distanceToGoal, hasPath } from "./path.js";

export const DIRS = ["up", "down", "left", "right"];

export function createState(_firstPlayer = 0, { wallLimit = Infinity } = {}) {
  return {
    vWall: new Uint8Array(V_COUNT * ROWS),
    hWall: new Uint8Array(H_COUNT * COLS),
    topWall: new Uint8Array(TOP_COUNT),
    players: [
      { c: 0, r: ROWS - 1 },
      { c: COLS - 1, r: ROWS - 1 },
    ],
    bank: [0, 0],
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
    bank: s.bank.slice(),
    wallLimit: s.wallLimit.slice(),
    wallsUsed: s.wallsUsed.slice(),
    plies: s.plies,
    wallsPlaced: s.wallsPlaced,
    winner: s.winner,
  };
}

function wallValue(s, kind, c, r) {
  if (kind === "v") return s.vWall[vIndex(c, r)];
  if (kind === "h") return s.hWall[hIndex(c, r)];
  if (kind === "top") return s.topWall[topIndex(c)];
  throw new Error(`unknown wall kind: ${kind}`);
}

export function wallPlaced(s, kind, c, r) {
  return wallValue(s, kind, c, r) !== 0;
}

export function wallOwner(s, kind, c, r) {
  const v = wallValue(s, kind, c, r);
  return v === 0 ? null : v - 1;
}

export function setWall(s, kind, c, r, owner = 0) {
  const v = owner + 1;
  if (kind === "v") s.vWall[vIndex(c, r)] = v;
  else if (kind === "h") s.hWall[hIndex(c, r)] = v;
  else if (kind === "top") s.topWall[topIndex(c)] = v;
  else throw new Error(`unknown wall kind: ${kind}`);
}

export function wallInBounds(kind, c, r) {
  if (kind === "v") return c >= 0 && c < V_COUNT && r >= 0 && r < ROWS;
  if (kind === "h") return c >= 0 && c < COLS && r >= 0 && r < H_COUNT;
  if (kind === "top") return c >= 0 && c < TOP_COUNT && r === 0;
  return false;
}

/**
 * 从 (c,r) 沿 dir 走一步。mover 只能被对方的墙挡住。
 * 返回 { c, r } | { exit:true } | null。
 */
export function stepTarget(state, c, r, dir, mover = 0) {
  const { vWall, hWall, topWall } = state;
  if (dir === "up") {
    if (r === 0) return blocksMover(topWall[c], mover) ? null : { exit: true };
    return blocksMover(hWall[c * H_COUNT + (r - 1)], mover) ? null : { c, r: r - 1 };
  }
  if (dir === "down") {
    if (r === ROWS - 1) return null;
    return blocksMover(hWall[c * H_COUNT + r], mover) ? null : { c, r: r + 1 };
  }
  if (dir === "left") {
    if (c === 0) return null;
    return blocksMover(vWall[(c - 1) * ROWS + r], mover) ? null : { c: c - 1, r };
  }
  if (dir === "right") {
    if (c === COLS - 1) return null;
    return blocksMover(vWall[c * ROWS + r], mover) ? null : { c: c + 1, r };
  }
  return null;
}

export function legalDirs(state, c, r, mover = 0) {
  return DIRS.filter((d) => {
    const t = stepTarget(state, c, r, d, mover);
    return t && !t.exit;
  });
}

/** 按当前棋盘走完 dirs。中途越线或被挡则失败。 */
export function traceMove(state, player, dirs) {
  let c = state.players[player].c;
  let r = state.players[player].r;
  const cells = [];
  for (const dir of dirs) {
    if (!DIRS.includes(dir)) return { ok: false, error: "bad-action" };
    const t = stepTarget(state, c, r, dir, player);
    if (!t) return { ok: false, error: "blocked" };
    if (t.exit) return { ok: false, error: "exit-not-step" };
    c = t.c;
    r = t.r;
    cells.push({ c, r, dir });
  }
  return { ok: true, c, r, cells };
}

function canExit(state, player) {
  const me = state.players[player];
  if (me.r !== 0) return false;
  return !blocksMover(state.topWall[me.c], player);
}

function wallSeals(state, walls) {
  const probe = cloneState(state);
  for (const w of walls) setWall(probe, w.kind, w.c, w.r, w.owner);
  for (let p = 0; p < 2; p++) {
    const pl = probe.players[p];
    if (!hasPath(probe, pl.c, pl.r, p)) return true;
  }
  return false;
}

export function validateAction(state, player, action) {
  if (state.winner !== null) return { ok: false, error: "game-over" };
  if (player !== 0 && player !== 1) return { ok: false, error: "bad-player" };
  if (!action || typeof action !== "object") return { ok: false, error: "bad-action" };

  if (action.type === "store") {
    if (state.bank[player] !== 0) return { ok: false, error: "bank-full" };
    return { ok: true };
  }

  if (action.type === "exit") {
    if (!canExit(state, player)) return { ok: false, error: "cannot-exit" };
    return { ok: true };
  }

  if (action.type === "move") {
    const dirs = action.dirs;
    if (!Array.isArray(dirs) || dirs.length < 1 || dirs.length > 2) {
      return { ok: false, error: "bad-action" };
    }
    if (dirs.length === 2 && state.bank[player] < 1) return { ok: false, error: "no-bank" };
    return traceMove(state, player, dirs);
  }

  if (action.type === "wall") {
    const { kind, c, r } = action;
    if (state.wallsUsed[player] >= state.wallLimit[player]) return { ok: false, error: "no-walls" };
    if (!wallInBounds(kind, c, r)) return { ok: false, error: "out-of-bounds" };
    if (wallPlaced(state, kind, c, r)) return { ok: false, error: "occupied" };
    if (wallSeals(state, [{ kind, c, r, owner: player }])) return { ok: false, error: "blocks-path" };
    return { ok: true };
  }

  return { ok: false, error: "bad-action" };
}

function sameSlot(a, b) {
  return a.kind === b.kind && a.c === b.c && a.r === b.r;
}

/**
 * 结算一回合。actions 为 [玩家0, 玩家1]。
 * 非法行动整回合拒绝，不消耗步数。
 */
export function resolveRound(state, actions) {
  if (state.winner !== null) return { ok: false, error: "game-over" };
  if (!Array.isArray(actions) || actions.length !== 2) return { ok: false, error: "bad-action" };
  for (let p = 0; p < 2; p++) {
    const check = validateAction(state, p, actions[p]);
    if (!check.ok) return { ok: false, error: check.error, player: p };
  }

  const next = cloneState(state);
  const events = [];
  const wallActs = [0, 1]
    .filter((p) => actions[p].type === "wall")
    .map((p) => ({ player: p, ...actions[p], owner: p }));

  let place = wallActs.slice();
  if (place.length === 2 && sameSlot(place[0], place[1])) {
    events.push({ type: "wall", player: 0, placed: false, reason: "conflict" });
    events.push({ type: "wall", player: 1, placed: false, reason: "conflict" });
    place = [];
  } else if (place.length === 2 && wallSeals(state, place)) {
    events.push({ type: "wall", player: place[0].player, placed: false, reason: "together" });
    events.push({ type: "wall", player: place[1].player, placed: false, reason: "together" });
    place = [];
  }

  for (const w of place) {
    setWall(next, w.kind, w.c, w.r, w.owner);
    next.wallsUsed[w.player] += 1;
    next.wallsPlaced += 1;
    events.push({ type: "wall", player: w.player, placed: true, kind: w.kind, c: w.c, r: w.r });
  }

  const exited = [false, false];

  for (let p = 0; p < 2; p++) {
    const action = actions[p];
    if (action.type === "store") {
      next.bank[p] = 1;
      events.push({ type: "store", player: p });
      continue;
    }
    if (action.type === "wall") continue;
    if (action.type === "exit") {
      const me = next.players[p];
      const blocked = me.r !== 0 || blocksMover(next.topWall[me.c], p);
      exited[p] = !blocked;
      events.push({ type: "exit", player: p, ok: !blocked, collided: blocked });
      continue;
    }

    const dirs = action.dirs;
    let c = next.players[p].c;
    let r = next.players[p].r;
    let steps = 0;
    let collided = false;
    for (const dir of dirs) {
      const t = stepTarget(next, c, r, dir, p);
      if (!t || t.exit) {
        collided = true;
        break;
      }
      c = t.c;
      r = t.r;
      steps += 1;
    }
    next.players[p] = { c, r };
    if (dirs.length === 2) next.bank[p] = 0;
    events.push({ type: "move", player: p, dirs, steps, collided });
  }

  if (exited[0] && exited[1]) next.winner = "draw";
  else if (exited[0]) next.winner = 0;
  else if (exited[1]) next.winner = 1;

  next.plies += 1;
  return { ok: true, state: next, events };
}

export function legalActions(state, player) {
  if (state.winner !== null) return [];
  const out = [];
  const me = state.players[player];
  for (const dir of legalDirs(state, me.c, me.r, player)) {
    out.push({ type: "move", dirs: [dir] });
  }
  if (state.bank[player] >= 1) {
    for (const dir of legalDirs(state, me.c, me.r, player)) {
      const first = stepTarget(state, me.c, me.r, dir, player);
      for (const dir2 of legalDirs(state, first.c, first.r, player)) {
        out.push({ type: "move", dirs: [dir, dir2] });
      }
    }
  }
  if (state.bank[player] === 0) out.push({ type: "store" });
  if (canExit(state, player)) out.push({ type: "exit" });
  if (state.wallsUsed[player] < state.wallLimit[player]) {
    for (let c = 0; c < V_COUNT; c++) {
      for (let r = 0; r < ROWS; r++) {
        const a = { type: "wall", kind: "v", c, r };
        if (validateAction(state, player, a).ok) out.push(a);
      }
    }
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < H_COUNT; r++) {
        const a = { type: "wall", kind: "h", c, r };
        if (validateAction(state, player, a).ok) out.push(a);
      }
    }
    for (let c = 0; c < TOP_COUNT; c++) {
      const a = { type: "wall", kind: "top", c, r: 0 };
      if (validateAction(state, player, a).ok) out.push(a);
    }
  }
  return out;
}

export function distanceOf(state, player) {
  const p = state.players[player];
  return distanceToGoal(state, p.c, p.r, player);
}

/** 超时：走最短的一格；已在终点线则越线。同长度优先向上。 */
export function autoMove(state, player = 0) {
  if (canExit(state, player)) return { type: "exit" };
  const p = state.players[player];
  let best = null;
  let bestDist = Infinity;
  for (const dir of DIRS) {
    const t = stepTarget(state, p.c, p.r, dir, player);
    if (!t || t.exit) continue;
    const d = distanceToGoal(state, t.c, t.r, player);
    if (d < bestDist) {
      bestDist = d;
      best = { type: "move", dirs: [dir] };
    }
  }
  if (best) return best;
  if (state.bank[player] === 0) return { type: "store" };
  return { type: "move", dirs: legalDirs(state, p.c, p.r, player).slice(0, 1) };
}
