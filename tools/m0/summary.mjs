/** M0 汇总：合并三组各 8 个 shard，校验 40 局/组并输出对比。 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { summarize } from "../p0/lib.mjs";

const DIR = "_extract/m0/runs/m0";
const OUT = "_extract/m0";
mkdirSync(OUT, { recursive: true });
const ARMS = ["G0", "H0", "H1"];
const all = {};

for (const arm of ARMS) {
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const f = `${DIR}/03_games_M0-${arm}-s${i}.jsonl`;
    if (!existsSync(f)) throw new Error("missing " + f);
    for (const line of readFileSync(f, "utf8").split("\n")) if (line.trim()) rows.push(JSON.parse(line));
  }
  if (rows.length !== 40) throw new Error(`${arm} expected 40, got ${rows.length}`);
  const s = summarize(rows);
  const mean = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0) / rows.length;
  all[arm] = {
    ...s,
    timing: {
      tAvg: Math.round(mean("tAvg")),
      tMax: Math.max(...rows.map((r) => r.tMax || 0)),
      depthAvg: Number(mean("depthAvg").toFixed(2)),
      candAvg: Number(mean("candAvg").toFixed(1)),
      timeouts: rows.reduce((a, r) => a + (r.timeoutCount || 0), 0),
    },
  };
}

function score(arm, openingId, seat) {
  const r = allRows[arm].find((x) => x.openingId === openingId && x.seat === seat);
  return r ? (r.result === "hell_win" ? 1 : r.result === "draw" ? 0.5 : 0) : null;
}
const allRows = {};
for (const arm of ARMS) {
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const f = `${DIR}/03_games_M0-${arm}-s${i}.jsonl`;
    for (const line of readFileSync(f, "utf8").split("\n")) if (line.trim()) rows.push(JSON.parse(line));
  }
  allRows[arm] = rows;
}
const diffs = { "H0-G0": [], "H1-G0": [], "H1-H0": [] };
for (const r of allRows.G0) {
  const k = `${r.openingId}-${r.seat}`;
  const a = score("G0", r.openingId, r.seat);
  const b = score("H0", r.openingId, r.seat);
  const c = score("H1", r.openingId, r.seat);
  if (a != null && b != null) diffs["H0-G0"].push(b - a);
  if (a != null && c != null) diffs["H1-G0"].push(c - a);
  if (b != null && c != null) diffs["H1-H0"].push(c - b);
}
for (const k of Object.keys(diffs)) {
  const xs = diffs[k];
  all[k] = xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)) : null;
}

writeFileSync(`${OUT}/m0_summary.json`, JSON.stringify(all, null, 1));
console.log(JSON.stringify(all, null, 1));
