import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../server/index.js";
import { PROTOCOL_VERSION, RULES_VERSION } from "../server/protocol.js";
import { connect } from "../server/testlib/helpers.js";
import { createState, applyAction, legalActions } from "../src/rules.js";
import { createGameRecord, recordAction, finalizeGame } from "../src/game-library.js";

async function hello(c) {
  c.send({ t: "hello", version: PROTOCOL_VERSION, rules: RULES_VERSION });
  return c.wait((m) => m.t === "welcome", "welcome");
}

test("BS-SERVER：房间携带尺寸，非法尺寸拒绝，不同尺寸并存", async (t) => {
  const srv = await startServer({ port: 0, host: "127.0.0.1" });
  const a = await connect(srv.port);
  const b = await connect(srv.port);
  const c = await connect(srv.port);
  t.after(async () => { a.close(); b.close(); c.close(); await srv.close(); });
  await hello(a); await hello(b); await hello(c);

  a.send({ t: "create", cols: 12, rows: 12 });
  const r1 = await a.wait((m) => m.t === "welcome" && m.room, "12x12");
  b.send({ t: "join", room: r1.room });
  await b.wait((m) => m.t === "welcome" && m.room, "join 12x12");

  c.send({ t: "create", cols: 8, rows: 18 });
  const r2 = await c.wait((m) => m.t === "welcome" && m.room, "8x18");
  assert.notEqual(r1.room, r2.room);

  const d = await connect(srv.port);
  t.after(() => d.close());
  await hello(d);
  d.send({ t: "create", cols: 19, rows: 12 });
  const err = await d.wait((m) => m.t === "error", "bad size");
  assert.equal(err.code, "bad-message");
});

test("BS-SERVER：12×12 房间开局快照携带尺寸", async (t) => {
  let n = 0;
  const srv = await startServer({ port: 0, host: "127.0.0.1", random: () => (n++ % 2 === 0 ? 0.95 : 0.05) });
  const a = await connect(srv.port);
  const b = await connect(srv.port);
  t.after(async () => { a.close(); b.close(); await srv.close(); });
  await hello(a); await hello(b);
  a.send({ t: "create", cols: 12, rows: 12 });
  const created = await a.wait((m) => m.t === "welcome" && m.room, "create 12");
  b.send({ t: "join", room: created.room });
  await b.wait((m) => m.t === "welcome" && m.room, "join 12");
  await a.wait((m) => m.t === "room" && m.phase === "ready", "ready");
  const dice = await a.wait((m) => m.t === "dice", "dice");
  const chooser = dice.chooser === created.seat ? a : b;
  chooser.send({ t: "choice", priority: "side", side: 0 });
  const snap = await a.wait((m) => m.t === "state", "state");
  assert.equal(snap.state.cols, 12);
  assert.equal(snap.state.rows, 12);
  assert.equal(snap.state.vWall.length, 11 * 12);
});

test("BS-GL：12×12 棋谱上传、错误长度拒绝、尺寸筛选", async (t) => {
  const srv = await startServer({ port: 0, host: "127.0.0.1", adminToken: "tok" });
  t.after(async () => srv.close());
  const base = `http://127.0.0.1:${srv.port}`;
  let s = createState(0, { cols: 12, rows: 12 });
  const rec = createGameRecord({ mode: "local", seat: 0, firstPlayer: 0, state: s, source: "test" });
  for (let i = 0; i < 3; i++) {
    const a = legalActions(s)[0];
    recordAction(rec, a, s.turn);
    s = applyAction(s, a).state;
  }
  finalizeGame(rec, s, "unfinished");
  const res = await fetch(`${base}/api/v1/games`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) });
  assert.ok([200, 201].includes(res.status));
  const j = await res.json();
  assert.ok(j.id);

  const bad = JSON.parse(JSON.stringify(rec));
  bad.initialState.vWall = bad.initialState.vWall.slice(0, 10);
  const badRes = await fetch(`${base}/api/v1/games`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bad) });
  assert.equal(badRes.status, 400);

  const exp = await fetch(`${base}/api/v1/admin/export?cols=12&rows=12`, { headers: { Authorization: "Bearer tok" } });
  const ej = await exp.json();
  assert.ok(ej.games.some((g) => g.id === j.id));
  const none = await (await fetch(`${base}/api/v1/admin/export?cols=8&rows=8`, { headers: { Authorization: "Bearer tok" } })).json();
  assert.equal(none.games.length, 0);
});
