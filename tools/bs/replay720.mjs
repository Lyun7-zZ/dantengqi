/** G0：720 局旧 10×12 棋谱逐手重放。 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { replayGame } from "../../src/game-library.js";

const OUT = "_extract/bs";
mkdirSync(OUT, { recursive: true });
let total = 0, ok = 0, bad = [];
for (const runId of ["pilot", "full"]) {
  const dir = `_extract/glai/${runId}/games`;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
    total++;
    const r = replayGame(d.gl);
    if (r.ok) ok++; else bad.push({ gameId: d.meta.gameId, error: r.error });
  }
}
writeFileSync(`${OUT}/replay720.json`, JSON.stringify({ total, ok, bad: bad.slice(0, 20), badCount: bad.length }, null, 1));
console.log(JSON.stringify({ total, ok, bad: bad.length }, null, 1));
