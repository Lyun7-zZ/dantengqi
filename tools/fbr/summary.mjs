import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { replayGame } from "../../src/game-library.js";

const dir = "_extract/fbr/run/games";
const rows = [];
let invalid = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
  const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  if (!replayGame(d.gl).ok) invalid++;
  const first = d.meta.firstPlayer;
  rows.push({ ...d.meta, result: d.result, firstWin: d.result === (first === 0 ? "W0" : "W1"), cut240: !!d.cut240 });
}
const by = {};
for (const r of rows) {
  const k = `${r.rule}|${r.algo}`;
  const b = by[k] || (by[k] = { rule: r.rule, algo: r.algo, n: 0, first: 0, second: 0, d: 0, u: 0, cut240: 0 });
  b.n++;
  if (r.result === "D") b.d++; else if (r.result === "U") b.u++;
  else if (r.firstWin) b.first++; else b.second++;
  if (r.cut240) b.cut240++;
}
for (const b of Object.values(by)) { b.score = Number(((b.first + 0.5 * b.d) / b.n).toFixed(4)); b.upper = Number(((b.first + 0.5 * b.d + b.u) / b.n).toFixed(4)); }
writeFileSync("_extract/fbr/summary.json", JSON.stringify({ games: rows.length, invalid, by }, null, 1));
console.log(JSON.stringify({ games: rows.length, invalid, by }, null, 1));
