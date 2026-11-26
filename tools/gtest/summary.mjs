/** G-test 汇总：G7+ vs G9+ 配对与门槛。 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { summarize } from "../p0/lib.mjs";

const DIR = "_extract/gtest/runs/gtest";
const OUT = "_extract/gtest";
mkdirSync(OUT, { recursive: true });
const ARMS = ["G7", "G9"];
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
for (const k of idx.G7.keys()) if (!idx.G9.has(k)) throw new Error("missing pair " + k);

const pts = (r, u = 0) => (r.result === "hell_win" ? 1 : r.result === "draw" ? 0.5 : r.result === "unfinished" ? u : 0);
const keys = [...idx.G7.keys()].sort();
const deltas = keys.map((k) => pts(idx.G9.get(k)) - pts(idx.G7.get(k)));
const clusters = new Map();
for (const k of keys) {
  const id = idx.G7.get(k).openingId;
  if (!clusters.has(id)) clusters.set(id, []);
  clusters.get(id).push(pts(idx.G9.get(k)) - pts(idx.G7.get(k)));
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
for (const k of keys) transitions[idx.G7.get(k).result][idx.G9.get(k).result]++;

const t = {};
for (const arm of ARMS) {
  const rs = rowsBy[arm];
  t[arm] = {
    extMax: Math.max(...rs.map((r) => r.extMax)),
    extP99: Math.max(...rs.map((r) => r.extP99)),
    over3000: rs.reduce((s, r) => s + r.overCount, 0),
    depthAvg: Number((rs.reduce((s, r) => s + r.depthAvg, 0) / 40).toFixed(2)),
    nodesAvg: Math.round(rs.reduce((s, r) => s + r.nodesAvg, 0) / 40),
    endgameMoves: rs.reduce((s, r) => s + r.endgameMoves, 0),
  };
}

const g7 = summarize(rowsBy.G7), g9 = summarize(rowsBy.G9);
const gates = {
  relative: {
    winNotLower: g9.hell_win >= g7.hell_win,
    lossAtLeastTwoBetter: g9.hell_loss <= g7.hell_loss - 2,
    riskNotUp: (g9.hell_loss + g9.unfinished) <= (g7.hell_loss + g7.unfinished),
    scoreNotLower: g9.score >= g7.score,
    noOver: t.G7.over3000 === 0 && t.G9.over3000 === 0,
  },
  absolute: { wins28: g9.hell_win >= 28, loss4: g9.hell_loss <= 4, u0: g9.unfinished === 0 },
};
gates.relativePass = Object.values(gates.relative).every(Boolean);
gates.absolutePass = Object.values(gates.absolute).every(Boolean);

const out = {
  counts: { G7: g7, G9: g9 },
  paired: {
    mean: Number((deltas.reduce((x, y) => x + y, 0) / deltas.length).toFixed(4)),
    ci: [Number(means[Math.floor(means.length * 0.025)].toFixed(4)),
         Number(means[Math.floor(means.length * 0.975)].toFixed(4))],
    changedCategories: keys.filter((k) => idx.G7.get(k).result !== idx.G9.get(k).result).length,
  },
  uSensitivity: [0, 0.5, 1].map((u) => ({
    u, mean: Number((keys.reduce((s, k) => s + pts(idx.G9.get(k), u) - pts(idx.G7.get(k), u), 0) / keys.length).toFixed(4)),
  })),
  transitions, timing: t, gates,
};
writeFileSync(`${OUT}/gtest_summary.json`, JSON.stringify(out, null, 1));
const tsv = ["openingId\tseat\tG7\tG9\tdelta\n",
  ...keys.map((k) => {
    const x = idx.G7.get(k), y = idx.G9.get(k);
    return `${x.openingId}\t${x.seat}\t${x.result}\t${y.result}\t${pts(y) - pts(x)}`;
  })].join("\n") + "\n";
writeFileSync(`${OUT}/paired_results.tsv`, tsv);
writeFileSync(`${OUT}/games_raw.jsonl`,
  [...rowsBy.G7, ...rowsBy.G9].map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(JSON.stringify(out, null, 1));
