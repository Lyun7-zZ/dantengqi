import test from "node:test";
import assert from "node:assert/strict";
import { createState, validateAction, applyAction } from "../src/rules.js";
import { createMasterAI } from "../src/ai-master.js";
import { AI } from "../src/ai.js";

function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test("BS-AI：代表性尺寸快速决策合法", () => {
  for (const [cols, rows] of [[8, 8], [10, 12], [12, 12], [18, 18], [8, 18], [18, 8]]) {
    const s = createState(0, { cols, rows });
    const ai = createMasterAI({ timeMs: 150, maxDepth: 3, usePlan: false, pathCache: false });
    const a = ai(s, rng(cols * 100 + rows));
    assert.ok(a, `${cols}x${rows} action`);
    assert.ok(validateAction(s, a).ok, `${cols}x${rows} legal`);
    assert.ok(applyAction(s, a).ok);
  }
});

test("BS-AI：121 尺寸深度 1 决策合法", () => {
  const ai = createMasterAI({ timeMs: 40, maxDepth: 1, usePlan: false, pathCache: false });
  for (let cols = 8; cols <= 18; cols++) {
    for (let rows = 8; rows <= 18; rows++) {
      const s = createState(0, { cols, rows });
      const a = ai(s, rng(cols * 31 + rows));
      assert.ok(a && validateAction(s, a).ok, `${cols}x${rows}`);
    }
  }
});

test("BS-AI：基础难度在 12×12 合法", () => {
  for (const level of ["easy", "normal"]) {
    const s = createState(0, { cols: 12, rows: 12 });
    const a = AI[level](s, rng(9));
    assert.ok(a && validateAction(s, a).ok, level);
  }
});
