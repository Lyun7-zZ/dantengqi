// 路径查询缓存（实验开关，默认关闭）。
// 52 位墙状态哈希 + 起点/类型作为二级键，降低碰撞概率。

export const PC = {
  on: false,
  max: 200000,
  map: new Map(),
  entries: 0,
  hits: 0,
  misses: 0,
  clears: 0,
};

export function hashWalls(state) {
  let a = 0x9e3779b9;
  let b = 0x85ebca6b;
  const v = state.vWall, hh = state.hWall, t = state.topWall;
  for (let i = 0; i < v.length; i++) {
    a = Math.imul(a ^ v[i], 0x01000193);
    b = Math.imul(b ^ v[i], 0x85ebca6b);
  }
  for (let i = 0; i < hh.length; i++) {
    a = Math.imul(a ^ hh[i], 0x01000193);
    b = Math.imul(b ^ hh[i], 0x85ebca6b);
  }
  for (let i = 0; i < t.length; i++) {
    a = Math.imul(a ^ t[i], 0x01000193);
    b = Math.imul(b ^ t[i], 0x85ebca6b);
  }
  return (a >>> 0) * 67108864 + (b >>> 0) % 67108864;
}

export function enablePathCache(max = 200000) {
  PC.on = true;
  PC.max = max;
  PC.hits = 0;
  PC.misses = 0;
  PC.clears = 0;
  PC.entries = 0;
  PC.map.clear();
}

export function disablePathCache() {
  PC.on = false;
}

export function cacheStats() {
  const total = PC.hits + PC.misses;
  return {
    hits: PC.hits,
    misses: PC.misses,
    hitRate: total ? Number((PC.hits / total).toFixed(4)) : 0,
    uniqueKeys: PC.entries,
    clears: PC.clears,
  };
}

export function cacheGet(h, pk) {
  const inner = PC.map.get(h);
  return inner ? inner.get(pk) : undefined;
}

export function cacheSet(h, pk, v) {
  if (PC.entries >= PC.max) {
    PC.map.clear();
    PC.entries = 0;
    PC.clears++;
  }
  let inner = PC.map.get(h);
  if (!inner) {
    inner = new Map();
    PC.map.set(h, inner);
  }
  if (!inner.has(pk)) PC.entries++;
  inner.set(pk, v);
}
