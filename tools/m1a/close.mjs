/** M0-close：配对区间、转移矩阵、座位、计时与未完成审计。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { summarize } from "../p0/lib.mjs";

const OUT = "_extract/m1a";
mkdirSync(OUT, { recursive: true });
const rows = readFileSync("_extract/m0/games_raw.jsonl", "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const arms = ["G0", "H0", "H1"];
const by = {};
for (const a of arms) by[a] = rows.filter((r) => r.arm === a);

const key = (r) => `${r.openingId}-${r.seat}`;
const pts = (r) => (r.result === "hell_win" ? 1 : r.result === "draw" ? 0.5 : 0);
const idx = {};
for (const a of arms) idx[a] = new Map(by[a].map((r) => [key(r), r]));

const problems = [];
for (const a of arms) {
  if (by[a].length !== 40) problems.push(`${a} count ${by[a].length}`);
  if (new Set(by[a].map(key)).size !== 40) problems.push(`${a} duplicate keys`);
}
for (const k of idx.G0.keys()) if (!idx.H0.has(k) || !idx.H1.has(k)) problems.push(`missing ${k}`);

const RESULTS = ["hell_win", "draw", "hell_loss", "unfinished"];
const transition = {};
for (const [name, other] of [["H0-G0", "H0"], ["H1-G0", "H1"], ["H1-H0", "H1"]]) {
  const from = name.endsWith("G0") ? "G0" : "H0";
  const m = {};
  for (const a of RESULTS) m[a] = Object.fromEntries(RESULTS.map((b) => [b, 0]));
  for (const k of idx.G0.keys()) m[idx[from].get(k).result][idx[other].get(k).result]++;
  transition[name] = m;
}

function bootstrap(fromArm, toArm, seed = 12345) {
  const clusters = new Map();
  for (const k of idx.G0.keys()) {
    const id = idx.G0.get(k).openingId;
    if (!clusters.has(id)) clusters.set(id, []);
    clusters.get(id).push(pts(idx[toArm].get(k)) - pts(idx[fromArm].get(k)));
  }
  const groups = [...clusters.values()];
  let a = seed >>> 0;
  const rand = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const means = [];
  for (let i = 0; i < 5000; i++) {
    const picked = [];
    for (let j = 0; j < groups.length; j++) picked.push(groups[Math.floor(rand() * groups.length)]);
    const xs = picked.flat();
    means.push(xs.reduce((x, y) => x + y, 0) / xs.length);
  }
  means.sort((x, y) => x - y);
  const all = [];
  for (const k of idx.G0.keys()) all.push(pts(idx[toArm].get(k)) - pts(idx[fromArm].get(k)));
  return {
    mean: Number((all.reduce((x, y) => x + y, 0) / all.length).toFixed(4)),
    ci: [Number(means[Math.floor(means.length * 0.025)].toFixed(4)),
         Number(means[Math.floor(means.length * 0.975)].toFixed(4))],
    clusters: groups.length,
  };
}

const timing = {};
for (const a of arms) {
  const rs = by[a];
  timing[a] = {
    tAvgMean: Math.round(rs.reduce((x, r) => x + r.tAvg, 0) / rs.length),
    tMax: Math.max(...rs.map((r) => r.tMax)),
    timeouts: rs.reduce((x, r) => x + r.timeoutCount, 0),
    depthAvg: Number((rs.reduce((x, r) => x + r.depthAvg, 0) / rs.length).toFixed(2)),
    candidatesAvg: Number((rs.reduce((x, r) => x + r.candAvg, 0) / rs.length).toFixed(1)),
  };
}

const unfinished = rows.filter((r) => r.result === "unfinished")
  .map((r) => ({ arm: r.arm, openingId: r.openingId, seat: r.seat, plies: r.plies, tMax: r.tMax, tAvg: r.tAvg }));
const timeoutEvents = rows.filter((r) => r.timeoutCount > 0)
  .map((r) => ({ arm: r.arm, openingId: r.openingId, seat: r.seat, tMax: r.tMax, tTotal: r.tTotal, plies: r.plies, result: r.result }));

const out = {
  problems,
  counts: Object.fromEntries(arms.map((a) => [a, summarize(by[a])])),
  transition,
  bootstrap: { "H0-G0": bootstrap("G0", "H0"), "H1-G0": bootstrap("G0", "H1"), "H1-H0": bootstrap("H0", "H1") },
  timing,
  unfinished,
  timeoutEvents,
  dataHash: createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16),
};
writeFileSync(`${OUT}/m0_close.json`, JSON.stringify(out, null, 1));

const tsv = ["pair\tG0\tH0\tH1"];
for (const k of [...idx.G0.keys()].sort()) {
  tsv.push(`${k}\t${idx.G0.get(k).result}\t${idx.H0.get(k).result}\t${idx.H1.get(k).result}`);
}
writeFileSync(`${OUT}/paired_results.tsv`, tsv.join("\n") + "\n");
const tm = ["pair\tfrom\tto\tcount"];
for (const [name, m] of Object.entries(transition)) for (const a of RESULTS) for (const b of RESULTS) {
  if (m[a][b]) tm.push(`${name}\t${a}\t${b}\t${m[a][b]}`);
}
writeFileSync(`${OUT}/failure_matrix.tsv`, tm.join("\n") + "\n");
writeFileSync(`${OUT}/timing_audit.json`, JSON.stringify({ timing, timeoutEvents, unfinished }, null, 1));
console.log(JSON.stringify(out, null, 1));
