/**
 * 异步模式（双方同时行动）的服务端内核。
 * 复用客户端同一份规则：src/rules-async.js
 */

import {
  createState, validateAction, resolveRound, autoMove, distanceOf,
} from "../src/rules-async.js";
import { createClock, tickClock, resetTurn } from "../src/clock.js";

/** FNV-1a 局面指纹（与服务端回合制一致的口径）。 */
export function stateHash(state) {
  let h = 0x811c9dc5;
  const mix = (n) => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (const p of state.players) { mix(p.c); mix(p.r); }
  for (const v of state.vWall) mix(v);
  for (const v of state.hWall) mix(v);
  for (const v of state.topWall) mix(v);
  mix(state.bank?.[0] ?? 0);
  mix(state.bank?.[1] ?? 0);
  mix(state.wallsPlaced ?? 0);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 网络传输：定型数组转普通数组。 */
export function toWireState(state) {
  return {
    ...state,
    vWall: Array.from(state.vWall),
    hWall: Array.from(state.hWall),
    topWall: Array.from(state.topWall),
    players: state.players.map((p) => ({ c: p.c, r: p.r })),
    bank: Array.from(state.bank ?? [0, 0]),
    wallsUsed: Array.from(state.wallsUsed ?? [0, 0]),
  };
}

export function createAsyncGame({ firstSide = 0, perMove = 30, bank = 300 } = {}) {
  const state = createState(firstSide);
  return {
    state,
    clocks: createClock({ perMove, bank }),
    pending: [null, null],   // 本回合双方已提交的行动
    submitted: [false, false],
    think: [perMove, perMove], // 双方各自的本步剩余时间，同时倒数
    inBank: [false, false],
    startedAt: Date.now(),
  };
}

/** 提交本回合行动；返回是否双方已齐。 */
export function submitAction(game, side, action) {
  if (game.state.winner !== null) return { ok: false, error: "game-over" };
  if (game.submitted[side]) return { ok: false, error: "already-submitted" };
  const check = validateAction(game.state, side, action);
  if (!check.ok) return { ok: false, error: "illegal-action", reason: check.error };
  game.pending[side] = action;
  game.submitted[side] = true;
  return { ok: true, ready: game.submitted[0] && game.submitted[1] };
}

/** 缺一方时用最短路径代走。 */
export function fillTimeout(game, side) {
  if (game.submitted[side]) return;
  const action = autoMove(game.state, side);
  if (!action) return;
  game.pending[side] = action;
  game.submitted[side] = true;
}

/** 双方齐了才结算；返回 { ok, state, events, hash }。 */
export function resolveRoundIfReady(game) {
  if (!game.submitted[0] || !game.submitted[1]) return { ok: false };
  const actions = [game.pending[0], game.pending[1]];
  const res = resolveRound(game.state, actions);
  if (!res.ok) return { ok: false, error: res.error, player: res.player };
  game.state = res.state;
  game.pending = [null, null];
  game.submitted = [false, false];
  game.think = [game.clocks.perMove, game.clocks.perMove];
  game.inBank = [false, false];
  resetTurn(game.clocks);
  return {
    ok: true,
    state: game.state,
    events: res.events,
    actions,
    hash: stateHash(game.state),
  };
}

export function tickGame(game, dt) {
  if (game.state.winner !== null) return { timedOut: [] };
  const timedOut = [];
  for (let p = 0; p < 2; p++) {
    if (game.submitted[p]) continue;
    const view = {
      moveLeft: game.think[p],
      inBank: game.inBank[p],
      banks: game.clocks.banks,
      perMove: game.clocks.perMove,
    };
    const r = tickClock(view, p, dt);
    game.think[p] = view.moveLeft;
    game.inBank[p] = view.inBank;
    if (r.timedOut) timedOut.push(p);
  }
  game.clocks.moveLeft = game.think[0];
  game.clocks.inBank = game.inBank[0];
  return { timedOut };
}

export function snapshot(game) {
  return {
    t: "state",
    mode: "async",
    state: toWireState(game.state),
    clocks: {
      perMove: game.clocks.perMove,
      bank: game.clocks.bank,
      banks: game.clocks.banks.slice(),
      moveLeft: game.clocks.moveLeft,
      inBank: game.clocks.inBank,
      think: game.think.slice(),
    },
    plies: game.state.plies,
    hash: stateHash(game.state),
    distances: [distanceOf(game.state, 0), distanceOf(game.state, 1)],
  };
}
