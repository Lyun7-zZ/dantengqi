import test from "node:test";
import assert from "node:assert/strict";

import { memoryPair } from "../src/net/transport.js";
import { Session, PHASE } from "../src/net/session.js";
import { createState, applyAction } from "../src/rules.js";
import { stateHash, configHash } from "../src/net/protocol.js";

const CONFIG = { perMove: 30, bank: 300, configHash: configHash({ perMove: 30, bank: 300 }) };
const flush = (ms = 10) => new Promise((r) => setTimeout(r, ms));

/** 建一对会话：主机必掷 5 点，客机必掷 3 点，避免随机性。 */
function pair({ heartbeat } = {}) {
  const [ta, tb] = memoryPair();
  const events = { host: [], guest: [] };
  const states = { host: createState(0), guest: createState(0) };

  const make = (role, transport, side, random) => new Session({
    transport,
    role,
    config: CONFIG,
    random,
    heartbeat,
    getState: () => states[side],
    apply: (action) => {
      const res = applyAction(states[side], action);
      if (!res.ok) return { ok: false, error: res.error };
      states[side] = res.state;
      return { ok: true, state: res.state };
    },
    onEvent: (e) => events[side].push(e),
  });

  const host = make("host", ta, "host", () => 0.7);   // 5 点
  const guest = make("guest", tb, "guest", () => 0.3); // 3 点
  const close = () => { host.close(); guest.close(); };
  return { host, guest, states, events, close };
}

test("握手 → 掷骰 → 选先手 → 选边 → 开局", async (t) => {
  const p = pair();
  t.after(p.close);

  p.host.start();
  p.guest.start();
  await flush(40);

  const hostDice = p.events.host.find((e) => e.type === "dice");
  const guestDice = p.events.guest.find((e) => e.type === "dice");
  assert.ok(hostDice && guestDice, "双方都应收到掷骰结果");
  assert.equal(hostDice.iWin, true, "主机 5 点应大于客机 3 点");
  assert.equal(guestDice.iWin, false);

  p.host.choosePriority("first"); // 大点者选先手
  await flush(20);
  assert.equal(p.host.firstPerson, 0);
  assert.equal(p.guest.firstPerson, 0);
  assert.equal(p.host.sideActor, 1);
  assert.equal(p.guest.sideActor, 1);

  p.guest.chooseSide(0); // 小点者选左边
  await flush(30);

  assert.ok(p.events.host.some((e) => e.type === "start"));
  assert.equal(p.host.phase, PHASE.STARTED);
  assert.equal(p.guest.phase, PHASE.STARTED);
  assert.deepEqual(p.host.seats, p.guest.seats);
  assert.equal(p.host.firstSeat, p.guest.firstSeat);
  assert.equal(p.host.firstSeat, 1, "小点者选了左边，先手方坐右边");
  assert.equal(p.host.mySeat, 1, "主机先手，坐右边");
  assert.equal(p.guest.mySeat, 0, "客机执左");
});

test("行动同步：双方状态与哈希一致", async (t) => {
  const p = await startedGame();
  t.after(p.close);

  const seatOfHost = p.host.seats[0];
  const mover = p.states.host.turn === seatOfHost ? p.host : p.guest;

  const res = mover.localAction({ type: "move", dir: "up" }, 1234);
  assert.equal(res.ok, true);
  await flush(30);

  assert.equal(stateHash(p.states.host), stateHash(p.states.guest));

  const evt = p.events.host.concat(p.events.guest).find((e) => e.type === "remoteAction");
  assert.ok(evt, "对方应收到 remoteAction");
  assert.equal(evt.elapsedMs, 1234);
});

test("行动顺序错误会判定失同步", async (t) => {
  const p = await startedGame();
  t.after(p.close);

  let err = null;
  p.guest.onEvent = (e) => { if (e.type === "error") err = e; };
  p.host.send("action", { ply: 99, action: { type: "move", dir: "up" }, elapsedMs: 0, hash: "x" });
  await flush(30);

  assert.ok(err);
  assert.match(err.code, /ply-mismatch|desync/);
});

test("非法远程行动会被拒绝", async (t) => {
  const p = await startedGame();
  t.after(p.close);

  let err = null;
  p.guest.onEvent = (e) => { if (e.type === "error") err = e; };
  p.host.send("action", { ply: 1, action: { type: "move", dir: "down" }, elapsedMs: 0, hash: "x" });
  await flush(30);

  assert.ok(err);
  assert.match(err.code, /illegal-remote-action|desync/);
});

test("心跳超时会报 timeout", async (t) => {
  const p = pair({ heartbeat: { intervalMs: 40, timeoutMs: 120 } });
  t.after(p.close);
  p.host.start();
  p.guest.start();
  await flush(40);

  // 双方都收不到任何消息，模拟对端彻底失联
  p.host.transport.onMessage = null;
  p.guest.transport.onMessage = null;

  let timedOut = false;
  p.host.onEvent = (e) => { if (e.type === "timeout") timedOut = true; };
  await flush(300);
  assert.equal(timedOut, true);
});

test("掷骰作弊（哈希不符）会被拒绝", async (t) => {
  const p = pair();
  t.after(p.close);
  p.host.start();
  p.guest.start();
  await flush(40);

  let err = null;
  p.host.onEvent = (e) => { if (e.type === "error") err = e; };
  p.host._onDiceReveal({ nonce: "x", value: 6 });

  assert.ok(err);
  assert.equal(err.code, "dice-cheat");
});

async function startedGame() {
  const p = pair();
  p.host.start();
  p.guest.start();
  await flush(40);

  p.host.choosePriority("first");
  await flush(20);
  p.guest.chooseSide(0);
  await flush(30);
  return p;
}
