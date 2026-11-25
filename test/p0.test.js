import test from "node:test";
import assert from "node:assert/strict";

import { createState, applyAction } from "../src/rules.js";
import { createMasterAI } from "../src/ai-master.js";
import { makeOpenings, replayOpening, mapOutcome, summarize } from "../tools/p0/lib.mjs";

test("T01 未完成不能当平局", () => {
  const unfinished = mapOutcome(null, 0, 240);
  assert.equal(unfinished.result, "unfinished");
  assert.equal(unfinished.endReason, "ply_cap");
  assert.equal(unfinished.isCompleted, false);
  const draw = mapOutcome("draw", 0, 80);
  assert.equal(draw.result, "draw");
  assert.equal(draw.isCompleted, true);
});

test("T02 先后手越线结果不对称", () => {
  // 先手越线，后手下一步也能越线：应为平局
  let s = createState(0, { drawMode: "firstOnly" });
  s.players = [{ c: 0, r: 0 }, { c: 1, r: 0 }];
  s.turn = 0;
  let r = applyAction(s, { type: "move", dir: "up" });
  assert.equal(r.state.winner, "draw");

  // 后手越线：直接获胜
  s = createState(0, { drawMode: "firstOnly" });
  s.players = [{ c: 0, r: 0 }, { c: 1, r: 0 }];
  s.turn = 1;
  r = applyAction(s, { type: "move", dir: "up" });
  assert.equal(r.state.winner, 1);
});

test("T04 极短预算仍返回合法动作", () => {
  const ai = createMasterAI({ timeMs: 1, maxDepth: 12, usePlan: true, routeWalls: 3, smartExit: true });
  const s = createState(0, { drawMode: "firstOnly" });
  s.players = [{ c: 4, r: 7 }, { c: 5, r: 8 }];
  s.plies = 30;
  const a = ai(s, Math.random);
  assert.ok(a, "must return an action");
  const r = applyAction(s, a);
  assert.equal(r.ok, true);
});

test("T05 同一 openingId 在两边重放一致", () => {
  const ops = makeOpenings(3);
  assert.equal(ops.length, 3);
  for (const op of ops) {
    const a = replayOpening(op.actions);
    const b = replayOpening(op.actions);
    assert.deepEqual(a.players, b.players);
    assert.deepEqual(Array.from(a.vWall), Array.from(b.vWall));
    assert.equal(a.turn, b.turn);
  }
});

test("T06 汇总口径与未完成分离", () => {
  const recs = [
    { result: "hell_win", endReason: "normal_terminal", seat: 0 },
    { result: "draw", endReason: "normal_terminal", seat: 1 },
    { result: "hell_loss", endReason: "normal_terminal", seat: 0 },
    { result: "unfinished", endReason: "ply_cap", seat: 1 },
  ];
  const s = summarize(recs);
  assert.equal(s.total, 4);
  assert.equal(s.completed, 3);
  assert.equal(s.winRate, 0.25);
  assert.equal(s.winRateCompleted, Number((1 / 3).toFixed(4)));
  assert.equal(s.drawRate, 0.25);
  assert.equal(s.reasons.ply_cap, 1);
  assert.equal(s.seats[1].unfinished, 1);
});
