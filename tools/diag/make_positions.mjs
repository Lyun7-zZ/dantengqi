/** 24 个 10×12 固定局面：领先/胶着/落后各 8。 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { jsonToState, stateToJson } from "../../src/game-library.js";
import { distanceOf, applyAction } from "../../src/rules.js";

const OUT = "_extract/diag";
mkdirSync(OUT, { recursive: true });
const buckets = { lead: [], tie: [], behind: [] };
const seen = new Set();
for (const run of ["pilot", "full"]) {
  const dir = `_extract/eval/${run}/games`;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    if (d.meta.sizeKey !== "10x12") continue;
    let s = jsonToState(d.gl.initialState);
    for (let i = 0; i < d.gl.actions.length && i < 120; i++) {
      const r = applyAction(s, d.gl.actions[i].action);
      if (!r.ok) break;
      s = r.state;
    }
    if (s.winner !== null) continue;
    const a = distanceOf(s, 0), b = distanceOf(s, 1);
    const diff = a - b;
    const key = JSON.stringify([s.players, s.turn, Array.from(s.vWall), Array.from(s.hWall)]);
    if (seen.has(key)) continue;
    const bucket = diff <= -2 ? "lead" : diff >= 2 ? "behind" : "tie";
    if (buckets[bucket].length >= 8) continue;
    seen.add(key);
    buckets[bucket].push({ bucket, diff, state: stateToJson(s) });
  }
}
const all = [...buckets.lead, ...buckets.tie, ...buckets.behind];
if (all.length !== 24) throw new Error("positions " + all.length);
writeFileSync(`${OUT}/positions24.json`, JSON.stringify(all, null, 1));
console.log(JSON.stringify({ total: all.length, counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])) }, null, 1));
