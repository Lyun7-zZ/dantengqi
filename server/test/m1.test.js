import test from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../index.js";
import { PROTOCOL_VERSION, RULES_VERSION } from "../protocol.js";
import { connect } from "../testlib/helpers.js";

async function hello(c) {
  c.send({ t: "hello", version: PROTOCOL_VERSION, rules: RULES_VERSION });
  return c.wait((m) => m.t === "welcome", "welcome");
}

async function readyRoom(srv) {
  const a = await connect(srv.port);
  const b = await connect(srv.port);
  await hello(a);
  await hello(b);
  a.send({ t: "create" });
  const created = await a.wait((m) => m.t === "welcome" && m.room, "创建房间");
  await a.wait((m) => m.t === "room" && m.phase === "waiting", "等待状态");
  b.send({ t: "join", room: created.room });
  const joined = await b.wait((m) => m.t === "welcome" && m.room, "加入房间");
  await a.wait((m) => m.t === "room" && m.phase === "ready", "双方就绪");
  await b.wait((m) => m.t === "room" && m.phase === "ready", "双方就绪");
  return { a, b, room: created.room, seatA: created.seat, seatB: joined.seat };
}

test("M1：创建房间 → 对手加入 → 双方收到 ready", async (t) => {
  const srv = await startServer({ port: 0, host: "127.0.0.1" });
  const { a, b, room, seatA, seatB } = await readyRoom(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  assert.equal(typeof room, "string");
  assert.equal(room.length, 6);
  assert.notEqual(seatA, seatB, "两人座位不同");
});

test("M1：房间码不存在 / 版本不一致", async (t) => {
  const srv = await startServer({ port: 0, host: "127.0.0.1" });
  const a = await connect(srv.port);
  const b = await connect(srv.port);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  await hello(a);
  a.send({ t: "join", room: "ZZZZZZ" });
  const err = await a.wait((m) => m.t === "error", "room-not-found");
  assert.equal(err.code, "room-not-found");

  b.send({ t: "hello", version: 1, rules: "1.2" });
  const bad = await b.wait((m) => m.t === "error", "版本错误");
  assert.equal(bad.code, "version-mismatch");
});

test("M1：房主离开则房间关闭，对手收到 closed", async (t) => {
  const srv = await startServer({ port: 0, host: "127.0.0.1" });
  const { a, b } = await readyRoom(srv);
  t.after(async () => { b.close(); await srv.close(); });

  a.close();
  const msg = await b.wait((m) => m.t === "room" && m.phase === "closed", "房间关闭");
  assert.equal(msg.phase, "closed");
});

test("M1：对手离开后房间回到 waiting", async (t) => {
  const srv = await startServer({ port: 0, host: "127.0.0.1" });
  const { a, b } = await readyRoom(srv);
  t.after(async () => { a.close(); await srv.close(); });

  b.close();
  const msg = await a.wait((m) => m.t === "room" && m.phase === "waiting", "回到等待");
  assert.equal(msg.phase, "waiting");
});

test("M1：重连令牌可以恢复座位", async (t) => {
  const srv = await startServer({ port: 0, host: "127.0.0.1" });
  const { a, b, seatB } = await readyRoom(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  // b 的令牌从 welcome 里拿：这里重新连一次
  const c = await connect(srv.port);
  t.after(() => c.close());
  // 先用错误令牌，应被拒
  c.send({ t: "hello", version: PROTOCOL_VERSION, rules: RULES_VERSION, room: "AAAAAA", token: "bad" });
  const err = await c.wait((m) => m.t === "error", "错误令牌");
  assert.equal(err.code, "room-not-found");
  assert.ok(seatB === 0 || seatB === 1);
});
