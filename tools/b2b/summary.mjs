/** B2b 汇总：H0+C 与 H1+C，各 40 局。 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { summarize } from "../p0/lib.mjs";

const DIR = "_extract/b2b/runs/b2b";
const OUT = "_extract/b2b";
mkdirSync(OUT, { recursive: true });
const ARMS = ["H0C", "H1C"];
const rowsBy = {};

for (const arm of ARMS) {
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const f = `${DIR}/games_${arm}-s${i}.jsonl`;
    if (!existsSync(f)) throw new Error("missing " + f);
    for (const l of readFileSync(f, "utf8").split("\n")) if (l.trim()) rows.push(JSON.parse(l));
  }
  if (rows.length !== 40) throw new Error(`${arm} expected 40, got ${rows.length}`);
  rowsBy[arm] = rows;
}

const key = (r) => `${r.openingId}-${r.seat}`;
const idx = {};
for (const a of ARMS) idx[a] = new Map(rowsBy[a].map((r) => [key(r), r]));
for (const k of idx.H0C.keys()) if (!idx.H1C.has(k)) throw new Error("missing pair " + k);

const pts = (r) => (r.result === "hell_win" ? 1 : r.result === "draw" ? 0.5 : 0);
const keys = [...idx.H0C.keys()].sort();
const deltas = keys.map((k) => pts(idx.H1C.get(k)) - pts(idx.H0C.get(k)));

const clusters = new Map();
for (const k of keys) {
  const id = idx.H0C.get(k).openingId;
  if (!clusters.has(id)) clusters.set(id, []);
  clusters.get(id).push(pts(idx.H1C.get(k)) - pts(idx.H0C.get(k)));
}
const groups = [...clusters.values()];
let a = 12345 >>> 0;
const rand = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const means = [];
for (let i = 0; i < 5000; i++) {
  const picked = [];
  for (let j = 0; j < groups.length; j++) picked.push(groups[Math.floor(rand() * groups.length)]);
  const flat = picked.flat();
  means.push(flat.reduce((x, y) => x + y, 0) / flat.length);
}
means.sort((x, y) => x - y);

const RES = ["hell_win", "draw", "hell_loss", "unfinished"];
const transitions = {};
for (const x of RES) transitions[x] = Object.fromEntries(RES.map((y) => [y, 0]));
for (const k of keys) transitions[idx.H0C.get(k).result][idx.H1C.get(k).result]++;

const summary = {
  counts: { H0C: summarize(rowsBy.H0C), H1C: summarize(rowsBy.H1C) },
  paired: {
    mean: Number((deltas.reduce((x, y) => x + y, 0) / deltas.length).toFixed(4)),
    ci: [Number(means[Math.floor(means.length * 0.025)].toFixed(4)),
         Number(means[Math.floor(means.length * 0.975)].toFixed(4))],
    changedCategories: keys.filter((k) => idx.H0C.get(k).result !== idx.H1C.get(k).result).length,
    changedScore: keys.filter((k) => pts(idx.H1C.get(k)) - pts(idx.H0C.get(k)) !== 0).length,
  },
  transitions,
  timing: Object.fromEntries(ARMS.map((x) => [x, {
    tAvg: Math.round(rowsBy[x].reduce((s, r) => s + r.tAvg, 0) / 40),
    tMax: Math.max(...rowsBy[x].map((r) => r.tMax)),
    timeouts: rowsBy[x].reduce((s, r) => s + r.timeoutCount, 0),
    depthAvg: Number((rowsBy[x].reduce((s, r) => s + r.depthAvg, 0) / 40).toFixed(2)),
    hitRate: Number((rowsBy[x].reduce((s, r) => s + (r.cacheStats?.hitRate || 0), 0) / 40).toFixed(4)),
  }])),
};
writeFileSync(`${OUT}/b2b_summary.json`, JSON.stringify(summary, null, 1));
const tsv = ["openingId\tseat\tH0C\tH1C\tdelta\n",
  ...keys.map((k) => {
    const a = idx.H0C.get(k), b = idx.H1C.get(k);
    return `${a.openingId}\t${a.seat}\t${a.result}\t${b.result}\t${pts(b) - pts(a)}`;
  })].join("\n") + "\n";
writeFileSync(`${OUT}/paired_results.tsv`, tsv);
writeFileSync(`${OUT}/games_raw.jsonl`,
  [...rowsBy.H0C, ...rowsBy.H1C].map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(JSON.stringify(summary, null, 1));
