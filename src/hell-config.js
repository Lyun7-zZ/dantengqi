// 地狱难度共享配置：ai.js、ai-worker.js、测试脚本共用，避免参数漂移。

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
    routeWalls: 3,
    smartExit: true,
    ...overrides,
  };
}

export const HELL_CONFIG = createHellConfig();

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
