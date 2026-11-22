/**
 * RL 环境常驻服务（JSON Lines over stdio）。
 *
 * 请求：{ id, op, ... }
 *   op = "mask"  { state }              → { ok, mask: [232 个 0/1] }
 *   op = "step"  { state, action }      → { ok, state, winner, plies }
 *   op = "legal" { state }              → { ok, count }
 *   op = "ping"                          → { ok }
 *
 * 状态格式见 serializeState()。
 */

import { createInterface } from "node:readline";
import { createState, applyAction, validateAction } from "../../src/rules.js";
import { decode } from "./actions.mjs";

function toState(s) {
  const st = createState(s.firstPlayer ?? 0, { drawMode: "firstOnly" });
  st.vWall.set(s.vWall);
  st.hWall.set(s.hWall);
  st.topWall.set(s.topWall);
  st.players = s.players.map((p) => ({ c: p.c, r: p.r }));
  st.turn = s.turn;
  st.firstPlayer = s.firstPlayer ?? 0;
  st.wallsPlaced = s.wallsPlaced ?? 0;
  return st;
}

function serializeState(s) {
  return {
    vWall: Array.from(s.vWall),
    hWall: Array.from(s.hWall),
    topWall: Array.from(s.topWall),
    players: s.players.map((p) => ({ c: p.c, r: p.r })),
    turn: s.turn,
    firstPlayer: s.firstPlayer,
    wallsPlaced: s.wallsPlaced,
    winner: s.winner,
  };
}

function maskFor(state) {
  const mask = new Array(232).fill(0);
  let count = 0;
  for (let i = 0; i < 232; i++) {
    if (validateAction(state, decode(i)).ok) {
      mask[i] = 1;
      count++;
    }
  }
  return { mask, count };
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    process.stdout.write(JSON.stringify({ id: null, ok: false, error: "bad-json" }) + "\n");
    return;
  }
  const respond = (obj) => process.stdout.write(JSON.stringify({ id: msg.id, ...obj }) + "\n");
  try {
    if (msg.op === "ping") return respond({ ok: true });
    const state = toState(msg.state);
    if (msg.op === "mask") {
      const { mask, count } = maskFor(state);
      return respond({ ok: true, mask, count });
    }
    if (msg.op === "legal") {
      const { count } = maskFor(state);
      return respond({ ok: true, count });
    }
    if (msg.op === "step") {
      const action = Number.isInteger(msg.index) ? decode(msg.index) : msg.action;
      const r = applyAction(state, action);
      if (!r.ok) return respond({ ok: false, error: r.error });
      return respond({
        ok: true,
        state: serializeState(r.state),
        winner: r.state.winner,
        plies: r.state.plies,
      });
    }
    return respond({ ok: false, error: "unknown-op" });
  } catch (e) {
    return respond({ ok: false, error: String(e && e.message || e) });
  }
});
