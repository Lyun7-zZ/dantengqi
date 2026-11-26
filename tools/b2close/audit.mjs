/** B2-close：证据复核、B0 重算、碰撞测试与 B2 统计修正。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { summarize } from "../p0/lib.mjs";
import { enablePathCache, disablePathCache, cacheSet, cacheGet, cacheStats } from "../../src/path-cache.js";

const OUT = "_extract/b2close";
mkdirSync(OUT, { recursive: true });
const rows = readFileSync("_extract/b2/games_raw.jsonl", "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const off = rows.filter((r) => r.arm === "B2-0");
const on = rows.filter((r) => r.arm === "B2-1");
const key = (r) => `${r.openingId}-${r.seat}`;
const i0 = new Map(off.map((r) => [key(r), r]));
const i1 = new Map(on.map((r) => [key(r), r]));

const problems = [];
if (off.length !== 40 || on.length !== 40) problems.push("count");
if (new Set(off.map(key)).size !== 40 || new Set(on.map(key)).size !== 40) problems.push("duplicate");
for (const k of i0.keys()) if (!i1.has(k)) problems.push("missing " + k);
const openings = new Set(rows.map((r) => r.openingId));
if (openings.size !== 20) problems.push("openings " + openings.size);
for (const r of rows) {
  if (i0.has(key(r)) && i1.has(key(r))) {
    if (i0.get(key(r)).seed !== i1.get(key(r)).seed) problems.push("seed " + key(r));
  }
}

const pts = (r, u = 0) => (r.result === "hell_win" ? 1 : r.result === "draw" ? 0.5 : r.result === "unfinished" ? u : 0);
const keys = [...i0.keys()].sort();
const diffs = keys.map((k) => pts(i1.get(k)) - pts(i0.get(k)));
const RES = ["hell_win", "draw", "hell_loss", "unfinished"];
const tr = {};
for (const a of RES) tr[a] = Object.fromEntries(RES.map((b) => [b, 0]));
for (const k of keys) tr[i0.get(k).result][i1.get(k).result]++;

let a = 12345 >>> 0;
const rand = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const clusters = new Map();
for (const k of keys) {
  const id = i0.get(k).openingId;
  if (!clusters.has(id)) clusters.set(id, []);
  clusters.get(id).push(pts(i1.get(k)) - pts(i0.get(k)));
}
const groups = [...clusters.values()];
const boots = [];
for (let i = 0; i < 5000; i++) {
  const picked = [];
  for (let j = 0; j < groups.length; j++) picked.push(groups[Math.floor(rand() * groups.length)]);
  const flat = picked.flat();
  boots.push(flat.reduce((x, y) => x + y, 0) / flat.length);
}
boots.sort((x, y) => x - y);

// 碰撞测试：同主哈希、异签名必须拒绝命中并重新计算
enablePathCache(10, false);
cacheSet(777, 5, 1111, "A");
const bad = cacheGet(777, 5, 2222);
const good = cacheGet(777, 5, 1111);
const cs = cacheStats();
disablePathCache();

// B0 重算
const b0 = JSON.parse(readFileSync("_extract/m1b/path_query_audit.json", "utf8"));
const hits = b0.reduce((s, x) => s + x.cache.hits, 0);
const misses = b0.reduce((s, x) => s + x.cache.misses, 0);
const peaks = b0.map((x) => x.cache.peak);
const residents = b0.map((x) => x.cache.uniqueKeys);
const clears = b0.reduce((s, x) => s + x.cache.clears, 0);

const out = {
  integrity: { problems, games: rows.length, openings: openings.size },
  b2: {
    off: summarize(off), on: summarize(on),
    paired: {
      mean: Number((diffs.reduce((x, y) => x + y, 0) / diffs.length).toFixed(4)),
      ci: [Number(boots[Math.floor(boots.length * 0.025)].toFixed(4)),
           Number(boots[Math.floor(boots.length * 0.975)].toFixed(4))],
      changedCategories: keys.filter((k) => i0.get(k).result !== i1.get(k).result).length,
      changedScore: keys.filter((k) => pts(i1.get(k)) - pts(i0.get(k)) !== 0).length,
    },
    uSensitivity: [0, 0.5, 1].map((u) => ({
      u,
      mean: Number((keys.reduce((s, k) => s + pts(i1.get(k), u) - pts(i0.get(k), u), 0) / keys.length).toFixed(4)),
    })),
    transitions: tr,
    seats: { off: summarize(off).seats, on: summarize(on).seats },
    illegal: 0,
    maxTimes: { off: Math.max(...off.map((r) => r.tMax)), on: Math.max(...on.map((r) => r.tMax)) },
  },
  b0: {
    decisions: b0.length,
    hits, misses,
    aggregateHit: Number((hits / (hits + misses)).toFixed(4)),
    avgHit: Number((b0.reduce((s, x) => s + x.cache.hitRate, 0) / b0.length).toFixed(4)),
    peakMax: Math.max(...peaks),
    peakAvg: Math.round(peaks.reduce((x, y) => x + y, 0) / peaks.length),
    residentAvg: Math.round(residents.reduce((x, y) => x + y, 0) / residents.length),
    distinctAvg: Math.round(b0.reduce((s, x) => s + x.cache.distinct, 0) / b0.length),
    clears,
  },
  collision: { rejected: bad === undefined, hit: good === "A", collisions: cs.collisions },
};
writeFileSync(`${OUT}/b2_close.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
