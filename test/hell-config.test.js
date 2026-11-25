import test from "node:test";
import assert from "node:assert/strict";

import {
  createHellConfig, createHellA0Config, configHash,
  HELL_A0_ROUTE_WALLS, HELL_A1_ROUTE_WALLS,
} from "../src/hell-config.js";

test("生产地狱使用 A1（routeWalls=6）", () => {
  const cfg = createHellConfig();
  assert.equal(cfg.routeWalls, 6);
  assert.equal(cfg.routeWalls, HELL_A1_ROUTE_WALLS);
  assert.equal(cfg.timeMs, 28000);
  assert.equal(cfg.maxDepth, 12);
  assert.equal(cfg.smartExit, true);
});

test("A0 回退配置保留 routeWalls=3，其余一致", () => {
  const a0 = createHellA0Config();
  const a1 = createHellConfig();
  assert.equal(a0.routeWalls, HELL_A0_ROUTE_WALLS);
  const { routeWalls: r0, ...rest0 } = a0;
  const { routeWalls: r1, ...rest1 } = a1;
  assert.deepEqual(rest0, rest1);
  assert.notEqual(configHash(a0), configHash(a1));
});
