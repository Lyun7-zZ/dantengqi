/** GL-AI 汇总与重放校验。 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { replayGame } from "../../src/game-library.js";

const runId = process.argv[2] || "pilot";
const dir = `_extract/glai/${runId}/games`;
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const rows = [];
let invalid = 0;
for (const f of files) {
  const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const rp = replayGame(d.gl);
  if (!rp.ok) invalid++;
  rows.push({ gameId: d.meta.gameId, pair: d.meta.pairKey, levels: d.meta.levels,
    result: d.result, plies: d.diag.plies, ms: d.diag.elapsedMs, openingId: d.meta.openingId });
}
const byPair = {};
for (const r of rows) {
  const b = byPair[r.pair] || (byPair[r.pair] = { n: 0, w0: 0, w1: 0, d: 0, u: 0, ms: 0, plies: 0 });
  b.n++; b.ms += r.ms; b.plies += r.plies;
  if (r.result === "W0") b.w0++; else if (r.result === "W1") b.w1++;
  else if (r.result === "D") b.d++; else b.u++;
}
for (const b of Object.values(byPair)) {
  b.avgMs = Math.round(b.ms / b.n); b.avgPlies = Number((b.plies / b.n).toFixed(1));
}
const out = {
  runId, games: rows.length, invalidReplays: invalid,
  uncompleted: rows.filter((r) => r.result === "U").length,
  avgMs: Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length),
  maxMs: Math.max(...rows.map((r) => r.ms)),
  avgPlies: Number((rows.reduce((s, r) => s + r.plies, 0) / rows.length).toFixed(1)),
  byPair,
};
writeFileSync(`_extract/glai/${runId}/summary.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
