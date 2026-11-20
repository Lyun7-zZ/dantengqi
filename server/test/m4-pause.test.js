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
  await b.wait((m) => m.t === "welcome" && m.room, "加入");
  await a.wait((m) => m.t === "room" && m.phase === "ready", "就绪");
  await b.wait((m) => m.t === "room" && m.phase === "ready", "就绪");
  return { a, b, seatA: created.seat };
}

async function startMatch(a, b, seatA) {
  const connOf = (seat) => (seat === seatA ? a : b);
  const dice = await a.wait((m) => m.t === "dice", "掷骰");
  connOf(dice.chooser).send({ t: "choice", priority: "side", side: 0 });
  await a.wait((m) => m.t === "state", "开局");
  await b.wait((m) => m.t === "state", "开局");
}

test("M4：暂停需要对方同意，暂停期间冻结计时", async (t) => {
  diceCalls = 0;
  const srv = await startServer({
    port: 0, host: "127.0.0.1", random: fixedDice, perMove: 1, bank: 0,
  });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  await startMatch(a, b, seatA);

  a.send({ t: "pause", op: "request" });
  const req = await b.wait((m) => m.t === "pause" && m.op === "request", "暂停请求");
  assert.ok(typeof req.seat === "number");

  b.send({ t: "pause", op: "accept" });
  await a.wait((m) => m.t === "pause" && m.op === "paused", "已暂停");
  await b.wait((m) => m.t === "pause" && m.op === "paused", "已暂停");

  // 暂停期间不应出现超时代走（perMove=1 秒，等 1.6 秒也不该有）
  await new Promise((r) => setTimeout(r, 1600));
  const timeouts = [...a.seen, ...b.seen].filter((m) => m.t === "event" && m.reason === "timeout");
  assert.equal(timeouts.length, 0, "暂停期间不应代走");

  // 恢复需要对方同意
  a.send({ t: "pause", op: "resume" });
  await b.wait((m) => m.t === "pause" && m.op === "resume-request", "继续请求");
  b.send({ t: "pause", op: "resume-accept" });
  await a.wait((m) => m.t === "pause" && m.op === "resumed", "已恢复");

  // 恢复后计时继续：1 秒内应出现超时代走
  const ev = await b.wait((m) => m.t === "event" && m.reason === "timeout", "超时代走", 4000);
  assert.equal(ev.reason, "timeout");
});

test("M4：暂停请求可被拒绝", async (t) => {
  diceCalls = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: fixedDice });
  const { a, b, seatA } = await pair(srv);
  t.after(async () => { a.close(); b.close(); await srv.close(); });

  await startMatch(a, b, seatA);
  a.send({ t: "pause", op: "request" });
  await b.wait((m) => m.t === "pause" && m.op === "request", "暂停请求");
  b.send({ t: "pause", op: "decline" });
  await a.wait((m) => m.t === "pause" && m.op === "declined", "被拒绝");
});
