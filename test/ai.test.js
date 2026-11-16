import test from "node:test";
import assert from "node:assert/strict";

import { createMasterAI, _candidatesAI, _planWallNetBad, _rootSearch } from "../src/ai-master.js";
import { createState, cloneState, applyAction } from "../src/rules.js";

test("大师 AI 的走子合法", () => {
  const ai = createMasterAI({ timeMs: 1, maxDepth: 1, usePlan: true });
  const state = createState(0);
  const action = ai(state, Math.random);
  assert.ok(action);
  assert.equal(applyAction(state, action).ok, true);
});

test("reset 清空计划、计划预算和统计", () => {
  const ai = createMasterAI({ timeMs: 1, maxDepth: 1, usePlan: true });
  const state = cloneState(createState(0));
  state.players[0] = { c: 0, r: 6 };
  state.players[1] = { c: 9, r: 9 };
  state.turn = 0;

  const action = ai(state, Math.random);
  assert.equal(action.type, "wall");
  assert.equal(ai.stats.plans, 1);
  assert.equal(ai.planBudget(), 1);
  assert.ok(ai.planInfo());

  ai.reset();
  assert.equal(ai.planInfo(), null);
  assert.equal(ai.planBudget(), 0);
  assert.deepEqual(ai.stats, { plans: 0, planWalls: 0, searches: 0, maxPlies: 0 });
});

test("困难档不产生计划", () => {
  const ai = createMasterAI({ timeMs: 1, maxDepth: 1, usePlan: false });
  const state = createState(0);
  const action = ai(state, Math.random);
  assert.ok(action);
  assert.equal(ai.planInfo(), null);
  assert.equal(ai.planBudget(), 0);
});

test("无收益/拖慢自己的墙不会进入候选", () => {
  const state = createState(0);
  state.players[0] = { c: 4, r: 11 };
  state.players[1] = { c: 4, r: 10 };
  state.turn = 0;
  const plain = _candidatesAI(state, {});
  assert.ok(plain.some((a) => a.type === "wall" && a.kind === "h" && a.c === 4 && a.r === 9));
  const net = _candidatesAI(state, { netWalls: true });
  assert.ok(!net.some((a) => a.type === "wall" && a.kind === "h" && a.c === 4 && a.r === 9));
  assert.equal(_planWallNetBad(state, 0, { type: "wall", kind: "h", c: 4, r: 9 }), true);
});

test("回到上一步的走子会被降权", () => {
  const state = createState(0);
  state.players[0] = { c: 4, r: 1 };
  state.players[1] = { c: 9, r: 9 };
  state.turn = 0;
  const up = { type: "move", dir: "up" };
  const upRes = applyAction(state, up);
  assert.equal(upRes.ok, true);
  const np = upRes.state.players[0];
  const key = `${np.r * 10 + np.c}:${upRes.state.wallsPlaced}`;

  const plain = _rootSearch(state, Math.random, 100, 1, {});
  assert.equal(plain.type, "move");
  assert.equal(plain.dir, "up");

  const repeat = _rootSearch(state, Math.random, 100, 1, {
    repeatSet: new Set([key]),
    repeatPenalty: 1e9,
  });
  assert.ok(!(repeat.type === "move" && repeat.dir === "up"));
});

test("大师档启用无效墙过滤与防来回后仍能正常走子", () => {
  const ai = createMasterAI({
    timeMs: 1,
    maxDepth: 1,
    usePlan: false,
    netWalls: true,
    avoidRepeat: true,
    repeatPenalty: 160,
  });
  const state = createState(0);
  const action = ai(state, Math.random);
  assert.ok(action);
  assert.equal(applyAction(state, action).ok, true);
});
