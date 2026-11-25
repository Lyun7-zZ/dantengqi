/** M1a 限时回归 + 固定深度对照。 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createMasterAI } from "../../src/ai-master.js";
import { createState, applyAction, validateAction, legalActions } from "../../src/rules.js";
import { createGrandmasterPlusConfig, createGrandmasterPlusA0Config } from "../../src/plus-config.js";
import { makeOpenings, replayOpening, makeRng } from "../p0/lib.mjs";

const OUT = "_extract/m1a";
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
    if (!r.ok) break;
    s = r.state;
    if (s.winner !== null) break;
  }
  return s;
}
const endgame = () => {
  const s = createState(0);
  s.players = [{ c: 4, r: 1 }, { c: 5, r: 2 }];
  for (let c = 0; c < 10; c++) if (c !== 4 && c !== 5) s.topWall[c] = 1;
  for (let c = 0; c < 10; c++) s.hWall[c * 11 + 1] = 1;
  s.hWall[4 * 11] = 0;
  s.hWall[5 * 11] = 0;
  s.plies = 88;
  return s;
};
const states = [
  ["early-55", replayOpening(opMap.get(55).actions)],
  ["mid-56", scripted(56, 26)],
  ["end-synth", endgame()],
];

// 限时回归
const limit = [];
for (const [name, st] of states) {
  for (const [arm, make] of [["H0+", createGrandmasterPlusA0Config], ["H1+", createGrandmasterPlusConfig]]) {
    for (let rep = 0; rep < 3; rep++) {
      const ai = createMasterAI(make({ trace: true }));
      const a = ai(st, makeRng(70000 + rep));
      const log = ai.stats?.lastLog ?? {};
      limit.push({
        state: name, arm, rep, tTotal: Math.round(log.tTotal ?? 0),
        over: (log.tTotal ?? 0) > 3000, legal: validateAction(st, a).ok,
        buffer: log.returnBuffer, maxDepth: log.depthLast,
      });
    }
  }
}
writeFileSync(`${OUT}/limit_regression.json`, JSON.stringify(limit, null, 1));

// 固定深度对照（不用于验收，只分离宽度/时间）
const fixed = [];
for (const name of ["mid-56", "end-synth"]) {
  const st = states.find(([n]) => n === name)[1];
  for (const [arm, make] of [["H0+", createGrandmasterPlusA0Config], ["H1+", createGrandmasterPlusConfig]]) {
    const ai = createMasterAI(make({ timeMs: 120000, maxDepth: 6, trace: true }));
    const t0 = Date.now();
    const a = ai(st, makeRng(80000));
    const log = ai.stats?.lastLog ?? {};
    fixed.push({
      state: name, arm, wall: Date.now() - t0, action: a,
      depth: log.depthLast, nodes: log.nodes, tTotal: Math.round(log.tTotal ?? 0),
      candidates: log.candidateCount, trace: log.trace,
    });
  }
}
writeFileSync(`${OUT}/fixed_depth.json`, JSON.stringify(fixed, null, 1));
console.log(JSON.stringify({ limit, fixed }, null, 1));
