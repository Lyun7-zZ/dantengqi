// 地狱难度共享配置：ai.js、ai-worker.js、测试脚本共用，避免参数漂移。
//
// 生产版本 = A1（routeWalls=6）。
// A0（routeWalls=3）作为回退基线保留，需要时用 createHellA0Config() 切换。

export const HELL_A0_ROUTE_WALLS = 3;
export const HELL_A1_ROUTE_WALLS = 6;

export function createHellConfig(overrides = {}) {
  return {
    timeMs: 28000,
    maxDepth: 12,
    usePlan: true,
    netWalls: true,
    avoidRepeat: true,
    repeatPenalty: 160,
    planMoves: true,
    planFallback: true,
    necessaryPathGuard: "soft",
    endgameDepth: 12,
    routeWalls: HELL_A1_ROUTE_WALLS,
    smartExit: true,
    ...overrides,
  };
}

/** A0 回退基线：除 routeWalls=3 外与生产地狱完全一致。 */
export function createHellA0Config(overrides = {}) {
  return createHellConfig({ routeWalls: HELL_A0_ROUTE_WALLS, ...overrides });
}

export const HELL_CONFIG = createHellConfig();
export const HELL_A0_CONFIG = createHellA0Config();

/** 稳定序列化 + 轻量哈希，用于实验配置快照。 */
export function configHash(cfg) {
  const keys = Object.keys(cfg).sort();
  const text = keys.map((k) => `${k}=${JSON.stringify(cfg[k])}`).join(";");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
