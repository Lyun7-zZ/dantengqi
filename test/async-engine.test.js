import test from "node:test";
import assert from "node:assert/strict";

import {
  createState, resolveRound, validateAction, legalActions,
  stepTarget, wallPlaced, wallOwner, distanceOf,
} from "../src/rules-async.js";

/** 造一个双方都能自由行动的初始局面。 */
function fresh() {
  return createState(0);
}

/** 把棋子直接摆到指定位置（测试用，绕开逐步移动）。 */
function place(state, p, c, r) {
  state.players[p] = { c, r };
  return state;
}

test("一回合内双方同时行动", () => {
  const s = fresh();
  const res = resolveRound(s, [
    { type: "move", dirs: ["up"] },
    { type: "move", dirs: ["up"] },
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.players[0], { c: 0, r: 10 });
  assert.deepEqual(res.state.players[1], { c: 9, r: 10 });
  assert.equal(res.state.plies, 1);
  assert.equal(res.state.winner, null);
});

test("任一方行动非法则整回合被拒，状态不变", () => {
  const s = fresh();
  const res = resolveRound(s, [
    { type: "move", dirs: ["up"] },
    { type: "move", dirs: ["up", "up"] }, // 没有存点
  ]);
  assert.equal(res.ok, false);
  assert.equal(res.error, "no-bank");
  assert.equal(res.player, 1);
  assert.deepEqual(s.players[1], { c: 9, r: 11 }, "原状态不应被修改");
});

test("存点：最多 1 个，已有存点时不能再存", () => {
  const s = fresh();
  const r1 = resolveRound(s, [{ type: "store" }, { type: "store" }]);
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.state.bank, [1, 1]);

  const r2 = resolveRound(r1.state, [{ type: "store" }, { type: "store" }]);
  assert.equal(r2.ok, false);
  assert.equal(r2.error, "bank-full");
});

test("走两格需要并消耗 1 个存点", () => {
  const s = fresh();
  const stored = resolveRound(s, [{ type: "store" }, { type: "store" }]).state;
  const res = resolveRound(stored, [
    { type: "move", dirs: ["up", "up"] },
    { type: "store" }, // 对方存点（bank 已经是 1 会失败，这里改用走子）
  ]);
  assert.equal(res.ok, false, "对方 bank 已满，整回合应被拒");

  const res2 = resolveRound(stored, [
    { type: "move", dirs: ["up", "up"] },
    { type: "move", dirs: ["left"] },
  ]);
  assert.equal(res2.ok, true);
  assert.deepEqual(res2.state.players[0], { c: 0, r: 9 });
  assert.equal(res2.state.bank[0], 0, "存点被消耗");
  assert.equal(res2.state.bank[1], 1, "对方存点保留");
});

test("双方在同一格放墙：各记一面，这格谁都过不去", () => {
  const s = fresh();
  const res = resolveRound(s, [
    { type: "wall", kind: "v", c: 5, r: 5 },
    { type: "wall", kind: "v", c: 5, r: 5 },
  ]);
  assert.equal(res.ok, true);
  assert.equal(wallPlaced(res.state, "v", 5, 5), true);
  assert.equal(wallOwner(res.state, "v", 5, 5), 2, "同格墙归属为双方");
  assert.deepEqual(res.state.wallsUsed, [1, 1]);
  const both = res.events.filter((e) => e.type === "wall" && e.both);
  assert.equal(both.length, 2);
});

test("墙只挡对方，不挡自己", () => {
  const s = fresh();
  const res = resolveRound(s, [
    { type: "wall", kind: "h", c: 0, r: 10 },
    { type: "move", dirs: ["left"] },
  ]);
  assert.equal(res.ok, true);
  // 自己可以从 (0,11) 往上走
  assert.ok(stepTarget(res.state, 0, 11, "up", 0), "自己的墙不该挡自己");
  // 对手走同一格时被挡
  assert.equal(stepTarget(res.state, 0, 11, "up", 1), null, "对手应被这面墙挡住");
});

test("撞墙：对方本回合放的墙，走子停在墙前", () => {
  const s = fresh();
  const res = resolveRound(s, [
    { type: "wall", kind: "h", c: 9, r: 10 },
    { type: "move", dirs: ["up"] },
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.players[1], { c: 9, r: 11 }, "撞墙后停在原地");
  const move = res.events.find((e) => e.type === "move" && e.player === 1);
  assert.equal(move.collided, true);
  assert.equal(move.steps, 0);
});

test("撞墙时已支付的两格只走了一格，存点照扣", () => {
  const s = fresh();
  // 双方先各存一点
  const stored = resolveRound(s, [{ type: "store" }, { type: "store" }]).state;
  // 玩家0 在玩家1 正上方一路放墙，玩家1 试图走两格
  const res = resolveRound(stored, [
    { type: "wall", kind: "h", c: 9, r: 10 },
    { type: "move", dirs: ["up", "up"] },
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.players[1], { c: 9, r: 11 });
  assert.equal(res.state.bank[1], 0, "第二格没走完，存点仍被扣掉");
  const move = res.events.find((e) => e.type === "move" && e.player === 1);
  assert.equal(move.steps, 0);
  assert.equal(move.collided, true);
});

test("越线：自己越线即获胜", () => {
  const s = fresh();
  place(s, 0, 4, 0);
  place(s, 1, 9, 5);
  s.topWall[4] = 0;
  const res = resolveRound(s, [{ type: "exit" }, { type: "move", dirs: ["up"] }]);
  assert.equal(res.ok, true);
  assert.equal(res.state.winner, 0);
});

test("同一回合双方都越线：判平局", () => {
  const s = fresh();
  place(s, 0, 4, 0);
  place(s, 1, 6, 0);
  s.topWall[4] = 0;
  s.topWall[6] = 0;
  const res = resolveRound(s, [{ type: "exit" }, { type: "exit" }]);
  assert.equal(res.ok, true);
  assert.equal(res.state.winner, "draw");
});

test("终点线被封时不能越线", () => {
  const s = fresh();
  place(s, 0, 4, 0);
  place(s, 1, 9, 5);
  s.topWall[4] = 2; // 对手（玩家1）放的终点墙，编码为 owner+1
  const check = validateAction(s, 0, { type: "exit" });
  assert.equal(check.ok, false);
  assert.equal(check.error, "cannot-exit");
});

test("存点后两格选项出现在合法行动里", () => {
  const s = fresh();
  const stored = resolveRound(s, [{ type: "store" }, { type: "store" }]).state;
  const acts = legalActions(stored, 0);
  const twoStep = acts.filter((a) => a.type === "move" && a.dirs.length === 2);
  assert.ok(twoStep.length > 0, "有存点时应该能走两格");
  const oneStep = acts.filter((a) => a.type === "move" && a.dirs.length === 1);
  assert.ok(oneStep.length > 0, "走一格始终可选");
});

test("距离函数与越线判定一致", () => {
  const s = fresh();
  place(s, 0, 0, 0);
  assert.equal(distanceOf(s, 0), 1, "站在终点线上、一步可出");
  place(s, 0, 0, 5);
  assert.equal(distanceOf(s, 0), 6);
});
