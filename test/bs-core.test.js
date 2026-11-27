import test from "node:test";
import assert from "node:assert/strict";
import {
  createState, applyAction, validateAction, legalActions, distanceOf, stepTarget,
  wallInBounds, normalizeState,
} from "../src/rules.js";
import { vCount, hCount, allWallSlots, validDims } from "../src/board.js";
import { enablePathCache, disablePathCache } from "../src/path-cache.js";

function playRandom(s, n = 60, seed = 7) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = a; t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (let i = 0; i < n && s.winner === null; i++) {
    const acts = legalActions(s).filter((x) => validateAction(s, x).ok);
    if (!acts.length) break;
    const r = applyAction(s, acts[Math.floor(rnd() * acts.length)]);
    assert.ok(r.ok, "legal action applies");
    s = r.state;
  }
  return s;
}

test("BS-CORE：10×12 与 12×12 基础尺寸", () => {
  for (const [cols, rows] of [[10, 12], [12, 12]]) {
    const s = createState(0, { cols, rows });
    assert.equal(s.cols, cols);
    assert.equal(s.rows, rows);
    assert.equal(s.vWall.length, vCount(cols, rows));
    assert.equal(s.hWall.length, hCount(cols, rows));
    assert.equal(s.topWall.length, cols);
    assert.equal(s.players[1].c, cols - 1);
    assert.equal(s.players[1].r, rows - 1);
    assert.ok(distanceOf(s, 0) > 0);
  }
});

test("BS-CORE：边界 8×8、18×18、8×18、18×8", () => {
  for (const [cols, rows] of [[8, 8], [18, 18], [8, 18], [18, 8]]) {
    const s = createState(0, { cols, rows });
    const end = playRandom(s, 30, cols * 100 + rows);
    assert.equal(end.cols, cols);
    assert.equal(end.rows, rows);
    assert.ok([0, 1, "draw", null].includes(end.winner));
  }
});

test("BS-CORE：121 种尺寸全部可创建并枚举合法动作", () => {
  for (let cols = 8; cols <= 18; cols++) {
    for (let rows = 8; rows <= 18; rows++) {
      assert.ok(validDims(cols, rows));
      const s = createState(0, { cols, rows });
      assert.equal(s.cols, cols);
      assert.equal(s.rows, rows);
      const acts = legalActions(s);
      assert.ok(acts.length > 0, `${cols}x${rows}`);
      assert.ok(acts.some((x) => x.type === "move"));
      assert.ok(acts.some((x) => x.type === "wall"));
    }
  }
});

test("BS-CORE：同一进程混合尺寸互不干扰", () => {
  const a = createState(0, { cols: 10, rows: 12 });
  const b = createState(0, { cols: 12, rows: 12 });
  const a2 = playRandom(a, 20, 11);
  const b2 = playRandom(b, 20, 22);
  assert.equal(a2.cols, 10); assert.equal(a2.rows, 12);
  assert.equal(b2.cols, 12); assert.equal(b2.rows, 12);
  assert.ok(distanceOf(a2, 0) >= 0);
  assert.ok(distanceOf(b2, 0) >= 0);
});

test("BS-CORE：路径缓存按尺寸隔离", () => {
  enablePathCache(10000, false);
  try {
    const a = createState(0, { cols: 10, rows: 12 });
    const b = createState(0, { cols: 12, rows: 12 });
    const da = distanceOf(a, 0);
    const db = distanceOf(b, 0);
    assert.equal(da, 11 + 1);
    assert.equal(db, 11 + 1);
    assert.equal(distanceOf(a, 0), da);
  } finally { disablePathCache(); }
});

test("BS-CORE：非法尺寸与墙边界拒绝", () => {
  assert.throws(() => createState(0, { cols: 7, rows: 12 }));
  assert.throws(() => createState(0, { cols: 19, rows: 12 }));
  assert.throws(() => createState(0, { cols: 12, rows: 7 }));
  assert.equal(wallInBounds("v", 10, 0, 12, 12), true);
  assert.equal(wallInBounds("v", 11, 0, 12, 12), false);
  assert.equal(wallInBounds("v", 11, 0, 10, 12), false);
  assert.equal(wallInBounds("top", 11, 0, 12, 12), true);
  const s = createState(0, { cols: 12, rows: 12 });
  assert.equal(validateAction(s, { type: "wall", kind: "v", c: 11, r: 0 }).ok, false);
});

test("BS-CORE：旧 10×12 状态缺少 cols/rows 可恢复", () => {
  const s = createState(0);
  const raw = JSON.parse(JSON.stringify(s));
  delete raw.cols; delete raw.rows;
  normalizeState(raw);
  assert.equal(raw.cols, 10);
  assert.equal(raw.rows, 12);
  assert.equal(raw.vWall.length, 108);
});
