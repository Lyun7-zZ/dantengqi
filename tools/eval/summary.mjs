/** BS-EVAL 汇总与重放校验。 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { replayGame } from "../../src/game-library.js";

const rows = [];
let invalid = 0;
for (const runId of ["pilot", "full"]) {
  const dir = `_extract/eval/${runId}/games`;
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { continue; }
  for (const f of files) {
    const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    if (!replayGame(d.gl).ok) invalid++;
    rows.push({ ...d.meta, result: d.result, plies: d.diag.plies, ms: d.diag.elapsedMs, cut240: !!d.cut240 });
  }
}
const by = {};
for (const r of rows) {
  const k = `${r.sizeKey}|${r.combo}`;
  const b = by[k] || (by[k] = { sizeKey: r.sizeKey, combo: r.combo, n: 0, w0: 0, w1: 0, d: 0, u: 0, cut240: 0, ms: 0, plies: 0 });
  b.n++; b.ms += r.ms; b.plies += r.plies;
  if (r.result === "W0") b.w0++; else if (r.result === "W1") b.w1++; else if (r.result === "D") b.d++; else b.u++;
  if (r.cut240) b.cut240++;
}
for (const b of Object.values(by)) { b.avgMs = Math.round(b.ms / b.n); b.avgPlies = Number((b.plies / b.n).toFixed(1)); }
const out = { games: rows.length, invalidReplays: invalid, by };
writeFileSync("_extract/eval/summary_all.json", JSON.stringify(out, null, 1));
const csv = ["size,combo,n,w0,w1,d,u,cut240,avgMs,avgPlies"];
for (const b of Object.values(by)) csv.push([b.sizeKey, b.combo, b.n, b.w0, b.w1, b.d, b.u, b.cut240, b.avgMs, b.avgPlies].join(","));
writeFileSync("_extract/eval/summary.csv", csv.join("\n") + "\n");
console.log(JSON.stringify({ games: out.games, invalid: invalid, rows: Object.keys(by).length }, null, 1));
