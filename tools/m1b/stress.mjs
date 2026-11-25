/** M1b 限时压力：300 次 3s 决策，缓存开启，检查超时与合法性。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createMasterAI } from "../../src/ai-master.js";
import { createState, applyAction, validateAction, legalActions } from "../../src/rules.js";
import { createGrandmasterPlusConfig } from "../../src/plus-config.js";
import { makeOpenings, replayOpening, makeRng } from "../p0/lib.mjs";

const OUT = "_extract/m1b";
mkdirSync(OUT, { recursive: true });
const openings = makeOpenings(75);
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
const N = 300;
for (let i = 0; i < N; i++) {
  const st = states[i % states.length];
  const ai = createMasterAI(createGrandmasterPlusConfig({ pathCache: true }));
  const t0 = Date.now();
  const a = ai(st, makeRng(60000 + i));
  const log = ai.stats.lastLog;
  rows.push({
    i, stateIndex: i % states.length, wall: Date.now() - t0,
    tTotal: Math.round(log.tTotal ?? 0), over: (log.tTotal ?? 0) > 3000,
    legal: validateAction(st, a).ok, action: a,
    cache: log.pathCache,
  });
  if (i % 50 === 0) console.log("done", i);
}
writeFileSync(`${OUT}/stress.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
const ts = rows.map((r) => r.tTotal).sort((a, b) => a - b);
const q = (p) => ts[Math.floor(ts.length * p)];
console.log(JSON.stringify({
  n: rows.length,
  over: rows.filter((r) => r.over).length,
  illegal: rows.filter((r) => !r.legal).length,
  max: ts[ts.length - 1], p50: q(0.5), p95: q(0.95), p99: q(0.99),
  hitRate: Number((rows.reduce((s, r) => s + (r.cache?.hitRate || 0), 0) / rows.length).toFixed(4)),
}, null, 1));
