import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";

import { startServer } from "../index.js";
import { PROTOCOL_VERSION, RULES_VERSION } from "../protocol.js";

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const queue = [];
    const waiters = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      const w = waiters.shift();
      if (w) w(msg); else queue.push(msg);
    });
    ws.on("error", reject);
    ws.on("open", () => {
      resolve({
        ws,
        send: (obj) => ws.send(JSON.stringify(obj)),
        next: () => new Promise((res) => {
          if (queue.length) res(queue.shift());
          else waiters.push(res);
        }),
        close: () => ws.close(),
      });
    });
  });
}

async function hello(c) {
  c.send({ t: "hello", version: PROTOCOL_VERSION, rules: RULES_VERSION });
  return c.next();
}

test("M1：创建房间 → 对手加入 → 双方收到 ready", async (t) => {
  const srv = await startServer({ port: 0, host: "127.0.0.1" });
  const a = await connect(srv.port);
  const b = await connect(srv.port);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  assert.equal((await hello(a)).t, "welcome");

  a.send({ t: "create" });
  const created = await a.next();
  assert.equal(created.t, "welcome");
  assert.equal(typeof created.room, "string");
  assert.equal(created.room.length, 6);
  assert.equal(created.host, true);

  // 房主会先收到一次 waiting
  const waiting = await a.next();
  assert.equal(waiting.t, "room");
  assert.equal(waiting.phase, "waiting");

  await hello(b);
  b.send({ t: "join", room: created.room });
  const joined = await b.next();
  assert.equal(joined.t, "welcome");
  assert.notEqual(joined.seat, created.seat, "两人座位不同");

  const roomA = await a.next();
  const roomB = await b.next();
  assert.equal(roomA.phase, "ready");
  assert.equal(roomB.phase, "ready");
});

test("M1：房间码不存在 / 版本不一致", async (t) => {
  const srv = await startServer({ port: 0, host: "127.0.0.1" });
  const a = await connect(srv.port);
  t.after(async () => { a.close(); await srv.close(); });
  await hello(a);

  a.send({ t: "join", room: "ZZZZZZ" });
  const err = await a.next();
  assert.equal(err.t, "error");
  assert.equal(err.code, "room-not-found");

  const b = await connect(srv.port);
  t.after(() => b.close());
  b.send({ t: "hello", version: 1, rules: "1.2" });
  const bad = await b.next();
  assert.equal(bad.t, "error");
  assert.equal(bad.code, "version-mismatch");
});

test("M1：房主离开则房间关闭，对手收到 closed", async (t) => {
  const srv = await startServer({ port: 0, host: "127.0.0.1" });
  const a = await connect(srv.port);
  const b = await connect(srv.port);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  await hello(a);
  await hello(b);
  a.send({ t: "create" });
  const created = await a.next();
  await a.next(); // waiting
  b.send({ t: "join", room: created.room });
  await b.next(); // welcome
  await a.next(); // ready
  await b.next(); // ready

  a.close();
  const msg = await b.next();
  assert.equal(msg.t, "room");
  assert.equal(msg.phase, "closed");
});

test("M1：对手离开后房间回到 waiting", async (t) => {
  const srv = await startServer({ port: 0, host: "127.0.0.1" });
  const a = await connect(srv.port);
  const b = await connect(srv.port);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  await hello(a);
  await hello(b);
  a.send({ t: "create" });
  const created = await a.next();
  await a.next();
  b.send({ t: "join", room: created.room });
  await b.next();
  await a.next();
  await b.next();

  b.close();
  const msg = await a.next();
  assert.equal(msg.t, "room");
  assert.equal(msg.phase, "waiting");
});
