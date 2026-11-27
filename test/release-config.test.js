import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createGrandmasterPlusConfig, createGrandmasterConfig, GRANDMASTER_PLUS_MS,
} from "../src/plus-config.js";
import { createHellConfig, configHash } from "../src/hell-config.js";

test("宗师+ 冻结配置与 H1+C 一致", () => {
  const c = createGrandmasterPlusConfig({ pathCache: true });
  assert.equal(GRANDMASTER_PLUS_MS, 3000);
  assert.equal(c.timeMs, 3000);
  assert.equal(c.returnBuffer, 100);
  assert.equal(c.routeWalls, 6);
  assert.equal(c.maxDepth, 12);
  assert.equal(c.endgameDepth, 12);
  assert.equal(c.pathCache, true);
  assert.equal(c.evalRaceMode, "legacy");
  assert.equal(c.smartExit, true);
  assert.equal(c.planMoves, true);
  assert.equal(c.planFallback, true);
  assert.equal(c.necessaryPathGuard, "soft");
});

test("固定宗师配置未变", () => {
  const g = createGrandmasterConfig();
  assert.equal(g.timeMs, 3000);
  assert.equal(g.maxDepth, 7);
  assert.equal(g.endgameDepth, 9);
  assert.equal(g.returnBuffer, 0);
  assert.equal(g.routeWalls, undefined);
  assert.equal(g.pathCache, undefined);
});

test("28 秒地狱配置未变", () => {
  const h = createHellConfig();
  assert.equal(h.timeMs, 28000);
  assert.equal(h.maxDepth, 12);
  assert.equal(h.endgameDepth, 12);
  assert.equal(h.routeWalls, 6);
  assert.equal(h.smartExit, true);
  assert.equal(configHash(h), configHash(createHellConfig()));
});

test("生产入口不引用未验收实验模块", () => {
  const app = readFileSync("app.js", "utf8");
  for (const bad of ["s0-planner", "s1-planner", "h-acs", "h-safe", "wdl"]) {
    assert.equal(app.includes(bad), false, bad);
  }
});
