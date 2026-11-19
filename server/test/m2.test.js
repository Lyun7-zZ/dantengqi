import test from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../index.js";
import { PROTOCOL_VERSION, RULES_VERSION } from "../protocol.js";
import { connect, sleep } from "../testlib/helpers.js";

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
  await a.wait((m) => m.t === "room" && m.phase === "waiting", "等待状态");
  b.send({ t: "join", room: created.room });
  const joined = await b.wait((m) => m.t === "welcome" && m.room, "加入房间");
  await a.wait((m) => m.t === "room" && m.phase === "ready", "双方就绪");
  await b.wait((m) => m.t === "room" && m.phase === "ready", "双方就绪");
  return { a, b, seatA: created.seat, seatB: joined.seat, room: created.room };
}

/**
 * 走完掷骰阶段：大点者选边，返回开局快照与双方连接。
 * 注意：dice.chooser 是「连接座位」，必须和 seatA 比较，不能假设 a 就是 0 号座。
 */
async function startMatch(a, b, seatA) {
  const connOfSeat = (seat) => (seat === seatA ? a : b);
  const dice = await a.wait((m) => m.t === "dice", "掷骰");
  const chooser = connOfSeat(dice.chooser);
  const other = chooser === a ? b : a;

  chooser.send({ t: "choice", priority: "side", side: 0 });
  const snap = await a.wait((m) => m.t === "state", "开局局面");
  await b.wait((m) => m.t === "state", "开局局面");

  const firstConn = connOfSeat(snap.firstSeat);
  const otherConn = firstConn === a ? b : a;
  return { dice, snap, chooser, other, firstConn, otherConn };
}

test("M2：掷骰 → 选边 → 双方收到完整局面", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  const { snap, dice } = await startMatch(a, b, seatA);
  assert.equal(snap.state.plies, 0);
  assert.equal(typeof snap.hash, "string");
  assert.equal(snap.sides[snap.firstSeat], snap.state.turn, "先手方所在边就是当前回合边");
  assert.notEqual(dice.pts[0], dice.pts[1], "两颗骰子点数必须不同");
});

test("M2：行棋广播事件并切换回合", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  const { snap, firstConn, otherConn } = await startMatch(a, b, seatA);
  const firstSide = snap.sides[snap.firstSeat];

  firstConn.send({ t: "action", ply: 0, action: { type: "move", dir: "up" } });
  const ev = await firstConn.wait((m) => m.t === "event" || m.t === "error", "事件");
  assert.equal(ev.t, "event", JSON.stringify(ev));
  assert.equal(ev.ply, 1);
  assert.equal(ev.by, firstSide);

  const evB = await otherConn.wait((m) => m.t === "event", "对手收到事件");
  assert.equal(evB.hash, ev.hash);

  otherConn.send({ t: "action", ply: 1, action: { type: "move", dir: "up" } });
  const ev2 = await otherConn.wait((m) => m.t === "event" || m.t === "error", "第二手");
  assert.equal(ev2.t, "event", JSON.stringify(ev2));
  assert.equal(ev2.ply, 2);
});

test("M2：不是自己的回合 → not-your-turn", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  const { otherConn } = await startMatch(a, b, seatA);
  otherConn.send({ t: "action", ply: 0, action: { type: "move", dir: "up" } });
  const err = await otherConn.wait((m) => m.t === "error", "错误");
  assert.equal(err.code, "not-your-turn");
});

test("M2：手数不匹配 → stale-ply", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  const { firstConn } = await startMatch(a, b, seatA);
  firstConn.send({ t: "action", ply: 7, action: { type: "move", dir: "up" } });
  const err = await firstConn.wait((m) => m.t === "error", "错误");
  assert.equal(err.code, "stale-ply");
});

test("M2：时钟每 500ms 同步一次", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  const { snap } = await startMatch(a, b, seatA);
  const clock = await a.wait((m) => m.t === "clock", "时钟");
  assert.equal(clock.side, snap.state.turn);
  assert.ok(clock.moveLeft <= clock.perMove);
});

test("M2：服务端计时，超时自动代走", async (t) => {
  diceCalls = 0;
  const srv = await startServer({
    port: 0, host: "127.0.0.1", random: fixedDice, perMove: 1, bank: 0,
  });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  await startMatch(a, b, seatA);
  const ev = await a.wait((m) => m.t === "event" && m.reason === "timeout", "超时代走", 5000);
  assert.equal(ev.ply, 1);
});
