import test from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../index.js";
import { PROTOCOL_VERSION, RULES_VERSION } from "../protocol.js";
import { connect } from "../testlib/helpers.js";

let diceCalls = 0;
const fixedDice = () => (diceCalls++ % 2 === 0 ? 0.95 : 0.05);

async function pair(srv) {
  const a = await connect(srv.port);
  const b = await connect(srv.port);
  for (const c of [a, b]) {
    c.send({ t: "hello", version: PROTOCOL_VERSION, rules: RULES_VERSION });
    await c.wait((m) => m.t === "welcome", "welcome");
  }
  a.send({ t: "create" });
  const created = await a.wait((m) => m.t === "welcome" && m.room, "创建房间");
  await a.wait((m) => m.t === "room" && m.phase === "waiting", "等待");
  b.send({ t: "join", room: created.room });
  const joined = await b.wait((m) => m.t === "welcome" && m.room, "加入");
  await a.wait((m) => m.t === "room" && m.phase === "ready", "就绪");
  await b.wait((m) => m.t === "room" && m.phase === "ready", "就绪");
  return { a, b, seatA: created.seat, seatB: joined.seat, room: created.room };
}

async function startMatch(a, b, seatA) {
  const connOf = (seat) => (seat === seatA ? a : b);
  const dice = await a.wait((m) => m.t === "dice", "掷骰");
  const chooser = connOf(dice.chooser);
  chooser.send({ t: "choice", priority: "side", side: 0 });
  const snap = await a.wait((m) => m.t === "state", "开局");
  await b.wait((m) => m.t === "state", "开局");
  const firstConn = connOf(snap.firstSeat);
  const otherConn = firstConn === a ? b : a;
  return { snap, firstConn, otherConn };
}

test("M4：认输 → 对方获胜", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  const { snap, firstConn, otherConn } = await startMatch(a, b, seatA);
  const resignerSeat = firstConn === a ? seatA : 1 - seatA;
  firstConn.send({ t: "resign" });
  const result = await otherConn.wait((m) => m.t === "result", "结果");
  assert.equal(result.reason, "resign");
  assert.equal(result.winner, 1 - snap.sides[resignerSeat]);
});

test("M4：悔棋请求 → 同意后回滚一手", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  const { snap, firstConn, otherConn } = await startMatch(a, b, seatA);

  firstConn.send({ t: "action", ply: 0, action: { type: "move", dir: "up" } });
  await firstConn.wait((m) => m.t === "event", "落子");
  await otherConn.wait((m) => m.t === "event", "落子");

  otherConn.send({ t: "undo", op: "request" });
  const req = await firstConn.wait((m) => m.t === "undo" && m.op === "request", "悔棋请求");
  assert.ok(typeof req.seat === "number");

  firstConn.send({ t: "undo", op: "accept" });
  await otherConn.wait((m) => m.t === "undo" && m.op === "done", "悔棋完成");
  const restored = await otherConn.wait((m) => m.t === "state", "回滚后局面");
  assert.equal(restored.state.plies, 0);
  assert.equal(restored.state.turn, snap.state.turn);
});

test("M4：悔棋被拒绝", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  const { firstConn, otherConn } = await startMatch(a, b, seatA);
  firstConn.send({ t: "action", ply: 0, action: { type: "move", dir: "up" } });
  await firstConn.wait((m) => m.t === "event", "落子");
  await otherConn.wait((m) => m.t === "event", "落子");

  otherConn.send({ t: "undo", op: "request" });
  await firstConn.wait((m) => m.t === "undo" && m.op === "request", "请求");
  firstConn.send({ t: "undo", op: "decline" });
  const declined = await otherConn.wait((m) => m.t === "undo" && m.op === "declined", "拒绝");
  assert.equal(declined.op, "declined");
});

test("M4：再来一局（请求 → 同意 → 重新掷骰）", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  const { firstConn, otherConn } = await startMatch(a, b, seatA);
  firstConn.send({ t: "resign" });
  await otherConn.wait((m) => m.t === "result", "结果");

  otherConn.send({ t: "rematch", op: "request" });
  await firstConn.wait((m) => m.t === "rematch" && m.op === "request", "请求再来一局");
  firstConn.send({ t: "rematch", op: "accept" });
  await otherConn.wait((m) => m.t === "rematch" && m.op === "accepted", "接受");
  const dice = await otherConn.wait((m) => m.t === "dice", "重新掷骰");
  assert.equal(dice.stage, "priority");
});

test("M4：掉线 90 秒判负（测试用 300ms）", async (t) => {
  diceCalls = 0;
  const srv = await startServer({
    port: 0, host: "127.0.0.1", random: fixedDice, disconnectMs: 300,
  });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  const { snap, firstConn, otherConn } = await startMatch(a, b, seatA);
  const leftSeat = firstConn === a ? seatA : 1 - seatA;
  firstConn.close();

  const paused = await otherConn.wait((m) => m.t === "room" && m.phase === "paused", "暂停");
  assert.equal(paused.seat, leftSeat);

  const result = await otherConn.wait((m) => m.t === "result", "掉线判负", 5000);
  assert.equal(result.reason, "disconnect");
  assert.equal(result.winner, 1 - snap.sides[leftSeat]);
});
