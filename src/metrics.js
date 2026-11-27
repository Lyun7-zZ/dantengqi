// 轻量诊断计数：默认关闭，开启时只做计数与耗时累计。
export const M = {
  on: false,
  pathCalls: 0,
  pathMs: 0,
  legalCalls: 0,
  legalMs: 0,
  applyCalls: 0,
  applyMs: 0,
};

export function resetMetrics() {
  M.pathCalls = 0;
  M.pathMs = 0;
  M.legalCalls = 0;
  M.legalMs = 0;
  M.applyCalls = 0;
  M.applyMs = 0;
}

export function snapshot() {
  return {
    pathCalls: M.pathCalls,
    pathMs: Number(M.pathMs.toFixed(2)),
    legalCalls: M.legalCalls,
    legalMs: Number(M.legalMs.toFixed(2)),
    applyCalls: M.applyCalls,
    applyMs: Number(M.applyMs.toFixed(2)),
  };
}

export function now() {
  return globalThis.performance?.now ? globalThis.performance.now() : Date.now();
}
