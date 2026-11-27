// 宗师+ 独立配置：3,000ms 硬预算 + 返回缓冲。
// 只用于宗师+ 研发与评测，不改变固定宗师或地狱的现有配置。

import { createHellConfig, createHellA0Config } from "./hell-config.js";

export const GRANDMASTER_PLUS_MS = 3000;

/** 固定 3 秒宗师（验收对手）。 */
export function createGrandmasterConfig(overrides = {}) {
  return {
    timeMs: 3000,
    maxDepth: 7,
    usePlan: true,
    netWalls: true,
    avoidRepeat: true,
    repeatPenalty: 160,
    planMoves: true,
    planFallback: true,
    necessaryPathGuard: "soft",
    endgameDepth: 9,
    returnBuffer: 0,
    ...overrides,
  };
}

/** 宗师+ 默认基线：A1（routeWalls=6）+ 100ms 返回缓冲。 */
export function createGrandmasterPlusConfig(overrides = {}) {
  return createHellConfig({
    timeMs: GRANDMASTER_PLUS_MS,
    returnBuffer: 100,
    evalRaceMode: "legacy",
    ...overrides,
  });
}

/** 宗师+ 的 A0 对照：routeWalls=3，其余同宗师+。 */
export function createGrandmasterPlusA0Config(overrides = {}) {
  return createHellA0Config({
    timeMs: GRANDMASTER_PLUS_MS,
    returnBuffer: 100,
    evalRaceMode: "legacy",
    ...overrides,
  });
}
