import test from "node:test";
import assert from "node:assert/strict";

import { allWallSlots, WALL_SLOTS, wallSlot } from "../src/board.js";
import {
  createState, cloneState, applyAction, validateAction,
  legalDirs, stepTarget, wallPlaced,
} from "../src/rules.js";
import { distanceToGoal } from "../src/path.js";
import { playGame } from "../src/selfplay.js";

/** 直接摆墙（不走回合流程，便于构造局面）。 */
function withWalls(state, walls) {
  const s = cloneState(state);
  for (const w of walls) {
    if (w.kind === "v") s.vWall[w.c * 12 + w.r] = 1;
    else if (w.kind === "h") s.hWall[w.c * 11 + w.r] = 1;
    else s.topWall[w.c] = 1;
  }
  return s;
}

test("墙位总数为 228，且编号互不重复", () => {
  const slots = allWallSlots();
  assert.equal(slots.length, 228);
  assert.equal(WALL_SLOTS, 228);
  assert.equal(new Set(slots.map((w) => wallSlot(w.kind, w.c, w.r))).size, 228);
});

test("初始局面：双方各需 12 步到终点", () => {
  const s = createState(0);
  assert.equal(distanceToGoal(s, 0, 11), 12);
  assert.equal(distanceToGoal(s, 9, 11), 12);
  assert.equal(s.turn, 0);
  assert.equal(s.winner, null);
});

test("边界与穿墙：起点只能上、右", () => {
  const s = createState(0);
  assert.deepEqual(legalDirs(s, 0, 11).sort(), ["right", "up"]);
  assert.equal(stepTarget(s, 0, 11, "down"), null);
  assert.equal(stepTarget(s, 0, 11, "left"), null);
});

test("墙会阻挡移动，并让最短路变长", () => {
  const s = withWalls(createState(0), [{ kind: "h", c: 0, r: 10 }]);
  const before = distanceToGoal(createState(0), 0, 11);
  const after = distanceToGoal(s, 0, 11);
  // 开阔地带单面墙只能逼出 +1 步（横移一格后继续上行）
  assert.equal(after, before + 1);
  assert.equal(stepTarget(s, 0, 11, "up"), null);
});

test("上端墙封住出口后，该列无法越线", () => {
  const s = cloneState(createState(0));
  s.players[0] = { c: 0, r: 0 };
  s.topWall[0] = 1;
  assert.equal(stepTarget(s, 0, 0, "up"), null);
  // 必须横移到别的列才能出线
  assert.equal(distanceToGoal(s, 0, 0), 2);
});

test("不能把双方的路全部封死", () => {
  // 只留 A 列出口，封掉其余 9 段
  const walls = [];
  for (let c = 1; c < 10; c++) walls.push({ kind: "top", c, r: 0 });
  const s = withWalls(createState(0), walls);
  const res = applyAction(s, { type: "wall", kind: "top", c: 0, r: 0 });
  assert.equal(res.ok, false);
  assert.equal(res.error, "blocks-path");
});

test("平局：对手在第 1 行且其出口未封", () => {
  const s = cloneState(createState(0));
  s.players[0] = { c: 0, r: 0 };
  s.players[1] = { c: 9, r: 0 };
  s.turn = 0;
  const res = applyAction(s, { type: "move", dir: "up" });
  assert.equal(res.ok, true);
  assert.equal(res.state.winner, "draw");
  assert.equal(res.event.draw, true);
});

test("获胜：对手还差 2 步以上", () => {
  const s = cloneState(createState(0));
  s.players[0] = { c: 0, r: 0 };
  s.players[1] = { c: 9, r: 1 };
  s.turn = 0;
  const res = applyAction(s, { type: "move", dir: "up" });
  assert.equal(res.state.winner, 0);
});

test("获胜：对手在第 1 行但出口被自己封住", () => {
  const s = cloneState(createState(0));
  s.players[0] = { c: 0, r: 0 };
  s.players[1] = { c: 9, r: 0 };
  s.topWall[9] = 1;
  s.turn = 0;
  const res = applyAction(s, { type: "move", dir: "up" });
  assert.equal(res.state.winner, 0);
});

test("棋子可以走到对手所在格（同格）", () => {
  const s = cloneState(createState(0));
  s.players[0] = { c: 4, r: 5 };
  s.players[1] = { c: 4, r: 4 };
  s.turn = 0;
  const res = applyAction(s, { type: "move", dir: "up" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.players[0], { c: 4, r: 4 });
  assert.deepEqual(res.state.players[1], { c: 4, r: 4 });
});

test("非法封墙：占用与越界", () => {
  const s = withWalls(createState(0), [{ kind: "v", c: 3, r: 5 }]);
  assert.equal(validateAction(s, { type: "wall", kind: "v", c: 3, r: 5 }).error, "occupied");
  assert.equal(validateAction(s, { type: "wall", kind: "v", c: 9, r: 5 }).error, "out-of-bounds");
  assert.equal(validateAction(s, { type: "wall", kind: "top", c: 10, r: 0 }).error, "out-of-bounds");
});

test("非法行动不改变状态，也不消耗回合", () => {
  const s = createState(0);
  const res = applyAction(s, { type: "move", dir: "down" });
  assert.equal(res.ok, false);
  assert.equal(s.turn, 0);
  assert.equal(s.plies, 0);
});

test("cloneState 与原状态互不影响", () => {
  const s = createState(0);
  const c = cloneState(s);
  c.vWall[0] = 1;
  c.players[0].c = 5;
  assert.equal(s.vWall[0], 0);
  assert.equal(s.players[0].c, 0);
});

test("对局结束后不再接受行动", () => {
  const s = cloneState(createState(0));
  s.winner = 0;
  assert.equal(validateAction(s, { type: "move", dir: "up" }).error, "game-over");
});

test("贪心 AI 自对弈能正常结束", () => {
  const r = playGame({ ai: "greedy", seed: 7, maxPlies: 600 });
  assert.equal(r.timeout, false);
  assert.ok(r.plies > 10);
});

test("上端 10 段都可用，且计入 228", () => {
  const s = createState(0);
  assert.equal(s.topWall.length, 10);
  const slots = allWallSlots().filter((w) => w.kind === "top");
  assert.equal(slots.length, 10);
  assert.equal(wallPlaced(s, "top", 0, 0), false);
});
