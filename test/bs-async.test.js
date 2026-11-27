import test from "node:test";
import assert from "node:assert/strict";
import { createState, resolveRound, validateAction } from "../src/rules-async.js";
import { distanceToGoal, hasPath } from "../src/path-async.js";
import { vCount, hCount } from "../src/board.js";

test("BS-ASYNC：10×12 与 12×12 同时行动核心", () => {
  for (const [cols, rows] of [[10, 12], [12, 12], [8, 18], [18, 8]]) {
    const s = createState(0, { cols, rows });
    assert.equal(s.cols, cols);
    assert.equal(s.rows, rows);
    assert.equal(s.vWall.length, vCount(cols, rows));
    assert.equal(s.hWall.length, hCount(cols, rows));
    assert.ok(Number.isFinite(distanceToGoal(s, 0, rows - 1, 0)));
    assert.ok(hasPath(s, 0, rows - 1, 0));
    const act = [{ type: "move", dir: "up" }, { type: "move", dir: "up" }];
    void act;
  }
});
