/** Q2 汇总：合并 8 个 shard，校验配对，输出双目标与聚类区间。 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { summarize } from "./lib.mjs";

const DIR = "_extract/p0/runs/q2";
const OUT = "_extract/p0/q2";
mkdirSync(OUT, { recursive: true });

function loadArm(arm) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const f = `${DIR}/03_games_raw_${arm}-s${i}.jsonl`;
    if (!existsSync(f)) throw new Error("missing " + f);
    for (const line of readFileSync(f, "utf8").split("\n")) if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

const a0 = loadArm("A0q2");
const a1 = loadArm("A1q2");
const key = (r) => `${r.openingId}-${r.seat}`;
const k0 = new Map(a0.map((r) => [key(r), r]));
const k1 = new Map(a1.map((r) => [key(r), r]));
if (a0.length !== 60 || a1.length !== 60) throw new Error("expected 60 games per arm");
for (const k of k0.keys()) if (!k1.has(k)) throw new Error("missing pair " + k);
for (const k of k1.keys()) if (!k0.has(k)) throw new Error("extra pair " + k);

const pts = (r) => (r.result === "hell_win" ? 1 : r.result === "draw" ? 0.5 : 0);
const keys = [...k0.keys()].sort();
const deltas = keys.map((k) => pts(k1.get(k)) - pts(k0.get(k)));

const byOp = new Map();
for (const k of keys) {
  const id = k0.get(k).openingId;
  if (!byOp.has(id)) byOp.set(id, []);
  byOp.get(id).push(pts(k1.get(k)) - pts(k0.get(k)));
}
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clusters = [...byOp.values()];
const rand = rng(12345);
const boots = [];
for (let i = 0; i < 5000; i++) {
  const picked = [];
  for (let j = 0; j < clusters.length; j++) picked.push(clusters[Math.floor(rand() * clusters.length)]);
  boots.push(picked.flat().reduce((a, b) => a + b, 0) / picked.flat().length);
}
boots.sort((a, b) => a - b);

const s0 = summarize(a0), s1 = summarize(a1);
const out = {
  a0: s0, a1: s1,
  paired: {
    meanDelta: deltas.reduce((a, b) => a + b, 0) / deltas.length,
    bootstrap95: [boots[Math.floor(boots.length * 0.025)], boots[Math.floor(boots.length * 0.975)]],
    flips: keys.map((k) => ({ key: k, a0: k0.get(k).result, a1: k1.get(k).result, d: pts(k1.get(k)) - pts(k0.get(k)) })).filter((x) => x.d !== 0),
  },
};
writeFileSync(`${OUT}/q2_summary.json`, JSON.stringify(out, null, 1));
const tsv = ["openingId\tseat\tA0\tA1\tdelta\n", ...keys.map((k) => {
  const a = k0.get(k), b = k1.get(k);
  return `${a.openingId}\t${a.seat}\t${a.result}\t${b.result}\t${pts(b) - pts(a)}`;
})].join("\n") + "\n";
writeFileSync(`${OUT}/paired_results.tsv`, tsv);
writeFileSync(`${OUT}/games_raw.jsonl`, [...a0, ...a1].map((x) => JSON.stringify(x)).join("\n") + "\n");
console.log(JSON.stringify(out, null, 1));
