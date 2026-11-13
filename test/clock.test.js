import test from "node:test";
import assert from "node:assert/strict";

import { createClock, tickClock, displayTime, resetTurn, clockSnapshot, clockRestore } from "../src/clock.js";
import { createState, cloneState, autoMove, resolveRound, stepTarget } from "../src/rules.js";

test("每步 15 秒：未用完时不扣时间库", () => {
  const c = createClock();
  assert.deepEqual(tickClock(c, 0, 10), { timedOut: false });
  assert.equal(Math.round(c.moveLeft), 5);
  assert.equal(c.banks[0], 60);
  assert.equal(c.inBank, false);
});

test("用尽 15 秒后开始扣时间库", () => {
  const c = createClock();
  tickClock(c, 0, 20);
  assert.equal(c.moveLeft, 0);
  assert.equal(Math.round(c.banks[0]), 55);
  assert.equal(c.inBank, true);
});

test("时间库耗尽即超时（总计 75 秒）", () => {
  const c = createClock();
  let out = false;
  for (let i = 0; i < 100; i++) {
    const r = tickClock(c, 0, 1);
    if (r.timedOut) { out = true; break; }
  }
  assert.equal(out, true);
  assert.equal(c.banks[0], 0);
});

test("时间库为 0 时，只有 15 秒", () => {
  const c = createClock();
  c.banks[1] = 0;
  assert.equal(tickClock(c, 1, 14).timedOut, false);
  assert.equal(tickClock(c, 1, 1.5).timedOut, true);
});

test("换手后重置本步时间，不重置时间库", () => {
  const c = createClock();
  tickClock(c, 0, 30);
  const bank = c.banks[0];
  resetTurn(c);
  assert.equal(c.moveLeft, 15);
  assert.equal(c.inBank, false);
  assert.equal(c.banks[0], bank);
});

test("快照与恢复", () => {
  const c = createClock();
  tickClock(c, 0, 42);
  const snap = clockSnapshot(c);
  tickClock(c, 0, 10);
  clockRestore(c, snap);
  assert.equal(Math.round(c.banks[0]), Math.round(snap.banks[0]));
  assert.equal(c.moveLeft, snap.moveLeft);
});

test("displayTime 在时间库阶段返回库剩余", () => {
  const c = createClock();
  assert.equal(displayTime(c, 0), 15);
  tickClock(c, 0, 20);
  assert.equal(Math.round(displayTime(c, 0)), 55);
});

test("autoMove：起点向上走一格", () => {
  const s = createState(0);
  assert.deepEqual(autoMove(s, 0), { type: "move", dirs: ["up"] });
});

test("autoMove：可以直接越线时优先越线", () => {
  const s = cloneState(createState(0));
  s.players[0] = { c: 0, r: 0 };
  assert.deepEqual(autoMove(s, 0), { type: "exit" });
});

test("autoMove：同长度时优先向上", () => {
  const s = cloneState(createState(0));
  s.players[0] = { c: 5, r: 5 };
  const mv = autoMove(s, 0);
  const t = stepTarget(s, 5, 5, mv.dirs[0], 0);
  assert.ok(t);
  assert.equal(resolveRound(s, [mv, { type: "store" }]).ok, true);
});
