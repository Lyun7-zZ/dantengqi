import test from "node:test";
import assert from "node:assert/strict";

import { createMasterAI } from "../src/ai-master.js";
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
