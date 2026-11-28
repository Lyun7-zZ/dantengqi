import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { replayGame } from "../../src/game-library.js";

const dir = "_extract/v2/pilot/games";
const rows = [];
let invalid = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  if (!replayGame(d.gl).ok) invalid++;
  rows.push({ gameId: d.meta.gameId, sizeKey: d.meta.sizeKey, unitId: d.meta.unitId,
    levels: d.meta.levels, result: d.result, plies: d.diag.plies, ms: d.diag.elapsedMs,
    cuts: Object.keys(d.cuts || {}).map(Number) });
}
const by = {};
for (const r of rows) {
  const k = `${r.sizeKey}|${r.unitId}`;
  const b = by[k] || (by[k] = { n: 0, w0: 0, w1: 0, d: 0, u: 0, ms: 0, plies: 0 });
  b.n++; b.ms += r.ms; b.plies += r.plies;
  if (r.result === "W0") b.w0++; else if (r.result === "W1") b.w1++; else if (r.result === "D") b.d++; else b.u++;
}
for (const b of Object.values(by)) { b.avgMs = Math.round(b.ms / b.n); b.avgPlies = Number((b.plies / b.n).toFixed(1)); }
const out = { games: rows.length, invalid, u: rows.filter((r) => r.result === "U").length, by, rows };
writeFileSync("_extract/v2/pilot_summary.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ games: out.games, invalid, u: out.u, by }, null, 1));
