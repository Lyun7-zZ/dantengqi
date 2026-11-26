/** E1a 限时压力：300 次 3s，race 模式 + 缓存。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createMasterAI } from "../../src/ai-master.js";
import { validateAction, legalActions, applyAction, createState } from "../../src/rules.js";
import { createGrandmasterPlusConfig } from "../../src/plus-config.js";
import { makeOpenings, replayOpening, makeRng } from "../p0/lib.mjs";

const OUT = "_extract/m2b1";
mkdirSync(OUT, { recursive: true });
const openings = makeOpenings(115);
const opMap = new Map(openings.map((o) => [o.id, o]));
function scripted(id, plies) {
  let s = replayOpening(opMap.get(id).actions);
  for (let i = 0; i < plies; i++) {
    const acts = legalActions(s);
    let a = acts[(i * 7 + 3) % acts.length];
    if (!a || !validateAction(s, a).ok) a = { type: "move", dir: "up" };
    const r = applyAction(s, a);
    if (!r.ok || r.state.winner !== null) break;
    s = r.state;
  }
  return s;
}
function endgame() {
  const s = createState(0);
  s.players = [{ c: 4, r: 1 }, { c: 5, r: 2 }];
  for (let c = 0; c < 10; c++) if (c !== 4 && c !== 5) s.topWall[c] = 1;
  for (let c = 0; c < 10; c++) s.hWall[c * 11 + 1] = 1;
  s.hWall[4 * 11] = 0;
  s.hWall[5 * 11] = 0;
  s.plies = 88;
  return s;
}
const states = [];
for (const id of [55, 65]) states.push(replayOpening(opMap.get(id).actions));
for (const id of [56, 61]) states.push(scripted(id, 26));
for (const id of [70, 71]) states.push(scripted(id, 80));
states.push(endgame());
for (let k = 0; k < 16; k++) states.push(scripted(56 + k, [14, 34][k % 2]));

const rows = [];
for (let i = 0; i < 300; i++) {
  const st = states[i % states.length];
  const ai = createMasterAI(createGrandmasterPlusConfig({ pathCache: true, evalRaceMode: "race" }));
  const a = ai(st, makeRng(60000 + i));
  const log = ai.stats.lastLog;
  rows.push({ i, tTotal: Math.round(log.tTotal ?? 0), over: (log.tTotal ?? 0) > 3000,
    legal: validateAction(st, a).ok, action: a, depth: log.depthLast });
  if (i % 50 === 0) console.log("done", i);
}
writeFileSync(`${OUT}/stress_race.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const ts = rows.map((r) => r.tTotal).sort((a, b) => a - b);
console.log(JSON.stringify({ n: 300, over: rows.filter((r) => r.over).length,
  illegal: rows.filter((r) => !r.legal).length, max: ts[299],
  p50: ts[150], p95: ts[285], p99: ts[297] }, null, 1));
