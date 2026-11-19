/**
 * 对局内核：掷骰分边、行棋校验、计时。
 * 纯逻辑，不碰网络；广播由 index.js 负责。
 *
 * 复用客户端的规则引擎：../src/rules.js、../src/clock.js
 */

import {
  createState, applyAction, validateAction, autoMove, distanceOf,
} from "../src/rules.js";
import { createClock, tickClock, resetTurn as resetMoveClock } from "../src/clock.js";

/** 与客户端一致的局面指纹（FNV-1a）。 */
export function stateHash(state) {
  let h = 0x811c9dc5;
  const mix = (n) => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (const p of state.players) {
    mix(p.c);
    mix(p.r);
  }
  for (const v of state.vWall) mix(v);
  for (const v of state.hWall) mix(v);
  for (const v of state.topWall) mix(v);
  mix(state.turn);
  mix(state.wallsPlaced);
  mix(state.tolerance);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 掷骰：返回两颗点数（必然不同）。 */
export function rollDice(random = Math.random) {
  const a = 1 + Math.floor(random() * 6);
  let b = 1 + Math.floor(random() * 6);
  let guard = 0;
  while (b === a && guard++ < 50) b = 1 + Math.floor(random() * 6);
  return [a, b];
}

/**
 * 根据“先手 / 选边”的选择计算两边的棋盘座位。
 *   choice = { priority: "first" }                → 选的人先手，对方选边
 *   choice = { priority: "side", side: 0|1 }      → 选的人执该边，对方先手
 *   choice = { side: 0|1 }                        → 对方先手时，由先手方选边
 *
 * 返回 { sides, firstSeat }，sides[connSeat] 是该连接所在的棋盘边（0=左，1=右）。
 */
export function resolveChoice({ chooserSeat, pickerSeat, priority, side }) {
  const sides = [null, null];
  if (priority === "side") {
    if (side !== 0 && side !== 1) return { ok: false, error: "bad-side" };
    sides[chooserSeat] = side;
    sides[pickerSeat] = 1 - side;
    return { ok: true, sides, firstSeat: pickerSeat };
  }
  // priority === "first"：选的人先手，对方选边
  if (side !== 0 && side !== 1) return { ok: false, error: "bad-side" };
  sides[pickerSeat] = side;
  sides[chooserSeat] = 1 - side;
  return { ok: true, sides, firstSeat: chooserSeat };
}

/** 开新局：firstSide 是棋盘边（0=左先手）。 */
export function createGame({ firstSide, perMove = 30, bank = 300 }) {
  const state = createState(firstSide);
  return {
    state,
    clocks: createClock({ perMove, bank }),
    startedAt: Date.now(),
  };
}

/**
 * 行棋：校验先后手与规则，成功则返回新状态与事件。
 * side 为该连接所在的棋盘边。
 */
export function applyMove(game, side, action) {
  if (game.state.winner !== null) return { ok: false, error: "game-over" };
  if (game.state.turn !== side) return { ok: false, error: "not-your-turn" };

  const check = validateAction(game.state, action);
  if (!check.ok) return { ok: false, error: "illegal-action", reason: check.error };

  const res = applyAction(game.state, action);
  if (!res.ok) return { ok: false, error: "illegal-action", reason: res.error };

  game.state = res.state;
  resetMoveClock(game.clocks);

  const event = {
    t: "event",
    ply: game.state.plies,
    action,
    by: side,
    hash: stateHash(game.state),
  };
  let result = null;
  if (game.state.winner !== null) {
    result = {
      t: "result",
      winner: game.state.winner,
      reason: game.state.winner === "draw" ? "draw" : "exit",
      plies: game.state.plies,
    };
  }
  return { ok: true, event, result };
}

/**
 * 推进计时；超时则用最短路径代走。
 * 返回 { timedOut, event?, result? }
 */
export function tickGame(game, dt) {
  if (game.state.winner !== null) return { timedOut: false };
  const r = tickClock(game.clocks, game.state.turn, dt);
  if (!r.timedOut) return { timedOut: false };

  const side = game.state.turn;
  const action = autoMove(game.state);
  if (!action) return { timedOut: true };
  const res = applyAction(game.state, action);
  if (!res.ok) return { timedOut: true };

  game.state = res.state;
  resetMoveClock(game.clocks);

  const event = {
    t: "event",
    ply: game.state.plies,
    action,
    by: side,
    reason: "timeout",
    hash: stateHash(game.state),
  };
  let result = null;
  if (game.state.winner !== null) {
    result = {
      t: "result",
      winner: game.state.winner,
      reason: game.state.winner === "draw" ? "draw" : "timeout",
      plies: game.state.plies,
    };
  }
  return { timedOut: true, event, result };
}

/**
 * 局面通过网络传输前，把定型数组转成普通数组。
 * JSON 序列化会把 Int8Array 变成 {"0":0,...}，客户端 cloneState 会崩。
 */
export function toWireState(state) {
  return {
    ...state,
    vWall: Array.from(state.vWall),
    hWall: Array.from(state.hWall),
    topWall: Array.from(state.topWall),
    players: state.players.map((p) => ({ c: p.c, r: p.r })),
  };
}

/** 下发给客户端的局面快照。 */
export function gameSnapshot(game) {
  return {
    t: "state",
    state: toWireState(game.state),
    clocks: {
      perMove: game.clocks.perMove,
      bank: game.clocks.bank,
      banks: game.clocks.banks.slice(),
      moveLeft: game.clocks.moveLeft,
      inBank: game.clocks.inBank,
    },
    plies: game.state.plies,
    turn: game.state.turn,
    hash: stateHash(game.state),
  };
}

/** 供调试与测试：当前到手方的剩余距离。 */
export function distances(game) {
  return [distanceOf(game.state, 0), distanceOf(game.state, 1)];
}
