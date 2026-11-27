// 路径查询缓存（实验开关，默认关闭）。
// 键 = 52 位墙哈希 + 起点 + 类型；另存 32 位独立签名用于命中核对（合计 84 位身份）。

export const PC = {
  on: false,
  max: 200000,
  map: new Map(),
  entries: 0,
  peak: 0,
  hits: 0,
  misses: 0,
  clears: 0,
  collisions: 0,
  audit: false,
  distinct: null,
};

const hashCache = new WeakMap();

export function wallHash(state) {
  let cached = hashCache.get(state);
  if (cached) return cached;
  let a = 0x9e3779b9;
  let b = 0x85ebca6b;
  let c = 0xc2b2ae35;
  a = Math.imul(a ^ state.cols, 0x01000193);
  b = Math.imul(b ^ state.rows, 0x85ebca6b);
  const v = state.vWall, hh = state.hWall, t = state.topWall;
  for (let i = 0; i < v.length; i++) {
    a = Math.imul(a ^ v[i], 0x01000193);
    b = Math.imul(b ^ v[i], 0x85ebca6b);
    c = Math.imul(c ^ v[i], 0x27d4eb2f);
  }
  for (let i = 0; i < hh.length; i++) {
    a = Math.imul(a ^ hh[i], 0x01000193);
    b = Math.imul(b ^ hh[i], 0x85ebca6b);
    c = Math.imul(c ^ hh[i], 0x27d4eb2f);
  }
  for (let i = 0; i < t.length; i++) {
    a = Math.imul(a ^ t[i], 0x01000193);
    b = Math.imul(b ^ t[i], 0x85ebca6b);
    c = Math.imul(c ^ t[i], 0x27d4eb2f);
  }
  cached = {
    h: (a >>> 0) * 67108864 + (b >>> 0) % 67108864,
    sig: c >>> 0,
  };
  hashCache.set(state, cached);
  return cached;
}

export function enablePathCache(max = 200000, audit = false) {
  PC.on = true;
  PC.max = max;
  PC.hits = 0;
  PC.misses = 0;
  PC.clears = 0;
  PC.collisions = 0;
  PC.entries = 0;
  PC.peak = 0;
  PC.audit = audit;
  PC.distinct = audit ? new Set() : null;
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
    peak: PC.peak,
    distinct: PC.distinct ? PC.distinct.size : null,
    clears: PC.clears,
    collisions: PC.collisions,
  };
}

export function cacheGet(h, pk, sig) {
  const inner = PC.map.get(h);
  if (!inner) return undefined;
  const e = inner.get(pk);
  if (!e) return undefined;
  if (e.sig !== sig) {
    PC.collisions++;
    return undefined;
  }
  return e.v;
}

export function cacheSet(h, pk, sig, v) {
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
  if (!inner.has(pk)) {
    PC.entries++;
    if (PC.entries > PC.peak) PC.peak = PC.entries;
  }
  inner.set(pk, { sig, v });
  if (PC.distinct) PC.distinct.add(h + ":" + pk);
}
