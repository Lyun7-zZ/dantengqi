import test from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../index.js";
import { PROTOCOL_VERSION, RULES_VERSION } from "../protocol.js";
import { connect } from "../testlib/helpers.js";

let diceCalls = 0;
const fixedDice = () => (diceCalls++ % 2 === 0 ? 0.95 : 0.05);

async function asyncPair(srv) {
  const a = await connect(srv.port);
  const b = await connect(srv.port);
  for (const c of [a, b]) {
    c.send({ t: "hello", version: PROTOCOL_VERSION, rules: RULES_VERSION });
    await c.wait((m) => m.t === "welcome", "welcome");
  }
  a.send({ t: "create", mode: "async" });
  const created = await a.wait((m) => m.t === "welcome" && m.room, "创建房间");
  await a.wait((m) => m.t === "room" && m.phase === "waiting", "等待");
  b.send({ t: "join", room: created.room });
  await b.wait((m) => m.t === "welcome" && m.room, "加入");
  await a.wait((m) => m.t === "room" && m.phase === "ready", "就绪");
  await b.wait((m) => m.t === "room" && m.phase === "ready", "就绪");
  return { a, b, seatA: created.seat };
}

async function startAsync(a, b) {
  const snapA = await a.wait((m) => m.t === "state", "开局");
  const snapB = await b.wait((m) => m.t === "state", "开局");
  assert.deepEqual(snapA.sides, [0, 1]);
  return { snapA, snapB };
}

test("异步 M6：创建异步房间并双方提交后结算一回合", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await asyncPair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  const { snapA } = await startAsync(a, b);
  assert.equal(snapA.mode, "async");
  assert.equal(snapA.state.plies, 0);
  assert.ok(Array.isArray(snapA.state.vWall), "vWall 已转成普通数组");

  const sideA = snapA.sides[seatA];
  a.send({ t: "action", ply: 0, action: { type: "move", dirs: ["up"] } });
  const subA = await b.wait((m) => m.t === "submitted", "A 已提交");
  assert.ok(typeof subA.seat === "number");

  b.send({ t: "action", ply: 0, action: { type: "move", dirs: ["up"] } });
  const roundA = await a.wait((m) => m.t === "round", "回合结算");
  const roundB = await b.wait((m) => m.t === "round", "回合结算");
  assert.equal(roundA.state.plies, 1);
  assert.equal(roundB.hash, roundA.hash);
  assert.equal(roundA.actions.length, 2);
});

test("异步 M6：同一玩家重复提交会被拒", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await asyncPair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  await startAsync(a, b);
  a.send({ t: "action", ply: 0, action: { type: "move", dirs: ["up"] } });
  await a.wait((m) => m.t === "submitted", "第一次提交");
  a.send({ t: "action", ply: 0, action: { type: "move", dirs: ["left"] } });
  const err = await a.wait((m) => m.t === "error", "重复提交");
  assert.equal(err.code, "already-submitted");
});

test("异步 M6：非法行动被拒", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await asyncPair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  await startAsync(a, b);
  a.send({ t: "action", ply: 0, action: { type: "move", dirs: ["up", "up", "up"] } });
  const err = await a.wait((m) => m.t === "error", "非法行动");
  assert.equal(err.code, "illegal-action");
});
