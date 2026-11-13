import test from "node:test";
import assert from "node:assert/strict";

import { allWallSlots, ROWS, WALL_SLOTS, wallSlot } from "../src/board.js";
import {
  createState, cloneState, resolveRound, validateAction,
  legalDirs, stepTarget, wallPlaced, setWall,
} from "../src/rules.js";
import { distanceToGoal } from "../src/path.js";
import { playGame } from "../src/selfplay.js";

function round(state, a, b) {
  return resolveRound(state, [a, b]);
}

test("墙位总数为 228，且编号互不重复", () => {
  const slots = allWallSlots();
  assert.equal(slots.length, 228);
  assert.equal(WALL_SLOTS, 228);
  assert.equal(new Set(slots.map((w) => wallSlot(w.kind, w.c, w.r))).size, 228);
});

test("初始局面：双方各需 12 步到终点，没有存点", () => {
  const s = createState(0);
  assert.equal(distanceToGoal(s, 0, 11, 0), 12);
  assert.equal(distanceToGoal(s, 9, 11, 1), 12);
  assert.deepEqual(s.bank, [0, 0]);
  assert.equal(s.winner, null);
});

test("边界：起点只能上、右", () => {
  const s = createState(0);
  assert.deepEqual(legalDirs(s, 0, 11, 0).sort(), ["right", "up"]);
  assert.equal(stepTarget(s, 0, 11, "down", 0), null);
  assert.equal(stepTarget(s, 0, 11, "left", 0), null);
});

test("对方的墙挡住自己，自己的墙不挡自己", () => {
  const s = createState(0);
  setWall(s, "h", 0, 10, 1);
  assert.equal(stepTarget(s, 0, 11, "up", 0), null);
  assert.equal(distanceToGoal(s, 0, 11, 0), 13);
  const own = cloneState(s);
  setWall(own, "h", 9, 10, 1);
  assert.deepEqual(stepTarget(own, 9, 11, "up", 1), { c: 9, r: 10 });
});

test("不能把对方的路完全封死", () => {
  const s = createState(0);
  for (let c = 1; c < 10; c++) setWall(s, "top", c, 0, 0);
  const res = validateAction(s, 0, { type: "wall", kind: "top", c: 0, r: 0 });
  assert.equal(res.ok, false);
  assert.equal(res.error, "blocks-path");
});

test("同一回合都越线则平局", () => {
  const s = createState(0);
  s.players[0] = { c: 0, r: 0 };
  s.players[1] = { c: 9, r: 0 };
  const res = round(s, { type: "exit" }, { type: "exit" });
  assert.equal(res.ok, true);
  assert.equal(res.state.winner, "draw");
});

test("只有一方越线则获胜，即使对方只差一步", () => {
  const s = createState(0);
  s.players[0] = { c: 0, r: 0 };
  s.players[1] = { c: 9, r: 1 };
  const res = round(s, { type: "exit" }, { type: "move", dirs: ["up"] });
  assert.equal(res.state.winner, 0);
  assert.deepEqual(res.state.players[1], { c: 9, r: 0 });
});

test("走两格需要存点，存点后可以一次走两格", () => {
  const s = createState(0);
  assert.equal(validateAction(s, 0, { type: "move", dirs: ["up", "up"] }).error, "no-bank");
  const stored = round(s, { type: "store" }, { type: "move", dirs: ["up"] }).state;
  assert.equal(stored.bank[0], 1);
  const res = round(stored, { type: "move", dirs: ["up", "up"] }, { type: "store" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.players[0], { c: 0, r: 9 });
  assert.equal(res.state.bank[0], 0);
});

test("撞上对方本回合新放的墙：停在墙前，两格的存点照扣", () => {
  const s = createState(0);
  s.bank[0] = 1;
  const res = round(
    s,
    { type: "move", dirs: ["up", "up"] },
    { type: "wall", kind: "h", c: 0, r: 9 },
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.state.players[0], { c: 0, r: 10 });
  assert.equal(res.state.bank[0], 0);
  assert.equal(res.events.find((e) => e.type === "move" && e.player === 0).collided, true);
  assert.equal(wallPlaced(res.state, "h", 0, 9), true);
});

test("两人放在同一墙位上，这一格谁都过不去", () => {
  const s = createState(0);
  const res = round(
    s,
    { type: "wall", kind: "v", c: 4, r: 5 },
    { type: "wall", kind: "v", c: 4, r: 5 },
  );
  assert.equal(res.state.vWall[4 * ROWS + 5], 3);
  assert.equal(res.state.wallsPlaced, 1);
  assert.deepEqual(res.state.wallsUsed, [1, 1]);
  assert.equal(stepTarget(res.state, 4, 5, "right", 0), null);
  assert.equal(stepTarget(res.state, 4, 5, "right", 1), null);
  assert.equal(stepTarget(res.state, 5, 5, "left", 0), null);
  assert.equal(stepTarget(res.state, 5, 5, "left", 1), null);
});

test("棋子可以走到对手所在格", () => {
  const s = createState(0);
  s.players[0] = { c: 4, r: 5 };
  s.players[1] = { c: 4, r: 4 };
  const res = round(s, { type: "move", dirs: ["up"] }, { type: "store" });
  assert.deepEqual(res.state.players[0], { c: 4, r: 4 });
  assert.deepEqual(res.state.players[1], { c: 4, r: 4 });
});

test("越线不能写进走两格里", () => {
  const s = createState(0);
  s.players[0] = { c: 0, r: 1 };
  s.bank[0] = 1;
  const res = validateAction(s, 0, { type: "move", dirs: ["up", "up"] });
  assert.equal(res.ok, false);
});

test("非法行动不改变状态", () => {
  const s = createState(0);
  const res = round(s, { type: "move", dirs: ["down"] }, { type: "store" });
  assert.equal(res.ok, false);
  assert.equal(s.plies, 0);
});

test("cloneState 与原状态互不影响", () => {
  const s = createState(0);
  const c = cloneState(s);
  c.vWall[0] = 1;
  c.players[0].c = 5;
  c.bank[0] = 1;
  assert.equal(s.vWall[0], 0);
  assert.equal(s.players[0].c, 0);
  assert.equal(s.bank[0], 0);
});

test("对局结束后不再接受行动", () => {
  const s = createState(0);
  s.winner = 0;
  assert.equal(validateAction(s, 0, { type: "store" }).error, "game-over");
});

test("贪心 AI 自对弈能走完若干回合", () => {
  const r = playGame({ ai: "greedy", seed: 7, maxPlies: 12 });
  assert.ok(r.plies >= 12 || r.winner !== null);
});

test("上端 10 段都可用，且计入 228", () => {
  const s = createState(0);
  assert.equal(s.topWall.length, 10);
  const slots = allWallSlots().filter((w) => w.kind === "top");
  assert.equal(slots.length, 10);
  assert.equal(wallPlaced(s, "top", 0, 0), false);
});
